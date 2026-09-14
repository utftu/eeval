import { DEFAULT_TIMEOUT, RECORD_VERSION } from "../consts.ts";
import type { CaseProps } from "../eval/eval.ts";
import type { Pool } from "../pool/pool.ts";
import type { EvalConfig, JobResponse, Task } from "../pool/protocol.ts";
import type {
  CaseRecord,
  EvalRecord,
  RunRecord,
  TrialRecord,
} from "../types.ts";

export type RunOptions = {
  trials: number;
  retries: number;
  timeout?: number;
};

export type ReportCase = (evalName: string, record: CaseRecord) => void;

// Раннер решает, что запускать, и собирает записи прогонов. Он ничего не
// печатает и ничего не пишет на диск: строку по готовому кейсу отдаёт
// в reportCase, а записи возвращает наружу.

type Plan = {
  file: string;
  eval: EvalConfig;
};

function describeResponse(response: JobResponse): TrialRecord["error"] {
  if (response.kind === "error") {
    return {
      name: response.name,
      message: response.message,
      stack: response.stack,
    };
  }

  return {
    name: "Error",
    message: `неожиданный ответ воркера: ${response.kind}`,
  };
}

async function runTrial({
  pool,
  task,
  timeout,
  retries,
}: {
  pool: Pool;
  task: Task;
  timeout: number;
  retries: number;
}): Promise<TrialRecord> {
  const startedAt = Date.now();
  let used = 0;

  while (true) {
    const response = await pool.send(task, timeout);

    if (response.kind === "result") {
      return {
        score: response.score,
        output: response.output,
        ms: Date.now() - startedAt,
        retries: used,
      };
    }

    if (used < retries) {
      used = used + 1;
      continue;
    }

    return {
      error: describeResponse(response),
      ms: Date.now() - startedAt,
      retries: used,
    };
  }
}

async function runCase({
  pool,
  plan,
  caseProps,
  options,
}: {
  pool: Pool;
  plan: Plan;
  caseProps: CaseProps;
  options: RunOptions;
}): Promise<CaseRecord> {
  const task: Task = {
    kind: "run",
    file: plan.file,
    evalName: plan.eval.name,
    caseName: caseProps.name,
  };
  const timeout = options.timeout ?? caseProps.timeout ?? DEFAULT_TIMEOUT;

  // Trials одного кейса уходят в пул одновременно: нагрузку всё равно
  // ограничивает число воркеров, а замеры друг от друга не зависят.
  // Promise.all отдаёт их в порядке запуска, а не завершения.
  const trials = await Promise.all(
    Array.from({ length: options.trials }, () =>
      runTrial({ pool, task, timeout, retries: options.retries }),
    ),
  );

  // Баллы не сворачиваются: кейс прошёл, только если прошёл каждый trial.
  // У trial, упавшего после всех retries, балла нет, и он кейс валит.
  const passed = trials.every(
    (trial) => trial.score !== undefined && trial.score >= caseProps.minScore,
  );

  return {
    name: caseProps.name,
    minScore: caseProps.minScore,
    passed,
    trials,
  };
}

async function buildPlans({
  pool,
  files,
  timeout,
}: {
  pool: Pool;
  files: string[];
  timeout: number;
}): Promise<Plan[]> {
  const plans: Plan[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const response = await pool.send({ kind: "list", file }, timeout);

    if (response.kind !== "cases") {
      throw new Error(`${file}: ${describeResponse(response)?.message}`);
    }

    for (const evalConfig of response.evals) {
      const already = seen.get(evalConfig.name);

      if (already !== undefined) {
        throw new Error(
          `эвал "${evalConfig.name}" объявлен дважды: ${already} и ${file}`,
        );
      }

      seen.set(evalConfig.name, file);
      plans.push({ file, eval: evalConfig });
    }
  }

  return plans;
}

export async function runEvals({
  pool,
  files,
  options,
  reportCase,
}: {
  pool: Pool;
  files: string[];
  options: RunOptions;
  reportCase: ReportCase;
}): Promise<RunRecord> {
  const startedAt = Date.now();
  const listTimeout = options.timeout ?? DEFAULT_TIMEOUT;
  const plans = await buildPlans({ pool, files, timeout: listTimeout });
  const evals: EvalRecord[] = [];

  for (const plan of plans) {
    const evalStartedAt = Date.now();

    // Кейсы одного эвала уходят в пул все разом — очередь пула и есть
    // ограничение параллельности.
    const cases = await Promise.all(
      plan.eval.cases.map(async (caseProps) => {
        const record = await runCase({ pool, plan, caseProps, options });
        reportCase(plan.eval.name, record);

        return record;
      }),
    );

    evals.push({
      name: plan.eval.name,
      ms: Date.now() - evalStartedAt,
      total: cases.length,
      passed: cases.filter((record) => record.passed).length,
      cases,
    });
  }

  return {
    version: RECORD_VERSION,
    startedAt: new Date(startedAt).toISOString(),
    ms: Date.now() - startedAt,
    options: {
      trials: options.trials,
      retries: options.retries,
      timeout: options.timeout,
    },
    evals,
  };
}

import { defaultTimeout, RECORD_VERSION } from "../consts.ts";
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

export type TrialReport = {
  evalName: string;
  caseName: string;
  trial: number;
  minScore: number;
  record: TrialRecord;
};

export type ReportTrial = (report: TrialReport) => void;

// Попытка trial отдана воркеру. retries — сколько повторов было до неё.
export type StartReport = {
  evalName: string;
  caseName: string;
  trial: number;
  retries: number;
};

export type ReportStart = (report: StartReport) => void;

// Раннер решает, что запускать, и собирает запись запуска. Он ничего не
// печатает и ничего не пишет на диск: готовый trial отдаёт в reportTrial,
// а запись возвращает наружу.

type Plan = {
  file: string;
  eval: EvalConfig;
};

// Правило одно на раннер и вывод: trial прошёл, если у него есть балл и балл
// не ниже порога. У trial, упавшего после всех retries, балла нет.
export function checkTrial(record: TrialRecord, minScore: number): boolean {
  if (record.score === undefined) {
    return false;
  }

  return record.score >= minScore;
}

type Mode = "only" | "skip";

// Флаг уровня выше решает за уровень ниже: флаг эвала — за все его кейсы,
// флаг кейса учитывается, только когда у эвала флага нет. Оба флага сразу
// на одном уровне запрещены при объявлении, поэтому порядок проверок внутри
// уровня не важен.
export function pickMode(evalConfig: EvalConfig, caseProps: CaseProps): Mode | undefined {
  if (evalConfig.only) {
    return "only";
  }

  if (evalConfig.skip) {
    return "skip";
  }

  if (caseProps.only) {
    return "only";
  }

  if (caseProps.skip) {
    return "skip";
  }

  return;
}

function skipCase(caseProps: CaseProps): CaseRecord {
  return {
    name: caseProps.name,
    minScore: caseProps.minScore,
    passed: false,
    skipped: true,
    trials: [],
  };
}

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
  handleStart,
}: {
  pool: Pool;
  task: Task;
  timeout: number;
  retries: number;
  handleStart: (retries: number) => void;
}): Promise<TrialRecord> {
  // Время trial — сумма выполнения всех попыток в воркере. Ожидание свободного
  // воркера перед каждой попыткой не считается: оно зависит от --concurrency
  // и загрузки пула, а не от сервиса.
  let ms = 0;
  let used = 0;

  while (true) {
    const before = used;
    const sent = await pool.send({ task, timeout, handleStart: () => handleStart(before) });
    const response = sent.response;
    ms = ms + sent.ms;

    if (response.kind === "result") {
      return {
        score: response.score,
        output: response.output,
        ms,
        retries: used,
      };
    }

    if (used < retries) {
      used = used + 1;
      continue;
    }

    return {
      error: describeResponse(response),
      ms,
      retries: used,
    };
  }
}

async function runCase({
  pool,
  plan,
  caseProps,
  options,
  reportStart,
  reportTrial,
}: {
  pool: Pool;
  plan: Plan;
  caseProps: CaseProps;
  options: RunOptions;
  reportStart: ReportStart;
  reportTrial: ReportTrial;
}): Promise<CaseRecord> {
  const task: Task = {
    kind: "run",
    file: plan.file,
    evalName: plan.eval.name,
    caseName: caseProps.name,
  };
  const timeout = options.timeout ?? caseProps.timeout ?? defaultTimeout;

  // Trials одного кейса уходят в пул одновременно: нагрузку всё равно
  // ограничивает число воркеров, а замеры друг от друга не зависят.
  // Promise.all отдаёт их в порядке запуска, а не завершения.
  const trials = await Promise.all(
    Array.from({ length: options.trials }, async (_, i) => {
      const record = await runTrial({
        pool,
        task,
        timeout,
        retries: options.retries,
        handleStart: (retries) =>
          reportStart({
            evalName: plan.eval.name,
            caseName: caseProps.name,
            trial: i + 1,
            retries,
          }),
      });

      reportTrial({
        evalName: plan.eval.name,
        caseName: caseProps.name,
        trial: i + 1,
        minScore: caseProps.minScore,
        record,
      });

      return record;
    }),
  );

  // Баллы не сворачиваются: кейс прошёл, только если прошёл каждый trial.
  const passed = trials.every((trial) => checkTrial(trial, caseProps.minScore));

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
    const { response } = await pool.send({ task: { kind: "list", file }, timeout });

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
  reportStart,
  reportTrial,
}: {
  pool: Pool;
  files: string[];
  options: RunOptions;
  reportStart: ReportStart;
  reportTrial: ReportTrial;
}): Promise<RunRecord> {
  const startedAt = Date.now();
  const listTimeout = options.timeout ?? defaultTimeout;
  const plans = await buildPlans({ pool, files, timeout: listTimeout });

  // Кейсы всех эвалов уходят в пул разом, одной очередью: параллельность
  // ограничивает только число воркеров. reportTrial зовётся по мере
  // готовности, поэтому trials разных кейсов и эвалов приходят вперемешку,
  // а в записи эвалы и кейсы лежат в порядке объявления — его держит Promise.all.
  // only действует на весь запуск: если хоть один кейс отобран через only,
  // все неотобранные не запускаются и пишутся пропущенными, как skip.
  let only = 0;

  for (const plan of plans) {
    for (const caseProps of plan.eval.cases) {
      if (pickMode(plan.eval, caseProps) === "only") {
        only = only + 1;
      }
    }
  }

  const evals = await Promise.all(
    plans.map(async (plan): Promise<EvalRecord> => {
      const cases = await Promise.all(
        plan.eval.cases.map((caseProps) => {
          const mode = pickMode(plan.eval, caseProps);

          if (mode === "skip" || (only > 0 && mode !== "only")) {
            return skipCase(caseProps);
          }

          return runCase({ pool, plan, caseProps, options, reportStart, reportTrial });
        }),
      );

      return {
        name: plan.eval.name,
        total: cases.length,
        passed: cases.filter((record) => record.passed).length,
        skipped: cases.filter((record) => record.skipped).length,
        cases,
      };
    }),
  );

  return {
    version: RECORD_VERSION,
    startedAt: new Date(startedAt).toISOString(),
    ms: Date.now() - startedAt,
    options: {
      trials: options.trials,
      retries: options.retries,
      timeout: options.timeout,
    },
    only: only > 0 ? only : undefined,
    evals,
  };
}

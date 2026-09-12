import { DEFAULT_TIMEOUT, RECORD_VERSION } from "./consts.ts";
import type { Pool } from "./pool/pool.ts";
import type {
  CaseRecord,
  ListedEval,
  ReportCase,
  RunOptions,
  RunRecord,
  TaskRequest,
  TrialRecord,
  WorkerResponse,
} from "./types.ts";

// Раннер решает, что запускать, и собирает записи прогонов. Он ничего не
// печатает и ничего не пишет на диск: строку по готовому кейсу отдаёт
// в reportCase, а записи возвращает наружу.

type Plan = {
  file: string;
  listed: ListedEval;
};

function describeResponse(response: WorkerResponse): TrialRecord["error"] {
  if (response.kind === "error") {
    return { name: response.name, message: response.message, stack: response.stack };
  }

  return { name: "Error", message: `неожиданный ответ воркера: ${response.kind}` };
}

// Среднее округляется до сотых: без этого в записи оседает мусор вроде
// 92.33333333333333, а он ничего не добавляет к смыслу балла.
function foldScores(trials: TrialRecord[]): number {
  let sum = 0;

  for (const trial of trials) {
    sum = sum + (trial.score ?? 0);
  }

  return Math.round((sum / trials.length) * 100) / 100;
}

async function runTrial(
  pool: Pool,
  request: TaskRequest,
  timeout: number,
  retries: number,
): Promise<TrialRecord> {
  const startedAt = Date.now();
  let used = 0;

  while (true) {
    const response = await pool.send(request, timeout);

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

    return { error: describeResponse(response), ms: Date.now() - startedAt, retries: used };
  }
}

async function runCase(
  pool: Pool,
  plan: Plan,
  listedCase: ListedEval["cases"][number],
  options: RunOptions,
): Promise<CaseRecord> {
  const request: TaskRequest = {
    kind: "run",
    file: plan.file,
    evalName: plan.listed.name,
    caseName: listedCase.name,
  };
  const timeout = options.timeout ?? listedCase.timeout ?? DEFAULT_TIMEOUT;
  const trials: TrialRecord[] = [];

  for (let i = 0; i < options.trials; i++) {
    trials.push(await runTrial(pool, request, timeout, options.retries));
  }

  const broken = trials.some((trial) => trial.error !== undefined);

  if (broken) {
    return { name: listedCase.name, minScore: listedCase.minScore, passed: false, trials };
  }

  const score = foldScores(trials);

  return {
    name: listedCase.name,
    minScore: listedCase.minScore,
    score,
    passed: score >= listedCase.minScore,
    trials,
  };
}

async function buildPlans(pool: Pool, files: string[], timeout: number): Promise<Plan[]> {
  const plans: Plan[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const response = await pool.send({ kind: "list", file }, timeout);

    if (response.kind !== "cases") {
      throw new Error(`${file}: ${describeResponse(response)?.message}`);
    }

    for (const listed of response.evals) {
      const already = seen.get(listed.name);

      if (already !== undefined) {
        throw new Error(`эвал "${listed.name}" объявлен дважды: ${already} и ${file}`);
      }

      seen.set(listed.name, file);
      plans.push({ file, listed });
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
}): Promise<RunRecord[]> {
  const listTimeout = options.timeout ?? DEFAULT_TIMEOUT;
  const plans = await buildPlans(pool, files, listTimeout);
  const records: RunRecord[] = [];

  for (const plan of plans) {
    const startedAt = Date.now();

    // Кейсы одного эвала уходят в пул все разом — очередь пула и есть
    // ограничение параллельности. Trials внутри кейса идут последовательно:
    // это замеры одного и того же, и растаскивать их по воркерам незачем.
    const cases = await Promise.all(
      plan.listed.cases.map(async (listedCase) => {
        const record = await runCase(pool, plan, listedCase, options);
        reportCase(plan.listed.name, record);

        return record;
      }),
    );

    records.push({
      version: RECORD_VERSION,
      eval: plan.listed.name,
      startedAt: new Date(startedAt).toISOString(),
      ms: Date.now() - startedAt,
      options: { trials: options.trials, retries: options.retries, timeout: options.timeout },
      total: cases.length,
      passed: cases.filter((record) => record.passed).length,
      cases,
    });
  }

  return records;
}

import { findEvals } from "../eval.ts";
import type {
  CaseResult,
  Eval,
  ListedEval,
  WorkerRequest,
  WorkerResponse,
} from "../types.ts";

// Сторона воркера. Всё, что бросил пользовательский код, ловится здесь
// и уезжает ответом: воркер не падает, он отчитывается.

declare const self: Worker;

let controller: AbortController | undefined;

function describeError(error: unknown): WorkerResponse {
  if (error instanceof Error) {
    return {
      kind: "error",
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { kind: "error", name: "Error", message: String(error) };
}

async function loadEvals(file: string): Promise<Eval[]> {
  const evals = findEvals((await import(file)) as Record<string, unknown>);

  if (evals.length === 0) {
    throw new Error(`в файле ${file} нет ни одного экспортированного эвала`);
  }

  return evals;
}

// Поля выбираются поимённо, а не отдаётся cases целиком: в EvalCase лежит
// run — функция, а функции structured clone не переносит, и postMessage
// упал бы DataCloneError на первом же list.
function listEvals(evals: Eval[]): ListedEval[] {
  return evals.map(({ name, cases }) => ({
    name,
    cases: cases.map(({ name, minScore, timeout }) => ({ name, minScore, timeout })),
  }));
}

function readScore(returned: unknown): number {
  const score =
    typeof returned === "number"
      ? returned
      : (returned as CaseResult | undefined)?.score;

  if (typeof score !== "number" || Number.isFinite(score) === false) {
    throw new Error(
      `кейс должен вернуть число 0..100 или { score }, получено ${JSON.stringify(returned)}`,
    );
  }

  if (score < 0 || score > 100) {
    throw new Error(`балл кейса ${score} вне шкалы 0..100`);
  }

  return score;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.kind === "abort") {
    controller?.abort();
    return;
  }

  try {
    const evals = await loadEvals(request.file);

    if (request.kind === "list") {
      self.postMessage({
        kind: "cases",
        evals: listEvals(evals),
      } satisfies WorkerResponse);
      return;
    }

    const evalCase = evals
      .find((item) => item.name === request.evalName)
      ?.cases.find((item) => item.name === request.caseName);

    if (evalCase === undefined) {
      throw new Error(
        `кейс "${request.caseName}" не найден в эвале "${request.evalName}"`,
      );
    }

    controller = new AbortController();
    const returned = await evalCase.run(controller.signal);
    const output = typeof returned === "object" ? returned.output : undefined;

    self.postMessage({
      kind: "result",
      score: readScore(returned),
      output,
    } satisfies WorkerResponse);
  } catch (error) {
    self.postMessage(describeError(error));
  } finally {
    controller = undefined;
  }
};

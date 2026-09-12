import { INSTANCE_KEY, INSTANCE_VALUE } from "./consts.ts";
import { type Eval, type EvalCase, type EvalCtx } from "./types.ts";

function checkPathSegment(name: string): boolean {
  if (name === "") {
    return false;
  }

  if (name.includes("/") || name.includes("\\")) {
    return false;
  }

  if (name === "." || name === "..") {
    return false;
  }

  return true;
}

export function createEval(name: string, fill: (ctx: EvalCtx) => void): Eval {
  if (checkPathSegment(name) === false) {
    throw new Error(`имя эвала "${name}" не годится в имя папки внутри .eeval`);
  }

  const cases: EvalCase[] = [];
  const taken = new Set<string>();

  const ctx: EvalCtx = {
    createCase: (options, run) => {
      if (options.name === "") {
        throw new Error(`в эвале "${name}" кейс без имени: имя это ключ истории`);
      }

      if (taken.has(options.name)) {
        throw new Error(`в эвале "${name}" кейс "${options.name}" объявлен дважды`);
      }

      taken.add(options.name);
      cases.push({
        name: options.name,
        minScore: options.minScore,
        timeout: options.timeout,
        run,
      });
    },
  };

  fill(ctx);

  return { [INSTANCE_KEY]: INSTANCE_VALUE, name, cases };
}

export function checkEval(mayEval: unknown): mayEval is Eval {
  if (
    mayEval &&
    typeof mayEval === "object" &&
    INSTANCE_KEY in mayEval &&
    (mayEval as Record<string, unknown>)[INSTANCE_KEY] === INSTANCE_VALUE
  ) {
    return true;
  }

  return false;
}

export function findEvals(module: Record<string, unknown>): Eval[] {
  const found: Eval[] = [];

  for (const key in module) {
    const exported = module[key];
    if (checkEval(exported)) {
      found.push(exported);
    }
  }

  return found;
}

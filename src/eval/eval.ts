import { INSTANCE_KEY, INSTANCE_VALUE } from "../consts.ts";

export type CaseResult = {
  score: number;
  output?: unknown;
};

export type Case = (signal: AbortSignal) => Promise<number | CaseResult>;

export type CaseProps = {
  name: string;
  minScore: number;
  timeout?: number;
};

export type CaseEnt = {
  name: string;
  minScore: number;
  timeout?: number;
  run: Case;
};

export type EvalCtx = {
  createCase: (props: CaseProps, run: Case) => void;
};

export type Eval = (ctx: EvalCtx) => void;

export type EvalEnt = {
  [INSTANCE_KEY]: typeof INSTANCE_VALUE;
  name: string;
  cases: CaseEnt[];
};

export function createEval(name: string, fill: Eval): EvalEnt {
  if (name === "") {
    throw new Error("эвал без имени: имя это ключ истории");
  }

  const cases: CaseEnt[] = [];
  const taken = new Set<string>();

  const ctx: EvalCtx = {
    createCase: (props, run) => {
      if (props.name === "") {
        throw new Error(`в эвале "${name}" кейс без имени: имя это ключ истории`);
      }

      if (taken.has(props.name)) {
        throw new Error(`в эвале "${name}" кейс "${props.name}" объявлен дважды`);
      }

      taken.add(props.name);
      cases.push({
        name: props.name,
        minScore: props.minScore,
        timeout: props.timeout,
        run,
      });
    },
  };

  fill(ctx);

  return { [INSTANCE_KEY]: INSTANCE_VALUE, name, cases };
}

export function checkEval(mayEval: unknown): mayEval is EvalEnt {
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

export function findEvals(module: Record<string, unknown>): EvalEnt[] {
  const found: EvalEnt[] = [];

  for (const key in module) {
    const exported = module[key];
    if (checkEval(exported)) {
      found.push(exported);
    }
  }

  return found;
}

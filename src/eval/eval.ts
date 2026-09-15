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
  only?: boolean;
  skip?: boolean;
};

export type CaseEnt = {
  name: string;
  minScore: number;
  timeout?: number;
  only?: boolean;
  skip?: boolean;
  run: Case;
};

export type EvalOptions = {
  only?: boolean;
  skip?: boolean;
};

export type EvalCtx = {
  createCase: (props: CaseProps, run: Case) => void;
};

export type Eval = (ctx: EvalCtx) => void;

export type EvalEnt = {
  [INSTANCE_KEY]: typeof INSTANCE_VALUE;
  name: string;
  only?: boolean;
  skip?: boolean;
  cases: CaseEnt[];
};

// Опции — необязательный второй аргумент, поэтому функция кейсов приходит
// либо вторым, либо третьим. Различаются по typeof: опции — объект, fill — функция.
export function createEval(name: string, fill: Eval): EvalEnt;
export function createEval(name: string, options: EvalOptions, fill: Eval): EvalEnt;
export function createEval(
  name: string,
  optionsOrFill: EvalOptions | Eval,
  mayFill?: Eval,
): EvalEnt {
  const options = typeof optionsOrFill === "function" ? {} : optionsOrFill;
  const fill = typeof optionsOrFill === "function" ? optionsOrFill : mayFill;

  if (name === "") {
    throw new Error("эвал без имени: имя это ключ истории");
  }

  if (fill === undefined) {
    throw new Error(`эвал "${name}" без функции, объявляющей кейсы`);
  }

  if (options.only && options.skip) {
    throw new Error(`эвал "${name}" помечен и only, и skip`);
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

      if (props.only && props.skip) {
        throw new Error(`в эвале "${name}" кейс "${props.name}" помечен и only, и skip`);
      }

      taken.add(props.name);
      cases.push({
        name: props.name,
        minScore: props.minScore,
        timeout: props.timeout,
        only: props.only,
        skip: props.skip,
        run,
      });
    },
  };

  fill(ctx);

  return {
    [INSTANCE_KEY]: INSTANCE_VALUE,
    name,
    only: options.only,
    skip: options.skip,
    cases,
  };
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

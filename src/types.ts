import { INSTANCE_KEY, INSTANCE_VALUE } from "./consts.ts";

export type CaseResult = {
  score: number;
  output?: unknown;
};

export type CaseRun = (signal: AbortSignal) => Promise<number | CaseResult>;

export type CaseOptions = {
  name: string;
  minScore: number;
  timeout?: number;
};

export type EvalCase = {
  name: string;
  minScore: number;
  timeout?: number;
  run: CaseRun;
};

export type Eval = {
  [INSTANCE_KEY]: typeof INSTANCE_VALUE;
  name: string;
  cases: EvalCase[];
};

export type EvalCtx = {
  createCase: (options: CaseOptions, run: CaseRun) => void;
};

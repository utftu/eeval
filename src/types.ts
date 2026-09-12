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

export type ListedEval = {
  name: string;
  cases: { name: string; minScore: number; timeout?: number }[];
};

export type TaskRequest =
  | { kind: "list"; file: string }
  | { kind: "run"; file: string; evalName: string; caseName: string };

export type WorkerRequest = TaskRequest | { kind: "abort" };

export type WorkerResponse =
  | { kind: "cases"; evals: ListedEval[] }
  | { kind: "result"; score: number; output?: unknown }
  | { kind: "error"; name: string; message: string; stack?: string };

export type TrialRecord = {
  score?: number;
  output?: unknown;
  error?: { name: string; message: string; stack?: string };
  ms: number;
  retries: number;
};

export type CaseRecord = {
  name: string;
  minScore: number;
  score?: number;
  passed: boolean;
  trials: TrialRecord[];
};

export type RunRecord = {
  version: number;
  eval: string;
  startedAt: string;
  ms: number;
  options: { trials: number; retries: number; timeout?: number };
  total: number;
  passed: number;
  cases: CaseRecord[];
};

export type RunOptions = {
  trials: number;
  retries: number;
  timeout?: number;
};

export type ReportCase = (evalName: string, record: CaseRecord) => void;

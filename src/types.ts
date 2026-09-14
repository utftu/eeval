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
  passed: boolean;
  trials: TrialRecord[];
};

export type EvalRecord = {
  name: string;
  total: number;
  passed: number;
  cases: CaseRecord[];
};

export type RunRecord = {
  version: number;
  startedAt: string;
  ms: number;
  options: { trials: number; retries: number; timeout?: number };
  evals: EvalRecord[];
};

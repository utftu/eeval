export type TrialRecord = {
  score?: number;
  output?: unknown;
  error?: { name: string; message: string; stack?: string };
  ms: number;
  retries: number;
};

// skipped пишется только у пропущенного кейса: у него passed false и пустые trials.
export type CaseRecord = {
  name: string;
  minScore: number;
  passed: boolean;
  skipped?: boolean;
  trials: TrialRecord[];
};

// total — все кейсы эвала, включая пропущенные; failed = total - passed - skipped.
export type EvalRecord = {
  name: string;
  total: number;
  passed: number;
  skipped: number;
  cases: CaseRecord[];
};

// only — сколько кейсов отобрано через only; пишется, только если only был в запуске.
export type RunRecord = {
  version: number;
  startedAt: string;
  ms: number;
  options: { trials: number; retries: number; timeout?: number };
  only?: number;
  evals: EvalRecord[];
};

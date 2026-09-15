import type { CaseProps } from "../eval/eval.ts";
export type EvalConfig = {
    name: string;
    cases: CaseProps[];
};
export type Task = {
    kind: "list";
    file: string;
} | {
    kind: "run";
    file: string;
    evalName: string;
    caseName: string;
};
export type JobResponse = {
    kind: "cases";
    evals: EvalConfig[];
} | {
    kind: "result";
    score: number;
    output?: unknown;
} | {
    kind: "error";
    name: string;
    message: string;
    stack?: string;
};

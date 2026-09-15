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
export declare function createEval(name: string, fill: Eval): EvalEnt;
export declare function checkEval(mayEval: unknown): mayEval is EvalEnt;
export declare function findEvals(module: Record<string, unknown>): EvalEnt[];

import type { Pool } from "../pool/pool.ts";
import type { RunRecord, TrialRecord } from "../types.ts";
export type RunOptions = {
    trials: number;
    retries: number;
    timeout?: number;
};
export type TrialReport = {
    evalName: string;
    caseName: string;
    trial: number;
    minScore: number;
    record: TrialRecord;
};
export type ReportTrial = (report: TrialReport) => void;
export declare function checkTrial(record: TrialRecord, minScore: number): boolean;
export declare function runEvals({ pool, files, options, reportTrial, }: {
    pool: Pool;
    files: string[];
    options: RunOptions;
    reportTrial: ReportTrial;
}): Promise<RunRecord>;

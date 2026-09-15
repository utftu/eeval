import { type TrialReport } from "../runner/runner.ts";
import type { RunRecord } from "../types.ts";
export declare function formatTrialLine(report: TrialReport, color: boolean): string;
export declare function formatReport(record: RunRecord, color: boolean): string;

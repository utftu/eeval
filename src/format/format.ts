import type { CaseRecord, EvalRecord, TrialRecord } from "../types.ts";

// Чистые функции вывода: раннер их не зовёт, печатает CLI.

function formatMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTrials(trials: TrialRecord[]): string {
  const parts = trials.map((trial) => (trial.score === undefined ? "err" : String(trial.score)));

  return parts.join("/");
}

function findError(trials: TrialRecord[]): string {
  for (const trial of trials) {
    if (trial.error !== undefined) {
      return `${trial.error.name}: ${trial.error.message}`;
    }
  }

  return "";
}

export function formatCaseLine(record: CaseRecord): string {
  const status = record.passed ? "ok  " : "fail";
  const spent = formatMs(record.trials.reduce((sum, trial) => sum + trial.ms, 0));
  const line = `  ${status}  ${record.name.padEnd(36)} ${formatTrials(record.trials).padEnd(14)} ${spent}`;

  if (record.passed) {
    return line;
  }

  const reason = findError(record.trials);

  if (reason === "") {
    return `${line}  ниже порога ${record.minScore}`;
  }

  return `${line}  ${reason}`;
}

export function formatSummary(record: EvalRecord): string {
  const failed = record.total - record.passed;

  return `  всего ${record.total}, прошло ${record.passed}, упало ${failed}, ${formatMs(record.ms)}`;
}

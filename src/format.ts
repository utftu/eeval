import type { CaseRecord, RunRecord, TrialRecord } from "./types.ts";

// Чистые функции вывода: раннер их не зовёт, печатает CLI.

function formatMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

// Разброс показывается всегда, потому что гейтит среднее, а среднее его прячет:
// 100/100/10 и 70/70/70 дают одинаковые 70.
function formatTrials(trials: TrialRecord[]): string {
  const parts = trials.map((trial) => (trial.score === undefined ? "err" : String(trial.score)));

  return `(${parts.join("/")})`;
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
  const score = record.score === undefined ? "--" : String(record.score);
  const spent = formatMs(record.trials.reduce((sum, trial) => sum + trial.ms, 0));
  const line = `  ${status}  ${record.name.padEnd(36)} ${score.padStart(6)}  ${formatTrials(record.trials).padEnd(14)} ${spent}`;

  if (record.passed) {
    return line;
  }

  const reason = findError(record.trials);

  if (reason === "") {
    return `${line}  ниже порога ${record.minScore}`;
  }

  return `${line}  ${reason}`;
}

export function formatSummary(record: RunRecord): string {
  const failed = record.total - record.passed;

  return `  всего ${record.total}, прошло ${record.passed}, упало ${failed}, ${formatMs(record.ms)}`;
}

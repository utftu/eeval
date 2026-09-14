import { checkTrial, type TrialReport } from "../runner/runner.ts";
import type { RunRecord, TrialRecord } from "../types.ts";

// Чистые функции вывода: раннер их не зовёт, печатает CLI. Красить ли, решает
// тот, кто печатает: функции получают только флаг.

type Palette = {
  ok: string;
  fail: string;
  key: string;
  reset: string;
};

type Field = [key: string, value: string];

const COLORED: Palette = {
  ok: "\x1b[32m",
  fail: "\x1b[31m",
  key: "\x1b[34m",
  reset: "\x1b[0m",
};

const PLAIN: Palette = { ok: "", fail: "", key: "", reset: "" };

const OUTPUT_LIMIT = 200;
const STATUS_WIDTH = 4;

function formatMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

// Значение с пробелом, кавычкой или знаком равенства берётся в кавычки:
// иначе строку не разобрать обратно на ключи.
function formatValue(value: string): string {
  if (value === "" || value.includes(" ") || value.includes('"') || value.includes("=")) {
    return JSON.stringify(value);
  }

  return value;
}

// Ответ модели бывает на килобайты и забил бы терминал одной строкой.
// Полный output лежит в latest.json.
function formatOutput(output: unknown): string {
  const text = JSON.stringify(output) ?? String(output);

  if (text.length <= OUTPUT_LIMIT) {
    return text;
  }

  return `${text.slice(0, OUTPUT_LIMIT)}…`;
}

function renderStatus(passed: boolean, palette: Palette): string {
  if (passed) {
    return `${palette.ok}ok${palette.reset}`;
  }

  return `${palette.fail}fail${palette.reset}`;
}

// Ширина считается по слову без цвета: escape-коды места в терминале не занимают.
function padStatus(passed: boolean, palette: Palette): string {
  const word = passed ? "ok" : "fail";

  return `${renderStatus(passed, palette)}${" ".repeat(STATUS_WIDTH - word.length)}`;
}

function renderFields(fields: Field[], palette: Palette): string {
  return fields.map(([key, value]) => `${palette.key}${key}=${palette.reset}${value}`).join(" ");
}

function collectTrialFields(record: TrialRecord, minScore: number): Field[] {
  const fields: Field[] = [];

  if (record.score !== undefined) {
    fields.push(["score", String(record.score)]);
  }

  if (record.score !== undefined && checkTrial(record, minScore) === false) {
    fields.push(["minScore", String(minScore)]);
  }

  fields.push(["time", formatMs(record.ms)]);

  if (record.retries > 0) {
    fields.push(["retries", String(record.retries)]);
  }

  if (record.output !== undefined) {
    fields.push(["output", formatOutput(record.output)]);
  }

  if (record.error !== undefined) {
    fields.push(["error", formatValue(`${record.error.name}: ${record.error.message}`)]);
  }

  return fields;
}

export function formatTrialLine(report: TrialReport, color: boolean): string {
  const palette = color ? COLORED : PLAIN;
  const passed = checkTrial(report.record, report.minScore);
  const fields: Field[] = [
    ["eval", formatValue(report.evalName)],
    ["case", formatValue(report.caseName)],
    ["trial", String(report.trial)],
    ...collectTrialFields(report.record, report.minScore),
  ];

  return `${padStatus(passed, palette)} ${renderFields(fields, palette)}`;
}

export function formatReport(record: RunRecord, color: boolean): string {
  const palette = color ? COLORED : PLAIN;
  const lines: string[] = [];
  let total = 0;
  let passed = 0;

  for (const evalRecord of record.evals) {
    lines.push(
      renderFields(
        [
          ["eval", formatValue(evalRecord.name)],
          ["total", String(evalRecord.total)],
          ["passed", String(evalRecord.passed)],
          ["failed", String(evalRecord.total - evalRecord.passed)],
        ],
        palette,
      ),
    );
    total = total + evalRecord.total;
    passed = passed + evalRecord.passed;

    for (const caseRecord of evalRecord.cases) {
      const caseField = renderFields([["case", formatValue(caseRecord.name)]], palette);

      lines.push(`  ${caseField} ${renderStatus(caseRecord.passed, palette)}`);

      for (let i = 0; i < caseRecord.trials.length; i++) {
        const trial = caseRecord.trials[i]!;
        const trialField = renderFields([["trial", String(i + 1)]], palette);
        const status = renderStatus(checkTrial(trial, caseRecord.minScore), palette);
        const fields = renderFields(collectTrialFields(trial, caseRecord.minScore), palette);

        lines.push(`    ${trialField} ${status} ${fields}`);
      }
    }
  }

  lines.push(
    renderFields(
      [
        ["total", String(total)],
        ["passed", String(passed)],
        ["failed", String(total - passed)],
        ["time", formatMs(record.ms)],
      ],
      palette,
    ),
  );

  return lines.join("\n");
}

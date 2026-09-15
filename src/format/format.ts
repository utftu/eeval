import { checkTrial, type StartReport, type TrialReport } from "../runner/runner.ts";
import type { RunRecord, TrialRecord } from "../types.ts";

// Чистые функции вывода: раннер их не зовёт, печатает CLI. Красить ли, решает
// тот, кто печатает: функции получают только флаг.

type Palette = {
  ok: string;
  fail: string;
  key: string;
  head: string;
  reset: string;
};

type Field = [key: string, value: string];

// head — оранжевый из 256 цветов: у базовых восьми оранжевого нет.
const COLORED: Palette = {
  ok: "\x1b[32m",
  fail: "\x1b[31m",
  key: "\x1b[34m",
  head: "\x1b[38;5;208m",
  reset: "\x1b[0m",
};

const PLAIN: Palette = { ok: "", fail: "", key: "", head: "", reset: "" };

const outputLimit = 200;
// По самому длинному статусу — start.
const statusWidth = 5;

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

  if (text.length <= outputLimit) {
    return text;
  }

  return `${text.slice(0, outputLimit)}…`;
}

function renderStatus(passed: boolean, palette: Palette): string {
  if (passed) {
    return `${palette.ok}ok${palette.reset}`;
  }

  return `${palette.fail}fail${palette.reset}`;
}

// Ширина считается по слову без цвета: escape-коды места в терминале не занимают.
function padStatus(word: string, rendered: string): string {
  return `${rendered}${" ".repeat(statusWidth - word.length)}`;
}

function renderFields(fields: Field[], palette: Palette): string {
  return fields.map(([key, value]) => `${palette.key}${key}=${palette.reset}${value}`).join(" ");
}

// Первое поле строки итога — eval, case или trial — выделено цветом, чтобы
// уровни дерева читались глазами.
function renderHead([key, value]: Field, palette: Palette): string {
  return `${palette.head}${key}=${palette.reset}${value}`;
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

export function formatStartLine(report: StartReport, color: boolean): string {
  const palette = color ? COLORED : PLAIN;
  const fields: Field[] = [
    ["eval", formatValue(report.evalName)],
    ["case", formatValue(report.caseName)],
    ["trial", String(report.trial)],
  ];

  if (report.retries > 0) {
    fields.push(["retries", String(report.retries)]);
  }

  return `${padStatus("start", "start")} ${renderFields(fields, palette)}`;
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
  const status = padStatus(passed ? "ok" : "fail", renderStatus(passed, palette));

  return `${status} ${renderFields(fields, palette)}`;
}

export function formatReport(record: RunRecord, color: boolean): string {
  const palette = color ? COLORED : PLAIN;
  const lines: string[] = [];
  let total = 0;
  let passed = 0;
  let skipped = 0;

  for (const evalRecord of record.evals) {
    const evalField = renderHead(["eval", formatValue(evalRecord.name)], palette);
    // skipped= печатается, только когда пропущенные есть: обычный итог не меняется.
    const counters: Field[] = [
      ["total", String(evalRecord.total)],
      ["passed", String(evalRecord.passed)],
      ["failed", String(evalRecord.total - evalRecord.passed - evalRecord.skipped)],
    ];

    if (evalRecord.skipped > 0) {
      counters.push(["skipped", String(evalRecord.skipped)]);
    }

    lines.push(`${evalField} ${renderFields(counters, palette)}`);
    total = total + evalRecord.total;
    passed = passed + evalRecord.passed;
    skipped = skipped + evalRecord.skipped;

    // У пропущенного кейса trials пустые, поэтому строк trial под ним нет.
    for (const caseRecord of evalRecord.cases) {
      const caseField = renderHead(["case", formatValue(caseRecord.name)], palette);
      const caseStatus = caseRecord.skipped ? "skip" : renderStatus(caseRecord.passed, palette);

      lines.push(`  ${caseField} ${caseStatus}`);

      for (let i = 0; i < caseRecord.trials.length; i++) {
        const trial = caseRecord.trials[i]!;
        const trialField = renderHead(["trial", String(i + 1)], palette);
        const status = renderStatus(checkTrial(trial, caseRecord.minScore), palette);
        const fields = renderFields(collectTrialFields(trial, caseRecord.minScore), palette);

        lines.push(`    ${trialField} ${status} ${fields}`);
      }
    }
  }

  // only= напоминает, что прогон неполный: забытый only в CI иначе не заметить.
  const summary: Field[] = [
    ["total", String(total)],
    ["passed", String(passed)],
    ["failed", String(total - passed - skipped)],
  ];

  if (skipped > 0) {
    summary.push(["skipped", String(skipped)]);
  }

  if (record.only !== undefined) {
    summary.push(["only", String(record.only)]);
  }

  summary.push(["time", formatMs(record.ms)]);
  lines.push(renderFields(summary, palette));

  return lines.join("\n");
}

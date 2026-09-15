import { expect, test } from "bun:test";

import type { RunRecord } from "../types.ts";
import { formatReport, formatStartLine, formatTrialLine } from "./format.ts";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BLUE = "\x1b[34m";
const ORANGE = "\x1b[38;5;208m";
const RESET = "\x1b[0m";

test("строка начала trial: эвал, кейс, номер, retries только при повторе", () => {
  expect(formatStartLine({ evalName: "failures", caseName: "ниже порога", trial: 1, retries: 0 }, false)).toBe(
    'start eval=failures case="ниже порога" trial=1',
  );
  expect(formatStartLine({ evalName: "e", caseName: "c", trial: 2, retries: 1 }, false)).toBe(
    "start eval=e case=c trial=2 retries=1",
  );
});

test("строка trial: статус, эвал, кейс в кавычках, номер, балл, время и output", () => {
  const line = formatTrialLine(
    {
      evalName: "return-decision",
      caseName: "брак с фото",
      trial: 2,
      minScore: 80,
      record: { score: 94, ms: 1800, retries: 0, output: { verdict: "refund" } },
    },
    false,
  );

  expect(line).toBe(
    'ok    eval=return-decision case="брак с фото" trial=2 score=94 time=1.8s output={"verdict":"refund"}',
  );
});

test("trial ниже порога показывает порог", () => {
  const line = formatTrialLine(
    {
      evalName: "e",
      caseName: "передумал",
      trial: 1,
      minScore: 80,
      record: { score: 61, ms: 400, retries: 0 },
    },
    false,
  );

  expect(line).toBe("fail  eval=e case=передумал trial=1 score=61 minScore=80 time=400ms");
});

test("упавший trial показывает retries и ошибку, но не порог", () => {
  const line = formatTrialLine(
    {
      evalName: "e",
      caseName: "c",
      trial: 1,
      minScore: 80,
      record: {
        error: { name: "TimeoutError", message: "не уложился" },
        ms: 60000,
        retries: 2,
      },
    },
    false,
  );

  expect(line).toBe('fail  eval=e case=c trial=1 time=60.0s retries=2 error="TimeoutError: не уложился"');
});

test("длинный output обрезается", () => {
  const line = formatTrialLine(
    {
      evalName: "e",
      caseName: "c",
      trial: 1,
      minScore: 0,
      record: { score: 50, ms: 10, retries: 0, output: "x".repeat(500) },
    },
    false,
  );

  expect(line.endsWith("…")).toBe(true);
  expect(line.length).toBeLessThan(300);
});

test("с цветом: ok зелёный, fail красный, имена полей синие", () => {
  const failed = formatTrialLine(
    {
      evalName: "e",
      caseName: "c",
      trial: 1,
      minScore: 80,
      record: { score: 61, ms: 400, retries: 0 },
    },
    true,
  );

  expect(failed).toBe(
    `${RED}fail${RESET}  ${BLUE}eval=${RESET}e ${BLUE}case=${RESET}c ${BLUE}trial=${RESET}1 ` +
      `${BLUE}score=${RESET}61 ${BLUE}minScore=${RESET}80 ${BLUE}time=${RESET}400ms`,
  );

  const passed = formatTrialLine(
    {
      evalName: "e",
      caseName: "c",
      trial: 1,
      minScore: 80,
      record: { score: 90, ms: 400, retries: 0 },
    },
    true,
  );

  expect(passed.startsWith(`${GREEN}ok${RESET}    ${BLUE}eval=`)).toBe(true);
});

test("итог — дерево эвал, кейс, trial и общая строка", () => {
  const record: RunRecord = {
    version: 1,
    startedAt: "2026-09-12T13:40:11.204Z",
    ms: 64600,
    options: { trials: 2, retries: 1 },
    evals: [
      {
        name: "return-decision",
        total: 2,
        passed: 1,
        cases: [
          {
            name: "брак с фото",
            minScore: 80,
            passed: true,
            trials: [
              { score: 94, ms: 1800, retries: 0 },
              { score: 91, ms: 1900, retries: 1 },
            ],
          },
          {
            name: "передумал",
            minScore: 80,
            passed: false,
            trials: [{ score: 61, ms: 400, retries: 0 }],
          },
        ],
      },
    ],
  };

  expect(formatReport(record, false)).toBe(
    [
      "eval=return-decision total=2 passed=1 failed=1",
      '  case="брак с фото" ok',
      "    trial=1 ok score=94 time=1.8s",
      "    trial=2 ok score=91 time=1.9s retries=1",
      "  case=передумал fail",
      "    trial=1 fail score=61 minScore=80 time=400ms",
      "total=2 passed=1 failed=1 time=64.6s",
    ].join("\n"),
  );

  const colored = formatReport(record, true);

  expect(colored).toContain(`  ${ORANGE}case=${RESET}передумал ${RED}fail${RESET}`);
  expect(colored).toContain(`    ${ORANGE}trial=${RESET}1 ${GREEN}ok${RESET} ${BLUE}score=${RESET}94`);
});

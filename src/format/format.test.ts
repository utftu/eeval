import { expect, test } from "bun:test";

import { formatCaseLine, formatSummary } from "./format.ts";
import type { CaseRecord, EvalRecord } from "../types.ts";

test("прошедший кейс показывает балл каждого trial", () => {
  const record: CaseRecord = {
    name: "брак с фото",
    minScore: 80,
    passed: true,
    trials: [
      { score: 94, ms: 1000, retries: 0 },
      { score: 91, ms: 1000, retries: 0 },
      { score: 91, ms: 500, retries: 0 },
    ],
  };

  const line = formatCaseLine(record);

  expect(line).toContain("ok");
  expect(line).toContain("брак с фото");
  expect(line).toContain("94/91/91");
  expect(line).toContain("2.5s");
});

test("кейс ниже порога называет порог, а не ошибку", () => {
  const record: CaseRecord = {
    name: "передумал",
    minScore: 80,
    passed: false,
    trials: [{ score: 61, ms: 120, retries: 0 }],
  };

  const line = formatCaseLine(record);

  expect(line).toContain("fail");
  expect(line).toContain("ниже порога 80");
  expect(line).toContain("120ms");
});

test("упавший кейс показывает ошибку", () => {
  const record: CaseRecord = {
    name: "брак без фото",
    minScore: 60,
    passed: false,
    trials: [
      { score: 71, ms: 100, retries: 0 },
      { error: { name: "TimeoutError", message: "не уложился" }, ms: 900, retries: 2 },
    ],
  };

  const line = formatCaseLine(record);

  expect(line).toContain("71/err");
  expect(line).toContain("TimeoutError: не уложился");
});

test("итог считает прошедшие и упавшие", () => {
  const record: EvalRecord = {
    name: "return-decision",
    ms: 48210,
    total: 4,
    passed: 3,
    cases: [],
  };

  expect(formatSummary(record)).toBe("  всего 4, прошло 3, упало 1, 48.2s");
});

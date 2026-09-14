import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeRecord } from "./storage.ts";
import type { EvalRecord, RunRecord } from "../types.ts";

const root = await mkdtemp(join(tmpdir(), "eeval-storage-"));

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function createEvalRecord(name: string, score: number): EvalRecord {
  return {
    name,
    ms: 100,
    total: 1,
    passed: 1,
    cases: [
      {
        name: "брак с фото",
        minScore: 80,
        passed: true,
        trials: [{ score, ms: 100, retries: 0, output: { verdict: "refund" } }],
      },
    ],
  };
}

function createRecord(score: number): RunRecord {
  return {
    version: 1,
    startedAt: new Date(score).toISOString(),
    ms: 200,
    options: { trials: 1, retries: 0 },
    evals: [createEvalRecord("return-decision", score), createEvalRecord("summary", score)],
  };
}

test("одна строка на запуск, output только в latest", async () => {
  const base = join(root, "первый");
  await writeRecord(base, createRecord(91));

  const history = await Bun.file(join(base, "history.jsonl")).text();
  const latest = await Bun.file(join(base, "latest.json")).json();

  expect(history.trim().split("\n")).toHaveLength(1);
  expect(history).not.toContain("output");
  expect(history).not.toContain("refund");
  expect(JSON.parse(history).evals.map((item: EvalRecord) => item.name)).toEqual([
    "return-decision",
    "summary",
  ]);

  expect(latest).toHaveLength(1);
  expect(latest[0].evals[0].cases[0].trials[0].output).toEqual({ verdict: "refund" });
});

test("история копится, latest держит три последних запуска новым сверху", async () => {
  const base = join(root, "второй");

  for (const score of [10, 20, 30, 40]) {
    await writeRecord(base, createRecord(score));
  }

  const history = await Bun.file(join(base, "history.jsonl")).text();
  const latest = await Bun.file(join(base, "latest.json")).json();

  expect(history.trim().split("\n")).toHaveLength(4);
  expect(latest).toHaveLength(3);
  expect(
    latest.map((item: RunRecord) => item.evals[0]?.cases[0]?.trials[0]?.score),
  ).toEqual([40, 30, 20]);
});

test("latest.json остаётся читаемым человеком", async () => {
  const base = join(root, "третий");
  await writeRecord(base, createRecord(77));

  const text = await Bun.file(join(base, "latest.json")).text();

  expect(text).toContain('[\n  {\n    "version": 1');
});

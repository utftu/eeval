import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeRecord } from "./storage.ts";
import type { RunRecord } from "./types.ts";

const root = await mkdtemp(join(tmpdir(), "eeval-storage-"));

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function createRecord(score: number): RunRecord {
  return {
    version: 1,
    eval: "return-decision",
    startedAt: new Date(score).toISOString(),
    ms: 100,
    options: { trials: 1, retries: 0 },
    total: 1,
    passed: 1,
    cases: [
      {
        name: "брак с фото",
        minScore: 80,
        score,
        passed: true,
        trials: [{ score, ms: 100, retries: 0, output: { verdict: "refund" } }],
      },
    ],
  };
}

test("пишет обе файла, output только в latest", async () => {
  const base = join(root, "первый");
  await writeRecord(base, createRecord(91));

  const history = await Bun.file(join(base, "return-decision", "history.jsonl")).text();
  const latest = await Bun.file(join(base, "return-decision", "latest.json")).json();

  expect(history.trim().split("\n")).toHaveLength(1);
  expect(history).not.toContain("output");
  expect(history).not.toContain("refund");
  expect(JSON.parse(history).cases[0].trials[0].score).toBe(91);

  expect(latest).toHaveLength(1);
  expect(latest[0].cases[0].trials[0].output).toEqual({ verdict: "refund" });
});

test("история копится, latest держит три последних новым сверху", async () => {
  const base = join(root, "второй");

  for (const score of [10, 20, 30, 40]) {
    await writeRecord(base, createRecord(score));
  }

  const history = await Bun.file(join(base, "return-decision", "history.jsonl")).text();
  const latest = await Bun.file(join(base, "return-decision", "latest.json")).json();

  expect(history.trim().split("\n")).toHaveLength(4);
  expect(latest).toHaveLength(3);
  expect(latest.map((item: RunRecord) => item.cases[0]?.score)).toEqual([40, 30, 20]);
});

test("latest.json остаётся читаемым человеком", async () => {
  const base = join(root, "третий");
  await writeRecord(base, createRecord(77));

  const text = await Bun.file(join(base, "return-decision", "latest.json")).text();

  expect(text).toContain('\n  {\n    "version": 1');
});

import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Pool } from "./pool/pool.ts";
import { runEvals } from "./runner.ts";
import type { CaseRecord, RunOptions } from "./types.ts";

const root = await mkdtemp(join(tmpdir(), "eeval-runner-"));
const entry = join(import.meta.dir, "eeval.ts");
let counter = 0;

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeEval(body: string): Promise<string> {
  counter = counter + 1;
  const file = join(root, `probe-${counter}.eval.ts`);
  await Bun.write(file, `import { createEval } from ${JSON.stringify(entry)};\n\n${body}\n`);

  return file;
}

const base: RunOptions = { trials: 1, retries: 0 };

async function run(files: string[], options: RunOptions, size = 1) {
  const pool = new Pool(size);
  const reported: { evalName: string; record: CaseRecord }[] = [];

  try {
    const records = await runEvals({
      pool,
      files,
      options,
      reportCase: (evalName, record) => reported.push({ evalName, record }),
    });

    return { records, reported };
  } finally {
    pool.close();
  }
}

test("запись прогона собирается целиком", async () => {
  const file = await writeEval(`
export const ev = createEval("return-decision", (ctx) => {
  ctx.createCase({ name: "прошёл", minScore: 80 }, async () => 92);
  ctx.createCase({ name: "не дотянул", minScore: 80 }, async () => 61);
});
`);

  const { records, reported } = await run([file], base);

  expect(records).toHaveLength(1);
  const record = records[0]!;

  expect(record.version).toBe(1);
  expect(record.eval).toBe("return-decision");
  expect(record.total).toBe(2);
  expect(record.passed).toBe(1);
  expect(record.options).toEqual({ trials: 1, retries: 0, timeout: undefined });
  expect(new Date(record.startedAt).getTime()).toBeGreaterThan(0);

  expect(record.cases.map((item) => [item.name, item.score, item.passed])).toEqual([
    ["прошёл", 92, true],
    ["не дотянул", 61, false],
  ]);

  expect(reported).toHaveLength(2);
  expect(reported[0]?.evalName).toBe("return-decision");
});

test("trials сворачиваются средним и все попытки сохраняются", async () => {
  const file = await writeEval(`
let call = 0;

export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 75 }, async () => {
    call = call + 1;
    return [90, 60, 90][call - 1] ?? 0;
  });
});
`);

  const { records } = await run([file], { trials: 3, retries: 0 });
  const record = records[0]!.cases[0]!;

  expect(record.trials.map((trial) => trial.score)).toEqual([90, 60, 90]);
  expect(record.score).toBe(80);
  expect(record.passed).toBe(true);
});

test("упавший trial валит кейс целиком, среднее по выжившим не считается", async () => {
  const file = await writeEval(`
let call = 0;

export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 10 }, async () => {
    call = call + 1;
    if (call === 2) {
      throw new Error("сервис недоступен");
    }

    return 100;
  });
});
`);

  const { records } = await run([file], { trials: 3, retries: 0 });
  const record = records[0]!.cases[0]!;

  expect(record.score).toBeUndefined();
  expect(record.passed).toBe(false);
  expect(record.trials).toHaveLength(3);
  expect(record.trials[1]?.error?.message).toBe("сервис недоступен");
  expect(records[0]!.passed).toBe(0);
});

test("retries чинят падение и попадают в запись", async () => {
  const file = await writeEval(`
let call = 0;

export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => {
    call = call + 1;
    if (call < 3) {
      throw new Error("429");
    }

    return 80;
  });
});
`);

  const { records } = await run([file], { trials: 1, retries: 2 });
  const record = records[0]!.cases[0]!;

  expect(record.score).toBe(80);
  expect(record.passed).toBe(true);
  expect(record.trials[0]?.retries).toBe(2);
});

test("retries кончились — кейс красный", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => {
    throw new Error("всегда падает");
  });
});
`);

  const { records } = await run([file], { trials: 1, retries: 2 });
  const record = records[0]!.cases[0]!;

  expect(record.passed).toBe(false);
  expect(record.trials[0]?.retries).toBe(2);
  expect(record.trials[0]?.error?.message).toBe("всегда падает");
});

test("одинаковое имя эвала в двух файлах — ошибка", async () => {
  const first = await writeEval(`
export const ev = createEval("return-decision", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => 90);
});
`);
  const second = await writeEval(`
export const ev = createEval("return-decision", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => 90);
});
`);

  expect(run([first, second], base)).rejects.toThrow('эвал "return-decision" объявлен дважды');
});

test("--timeout перебивает timeout кейса", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50, timeout: 30000 }, async () => {
    await Bun.sleep(2000);
    return 90;
  });
});
`);

  const { records } = await run([file], { trials: 1, retries: 0, timeout: 100 });
  const record = records[0]!.cases[0]!;

  expect(record.passed).toBe(false);
  expect(record.trials[0]?.error?.name).toBe("TimeoutError");
}, 15000);

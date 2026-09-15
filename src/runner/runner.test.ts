import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Pool } from "../pool/pool.ts";
import type { RunRecord } from "../types.ts";
import { checkTrial, type RunOptions, runEvals, type TrialReport } from "./runner.ts";

const root = await mkdtemp(join(tmpdir(), "ordeal-runner-"));
const entry = join(import.meta.dir, "..", "ordeal.ts");
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

// Пул из одного воркера: кейсы в тестах считают вызовы в переменной модуля,
// а модуль у каждого воркера свой.
async function run(
  files: string[],
  options: RunOptions,
): Promise<{ record: RunRecord; reported: TrialReport[] }> {
  const pool = new Pool(1);
  const reported: TrialReport[] = [];

  try {
    const record = await runEvals({
      pool,
      files,
      options,
      reportTrial: (report) => reported.push(report),
    });

    return { record, reported };
  } finally {
    pool.close();
  }
}

test("trial без балла или ниже порога не прошёл", () => {
  expect(checkTrial({ score: 80, ms: 1, retries: 0 }, 80)).toBe(true);
  expect(checkTrial({ score: 79, ms: 1, retries: 0 }, 80)).toBe(false);
  expect(checkTrial({ error: { name: "Error", message: "x" }, ms: 1, retries: 0 }, 0)).toBe(false);
});

test("запись запуска собирается целиком", async () => {
  const file = await writeEval(`
export const ev = createEval("return-decision", (ctx) => {
  ctx.createCase({ name: "прошёл", minScore: 80 }, async () => 92);
  ctx.createCase({ name: "не дотянул", minScore: 80 }, async () => 61);
});
`);

  const { record, reported } = await run([file], base);

  expect(record.version).toBe(1);
  expect(record.options).toEqual({ trials: 1, retries: 0, timeout: undefined });
  expect(new Date(record.startedAt).getTime()).toBeGreaterThan(0);
  expect(record.evals).toHaveLength(1);

  const evalRecord = record.evals[0]!;

  expect(evalRecord.name).toBe("return-decision");
  expect(evalRecord.total).toBe(2);
  expect(evalRecord.passed).toBe(1);
  expect(evalRecord.cases.map((item) => [item.name, item.passed])).toEqual([
    ["прошёл", true],
    ["не дотянул", false],
  ]);
  expect(evalRecord.cases[0]?.trials[0]?.score).toBe(92);

  expect(reported).toHaveLength(2);
  expect(reported.map((item) => [item.evalName, item.caseName, item.trial, item.minScore])).toContainEqual([
    "return-decision",
    "не дотянул",
    1,
    80,
  ]);
});

test("каждый trial сообщается отдельно со своим номером", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => 90);
});
`);

  const { reported } = await run([file], { trials: 3, retries: 0 });

  expect(reported.map((item) => item.trial).sort()).toEqual([1, 2, 3]);
  expect(reported.every((item) => item.record.score === 90)).toBe(true);
});

test("эвалы из разных файлов попадают в один запуск", async () => {
  const first = await writeEval(`
export const ev = createEval("first", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => 90);
});
`);
  const second = await writeEval(`
export const ev = createEval("second", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => 90);
});
`);

  const { record } = await run([first, second], base);

  expect(record.evals.map((item) => item.name)).toEqual(["first", "second"]);
});

test("один trial ниже порога валит кейс, все trials сохраняются", async () => {
  const file = await writeEval(`
let call = 0;

export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 75 }, async () => {
    call = call + 1;
    return [90, 60, 90][call - 1] ?? 0;
  });
});
`);

  const { record } = await run([file], { trials: 3, retries: 0 });
  const caseRecord = record.evals[0]!.cases[0]!;

  expect(caseRecord.trials.map((trial) => trial.score)).toEqual([90, 60, 90]);
  expect(caseRecord.passed).toBe(false);
});

test("все trials не ниже порога — кейс прошёл", async () => {
  const file = await writeEval(`
let call = 0;

export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 75 }, async () => {
    call = call + 1;
    return [90, 75, 100][call - 1] ?? 0;
  });
});
`);

  const { record } = await run([file], { trials: 3, retries: 0 });

  expect(record.evals[0]!.cases[0]!.passed).toBe(true);
});

test("упавший trial валит кейс целиком", async () => {
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

  const { record } = await run([file], { trials: 3, retries: 0 });
  const caseRecord = record.evals[0]!.cases[0]!;

  expect(caseRecord.passed).toBe(false);
  expect(caseRecord.trials).toHaveLength(3);
  expect(caseRecord.trials[1]?.error?.message).toBe("сервис недоступен");
  expect(record.evals[0]!.passed).toBe(0);
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

  const { record } = await run([file], { trials: 1, retries: 2 });
  const caseRecord = record.evals[0]!.cases[0]!;

  expect(caseRecord.trials[0]?.score).toBe(80);
  expect(caseRecord.passed).toBe(true);
  expect(caseRecord.trials[0]?.retries).toBe(2);
});

test("retries кончились — кейс красный", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => {
    throw new Error("всегда падает");
  });
});
`);

  const { record } = await run([file], { trials: 1, retries: 2 });
  const caseRecord = record.evals[0]!.cases[0]!;

  expect(caseRecord.passed).toBe(false);
  expect(caseRecord.trials[0]?.retries).toBe(2);
  expect(caseRecord.trials[0]?.error?.message).toBe("всегда падает");
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

  const { record } = await run([file], { trials: 1, retries: 0, timeout: 100 });
  const caseRecord = record.evals[0]!.cases[0]!;

  expect(caseRecord.passed).toBe(false);
  expect(caseRecord.trials[0]?.error?.name).toBe("TimeoutError");
}, 15000);

test("trials одного кейса идут одновременно", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => {
    await Bun.sleep(400);
    return 90;
  });
});
`);

  const pool = new Pool(3);

  try {
    const record = await runEvals({
      pool,
      files: [file],
      options: { trials: 3, retries: 0 },
      reportTrial: () => {},
    });

    expect(record.evals[0]!.cases[0]!.trials).toHaveLength(3);
    expect(record.ms).toBeLessThan(1000);
  } finally {
    pool.close();
  }
}, 15000);

test("кейсы разных эвалов идут одновременно", async () => {
  const body = (name: string): string => `
export const ev = createEval("${name}", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => {
    await Bun.sleep(600);
    return 90;
  });
});
`;
  const first = await writeEval(body("first"));
  const second = await writeEval(body("second"));

  const pool = new Pool(2);

  try {
    const record = await runEvals({
      pool,
      files: [first, second],
      options: { trials: 1, retries: 0 },
      reportTrial: () => {},
    });

    expect(record.evals.map((item) => item.name)).toEqual(["first", "second"]);
    expect(record.ms).toBeLessThan(1100);
  } finally {
    pool.close();
  }
}, 15000);

test("время trial не включает ожидание свободного воркера", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  for (const name of ["first", "second"]) {
    ctx.createCase({ name, minScore: 50 }, async () => {
      await Bun.sleep(300);
      return 90;
    });
  }
});
`);

  // Один воркер на два кейса: второй ждёт первого около 300мс в очереди.
  const { record } = await run([file], base);
  const trials = record.evals[0]!.cases.map((item) => item.trials[0]!);

  expect(record.ms).toBeGreaterThanOrEqual(600);
  expect(trials.every((trial) => trial.ms >= 290 && trial.ms < 550)).toBe(true);
}, 15000);

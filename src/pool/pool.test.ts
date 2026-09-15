import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Pool } from "./pool.ts";

const root = await mkdtemp(join(tmpdir(), "ordeal-pool-"));
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

test("list отдаёт эвалы с кейсами и их опциями", async () => {
  const file = await writeEval(`
export const first = createEval("return-decision", (ctx) => {
  ctx.createCase({ name: "брак с фото", minScore: 80 }, async () => 90);
  ctx.createCase({ name: "передумал", minScore: 60, timeout: 5000 }, async () => 70);
});
export const second = createEval("summary", (ctx) => {
  ctx.createCase({ name: "короткая статья", minScore: 70 }, async () => 80);
});
`);

  const pool = new Pool(1);
  const { response } = await pool.send({ kind: "list", file }, 5000);
  pool.close();

  expect(response.kind).toBe("cases");
  if (response.kind !== "cases") {
    return;
  }

  expect(response.evals.map((item) => item.name).sort()).toEqual(["return-decision", "summary"]);
  const decision = response.evals.find((item) => item.name === "return-decision");
  expect(decision?.cases.map((item) => item.name)).toEqual(["брак с фото", "передумал"]);
  expect(decision?.cases[1]?.timeout).toBe(5000);
});

test("кейс, вернувший число, даёт балл", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 80 }, async () => 92);
});
`);

  const pool = new Pool(1);
  const { response } = await pool.send({ kind: "run", file, evalName: "e", caseName: "c" }, 5000);
  pool.close();

  expect(response).toEqual({ kind: "result", score: 92, output: undefined });
});

test("output переезжает через границу воркера", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 80 }, async () => ({
    score: 88,
    output: { verdict: "refund", score: 88 },
  }));
});
`);

  const pool = new Pool(1);
  const { response } = await pool.send({ kind: "run", file, evalName: "e", caseName: "c" }, 5000);
  pool.close();

  expect(response.kind).toBe("result");
  if (response.kind !== "result") {
    return;
  }

  expect(response.score).toBe(88);
  expect(response.output).toEqual({ verdict: "refund", score: 88 });
});

test("упавший кейс приходит ошибкой с текстом", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 80 }, async () => {
    throw new Error("сервис недоступен");
  });
});
`);

  const pool = new Pool(1);
  const { response } = await pool.send({ kind: "run", file, evalName: "e", caseName: "c" }, 5000);
  pool.close();

  expect(response.kind).toBe("error");
  if (response.kind !== "error") {
    return;
  }

  expect(response.message).toBe("сервис недоступен");
  expect(response.stack).toContain("Error");
});

test("балл вне шкалы и не-число отбиваются", async () => {
  const outOfRange = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 80 }, async () => 8000);
});
`);
  const wrongType = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 80 }, async () => "девяносто" as any);
});
`);

  const pool = new Pool(1);
  const first = await pool.send({ kind: "run", file: outOfRange, evalName: "e", caseName: "c" }, 5000);
  const second = await pool.send({ kind: "run", file: wrongType, evalName: "e", caseName: "c" }, 5000);
  pool.close();

  expect(first.response.kind === "error" && first.response.message).toContain("вне шкалы 0..100");
  expect(second.response.kind === "error" && second.response.message).toContain("должен вернуть число");
});

test("файл без экспортированного эвала — ошибка", async () => {
  const file = await writeEval(`
const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 80 }, async () => 90);
});
export const helper = 42;
`);

  const pool = new Pool(1);
  const { response } = await pool.send({ kind: "list", file }, 5000);
  pool.close();

  expect(response.kind === "error" && response.message).toContain("нет ни одного экспортированного эвала");
});

test("несериализуемый output роняет кейс, а не теряется молча", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 80 }, async () => ({ score: 50, output: () => 1 }));
});
`);

  const pool = new Pool(1);
  const { response } = await pool.send({ kind: "run", file, evalName: "e", caseName: "c" }, 5000);
  pool.close();

  expect(response.kind).toBe("error");
});

test("кейс, слушающий signal, отменяется мягко и не ждёт убийства", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 80 }, async (signal) => {
    await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("кейс отменён по сигналу")));
    });

    return 100;
  });
});
`);

  const pool = new Pool(1);
  const started = Date.now();
  const { response } = await pool.send({ kind: "run", file, evalName: "e", caseName: "c" }, 200);
  const spent = Date.now() - started;
  pool.close();

  expect(response.kind === "error" && response.message).toBe("кейс отменён по сигналу");
  expect(spent).toBeLessThan(1000);
});

test("синхронно зависший кейс убивается, пул продолжает работать", async () => {
  const hang = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 80 }, async () => {
    while (true) {}
  });
});
`);
  const normal = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 80 }, async () => 77);
});
`);

  const pool = new Pool(1);

  const killed = await pool.send({ kind: "run", file: hang, evalName: "e", caseName: "c" }, 200);
  expect(killed.response.kind === "error" && killed.response.name).toBe("TimeoutError");
  expect(killed.response.kind === "error" && killed.response.message).toContain("был убит");
  expect(killed.ms).toBeGreaterThanOrEqual(1000);

  const after = await pool.send({ kind: "run", file: normal, evalName: "e", caseName: "c" }, 5000);
  pool.close();

  expect(after.response).toEqual({ kind: "result", score: 77, output: undefined });
}, 10000);

test("задания очередятся, когда воркеров меньше, чем работы", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  for (const item of [1, 2, 3, 4]) {
    ctx.createCase({ name: "c" + item, minScore: 50 }, async () => {
      await Bun.sleep(60);
      return item * 10;
    });
  }
});
`);

  const pool = new Pool(2);
  const started = Date.now();
  const results = await Promise.all(
    [1, 2, 3, 4].map((item) =>
      pool.send({ kind: "run", file, evalName: "e", caseName: "c" + item }, 5000),
    ),
  );
  const spent = Date.now() - started;
  pool.close();

  expect(
    results.map((item) => (item.response.kind === "result" ? item.response.score : -1)),
  ).toEqual([10, 20, 30, 40]);
  expect(spent).toBeGreaterThanOrEqual(120);
});

test("ms считает выполнение в воркере, а не ожидание в очереди", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => {
    await Bun.sleep(300);
    return 90;
  });
});
`);

  const pool = new Pool(1);
  const task = { kind: "run", file, evalName: "e", caseName: "c" } as const;

  // Второе задание ждёт первое в очереди около 300мс.
  const [first, second] = await Promise.all([pool.send(task, 5000), pool.send(task, 5000)]);
  pool.close();

  expect(first.ms).toBeGreaterThanOrEqual(290);
  expect(second.ms).toBeGreaterThanOrEqual(290);
  expect(second.ms).toBeLessThan(550);
});

test("close не оставляет висящих заданий", async () => {
  const file = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => {
    await Bun.sleep(3000);
    return 90;
  });
});
`);

  const pool = new Pool(1);
  const running = pool.send({ kind: "run", file, evalName: "e", caseName: "c" }, 10000);
  const queued = pool.send({ kind: "run", file, evalName: "e", caseName: "c" }, 10000);

  await Bun.sleep(50);
  pool.close();

  expect((await running).response.kind).toBe("error");
  expect((await queued).response.kind).toBe("error");
  expect((await queued).ms).toBe(0);
});

test("отменённое задание не задевает следующее в том же воркере", async () => {
  const slow = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async (signal) => {
    await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("отменён")));
      setTimeout(resolve, 500);
    });

    return 100;
  });
});
`);
  const quick = await writeEval(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => {
    await Bun.sleep(50);
    return 64;
  });
});
`);

  const pool = new Pool(1);

  const first = await pool.send({ kind: "run", file: slow, evalName: "e", caseName: "c" }, 200);
  expect(first.response.kind === "error" && first.response.message).toBe("отменён");

  const second = await pool.send({ kind: "run", file: quick, evalName: "e", caseName: "c" }, 5000);
  pool.close();

  expect(second.response).toEqual({ kind: "result", score: 64, output: undefined });
}, 10000);

test("падение на верхнем уровне файла приходит ошибкой, а не зависанием", async () => {
  const file = await writeEval(`
throw new Error("модуль не собрался");

export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => 90);
});
`);

  const pool = new Pool(1);
  const { response } = await pool.send({ kind: "list", file }, 3000);
  pool.close();

  expect(response.kind).toBe("error");
  expect(response.kind === "error" && response.message).toContain("модуль не собрался");
}, 10000);

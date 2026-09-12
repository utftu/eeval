import { expect, test } from "bun:test";

import { checkEval, createEval, findEvals } from "./eval.ts";

test("эвал узнаётся по маркеру", () => {
  const created = createEval("return-decision", () => {});

  expect(checkEval(created)).toBe(true);
});

test("посторонние значения эвалом не считаются", () => {
  expect(checkEval({ name: "самозванец", cases: [] })).toBe(false);
  expect(checkEval("строка")).toBe(false);
  expect(checkEval(undefined)).toBe(false);
  expect(checkEval(null)).toBe(false);
});

test("кейсы собираются в порядке объявления со своими опциями", () => {
  const created = createEval("return-decision", (ctx) => {
    ctx.createCase({ name: "первый", minScore: 80 }, async () => 90);
    ctx.createCase({ name: "второй", minScore: 60, timeout: 5000 }, async () => 70);
  });

  expect(created.name).toBe("return-decision");
  expect(created.cases.map((item) => item.name)).toEqual(["первый", "второй"]);
  expect(created.cases[0]?.minScore).toBe(80);
  expect(created.cases[0]?.timeout).toBeUndefined();
  expect(created.cases[1]?.timeout).toBe(5000);
});

test("повтор имени кейса бросает", () => {
  expect(() =>
    createEval("return-decision", (ctx) => {
      ctx.createCase({ name: "брак с фото", minScore: 80 }, async () => 90);
      ctx.createCase({ name: "брак с фото", minScore: 50 }, async () => 40);
    }),
  ).toThrow('кейс "брак с фото" объявлен дважды');
});

test("пустое имя кейса бросает", () => {
  expect(() =>
    createEval("return-decision", (ctx) => {
      ctx.createCase({ name: "", minScore: 80 }, async () => 90);
    }),
  ).toThrow("кейс без имени");
});

test("имя эвала должно годиться в имя папки", () => {
  expect(() => createEval("", () => {})).toThrow("не годится в имя папки");
  expect(() => createEval("a/b", () => {})).toThrow("не годится в имя папки");
  expect(() => createEval("..", () => {})).toThrow("не годится в имя папки");
});

test("findEvals не смотрит на имя экспорта", () => {
  const module = {
    возвраты: createEval("return-decision", (ctx) => {
      ctx.createCase({ name: "брак с фото", minScore: 80 }, async () => 90);
    }),
    x: createEval("summary", () => {}),
    fakeEval: { name: "я самозванец", cases: [] },
    anotherEval: "тоже не эвал",
    helper: 42,
  };

  const found = findEvals(module);

  expect(found.map((item) => item.name).sort()).toEqual(["return-decision", "summary"]);
});

test("кейс без аргументов подходит под тип run", () => {
  const created = createEval("return-decision", (ctx) => {
    ctx.createCase({ name: "без сигнала", minScore: 80 }, async () => 90);
    ctx.createCase({ name: "с сигналом", minScore: 80 }, async (signal) => {
      return { score: signal.aborted ? 0 : 100, output: { ok: true } };
    });
  });

  expect(created.cases).toHaveLength(2);
});

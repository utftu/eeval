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

test("опции эвала — необязательный второй аргумент", () => {
  const plain = createEval("plain", (ctx) => {
    ctx.createCase({ name: "c", minScore: 50 }, async () => 90);
  });
  const skipped = createEval("skipped", { skip: true }, (ctx) => {
    ctx.createCase({ name: "c", minScore: 50 }, async () => 90);
  });

  expect(plain.only).toBeUndefined();
  expect(plain.skip).toBeUndefined();
  expect(plain.cases).toHaveLength(1);
  expect(skipped.skip).toBe(true);
  expect(skipped.only).toBeUndefined();
  expect(skipped.cases).toHaveLength(1);
});

test("only и skip кейса сохраняются", () => {
  const created = createEval("e", (ctx) => {
    ctx.createCase({ name: "only", minScore: 50, only: true }, async () => 90);
    ctx.createCase({ name: "skip", minScore: 50, skip: true }, async () => 90);
  });

  expect(created.cases.map((item) => [item.name, item.only, item.skip])).toEqual([
    ["only", true, undefined],
    ["skip", undefined, true],
  ]);
});

test("only и skip сразу бросают — и у эвала, и у кейса", () => {
  expect(() => createEval("e", { only: true, skip: true }, () => {})).toThrow(
    'эвал "e" помечен и only, и skip',
  );
  expect(() =>
    createEval("e", (ctx) => {
      ctx.createCase({ name: "c", minScore: 50, only: true, skip: true }, async () => 90);
    }),
  ).toThrow('кейс "c" помечен и only, и skip');
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

test("пустое имя эвала бросает", () => {
  expect(() => createEval("", () => {})).toThrow("эвал без имени");
});

test("имя эвала не обязано годиться в имя папки", () => {
  expect(createEval("a/b", () => {}).name).toBe("a/b");
  expect(createEval("..", () => {}).name).toBe("..");
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

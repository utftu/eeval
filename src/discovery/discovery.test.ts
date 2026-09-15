import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const root = await mkdtemp(join(tmpdir(), "ordeal-discovery-"));

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

for (const path of [
  "a.eval.ts",
  "nested/b.eval.tsx",
  "nested/deep/c.eval.js",
  "node_modules/pkg/d.eval.ts",
  ".hidden/e.eval.ts",
  "helper.ts",
  "notes.md",
]) {
  await Bun.write(join(root, path), "export const x = 1;\n");
}

const { findEvalFiles } = await import("./discovery.ts");

function shorten(paths: string[]): string[] {
  return paths.map((path) => relative(root, path)).sort();
}

test("папка обходится вглубь, node_modules и папки на точку пропускаются", async () => {
  const found = await findEvalFiles([], root);

  expect(shorten(found)).toEqual(["a.eval.ts", "nested/b.eval.tsx", "nested/deep/c.eval.js"]);
});

test("вложенная папка берётся как путь", async () => {
  const found = await findEvalFiles(["nested"], root);

  expect(shorten(found)).toEqual(["nested/b.eval.tsx", "nested/deep/c.eval.js"]);
});

test("файл берётся напрямую и не дублируется", async () => {
  const found = await findEvalFiles(["a.eval.ts", "a.eval.ts", "."], root);

  expect(shorten(found)).toEqual(["a.eval.ts", "nested/b.eval.tsx", "nested/deep/c.eval.js"]);
});

test("файл не похожий на эвал бросает", async () => {
  expect(findEvalFiles(["helper.ts"], root)).rejects.toThrow("не похож на эвал");
});

test("несуществующий путь бросает, а не даёт пустой прогон", async () => {
  expect(findEvalFiles(["нет-такой-папки"], root)).rejects.toThrow("не найден");
});

test("пустая папка даёт пустой список", async () => {
  const empty = await mkdtemp(join(tmpdir(), "ordeal-empty-"));

  expect(await findEvalFiles([], empty)).toEqual([]);

  await rm(empty, { recursive: true, force: true });
});

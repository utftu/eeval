import { expect, test } from "bun:test";

import { pickConcurrency, readArgs } from "./cli.ts";

test("воркеров по умолчанию — по числу ядер, от 1 до 20", () => {
  expect(pickConcurrency(8)).toBe(8);
  expect(pickConcurrency(64)).toBe(20);
  expect(pickConcurrency(undefined)).toBe(1);
  expect(pickConcurrency(0)).toBe(1);
  expect(pickConcurrency(Number.NaN)).toBe(1);
});

test("-c выше потолка не режется", () => {
  expect(readArgs(["-c", "64"])?.concurrency).toBe(64);
});

test("без аргументов — значения по умолчанию и поиск от cwd", () => {
  expect(readArgs([])).toEqual({
    paths: [],
    concurrency: pickConcurrency(navigator.hardwareConcurrency),
    options: { trials: 1, retries: 0, timeout: undefined },
  });
});

test("eeval и eeval run означают одно и то же", () => {
  const argv = ["evals", "other", "-c", "8", "--trials", "3", "-r", "2", "--timeout", "5000"];
  const expected = {
    paths: ["evals", "other"],
    concurrency: 8,
    options: { trials: 3, retries: 2, timeout: 5000 },
  };

  expect(readArgs(argv)).toEqual(expected);
  expect(readArgs(["run", ...argv])).toEqual(expected);
});

test("--help не запускает прогон", () => {
  expect(readArgs(["--help"])).toBeUndefined();
});

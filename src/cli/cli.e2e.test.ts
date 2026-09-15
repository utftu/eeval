import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "ordeal-cli-"));
const cliPath = join(import.meta.dir, "cli.ts");
const entry = join(import.meta.dir, "..", "ordeal.ts");
let counter = 0;

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function createProject(body: string): Promise<string> {
  counter = counter + 1;
  const directory = join(root, `project-${counter}`);
  await mkdir(directory, { recursive: true });

  if (body !== "") {
    await Bun.write(
      join(directory, "a.eval.ts"),
      `import { createEval } from ${JSON.stringify(entry)};\n\n${body}\n`,
    );
  }

  return directory;
}

async function runBinary(
  cwd: string,
  argv: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, cliPath, ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { code, stdout, stderr };
}

test("красный кейс — код 1, строки trials, итог и запись", async () => {
  const directory = await createProject(`
export const ev = createEval("return-decision", (ctx) => {
  ctx.createCase({ name: "прошёл", minScore: 80 }, async () => 92);
  ctx.createCase({ name: "не дотянул", minScore: 80 }, async () => 61);
});
`);

  const { code, stdout } = await runBinary(directory, ["-t", "2"]);

  expect(code).toBe(1);
  expect(stdout).toContain("start eval=return-decision case=прошёл trial=1\n");
  expect(stdout).toContain("ok    eval=return-decision case=прошёл trial=1 score=92");
  expect(stdout).toContain('fail  eval=return-decision case="не дотянул" trial=2 score=61 minScore=80');
  expect(stdout).toContain('  case="не дотянул" fail');
  expect(stdout).toContain("total=2 passed=1 failed=1");

  const history = await Bun.file(join(directory, ".ordeal", "history.jsonl")).text();

  expect(history.trim().split("\n")).toHaveLength(1);
}, 15000);

test("все кейсы прошли — код 0", async () => {
  const directory = await createProject(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => 90);
});
`);

  const { code, stdout } = await runBinary(directory, ["run"]);

  expect(code).toBe(0);
  expect(stdout).toContain("total=1 passed=1 failed=0");
}, 15000);

test("путь не найден — код 2 и записи нет", async () => {
  const directory = await createProject(`
export const ev = createEval("e", (ctx) => {
  ctx.createCase({ name: "c", minScore: 50 }, async () => 90);
});
`);

  const { code, stderr } = await runBinary(directory, ["нет-такого"]);

  expect(code).toBe(2);
  expect(stderr).toContain("не найден");
  expect(await Bun.file(join(directory, ".ordeal", "history.jsonl")).exists()).toBe(false);
}, 15000);

test("эвалов не найдено — код 2", async () => {
  const directory = await createProject("");

  const { code, stderr } = await runBinary(directory, []);

  expect(code).toBe(2);
  expect(stderr).toContain("эвалов не найдено");
}, 15000);

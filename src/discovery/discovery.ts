import { resolve } from "node:path";

const EVAL_PATTERN = "**/*.eval.{ts,tsx,js}";
const SKIPPED_DIR = "node_modules";

const evalGlob = new Bun.Glob(EVAL_PATTERN);

function checkSkipped(path: string): boolean {
  return path.split("/").includes(SKIPPED_DIR);
}

async function scanDirectory(directory: string): Promise<string[]> {
  const found: string[] = [];

  for await (const entry of evalGlob.scan({ cwd: directory, onlyFiles: true, absolute: true })) {
    if (checkSkipped(entry)) {
      continue;
    }

    found.push(entry);
  }

  return found;
}

export async function findEvalFiles(paths: string[], cwd: string): Promise<string[]> {
  const targets = paths.length === 0 ? [cwd] : paths;
  const found = new Set<string>();

  for (const target of targets) {
    const absolute = resolve(cwd, target);
    const info = await Bun.file(absolute)
      .stat()
      .catch(() => undefined);

    if (info === undefined) {
      throw new Error(`путь "${target}" не найден`);
    }

    if (info.isDirectory()) {
      for (const entry of await scanDirectory(absolute)) {
        found.add(entry);
      }

      continue;
    }

    if (evalGlob.match(absolute) === false) {
      throw new Error(`файл "${target}" не похож на эвал: ждём ${EVAL_PATTERN}`);
    }

    found.add(absolute);
  }

  return [...found].sort();
}

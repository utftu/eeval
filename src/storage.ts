import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { LATEST_KEEP } from "./consts.ts";
import type { RunRecord } from "./types.ts";

// history.jsonl растёт вечно, поэтому output в него не пишется — он живёт
// только в latest.json, то есть три последних прогона. Схема одна, просто
// одно поле в историю не едет.
function stripOutputs(record: RunRecord): RunRecord {
  return {
    ...record,
    cases: record.cases.map((item) => ({
      ...item,
      trials: item.trials.map(({ output, ...trial }) => trial),
    })),
  };
}

async function readLatest(path: string): Promise<RunRecord[]> {
  const file = Bun.file(path);

  if ((await file.exists()) === false) {
    return [];
  }

  const parsed = await file.json().catch(() => undefined);

  if (Array.isArray(parsed) === false) {
    return [];
  }

  return parsed as RunRecord[];
}

export async function writeRecord(root: string, record: RunRecord): Promise<void> {
  const directory = join(root, record.eval);
  await mkdir(directory, { recursive: true });

  await appendFile(join(directory, "history.jsonl"), `${JSON.stringify(stripOutputs(record))}\n`);

  const latestPath = join(directory, "latest.json");
  const previous = await readLatest(latestPath);
  const next = [record, ...previous].slice(0, LATEST_KEEP);

  await Bun.write(latestPath, JSON.stringify(next, null, 2));
}

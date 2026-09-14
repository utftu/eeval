import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { LATEST_KEEP } from "../consts.ts";
import type { RunRecord } from "../types.ts";

// history.jsonl растёт вечно, поэтому output в него не пишется — он живёт
// только в latest.json, то есть в трёх последних запусках. Схема одна, просто
// одно поле в историю не едет.
function stripOutputs(record: RunRecord): RunRecord {
  return {
    ...record,
    evals: record.evals.map((evalRecord) => ({
      ...evalRecord,
      cases: evalRecord.cases.map((item) => ({
        ...item,
        trials: item.trials.map(({ output, ...trial }) => trial),
      })),
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
  await mkdir(root, { recursive: true });

  await appendFile(join(root, "history.jsonl"), `${JSON.stringify(stripOutputs(record))}\n`);

  const latestPath = join(root, "latest.json");
  const previous = await readLatest(latestPath);
  const next = [record, ...previous].slice(0, LATEST_KEEP);

  await Bun.write(latestPath, JSON.stringify(next, null, 2));
}

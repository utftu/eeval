#!/usr/bin/env bun
import { Block, Cli, Param, globalArg } from "argblock";
import { join } from "node:path";

import {
  defaultConcurrencyLimit,
  defaultRetries,
  defaultTrials,
  ORDEAL_DIR,
} from "../consts.ts";
import { findEvalFiles } from "../discovery/discovery.ts";
import { formatReport, formatTrialLine } from "../format/format.ts";
import { Pool } from "../pool/pool.ts";
import { type RunOptions, runEvals } from "../runner/runner.ts";
import { writeRecord } from "../storage/storage.ts";

const EXIT_PASSED = 0;
const EXIT_FAILED = 1;
const EXIT_BROKEN = 2;

type Args = {
  paths: string[];
  concurrency: number;
  options: RunOptions;
};

// Воркеров по умолчанию столько, сколько ядер, но не больше потолка: на
// большой машине сотня воркеров упёрлась бы в rate limit API. Рантайм, который
// не сообщает число ядер, получает одного воркера. Потолок касается только
// значения по умолчанию — -c, заданный руками, не режется.
export function pickConcurrency(cores: number | undefined): number {
  if (typeof cores !== "number" || Number.isFinite(cores) === false || cores < 1) {
    return 1;
  }

  return Math.min(Math.floor(cores), defaultConcurrencyLimit);
}

// Число ядер читается здесь, при разборе аргументов, а не оседает константой
// при загрузке модуля.
//
// У --timeout нет значения по умолчанию: argblock подставляет его так, что
// не отличить от набранного руками, а «не задан» значит «каждый кейс берёт свой».
function createParams(): Param[] {
  return [
    new Param({
      name: "concurrency",
      type: "number",
      short: "c",
      defaultValue: pickConcurrency(navigator.hardwareConcurrency),
      description: `сколько воркеров, по умолчанию по числу ядер, но не больше ${defaultConcurrencyLimit}`,
    }),
    new Param({
      name: "trials",
      type: "number",
      short: "t",
      defaultValue: defaultTrials,
      description: "сколько раз запускать каждый кейс",
    }),
    new Param({
      name: "retries",
      type: "number",
      short: "r",
      defaultValue: defaultRetries,
      description: "сколько повторов при падении",
    }),
    new Param({
      name: "timeout",
      type: "number",
      description: "мс на попытку, перебивает timeout кейса",
    }),
  ];
}

// Параметры и пути объявлены и на корне, и на run: голый ordeal и ordeal run
// означают одно и то же.
function createRoot(): Block {
  const paths = [{ name: "paths", required: false, variadic: true }];

  return new Block({
    arg: globalArg,
    params: createParams(),
    positionals: paths,
    description: "ordeal — прогон эвалов",
    children: [
      new Block({
        arg: "run",
        params: createParams(),
        positionals: paths,
        description: "прогон эвалов (команда по умолчанию)",
        children: [],
      }),
    ],
  });
}

// На --help argblock печатает справку сам, прогон не запускается.
export function readArgs(argv: string[]): Args | undefined {
  const parsed = new Cli(createRoot()).parse(argv);
  const last = parsed[parsed.length - 1];

  if (last === undefined) {
    return;
  }

  const params = last.params as {
    concurrency: number;
    trials: number;
    retries: number;
    timeout?: number;
  };

  return {
    paths: (last.positionals.paths as string[] | undefined) ?? [],
    concurrency: params.concurrency,
    options: {
      trials: params.trials,
      retries: params.retries,
      timeout: params.timeout,
    },
  };
}

export async function runCli(argv: string[], cwd: string): Promise<number> {
  const args = readArgs(argv);

  if (args === undefined) {
    return EXIT_PASSED;
  }

  const files = await findEvalFiles(args.paths, cwd);

  if (files.length === 0) {
    console.error("эвалов не найдено");
    return EXIT_BROKEN;
  }

  // Цвет только в терминале: в файле, пайпе и логах CI escape-коды — мусор.
  // NO_COLOR — общепринятый способ выключить цвет руками.
  const color = process.stdout.isTTY === true && Bun.env.NO_COLOR === undefined;
  const pool = new Pool(args.concurrency);

  try {
    const record = await runEvals({
      pool,
      files,
      options: args.options,
      reportTrial: (report) => console.log(formatTrialLine(report, color)),
    });

    console.log("");
    console.log(formatReport(record, color));
    await writeRecord(join(cwd, ORDEAL_DIR), record);

    const failed = record.evals.some((item) => item.passed < item.total);

    return failed ? EXIT_FAILED : EXIT_PASSED;
  } finally {
    pool.close();
  }
}

// Всё, что бросилось, — поломка запуска, а не красный кейс: неудачи кейсов
// приходят значениями и сюда не долетают.
if (import.meta.main) {
  const code = await runCli(Bun.argv.slice(2), process.cwd()).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));

    return EXIT_BROKEN;
  });

  process.exit(code);
}

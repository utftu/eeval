#!/usr/bin/env bun
import { Cli } from "argblock";
import { join } from "node:path";

import {
  defaultConcurrencyLimit,
  defaultRetries,
  defaultTrials,
  ORDEAL_DIR,
} from "../consts.ts";
import { findEvalFiles } from "../discovery/discovery.ts";
import {
  formatReport,
  formatStartLine,
  formatTrialLine,
} from "../format/format.ts";
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

// То, что argblock отдаёт в action: разобранные параметры и позиционные
// аргументы вызванной команды.
type Parsed = {
  params: Record<string, unknown>;
  positionals: Record<string, unknown>;
};

// Воркеров по умолчанию столько, сколько ядер, но не больше потолка: на
// большой машине сотня воркеров упёрлась бы в rate limit API. Рантайм, который
// не сообщает число ядер, получает одного воркера. Потолок касается только
// значения по умолчанию — -c, заданный руками, не режется.
export function pickConcurrency(cores: number | undefined): number {
  if (
    typeof cores !== "number" ||
    Number.isFinite(cores) === false ||
    cores < 1
  ) {
    return 1;
  }

  return Math.min(Math.floor(cores), defaultConcurrencyLimit);
}

export function readArgs(parsed: Parsed): Args {
  const params = parsed.params as {
    concurrency: number;
    trials: number;
    retries: number;
    timeout?: number;
  };

  return {
    paths: (parsed.positionals.paths as string[] | undefined) ?? [],
    concurrency: params.concurrency,
    options: {
      trials: params.trials,
      retries: params.retries,
      timeout: params.timeout,
    },
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runCommand(args: Args, cwd: string): Promise<number> {
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
      reportStart: (report) => console.log(formatStartLine(report, color)),
      reportTrial: (report) => console.log(formatTrialLine(report, color)),
    });

    console.log("");
    console.log(formatReport(record, color));
    await writeRecord(join(cwd, ORDEAL_DIR), record);

    // Пропущенный кейс не красный: код 1 даёт только кейс, который запускался и не прошёл.
    const failed = record.evals.some(
      (item) => item.passed + item.skipped < item.total,
    );

    return failed ? EXIT_FAILED : EXIT_PASSED;
  } finally {
    pool.close();
  }
}

// Команду выбирает argblock: .run() разбирает аргументы и зовёт action
// вызванной команды. Action — граница процесса: он делает прогон и сам
// завершает процесс с кодом возврата. Всё, что бросилось внутри прогона, —
// поломка запуска, а не красный кейс: неудачи кейсов приходят значениями.
//
// Число ядер читается здесь, при сборке CLI, а не оседает константой при
// загрузке модуля.
//
// commandLink делает голый ordeal тем же, что ordeal run: параметры и пути
// объявлены один раз, на run.
//
// У --timeout нет значения по умолчанию: argblock подставляет его так, что
// не отличить от набранного руками, а «не задан» значит «каждый кейс берёт свой».
export function createCli(cwd: string): Cli {
  const concurrency = pickConcurrency(navigator.hardwareConcurrency);

  return new Cli({ commandLink: "run" })
    .command("run [...paths]", "прогон эвалов (команда по умолчанию)")
    .param(
      `--concurrency -c number ${concurrency}`,
      `сколько воркеров, по умолчанию по числу ядер, но не больше ${defaultConcurrencyLimit}`,
    )
    .param(
      `--trials -t number ${defaultTrials}`,
      "сколько раз запускать каждый кейс",
    )
    .param(
      `--retries -r number ${defaultRetries}`,
      "сколько повторов при падении",
    )
    .param("--timeout number", "мс на попытку, перебивает timeout кейса")
    .action(async (parsed) => {
      const code = await runCommand(readArgs(parsed), cwd).catch((error) => {
        console.error(describeError(error));

        return EXIT_BROKEN;
      });

      process.exit(code);
    });
}

// Ошибку разбора аргументов argblock бросает синхронно из run(), до action,
// поэтому она ловится здесь. На --help argblock печатает справку сам, action
// не вызывается и процесс выходит с кодом 0.
if (import.meta.main) {
  try {
    createCli(process.cwd()).run(Bun.argv.slice(2));
  } catch (error) {
    console.error(describeError(error));
    process.exit(EXIT_BROKEN);
  }
}

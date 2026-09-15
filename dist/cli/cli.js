#!/usr/bin/env bun
// @bun

// node_modules/argblock/dist/argblock.js
var validatePositionals = (positionals) => {
  for (let i = 1;i < positionals.length; i++) {
    const pos = positionals[i];
    const prev = positionals[i - 1];
    if (prev.variadic) {
      throw new Error(`Variadic positional <...${prev.name}> must be last`);
    }
    if (!prev.required && pos.required) {
      throw new Error(`Required positional <${pos.name}> cannot follow optional <${prev.name}>`);
    }
  }
};
var createDefaultMatcher = (name) => (elems) => {
  if (name === elems[0]) {
    return { elems: elems.slice(1), match: true };
  }
  return { elems, match: false };
};

class Block {
  arg;
  params;
  positionals;
  description;
  matcher;
  data;
  children = [];
  constructor({
    arg,
    params,
    positionals = [],
    description,
    matcher,
    children = [],
    data = {}
  }) {
    validatePositionals(positionals);
    this.arg = arg;
    this.params = params;
    this.positionals = positionals;
    this.description = description;
    this.children = children;
    this.data = data;
    if (matcher) {
      this.matcher = matcher;
    } else {
      this.matcher = createDefaultMatcher(this.arg);
    }
  }
  findParam(name) {
    for (const param of this.params) {
      if (param.name === name) {
        return param;
      }
    }
  }
  findShortParam(name) {
    for (const param of this.params) {
      if (param.short === name) {
        return param;
      }
    }
  }
}
var checkFull = (arg) => {
  if (arg.startsWith("--")) {
    return true;
  }
  return false;
};
var parseFull = (arg1, rest, block) => {
  const [arg2 = "", ...remaining] = rest;
  if (arg1.includes("=")) {
    const { name: name2, value } = getNameFromEq(arg1.slice(2));
    const param2 = block.findParam(name2);
    if (!param2) {
      throw new Error("Unknown param " + arg1);
    }
    return { values: [{ param: param2, value }], elems: rest };
  }
  const name = arg1.slice(2);
  const param = block.findParam(name);
  if (!param) {
    throw new Error("Unknown param " + arg1);
  }
  if (param.type === "boolean") {
    if (checkBoolValue(arg2)) {
      return { values: [{ param, value: arg2 }], elems: remaining };
    }
    return { values: [{ param, value: "1" }], elems: rest };
  }
  return { values: [{ param, value: arg2 }], elems: remaining };
};
var checkNo = (arg1) => {
  if (arg1.startsWith("--no-")) {
    return true;
  }
  return false;
};
var parseNo = (arg1, rest, block) => {
  const param = block.findParam(arg1.slice(5));
  if (!param) {
    throw new Error("Unknown param " + arg1);
  }
  return { values: [{ param, value: "0" }], elems: rest };
};
var checkShort = (arg) => {
  if (arg.startsWith("-") && !arg.startsWith("--")) {
    return true;
  }
  return false;
};
var parseShort = (arg1, rest, block) => {
  const [arg2 = "", ...remaining] = rest;
  if (arg1.length > 2) {
    if (arg1.includes("=")) {
      const { name: name2, value } = getNameFromEq(arg1.slice(1));
      const param2 = block.findShortParam(name2);
      if (!param2) {
        throw new Error("Unknown param " + arg1);
      }
      return { values: [{ param: param2, value }], elems: rest };
    }
    const values = arg1.slice(1).split("").map((name2) => {
      const param2 = block.findShortParam(name2);
      if (!param2) {
        throw new Error("Unknown param: " + arg1 + " No param property for shortkey: " + name2);
      }
      return { param: param2, value: "1" };
    });
    return { values, elems: rest };
  }
  const name = arg1[1];
  const param = block.findShortParam(name);
  if (!param) {
    throw new Error("Unknown param " + arg1);
  }
  if (param.type === "boolean") {
    if (checkBoolValue(arg2)) {
      return { values: [{ param, value: arg2 }], elems: remaining };
    }
    return { values: [{ param, value: "1" }], elems: rest };
  }
  return { values: [{ param, value: arg2 }], elems: remaining };
};
var getNameFromEq = (str) => {
  const [name, ...values] = str.split("=");
  return {
    name,
    value: values.join("=")
  };
};
var checkBoolValue = (str) => {
  if (str === "1" || str === "0" || str === "true" || str === "false") {
    return true;
  }
  return false;
};
var parseParam = (elems, block) => {
  const [arg1 = ""] = elems;
  const rest = elems.slice(1);
  if (checkNo(arg1))
    return parseNo(arg1, rest, block);
  if (checkShort(arg1))
    return parseShort(arg1, rest, block);
  if (checkFull(arg1))
    return parseFull(arg1, rest, block);
  return null;
};
var convertParam = (value, param, originalParam) => {
  if (param.type === "boolean") {
    if (!checkBoolValue(value)) {
      throw new Error("Param must be boolean: " + originalParam);
    }
    if (value === "1" || value === "true") {
      return true;
    }
    return false;
  }
  if (param.type === "number") {
    const number = +value;
    if (isFinite(number) === false) {
      throw new Error("Param must be number: " + originalParam);
    }
    return number;
  }
  if (param.type === "string") {
    return value;
  }
  throw new Error("Unknown param type: " + param.type);
};
function convertDefault(value, param) {
  return convertParam(value, param, `default for --${param.name}`);
}
var globalArg = "globalArg";
function matchChild(elems, children) {
  for (const child of children) {
    const { match, elems: afterName } = child.matcher(elems);
    if (match)
      return { block: child, elems: afterName };
  }
  return;
}
function checkRequiredPositionals(entry) {
  for (const positional of entry.block.positionals) {
    if (!positional.required)
      continue;
    const value = entry.positionals[positional.name];
    const missing = positional.variadic ? value?.length === 0 : value === undefined;
    if (missing) {
      const label = positional.variadic ? `...${positional.name}` : positional.name;
      throw new Error(`Required positional <${label}> is missing`);
    }
  }
}
function applyDefaults(entry) {
  for (const param of entry.block.params) {
    if (param.defaultValue === undefined) {
      continue;
    }
    if (param.name in entry.params) {
      continue;
    }
    entry.params[param.name] = convertDefault(String(param.defaultValue), param);
  }
}
var parse = (args, blocks, { onHelp } = {}) => {
  if (blocks.length === 0) {
    throw new Error("Empty blocks");
  }
  const globalBlockProvided = blocks.length === 1 && blocks[0].arg === globalArg;
  let currentBlock = globalBlockProvided ? blocks[0] : new Block({
    arg: globalArg,
    params: [],
    description: "",
    children: blocks
  });
  const parsedBlocks = [
    { arg: currentBlock.arg, params: {}, positionals: {}, block: currentBlock }
  ];
  let posIndex = 0;
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") {
      onHelp?.(currentBlock);
      return [];
    }
    if (arg.startsWith("-")) {
      const { values, elems: rest } = parseParam(args.slice(i), currentBlock);
      const current2 = parsedBlocks.at(-1);
      for (const { param, value } of values) {
        if (param.name in current2.params) {
          throw new Error("Param duplicated: " + arg);
        }
        current2.params[param.name] = convertParam(value, param, arg);
      }
      i = args.length - rest.length - 1;
      continue;
    }
    const matched = matchChild(args.slice(i), currentBlock.children);
    if (matched) {
      checkRequiredPositionals(parsedBlocks.at(-1));
      const newI = args.length - matched.elems.length - 1;
      parsedBlocks.push({
        arg: args.slice(i, newI + 1).join(" "),
        params: {},
        positionals: {},
        block: matched.block
      });
      currentBlock = matched.block;
      posIndex = 0;
      i = newI;
      continue;
    }
    const positional = currentBlock.positionals[posIndex];
    if (!positional)
      throw new Error(`Unknown arg: ${arg}`);
    const current = parsedBlocks.at(-1);
    if (positional.variadic) {
      const list = current.positionals[positional.name] ?? [];
      list.push(arg);
      current.positionals[positional.name] = list;
    } else {
      current.positionals[positional.name] = arg;
      posIndex++;
    }
  }
  checkRequiredPositionals(parsedBlocks.at(-1));
  for (const entry of parsedBlocks) {
    applyDefaults(entry);
  }
  return globalBlockProvided ? parsedBlocks : parsedBlocks.slice(1);
};

class Param {
  name;
  type;
  short;
  defaultValue;
  description;
  constructor({
    type,
    short,
    name,
    defaultValue,
    description = ""
  }) {
    this.type = type;
    this.short = short;
    this.name = name;
    this.defaultValue = defaultValue;
    this.description = description;
  }
}
function formatPositional(positional) {
  const label = positional.variadic ? `...${positional.name}` : positional.name;
  return positional.required ? `<${label}>` : `[${label}]`;
}
function withDescription(label, description) {
  return description ? `${label} - ${description}` : label;
}
function formatHelp(block) {
  const lines = [];
  if (block.children.length) {
    lines.push("commands:");
    for (const child of block.children) {
      lines.push(`  ${withDescription(child.arg, child.description)}`);
    }
  }
  if (block.positionals.length) {
    if (lines.length)
      lines.push("");
    lines.push("positionals:");
    for (const positional of block.positionals) {
      lines.push(`  ${withDescription(formatPositional(positional), positional.description)}`);
    }
  }
  if (block.params.length) {
    if (lines.length)
      lines.push("");
    lines.push("params:");
    for (const param of block.params) {
      const names = param.short ? `--${param.name}, -${param.short}` : `--${param.name}`;
      lines.push(`  ${withDescription(`${names} ${param.type}`, param.description)}`);
    }
  }
  return lines.join(`
`);
}
function getCommandName(elems) {
  const name = elems[0];
  if (!name || name.startsWith("<") || name.startsWith("[")) {
    throw new Error("Command name is missing");
  }
  return { name, elems: elems.slice(1) };
}
function parseArg(token) {
  const required = token.startsWith("<");
  const optional = token.startsWith("[");
  if (!required && !optional) {
    throw new Error(`Unknown token ${token}, expected <arg> or [arg]`);
  }
  const inner = token.slice(1, -1);
  const variadic = inner.startsWith("...");
  const name = variadic ? inner.slice(3) : inner;
  if (!name) {
    throw new Error(`Arg name is empty in ${token}`);
  }
  return { name, required, variadic };
}
function getArgs(elems) {
  const args = elems.map(parseArg);
  validatePositionals(args);
  return args;
}
function parseCommand(pattern, _description) {
  const elems = pattern.trim().split(/\s+/);
  const { name, elems: rest } = getCommandName(elems);
  const args = getArgs(rest);
  return { name, args };
}
var types = {
  number: ["number", "num", "int"],
  string: ["string", "str"],
  boolean: ["boolean", "bool"]
};
function findType(value) {
  for (const key in types) {
    const arr = types[key];
    if (arr.includes(value)) {
      return key;
    }
  }
  return;
}
function getParamNames(elems) {
  let full;
  let short;
  for (let i = 0;i < elems.length; i++) {
    const elem = elems[i];
    if (elem.startsWith("--")) {
      full = elem.slice(2);
      continue;
    } else if (elem.startsWith("-")) {
      short = elem.slice(1);
      if (short.length !== 1) {
        throw new Error(`Short param should be a single letter, got ${short}`);
      }
      continue;
    }
    if (full) {
      return {
        full,
        short,
        elems: elems.slice(i)
      };
    }
    throw new Error(`Unknown property ${elem}, should be param`);
  }
  throw new Error("Only params, no types");
}
function getType(elems) {
  if (elems.length === 0) {
    throw new Error("No type");
  }
  const elem = elems[0];
  const localType = findType(elem);
  if (!localType) {
    throw new Error(`Unknown type ${elem}`);
  }
  return { elems: elems.slice(1), type: localType };
}
function getDefault(elems) {
  if (elems.length === 0) {
    return;
  }
  return {
    defaultValue: elems[0],
    elems: elems.slice(1)
  };
}
function parseParam2(pattern, description) {
  const trimmed = pattern.trim();
  if (!trimmed.startsWith("-")) {
    throw new Error("Unknown format, option should start with -");
  }
  let elems = trimmed.split(" ").filter((part) => part !== " ");
  const { full, short, elems: afterNames } = getParamNames(elems);
  elems = afterNames;
  const { type, elems: afterType } = getType(elems);
  elems = afterType;
  const defaultResult = getDefault(elems);
  let defaultValue;
  if (defaultResult) {
    elems = defaultResult.elems;
    defaultValue = defaultResult.defaultValue;
  }
  if (elems.length) {
    throw new Error(`Unknown props ${elems.join(" ")}`);
  }
  const param = new Param({
    type,
    name: full,
    short,
    description
  });
  if (defaultValue !== undefined) {
    param.defaultValue = convertDefault(defaultValue, param);
  }
  return param;
}

class Cli {
  root;
  current;
  constructor(root) {
    this.root = root ?? new Block({
      arg: globalArg,
      params: [],
      description: "",
      children: []
    });
    this.current = this.root;
  }
  static new() {
    return new Cli;
  }
  command(pattern, description = "") {
    const { name, args } = parseCommand(pattern, description);
    const block = new Block({
      arg: name,
      params: [],
      positionals: args,
      description,
      children: []
    });
    this.root.children.push(block);
    this.current = block;
    return this;
  }
  block(pattern, description, build) {
    const { name, args } = parseCommand(pattern, description);
    const block = new Block({
      arg: name,
      params: [],
      positionals: args,
      description,
      children: []
    });
    this.root.children.push(block);
    build(new Cli(block));
    this.current = block;
    return this;
  }
  param(pattern, description) {
    const param = parseParam2(pattern, description);
    this.current.params.push(param);
    return this;
  }
  action(handler) {
    this.current.data.action = handler;
    return this;
  }
  parse(args) {
    return parse(args, [this.root], {
      onHelp: (block) => console.log(formatHelp(block))
    });
  }
  run(args) {
    const result = this.parse(args);
    const matched = result.at(-1);
    if (!matched)
      return;
    const handler = matched.block.data.action;
    if (!handler) {
      const label = matched.arg === globalArg ? "the global command" : matched.arg;
      throw new Error(`No action defined for ${label}`);
    }
    handler(matched);
  }
}

// src/cli/cli.ts
import { join as join2 } from "path";

// src/consts.ts
var INSTANCE_KEY = "__ordeal";
var INSTANCE_VALUE = "eval";
var defaultTimeout = 60000;
var killGrace = 1000;
var RECORD_VERSION = 1;
var ORDEAL_DIR = ".ordeal";
var latestKeep = 3;
var defaultConcurrencyLimit = 20;
var defaultTrials = 1;
var defaultRetries = 0;

// src/discovery/discovery.ts
import { resolve } from "path";
var EVAL_PATTERN = "**/*.eval.{ts,tsx,js}";
var SKIPPED_DIR = "node_modules";
var evalGlob = new Bun.Glob(EVAL_PATTERN);
function checkSkipped(path) {
  return path.split("/").includes(SKIPPED_DIR);
}
async function scanDirectory(directory) {
  const found = [];
  for await (const entry of evalGlob.scan({ cwd: directory, onlyFiles: true, absolute: true })) {
    if (checkSkipped(entry)) {
      continue;
    }
    found.push(entry);
  }
  return found;
}
async function findEvalFiles(paths, cwd) {
  const targets = paths.length === 0 ? [cwd] : paths;
  const found = new Set;
  for (const target of targets) {
    const absolute = resolve(cwd, target);
    const info = await Bun.file(absolute).stat().catch(() => {
      return;
    });
    if (info === undefined) {
      throw new Error(`\u043F\u0443\u0442\u044C "${target}" \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D`);
    }
    if (info.isDirectory()) {
      for (const entry of await scanDirectory(absolute)) {
        found.add(entry);
      }
      continue;
    }
    if (evalGlob.match(absolute) === false) {
      throw new Error(`\u0444\u0430\u0439\u043B "${target}" \u043D\u0435 \u043F\u043E\u0445\u043E\u0436 \u043D\u0430 \u044D\u0432\u0430\u043B: \u0436\u0434\u0451\u043C ${EVAL_PATTERN}`);
    }
    found.add(absolute);
  }
  return [...found].sort();
}

// src/runner/runner.ts
function checkTrial(record, minScore) {
  if (record.score === undefined) {
    return false;
  }
  return record.score >= minScore;
}
function describeResponse(response) {
  if (response.kind === "error") {
    return {
      name: response.name,
      message: response.message,
      stack: response.stack
    };
  }
  return {
    name: "Error",
    message: `\u043D\u0435\u043E\u0436\u0438\u0434\u0430\u043D\u043D\u044B\u0439 \u043E\u0442\u0432\u0435\u0442 \u0432\u043E\u0440\u043A\u0435\u0440\u0430: ${response.kind}`
  };
}
async function runTrial({
  pool,
  task,
  timeout,
  retries
}) {
  let ms = 0;
  let used = 0;
  while (true) {
    const sent = await pool.send(task, timeout);
    const response = sent.response;
    ms = ms + sent.ms;
    if (response.kind === "result") {
      return {
        score: response.score,
        output: response.output,
        ms,
        retries: used
      };
    }
    if (used < retries) {
      used = used + 1;
      continue;
    }
    return {
      error: describeResponse(response),
      ms,
      retries: used
    };
  }
}
async function runCase({
  pool,
  plan,
  caseProps,
  options,
  reportTrial
}) {
  const task = {
    kind: "run",
    file: plan.file,
    evalName: plan.eval.name,
    caseName: caseProps.name
  };
  const timeout = options.timeout ?? caseProps.timeout ?? defaultTimeout;
  const trials = await Promise.all(Array.from({ length: options.trials }, async (_, i) => {
    const record = await runTrial({
      pool,
      task,
      timeout,
      retries: options.retries
    });
    reportTrial({
      evalName: plan.eval.name,
      caseName: caseProps.name,
      trial: i + 1,
      minScore: caseProps.minScore,
      record
    });
    return record;
  }));
  const passed = trials.every((trial) => checkTrial(trial, caseProps.minScore));
  return {
    name: caseProps.name,
    minScore: caseProps.minScore,
    passed,
    trials
  };
}
async function buildPlans({
  pool,
  files,
  timeout
}) {
  const plans = [];
  const seen = new Map;
  for (const file of files) {
    const { response } = await pool.send({ kind: "list", file }, timeout);
    if (response.kind !== "cases") {
      throw new Error(`${file}: ${describeResponse(response)?.message}`);
    }
    for (const evalConfig of response.evals) {
      const already = seen.get(evalConfig.name);
      if (already !== undefined) {
        throw new Error(`\u044D\u0432\u0430\u043B "${evalConfig.name}" \u043E\u0431\u044A\u044F\u0432\u043B\u0435\u043D \u0434\u0432\u0430\u0436\u0434\u044B: ${already} \u0438 ${file}`);
      }
      seen.set(evalConfig.name, file);
      plans.push({ file, eval: evalConfig });
    }
  }
  return plans;
}
async function runEvals({
  pool,
  files,
  options,
  reportTrial
}) {
  const startedAt = Date.now();
  const listTimeout = options.timeout ?? defaultTimeout;
  const plans = await buildPlans({ pool, files, timeout: listTimeout });
  const evals = await Promise.all(plans.map(async (plan) => {
    const cases = await Promise.all(plan.eval.cases.map((caseProps) => runCase({ pool, plan, caseProps, options, reportTrial })));
    return {
      name: plan.eval.name,
      total: cases.length,
      passed: cases.filter((record) => record.passed).length,
      cases
    };
  }));
  return {
    version: RECORD_VERSION,
    startedAt: new Date(startedAt).toISOString(),
    ms: Date.now() - startedAt,
    options: {
      trials: options.trials,
      retries: options.retries,
      timeout: options.timeout
    },
    evals
  };
}

// src/format/format.ts
var COLORED = {
  ok: "\x1B[32m",
  fail: "\x1B[31m",
  key: "\x1B[34m",
  reset: "\x1B[0m"
};
var PLAIN = { ok: "", fail: "", key: "", reset: "" };
var outputLimit = 200;
var statusWidth = 4;
function formatMs(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
function formatValue(value) {
  if (value === "" || value.includes(" ") || value.includes('"') || value.includes("=")) {
    return JSON.stringify(value);
  }
  return value;
}
function formatOutput(output) {
  const text = JSON.stringify(output) ?? String(output);
  if (text.length <= outputLimit) {
    return text;
  }
  return `${text.slice(0, outputLimit)}\u2026`;
}
function renderStatus(passed, palette) {
  if (passed) {
    return `${palette.ok}ok${palette.reset}`;
  }
  return `${palette.fail}fail${palette.reset}`;
}
function padStatus(passed, palette) {
  const word = passed ? "ok" : "fail";
  return `${renderStatus(passed, palette)}${" ".repeat(statusWidth - word.length)}`;
}
function renderFields(fields, palette) {
  return fields.map(([key, value]) => `${palette.key}${key}=${palette.reset}${value}`).join(" ");
}
function collectTrialFields(record, minScore) {
  const fields = [];
  if (record.score !== undefined) {
    fields.push(["score", String(record.score)]);
  }
  if (record.score !== undefined && checkTrial(record, minScore) === false) {
    fields.push(["minScore", String(minScore)]);
  }
  fields.push(["time", formatMs(record.ms)]);
  if (record.retries > 0) {
    fields.push(["retries", String(record.retries)]);
  }
  if (record.output !== undefined) {
    fields.push(["output", formatOutput(record.output)]);
  }
  if (record.error !== undefined) {
    fields.push(["error", formatValue(`${record.error.name}: ${record.error.message}`)]);
  }
  return fields;
}
function formatTrialLine(report, color) {
  const palette = color ? COLORED : PLAIN;
  const passed = checkTrial(report.record, report.minScore);
  const fields = [
    ["eval", formatValue(report.evalName)],
    ["case", formatValue(report.caseName)],
    ["trial", String(report.trial)],
    ...collectTrialFields(report.record, report.minScore)
  ];
  return `${padStatus(passed, palette)} ${renderFields(fields, palette)}`;
}
function formatReport(record, color) {
  const palette = color ? COLORED : PLAIN;
  const lines = [];
  let total = 0;
  let passed = 0;
  for (const evalRecord of record.evals) {
    lines.push(renderFields([
      ["eval", formatValue(evalRecord.name)],
      ["total", String(evalRecord.total)],
      ["passed", String(evalRecord.passed)],
      ["failed", String(evalRecord.total - evalRecord.passed)]
    ], palette));
    total = total + evalRecord.total;
    passed = passed + evalRecord.passed;
    for (const caseRecord of evalRecord.cases) {
      const caseField = renderFields([["case", formatValue(caseRecord.name)]], palette);
      lines.push(`  ${caseField} ${renderStatus(caseRecord.passed, palette)}`);
      for (let i = 0;i < caseRecord.trials.length; i++) {
        const trial = caseRecord.trials[i];
        const trialField = renderFields([["trial", String(i + 1)]], palette);
        const status = renderStatus(checkTrial(trial, caseRecord.minScore), palette);
        const fields = renderFields(collectTrialFields(trial, caseRecord.minScore), palette);
        lines.push(`    ${trialField} ${status} ${fields}`);
      }
    }
  }
  lines.push(renderFields([
    ["total", String(total)],
    ["passed", String(passed)],
    ["failed", String(total - passed)],
    ["time", formatMs(record.ms)]
  ], palette));
  return lines.join(`
`);
}

// src/pool/worker-eval.ts
var WORKER_URL = new URL("../pool/worker", import.meta.url).href;
var DROPPED_RESPONSE = {
  kind: "error",
  name: "PoolClosedError",
  message: "\u043F\u0443\u043B \u0437\u0430\u043A\u0440\u044B\u0442, \u0437\u0430\u0434\u0430\u0447\u0430 \u043D\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0430"
};

class WorkerEval {
  worker;
  handleFree;
  job;
  startedAt = 0;
  abortTimer;
  killTimer;
  closed = false;
  constructor(handleFree) {
    this.handleFree = handleFree;
    this.worker = new Worker(WORKER_URL);
    this.attach();
  }
  get free() {
    return this.job === undefined;
  }
  run(job) {
    this.job = job;
    this.startedAt = Date.now();
    this.abortTimer = setTimeout(() => {
      if (this.job !== job) {
        return;
      }
      this.worker.postMessage({ kind: "abort" });
      this.killTimer = setTimeout(() => {
        if (this.job !== job) {
          return;
        }
        this.kill();
      }, killGrace);
    }, job.timeout);
    this.worker.postMessage(job.task);
  }
  close() {
    this.closed = true;
    const job = this.job;
    this.clearTimers();
    this.job = undefined;
    this.worker.terminate();
    job?.handleResponse(DROPPED_RESPONSE, Date.now() - this.startedAt);
  }
  attach() {
    this.worker.onmessage = (event) => {
      this.finishJob(event.data);
    };
    this.worker.onerror = (event) => {
      const message = event instanceof ErrorEvent ? event.message : "\u0432\u043E\u0440\u043A\u0435\u0440 \u0443\u043F\u0430\u043B";
      this.respawn();
      this.finishJob({ kind: "error", name: "WorkerError", message });
    };
  }
  respawn() {
    this.worker.terminate();
    if (this.closed) {
      return;
    }
    this.worker = new Worker(WORKER_URL);
    this.attach();
  }
  clearTimers() {
    if (this.abortTimer !== undefined) {
      clearTimeout(this.abortTimer);
      this.abortTimer = undefined;
    }
    if (this.killTimer !== undefined) {
      clearTimeout(this.killTimer);
      this.killTimer = undefined;
    }
  }
  finishJob(response) {
    const job = this.job;
    if (job === undefined) {
      return;
    }
    this.clearTimers();
    this.job = undefined;
    job.handleResponse(response, Date.now() - this.startedAt);
    this.handleFree();
  }
  kill() {
    const job = this.job;
    if (job === undefined) {
      return;
    }
    this.clearTimers();
    this.job = undefined;
    this.respawn();
    job.handleResponse({
      kind: "error",
      name: "TimeoutError",
      message: `\u043A\u0435\u0439\u0441 \u043D\u0435 \u0443\u043B\u043E\u0436\u0438\u043B\u0441\u044F \u0432 ${job.timeout}\u043C\u0441 \u0438 \u0431\u044B\u043B \u0443\u0431\u0438\u0442`
    }, Date.now() - this.startedAt);
    this.handleFree();
  }
}

// src/pool/pool.ts
class Pool {
  workers = [];
  jobs = [];
  closed = false;
  constructor(size) {
    for (let i = 0;i < size; i++) {
      this.workers.push(new WorkerEval(() => this.pump()));
    }
  }
  send(task, timeout) {
    if (this.closed) {
      throw new Error("\u043F\u0443\u043B \u0443\u0436\u0435 \u0437\u0430\u043A\u0440\u044B\u0442");
    }
    return new Promise((resolve2) => {
      this.jobs.push({
        task,
        timeout,
        handleResponse: (response, ms) => resolve2({ response, ms })
      });
      this.pump();
    });
  }
  close() {
    this.closed = true;
    for (const worker of this.workers) {
      worker.close();
    }
    for (const job of this.jobs) {
      job.handleResponse(DROPPED_RESPONSE, 0);
    }
    this.workers = [];
    this.jobs = [];
  }
  pump() {
    if (this.closed) {
      return;
    }
    while (this.jobs.length > 0) {
      const worker = this.workers.find((item) => item.free);
      if (worker === undefined) {
        return;
      }
      const job = this.jobs.shift();
      if (job === undefined) {
        return;
      }
      worker.run(job);
    }
  }
}

// src/storage/storage.ts
import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
function stripOutputs(record) {
  return {
    ...record,
    evals: record.evals.map((evalRecord) => ({
      ...evalRecord,
      cases: evalRecord.cases.map((item) => ({
        ...item,
        trials: item.trials.map(({ output, ...trial }) => trial)
      }))
    }))
  };
}
async function readLatest(path) {
  const file = Bun.file(path);
  if (await file.exists() === false) {
    return [];
  }
  const parsed = await file.json().catch(() => {
    return;
  });
  if (Array.isArray(parsed) === false) {
    return [];
  }
  return parsed;
}
async function writeRecord(root, record) {
  await mkdir(root, { recursive: true });
  await appendFile(join(root, "history.jsonl"), `${JSON.stringify(stripOutputs(record))}
`);
  const latestPath = join(root, "latest.json");
  const previous = await readLatest(latestPath);
  const next = [record, ...previous].slice(0, latestKeep);
  await Bun.write(latestPath, JSON.stringify(next, null, 2));
}

// src/cli/cli.ts
var EXIT_PASSED = 0;
var EXIT_FAILED = 1;
var EXIT_BROKEN = 2;
function pickConcurrency(cores) {
  if (typeof cores !== "number" || Number.isFinite(cores) === false || cores < 1) {
    return 1;
  }
  return Math.min(Math.floor(cores), defaultConcurrencyLimit);
}
function createParams() {
  return [
    new Param({
      name: "concurrency",
      type: "number",
      short: "c",
      defaultValue: pickConcurrency(navigator.hardwareConcurrency),
      description: `\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0432\u043E\u0440\u043A\u0435\u0440\u043E\u0432, \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E \u043F\u043E \u0447\u0438\u0441\u043B\u0443 \u044F\u0434\u0435\u0440, \u043D\u043E \u043D\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 ${defaultConcurrencyLimit}`
    }),
    new Param({
      name: "trials",
      type: "number",
      short: "t",
      defaultValue: defaultTrials,
      description: "\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0440\u0430\u0437 \u0437\u0430\u043F\u0443\u0441\u043A\u0430\u0442\u044C \u043A\u0430\u0436\u0434\u044B\u0439 \u043A\u0435\u0439\u0441"
    }),
    new Param({
      name: "retries",
      type: "number",
      short: "r",
      defaultValue: defaultRetries,
      description: "\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0432\u0442\u043E\u0440\u043E\u0432 \u043F\u0440\u0438 \u043F\u0430\u0434\u0435\u043D\u0438\u0438"
    }),
    new Param({
      name: "timeout",
      type: "number",
      description: "\u043C\u0441 \u043D\u0430 \u043F\u043E\u043F\u044B\u0442\u043A\u0443, \u043F\u0435\u0440\u0435\u0431\u0438\u0432\u0430\u0435\u0442 timeout \u043A\u0435\u0439\u0441\u0430"
    })
  ];
}
function createRoot() {
  const paths = [{ name: "paths", required: false, variadic: true }];
  return new Block({
    arg: globalArg,
    params: createParams(),
    positionals: paths,
    description: "ordeal \u2014 \u043F\u0440\u043E\u0433\u043E\u043D \u044D\u0432\u0430\u043B\u043E\u0432",
    children: [
      new Block({
        arg: "run",
        params: createParams(),
        positionals: paths,
        description: "\u043F\u0440\u043E\u0433\u043E\u043D \u044D\u0432\u0430\u043B\u043E\u0432 (\u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E)",
        children: []
      })
    ]
  });
}
function readArgs(argv) {
  const parsed = new Cli(createRoot()).parse(argv);
  const last = parsed[parsed.length - 1];
  if (last === undefined) {
    return;
  }
  const params = last.params;
  return {
    paths: last.positionals.paths ?? [],
    concurrency: params.concurrency,
    options: {
      trials: params.trials,
      retries: params.retries,
      timeout: params.timeout
    }
  };
}
async function runCli(argv, cwd) {
  const args = readArgs(argv);
  if (args === undefined) {
    return EXIT_PASSED;
  }
  const files = await findEvalFiles(args.paths, cwd);
  if (files.length === 0) {
    console.error("\u044D\u0432\u0430\u043B\u043E\u0432 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E");
    return EXIT_BROKEN;
  }
  const color = process.stdout.isTTY === true && Bun.env.NO_COLOR === undefined;
  const pool = new Pool(args.concurrency);
  try {
    const record = await runEvals({
      pool,
      files,
      options: args.options,
      reportTrial: (report) => console.log(formatTrialLine(report, color))
    });
    console.log("");
    console.log(formatReport(record, color));
    await writeRecord(join2(cwd, ORDEAL_DIR), record);
    const failed = record.evals.some((item) => item.passed < item.total);
    return failed ? EXIT_FAILED : EXIT_PASSED;
  } finally {
    pool.close();
  }
}
if (import.meta.main) {
  const code = await runCli(Bun.argv.slice(2), process.cwd()).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    return EXIT_BROKEN;
  });
  process.exit(code);
}
export {
  runCli,
  readArgs,
  pickConcurrency
};

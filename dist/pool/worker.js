// @bun
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

// src/eval/eval.ts
function createEval(name, fill) {
  if (name === "") {
    throw new Error("\u044D\u0432\u0430\u043B \u0431\u0435\u0437 \u0438\u043C\u0435\u043D\u0438: \u0438\u043C\u044F \u044D\u0442\u043E \u043A\u043B\u044E\u0447 \u0438\u0441\u0442\u043E\u0440\u0438\u0438");
  }
  const cases = [];
  const taken = new Set;
  const ctx = {
    createCase: (props, run) => {
      if (props.name === "") {
        throw new Error(`\u0432 \u044D\u0432\u0430\u043B\u0435 "${name}" \u043A\u0435\u0439\u0441 \u0431\u0435\u0437 \u0438\u043C\u0435\u043D\u0438: \u0438\u043C\u044F \u044D\u0442\u043E \u043A\u043B\u044E\u0447 \u0438\u0441\u0442\u043E\u0440\u0438\u0438`);
      }
      if (taken.has(props.name)) {
        throw new Error(`\u0432 \u044D\u0432\u0430\u043B\u0435 "${name}" \u043A\u0435\u0439\u0441 "${props.name}" \u043E\u0431\u044A\u044F\u0432\u043B\u0435\u043D \u0434\u0432\u0430\u0436\u0434\u044B`);
      }
      taken.add(props.name);
      cases.push({
        name: props.name,
        minScore: props.minScore,
        timeout: props.timeout,
        run
      });
    }
  };
  fill(ctx);
  return { [INSTANCE_KEY]: INSTANCE_VALUE, name, cases };
}
function checkEval(mayEval) {
  if (mayEval && typeof mayEval === "object" && INSTANCE_KEY in mayEval && mayEval[INSTANCE_KEY] === INSTANCE_VALUE) {
    return true;
  }
  return false;
}
function findEvals(module) {
  const found = [];
  for (const key in module) {
    const exported = module[key];
    if (checkEval(exported)) {
      found.push(exported);
    }
  }
  return found;
}

// src/pool/worker.ts
var controller;
function describeError(error) {
  if (error instanceof Error) {
    return {
      kind: "error",
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  return { kind: "error", name: "Error", message: String(error) };
}
async function loadEvals(file) {
  const evals = findEvals(await import(file));
  if (evals.length === 0) {
    throw new Error(`\u0432 \u0444\u0430\u0439\u043B\u0435 ${file} \u043D\u0435\u0442 \u043D\u0438 \u043E\u0434\u043D\u043E\u0433\u043E \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u0433\u043E \u044D\u0432\u0430\u043B\u0430`);
  }
  return evals;
}
function listEvals(evals) {
  return evals.map(({ name, cases }) => ({
    name,
    cases: cases.map(({ name: name2, minScore, timeout }) => ({
      name: name2,
      minScore,
      timeout
    }))
  }));
}
function readScore(returned) {
  const score = typeof returned === "number" ? returned : returned?.score;
  if (typeof score !== "number" || Number.isFinite(score) === false) {
    throw new Error(`\u043A\u0435\u0439\u0441 \u0434\u043E\u043B\u0436\u0435\u043D \u0432\u0435\u0440\u043D\u0443\u0442\u044C \u0447\u0438\u0441\u043B\u043E 0..100 \u0438\u043B\u0438 { score }, \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043E ${JSON.stringify(returned)}`);
  }
  if (score < 0 || score > 100) {
    throw new Error(`\u0431\u0430\u043B\u043B \u043A\u0435\u0439\u0441\u0430 ${score} \u0432\u043D\u0435 \u0448\u043A\u0430\u043B\u044B 0..100`);
  }
  return score;
}
self.onmessage = async (event) => {
  const request = event.data;
  if (request.kind === "abort") {
    controller?.abort();
    return;
  }
  try {
    const evals = await loadEvals(request.file);
    if (request.kind === "list") {
      self.postMessage({
        kind: "cases",
        evals: listEvals(evals)
      });
      return;
    }
    const caseEnt = evals.find((item) => item.name === request.evalName)?.cases.find((item) => item.name === request.caseName);
    if (caseEnt === undefined) {
      throw new Error(`\u043A\u0435\u0439\u0441 "${request.caseName}" \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432 \u044D\u0432\u0430\u043B\u0435 "${request.evalName}"`);
    }
    controller = new AbortController;
    const returned = await caseEnt.run(controller.signal);
    const output = typeof returned === "object" ? returned.output : undefined;
    self.postMessage({
      kind: "result",
      score: readScore(returned),
      output
    });
  } catch (error) {
    self.postMessage(describeError(error));
  } finally {
    controller = undefined;
  }
};

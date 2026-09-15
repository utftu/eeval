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
export {
  findEvals,
  createEval,
  checkEval
};

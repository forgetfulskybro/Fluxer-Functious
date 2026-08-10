const { parse } = require('./parser.js');
const { Interpreter } = require('./interpreter.js');
const { FluxerError, RuntimeError } = require('./errors.js');

const DEFAULT_LIMITS = Object.freeze({
  maxSteps: 200000,
  maxCallDepth: 100,
  maxOutputChars: 3900,
  maxEmbeds: 10,
});

function runTag(source, context = {}, limits = {}) {
  const ast = parse(source);
  const interpreter = new Interpreter(ast, context, { ...DEFAULT_LIMITS, ...limits });
  return interpreter.run();
}

function runTagSafe(source, context = {}, limits = {}) {
  try {
    return { ok: true, result: runTag(source, context, limits) };
  } catch (e) {
    if (e instanceof FluxerError) return { ok: false, error: e };
    return { ok: false, error: new RuntimeError(`internal error: ${e?.message ?? e}`) };
  }
}

module.exports = { DEFAULT_LIMITS, runTag, runTagSafe }
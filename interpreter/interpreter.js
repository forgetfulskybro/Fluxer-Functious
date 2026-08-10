const { RuntimeError, LimitError } = require('./errors.js');
const { tokenize } = require('./lexer.js');
const { Parser } = require('./parser.js');
const { createStdlib, isEmbed, toStr, toNum, toBool, fmtNum, typeName } = require('./stdlib.js');
const { EmbedBuilder } = require('./embed.js');

class BreakSignal {}
class ContinueSignal {}
class StopSignal {}
class ReturnSignal {
  constructor(value) {
    this.value = value;
  }
}

class Environment {
  constructor(parent = null) {
    this.vars = new Map();
    this.parent = parent;
  }

  define(name, value) {
    this.vars.set(name, value);
  }

  has(name) {
    let env = this;
    while (env) {
      if (env.vars.has(name)) return true;
      env = env.parent;
    }
    return false;
  }

  get(name) {
    let env = this;
    while (env) {
      if (env.vars.has(name)) return env.vars.get(name);
      env = env.parent;
    }
    return undefined;
  }

  assign(name, value) {
    let env = this;
    while (env) {
      if (env.vars.has(name)) {
        env.vars.set(name, value);
        return true;
      }
      env = env.parent;
    }
    return false;
  }
}

class FluxerFunction {
  constructor(name, params, body, closure) {
    this.kind = 'user-function';
    this.name = name || '<anonymous>';
    this.params = params;
    this.body = body;
    this.closure = closure;
  }
}

class OutputBuffer {
  constructor(limits) {
    this.limits = limits;
    this.parts = [];
    this.embedCount = 0;
    this.textLength = 0;
  }

  valueToText(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return fmtNum(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v === null) return 'null';
    if (v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    if (v != null && v.kind === 'function') return `<function ${v.name}>`;
    if (Array.isArray(v)) return JSON.stringify(v);
    if (typeof v === 'object') return JSON.stringify(v, null, 2);
    return String(v);
  }

  say(values) {
    const chunks = [];
    for (const v of values) {
      if (isEmbed(v)) {
        if (chunks.length) this.pushText(chunks.join(' '));
        if (this.embedCount >= this.limits.maxEmbeds) {
          throw new LimitError(`too many embeds (max ${this.limits.maxEmbeds} per tag)`);
        }
        this.embedCount += 1;
        this.parts.push({ type: 'embed', value: v.toJSON() });
        chunks.length = 0;
      } else {
        chunks.push(this.valueToText(v));
      }
    }
    if (chunks.length) this.pushText(chunks.join(' '));
  }

  pushText(text) {
    if (!text) return;
    this.parts.push({ type: 'text', value: text });
    this.textLength += text.length;
    if (this.textLength > this.limits.maxOutputChars) {
      throw new LimitError(`tag output exceeds ${this.limits.maxOutputChars} characters`);
    }
  }

  finish() {
    const text = this.parts.filter((p) => p.type === 'text').map((p) => p.value).join('\n');
    const embeds = this.parts.filter((p) => p.type === 'embed').map((p) => p.value);
    return { parts: this.parts, text, embeds };
  }
}





function isDict(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !isEmbed(v) && !(v instanceof Date) && !(v instanceof EmbedBuilder);
}

function looseEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
  if (typeof a === 'string' && typeof b === 'number') return Number(a) === b;
  if (typeof a === 'boolean') return a === toBool(b);
  if (typeof b === 'boolean') return toBool(a) === b;
  if (a === null || a === undefined || b === null || b === undefined) return (a == null) === (b == null);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => looseEqual(x, b[i]));
  }
  if (isDict(a) && isDict(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => looseEqual(a[k], b[k]));
  }
  return Object.is(a, b);
}





class Interpreter {
  constructor(ast, context = {}, limits = {}) {
    this.ast = ast;
    this.context = context;
    this.limits = {
      maxSteps: limits.maxSteps ?? 200000,
      maxCallDepth: limits.maxCallDepth ?? 100,
      maxOutputChars: limits.maxOutputChars ?? 3900,
      maxEmbeds: limits.maxEmbeds ?? 10,
    };
    this.global = new Environment();
    this.steps = 0;
    this.callDepth = 0;
    this.output = new OutputBuffer(this.limits);
    this._exprCache = new Map();
    this.rt = {
      output: this.output,
      checkStep: () => this.checkStep(),
      callFunction: (fn, args) => this.callFunction(fn, args),
    };
    this.builtins = createStdlib(this.rt);
    this.methodTables = {
      array: this.builtins.get('memberArray').methods,
      string: this.builtins.get('memberString').methods,
      dict: this.builtins.get('memberDict').methods,
    };
    this.methodAliases = {
      array: this.builtins.get('memberArray').aliases,
      string: this.builtins.get('memberString').aliases,
      dict: this.builtins.get('memberDict').aliases,
    };
  }

  checkStep() {
    this.steps += 1;
    if (this.steps > this.limits.maxSteps) {
      throw new LimitError(`tag exceeded the ${this.limits.maxSteps} step limit (possible infinite loop)`);
    }
  }

  run() {
    this.global.define('pi', Math.PI);
    this.global.define('e', Math.E);
    this.global.define('args', Array.isArray(this.context?.args) ? this.context.args : []);
    for (const [name, fn] of this.builtins) {
      if (fn.kind === 'function') this.global.define(name, fn);
    }

    try {
      this.executeStatements(this.ast.body, this.global);
    } catch (e) {
      if (e instanceof StopSignal) {
      } else if (e instanceof ReturnSignal) {
        this.output.say([e.value]);
      } else {
        throw e;
      }
    }
    return this.output.finish();
  }

  executeStatements(list, env) {
    const stmts = list && list.type === 'Block' ? list.body : list;
    for (const stmt of stmts) {
      this.executeStatement(stmt, env);
    }
  }

  executeBlock(node, env) {
    this.executeStatements(node.body, env);
  }

  executeStatement(stmt, env) {
    this.checkStep();
    switch (stmt.type) {
      case 'VariableDeclaration': {
        const value = stmt.init ? this.evaluate(stmt.init, env) : undefined;
        env.define(stmt.name, value);
        return;
      }
      case 'ExpressionStatement':
        this.evaluate(stmt.expression, env);
        return;
      case 'FunctionDeclaration': {
        const fn = new FluxerFunction(stmt.name, stmt.params, stmt.body, env);
        env.define(stmt.name, fn);
        return;
      }
      case 'If': {
        const cond = toBool(this.evaluate(stmt.test, env));
        if (cond) {
          this.executeBlock(stmt.consequent, env);
        } else if (stmt.alternate) {
          this.executeBlock(stmt.alternate, env);
        }
        return;
      }
      case 'While': {
        while (toBool(this.evaluate(stmt.test, env))) {
          this.checkStep();
          try {
            this.executeBlock(stmt.body, env);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }
      case 'ForClassic': {
        if (stmt.init) {
          if (stmt.init.type === 'VariableDeclaration') this.executeStatement(stmt.init, env);
          else this.evaluate(stmt.init, env);
        }
        for (;;) {
          this.checkStep();
          if (stmt.cond && !toBool(this.evaluate(stmt.cond, env))) break;
          try {
            this.executeBlock(stmt.body, env);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (!(e instanceof ContinueSignal)) throw e;
          }
          if (stmt.inc) this.evaluate(stmt.inc, env);
        }
        return;
      }
      case 'ForIn': {
        const iterable = this.evaluate(stmt.iterable, env);
        if (typeof iterable === 'number') {
          const n = Math.trunc(iterable);
          for (let i = 0; i < n; i++) {
            this.checkStep();
            env.define(stmt.name, i);
            try {
              this.executeBlock(stmt.body, env);
            } catch (e) {
              if (e instanceof BreakSignal) break;
              if (!(e instanceof ContinueSignal)) throw e;
            }
          }
          return;
        }
        let items;
        if (Array.isArray(iterable)) items = iterable;
        else if (typeof iterable === 'string') items = [...iterable];
        else if (isDict(iterable)) items = Object.keys(iterable);
        else throw new RuntimeError(`cannot iterate over ${typeName(iterable)}`);
        for (const item of items) {
          this.checkStep();
          env.define(stmt.name, item);
          try {
            this.executeBlock(stmt.body, env);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (!(e instanceof ContinueSignal)) throw e;
          }
        }
        return;
      }
      case 'Switch': {
        const disc = this.evaluate(stmt.disc, env);
        for (const c of stmt.cases) {
          if (looseEqual(disc, this.evaluate(c.test, env))) {
            this.runCaseBody(c.body, env);
            return;
          }
        }
        if (stmt.defaultBody) this.runCaseBody(stmt.defaultBody, env);
        return;
      }
      case 'Return': {
        const value = stmt.value ? this.evaluate(stmt.value, env) : undefined;
        throw new ReturnSignal(value);
      }
      case 'Break':
        throw new BreakSignal();
      case 'Continue':
        throw new ContinueSignal();
      case 'Stop':
        throw new StopSignal();
      case 'Block':
        this.executeBlock(stmt, env);
        return;
      default:
        throw new RuntimeError(`unknown statement '${stmt.type}'`);
    }
  }

  runCaseBody(body, env) {
    try {
      this.executeStatements(body, env);
    } catch (e) {
      if (e instanceof BreakSignal) return;
      throw e;
    }
  }

  evaluate(node, env) {
    switch (node.type) {
      case 'Literal':
        return node.value;
      case 'Identifier': {
        if (!env.has(node.name)) {
          throw new RuntimeError(`undefined variable '${node.name}'`, node.line, node.col);
        }
        return env.get(node.name);
      }
      case 'Global': {
        const v = this.context ? this.context[node.name] : undefined;
        if (v === undefined) {
          throw new RuntimeError(`context value '$${node.name}' is not available here`, node.line, node.col);
        }
        return v;
      }
      case 'Template':
        return this.evaluateTemplate(node, env);
      case 'ArrayLiteral':
        return node.elements.map((el) => this.evaluate(el, env));
      case 'DictLiteral': {
        const out = {};
        for (const prop of node.props) out[prop.key] = this.evaluate(prop.value, env);
        return out;
      }
      case 'Unary': {
        const operand = this.evaluate(node.operand, env);
        if (node.op === '!' || node.op === 'not') return !toBool(operand);
        if (node.op === '-') return -toNum(operand);
        if (node.op === '+') return +toNum(operand);
        throw new RuntimeError(`unknown unary operator '${node.op}'`);
      }
      case 'Binary':
        return this.evaluateBinary(node, env);
      case 'Logical':
        return this.evaluateLogical(node, env);
      case 'Ternary':
        return toBool(this.evaluate(node.cond, env))
          ? this.evaluate(node.consequent, env)
          : this.evaluate(node.alternate, env);
      case 'Assign':
        return this.evaluateAssign(node, env);
      case 'Postfix':
        return this.evaluatePostfix(node, env);
      case 'Member':
        return this.evaluateMember(node, env);
      case 'Call':
        return this.evaluateCall(node, env);
      case 'FunctionExpression': {
        const fn = new FluxerFunction(node.name, node.params, node.body, env);
        if (node.name) env.define(node.name, fn);
        return fn;
      }
      default:
        throw new RuntimeError(`unknown expression '${node.type}'`);
    }
  }

  evaluateTemplate(node, env) {
    let out = '';
    for (const part of node.parts) {
      if (part.type === 'text') out += part.value;
      else out += toStr(this.evaluateParsed(part.source, env));
    }
    return out;
  }

  evaluateParsed(source, env) {
    let expr = this._exprCache.get(source);
    if (!expr) {
      expr = new Parser(tokenize(source)).parseExpression();
      this._exprCache.set(source, expr);
    }
    return this.evaluate(expr, env);
  }

  evaluateBinary(node, env) {
    const left = this.evaluate(node.left, env);
    const right = this.evaluate(node.right, env);
    const op = node.op;

    switch (op) {
      case '+': {
        if (typeof left === 'number' && typeof right === 'number') return left + right;
        if (typeof left === 'string' || typeof right === 'string') return toStr(left) + toStr(right);
        if (Array.isArray(left) && Array.isArray(right)) return left.concat(right);
        throw new RuntimeError(`cannot add ${typeName(left)} and ${typeName(right)}`, node.line, node.col);
      }
      case '-':
        return toNum(left) - toNum(right);
      case '*':
        return toNum(left) * toNum(right);
      case '/': {
        const d = toNum(right);
        if (d === 0) throw new RuntimeError('division by zero', node.line, node.col);
        return toNum(left) / d;
      }
      case '%': {
        const d = toNum(right);
        if (d === 0) throw new RuntimeError('division by zero', node.line, node.col);
        return toNum(left) % d;
      }
      case '**':
        return toNum(left) ** toNum(right);
      case '<':
        return this.compare(left, right) < 0;
      case '<=':
        return this.compare(left, right) <= 0;
      case '>':
        return this.compare(left, right) > 0;
      case '>=':
        return this.compare(left, right) >= 0;
      case '==':
      case '===':
        return looseEqual(left, right);
      case '!=':
      case '!==':
        return !looseEqual(left, right);
      case 'in': {
        if (typeof right === 'string') return toStr(right).includes(toStr(left));
        if (Array.isArray(right)) return right.some((x) => looseEqual(x, left));
        if (isDict(right)) return Object.prototype.hasOwnProperty.call(right, String(left));
        throw new RuntimeError(`'in' requires a string, array or dict on the right`, node.line, node.col);
      }
      default:
        throw new RuntimeError(`unknown binary operator '${op}'`, node.line, node.col);
    }
  }

  compare(left, right) {
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return toStr(left).localeCompare(toStr(right));
  }

  evaluateLogical(node, env) {
    const left = this.evaluate(node.left, env);
    if (node.op === '&&' || node.op === 'and') {
      return toBool(left) ? this.evaluate(node.right, env) : left;
    }
    return toBool(left) ? left : this.evaluate(node.right, env);
  }

  evaluateAssign(node, env) {
    const value = this.evaluate(node.value, env);
    if (node.op === '=') {
      return this.setLValue(node.target, env, value);
    }
    const current = this.getLValue(node.target, env);
    let result;
    if (node.op === '+=') {
      if (typeof current === 'string' || typeof value === 'string') result = toStr(current) + toStr(value);
      else result = toNum(current) + toNum(value);
    } else {
      result = toNum(current);
      const v = toNum(value);
      if (node.op === '-=') result -= v;
      else if (node.op === '*=') result *= v;
      else if (node.op === '/=') {
        if (v === 0) throw new RuntimeError('division by zero', node.line, node.col);
        result /= v;
      } else if (node.op === '%=') {
        if (v === 0) throw new RuntimeError('division by zero', node.line, node.col);
        result %= v;
      } else if (node.op === '**=') result **= v;
      else throw new RuntimeError(`unknown assignment operator '${node.op}'`, node.line, node.col);
    }
    return this.setLValue(node.target, env, result);
  }

  evaluatePostfix(node, env) {
    const current = this.getLValue(node.target, env);
    const next = toNum(current) + (node.op === '++' ? 1 : -1);
    return this.setLValue(node.target, env, next);
  }

  getLValue(node, env) {
    if (node.type === 'Identifier') {
      if (!env.has(node.name)) {
        throw new RuntimeError(`undefined variable '${node.name}'`, node.line, node.col);
      }
      return env.get(node.name);
    }
    if (node.type === 'Member') return this.evaluateMember(node, env);
    throw new RuntimeError('invalid assignment target', node.line, node.col);
  }

  setLValue(node, env, value) {
    if (node.type === 'Identifier') {
      if (!env.assign(node.name, value)) env.define(node.name, value);
      return value;
    }
    if (node.type === 'Member') {
      const obj = this.evaluate(node.object, env);
      const prop = node.computed ? this.evaluate(node.property, env) : node.property;
      this.setProperty(obj, prop, value, node);
      return value;
    }
    throw new RuntimeError('invalid assignment target', node.line, node.col);
  }

  evaluateMember(node, env) {
    const obj = this.evaluate(node.object, env);
    const prop = node.computed ? this.evaluate(node.property, env) : node.property;
    return this.getProperty(obj, prop, node);
  }

  evaluateCall(node, env) {
    const callee = this.evaluate(node.callee, env);
    const args = node.args.map((a) => this.evaluate(a, env));
    if (callee && callee.kind === 'bound') callee.args = args;
    return this.callFunction(callee, args);
  }

  callFunction(fn, args) {
    this.checkStep();
    this.callDepth += 1;
    if (this.callDepth > this.limits.maxCallDepth) {
      throw new LimitError(`call depth exceeded (max ${this.limits.maxCallDepth}) * possible infinite recursion`);
    }
    try {
      if (fn instanceof FluxerFunction) {
        return this.invokeUserFunction(fn, args);
      }
      if (fn && fn.kind === 'function') {
        return fn.callable(args);
      }
      if (fn && fn.kind === 'bound') {
        return this.invokeMember(fn);
      }
      throw new RuntimeError(`${typeName(fn)} is not a function`);
    } finally {
      this.callDepth -= 1;
    }
  }

  invokeUserFunction(fn, args) {
    const env = new Environment(fn.closure);
    for (let i = 0; i < fn.params.length; i++) env.define(fn.params[i], args[i]);
    try {
      this.executeStatements(fn.body, env);
      return undefined;
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    }
  }

  invokeMember(bound) {
    const { self, name, table, native, args } = bound;
    if (native) {
      const m = self[name];
      if (typeof m !== 'function') throw new RuntimeError(`'${name}' is not a function`);
      return m.apply(self, args);
    }
    const map = this.methodTables[table];
    const alias = this.methodAliases[table];
    let methodName = name;
    if (alias && alias[methodName]) methodName = alias[methodName];
    const method = map[methodName];
    if (!method) throw new RuntimeError(`no method '${name}' on ${typeName(self)}`);
    return method(self, args, this.rt);
  }

  
  
  

  getProperty(obj, prop, node) {
    if (obj === null || obj === undefined) {
      throw new RuntimeError(`cannot read property '${typeof prop === 'string' ? prop : String(prop)}' of ${typeName(obj)}`, node?.line, node?.col);
    }
    if (typeof prop === 'number' && Array.isArray(obj)) {
      const i = Math.trunc(prop);
      return i >= 0 && i < obj.length ? obj[i] : undefined;
    }
    if (Array.isArray(obj)) {
      const key = String(prop);
      if (key === 'length') return obj.length;
      const table = this.methodTables.array;
      if (table[key] || (this.methodAliases.array[key] && table[this.methodAliases.array[key]])) {
        return { kind: 'bound', self: obj, name: key, table: 'array', args: [] };
      }
      return undefined;
    }
    if (typeof obj === 'string') {
      const key = String(prop);
      if (key === 'length') return obj.length;
      const table = this.methodTables.string;
      if (table[key] || (this.methodAliases.string[key] && table[this.methodAliases.string[key]])) {
        return { kind: 'bound', self: obj, name: key, table: 'string', args: [] };
      }
      return undefined;
    }
    if (obj instanceof EmbedBuilder) {
      const key = String(prop);
      if (typeof obj[key] === 'function') {
        return { kind: 'bound', self: obj, name: key, native: true, args: [] };
      }
      return undefined;
    }
    if (isDict(obj)) {
      const key = String(prop);
      if (key === 'length') return Object.keys(obj).length;
      if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
      const table = this.methodTables.dict;
      if (table[key] || (this.methodAliases.dict[key] && table[this.methodAliases.dict[key]])) {
        return { kind: 'bound', self: obj, name: key, table: 'dict', args: [] };
      }
      return undefined;
    }
    return undefined;
  }

  setProperty(obj, prop, value, node) {
    if (Array.isArray(obj)) {
      if (typeof prop !== 'number') throw new RuntimeError('array index must be a number', node?.line, node?.col);
      const i = Math.trunc(prop);
      if (i < 0) throw new RuntimeError('array index cannot be negative', node?.line, node?.col);
      obj[i] = value;
      return;
    }
    if (isDict(obj)) {
      obj[String(prop)] = value;
      return;
    }
    throw new RuntimeError('cannot set a property on this value', node?.line, node?.col);
  }
}

module.exports = { Interpreter, FluxerFunction, Environment };
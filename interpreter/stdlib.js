const { RuntimeError } = require('./errors.js');
const { embed } = require('./embed.js');

function isEmbed(v) {
  return v != null && v._isFluxerEmbed === true;
}

function fmtNum(n) {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toPrecision(12)));
}

function toArray(v, what = 'value') {
  if (Array.isArray(v)) return v;
  throw new RuntimeError(`expected an array for '${what}'`);
}

function toStr(v, what = 'value') {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v === null) return 'null';
  if (v === undefined) return '';
  if (isEmbed(v)) return v.toString();
  return JSON.stringify(v);
}

function toNum(v, what = 'value') {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    if (!Number.isNaN(n)) return n;
  }
  throw new RuntimeError(`expected a number for '${what}', got ${typeName(v)}`);
}

function toInt(v, what = 'value') {
  const n = toNum(v, what);
  return Math.trunc(n);
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (v === null || v === undefined) return false;
  return true;
}

function typeName(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  if (isEmbed(v)) return 'embed';
  if (isCallable(v)) return 'function';
  if (v instanceof Date) return 'date';
  return typeof v;
}

function isCallable(v) {
  return v != null && (v.kind === 'function' || v.kind === 'user-function' || v.kind === 'methods');
}

function safeSlice(arr, start, end) {
  const len = arr.length;
  let s = start == null ? 0 : start;
  let e = end == null ? len : end;
  if (s < 0) s = Math.max(0, len + s);
  if (e < 0) e = Math.max(0, len + e);
  s = Math.min(s, len);
  e = Math.min(e, len);
  return [s, e];
}

function implSplit(s, sep) {
  if (sep === undefined) {
    return s.split(/\s+/).filter((w) => w.length > 0);
  }
  if (sep === '') return [...s];
  return s.split(String(sep));
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function implStrftime(date, format) {
  const map = {
    Y: String(date.getUTCFullYear()).padStart(4, '0'),
    m: String(date.getUTCMonth() + 1).padStart(2, '0'),
    d: String(date.getUTCDate()).padStart(2, '0'),
    H: String(date.getUTCHours()).padStart(2, '0'),
    M: String(date.getUTCMinutes()).padStart(2, '0'),
    S: String(date.getUTCSeconds()).padStart(2, '0'),
    y: String(date.getUTCFullYear()).slice(-2),
    b: MONTHS_SHORT[date.getUTCMonth()],
    B: MONTHS_FULL[date.getUTCMonth()],
    z: '+0000',
    L: String(date.getUTCMilliseconds()).padStart(3, '0'),
  };
  return format.replace(/%([YmdHMSyBbzL])/g, (m, c) => map[c] ?? m);
}

function toDate(v, what = 'value') {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new RuntimeError(`expected a date/timestamp for '${what}'`);
}

function lengthOf(v) {
  if (v == null) throw new RuntimeError('len() of null/undefined');
  if (typeof v === 'string') return v.length;
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'object' && !isEmbed(v) && !(v instanceof Date)) return Object.keys(v).length;
  throw new RuntimeError(`len() not supported for ${typeName(v)}`);
}

function toRegex(pattern) {
  if (pattern && typeof pattern === 'object' && pattern.kind === 'regex') {
    return new RegExp(pattern.source, pattern.flags);
  }
  return new RegExp(toStr(pattern));
}

function resolveId(v) {
  if (v == null) throw new RuntimeError('mention requires an id or context object');
  if (typeof v === 'object') {
    return String(v.id ?? v.user?.id ?? v.author?.id ?? '');
  }
  return String(v);
}

function toUserDict(u) {
  if (u == null) return {};
  if (typeof u !== 'object') return { username: String(u) };
  return u;
}





function implSort(arr, keyFn) {
  const copy = arr.slice();
  copy.sort((a, b) => {
    const x = keyFn ? keyFn(a) : a;
    const y = keyFn ? keyFn(b) : b;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return toStr(x).localeCompare(toStr(y));
  });
  return copy;
}

function mapCallback(rt, fn, value, index, array) {
  return rt.callFunction(fn, [value, index, array]);
}





const ARRAY_METHODS = {
  push(self, args) {
    for (const a of args) self.push(a);
    return self.length;
  },
  pop(self) {
    return toArray(self).pop();
  },
  shift(self) {
    return toArray(self).shift();
  },
  unshift(self, args) {
    toArray(self).unshift(...args);
    return self.length;
  },
  join(self, args) {
    return toArray(self).map((x) => toStr(x)).join(String(args[0] ?? ', '));
  },
  reverse(self) {
    return toArray(self).slice().reverse();
  },
  sort(self, args, rt) {
    const fn = args[0];
    if (isCallable(fn)) {
      return implSort(toArray(self), (a) => rt.callFunction(fn, [a]));
    }
    return implSort(toArray(self));
  },
  slice(self, args) {
    const arr = toArray(self);
    const [s, e] = safeSlice(arr, args[0], args[1]);
    return arr.slice(s, e);
  },
  indexOf(self, args) {
    return toArray(self).findIndex((x) => Object.is(x, args[0]));
  },
  includes(self, args) {
    return toArray(self).some((x) => Object.is(x, args[0]));
  },
  concat(self, args) {
    let out = toArray(self).slice();
    for (const a of args) {
      if (Array.isArray(a)) out = out.concat(a);
      else out.push(a);
    }
    return out;
  },
  map(self, args, rt) {
    const fn = args[0];
    if (!isCallable(fn)) throw new RuntimeError('map requires a function');
    return toArray(self).map((v, i) => mapCallback(rt, fn, v, i, self));
  },
  filter(self, args, rt) {
    const fn = args[0];
    if (!isCallable(fn)) throw new RuntimeError('filter requires a function');
    return toArray(self).filter((v, i) => toBool(mapCallback(rt, fn, v, i, self)));
  },
  forEach(self, args, rt) {
    const fn = args[0];
    if (!isCallable(fn)) throw new RuntimeError('forEach requires a function');
    for (let i = 0; i < self.length; i++) mapCallback(rt, fn, self[i], i, self);
    return null;
  },
  reduce(self, args, rt) {
    const fn = args[0];
    if (!isCallable(fn)) throw new RuntimeError('reduce requires a function');
    const arr = toArray(self);
    let acc = args[1];
    let i = 0;
    if (acc === undefined) {
      if (arr.length === 0) throw new RuntimeError('reduce of empty array with no initial value');
      acc = arr[0];
      i = 1;
    }
    for (; i < arr.length; i++) {
      acc = rt.callFunction(fn, [acc, arr[i], i, arr]);
    }
    return acc;
  },
  find(self, args, rt) {
    const fn = args[0];
    if (!isCallable(fn)) throw new RuntimeError('find requires a function');
    for (let i = 0; i < self.length; i++) {
      if (toBool(mapCallback(rt, fn, self[i], i, self))) return self[i];
    }
    return null;
  },
  some(self, args, rt) {
    const fn = args[0];
    if (!isCallable(fn)) throw new RuntimeError('some requires a function');
    for (let i = 0; i < self.length; i++) {
      if (toBool(mapCallback(rt, fn, self[i], i, self))) return true;
    }
    return false;
  },
  every(self, args, rt) {
    const fn = args[0];
    if (!isCallable(fn)) throw new RuntimeError('every requires a function');
    for (let i = 0; i < self.length; i++) {
      if (!toBool(mapCallback(rt, fn, self[i], i, self))) return false;
    }
    return true;
  },
  flatten(self) {
    return toArray(self).flat(1);
  },
  unique(self) {
    const seen = new Set();
    const out = [];
    for (const x of toArray(self)) {
      if (!seen.has(x)) {
        seen.add(x);
        out.push(x);
      }
    }
    return out;
  },
  sum(self) {
    return toArray(self).reduce((a, b) => a + toNum(b), 0);
  },
  first(self) {
    return toArray(self)[0];
  },
  last(self) {
    const arr = toArray(self);
    return arr[arr.length - 1];
  },
};

const STRING_METHODS = {
  toLowerCase(self) {
    return toStr(self).toLowerCase();
  },
  toUpperCase(self) {
    return toStr(self).toUpperCase();
  },
  trim(self) {
    return toStr(self).trim();
  },
  split(self, args) {
    return implSplit(toStr(self), args[0]);
  },
  replace(self, args) {
    const s = toStr(self);
    const from = toStr(args[0]);
    const to = toStr(args[1] ?? '');
    if (from === '') return s;
    return s.split(from).join(to);
  },
  substring(self, args) {
    const s = toStr(self);
    const [st, e] = safeSlice(s, args[0], args[1]);
    return s.slice(st, e);
  },
  substr(self, args) {
    const s = toStr(self);
    const start = toInt(args[0]);
    const len = args[1] === undefined ? s.length - start : toInt(args[1]);
    return s.substr(start, len);
  },
  indexOf(self, args) {
    return toStr(self).indexOf(toStr(args[0]));
  },
  startsWith(self, args) {
    return toStr(self).startsWith(toStr(args[0]));
  },
  endsWith(self, args) {
    return toStr(self).endsWith(toStr(args[0]));
  },
  includes(self, args) {
    return toStr(self).includes(toStr(args[0]));
  },
  repeat(self, args) {
    const n = toInt(args[0]);
    if (n < 0) throw new RuntimeError('repeat count cannot be negative');
    return toStr(self).repeat(n);
  },
  charAt(self, args) {
    const s = toStr(self);
    const i = toInt(args[0]);
    return s[i] ?? '';
  },
  count(self, args) {
    const s = toStr(self);
    const sub = toStr(args[0]);
    if (sub === '') return 0;
    return s.split(sub).length - 1;
  },
  reverse(self) {
    return [...toStr(self)].reverse().join('');
  },
  capitalize(self) {
    const s = toStr(self);
    return s.length ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
  },
  title(self) {
    return toStr(self).replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  },
  padStart(self, args) {
    return toStr(self).padStart(toInt(args[0]), toStr(args[1] ?? ' '));
  },
  padEnd(self, args) {
    return toStr(self).padEnd(toInt(args[0]), toStr(args[1] ?? ' '));
  },
  lines(self) {
    return toStr(self).split('\n');
  },
};

const DICT_METHODS = {
  keys(self) {
    return Object.keys(self);
  },
  values(self) {
    return Object.values(self);
  },
  entries(self) {
    return Object.entries(self).map(([k, v]) => [k, v]);
  },
  has(self, args) {
    return Object.prototype.hasOwnProperty.call(self, String(args[0]));
  },
  get(self, args) {
    const k = String(args[0]);
    if (Object.prototype.hasOwnProperty.call(self, k)) return self[k];
    return args[1];
  },
  set(self, args) {
    self[String(args[0])] = args[1];
    return self;
  },
  delete(self, args) {
    const k = String(args[0]);
    const had = Object.prototype.hasOwnProperty.call(self, k);
    delete self[k];
    return had;
  },
  merge(self, args) {
    const out = { ...self };
    for (const a of args) {
      if (a == null || typeof a !== 'object') continue;
      Object.assign(out, a);
    }
    return out;
  },
  update(self, args) {
    for (const a of args) {
      if (a == null || typeof a !== 'object') continue;
      Object.assign(self, a);
    }
    return self;
  },
  copy(self) {
    return { ...self };
  },
  length(self) {
    return Object.keys(self).length;
  },
};


const ARRAY_ALIASES = { append: 'push', contains: 'includes' };
const STRING_ALIASES = {
  lower: 'toLowerCase',
  lowercase: 'toLowerCase',
  upper: 'toUpperCase',
  uppercase: 'toUpperCase',
  strip: 'trim',
  slice: 'substring',
  startswith: 'startsWith',
  endswith: 'endsWith',
  contains: 'includes',
  lpad: 'padStart',
  rpad: 'padEnd',
};
const DICT_ALIASES = {
  items: 'entries',
  hasKey: 'has',
  hasOwn: 'has',
  remove: 'delete',
  extend: 'merge',
  clone: 'copy',
  size: 'length',
};





function createStdlib(rt) {
  const builtins = new Map();
  const def = (name, fn) => builtins.set(name, { kind: 'function', name, callable: fn });
  const a = (v, i = 0) => v[i];
  const str = (v) => toStr(v);

  
  def('say', (args) => {
    rt.output.say(args);
    return null;
  });
  def('echo', (args) => {
    rt.output.say(args);
    return null;
  });

  
  def('min', (args) => Math.min(...args.map((x) => toNum(x))));
  def('max', (args) => Math.max(...args.map((x) => toNum(x))));
  def('abs', (args) => Math.abs(toNum(a(args))));
  def('floor', (args) => Math.floor(toNum(a(args))));
  def('ceil', (args) => Math.ceil(toNum(a(args))));
  def('round', (args) => {
    const n = toNum(a(args));
    const d = args[1] === undefined ? 0 : toInt(args[1]);
    const f = 10 ** d;
    return Math.round(n * f) / f;
  });
  def('sqrt', (args) => Math.sqrt(toNum(a(args))));
  def('pow', (args) => Math.pow(toNum(a(args)), toNum(args[1])));
  def('sin', (args) => Math.sin(toNum(a(args))));
  def('cos', (args) => Math.cos(toNum(a(args))));
  def('tan', (args) => Math.tan(toNum(a(args))));
  def('log', (args) => Math.log(toNum(a(args))));
  def('log10', (args) => Math.log10(toNum(a(args))));
  def('exp', (args) => Math.exp(toNum(a(args))));
  def('clamp', (args) => {
    const n = toNum(a(args));
    return Math.max(toNum(args[1]), Math.min(toNum(args[2]), n));
  });
  def('range', (args) => {
    let start = 0;
    let end;
    let step = 1;
    const nums = args.map((x) => toInt(x));
    if (nums.length === 1) [end] = nums;
    else if (nums.length === 2) [start, end] = nums;
    else if (nums.length >= 3) [start, end, step] = nums;
    if (step === 0) throw new RuntimeError('range step cannot be 0');
    const out = [];
    if (step > 0) {
      for (let i = start; i < end; i += step) {
        out.push(i);
        rt.checkStep();
      }
    } else {
      for (let i = start; i > end; i += step) {
        out.push(i);
        rt.checkStep();
      }
    }
    return out;
  });

  
  def('random', () => Math.random());
  def('rand', () => Math.random());
  def('randomFloat', (args) => {
    const lo = args[0] === undefined ? 0 : toNum(args[0]);
    const hi = args[1] === undefined ? 1 : toNum(args[1]);
    return lo + Math.random() * (hi - lo);
  });
  def('randomInt', (args) => {
    const lo = Math.ceil(toNum(a(args)));
    const hi = Math.floor(toNum(args[1]));
    if (lo > hi) throw new RuntimeError(`randomInt: min (${lo}) is greater than max (${hi})`);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  });
  def('randint', (args) => builtins.get('randomInt').callable(args));
  def('choose', (args) => {
    const arr = toArray(a(args), 'choose');
    if (arr.length === 0) throw new RuntimeError('choose: array is empty');
    return arr[Math.floor(Math.random() * arr.length)];
  });
  def('shuffle', (args) => {
    const arr = toArray(a(args), 'shuffle').slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  });

  
  def('str', (args) => toStr(a(args)));
  def('string', (args) => toStr(a(args)));
  def('lower', (args) => toStr(a(args)).toLowerCase());
  def('lowercase', (args) => toStr(a(args)).toLowerCase());
  def('toLower', (args) => toStr(a(args)).toLowerCase());
  def('toLowerCase', (args) => toStr(a(args)).toLowerCase());
  def('upper', (args) => toStr(a(args)).toUpperCase());
  def('uppercase', (args) => toStr(a(args)).toUpperCase());
  def('toUpper', (args) => toStr(a(args)).toUpperCase());
  def('toUpperCase', (args) => toStr(a(args)).toUpperCase());
  def('capitalize', (args) => STRING_METHODS.capitalize(str(a(args)), []));
  def('title', (args) => STRING_METHODS.title(str(a(args)), []));
  def('titlecase', (args) => STRING_METHODS.title(str(a(args)), []));
  def('strip', (args) => toStr(a(args)).trim());
  def('trim', (args) => toStr(a(args)).trim());
  def('lstrip', (args) => toStr(a(args)).replace(/^\s+/, ''));
  def('rstrip', (args) => toStr(a(args)).replace(/\s+$/, ''));
  def('split', (args) => implSplit(toStr(a(args)), args[1]));
  def('join', (args) => {
    const first = a(args);
    if (Array.isArray(first)) {
      const sep = args[1] === undefined ? ', ' : toStr(args[1]);
      return first.map((x) => toStr(x)).join(sep);
    }
    const sep = toStr(first);
    const arr = Array.isArray(args[1]) ? args[1] : toArray(args[1], 'join');
    return arr.map((x) => toStr(x)).join(sep);
  });
  def('replace', (args) => STRING_METHODS.replace(str(a(args)), [args[1], args[2]]));
  def('replaceAll', (args) => STRING_METHODS.replace(str(a(args)), [args[1], args[2]]));
  def('substring', (args) => STRING_METHODS.substring(str(a(args)), [args[1], args[2]]));
  def('substr', (args) => STRING_METHODS.substr(str(a(args)), [args[1], args[2]]));
  def('slice', (args) => {
    const v = a(args);
    if (Array.isArray(v)) return ARRAY_METHODS.slice(v, [args[1], args[2]]);
    return STRING_METHODS.substring(v, [args[1], args[2]]);
  });
  def('length', (args) => lengthOf(a(args)));
  def('len', (args) => lengthOf(a(args)));
  def('strlen', (args) => toStr(a(args)).length);
  def('indexOf', (args) => {
    const v = a(args);
    if (Array.isArray(v)) return ARRAY_METHODS.indexOf(v, [args[1]]);
    return toStr(v).indexOf(toStr(args[1]));
  });
  def('startsWith', (args) => toStr(a(args)).startsWith(toStr(args[1])));
  def('startswith', (args) => toStr(a(args)).startsWith(toStr(args[1])));
  def('endsWith', (args) => toStr(a(args)).endsWith(toStr(args[1])));
  def('endswith', (args) => toStr(a(args)).endsWith(toStr(args[1])));
  def('contains', (args) => {
    const v = a(args);
    if (Array.isArray(v)) return ARRAY_METHODS.includes(v, [args[1]]);
    return toStr(v).includes(toStr(args[1]));
  });
  def('includes', (args) => {
    const v = a(args);
    if (Array.isArray(v)) return ARRAY_METHODS.includes(v, [args[1]]);
    return toStr(v).includes(toStr(args[1]));
  });
  def('repeat', (args) => STRING_METHODS.repeat(str(a(args)), [args[1]]));
  def('count', (args) => STRING_METHODS.count(str(a(args)), [args[1]]));
  def('charAt', (args) => STRING_METHODS.charAt(str(a(args)), [args[1]]));
  def('reverse', (args) => {
    const v = a(args);
    if (Array.isArray(v)) return ARRAY_METHODS.reverse(v, []);
    return STRING_METHODS.reverse(v, []);
  });
  def('format', (args) => {
    const s = toStr(a(args));
    const rest = args.slice(1);
    return s.replace(/\{(\w+)\}/g, (m, key) => {
      if (/^\d+$/.test(key)) return rest[Number(key)] === undefined ? m : toStr(rest[Number(key)]);
      if (typeof rest[0] === 'object' && rest[0] !== null && key in rest[0]) return toStr(rest[0][key]);
      return m;
    });
  });
  def('padStart', (args) => STRING_METHODS.padStart(str(a(args)), [args[1], args[2]]));
  def('lpad', (args) => STRING_METHODS.padStart(str(a(args)), [args[1], args[2]]));
  def('padEnd', (args) => STRING_METHODS.padEnd(str(a(args)), [args[1], args[2]]));
  def('rpad', (args) => STRING_METHODS.padEnd(str(a(args)), [args[1], args[2]]));

  
  def('push', (args) => ARRAY_METHODS.push(toArray(a(args)), args.slice(1)));
  def('append', (args) => ARRAY_METHODS.push(toArray(a(args)), args.slice(1)));
  def('pop', (args) => ARRAY_METHODS.pop(a(args)));
  def('shift', (args) => ARRAY_METHODS.shift(a(args)));
  def('unshift', (args) => ARRAY_METHODS.unshift(toArray(a(args)), args.slice(1)));
  def('prepend', (args) => ARRAY_METHODS.unshift(toArray(a(args)), args.slice(1)));
  def('sort', (args) => ARRAY_METHODS.sort(toArray(a(args)), [args[1]], rt));
  def('concat', (args) => ARRAY_METHODS.concat(toArray(a(args)), args.slice(1)));
  def('flatten', (args) => ARRAY_METHODS.flatten(toArray(a(args))));
  def('unique', (args) => ARRAY_METHODS.unique(toArray(a(args))));
  def('sum', (args) => ARRAY_METHODS.sum(toArray(a(args))));
  def('first', (args) => ARRAY_METHODS.first(toArray(a(args))));
  def('last', (args) => ARRAY_METHODS.last(toArray(a(args))));
  def('map', (args) => ARRAY_METHODS.map(toArray(a(args)), [args[1]], rt));
  def('filter', (args) => ARRAY_METHODS.filter(toArray(a(args)), [args[1]], rt));
  def('reduce', (args) => ARRAY_METHODS.reduce(toArray(a(args)), [args[1], args[2]], rt));
  def('forEach', (args) => ARRAY_METHODS.forEach(toArray(a(args)), [args[1]], rt));
  def('find', (args) => ARRAY_METHODS.find(toArray(a(args)), [args[1]], rt));
  def('some', (args) => ARRAY_METHODS.some(toArray(a(args)), [args[1]], rt));
  def('any', (args) => ARRAY_METHODS.some(toArray(a(args)), [args[1]], rt));
  def('every', (args) => ARRAY_METHODS.every(toArray(a(args)), [args[1]], rt));
  def('all', (args) => ARRAY_METHODS.every(toArray(a(args)), [args[1]], rt));

  
  def('keys', (args) => DICT_METHODS.keys(a(args)));
  def('values', (args) => DICT_METHODS.values(a(args)));
  def('items', (args) => DICT_METHODS.entries(a(args)));
  def('entries', (args) => DICT_METHODS.entries(a(args)));
  def('has', (args) => DICT_METHODS.has(a(args), [args[1]]));
  def('hasKey', (args) => DICT_METHODS.has(a(args), [args[1]]));
  def('hasOwn', (args) => DICT_METHODS.has(a(args), [args[1]]));
  def('get', (args) => DICT_METHODS.get(a(args), [args[1], args[2]]));
  def('set', (args) => DICT_METHODS.set(a(args), [args[1], args[2]]));
  def('delete', (args) => DICT_METHODS.delete(a(args), [args[1]]));
  def('remove', (args) => DICT_METHODS.delete(a(args), [args[1]]));
  def('merge', (args) => DICT_METHODS.merge(a(args), args.slice(1)));
  def('extend', (args) => DICT_METHODS.merge(a(args), args.slice(1)));
  def('update', (args) => DICT_METHODS.update(a(args), args.slice(1)));

  
  def('int', (args) => toInt(a(args)));
  def('toInt', (args) => toInt(a(args)));
  def('intval', (args) => toInt(a(args)));
  def('float', (args) => toNum(a(args)));
  def('toFloat', (args) => toNum(a(args)));
  def('floatval', (args) => toNum(a(args)));
  def('num', (args) => toNum(a(args)));
  def('number', (args) => toNum(a(args)));
  def('bool', (args) => toBool(a(args)));
  def('boolean', (args) => toBool(a(args)));
  def('toBool', (args) => toBool(a(args)));
  def('jsonParse', (args) => {
    try {
      return JSON.parse(toStr(a(args)));
    } catch {
      throw new RuntimeError('invalid JSON in jsonParse');
    }
  });
  def('fromJson', (args) => builtins.get('jsonParse').callable(args));
  def('jsonStringify', (args) => JSON.stringify(a(args)));
  def('toJson', (args) => JSON.stringify(a(args)));
  def('toJSON', (args) => JSON.stringify(a(args)));
  def('dump', (args) => JSON.stringify(a(args), null, 2));
  def('json', (args) => JSON.stringify(a(args)));
  def('base64Encode', (args) => Buffer.from(toStr(a(args)), 'utf8').toString('base64'));
  def('b64Encode', (args) => builtins.get('base64Encode').callable(args));
  def('b64', (args) => builtins.get('base64Encode').callable(args));
  def('base64Decode', (args) => Buffer.from(toStr(a(args)), 'base64').toString('utf8'));
  def('b64Decode', (args) => builtins.get('base64Decode').callable(args));

  
  def('type', (args) => typeName(a(args)));
  def('typeof', (args) => typeName(a(args)));
  def('isNumber', (args) => typeof a(args) === 'number');
  def('isString', (args) => typeof a(args) === 'string');
  def('isBool', (args) => typeof a(args) === 'boolean');
  def('isBoolean', (args) => typeof a(args) === 'boolean');
  def('isArray', (args) => Array.isArray(a(args)));
  def('isDict', (args) => {
    const v = a(args);
    return v != null && typeof v === 'object' && !Array.isArray(v) && !isEmbed(v) && !(v instanceof Date);
  });
  def('isObject', (args) => builtins.get('isDict').callable(args));
  def('isNull', (args) => a(args) === null);
  def('isUndefined', (args) => a(args) === undefined);
  def('isFunction', (args) => isCallable(a(args)));
  def('isEmbed', (args) => isEmbed(a(args)));

  
  def('now', () => Math.floor(Date.now() / 1000));
  def('nowMs', () => Date.now());
  def('timestamp', () => Math.floor(Date.now() / 1000));
  def('unix', () => Math.floor(Date.now() / 1000));
  def('date', (args) => (args[0] === undefined ? new Date() : toDate(args[0], 'date')));
  def('strftime', (args) => {
    const d = toDate(args[0], 'strftime');
    return implStrftime(d, toStr(args[1] ?? '%Y-%m-%d %H:%M:%S'));
  });
  def('formatDate', (args) => builtins.get('strftime').callable(args));
  def('year', (args) => toDate(args[0], 'year').getUTCFullYear());
  def('month', (args) => toDate(args[0], 'month').getUTCMonth() + 1);
  def('day', (args) => toDate(args[0], 'day').getUTCDate());
  def('hour', (args) => toDate(args[0], 'hour').getUTCHours());
  def('minute', (args) => toDate(args[0], 'minute').getUTCMinutes());
  def('second', (args) => toDate(args[0], 'second').getUTCSeconds());

  
  def('match', (args) => {
    const re = toRegex(args[1]);
    const s = toStr(args[0]);
    if (re.global) {
      return s.match(re) ?? [];
    }
    const m = re.exec(s);
    return m ? m[0] : null;
  });
  def('test', (args) => {
    const re = toRegex(args[1]);
    re.lastIndex = 0;
    return re.test(toStr(args[0]));
  });
  def('regexTest', (args) => builtins.get('test').callable(args));
  def('regexReplace', (args) => {
    const re = toRegex(args[1]);
    return toStr(args[0]).replace(re, toStr(args[2]));
  });
  def('replaceRegex', (args) => builtins.get('regexReplace').callable(args));
  def('regex', (args) => ({ kind: 'regex', source: toStr(args[0]), flags: toStr(args[1] ?? '') }));

  
  def('mention', (args) => `<@${resolveId(a(args))}>`);
  def('userMention', (args) => `<@${resolveId(a(args))}>`);
  def('channelMention', (args) => `<#${resolveId(a(args))}>`);
  def('roleMention', (args) => `<@&${resolveId(a(args))}>`);
  def('mentionRole', (args) => `<@&${resolveId(a(args))}>`);
  def('everyoneMention', () => '@everyone');
  def('hereMention', () => '@here');
  def('userTag', (args) => {
    const d = toUserDict(args[0]);
    return `${d.username}#${d.discriminator}`;
  });
  def('displayName', (args) => {
    const d = toUserDict(args[0]);
    return d.display_name ?? d.global_name ?? d.username ?? toStr(args[0]);
  });
  def('avatarURL', (args) => {
    const d = toUserDict(args[0]);
    return d.avatar_url ?? d.avatar ?? null;
  });
  def('code', (args) => `\`\`\`${toStr(args[0])}\n\`\`\``);
  def('codeblock', (args) => builtins.get('code').callable(args));
  def('bold', (args) => `**${toStr(args[0])}**`);
  def('italic', (args) => `*${toStr(args[0])}*`);
  def('italicize', (args) => builtins.get('italic').callable(args));
  def('underline', (args) => `__${toStr(args[0])}__`);
  def('strikethrough', (args) => `~~${toStr(args[0])}~~`);
  def('strike', (args) => builtins.get('strikethrough').callable(args));
  def('spoiler', (args) => `||${toStr(args[0])}||`);
  def('quote', (args) => toStr(args[0]).split('\n').map((l) => `> ${l}`).join('\n'));
  def('inlineCode', (args) => `\`${toStr(args[0]).replace(/`/g, '')}\``);
  def('link', (args) => `[${toStr(args[0])}](${toStr(args[1])})`);
  def('hyperlink', (args) => builtins.get('link').callable(args));

  
  def('embed', (args) => {
    if (args.length > 0) {
      throw new RuntimeError('embed() takes no arguments * use chained setters like embed().title("x")');
    }
    return embed();
  });

  builtins.set('memberArray', { kind: 'methods', name: 'array', methods: ARRAY_METHODS, aliases: ARRAY_ALIASES });
  builtins.set('memberString', { kind: 'methods', name: 'string', methods: STRING_METHODS, aliases: STRING_ALIASES });
  builtins.set('memberDict', { kind: 'methods', name: 'dict', methods: DICT_METHODS, aliases: DICT_ALIASES });

  return builtins;
}

module.exports = {
  toDate,
  implStrftime,
  isCallable,
  safeSlice,
  isCallable,
  typeName,
  toBool,
  toInt,
  toNum,
  toStr,
  toArray,
  fmtNum,
  isEmbed,
  createStdlib
};
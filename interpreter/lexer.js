const { LexerError } = require('./errors.js');

const KEYWORDS = new Set([
  'fn', 'if', 'else', 'elif', 'while', 'for', 'in', 'of', 'return',
  'break', 'continue', 'stop', 'switch', 'case', 'default', 'let', 'const', 'var',
  'true', 'false', 'null', 'none', 'undefined', 'and', 'or', 'not',
]);

const GLOBALS = new Set(['user', 'channel', 'message', 'guild']);

const CONTINUATION_AFTER = new Set([
  ',', '(', '[', '{', ':', ';', '?', '.',
  '+', '-', '*', '/', '%', '**',
  '==', '!=', '===', '!==', '<', '<=', '>', '>=',
  '&&', '||', '=', '+=', '-=', '*=', '/=', '%=', '**=',
  'return', 'and', 'or', 'not', 'in',
  'else', 'elif', 'case', 'default',
  'let', 'const', 'var', 'switch', 'while', 'for', 'if',
]);

const MULTI_CHAR = [
  '**=', '===', '!==', '**', '==', '!=', '<=', '>=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '++', '--',
];

const SINGLE_CHAR = '+-*/%=<>!?:;,().[]{}';

const ESCAPES = {
  n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '`': '`',
  '0': '\0', $: '$', '{': '{', '}': '}',
};

class Lexer {
  constructor(source) {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
    this.parenDepth = 0;
    this.prev = null;
  }

  error(msg, line = this.line, col = this.col) {
    throw new LexerError(msg, line, col);
  }

  peek(offset = 0) {
    return this.source[this.pos + offset] ?? '';
  }

  advance() {
    const ch = this.source[this.pos++] ?? '';
    if (ch === '\n') {
      this.line += 1;
      this.col = 1;
    } else {
      this.col += 1;
    }
    return ch;
  }

  emit(type, value) {
    this.tokens.push({ type, value, line: this.line, col: this.col });
    this.prev = { type, value };
  }

  prevEndsExpression() {
    if (!this.prev) return false;
    const t = this.prev.type;
    if (t === 'identifier' || t === 'number' || t === 'string' || t === 'template' || t === 'global') {
      return true;
    }
    return t === 'punct' && (this.prev.value === ')' || this.prev.value === ']' || this.prev.value === '}');
  }

  skipWhitespaceAndComments() {
    for (;;) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance();
      } else if (ch === '\n') {
        this.handleNewline();
      } else if (ch === '/' && this.peek(1) === '/') {
        this.advance();
        this.advance();
        while (this.peek() && this.peek() !== '\n') this.advance();
      } else if (ch === '/' && this.peek(1) === '*') {
        const line = this.line;
        const col = this.col;
        this.advance();
        this.advance();
        let closed = false;
        while (this.pos < this.source.length) {
          if (this.peek() === '*' && this.peek(1) === '/') {
            this.advance();
            this.advance();
            closed = true;
            break;
          }
          this.advance();
        }
        if (!closed) this.error('unterminated block comment', line, col);
      } else if (ch === '#') {
        while (this.peek() && this.peek() !== '\n') this.advance();
      } else {
        break;
      }
    }
  }

  handleNewline() {
    const line = this.line;
    const col = this.col;
    
    let save = this.pos;
    let saveLine = this.line;
    let saveCol = this.col;
    while (this.peek() === ' ' || this.peek() === '\t' || this.peek() === '\r') this.advance();
    const nextCh = this.peek();
    this.pos = save;
    this.line = saveLine;
    this.col = saveCol;

    const prevVal = this.prev ? this.prev.value : null;
    const insignificant =
      this.parenDepth > 0 ||
      (prevVal != null && CONTINUATION_AFTER.has(prevVal)) ||
      nextCh === '}';

    this.advance(); 

    if (!insignificant) {
      this.emit('newline', '\n');
    }
  }

  readNumber() {
    const line = this.line;
    const col = this.col;
    let start = this.pos;
    let isFloat = false;
    let isHex = false;

    if (this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
      isHex = true;
      this.advance();
      this.advance();
      while (/[0-9a-fA-F_]/.test(this.peek())) this.advance();
      if (this.pos === start + 2) this.error('invalid hex literal', line, col);
    } else {
      if (this.peek() === '.') {
        isFloat = true;
      }
      while (/[0-9_]/.test(this.peek())) this.advance();
      if (this.peek() === '.' && /[0-9]/.test(this.peek(1) ?? '')) {
        isFloat = true;
        this.advance();
        while (/[0-9_]/.test(this.peek())) this.advance();
      }
      if (/[eE]/.test(this.peek())) {
        const save = this.pos;
        this.advance();
        if (this.peek() === '+' || this.peek() === '-') this.advance();
        if (/[0-9]/.test(this.peek())) {
          isFloat = true;
          while (/[0-9_]/.test(this.peek())) this.advance();
        } else {
          this.pos = save;
        }
      }
    }

    const raw = this.source.slice(start, this.pos).replace(/_/g, '');
    let value;
    if (isHex) {
      value = parseInt(raw, 16);
    } else {
      value = isFloat ? parseFloat(raw) : parseInt(raw, 10);
    }
    if (Number.isNaN(value)) this.error(`invalid number '${raw}'`, line, col);
    this.emit('number', value);
  }

  matchInterpolation() {
    const src = this.source;
    const start = this.pos + 1;
    let i = start;
    const idStart = (c) => c !== undefined && /[A-Za-z_$]/.test(c);
    const idChar = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);

    if (!idStart(src[i])) return null;
    i += 1;
    while (idChar(src[i])) i += 1;

    for (;;) {
      const c = src[i];
      if (c === undefined) return null;
      if (c === ']') break;
      if (c === '.') {
        i += 1;
        if (idChar(src[i])) {
          while (idChar(src[i])) i += 1;
          continue;
        }
        if (src[i] !== undefined && /[0-9]/.test(src[i])) {
          while (src[i] !== undefined && /[0-9]/.test(src[i])) i += 1;
          continue;
        }
        return null;
      }
      if (c === '[') {
        i += 1;
        let digits = '';
        while (src[i] !== undefined && /[0-9]/.test(src[i])) {
          digits += src[i];
          i += 1;
        }
        if (src[i] !== ']' || !digits) return null;
        i += 1;
        continue;
      }
      if (c === '(') {
        let depth = 0;
        for (;;) {
          const d = src[i];
          if (d === undefined) return null;
          if (d === '"' || d === "'" || d === '`') {
            const q = d;
            i += 1;
            while (i < src.length && src[i] !== q) {
              if (src[i] === '\\') i += 1;
              i += 1;
            }
            if (i >= src.length) return null;
            i += 1;
            continue;
          }
          if (d === '(' || d === '[') {
            depth += 1;
            i += 1;
            continue;
          }
          if (d === ')' || d === ']') {
            depth -= 1;
            i += 1;
            if (depth === 0) break;
            continue;
          }
          i += 1;
        }
        continue;
      }
      return null;
    }

    const inner = src.slice(start, i);
    const count = i - this.pos + 1;
    for (let k = 0; k < count; k++) this.advance();
    return { source: inner };
  }

  readString(quote, line, col) {
    
    this.advance(); 
    if (quote === '`') {
      return this.readTemplate(line, col);
    }
    const triple = quote.length === 3;
    if (triple) {
      this.advance();
      this.advance();
    }
    const parts = [];
    let buf = '';
    for (;;) {
      const ch = this.peek();
      if (!ch) this.error(`unterminated string`, line, col);
      if (triple && this.source.startsWith(quote, this.pos)) {
        this.advance();
        this.advance();
        this.advance();
        break;
      }
      if (!triple && ch === quote[0]) {
        this.advance();
        break;
      }
      if (ch === '\n' && !triple) this.error('unterminated string (newline in string)', line, col);
      if (ch === '\\') {
        this.advance();
        const esc = this.advance();
        if (esc === 'u') {
          let hex = '';
          for (let i = 0; i < 4; i++) hex += this.advance();
          buf += String.fromCharCode(parseInt(hex, 16));
        } else {
          buf += ESCAPES[esc] ?? esc;
        }
      } else if (ch === '[') {
        const interp = this.matchInterpolation();
        if (interp) {
          if (buf) {
            parts.push({ type: 'text', value: buf });
            buf = '';
          }
          parts.push({ type: 'expr', source: interp.source });
        } else {
          buf += this.advance();
        }
      } else {
        buf += this.advance();
      }
    }
    if (buf) parts.push({ type: 'text', value: buf });
    if (parts.some((p) => p.type === 'expr')) {
      this.emit('template', parts);
    } else {
      this.emit('string', buf);
    }
  }

  readTemplate(line, col) {
    
    const parts = [];
    let buf = '';
    for (;;) {
      const ch = this.peek();
      if (!ch) this.error('unterminated template string', line, col);
      if (ch === '`') {
        this.advance();
        break;
      }
      if (ch === '\\') {
        this.advance();
        const esc = this.advance();
        if (esc === '`' || esc === '$' || esc === '{') buf += esc;
        else buf += ESCAPES[esc] ?? esc;
        continue;
      }
      if (ch === '$' && this.peek(1) === '{') {
        if (buf) {
          parts.push({ type: 'text', value: buf });
          buf = '';
        }
        this.advance();
        this.advance();
        let depth = 1;
        let expr = '';
        for (;;) {
          const c = this.peek();
          if (!c) this.error('unterminated interpolation in template', line, col);
          if (c === '{') depth += 1;
          if (c === '}') {
            depth -= 1;
            if (depth === 0) {
              this.advance();
              break;
            }
          }
          expr += this.advance();
        }
        parts.push({ type: 'expr', source: expr });
      } else {
        buf += this.advance();
      }
    }
    if (buf) parts.push({ type: 'text', value: buf });
    if (parts.length === 0) parts.push({ type: 'text', value: '' });
    this.emit('template', parts);
  }

  readFString(line, col) {
    
    const quoteChar = this.peek();
    const quote = this.source.startsWith("'''", this.pos) ? "'''" : this.source.startsWith('"""', this.pos) ? '"""' : quoteChar;
    if (quoteChar === '`') {
      return this.readTemplate(line, col);
    }
    this.advance();
    const triple = quote.length === 3;
    if (triple) {
      this.advance();
      this.advance();
    }
    const parts = [];
    let buf = '';
    for (;;) {
      const ch = this.peek();
      if (!ch) this.error('unterminated f-string', line, col);
      if (triple && this.source.startsWith(quote, this.pos)) {
        this.advance();
        this.advance();
        this.advance();
        break;
      }
      if (!triple && ch === quote[0]) {
        this.advance();
        break;
      }
      if (ch === '{' && !triple) {
        
        if (buf) {
          parts.push({ type: 'text', value: buf });
          buf = '';
        }
        this.advance();
        let depth = 1;
        let expr = '';
        for (;;) {
          const c = this.peek();
          if (!c) this.error('unterminated interpolation in f-string', line, col);
          if (c === '{') depth += 1;
          if (c === '}') {
            depth -= 1;
            if (depth === 0) {
              this.advance();
              break;
            }
          }
          expr += this.advance();
        }
        parts.push({ type: 'expr', source: expr });
      } else if (ch === '\\') {
        this.advance();
        const esc = this.advance();
        buf += ESCAPES[esc] ?? esc;
      } else if (ch === '\n' && !triple) {
        this.error('unterminated f-string (newline in string)', line, col);
      } else {
        buf += this.advance();
      }
    }
    if (buf) parts.push({ type: 'text', value: buf });
    if (parts.length === 0) parts.push({ type: 'text', value: '' });
    this.emit('template', parts);
  }

  readIdentifier() {
    const line = this.line;
    const col = this.col;
    let buf = '';
    while (/[A-Za-z0-9_]/.test(this.peek())) {
      buf += this.advance();
    }
    
    if (buf === 'f' && /['"`]/.test(this.peek())) {
      return this.readFString(line, col);
    }
    if (KEYWORDS.has(buf)) {
      this.emit('keyword', buf);
    } else {
      this.emit('identifier', buf);
    }
  }

  readGlobal() {
    const line = this.line;
    const col = this.col;
    this.advance();
    let buf = '';
    while (/[A-Za-z0-9_]/.test(this.peek())) buf += this.advance();
    if (!buf) this.error("expected identifier after '$'", line, col);
    if (!GLOBALS.has(buf)) {
      this.error(`unknown context global '$${buf}' (expected one of: $user, $channel, $message, $guild)`, line, col);
    }
    this.emit('global', buf);
  }

  tokenize() {
    for (;;) {
      this.skipWhitespaceAndComments();
      const ch = this.peek();
      if (!ch) break;

      const line = this.line;
      const col = this.col;

      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(this.peek(1)) && !this.prevEndsExpression())) {
        this.readNumber();
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        this.readIdentifier();
        continue;
      }
      if (ch === '$') {
        this.readGlobal();
        continue;
      }
      if (ch === "'" || ch === '"') {
        const triple = this.source.startsWith(ch + ch + ch, this.pos);
        this.readString(triple ? ch + ch + ch : ch, line, col);
        continue;
      }
      if (ch === '`') {
        this.advance();
        this.readTemplate(line, col);
        continue;
      }

      const two = this.source.slice(this.pos, this.pos + 2);
      const three = this.source.slice(this.pos, this.pos + 3);
      let matched = false;
      if (MULTI_CHAR.includes(three)) {
        this.advance();
        this.advance();
        this.advance();
        this.emit('punct', three);
        matched = true;
      } else if (MULTI_CHAR.includes(two)) {
        this.advance();
        this.advance();
        this.emit('punct', two);
        matched = true;
      } else if (SINGLE_CHAR.includes(ch)) {
        if (ch === '(' || ch === '[') this.parenDepth += 1;
        if (ch === ')' || ch === ']') this.parenDepth = Math.max(0, this.parenDepth - 1);
        this.advance();
        this.emit('punct', ch);
        matched = true;
      }
      if (matched) continue;

      this.error(`unexpected character '${ch}'`, line, col);
    }
    this.emit('eof', null);
    return this.tokens;
  }
}

function tokenize(source) {
  return new Lexer(source).tokenize();
}

module.exports = { tokenize, Lexer };

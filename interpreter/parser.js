const { ParserError } = require('./errors.js');
const { tokenize } = require('./lexer.js');

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  current() {
    return this.tokens[this.pos];
  }

  peek(d = 1) {
    return this.tokens[Math.min(this.pos + d, this.tokens.length - 1)];
  }

  advance() {
    const t = this.current();
    if (t.type !== 'eof') this.pos += 1;
    return t;
  }

  atEnd() {
    return this.current().type === 'eof';
  }

  error(msg, tok = this.current()) {
    throw new ParserError(msg, tok.line, tok.col);
  }

  isPunct(v) {
    const t = this.current();
    return t.type === 'punct' && t.value === v;
  }

  isKeyword(k) {
    const t = this.current();
    return t.type === 'keyword' && t.value === k;
  }

  isIdentifier() {
    return this.current().type === 'identifier';
  }

  matchPunct(v) {
    if (this.isPunct(v)) return this.advance();
    return null;
  }

  matchKeyword(k) {
    if (this.isKeyword(k)) return this.advance();
    return null;
  }

  matchPuncts(...values) {
    for (const v of values) {
      if (this.isPunct(v)) return this.advance();
    }
    return null;
  }

  expectPunct(v) {
    const t = this.matchPunct(v);
    if (!t) this.error(`expected '${v}'`);
    return t;
  }

  expectKeyword(k) {
    const t = this.matchKeyword(k);
    if (!t) this.error(`expected '${k}'`);
    return t;
  }

  expectIdentifier() {
    const t = this.current();
    if (t.type !== 'identifier') this.error(`expected identifier, got '${t.value}'`);
    return this.advance();
  }

  skipNewlines() {
    while (this.current().type === 'newline') this.advance();
  }

  parseProgram() {
    const body = [];
    while (!this.atEnd()) {
      this.skipNewlines();
      if (this.atEnd()) break;
      if (this.isPunct('}')) this.error("unexpected '}'");
      body.push(this.parseStatement());
    }
    return { type: 'Program', body };
  }

  parseStatement() {
    let node;
    if (this.isPunct('{')) {
      node = this.parseBlock();
    } else if (this.isKeyword('fn') && this.peek().type === 'identifier') {
      node = this.parseFunctionDeclaration();
    } else if (this.isKeyword('let') || this.isKeyword('const') || this.isKeyword('var')) {
      node = this.parseVariableDeclaration();
    } else if (this.isKeyword('if')) {
      node = this.parseIf();
    } else if (this.isKeyword('while')) {
      node = this.parseWhile();
    } else if (this.isKeyword('for')) {
      node = this.parseFor();
    } else if (this.isKeyword('switch')) {
      node = this.parseSwitch();
    } else if (this.isKeyword('return')) {
      node = this.parseReturn();
    } else if (this.isKeyword('break')) {
      this.advance();
      node = { type: 'Break' };
    } else if (this.isKeyword('continue')) {
      this.advance();
      node = { type: 'Continue' };
    } else if (this.isKeyword('stop')) {
      this.advance();
      node = { type: 'Stop' };
    } else {
      const expr = this.parseExpression();
      node = { type: 'ExpressionStatement', expression: expr };
    }
    this.matchPunct(';');
    return node;
  }

  parseVariableDeclaration() {
    const kw = this.advance();
    const name = this.expectIdentifier().value;
    let init = null;
    if (this.matchPunct('=')) {
      init = this.parseExpression();
    }
    return { type: 'VariableDeclaration', keyword: kw.value, name, init };
  }

  parseFunctionDeclaration() {
    this.expectKeyword('fn');
    const name = this.expectIdentifier().value;
    const params = this.parseParams();
    const body = this.parseBlock();
    return { type: 'FunctionDeclaration', name, params, body };
  }

  parseParams() {
    this.expectPunct('(');
    const params = [];
    this.skipNewlines();
    if (this.matchPunct(')')) return params;
    for (;;) {
      this.skipNewlines();
      params.push(this.expectIdentifier().value);
      this.skipNewlines();
      if (this.matchPunct(',')) continue;
      if (this.matchPunct(')')) break;
      this.error("expected ',' or ')' in parameter list");
    }
    return params;
  }

  parseParenExpr() {
    this.expectPunct('(');
    const expr = this.parseExpression();
    this.expectPunct(')');
    return expr;
  }

  parseIf() {
    this.expectKeyword('if');
    return this.parseIfTail();
  }

  parseIfTail() {
    const test = this.parseParenExpr();
    const consequent = this.parseBlock();
    let alternate = null;
    this.skipNewlines();
    if (this.matchKeyword('elif')) {
      alternate = { type: 'Block', body: [this.parseIfTail()] };
    } else if (this.matchKeyword('else')) {
      if (this.isKeyword('if')) {
        this.advance();
        alternate = { type: 'Block', body: [this.parseIfTail()] };
      } else {
        alternate = this.parseBlock();
      }
    }
    return { type: 'If', test, consequent, alternate };
  }

  parseWhile() {
    this.expectKeyword('while');
    const test = this.parseParenExpr();
    const body = this.parseBlock();
    return { type: 'While', test, body };
  }

  parseFor() {
    this.expectKeyword('for');
    this.expectPunct('(');
    this.skipNewlines();

    const isDeclaredForIn =
      (this.isKeyword('let') || this.isKeyword('const') || this.isKeyword('var')) &&
      this.peek().type === 'identifier' &&
      (this.peek(2).type === 'keyword' && (this.peek(2).value === 'in' || this.peek(2).value === 'of'));
    const isBareForIn =
      this.isIdentifier() &&
      this.peek().type === 'keyword' &&
      (this.peek().value === 'in' || this.peek().value === 'of');

    if (isDeclaredForIn || isBareForIn) {
      const name = this.expectIdentifier().value;
      const iterKw = this.advance();
      const iterable = this.parseExpression();
      this.expectPunct(')');
      const body = this.parseBlock();
      return { type: 'ForIn', name, iterable, body, kind: iterKw.value };
    }

    let init = null;
    if (!this.isPunct(';')) {
      if (this.isKeyword('let') || this.isKeyword('const') || this.isKeyword('var')) {
        init = this.parseVariableDeclaration();
      } else {
        init = this.parseExpression();
      }
    }
    this.expectPunct(';');
    const cond = this.isPunct(';') ? null : this.parseExpression();
    this.expectPunct(';');
    const inc = this.isPunct(')') ? null : this.parseExpression();
    this.expectPunct(')');
    const body = this.parseBlock();
    return { type: 'ForClassic', init, cond, inc, body };
  }

  parseSwitch() {
    this.expectKeyword('switch');
    const disc = this.parseParenExpr();
    this.expectPunct('{');
    const cases = [];
    let defaultBody = null;
    this.skipNewlines();
    for (;;) {
      this.skipNewlines();
      if (this.isKeyword('case')) {
        this.advance();
        const test = this.parseExpression();
        this.expectPunct(':');
        const body = this.parseStatementsUntilCaseEnd();
        cases.push({ test, body });
      } else if (this.isKeyword('default')) {
        this.advance();
        this.expectPunct(':');
        defaultBody = this.parseStatementsUntilCaseEnd();
      } else if (this.isPunct('}')) {
        this.advance();
        break;
      } else if (this.atEnd()) {
        this.error('unterminated switch statement');
      } else {
        this.error("expected 'case', 'default' or '}' in switch");
      }
    }
    return { type: 'Switch', disc, cases, defaultBody };
  }

  parseStatementsUntilCaseEnd() {
    const body = [];
    this.skipNewlines();
    while (!this.atEnd() && !this.isKeyword('case') && !this.isKeyword('default') && !this.isPunct('}')) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    return body;
  }

  parseReturn() {
    this.expectKeyword('return');
    let value = null;
    const t = this.current();
    if (!(t.type === 'newline' || t.type === 'eof' || (t.type === 'punct' && t.value === ';') || (t.type === 'punct' && t.value === '}'))) {
      value = this.parseExpression();
    }
    return { type: 'Return', value };
  }

  parseBlock() {
    this.expectPunct('{');
    const body = [];
    this.skipNewlines();
    while (!this.isPunct('}') && !this.atEnd()) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    if (this.atEnd()) this.error("expected '}'", this.peek(-1));
    this.expectPunct('}');
    return { type: 'Block', body };
  }

  

  parseExpression() {
    return this.parseAssignment();
  }

  parseAssignment() {
    const left = this.parseTernary();
    const op = this.matchPuncts('=', '+=', '-=', '*=', '/=', '%=', '**=');
    if (op) {
      if (left.type === 'Global') this.error(`cannot assign to '$${left.name}'`, op);
      if (left.type !== 'Identifier' && left.type !== 'Member') {
        this.error('invalid assignment target', op);
      }
      const value = this.parseAssignment();
      return { type: 'Assign', target: left, op: op.value, value };
    }
    return left;
  }

  parseTernary() {
    const cond = this.parseLogicalOr();
    if (this.matchPunct('?')) {
      const consequent = this.parseAssignment();
      this.expectPunct(':');
      const alternate = this.parseAssignment();
      return { type: 'Ternary', cond, consequent, alternate };
    }
    return cond;
  }

  parseBinaryLeft(fns, ops) {
    let left = fns[0]();
    for (;;) {
      const op = this.matchPuncts(...ops);
      if (!op) break;
      const right = fns[0]();
      left = { type: 'Binary', op: op.value, left, right };
    }
    return left;
  }

  parseLogicalOr() {
    let left = this.parseLogicalAnd();
    for (;;) {
      const op = this.matchPunct('||') || this.matchKeyword('or');
      if (!op) break;
      const right = this.parseLogicalAnd();
      left = { type: 'Logical', op: op.value, left, right };
    }
    return left;
  }

  parseLogicalAnd() {
    let left = this.parseEquality();
    for (;;) {
      const op = this.matchPunct('&&') || this.matchKeyword('and');
      if (!op) break;
      const right = this.parseEquality();
      left = { type: 'Logical', op: op.value, left, right };
    }
    return left;
  }

  parseEquality() {
    return this.parseBinaryLeft([() => this.parseComparison()], ['==', '!=', '===', '!==']);
  }

  parseComparison() {
    return this.parseBinaryLeft([() => this.parseIn()], ['<', '<=', '>', '>=']);
  }

  parseIn() {
    let left = this.parseAdditive();
    for (;;) {
      const op = this.matchKeyword('in');
      if (!op) break;
      const right = this.parseAdditive();
      left = { type: 'Binary', op: 'in', left, right };
    }
    return left;
  }

  parseAdditive() {
    return this.parseBinaryLeft([() => this.parseMultiplicative()], ['+', '-']);
  }

  parseMultiplicative() {
    return this.parseBinaryLeft([() => this.parsePower()], ['*', '/', '%']);
  }

  parsePower() {
    const left = this.parseUnary();
    if (this.matchPunct('**')) {
      const right = this.parsePower();
      return { type: 'Binary', op: '**', left, right };
    }
    return left;
  }

  parseUnary() {
    const op = this.matchPunct('!') || this.matchKeyword('not') || this.matchPunct('-') || this.matchPunct('+');
    if (op) {
      const operand = this.parseUnary();
      return { type: 'Unary', op: op.value, operand };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let expr = this.parseCall();
    for (;;) {
      const op = this.matchPunct('++') || this.matchPunct('--');
      if (!op) break;
      if (expr.type !== 'Identifier' && expr.type !== 'Member') {
        this.error('invalid increment/decrement target', op);
      }
      expr = { type: 'Postfix', target: expr, op: op.value };
    }
    return expr;
  }

  parseCall() {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.matchPunct('(')) {
        const args = [];
        this.skipNewlines();
        if (!this.isPunct(')')) {
          for (;;) {
            args.push(this.parseExpression());
            this.skipNewlines();
            if (this.matchPunct(',')) {
              this.skipNewlines();
              continue;
            }
            if (this.matchPunct(')')) break;
            this.error("expected ',' or ')' in argument list");
          }
        } else {
          this.advance();
        }
        expr = { type: 'Call', callee: expr, args };
      } else if (this.matchPunct('.')) {
        const t = this.current();
        if (t.type === 'identifier' || t.type === 'number') {
          expr = { type: 'Member', object: expr, property: t.value, computed: false };
          this.advance();
        } else {
          this.error("expected property name after '.'");
        }
      } else if (this.matchPunct('[')) {
        const index = this.parseExpression();
        this.expectPunct(']');
        expr = { type: 'Member', object: expr, property: index, computed: true };
      } else {
        break;
      }
    }
    return expr;
  }

  parsePrimary() {
    const t = this.current();
    switch (t.type) {
      case 'number':
        this.advance();
        return { type: 'Literal', value: t.value };
      case 'string':
        this.advance();
        return { type: 'Literal', value: t.value };
      case 'template':
        this.advance();
        return { type: 'Template', parts: t.value };
      case 'identifier':
        this.advance();
        return { type: 'Identifier', name: t.value };
      case 'global':
        this.advance();
        return { type: 'Global', name: t.value };
      case 'keyword': {
        if (t.value === 'true') { this.advance(); return { type: 'Literal', value: true }; }
        if (t.value === 'false') { this.advance(); return { type: 'Literal', value: false }; }
        if (t.value === 'null' || t.value === 'none') { this.advance(); return { type: 'Literal', value: null }; }
        if (t.value === 'undefined') { this.advance(); return { type: 'Literal', value: undefined }; }
        if (t.value === 'fn') return this.parseFunctionExpression();
        this.error(`unexpected keyword '${t.value}'`);
        break;
      }
      case 'punct': {
        if (t.value === '(') {
          this.advance();
          const expr = this.parseExpression();
          this.expectPunct(')');
          return expr;
        }
        if (t.value === '[') return this.parseArrayLiteral();
        if (t.value === '{') return this.parseDictLiteral();
        this.error(`unexpected token '${t.value}'`);
        break;
      }
      default:
        this.error(`unexpected token '${t.value}'`);
    }
  }

  parseFunctionExpression() {
    this.expectKeyword('fn');
    let name = null;
    if (this.isIdentifier() && this.peek().type === 'punct' && this.peek().value === '(') {
      name = this.expectIdentifier().value;
    }
    const params = this.parseParams();
    const body = this.parseBlock();
    return { type: 'FunctionExpression', name, params, body };
  }

  parseArrayLiteral() {
    this.expectPunct('[');
    const elements = [];
    this.skipNewlines();
    if (this.matchPunct(']')) return { type: 'ArrayLiteral', elements };
    for (;;) {
      elements.push(this.parseExpression());
      this.skipNewlines();
      if (this.matchPunct(',')) {
        this.skipNewlines();
        if (this.matchPunct(']')) break;
        continue;
      }
      if (this.matchPunct(']')) break;
      this.error("expected ',' or ']' in array literal");
    }
    return { type: 'ArrayLiteral', elements };
  }

  parseDictLiteral() {
    this.expectPunct('{');
    const props = [];
    this.skipNewlines();
    if (this.matchPunct('}')) return { type: 'DictLiteral', props };
    for (;;) {
      this.skipNewlines();
      const keyTok = this.current();
      let key;
      if (keyTok.type === 'identifier' || keyTok.type === 'string') {
        this.advance();
        key = keyTok.value;
      } else if (keyTok.type === 'number') {
        this.advance();
        key = String(keyTok.value);
      } else {
        this.error("expected dict key (identifier or string)");
      }
      this.expectPunct(':');
      const value = this.parseExpression();
      props.push({ key, value });
      this.skipNewlines();
      if (this.matchPunct(',')) {
        this.skipNewlines();
        if (this.matchPunct('}')) break;
        continue;
      }
      if (this.matchPunct('}')) break;
      this.error("expected ',' or '}' in dict literal");
    }
    return { type: 'DictLiteral', props };
  }
}

function parse(source) {
  const tokens = tokenize(source);
  return new Parser(tokens).parseProgram();
}

module.exports = { parse, Parser };
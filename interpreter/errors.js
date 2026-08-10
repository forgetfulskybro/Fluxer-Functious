 class FluxerError extends Error {
  constructor(message, { category = 'runtime', line = null, col = null } = {}) {
    super(message);
    this.name = 'FluxerError';
    this.category = category;
    this.line = line;
    this.col = col;
  }
}

class LexerError extends FluxerError {
  constructor(message, line, col) {
    super(message, { category: 'lexer', line, col });
    this.name = 'LexerError';
  }
}

class ParserError extends FluxerError {
  constructor(message, line, col) {
    super(message, { category: 'parse', line, col });
    this.name = 'ParserError';
  }
}

class RuntimeError extends FluxerError {
  constructor(message, line, col) {
    super(message, { category: 'runtime', line, col });
    this.name = 'RuntimeError';
  }
}

class LimitError extends RuntimeError {
  constructor(message, line, col) {
    super(message, line, col);
    this.name = 'LimitError';
    this.category = 'limit';
  }
}

module.exports = { FluxerError, LexerError, ParserError, RuntimeError, LimitError };

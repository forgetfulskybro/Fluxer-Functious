function tokenize(input) {
    const tokens = [];
    let i = 0;
    while (i < input.length) {
        // No whitespace
        if (/\s/.test(input[i]) && input[i] !== '"') {
            i++;
            continue;
        }

        // String literal
        if (input[i] === '"') {
            let str = '';
            i++;
            while (i < input.length && input[i] !== '"') {
                if (input[i] === '\\' && i + 1 < input.length) {
                    str += input[i + 1];
                    i += 2;
                } else {
                    str += input[i];
                    i++;
                }
            }
            i++;
            tokens.push({ type: 'string', value: str });
            continue;
        }

        // Numbers
        if (/\d/.test(input[i]) || (input[i] === '-' && i + 1 < input.length && /\d/.test(input[i + 1]))) {
            let num = '';
            if (input[i] === '-') { num += '-'; i++; }
            while (i < input.length && /\d/.test(input[i])) {
                num += input[i];
                i++;
            }
            if (input[i] === '.') {
                num += '.';
                i++;
                while (i < input.length && /\d/.test(input[i])) {
                    num += input[i];
                    i++;
                }
            }
            tokens.push({ type: 'number', value: parseFloat(num) });
            continue;
        }

        // Keywords and identifiers
        if (/[a-zA-Z_]/.test(input[i])) {
            let word = '';
            while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
                word += input[i];
                i++;
            }
            tokens.push({ type: 'identifier', value: word });
            continue;
        }

        // Operators
        if (input[i] === '=' && input[i + 1] === '=') {
            tokens.push({ type: 'operator', value: '==' });
            i += 2;
            continue;
        }
        if (input[i] === '!' && input[i + 1] === '=') {
            tokens.push({ type: 'operator', value: '!=' });
            i += 2;
            continue;
        }
        if (input[i] === '>' && input[i + 1] === '=') {
            tokens.push({ type: 'operator', value: '>=' });
            i += 2;
            continue;
        }
        if (input[i] === '<' && input[i + 1] === '=') {
            tokens.push({ type: 'operator', value: '<=' });
            i += 2;
            continue;
        }

        // Single Operators
        if (input[i] === '=') { tokens.push({ type: 'operator', value: '=' }); i++; continue; }
        if (input[i] === '+') { tokens.push({ type: 'operator', value: '+' }); i++; continue; }
        if (input[i] === '-') { tokens.push({ type: 'operator', value: '-' }); i++; continue; }
        if (input[i] === '*') { tokens.push({ type: 'operator', value: '*' }); i++; continue; }
        if (input[i] === '/') { tokens.push({ type: 'operator', value: '/' }); i++; continue; }
        if (input[i] === '>') { tokens.push({ type: 'operator', value: '>' }); i++; continue; }
        if (input[i] === '<') { tokens.push({ type: 'operator', value: '<' }); i++; continue; }
        if (input[i] === '!') { tokens.push({ type: 'operator', value: '!' }); i++; continue; }

        // Brackets and punctuation
        if (input[i] === '(') { tokens.push({ type: 'lparen', value: '(' }); i++; continue; }
        if (input[i] === ')') { tokens.push({ type: 'rparen', value: ')' }); i++; continue; }
        if (input[i] === '[') { tokens.push({ type: 'lbracket', value: '[' }); i++; continue; }
        if (input[i] === ']') { tokens.push({ type: 'rbracket', value: ']' }); i++; continue; }
        if (input[i] === ',') { tokens.push({ type: 'comma', value: ',' }); i++; continue; }

        i++;
    }
    return tokens;
}


class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }

    peek() {
        return this.tokens[this.pos] || null;
    }

    consume() {
        return this.tokens[this.pos++] || null;
    }

    expect(type) {
        const token = this.consume();
        if (!token || token.type !== type) {
            throw new Error(`Expected ${type}, got ${token ? token.type + ':' + token.value : 'EOF'}`);
        }
        return token;
    }

    parseAssignment() {
        const nameToken = this.expect('identifier');
        this.expect('operator');
        const value = this.parseExpression();
        return { type: 'assignment', name: nameToken.value, value };
    }

    parseIf() {
        const condition = this.parseComparison();
        
        const doToken = this.peek();
        if (!doToken || doToken.type !== 'identifier' || doToken.value.toLowerCase() !== 'do') {
            throw new Error('Expected "do" in if statement');
        }
        this.consume();
        
        const trueBranch = this.parseExpression();
        
        let falseBranch = null;
        const elseToken = this.peek();
        if (elseToken && elseToken.type === 'identifier' && elseToken.value.toLowerCase() === 'else') {
            this.consume();
            falseBranch = this.parseExpression();
        }
        
        return { type: 'if', condition, trueBranch, falseBranch };
    }

    parseArray() {
        this.expect('lbracket');
        const items = [];
        while (this.peek() && this.peek().type !== 'rbracket') {
            items.push(this.parseExpression());
            if (this.peek() && this.peek().type === 'comma') {
                this.consume();
            }
        }
        this.expect('rbracket');
        return { type: 'array', items };
    }

    parseComparison() {
        let left = this.parseAddSub();
        
        while (this.peek() && this.peek().type === 'operator' && ['==', '!=', '>', '<', '>=', '<='].includes(this.peek().value)) {
            const op = this.consume().value;
            const right = this.parseAddSub();
            left = { type: 'binary', operator: op, left, right };
        }
        
        return left;
    }

    parseAddSub() {
        let left = this.parseMulDiv();
        
        while (this.peek() && this.peek().type === 'operator' && (this.peek().value === '+' || this.peek().value === '-')) {
            const op = this.consume().value;
            const right = this.parseMulDiv();
            left = { type: 'binary', operator: op, left, right };
        }
        
        return left;
    }

    parseMulDiv() {
        let left = this.parsePrimary();
        
        while (this.peek() && this.peek().type === 'operator' && (this.peek().value === '*' || this.peek().value === '/')) {
            const op = this.consume().value;
            const right = this.parsePrimary();
            left = { type: 'binary', operator: op, left, right };
        }
        
        return left;
    }

    parsePrimary() {
        const token = this.peek();
        if (!token) throw new Error('Unexpected end of expression');

        if (token.type === 'number') {
            this.consume();
            return { type: 'number', value: token.value };
        }
        if (token.type === 'string') {
            this.consume();
            return { type: 'string', value: token.value };
        }
        if (token.type === 'lparen') {
            this.consume();
            const expr = this.parseComparison();
            this.expect('rparen');
            return expr;
        }
        if (token.type === 'lbracket') {
            return this.parseArray();
        }
        if (token.type === 'identifier') {
            const word = token.value;
            
            if (word.toLowerCase() === 'if') {
                this.consume();
                return this.parseIf();
            }
            if (word.toLowerCase() === 'math') {
                this.consume();
                this.expect('operator');
                const expr = this.parseComparison();
                return { type: 'math', expression: expr };
            }
            if (word.toLowerCase() === 'array') {
                this.consume();
                this.expect('operator');
                return this.parseArray();
            }
            if (word.toLowerCase() === 'return') {
                this.consume();
                const expr = this.parseExpression();
                return { type: 'return', expression: expr };
            }
            
            this.consume();
            return { type: 'variable', name: word };
        }
        
        throw new Error(`Unexpected token: ${token.type} (${token.value})`);
    }

    parseExpression() {
        if (this.peek() && this.peek().type === 'identifier') {
            const word = this.peek().value;
            if (word.toLowerCase() === 'math') {
                return this.parsePrimary();
            }
            const lookahead = this.tokens[this.pos + 1];
            if (lookahead && lookahead.type === 'operator' && lookahead.value === '=') {
                return this.parseAssignment();
            }
        }
        return this.parseComparison();
    }

    parseStatement() {
        if (!this.peek()) return null;
        return this.parseExpression();
    }

    parseAll() {
        const results = [];
        while (this.peek()) {
            results.push(this.parseStatement());
        }
        return results;
    }
}

function evaluate(ast, context) {
    if (!ast) return '';
    
    switch (ast.type) {
        case 'number':
            return ast.value;
        
        case 'string':
            return ast.value;
        
        case 'variable': {
            const val = context[ast.name];
            return val !== undefined ? val : `{${ast.name}}`;
        }
        
        case 'array':
            return ast.items.map(item => evaluate(item, context));
        
        case 'math': {
            const val = evaluate(ast.expression, context);
            return typeof val === 'number' ? val : 0;
        }
        
        case 'return': {
            return evaluate(ast.expression, context);
        }
        
        case 'binary': {
            const left = evaluate(ast.left, context);
            const right = evaluate(ast.right, context);
            
            switch (ast.operator) {
                case '+':
                    if (typeof left === 'number' && typeof right === 'number') return left + right;
                    return String(left) + String(right);
                case '-': return left - right;
                case '*': return left * right;
                case '/': return right !== 0 ? left / right : 0;
                case '==': return left == right;
                case '!=': return left != right;
                case '>': return left > right;
                case '<': return left < right;
                case '>=': return left >= right;
                case '<=': return left <= right;
                default: return '';
            }
        }
        
        case 'if': {
            const condition = evaluate(ast.condition, context);
            if (condition) {
                return evaluate(ast.trueBranch, context);
            } else if (ast.falseBranch) {
                return evaluate(ast.falseBranch, context);
            }
            return '';
        }
        
        case 'assignment': {
            context[ast.name] = evaluate(ast.value, context);
            return '';
        }
        
        default:
            return '';
    }
}

function processTemplate(template, context) {
    const output = [];
    let i = 0;
    
    while (i < template.length) {
        const start = template.indexOf('{', i);
        if (start === -1) {
            output.push(template.slice(i));
            break;
        }
        
        if (start > 0 && template[start - 1] === '\\') {
            output.push(template.slice(i, start - 1) + '{');
            i = start + 1;
            continue;
        }
        
        output.push(template.slice(i, start));
        
        let depth = 1;
        let end = -1;
        for (let j = start + 1; j < template.length; j++) {
            if (template[j] === '{') depth++;
            else if (template[j] === '}') {
                depth--;
                if (depth === 0) {
                    end = j;
                    break;
                }
            }
        }
        
        if (end === -1) {
            output.push(template.slice(start));
            break;
        }
        
        const blockContent = template.slice(start + 1, end).trim();
        
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(blockContent) && context[blockContent] !== undefined) {
            output.push(context[blockContent]);
        } else if (blockContent) {
            try {
                const tokens = tokenize(blockContent);
                const parser = new Parser(tokens);
                const asts = parser.parseAll();
                for (const ast of asts) {
                    const result = evaluate(ast, context);
                    if (result !== '' && result !== null && result !== undefined) {
                        output.push(typeof result === 'object' ? JSON.stringify(result) : String(result));
                    }
                }
            } catch (err) {
                output.push(`{${blockContent}}`);
            }
        }
        
        i = end + 1;
    }
    
    return output.join('');
}

function gatherContext(client, guildId, channelId, creatorId, sendCount) {
    const guild = client.guilds.get(guildId);
    const context = {
        server: guild ? guild.name : 'Unknown Server',
        members: guild ? guild.members.size : 0,
        channel: channelId ? `<#${channelId}>` : 'unknown',
        user: creatorId ? `<@${creatorId}>` : 'unknown',
        username: '',
        time: new Date().toLocaleString(),
        timestamp: Math.floor(Date.now() / 1000),
        count: sendCount || 0,
    };
    
    if (creatorId) {
        const member = guild ? guild.members.get(creatorId) : null;
        if (member) {
            context.username = member.displayName || member.user?.username || creatorId;
        }
    }
    
    return context;
}

module.exports = { processTemplate, gatherContext };
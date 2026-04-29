const { EmbedBuilder, PermissionFlags } = require("@erinjs/core");
const { inspect } = require("util");
const Paginator = require("../functions/pagination");

module.exports = {
  config: {
    name: "eval",
    cooldown: 1500,
    permissions: {},
    available: "Owner",
    aliases: ["e"],
  },
  run: async (client, message, args, db) => {
    if (!client.config.owners.includes(message.author.id)) return;

    try {
      let noreply;
      let codein;
      const codeBlockRegex = /```(?:\w+)?\s*\n?([\s\S]*?)\s*```/;
      const match = message.content.match(codeBlockRegex);

      if (match && match[1]) {
        codein = match[1].trim();
      } else {
        codein = args.join(" ").trim();
        if (codein.includes("--noreply")) {
          codein = codein.replace("--noreply", "").trim();
          noreply = true;
        }
      }

      if (!codein) return message.reply("Send me code.");

      const STATEMENT_KEYWORDS = /^(const|let|var|function|class|if|for|while|do|switch|try|catch|finally|return|break|continue|throw|debugger|export|import|with|async\s+function)\b/;
      const ASSIGNMENT_PATTERN = /^(const|let|var)\s+(\w+)\s*=|^([a-zA-Z_$][\w$]*)\s*=/;
      const CONTINUATION_PATTERN = /[+\-*/=,&|!?:;{\[(<]$/;
      const CONTINUATION_OPS = /&&$|\|\|$|\?\?$/;

      const prepareEvalCode = (code) => {
        if (!code || typeof code !== "string") return code;

        const lines = code.split("\n");
        const expressionBoundaries = findExpressionBoundaries(lines);
        if (!expressionBoundaries || expressionBoundaries.length === 0) return code;

        const lastExpr = expressionBoundaries[expressionBoundaries.length - 1];
        const { startLine, isAssigned } = lastExpr;
        if (isAssigned) return code;

        const firstLine = lines[startLine].trim();
        if (STATEMENT_KEYWORDS.test(firstLine)) return code;
        
        const indent = lines[startLine].match(/^\s*/)[0];
        lines[startLine] = indent + "return " + lines[startLine].slice(indent.length);

        return lines.join("\n");
      };

      const findExpressionBoundaries = (lines) => {
        const expressions = [];
        let i = 0;

        const lineData = lines.map(line => {
          const trimmed = line.trim();
          const indentMatch = line.match(/^\s*/);
          return {
            line,
            trimmed,
            indentLen: indentMatch ? indentMatch[0].length : 0,
            isEmpty: trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*")
          };
        });

        while (i < lines.length) {
          const data = lineData[i];
          if (data.isEmpty) {
            i++;
            continue;
          }

          const startLine = i;
          const baseIndent = data.indentLen;
          const isAssigned = ASSIGNMENT_PATTERN.test(data.trimmed);

          let depth = calculateDepth(data.line);
          let j = i + 1;

          while (j < lines.length) {
            const nextData = lineData[j];
            if (nextData.isEmpty) {
              j++;
              continue;
            }

            const nextTrimmed = nextData.trimmed;
            const nextIndent = nextData.indentLen;

            if (nextIndent <= baseIndent) {
              const firstChar = nextTrimmed[0];
              if (firstChar !== "." && firstChar !== "}" && firstChar !== ")" && firstChar !== "]") {
                if (depth <= 0) break;
              }
            }

            const prevLine = lines[j - 1].replace(/\/\/.*$/, "").trim();
            const continues = CONTINUATION_PATTERN.test(prevLine) || CONTINUATION_OPS.test(prevLine);

            if (!continues && !nextTrimmed.startsWith(".") && nextIndent <= baseIndent && depth <= 0) {
              break;
            }

            depth += calculateDepth(nextData.line);
            j++;
          }

          expressions.push({ startLine, endLine: j - 1, isAssigned });
          i = j;
        }

        return expressions;
      };

      const calculateDepth = (line) => {
        const code = line.replace(/\/\/.*$/, "");
        let depth = 0;
        let inString = false;
        let stringChar = "";

        for (let i = 0; i < code.length; i++) {
          const char = code[i];
          const prev = code[i - 1];

          if (char === "\\") {
            i++;
            continue;
          }

          if (!inString && (char === '"' || char === "'" || char === '`')) {
            inString = true;
            stringChar = char;
          } else if (inString && char === stringChar && prev !== "\\") {
            inString = false;
          } else if (!inString) {
            if (char === "(" || char === "{" || char === "[") depth++;
            else if (char === ")" || char === "}" || char === "]") depth--;
          }
        }

        return depth;
      };

      const preparedCode = prepareEvalCode(codein);
      let result = await eval(`(async () => {\n${preparedCode}\n})()`);

      if (result && typeof result === "object") {
        const nullTokens = (obj, visited = new Set()) => {
          if (!obj || typeof obj !== "object") return obj;
          if (visited.has(obj)) return "[Circular]";

          visited.add(obj);

          if (Array.isArray(obj)) {
            return obj.map((item) => nullTokens(item, visited));
          }

          const newObj = { ...obj };
          for (const key in newObj) {
            const lowerKey = key.toLowerCase();

            if (
              lowerKey.includes("token") ||
              lowerKey === "client" ||
              lowerKey.includes("_token") ||
              lowerKey.includes("connectionString")
            ) {
              newObj[key] = null;
              continue;
            }

            if (newObj[key] && typeof newObj[key] === "object") {
              newObj[key] = nullTokens(newObj[key], visited);
            }
          }

          return newObj;
        };

        result = nullTokens(result);
      }

      let output;
      if (typeof result !== "string") {
        output = inspect(result, { depth: 2, maxArrayLength: 150 });
      } else {
        output = result;
      }

      if (
        output.includes("token") ||
        output.includes("connectionString") ||
        output.includes("_token")
      ) {
        output = output
          .replace(/"token"\s*:\s*"[^"]+"/g, '"token": null')
          .replace(/"_token"\s*:\s*"[^"]+"/g, '"_token": null')
          .replace(
            /"connectionString"\s*:\s*"[^"]+"/g,
            '"connectionString": null',
          );
      }

      const prefix = "```js\n";
      const suffix = "```";
      const MAX_SAFE = 1950;

      const full = prefix + output + suffix;
      if (full.length <= 2000) {
        if (!noreply) await message.reply(full, false);
        return;
      }

      if (!noreply) {
        const pages = [];
        let remaining = output;

        while (remaining.length > 0) {
          let chunk = remaining.slice(0, MAX_SAFE);
          const lastNewline = chunk.lastIndexOf("\n");
          if (lastNewline > 200) {
            chunk = chunk.slice(0, lastNewline);
          }

          let content = prefix + chunk + suffix;

          if (content.length > 2000) {
            chunk = chunk.slice(0, 1750 - prefix.length - suffix.length);
            content = prefix + chunk + suffix;
          }

          const embed = new EmbedBuilder()
            .setDescription(content)
            .setColor("#00FF00");
          pages.push(embed);

          remaining = remaining.slice(chunk.length);
        }

        const paginator = new Paginator({
          user: message.author.id,
          client,
          timeout: 600000,
        });

        paginator.add(pages).start(message.channel);
      }
    } catch (e) {
      const errMsg = (e?.stack || e?.message || "Unknown Error").slice(0, 1985);
      await message.reply("```js\n" + errMsg + "```", false);
    }
  },
};

const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const { inspect } = require("util");
const Paginator = require("../functions/pagination");
const { runTagSafe } = require("../interpreter/index.js");

const REDACTED = "[REDACTED]";

const SECRET_KEY_NAMES =
  "api[-_]?keys?|api[-_]?secret|access[-_]?key|secret[-_]?key|auth[-_]?key|token|_token|authorization|auth|password|passwd|passphrase|secret|client[-_]?secret|connection[-_]?string|mongo(?:db)?[-_]?(?:uri|url)|private[-_]?key|dsn|sentry[-_]?dsn|bearer|x[-_]?api[-_]?key|webhook[-_]?(?:url|token)|access[-_]?token|refresh[-_]?token";

const SECRET_EXACT = new Set([
  "token",
  "client",
  "apikey",
  "apisecret",
  "secretkey",
  "authkey",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "bearertoken",
  "authorization",
  "auth",
  "password",
  "passwd",
  "passphrase",
  "secret",
  "clientsecret",
  "privatekey",
  "connectionstring",
  "mongodb",
  "mongouri",
  "dsn",
  "sentrydsn",
  "cookie",
  "sessionid",
  "xapikey",
  "webhookurl",
]);

function isSecretKey(key = "") {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SECRET_EXACT.has(normalized)) return true;

  return (
    normalized.includes("token") ||
    normalized.includes("apikey") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("passphrase") ||
    normalized.includes("authorization") ||
    normalized.includes("connectionstring") ||
    normalized.includes("privatekey") ||
    normalized.includes("accesskey")
  );
}

function redactSecrets(text) {
  if (typeof text !== "string" || !text) return text;

  return text
    .replace(
      /\b(mongodb(?:\+srv)?:\/\/)[^\s"'`&]+/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /(https?:\/\/[^\s"'`]*?[?&](?:api[-_]?key|token|key|secret|sig)=)[^&\s"'`]+/gi,
      `$1${REDACTED}`,
    )
    .replace(
      new RegExp(
        `(["'\`]?\\b(?:${SECRET_KEY_NAMES})\\b["'\`]?\\s*[:=]>?\\s*)(?!\\[${REDACTED}\\])(("[^"\\n]*"|'[^'\\n]*'|\`[^\`\\n]*\`|[^\\s,;)}\\]]+))`,
        "gi",
      ),
      (_match, prefix, value) =>
        value.startsWith("[") ? `${prefix}${value}` : `${prefix}"${REDACTED}"`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`)
    .replace(/\bvk_[A-Za-z0-9._-]{6,}/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, REDACTED);
}

function tokenizeArgs(text) {
  const args = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text))) args.push(m[1] ?? m[2] ?? m[3]);
  return args;
}

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
        const sanitize = (obj, seen = new WeakSet(), depth = 0) => {
          if (!obj || typeof obj !== "object") return obj;
          if (seen.has(obj)) return "[Circular]";
          if (depth > 6) return "[Object]";

          seen.add(obj);

          if (Array.isArray(obj)) {
            return obj.map((item) => sanitize(item, seen, depth + 1));
          }

          if (typeof obj[inspect.custom] === "function") {
            try {
              return sanitize(obj[inspect.custom](2, {}, inspect), seen, depth + 1);
            } catch {}
          }

          const newObj = {};
          for (const key in obj) {
            let value;
            try {
              value = obj[key];
            } catch {
              newObj[key] = "[Unreadable]";
              continue;
            }

            if (isSecretKey(key)) {
              const isFlag = typeof value === "boolean" || typeof value === "number";
              newObj[key] = value === null || value === undefined || isFlag ? value : REDACTED;
              continue;
            }

            if (value === null || value === undefined) {
              newObj[key] = value;
              continue;
            }

            if (typeof value === "function") {
              newObj[key] = `[Function ${value.name || "anonymous"}]`;
              continue;
            }

            if (typeof value === "object") {
              newObj[key] = sanitize(value, seen, depth + 1);
              continue;
            }

            newObj[key] = value;
          }

          return newObj;
        };

        result = sanitize(result);
      }

      let output;
      if (typeof result !== "string") {
        output = inspect(result, { depth: 2, maxArrayLength: 150 });
      } else {
        output = result;
      }

      output = redactSecrets(output);

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
      const errMsg = redactSecrets(
        (e?.stack || e?.message || "Unknown Error").slice(0, 1985),
      );
      await message.reply("```js\n" + errMsg + "```", false);
    }
  },
};

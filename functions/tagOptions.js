const DEFAULT_TRIGGER_REGEX_FLAGS = "i";
const MAX_TRIGGER_REGEX_LENGTH = 250;
const TRIGGER_REGEX_FLAGS = /^[dgimsuvy]*$/;

const FALLBACK_TAG_MESSAGES = {
  regexErrorFlags: "Flags must only contain d, g, i, m, s, u, v, or y.",
  regexErrorRequired: "Pattern is required.",
  regexErrorTooLong: `Pattern must be ${MAX_TRIGGER_REGEX_LENGTH} characters or fewer.`,
  regexErrorUnicodeFlag: "Unicode property escapes require the u or v flag.",
  regexErrorSyntax: "The pattern could not be parsed: {message}",
};

function translateTagMessage(client, db, key, data = {}) {
  const language =
    typeof db?.language === "string" && db.language ? db.language : "en_EN";
  const translated = client?.translate?.get?.(
    language,
    `Commands.tags.${key}`,
    data
  );

  if (
    typeof translated === "string" &&
    !translated.startsWith("Unknown translation:")
  ) {
    return translated;
  }

  const fallback = FALLBACK_TAG_MESSAGES[key] ?? key;
  return fallback.replace(
    /{\w+}/g,
    (match, name) => data[name] ?? match
  );
}

function parseTriggerContent(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "message" || normalized === "messages" || normalized === "text") {
    return "messages";
  }
  if (normalized === "embed" || normalized === "embeds") {
    return "embeds";
  }
  if (normalized === "both" || normalized === "all") {
    return "both";
  }
  return null;
}

function normalizeTriggerContent(value) {
  return parseTriggerContent(value) ?? "both";
}

function allowsBotTrigger(tag) {
  return tag?.triggerBots !== false;
}

function normalizeTriggerRegex(value) {
  if (typeof value !== "string") return null;
  return value.trim() ? value : null;
}

function normalizeTriggerRegexFlags(value) {
  if (value === undefined || value === null) return DEFAULT_TRIGGER_REGEX_FLAGS;
  return String(value).trim();
}

function validateTriggerRegexFlags(value, db, client) {
  const flags = normalizeTriggerRegexFlags(value);
  if (!TRIGGER_REGEX_FLAGS.test(flags)) {
    return {
      error: translateTagMessage(client, db, "regexErrorFlags"),
    };
  }
  return { value: flags };
}

function usesUnicodePropertyEscape(pattern) {
  const source = String(pattern ?? "");

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "\\") continue;

    let slashRun = 0;
    while (source[index + slashRun] === "\\") slashRun += 1;

    const next = index + slashRun;
    if (
      slashRun % 2 === 1 &&
      (source[next] === "p" || source[next] === "P") &&
      source[next + 1] === "{"
    ) {
      return true;
    }

    index += slashRun - 1;
  }

  return false;
}

function validateTriggerRegex(
  pattern,
  flags = DEFAULT_TRIGGER_REGEX_FLAGS,
  db,
  client
) {
  const source = normalizeTriggerRegex(pattern);
  if (!source) {
    return { error: translateTagMessage(client, db, "regexErrorRequired") };
  }
  if (source.length > MAX_TRIGGER_REGEX_LENGTH) {
    return {
      error: translateTagMessage(client, db, "regexErrorTooLong", {
        max: MAX_TRIGGER_REGEX_LENGTH,
      }),
    };
  }

  const flagResult = validateTriggerRegexFlags(flags, db, client);
  if (flagResult.error) return flagResult;

  if (
    usesUnicodePropertyEscape(source) &&
    !/[uv]/.test(flagResult.value)
  ) {
    return {
      error: translateTagMessage(client, db, "regexErrorUnicodeFlag"),
    };
  }

  try {
    return {
      value: {
        pattern: source,
        flags: flagResult.value,
        regex: new RegExp(source, flagResult.value),
      },
    };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message.replace(/^Invalid regular expression:\s*/i, "")
        : String(error ?? "");
    return {
      error: translateTagMessage(client, db, "regexErrorSyntax", {
        message: detail || "Unknown error",
      }),
    };
  }
}

function compileTriggerRegex(tag) {
  const pattern = normalizeTriggerRegex(tag?.triggerRegex);
  if (!pattern) return null;

  const result = validateTriggerRegex(pattern, tag?.triggerRegexFlags);
  return result.value?.regex ?? null;
}

function testTriggerRegex(regex, text, anywhere = false) {
  if (!(regex instanceof RegExp)) return false;

  const value = String(text ?? "");
  regex.lastIndex = 0;
  const match = regex.exec(value);
  regex.lastIndex = 0;
  if (!match) return false;

  return anywhere || (match.index === 0 && match[0].length === value.length);
}

function parseTriggerRegexLiteral(value) {
  const text = String(value ?? "").trim();
  if (!text.startsWith("/")) return null;

  for (let index = text.length - 1; index > 0; index -= 1) {
    if (text[index] !== "/") continue;

    let escapes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
      escapes += 1;
    }
    if (escapes % 2 === 1) continue;

    const flags = text.slice(index + 1);
    if (!TRIGGER_REGEX_FLAGS.test(flags)) continue;

    return {
      pattern: text.slice(1, index),
      flags,
    };
  }

  return null;
}

function formatTriggerRegex(pattern, flags = DEFAULT_TRIGGER_REGEX_FLAGS) {
  const source = normalizeTriggerRegex(pattern);
  if (!source) return null;
  return `/${source}/${normalizeTriggerRegexFlags(flags)}`;
}

module.exports = {
  DEFAULT_TRIGGER_REGEX_FLAGS,
  parseTriggerContent,
  normalizeTriggerContent,
  allowsBotTrigger,
  MAX_TRIGGER_REGEX_LENGTH,
  normalizeTriggerRegex,
  normalizeTriggerRegexFlags,
  validateTriggerRegexFlags,
  validateTriggerRegex,
  compileTriggerRegex,
  testTriggerRegex,
  parseTriggerRegexLiteral,
  formatTriggerRegex,
};

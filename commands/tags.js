const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const Paginator = require('../functions/pagination');
const { runTagSafe } = require('../interpreter/index');
const { trackGuildUpdates } = require("../api/trackSettings");
const { executeTag, buildTagContext, resolveTagSource, parseTagEmbedData } = require("../functions/tagExecution");
const { refreshGuild } = require("../functions/tagIndex");
const { parseMessageLink } = require("../functions/messageSource");
const { dashboardHelpText } = require("../functions/dashboardHelp");
const {
  parseTriggerContent,
  normalizeTriggerContent,
  normalizeTriggerRegexFlags,
  validateTriggerRegex,
  parseTriggerRegexLiteral,
  formatTriggerRegex,
} = require("../functions/tagOptions");

const TAG_TYPES = ["text", "embed", "script"];
const TAG_NAME_MAX = 32;

function tokenizeWithPositions(text) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(String(text ?? "")))) {
    tokens.push({
      value: match[1] ?? match[2] ?? match[3],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

function tokenizeArgs(text) {
  return tokenizeWithPositions(text).map((token) => token.value);
}

function normalizeTagName(value) {
  let name = String(value ?? "").trim();
  const quoted =
    (name.startsWith('"') && name.endsWith('"')) ||
    (name.startsWith("'") && name.endsWith("'"));

  if (quoted && name.length >= 2) name = name.slice(1, -1).trim();
  return name.replace(/\s+/g, " ");
}

function isValidTagName(name) {
  const length = normalizeTagName(name).length;
  return length >= 1 && length <= TAG_NAME_MAX;
}

function findTagByName(tags, name) {
  const key = normalizeTagName(name).toLowerCase();
  if (!key) return null;

  return (
    (Array.isArray(tags) ? tags : []).find(
      (tag) => normalizeTagName(tag?.name).toLowerCase() === key
    ) ?? null
  );
}

function resolveTagArgs(tags, tokens) {
  for (let length = tokens.length; length >= 1; length--) {
    const tag = findTagByName(tags, tokens.slice(0, length).join(" "));
    if (tag) return { tag, rest: tokens.slice(length) };
  }
  return { tag: null, rest: tokens };
}

function sameTag(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.id && b.id) return String(a.id) === String(b.id);
  return (
    normalizeTagName(a.name).toLowerCase() ===
    normalizeTagName(b.name).toLowerCase()
  );
}

function extractCodeBlock(rest) {
  const start = rest.indexOf("```");
  if (start === -1) return null;

  const afterFirst = rest.indexOf("```", start + 3);
  if (afterFirst === -1) return null;

  const openLineEnd = rest.indexOf("\n", start);
  const codeStart = openLineEnd === -1 ? start + 3 : openLineEnd + 1;

  return {
    code: rest.slice(codeStart, afterFirst),
    tail: rest.slice(afterFirst + 3),
  };
}

function parseTagAdd(message, prefix) {
  const content = String(message?.content ?? "");
  const tokens = tokenizeWithPositions(content);
  const commandNames = new Set([
    "tag",
    "tags",
    `${prefix}tag`.toLowerCase(),
    `${prefix}tags`.toLowerCase(),
  ]);

  const commandIndex = tokens.findIndex((token) =>
    commandNames.has(token.value.toLowerCase())
  );
  if (commandIndex === -1) return null;
  if (!["add", "create"].includes(tokens[commandIndex + 1]?.value.toLowerCase())) {
    return null;
  }

  const nameParts = [];
  let index = commandIndex + 2;
  while (
    index < tokens.length &&
    !TAG_TYPES.includes(tokens[index].value.toLowerCase())
  ) {
    nameParts.push(tokens[index].value);
    index++;
  }

  const name = normalizeTagName(nameParts.join(" "));
  if (index >= tokens.length) return { name, type: null, rawContent: "" };

  return {
    name,
    type: tokens[index].value.toLowerCase(),
    rawContent: content.slice(tokens[index].end).trim(),
  };
}

function sourceContent(source) {
  const replied = source?.message;
  if (!replied) return "";

  const text = String(replied.content ?? "").trim();
  if (text) return text;

  const embeds = replied.embeds
    ? [...(replied.embeds.values?.() ?? replied.embeds)]
    : [];

  return embeds
    .map((embed) => String(embed?.description ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function codeSnippet(code, line, col) {
  if (!code) return null;
  if (line != null) {
    const text = code.split("\n")[line - 1] ?? "";
    const colIndex = Math.min(Math.max(0, (col ?? 1) - 1), text.length);
    const gutter = String(line);
    return `${gutter} | ${text}\n${" ".repeat(gutter.length + 3 + colIndex)}^`;
  }
  const head = code.split("\n").slice(0, 12).join("\n");
  return head.length > 800 ? head.slice(0, 800) + "\n..." : head;
}

function makeScriptErrorEmbed(client, db, err, sourceCode = null) {
  const loc =
    err.line != null
      ? ` (line ${err.line}${err.col != null ? `:${err.col}` : ""})`
      : "";

  let description = `\`\`\`\n${err.name}: ${err.message}${loc}\n\`\`\``;

  if (sourceCode && err.line != null) {
    const snippet = codeSnippet(sourceCode, err.line, err.col);
    if (snippet) {
      description += `\n\`\`\`fluxer\n${snippet}\n\`\`\``;
    }
  }

  return new EmbedBuilder()
    .setColor("#FF0000")
    .setTitle(client.translate.get(db.language, "Commands.tags.scriptError"))
    .setDescription(description);
}

function typeLabel(client, db, type) {
  if (type === "text") return `📝 ${client.translate.get(db.language, "Commands.tags.text")}`;
  if (type === "embed") return `📄 ${client.translate.get(db.language, "Commands.tags.embed")}`;
  return `⚡ ${client.translate.get(db.language, "Commands.tags.script")}`;
}

function typeEmoji(type) {
  if (type === "text") return "📝";
  if (type === "embed") return "📄";
  return "⚡";
}

function triggerContentLabel(client, db, value) {
  const normalized = normalizeTriggerContent(value);
  const key =
    normalized === "messages"
      ? "contentMessages"
      : normalized === "embeds"
        ? "contentEmbeds"
        : "contentBoth";
  return client.translate.get(db.language, `Commands.tags.${key}`);
}

const tagsModule = {
  config: {
    name: "tags",
    usage: "help",
    cooldown: 3000,
    available: true,
    permissions: {
      name: "Manage Guild",
      bitField: PermissionFlags.ManageGuild,
    },
    aliases: ["tag"],
  },

  run: async (client, message, args, db) => {
    const triggerAliases = ["trigger", "triggers", "triggerword", "triggerwords"];
    const anyTriggerAliases = [
      "anytrigger",
      "anytriggers",
      "anytriggerword",
      "anytriggerwords",
      "triggeranywhere",
      "triggeranywhereword",
      "anywheretrigger",
      "anywheretriggerword",
    ];
    const botTriggerAliases = [
      "bots",
      "bot",
      "bottrigger",
      "bottriggers",
      "triggerbot",
      "triggerbots",
    ];
    const contentAliases = ["content", "contents", "triggercontent", "source"];
    const regexAliases = [
      "regex",
      "regexp",
      "pattern",
      "triggerregex",
      "triggerpattern",
    ];
    const rawSubcommand = args[0]?.toLowerCase();
    const subcommand =
      rawSubcommand === "create"
        ? "add"
        : triggerAliases.includes(rawSubcommand)
          ? "trigger"
          : anyTriggerAliases.includes(rawSubcommand)
            ? "anytrigger"
            : botTriggerAliases.includes(rawSubcommand)
              ? "bottrigger"
              : regexAliases.includes(rawSubcommand)
                ? "regex"
                : contentAliases.includes(rawSubcommand)
                  ? "content"
                  : rawSubcommand;
    const prefix = db.prefix;
    const t = (key, vars) => client.translate.get(db.language, `Commands.tags.${key}`, vars);

    switch (subcommand) {
      default:
        if (args[0]) {
          const tokens = tokenizeArgs(args.join(" "));
          const { tag, rest: remaining } = resolveTagArgs(db.tags, tokens);

          if (!tag) {
            return message.reply({
              embeds: [
                new EmbedBuilder()
                  .setDescription(
                    t("notFound", { name: tokens.join(" ") })
                  )
                  .setColor("#FF0000"),
              ],
            });
          }

          const sourceArgs = parseMessageLink(remaining[0])
            ? [remaining.shift()]
            : [];

          return executeTag(client, message, db, tag, remaining, { sourceArgs });
        }

      case "help": {
        const embed = new EmbedBuilder()
          .setColor(db.theme)
          .setTitle(t("helpTitle"))
          .setDescription(
            [
              `**${t("helpCreating")}**`,
              `\`${prefix}tags add "my tag" text ${t("placeholders.content")}\``,
              `\`${prefix}tags add ${t("placeholders.name")} embed ${t("placeholders.description")}\``,
              t("helpEmbedJson", { prefix }),
              `\`${prefix}tags add ${t("placeholders.name")} script ${t("placeholders.codeBlock")}\``,
              t("helpMultiWordNames", { prefix }),
              ``,
              `**${t("helpExampleScript")}**`,
              `\`${prefix}tags add greet script\``,
              "```rune",
              'say("Hello", $user.username + "!")',
              "say(embed()",
              '  .title("Welcome")',
              '  .description("You are in " + $guild.name)',
              '  .color("blurple"))',
              "```",
              `**${t("helpUsing")}**`,
              `\`${prefix}tags ${t("placeholders.name")} [args...]\``,
              t("helpTrigger", { "prefix": db.prefix }),
              t("helpReplySource", { prefix }),
              t("helpCustomize", { prefix }),
              t("helpRegex", { prefix }),
              ``,
              `**${t("helpManaging")}**`,
              `\`${prefix}tags list\``,
              `\`${prefix}tags view ${t("placeholders.name")}\``,
              `\`${prefix}tags edit ${t("placeholders.name")}\``,
              `\`${prefix}tags remove ${t("placeholders.name")}\``,
              `\`${prefix}tags trigger ${t("placeholders.name")} on|off\``,
              `\`${prefix}tags anytrigger ${t("placeholders.name")} on|off\``,
              `\`${prefix}tags bots ${t("placeholders.name")} on|off\``,
              `\`${prefix}tags content ${t("placeholders.name")} messages|embeds|both\``,
              `**${t("helpScriptContext")}**`,
              t("helpScriptContextDesc"),
              ``,
              t("learnMore"),
              "",
              dashboardHelpText(client, db, message.guildId, "tags"),
            ].join("\n")
          );
        return message.reply({ embeds: [embed] });
      }

      case "regex": {
        const regexTokens = tokenizeArgs(args.slice(1).join(" "));

        if (!regexTokens.length) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("regexUsage", { prefix }))
                .setColor("#FF0000"),
            ],
          });
        }

        const { tag: regexTag, rest: regexRest } = resolveTagArgs(
          db.tags,
          regexTokens
        );

        if (!regexTag) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  t("notFound", { name: regexTokens.join(" ") })
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const rawPattern = regexRest.join(" ").trim();

        if (!rawPattern) {
          const current = regexTag.triggerRegex
            ? formatTriggerRegex(
                regexTag.triggerRegex,
                regexTag.triggerRegexFlags
              )
            : t("regexNotSet");

          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(db.theme)
                .setTitle(t("regexTitle", { name: regexTag.name }))
                .setDescription(
                  `${current}\n\n\`${prefix}tags regex ${regexTag.name} /pattern/flags\``
                ),
            ],
          });
        }

        if (["clear", "reset", "off", "none"].includes(rawPattern.toLowerCase())) {
          const updatedTags = db.tags.map((tg) =>
            sameTag(tg, regexTag)
              ? { ...tg, triggerRegex: null, triggerRegexFlags: "i" }
              : tg
          );

          await client.database.updateGuild(message.guild.id, {
            tags: updatedTags,
          });

          await trackGuildUpdates(client, {
            guildId: message.guildId,
            userId: message.author.id,
            existing: db,
            updates: { tags: updatedTags },
          });

          regexTag.triggerRegex = null;
          regexTag.triggerRegexFlags = "i";
          await refreshGuild(client, message.guildId);

          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("regexCleared", { name: regexTag.name }))
                .setColor(db.theme),
            ],
          });
        }

        const literal = parseTriggerRegexLiteral(rawPattern);
        const pattern = literal ? literal.pattern : rawPattern;
        const flags = literal
          ? literal.flags
          : normalizeTriggerRegexFlags(regexTag.triggerRegexFlags);
        const checked = validateTriggerRegex(pattern, flags, db, client);

        if (checked.error) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  t("regexInvalid", { error: checked.error, prefix })
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const updatedTags = db.tags.map((tg) =>
          sameTag(tg, regexTag)
            ? {
                ...tg,
                triggerRegex: checked.value.pattern,
                triggerRegexFlags: checked.value.flags,
              }
            : tg
        );

        await client.database.updateGuild(message.guild.id, {
          tags: updatedTags,
        });

        await trackGuildUpdates(client, {
          guildId: message.guildId,
          userId: message.author.id,
          existing: db,
          updates: { tags: updatedTags },
        });

        regexTag.triggerRegex = checked.value.pattern;
        regexTag.triggerRegexFlags = checked.value.flags;
        await refreshGuild(client, message.guildId);

        const regexLabel = formatTriggerRegex(
          checked.value.pattern,
          checked.value.flags
        );
        const triggerHint =
          regexTag.trigger === true || regexTag.anyTrigger === true
            ? ""
            : `\n\n${t("regexTriggerHint", {
                prefix,
                name: regexTag.name,
              })}`;

        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(
                `${t("regexSet", {
                  name: regexTag.name,
                  regex: regexLabel,
                })}${triggerHint}`
              )
              .setColor(db.theme),
          ],
        });
      }

      case "trigger": {
        const triggerTokens = tokenizeArgs(args.slice(1).join(" "));
        const target = triggerTokens[0];

        let value;

        if (!target) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("triggerUsage", { prefix }))
                .setColor("#FF0000"),
            ],
          });
        }

        const truthy = ["on", "enable", "enabled", "true", "yes", "1"];
        const falsy = ["off", "disable", "disabled", "false", "no", "0"];
        const state = (bool) => (bool ? "on" : "off");

        const { tag: triggerTag, rest: triggerRest } = resolveTagArgs(
          db.tags,
          triggerTokens
        );
        value = triggerRest[0]?.toLowerCase();

        if (!triggerTag) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  t("notFound", { name: triggerTokens.join(" ") })
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const triggerRegexNote = triggerTag.triggerRegex
          ? `\n${t("regexActive", {
              regex: formatTriggerRegex(
                triggerTag.triggerRegex,
                triggerTag.triggerRegexFlags
              ),
            })}`
          : "";

        if (!value) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(db.theme)
                .setTitle(t("triggerTitle"))
                .setDescription(
                  `${t("triggerTagStatus", {
                    name: triggerTag.name,
                    state: state(triggerTag.trigger === true),
                  })}${triggerRegexNote}\n\n\`${prefix}tags trigger ${triggerTag.name} on|off\``
                ),
            ],
          });
        }

        if (!truthy.includes(value) && !falsy.includes(value)) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  `${t("invalidOption")}\n\`${prefix}tags trigger ${triggerTag.name} on|off\``
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const enabled = truthy.includes(value);

        if ((triggerTag.trigger === true && triggerTag.anyTrigger !== true) === enabled) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  t("triggerTagAlready", {
                    name: triggerTag.name,
                    state: state(enabled),
                  })
                )
                .setColor(db.theme),
            ],
          });
        }

        const updatedTags = db.tags.map((tg) =>
          tg.name.toLowerCase() === triggerTag.name.toLowerCase()
            ? enabled
              ? { ...tg, trigger: true, anyTrigger: false }
              : { ...tg, trigger: false }
            : tg
        );

        await client.database.updateGuild(message.guild.id, {
          tags: updatedTags,
        });

        await trackGuildUpdates(client, {
          guildId: message.guildId,
          userId: message.author.id,
          existing: db,
          updates: { tags: updatedTags },
        });

        triggerTag.trigger = enabled;
        if (enabled) triggerTag.anyTrigger = false;
        await refreshGuild(client, message.guildId);

        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(
                `${t(
                  enabled
                    ? "triggerTagEnabled"
                    : "triggerTagDisabled",
                  { name: triggerTag.name }
                )}${enabled ? triggerRegexNote : ""}`
              )
              .setColor(db.theme),
          ],
        });
      }

      case "anytrigger": {
        const anyTokens = tokenizeArgs(args.slice(1).join(" "));
        const target = anyTokens[0];
        const truthy = ["on", "enable", "enabled", "true", "yes", "1"];
        const falsy = ["off", "disable", "disabled", "false", "no", "0"];
        const state = (bool) => (bool ? "on" : "off");

        if (!target) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("anyTriggerUsage", { prefix }))
                .setColor("#FF0000"),
            ],
          });
        }

        const { tag: anyTag, rest: anyRest } = resolveTagArgs(
          db.tags,
          anyTokens
        );
        const value = anyRest[0]?.toLowerCase();

        if (!anyTag) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("notFound", { name: anyTokens.join(" ") }))
                .setColor("#FF0000"),
            ],
          });
        }

        const anyRegexNote = anyTag.triggerRegex
          ? `\n${t("regexActive", {
              regex: formatTriggerRegex(
                anyTag.triggerRegex,
                anyTag.triggerRegexFlags
              ),
            })}`
          : "";

        if (value && !truthy.includes(value) && !falsy.includes(value)) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  `${t("invalidOption")}\n\`${prefix}tags anytrigger ${anyTag.name} on|off\``
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const enabled = value ? truthy.includes(value) : true;

        if ((anyTag.anyTrigger === true && anyTag.trigger !== true) === enabled) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  t("anyTriggerTagAlready", {
                    name: anyTag.name,
                    state: state(enabled),
                  })
                )
                .setColor(db.theme),
            ],
          });
        }

        const updatedTags = db.tags.map((tg) =>
          tg.name.toLowerCase() === anyTag.name.toLowerCase()
            ? enabled
              ? { ...tg, anyTrigger: true, trigger: false }
              : { ...tg, anyTrigger: false }
            : tg
        );

        await client.database.updateGuild(message.guild.id, {
          tags: updatedTags,
        });

        await trackGuildUpdates(client, {
          guildId: message.guildId,
          userId: message.author.id,
          existing: db,
          updates: { tags: updatedTags },
        });

        anyTag.anyTrigger = enabled;
        if (enabled) anyTag.trigger = false;
        await refreshGuild(client, message.guildId);

        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(
                `${t(
                  enabled
                    ? "anyTriggerTagEnabled"
                    : "anyTriggerTagDisabled",
                  { name: anyTag.name }
                )}${enabled ? anyRegexNote : ""}`
              )
              .setColor(db.theme),
          ],
        });
      }

      case "bottrigger": {
        const botTokens = tokenizeArgs(args.slice(1).join(" "));
        const truthy = ["on", "enable", "enabled", "true", "yes", "1"];
        const falsy = ["off", "disable", "disabled", "false", "no", "0"];
        const state = (bool) => (bool ? "on" : "off");

        if (!botTokens.length) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("botTriggerUsage", { prefix }))
                .setColor("#FF0000"),
            ],
          });
        }

        const { tag: botTag, rest: botRest } = resolveTagArgs(
          db.tags,
          botTokens
        );
        const value = botRest[0]?.toLowerCase();

        if (!botTag) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("notFound", { name: botTokens.join(" ") }))
                .setColor("#FF0000"),
            ],
          });
        }

        const current = botTag.triggerBots !== false;

        if (!value) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(db.theme)
                .setTitle(t("botTrigger"))
                .setDescription(
                  [
                    t("botTriggerTagStatus", {
                      name: botTag.name,
                      state: state(current),
                    }),
                    "",
                    `\`${prefix}tags bots ${botTag.name} on|off\``,
                  ].join("\n")
                ),
            ],
          });
        }

        if (!truthy.includes(value) && !falsy.includes(value)) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  `${t("invalidOption")}\n\`${prefix}tags bots ${botTag.name} on|off\``
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const enabled = truthy.includes(value);

        if (current === enabled) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  t("botTriggerTagAlready", {
                    name: botTag.name,
                    state: state(enabled),
                  })
                )
                .setColor(db.theme),
            ],
          });
        }

        const updatedTags = db.tags.map((tg) =>
          sameTag(tg, botTag) ? { ...tg, triggerBots: enabled } : tg
        );

        await client.database.updateGuild(message.guild.id, {
          tags: updatedTags,
        });

        await trackGuildUpdates(client, {
          guildId: message.guildId,
          userId: message.author.id,
          existing: db,
          updates: { tags: updatedTags },
        });

        botTag.triggerBots = enabled;
        await refreshGuild(client, message.guildId);

        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(
                `${t(
                  enabled ? "botTriggerEnabled" : "botTriggerDisabled",
                  { name: botTag.name }
                )}`
              )
              .setColor(db.theme),
          ],
        });
      }

      case "content": {
        const contentTokens = tokenizeArgs(args.slice(1).join(" "));

        if (!contentTokens.length) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("contentUsage", { prefix }))
                .setColor("#FF0000"),
            ],
          });
        }

        const { tag: contentTag, rest: contentRest } = resolveTagArgs(
          db.tags,
          contentTokens
        );
        const value = contentRest[0]?.toLowerCase();

        if (!contentTag) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  t("notFound", { name: contentTokens.join(" ") })
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const current = normalizeTriggerContent(contentTag.triggerContent);

        if (!value) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(db.theme)
                .setTitle(t("contentLabel"))
                .setDescription(
                  `${t("contentStatus", {
                    name: contentTag.name,
                    content: triggerContentLabel(client, db, current),
                  })}\n\n\`${prefix}tags content ${contentTag.name} messages|embeds|both\``
                ),
            ],
          });
        }

        const next = parseTriggerContent(value);

        if (!next) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("contentInvalid", { prefix }))
                .setColor("#FF0000"),
            ],
          });
        }

        if (current === next) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  t("contentAlready", {
                    name: contentTag.name,
                    content: triggerContentLabel(client, db, next),
                  })
                )
                .setColor(db.theme),
            ],
          });
        }

        const updatedTags = db.tags.map((tg) =>
          sameTag(tg, contentTag) ? { ...tg, triggerContent: next } : tg
        );

        await client.database.updateGuild(message.guild.id, {
          tags: updatedTags,
        });

        await trackGuildUpdates(client, {
          guildId: message.guildId,
          userId: message.author.id,
          existing: db,
          updates: { tags: updatedTags },
        });

        contentTag.triggerContent = next;
        await refreshGuild(client, message.guildId);

        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(
                t("contentSet", {
                  name: contentTag.name,
                  content: triggerContentLabel(client, db, next),
                })
              )
              .setColor(db.theme),
          ],
        });
      }

      case "add": {
        const parsed = parseTagAdd(message, prefix);

        if (!parsed?.name) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  `${t("provideName")}\n${t("usage")}: \`${prefix}tags add "my tag" text|embed|script ${t("placeholders.content")}\``
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const tagName = parsed.name;

        if (!isValidTagName(tagName)) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("nameInvalid"))
                .setColor("#FF0000"),
            ],
          });
        }

        if (findTagByName(db.tags, tagName)) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("alreadyExists", { name: tagName }))
                .setColor("#FF0000"),
            ],
          });
        }

        if ((db.tags?.length || 0) >= 50) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("maxTags"))
                .setColor("#FF0000"),
            ],
          });
        }

        if (!parsed.type) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  `${t("specifyType")}\n\n` +
                    t("specifyTypeHint", { prefix })
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const tagType = parsed.type;
        if (!TAG_TYPES.includes(tagType)) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("invalidType"))
                .setColor("#FF0000"),
            ],
          });
        }

        const fenced = extractCodeBlock(parsed.rawContent);
        let content = fenced ? fenced.code : parsed.rawContent;

        if (!content.trim()) {
          const source = await resolveTagSource(client, message);
          content = sourceContent(source);
        }

        if (!content.trim()) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  tagType === "script" ? t("provideScript") : t("provideContent")
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const limits = { text: 2000, embed: 6000, script: 12000 };
        if (content.length > limits[tagType]) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  t("contentTooLong", { max: limits[tagType], type: tagType })
                )
                .setColor("#FF0000"),
            ],
          });
        }

        if (tagType === "script") {
          const check = runTagSafe(content, buildTagContext(client, message, db, null, []));
          if (!check.ok) {
            return message.reply({
              embeds: [makeScriptErrorEmbed(client, db, check.error, content)],
            });
          }
        }

        let embedData = null;
        if (tagType === "embed") {
          const parsedEmbed = parseTagEmbedData(content, db.theme);
          if (parsedEmbed.error) {
            return message.reply({
              embeds: [
                new EmbedBuilder()
                  .setDescription(
                    t(
                      parsedEmbed.error === "invalidJson"
                        ? "embedJsonInvalid"
                        : "provideContent"
                    )
                  )
                  .setColor("#FF0000"),
              ],
            });
          }
          embedData = parsedEmbed.value;
        }

        const newTag = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: tagName,
          type: tagType,
          content: tagType === "text" || tagType === "script" ? content : null,
          embedData,
          createdBy: message.author.id,
          createdAt: Date.now(),
          uses: 0,
          trigger: false,
          anyTrigger: false,
          triggerBots: true,
          triggerRegex: null,
          triggerRegexFlags: "i",
          triggerContent: "both",
        };

        await client.database.updateGuild(message.guild.id, {
          tags: [...(db.tags || []), newTag],
        });

        await trackGuildUpdates(client, {
          guildId: message.guildId,
          userId: message.author.id,
          existing: db,
          updates: { tags: [...(db.tags || []), newTag] },
        });

        await refreshGuild(client, message.guildId);

        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(t("createdSuccess", { name: tagName, type: tagType }))
              .setColor(db.theme),
          ],
        });
      }

      case "remove": {
        const removeTokens = tokenizeArgs(args.slice(1).join(" "));

        if (!removeTokens.length) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  `${t("provideRemoveName")}\n${t("usage")}: \`${prefix}tags remove ${t("placeholders.name")}\``
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const { tag: removedTag } = resolveTagArgs(db.tags, removeTokens);

        if (!removedTag) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  t("notFound", { name: removeTokens.join(" ") })
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const tagIndex = db.tags.indexOf(removedTag);

        const confirmEmbed = new EmbedBuilder()
          .setColor(db.theme)
          .setDescription(t("confirmDelete", { name: removedTag.name }))
          .addFields(
            {
              name: t("type"),
              value: typeLabel(client, db, removedTag.type),
              inline: true,
            },
            {
              name: t("uses"),
              value: String(removedTag.uses || 0),
              inline: true,
            }
          );

        const confirmMsg = await message.reply({ embeds: [confirmEmbed] });
        await confirmMsg.react("✅");
        await confirmMsg.react("❌");

        const filter = (reaction, user) =>
          ["✅", "❌"].includes(reaction.emoji.name) && user.id === message.author.id;

        try {
          const collector = confirmMsg.createReactionCollector({ filter, time: 30000 });

          collector.on("collect", async (reaction) => {
            if (reaction.emoji.name === "✅") {
              const updatedTags = db.tags.filter((_, i) => i !== tagIndex);
              await client.database.updateGuild(message.guild.id, { tags: updatedTags });

              await trackGuildUpdates(client, {
                guildId: message.guildId,
                userId: message.author.id,
                existing: db,
                updates: { tags: updatedTags },
              });

              await refreshGuild(client, message.guildId);
              
              await confirmMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setDescription(t("deletedSuccess", { name: removedTag.name }))
                    .setColor(db.theme),
                ],
              });
            } else {
              await confirmMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setDescription(t("deleteCancelled"))
                    .setColor(db.theme),
                ],
              });
            }
            await confirmMsg.removeAllReactions().catch(() => {});
            collector.stop();
          });

          collector.on("end", (_, reason) => {
            if (reason === "time") confirmMsg.removeAllReactions().catch(() => {});
          });
        } catch (err) {
          console.error("Error in reaction collector:", err);
        }
        break;
      }

      case "edit": {
        const editTokens = tokenizeArgs(args.slice(1).join(" "));

        if (!editTokens.length) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  `${t("provideEditName")}\n${t("usage")}: \`${prefix}tags edit ${t("placeholders.name")}\``
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const { tag: editingTag } = resolveTagArgs(db.tags, editTokens);

        if (!editingTag) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("notFound", { name: editTokens.join(" ") }))
                .setColor("#FF0000"),
            ],
          });
        }

        const editTagIndex = db.tags.indexOf(editingTag);

        const contentPreview =
          editingTag.type === "script" || editingTag.type === "text"
            ? (editingTag.content || "").substring(0, 350) +
              ((editingTag.content || "").length > 350 ? "…" : "")
            : (editingTag.embedData?.description || "").substring(0, 350) +
              ((editingTag.embedData?.description || "").length > 350 ? "…" : "");

        const menuEmbed = new EmbedBuilder()
          .setColor(db.theme)
          .setTitle(t("editing", { name: editingTag.name }))
          .setDescription(
            [
              `**${t("type")}:** ${typeLabel(client, db, editingTag.type)}`,
              `**${t("uses")}:** ${editingTag.uses || 0}`,
              `**${t("created")}:** <t:${Math.floor(editingTag.createdAt / 1000)}:R>`,
              ``,
              `**${t("contentSource")}:**`,
              "```",
              contentPreview || t("empty"),
              "```",
              ``,
              `**${t("options")}**`,
              `1️⃣ ${t("editName")}`,
              `2️⃣ ${t("editContent")}`,
              `3️⃣ ${t("changeType")}`,
              `❌ ${t("cancel")}`,
            ].join("\n")
          );

        const menuMsg = await message.reply({ embeds: [menuEmbed] });
        await menuMsg.react("1️⃣");
        await menuMsg.react("2️⃣");
        await menuMsg.react("3️⃣");
        await menuMsg.react("❌");

        const editFilter = (reaction, user) =>
          ["1️⃣", "2️⃣", "3️⃣", "❌"].includes(reaction.emoji.name) &&
          user.id === message.author.id;

        try {
          const editCollector = menuMsg.createReactionCollector({
            filter: editFilter,
            time: 90000,
          });

          editCollector.on("collect", async (reaction) => {
            if (reaction.emoji.name === "1️⃣") {
              await menuMsg.removeAllReactions().catch(() => {});
              await menuMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setColor(db.theme)
                    .setDescription(t("replyNewName")),
                ],
              });

              const nameCollector = message.channel.createMessageCollector({
                filter: (m) => m.author.id === message.author.id,
                time: 60000,
                max: 1,
              });

              nameCollector.on("collect", async (m) => {
                const newName = normalizeTagName(m.content);
                if (!isValidTagName(newName)) {
                  return m.reply({
                    embeds: [
                      new EmbedBuilder()
                        .setDescription(t("invalidName"))
                        .setColor("#FF0000"),
                    ],
                  });
                }
                if (
                  db.tags.some(
                    (tg) =>
                      tg !== editingTag &&
                      normalizeTagName(tg.name).toLowerCase() ===
                        newName.toLowerCase()
                  )
                ) {
                  return m.reply({
                    embeds: [
                      new EmbedBuilder()
                        .setDescription(t("alreadyExists", { name: newName }))
                        .setColor("#FF0000"),
                    ],
                  });
                }

                const updated = [...db.tags];
                updated[editTagIndex].name = newName;
                await client.database.updateGuild(message.guild.id, { tags: updated });

                await trackGuildUpdates(client, {
                  guildId: message.guildId,
                  userId: message.author.id,
                  existing: db,
                  updates: { tags: updated },
                });

                await refreshGuild(client, message.guildId);
                
                await menuMsg.edit({
                  embeds: [
                    new EmbedBuilder()
                      .setDescription(t("nameChanged", { name: newName }))
                      .setColor(db.theme),
                  ],
                });
              });
            }

            else if (reaction.emoji.name === "2️⃣") {
              await menuMsg.removeAllReactions().catch(() => {});

              const currentContent =
                editingTag.type === "embed"
                  ? JSON.stringify(editingTag.embedData ?? {}, null, 2)
                  : (editingTag.content || "");

              const maxPreview = 3400;
              const isTruncated = currentContent.length > maxPreview;
              const displayContent = isTruncated
                ? currentContent.slice(0, maxPreview) + "\n…"
                : currentContent || t("empty");

              const lang = editingTag.type === "script" ? "fluxer" : "";

              await menuMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setColor(db.theme)
                    .setTitle(t("editContentTitle", { name: editingTag.name }))
                    .setDescription(
                      [
                        editingTag.type === "script"
                          ? t("replyNewScript")
                          : editingTag.type === "embed"
                            ? t("replyNewEmbed")
                            : t("replyNewContent"),
                        "",
                        `**${t("currentContent")}:**`,
                        "```" + lang,
                        displayContent,
                        "```",
                        isTruncated ? `\n*${t("contentTruncated")}*` : "",
                      ]
                        .filter(Boolean)
                        .join("\n")
                    ),
                ],
              });

              const contentCollector = message.channel.createMessageCollector({
                filter: (m) => m.author.id === message.author.id,
                time: 180000,
                max: 1,
              });

              contentCollector.on("collect", async (m) => {
                let newContent = m.content.trim();
                const fenced = extractCodeBlock(newContent);
                if (fenced) newContent = fenced.code;

                if (editingTag.type === "script") {
                  const check = runTagSafe(newContent, buildTagContext(client, message, db, null, []));
                  if (!check.ok) {
                    return m.reply({
                      embeds: [makeScriptErrorEmbed(client, db, check.error, newContent)],
                    });
                  }
                }

                const updated = [...db.tags];
                if (editingTag.type === "text" || editingTag.type === "script") {
                  updated[editTagIndex].content = newContent;
                } else if (newContent.trim().startsWith("{")) {
                  const parsedEmbed = parseTagEmbedData(newContent, db.theme);
                  if (parsedEmbed.error) {
                    return m.reply({
                      embeds: [
                        new EmbedBuilder()
                          .setDescription(t("embedJsonInvalid"))
                          .setColor("#FF0000"),
                      ],
                    });
                  }
                  updated[editTagIndex].embedData = parsedEmbed.value;
                } else {
                  updated[editTagIndex].embedData = {
                    ...(updated[editTagIndex].embedData || {}),
                    description: newContent,
                  };
                }

                await client.database.updateGuild(message.guild.id, { tags: updated });

                await trackGuildUpdates(client, {
                  guildId: message.guildId,
                  userId: message.author.id,
                  existing: db,
                  updates: { tags: updated },
                });

                await refreshGuild(client, message.guildId);
                
                await menuMsg.edit({
                  embeds: [
                    new EmbedBuilder()
                      .setDescription(t("contentUpdated"))
                      .setColor(db.theme),
                  ],
                });
              });
            }

            else if (reaction.emoji.name === "3️⃣") {
              await menuMsg.removeAllReactions().catch(() => {});

              const typeEmbed = new EmbedBuilder()
                .setColor(db.theme)
                .setTitle(t("changeTypeTitle", { name: editingTag.name }))
                .setDescription(
                  [
                    t("currentType", { type: typeLabel(client, db, editingTag.type) }),
                    ``,
                    t("pickNewType"),
                    ``,
                    `📝 **${t("text")}**`,
                    t("typeTextDesc"),
                    ``,
                    `📄 **${t("embed")}**`,
                    t("typeEmbedDesc"),
                    ``,
                    `⚡ **${t("script")}**`,
                    t("typeScriptDesc"),
                    ``,
                    t("reactTypeOrCancel"),
                  ].join("\n")
                );

              await menuMsg.edit({ embeds: [typeEmbed] });
              await menuMsg.react("📝");
              await menuMsg.react("📄");
              await menuMsg.react("⚡");
              await menuMsg.react("❌");

              const typeFilter = (reaction, user) =>
                ["📝", "📄", "⚡", "❌"].includes(reaction.emoji.name) &&
                user.id === message.author.id;

              const typeCollector = menuMsg.createReactionCollector({
                filter: typeFilter,
                time: 60000,
                max: 1,
              });

              typeCollector.on("collect", async (typeReaction) => {
                if (typeReaction.emoji.name === "❌") {
                  await menuMsg.removeAllReactions().catch(() => {});
                  await menuMsg.edit({
                    embeds: [
                      new EmbedBuilder()
                        .setDescription(t("typeChangeCancelled"))
                        .setColor(db.theme),
                    ],
                  });
                  return;
                }

                const typeMap = {
                  "📝": "text",
                  "📄": "embed",
                  "⚡": "script",
                };
                const next = typeMap[typeReaction.emoji.name];

                if (!next || next === editingTag.type) {
                  await menuMsg.removeAllReactions().catch(() => {});
                  await menuMsg.edit({
                    embeds: [
                      new EmbedBuilder()
                        .setDescription(
                          next === editingTag.type
                            ? t("typeAlready", { type: next })
                            : t("invalidSelection")
                        )
                        .setColor(db.theme),
                    ],
                  });
                  return;
                }

                const updated = [...db.tags];
                const cur = updated[editTagIndex];

                if (cur.type === "text" && next === "embed") {
                  cur.embedData = {
                    description: cur.content || "",
                    color: db.theme,
                  };
                  cur.content = null;
                } else if (cur.type === "text" && next === "script") {
                } else if (cur.type === "embed" && next === "text") {
                  cur.content = cur.embedData?.description || "";
                  cur.embedData = null;
                } else if (cur.type === "embed" && next === "script") {
                  cur.content = cur.embedData?.description || "";
                  cur.embedData = null;
                } else if (cur.type === "script" && next === "text") {
                } else if (cur.type === "script" && next === "embed") {
                  cur.embedData = {
                    description: cur.content || "",
                    color: db.theme,
                  };
                  cur.content = null;
                }

                cur.type = next;
                await client.database.updateGuild(message.guild.id, { tags: updated });

                await trackGuildUpdates(client, {
                  guildId: message.guildId,
                  userId: message.author.id,
                  existing: db,
                  updates: { tags: updated },
                });

                await refreshGuild(client, message.guildId);

                await menuMsg.removeAllReactions().catch(() => {});
                await menuMsg.edit({
                  embeds: [
                    new EmbedBuilder()
                      .setDescription(
                        t("typeChanged", {
                          name: cur.name,
                          type: typeLabel(client, db, next),
                        })
                      )
                      .setColor(db.theme),
                  ],
                });
              });

              typeCollector.on("end", (_, reason) => {
                if (reason === "time") {
                  menuMsg.removeAllReactions().catch(() => {});
                }
              });
            }

            else if (reaction.emoji.name === "❌") {
              await menuMsg.removeAllReactions().catch(() => {});
              await menuMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setDescription(t("editCancelled"))
                    .setColor(db.theme),
                ],
              });
            }

            editCollector.stop();
          });

          editCollector.on("end", (_, reason) => {
            if (reason === "time") menuMsg.removeAllReactions().catch(() => {});
          });
        } catch (err) {
          console.error("Error in edit collector:", err);
        }
        break;
      }

      case "view": {
        const viewTokens = tokenizeArgs(args.slice(1).join(" "));

        if (!viewTokens.length) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  `${t("provideViewName")}\n${t("usage")}: \`${prefix}tags view ${t("placeholders.name")}\``
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const { tag: viewTag } = resolveTagArgs(db.tags, viewTokens);

        if (!viewTag) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("notFound", { name: viewTokens.join(" ") }))
                .setColor("#FF0000"),
            ],
          });
        }

        const viewEmbed = new EmbedBuilder()
          .setColor(db.theme)
          .setTitle(t("tagInfo", { name: viewTag.name }))
          .addFields(
            {
              name: t("type"),
              value: typeLabel(client, db, viewTag.type),
              inline: true,
            },
            {
              name: t("triggerWord"),
              value: viewTag.trigger === true ? "on" : "off",
              inline: true,
            },
            {
              name: t("anyTriggerWord"),
              value: viewTag.anyTrigger === true ? "on" : "off",
              inline: true,
            },
            {
              name: t("botTrigger"),
              value: viewTag.triggerBots !== false ? "on" : "off",
              inline: true,
            },
            {
              name: t("contentLabel"),
              value: triggerContentLabel(client, db, viewTag.triggerContent),
              inline: true,
            },
            {
              name: t("regexLabel"),
              value: viewTag.triggerRegex
                ? `\`${formatTriggerRegex(
                    viewTag.triggerRegex,
                    viewTag.triggerRegexFlags
                  )}\``
                : t("regexNotSet"),
              inline: false,
            },
            {
              name: t("uses"),
              value: String(viewTag.uses || 0),
              inline: true,
            },
            {
              name: t("createdBy"),
              value: `<@${viewTag.createdBy}>`,
              inline: true,
            },
            {
              name: t("created"),
              value: `<t:${Math.floor(viewTag.createdAt / 1000)}:F>`,
              inline: true,
            }
          );

        if (viewTag.type === "text" || viewTag.type === "script") {
          const src = viewTag.content || "";
          viewEmbed.addFields({
            name: viewTag.type === "script" ? t("source") : t("content"),
            value:
              "```" +
              (viewTag.type === "script" ? "fluxer\n" : "\n") +
              src.substring(0, 1000) +
              (src.length > 1000 ? "\n…" : "") +
              "\n```",
          });
        } else {
          const data = viewTag.embedData || {};
          if (data.title) {
            viewEmbed.addFields({
              name: t("titleField"),
              value: String(data.title).substring(0, 256),
            });
          }
          viewEmbed.addFields({
            name: t("descriptionField"),
            value: (data.description || "").substring(0, 1024) || "-",
          });
          if (data.author?.name) {
            viewEmbed.addFields({
              name: t("authorField"),
              value: String(data.author.name).substring(0, 256),
            });
          }
          if (data.footer?.text) {
            viewEmbed.addFields({
              name: t("footerField"),
              value: String(data.footer.text).substring(0, 1024),
            });
          }
          if (Array.isArray(data.fields) && data.fields.length) {
            viewEmbed.addFields({
              name: t("fieldsField"),
              value: String(data.fields.length),
            });
          }
        }

        return message.reply({ embeds: [viewEmbed] });
      }

      case "list": {
        if (!db.tags || db.tags.length === 0) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("noTags"))
                .setColor("#FF0000"),
            ],
          });
        }

        const tagsPerPage = 10;
        const pages = [];

        for (let i = 0; i < db.tags.length; i += tagsPerPage) {
          const pageTags = db.tags.slice(i, i + tagsPerPage);
          const listItems = pageTags
            .map((tag, idx) =>
              t("listItem", {
                n: i + idx + 1,
                name: [
                  tag.name,
                  tag.trigger === true ? "🔔" : null,
                  tag.anyTrigger === true ? "🌐" : null,
                  tag.triggerRegex ? "🧩" : null,
                ]
                  .filter(Boolean)
                  .join(" "),
                uses: tag.uses || 0,
                emoji: typeEmoji(tag.type),
              })
            )
            .join("\n");
          const legend = new Set();

          for (const tag of pageTags) {
            legend.add(`${typeEmoji(tag.type)} ${t(tag.type)}`);
            if (tag.trigger === true) legend.add(`🔔 ${t("triggerWord")}`);
            if (tag.anyTrigger === true) legend.add(`🌐 ${t("anyTriggerWord")}`);
            if (tag.triggerRegex) legend.add(`🧩 ${t("regexLabel")}`);
          }

          const pageEmbed = new EmbedBuilder()
            .setColor(db.theme)
            .setTitle(t("tagsList"))
            .setDescription(
              `${listItems}\n\n${t("listLegend", {
                items: [...legend].join(" · "),
              })}`
            );
          pages.push(pageEmbed);
        }

        const paginator = new Paginator({
          user: message.author.id,
          client,
          timeout: 60000,
        });

        pages.forEach((p) => paginator.add(p));
        await paginator.start(message.channel);
        break;
      }
    }
  },
};

module.exports = tagsModule;

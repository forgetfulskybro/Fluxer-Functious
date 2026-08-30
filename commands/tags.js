const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const Paginator = require('../functions/pagination');
const { runTagSafe } = require('../interpreter/index');
const { trackGuildUpdates } = require("../api/trackSettings");

function toFluxerEmbed(data) {
  if (!data || typeof data !== "object") return null;

  const embed = new EmbedBuilder();

  if (data.title) embed.setTitle(String(data.title).slice(0, 256));
  if (data.description) embed.setDescription(String(data.description).slice(0, 4096));
  if (data.url) embed.setURL(String(data.url));
  if (data.timestamp) embed.setTimestamp(data.timestamp);

  if (data.color != null) {
    try {
      embed.setColor(data.color);
    } catch {
    }
  }

  if (data.author) {
    const a = data.author;
    embed.setAuthor({
      name: String(a.name || "").slice(0, 256),
      url: a.url || undefined,
      iconURL: a.icon_url || a.iconURL || undefined,
    });
  }

  if (data.footer) {
    const f = data.footer;
    embed.setFooter({
      text: String(f.text || "").slice(0, 2048),
      iconURL: f.icon_url || f.iconURL || undefined,
    });
  }

  if (data.thumbnail?.url) embed.setThumbnail(data.thumbnail.url);
  if (data.image?.url) embed.setImage(data.image.url);

  if (Array.isArray(data.fields)) {
    for (const field of data.fields.slice(0, 25)) {
      if (field?.name && field?.value) {
        embed.addFields({
          name: String(field.name).slice(0, 256),
          value: String(field.value).slice(0, 1024),
          inline: Boolean(field.inline),
        });
      }
    }
  }

  return embed;
}

function tokenizeArgs(text) {
  const args = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text))) args.push(m[1] ?? m[2] ?? m[3]);
  return args;
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

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTagContent(message, prefix, tagName, tagType) {
  const typeRegex = new RegExp(
    `${escapeRegExp(prefix)}(?:tags|tag)\\s+add\\s+${escapeRegExp(tagName)}\\s+${escapeRegExp(tagType)}\\s*([\\s\\S]*)`,
    "i"
  );

  const match = message.content.match(typeRegex);
  if (!match) {
    return { content: "", fenced: false };
  }

  const rest = match[1].trim();
  const fenced = extractCodeBlock(rest);

  if (fenced) {
    return {
      content: fenced.code,
      fenced: true,
      tail: fenced.tail,
    };
  }

  return {
    content: rest,
    fenced: false,
  };
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

module.exports = {
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
    const subcommand = args[0]?.toLowerCase();
    const prefix = db.prefix;
    const t = (key, vars) => client.translate.get(db.language, `Commands.tags.${key}`, vars);

    const buildContext = (extraArgs = []) => ({
      args: extraArgs,
      user: {
        id: message.author.id,
        username: message.author.username,
        discriminator: message.author.discriminator,
        display_name: message.member?.displayName ?? message.author.username,
        global_name: message.author.globalName,
        avatar: message.author.displayAvatarURL({ dynamic: true }),
        avatar_url: message.author.displayAvatarURL({ dynamic: true }),
        bot: message.author.bot,
      },
      channel: {
        id: message.channel.id,
        name: message.channel.name,
        type: message.channel.type,
      },
      message: {
        id: message.id,
        content: message.content,
        createdTimestamp: message.createdTimestamp,
      },
      guild: message.guild
        ? {
            id: message.guild.id,
            name: message.guild.name,
            memberCount: message.guild.memberCount,
            ownerId: message.guild.ownerId,
          }
        : null,
    });

    const executeTag = async (tag, remainingArgs = []) => {
      tag.uses = (tag.uses || 0) + 1;
      await client.database.updateGuild(message.guild.id, { tags: db.tags });

      await trackGuildUpdates(client, {
        guildId: message.guildId,
        userId: message.author.id,
        existing: db,
        updates: { tags: db.tags },
      });

      if (tag.type === "text") {
        return message.channel.send({ content: tag.content });
      }

      if (tag.type === "embed") {
        const embed = new EmbedBuilder()
          .setColor(tag.embedData?.color || "#A52F05")
          .setDescription(tag.embedData?.description || "");
        return message.channel.send({ embeds: [embed] });
      }

      if (tag.type === "script") {
        const result = runTagSafe(tag.content, buildContext(remainingArgs));

        if (!result.ok) {
          return message.reply({
            embeds: [makeScriptErrorEmbed(client, db, result.error, tag.content)],
          });
        }

        const { text, embeds: rawEmbeds } = result.result;
        const payload = {};

        if (text && text.trim()) {
          payload.content = text.slice(0, 2000);
        }

        if (rawEmbeds && rawEmbeds.length) {
          const converted = rawEmbeds
            .slice(0, 10)
            .map(toFluxerEmbed)
            .filter(Boolean);

          if (converted.length) {
            payload.embeds = converted;
          }
        }

        if (!payload.content && !payload.embeds) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setColor("#A52F05")
                .setDescription(t("noOutput")),
            ],
          });
        }

        return message.channel.send(payload);
      }

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#FF0000")
            .setDescription(t("unknownType")),
        ],
      });
    };

    switch (subcommand) {
      default:
        if (args[0]) {
          const tagName = args[0];
          const tag = db.tags?.find(
            (tg) => tg.name.toLowerCase() === tagName.toLowerCase()
          );

          if (!tag) {
            return message.reply({
              embeds: [
                new EmbedBuilder()
                  .setDescription(t("notFound", { name: tagName }))
                  .setColor("#FF0000"),
              ],
            });
          }

          const remaining = tokenizeArgs(args.slice(1).join(" "));
          return executeTag(tag, remaining);
        }

      case "help": {
        const embed = new EmbedBuilder()
          .setColor("#A52F05")
          .setTitle(t("helpTitle"))
          .setDescription(
            [
              `**${t("helpCreating")}**`,
              `\`${prefix}tags add ${t("placeholders.name")} text ${t("placeholders.content")}\``,
              `\`${prefix}tags add ${t("placeholders.name")} embed ${t("placeholders.description")}\``,
              `\`${prefix}tags add ${t("placeholders.name")} script ${t("placeholders.codeBlock")}\``,
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
              ``,
              `**${t("helpManaging")}**`,
              `\`${prefix}tags list\``,
              `\`${prefix}tags view ${t("placeholders.name")}\``,
              `\`${prefix}tags edit ${t("placeholders.name")}\``,
              `\`${prefix}tags remove ${t("placeholders.name")}\``,
              `**${t("helpScriptContext")}**`,
              t("helpScriptContextDesc"),
              ``,
              t("learnMore"),
            ].join("\n")
          );
        return message.reply({ embeds: [embed] });
      }

      case "add": {
        if (!args[1]) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  `${t("provideName")}\n${t("usage")}: \`${prefix}tags add ${t("placeholders.name")} text|embed|script ${t("placeholders.content")}\``
                )
                .setColor("#FF0000"),
            ],
          });
        }

        const tagName = args[1];

        if (/\s/.test(tagName) || tagName.length < 1 || tagName.length > 32) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("nameInvalid"))
                .setColor("#FF0000"),
            ],
          });
        }

        if (db.tags?.find((tg) => tg.name.toLowerCase() === tagName.toLowerCase())) {
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

        if (!args[2]) {
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

        const tagType = args[2].toLowerCase();
        if (!["text", "embed", "script"].includes(tagType)) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("invalidType"))
                .setColor("#FF0000"),
            ],
          });
        }

        const { content } = extractTagContent(
          message,
          prefix,
          tagName,
          tagType
        );

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

        const limits = { text: 2000, embed: 4096, script: 12000 };
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
          const check = runTagSafe(content, buildContext([]));
          if (!check.ok) {
            return message.reply({
              embeds: [makeScriptErrorEmbed(client, db, check.error, content)],
            });
          }
        }

        const newTag = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: tagName,
          type: tagType,
          content: tagType === "text" || tagType === "script" ? content : null,
          embedData:
            tagType === "embed"
              ? { description: content, color: "#A52F05" }
              : null,
          createdBy: message.author.id,
          createdAt: Date.now(),
          uses: 0,
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

        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(t("createdSuccess", { name: tagName, type: tagType }))
              .setColor("#A52F05"),
          ],
        });
      }

      case "remove": {
        if (!args[1]) {
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

        const tagToRemove = args[1];
        const tagIndex = db.tags?.findIndex(
          (tg) => tg.name.toLowerCase() === tagToRemove.toLowerCase()
        );

        if (tagIndex === -1 || tagIndex === undefined) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("notFound", { name: tagToRemove }))
                .setColor("#FF0000"),
            ],
          });
        }

        const removedTag = db.tags[tagIndex];

        const confirmEmbed = new EmbedBuilder()
          .setColor("#A52F05")
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
              
              await confirmMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setDescription(t("deletedSuccess", { name: removedTag.name }))
                    .setColor("#A52F05"),
                ],
              });
            } else {
              await confirmMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setDescription(t("deleteCancelled"))
                    .setColor("#A52F05"),
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
        if (!args[1]) {
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

        const tagToEdit = args[1];
        const editTagIndex = db.tags?.findIndex(
          (tg) => tg.name.toLowerCase() === tagToEdit.toLowerCase()
        );

        if (editTagIndex === -1 || editTagIndex === undefined) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("notFound", { name: tagToEdit }))
                .setColor("#FF0000"),
            ],
          });
        }

        const editingTag = db.tags[editTagIndex];

        const contentPreview =
          editingTag.type === "script" || editingTag.type === "text"
            ? (editingTag.content || "").substring(0, 350) +
              ((editingTag.content || "").length > 350 ? "…" : "")
            : (editingTag.embedData?.description || "").substring(0, 350) +
              ((editingTag.embedData?.description || "").length > 350 ? "…" : "");

        const menuEmbed = new EmbedBuilder()
          .setColor("#A52F05")
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
                    .setColor("#A52F05")
                    .setDescription(t("replyNewName")),
                ],
              });

              const nameCollector = message.channel.createMessageCollector({
                filter: (m) => m.author.id === message.author.id,
                time: 60000,
                max: 1,
              });

              nameCollector.on("collect", async (m) => {
                const newName = m.content.trim();
                if (/\s/.test(newName) || newName.length < 1 || newName.length > 32) {
                  return m.reply({
                    embeds: [
                      new EmbedBuilder()
                        .setDescription(t("invalidName"))
                        .setColor("#FF0000"),
                    ],
                  });
                }
                if (
                  db.tags.find(
                    (tg) =>
                      tg.name.toLowerCase() === newName.toLowerCase() &&
                      tg.id !== editingTag.id
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
                
                await menuMsg.edit({
                  embeds: [
                    new EmbedBuilder()
                      .setDescription(t("nameChanged", { name: newName }))
                      .setColor("#A52F05"),
                  ],
                });
              });
            }

            else if (reaction.emoji.name === "2️⃣") {
              await menuMsg.removeAllReactions().catch(() => {});

              const currentContent =
                editingTag.type === "embed"
                  ? (editingTag.embedData?.description || "")
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
                    .setColor("#A52F05")
                    .setTitle(t("editContentTitle", { name: editingTag.name }))
                    .setDescription(
                      [
                        editingTag.type === "script"
                          ? t("replyNewScript")
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
                  const check = runTagSafe(newContent, buildContext([]));
                  if (!check.ok) {
                    return m.reply({
                      embeds: [makeScriptErrorEmbed(client, db, check.error, newContent)],
                    });
                  }
                }

                const updated = [...db.tags];
                if (editingTag.type === "text" || editingTag.type === "script") {
                  updated[editTagIndex].content = newContent;
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
                
                await menuMsg.edit({
                  embeds: [
                    new EmbedBuilder()
                      .setDescription(t("contentUpdated"))
                      .setColor("#A52F05"),
                  ],
                });
              });
            }

            else if (reaction.emoji.name === "3️⃣") {
              await menuMsg.removeAllReactions().catch(() => {});

              const typeEmbed = new EmbedBuilder()
                .setColor("#A52F05")
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
                        .setColor("#A52F05"),
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
                        .setColor("#A52F05"),
                    ],
                  });
                  return;
                }

                const updated = [...db.tags];
                const cur = updated[editTagIndex];

                if (cur.type === "text" && next === "embed") {
                  cur.embedData = {
                    description: cur.content || "",
                    color: "#A52F05",
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
                    color: "#A52F05",
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
                      .setColor("#A52F05"),
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
                    .setColor("#A52F05"),
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
        if (!args[1]) {
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

        const viewTag = db.tags?.find(
          (tg) => tg.name.toLowerCase() === args[1].toLowerCase()
        );

        if (!viewTag) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(t("notFound", { name: args[1] }))
                .setColor("#FF0000"),
            ],
          });
        }

        const viewEmbed = new EmbedBuilder()
          .setColor("#A52F05")
          .setTitle(t("tagInfo", { name: viewTag.name }))
          .addFields(
            {
              name: t("type"),
              value: typeLabel(client, db, viewTag.type),
              inline: true,
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
          viewEmbed.addFields({
            name: t("descriptionField"),
            value: (viewTag.embedData?.description || "").substring(0, 1024) || "-",
          });
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
          const pageEmbed = new EmbedBuilder()
            .setColor("#A52F05")
            .setTitle(t("tagsList"))
            .setDescription(
              pageTags
                .map((tag, idx) =>
                  t("listItem", {
                    n: i + idx + 1,
                    name: tag.name,
                    uses: tag.uses || 0,
                    emoji: typeEmoji(tag.type),
                  })
                )
                .join("\n")
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
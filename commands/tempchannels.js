const { EmbedBuilder, PermissionFlags, resolvePermissionsToBitfield } = require("@erinjs/core");
const emoji = require('node-emoji');

const EMBED_COLORS = {
  ERROR: '#FF0000',
  SUCCESS: '#A52F05',
  INFO: '#A52F05'
};

const VALID_FIELDS = ['name', 'limit', 'counting', 'category', 'manage'];

module.exports = {
  config: {
    name: "tempchannels",
    usage: "help",
    cooldown: 3000,
    available: true,
    permissions: {
      name: "Manage Guild",
      bitField: PermissionFlags.ManageGuild,
    },
    aliases: ["tc", "tempchannel"],
  },
  run: async (client, message, args, db) => {
    function createEmbed(color = EMBED_COLORS.INFO, title = null, description = null) {
      const embed = new EmbedBuilder().setColor(color);
      if (title) embed.setTitle(title);
      if (description) embed.setDescription(description);
      return embed;
    }

    function parseArguments(argsString) {
      const matches = [...argsString.matchAll(/\{\s*([a-zA-Z]+)(?:\s*:\s*([^}]+))?\}/g)];
      const parsed = Object.create(null);
      for (const m of matches) parsed[m[1].toLowerCase()] = (m[2] ?? "").trim();
      return parsed;
    }

    function validateChannelName(name, command, client, db) {
      const n = emoji.emojify(String(name).trim());
      if (n.length === 0) {
        return {
          valid: false,
          embed: createEmbed(EMBED_COLORS.ERROR, null, 
            `${client.translate.get(db.language, "Commands.tempchannels.channelNameRaw")}\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc ${command} {name:${client.translate.get(db.language, "Commands.tempchannels.myChannel")}}\`\n- ${client.translate.get(db.language, "Commands.tempchannels.channelNameDesc")}`
          )
        };
      }
      
      if (n.length > 26) {
        return {
          valid: false,
          embed: createEmbed(EMBED_COLORS.ERROR, null,
            `${client.translate.get(db.language, "Commands.tempchannels.channelNameLength")}\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc ${command} {name:${client.translate.get(db.language, "Commands.tempchannels.myChannel")}}\`\n- ${client.translate.get(db.language, "Commands.tempchannels.channelNameDesc")}`
          )
        };
      }
      
      return { valid: true, value: n };
    }

    function validateChannelLimit(limit, command, client, db) {
      const n = Number(String(limit).trim());
      if (!Number.isFinite(n) || n < 0 || n > 99) {
        return {
          valid: false,
          embed: createEmbed(EMBED_COLORS.ERROR, null,
            `${client.translate.get(db.language, "Commands.tempchannels.channelLimit")}\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc ${command} {limit:5}\`\n- ${client.translate.get(db.language, "Commands.tempchannels.channelLimitDesc")}`
          )
        };
      }
      
      return { valid: true, value: n };
    }

    async function resolveCategory(guild, categoryInput, client, db, command) {
      if (!categoryInput) return null;
      categoryInput = emoji.emojify(categoryInput);
      
      if (categoryInput === "") {
        return {
          valid: false,
          embed: createEmbed(EMBED_COLORS.ERROR, null,
            `${client.translate.get(db.language, "Commands.tempchannels.customCat")}\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc ${command} {category:Temp Channels}\``
          )
        };
      }

      const channels = await guild.fetchChannels();
      const byId = channels?.find((c) => c.id === categoryInput) ?? null;
      const byName = channels?.find?.(
        (c) => c?.name?.toLowerCase?.() === categoryInput.toLowerCase(),
      ) ?? null;
      const resolved = byId ?? byName;

      if (!resolved || resolved.type !== 4) {
        return {
          valid: false,
          embed: createEmbed(EMBED_COLORS.ERROR, null,
            `${client.translate.get(db.language, "Commands.tempchannels.customCat")}\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc ${command} {category:Temp Channels}\``
          )
        };
      }

      return { valid: true, value: resolved };
    }

    function checkSetupExists(db, client, message) {
      if (!db.parentChannel || !db.childChannel) {
        message.reply({
          embeds: [
            createEmbed(EMBED_COLORS.ERROR, null,
              `${client.translate.get(db.language, "Commands.tempchannels.notSetup")}`
            ),
          ],
        });
        return false;
      }
      return true;
    }

    function checkNotSetupForSet(db, client, message, baseCommand, reset = false) {
      if ((db.parentChannel || db.childChannel) && !reset) {
        const base = String(message.content ?? `${db.prefix}tc ${baseCommand}`).trim();
        const suggestion = base.includes("{reset:") ? base : `${base} {reset}`;
        message.reply({
          embeds: [
            createEmbed(EMBED_COLORS.ERROR, null,
              `${client.translate.get(db.language, "Commands.tempchannels.alreadySetup", { "option": "{reset}" })}\n\n\`\`\`\n${suggestion}\n\`\`\``
            ),
          ],
        });
        return false;
      }
      return true;
    }
  
    async function configManage(type, msg, category = null) {
      if (type === "create") {
        const channel = await msg.guild.createChannel({
          type: 0,
          name: client.translate.get(db.language, "Commands.tempchannels.manageCreate"),
          parent_id: category ? category.id : db.config?.customParent ? db.config?.customParent : db.parentChannel,
        });
        
        await channel.editPermission(msg.guild.roles.find((r) => r.name === "@everyone").id, {
          type: 0,
          deny: resolvePermissionsToBitfield(["SendMessages", "AddReactions"])
        })
        
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle(client.translate.get(db.language, "Commands.tempchannels.manageTitle"))
          .setDescription(client.translate.get(db.language, "Commands.tempchannels.manageDescription"))
          .setFooter({ text: client.translate.get(db.language, "Commands.tempchannels.manageFooter") });
        
        const message = await channel.send({ embeds: [embed] });
        const reactions = ['<:channelName:1498099550363509257>', '<:userLimit:1498101792919392863>', '<:blockUser:1498101705656877648>', '<:unblockUser:1498101686866420308>', '<:view:1498405262088803743>'];
        
        for (const reaction of reactions) {
          await message.react(reaction).catch(() => {});
        }
        
        return { channel, message };
      } else if (type === "delete") {
        if (typeof db.config?.manage == 'string') {
          const channel = await client.channels.resolve(db.config.manage);
          if (channel) await channel.delete();
          return null;
        } else {
          return db.config?.manage ?? null;
        }
      }
    }
    
    async function disableTemps() {
      if (!db.parentChannel && !db.childChannel && db.tempChannels?.length === 0) return false;
      
      await client.database.updateGuild(message.guildId, {
        parentChannel: null,
        childChannel: null,
        tempChannels: [],
        config: null,
      });
      
      try {
        const parentChannel = await client.channels.resolve(db.parentChannel);
        const childChannel = await client.channels.resolve(db.childChannel);

        if (childChannel) await childChannel.delete();
        if (!db.config?.customParent && parentChannel) await parentChannel.delete();
        if (db.config?.manage) await configManage("delete")
        
        if (db.tempChannels?.length > 0) {
          for (const entry of db.tempChannels) {
            const channelId = typeof entry === "string" ? entry : (entry?.channelId ?? entry?.id);
            if (!channelId) continue;
            const channel = await client.channels.resolve(channelId);
            if (channel) await channel.delete();
          }
        }
      } catch  { };
      
      return;
    }
    
    async function enableTemps(customCat = null, manage = null) {
      try {
        let category;
        if (customCat) {
          category = await client.channels.resolve(customCat.id);
          if (!category || category.type !== 4) return null;
        } else {
          if (db.config?.customParent) {
            category = await client.channels.resolve(db.config.customParent);
            if (!category || category.type !== 4) return null;
          } else {
            category = await message.guild.createChannel({
              type: 4,
              name: client.translate.get(db.language, "Commands.tempchannels.tempChannels"),
            });
          }
        }
        
        let manageChannel = null;
        let manageMessage = null;
        if (manage ? manage : db.config?.manage) {
          const opts = await configManage("create", message, category);
          manageChannel = opts.channel;
          manageMessage = opts.message;
        }

        const voiceChannel = await message.guild.createChannel({
          type: 2,
          name: client.translate.get(db.language, "Commands.tempchannels.joinCreate"),
          parent_id: category.id,
          bitrate: 64000,
        });

        return { category, voiceChannel, manageChannel, manageMessage };
      } catch (error) {
        return null;
      }
    }
    
    const embed = createEmbed(
      EMBED_COLORS.INFO,
      client.translate.get(db.language, "Commands.tempchannels.helpUsage"),
      `${client.translate.get(db.language, "Commands.tempchannels.setup")}\n\`${db.prefix}tc set default\`\n\n${client.translate.get(db.language, "Commands.tempchannels.resetSetup", { "default": "default", "config": "config" })}\n\`${db.prefix}tc set [${client.translate.get(db.language, "Commands.tempchannels.option")}, e.g. default | config] {reset}\`\n\n${client.translate.get(db.language, "Commands.tempchannels.configuration")}\n\`${db.prefix}tc set config {name:${client.translate.get(db.language, "Commands.tempchannels.myChannel")}} {limit:5} {counting} {category:Temp Channels} {manage}\`\n\n${client.translate.get(db.language, "Commands.tempchannels.editConfig")}\n\`${db.prefix}tc edit {name:New Name} {limit:10} {counting}\`\n\n${client.translate.get(db.language, "Commands.tempchannels.deleteConfig")}\n\`${db.prefix}tc delete {counting} {limit} {name} {category} {manage}\`\n\n${client.translate.get(db.language, "Commands.tempchannels.viewConfig")}\n\`${db.prefix}tc view\`\n\n**${client.translate.get(db.language, "Commands.tempchannels.optional")}**\n- \`{name:...}\`: ${client.translate.get(db.language, "Commands.tempchannels.nameDefine")}\n- \`{limit:...}\`: ${client.translate.get(db.language, "Commands.tempchannels.limitDefine")}\n- \`{counting}\`: ${client.translate.get(db.language, "Commands.tempchannels.countingDefine")}\n- \`{category:...}\`: ${client.translate.get(db.language, "Commands.tempchannels.categoryDefine")}\n- \`{reset}\`: ${client.translate.get(db.language, "Commands.tempchannels.resetDefine")}\n- \`{manage}\`: ${client.translate.get(db.language, "Commands.tempchannels.manageDefine")}\n\n**${client.translate.get(db.language, "Commands.tempchannels.examples")}**\n\`${db.prefix}tc set default\`\n\`${db.prefix}tc set config {name:Private Room} {limit:2} {counting} {manage}\`\n\`${db.prefix}tc edit {name:Updated Room} {limit:3} {manage}\`\n\`${db.prefix}tc delete {counting} {limit}\`\n\`${db.prefix}tc set config {reset}\`\n\`${db.prefix}tc view\``
    );
    
    if (!args[0]) return message.reply({ embeds: [embed] });
    switch (args[0]?.toLowerCase()) {
      default: "help;"
      case "help":
        message.reply({ embeds: [embed] });
        break;
      
      case "view":
        const manageStatus = db.config?.manage ? `${client.translate.get(db.language, "Commands.tempchannels.on")} (<#${db.config.manage}>)` : client.translate.get(db.language, "Commands.tempchannels.off");
        message.reply({ embeds: [createEmbed(
          EMBED_COLORS.INFO,
          client.translate.get(db.language, "Commands.tempchannels.tempConfig"),
          `**${client.translate.get(db.language, "Commands.tempchannels.category")}**: ${db.config?.customParent ? `<#${db.config.customParent}>` : (db.parentChannel ? `<#${db.parentChannel}>` : client.translate.get(db.language, "Commands.tempchannels.notSet"))}\n**${client.translate.get(db.language, "Commands.tempchannels.mainChannel")}**: ${db.childChannel ? `<#${db.childChannel}>` : client.translate.get(db.language, "Commands.tempchannels.notSet")}\n\n**${client.translate.get(db.language, "Commands.tempchannels.channelName")}**: ${db.config?.channelName ?? client.translate.get(db.language, "Commands.tempchannels.notSet")}\n**${client.translate.get(db.language, "Commands.tempchannels.userLimit")}**: ${db.config?.limit ?? client.translate.get(db.language, "Commands.tempchannels.notSet")}\n**${client.translate.get(db.language, "Commands.tempchannels.countingToggle")}**: ${db.config?.counting ? client.translate.get(db.language, "Commands.tempchannels.on") : client.translate.get(db.language, "Commands.tempchannels.off")}\n**${client.translate.get(db.language, "Commands.tempchannels.manage")}**: ${manageStatus}`
        )] });
        break;

      case "set":
        switch (args[1]) {
          default: 
            message.reply({ embeds: [createEmbed(EMBED_COLORS.ERROR, null, `${client.translate.get(db.language, "Commands.tempchannels.provideArg")} (\`default\` | \`config\`).\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc set default\``)] });
            break
          case "default":
            {
              const parsed = parseArguments(args.join(" ").replace(/\bset\b|\bdefault\b/gi, " "));
              const resetRaw = parsed.reset;
              let reset = false;
              if (resetRaw === "") reset = true;

              if (!checkNotSetupForSet(db, client, message, "set default", reset)) return;

              if (reset) await disableTemps();
              const vc = await enableTemps();
              if (!vc) return message.reply({ embeds: [createEmbed(EMBED_COLORS.ERROR, null, client.translate.get(db.language, "Commands.tempchannels.failedSetup"))] });
              const { category, voiceChannel } = vc;
              
              client.database.updateGuild(message.guildId, {
                parentChannel: category.id,
                childChannel: voiceChannel.id,
                config: {
                  ...(db.config ?? {}),
                  customParent: null,
                },
              });
              message.reply({ embeds: [createEmbed(EMBED_COLORS.SUCCESS, null, client.translate.get(db.language, "Commands.tempchannels.successSetup", { voiceChannel: `<#${voiceChannel.id}>` }))] });
            }
            break;

          case "config":
            {
              const parsed = parseArguments(args.join(" ").replace(/\bset\b|\bconfig\b/gi, " "));

              const channelNameRaw = parsed.name;
              const limitRaw = parsed.limit;
              const countingRaw = parsed.counting;
              const resetRaw = parsed.reset;
              const categoryRaw = parsed.category;
              const manageRaw = parsed.manage;
              
              let channelName;
              if (channelNameRaw) {
                const validation = validateChannelName(channelNameRaw, "set config", client, db);
                if (!validation.valid) {
                  return message.reply({ embeds: [validation.embed] });
                }
                channelName = validation.value;
              }

              let channelLimit;
              if (limitRaw) {
                const validation = validateChannelLimit(limitRaw, "set config", client, db);
                if (!validation.valid) {
                  return message.reply({ embeds: [validation.embed] });
                }
                channelLimit = validation.value;
              }

              let counting;
              if (countingRaw === "") counting = true;

              let reset = false;
              if (resetRaw === "") reset = true;
              
              let manage;
              if (manageRaw === "") manage = true;

              let targetCategoryId;
              const categoryValidation = await resolveCategory(message.guild, categoryRaw, client, db, "set config");
              if (categoryValidation) {
                if (!categoryValidation.valid) {
                  return message.reply({ embeds: [categoryValidation.embed] });
                }
                targetCategoryId = categoryValidation.value;
              }

              if (!checkNotSetupForSet(db, client, message, "set config", reset)) return;

              if (reset) {
                const didReset = await disableTemps();
                if (!channelName && !channelLimit && !counting && !targetCategoryId && !manage) {
                  if (!didReset) {
                    return message.reply({
                      embeds: [
                        createEmbed(EMBED_COLORS.ERROR, null,
                          client.translate.get(db.language, "Commands.tempchannels.noReset")
                        ),
                      ],
                    });
                  }
                  return message.reply({
                    embeds: [
                      createEmbed(EMBED_COLORS.SUCCESS, null,
                        client.translate.get(db.language, "Commands.tempchannels.successReset")
                      ),
                    ],
                  });
                }
              }

              if (!channelName && !channelLimit && !counting && !targetCategoryId && !reset && !manage) {
                return message.reply(
                  { embeds: [createEmbed(EMBED_COLORS.ERROR, null, `${client.translate.get(db.language, "Commands.tempchannels.noArgs")} (\`name\`, \`limit\`, \`counting\`, \`category\`, \`manage\`).\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc set config {name:${client.translate.get(db.language, "Commands.tempchannels.myChannel")}} {limit:5} {counting} {category:1484784325810897153}\`\n- ${client.translate.get(db.language, "Commands.tempchannels.noArgsDesc")}`)] }
                );
              }
              
              const vc = await enableTemps(targetCategoryId, manage);
              if (!vc) return message.reply({ embeds: [createEmbed(EMBED_COLORS.ERROR, null, client.translate.get(db.language, "Commands.tempchannels.failedSetup"))] });
              ({ category, voiceChannel, manageChannel, manageMessage } = vc);

              await client.database.updateGuild(message.guildId, {
                config: {
                  ...(channelName ? { channelName } : {}),
                  ...(channelLimit ? { channelLimit } : {}),
                  ...(counting ? { counting } : {}),
                  ...(targetCategoryId?.id ? { customParent: targetCategoryId.id } : { customParent: null }),
                  ...(manage ? { manage: manageChannel.id } : { manage: null }),
                  ...(manage ? { manageMessage: manageMessage.id } : { manageMessage: null }),
                },
                parentChannel: category.id,
                childChannel: voiceChannel.id,
              });
              
              message.reply({ embeds: [createEmbed(EMBED_COLORS.SUCCESS, null, client.translate.get(db.language, "Commands.tempchannels.successSetup", { "voiceChannel": `<#${voiceChannel.id}>` }))] });
            }
            break;
        }
        break;

      case "edit":
        {
          if (!checkSetupExists(db, client, message)) return;

          const parsed = parseArguments(args.join(" ").replace(/\bedit\b/gi, " "));

          const channelNameRaw = parsed.name;
          const limitRaw = parsed.limit;
          const countingRaw = parsed.counting;
          const categoryRaw = parsed.category;
          const manageRaw = parsed.manage;
          
          const currentConfig = db.config || {};
          const updates = {};

          if (channelNameRaw) {
            const validation = validateChannelName(channelNameRaw, "edit", client, db);
            if (!validation.valid) {
              return message.reply({ embeds: [validation.embed] });
            }
            updates.channelName = validation.value;
          }

          if (limitRaw) {
            const validation = validateChannelLimit(limitRaw, "edit", client, db);
            if (!validation.valid) {
              return message.reply({ embeds: [validation.embed] });
            }
            updates.channelLimit = validation.value;
          }

          if (countingRaw === "") {
            updates.counting = !currentConfig.counting;
          }
          
          if (manageRaw === "") {
            if (typeof currentConfig.manage == 'string') {
              updates.manage = null;
              updates.manageMessage = null;
              await configManage("delete")
            } else {
              const result = await configManage("create", message);
              updates.manage = result?.channel?.id;
              updates.manageMessage = result?.message?.id;
            }
          }

          let targetCategoryId;
          if (categoryRaw) {
            const categoryValidation = await resolveCategory(message.guild, categoryRaw, client, db, "edit");
            if (categoryValidation && !categoryValidation.valid) {
              return message.reply({ embeds: [categoryValidation.embed] });
            }
            if (categoryValidation) {
              targetCategoryId = categoryValidation.value.id;
              updates.customParent = targetCategoryId;
            }
          }

          if (Object.keys(updates).length === 0) {
            return message.reply({
              embeds: [
                createEmbed(EMBED_COLORS.ERROR, null,
                  `${client.translate.get(db.language, "Commands.tempchannels.noArgs")} (\`name\`, \`limit\`, \`counting\`, \`category\`, \`manage\`).\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc edit {name:${client.translate.get(db.language, "Commands.tempchannels.myChannel")}} {limit:5} {counting}\`\n- ${client.translate.get(db.language, "Commands.tempchannels.noArgsDesc")}`
                ),
              ],
            });
          }

          await client.database.updateGuild(message.guildId, {
            config: {
              ...currentConfig,
              ...updates,
            },
          });

          const changedFields = Object.keys(updates).map(key => {
            if (key === 'customParent') return `${client.translate.get(db.language, "Commands.tempchannels.category")}: <#${updates[key]}>`;
            if (key === 'counting') return `${client.translate.get(db.language, "Commands.tempchannels.counting")}: ${updates[key] ? client.translate.get(db.language, "Commands.tempchannels.on") : client.translate.get(db.language, "Commands.tempchannels.off")}`;
            if (key === 'channelLimit') return `${client.translate.get(db.language, "Commands.tempchannels.userLimit")}: ${updates[key]}`;
            if (key === 'channelName') return `${client.translate.get(db.language, "Commands.tempchannels.channelName")}: ${updates[key]}`;
            if (key === 'manage') return `${client.translate.get(db.language, "Commands.tempchannels.manage")}: ${updates[key] ? client.translate.get(db.language, "Commands.tempchannels.on") : client.translate.get(db.language, "Commands.tempchannels.off")}`;
            if (key === "manageMessage") return;
            return `${key}: ${updates[key]}`;
          }).join('\n');

          message.reply({
            embeds: [
              createEmbed(EMBED_COLORS.SUCCESS, null,
                `${client.translate.get(db.language, "Commands.tempchannels.successEdit")}:\n\n${changedFields}`
              ),
            ],
          });
        }
        break;

      case "delete":
        {
          if (!checkSetupExists(db, client, message)) return;

          const parsed = parseArguments(args.join(" ").replace(/\bdelete\b/gi, " "));
          const fieldsToDelete = Object.keys(parsed);
          
          if (fieldsToDelete.length === 0) {
            return message.reply({
              embeds: [
                createEmbed(EMBED_COLORS.ERROR, null,
                  `${client.translate.get(db.language, "Commands.tempchannels.delete")}.\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc delete {counting} {limit} {name} {category} {manage}\``
                ),
              ],
            });
          }

          const invalidFields = fieldsToDelete.filter(field => !VALID_FIELDS.includes(field));
          
          if (invalidFields.length > 0) {
            return message.reply({
              embeds: [
                createEmbed(EMBED_COLORS.ERROR, null,
                  `${client.translate.get(db.language, "Commands.tempchannels.invalid")}: ${invalidFields.join(', ')}\n${client.translate.get(db.language, "Commands.tempchannels.valid")}: ${VALID_FIELDS.join(', ')}`
                ),
              ],
            });
          }

          const currentConfig = db.config || {};
          const updates = {};

          fieldsToDelete.forEach(field => {
            if (field === 'name') {
              updates.channelName = null;
            } else if (field === 'limit') {
              updates.channelLimit = null;
            } else if (field === 'counting') {
              updates.counting = false;
            } else if (field === 'category') {
              updates.customParent = null;
            } else if (field === 'manage') {
              updates.manage = null;
            }
          });

          await client.database.updateGuild(message.guildId, {
            config: {
              ...currentConfig,
              ...updates,
            },
          });

          const deletedFields = fieldsToDelete.map(field => {
            if (field === 'name') return client.translate.get(db.language, "Commands.tempchannels.channelName");
            if (field === 'limit') return client.translate.get(db.language, "Commands.tempchannels.userLimit");
            if (field === 'counting') return client.translate.get(db.language, "Commands.tempchannels.counting");
            if (field === 'category') return client.translate.get(db.language, "Commands.tempchannels.category");
            if (field === 'manage') return client.translate.get(db.language, "Commands.tempchannels.manage");
            return field;
          }).join(', ');

          message.reply({
            embeds: [
              createEmbed(EMBED_COLORS.SUCCESS, null,
                `${client.translate.get(db.language, "Commands.tempchannels.successDelete")}: ${deletedFields}`
              ),
            ],
          });
        }
        break;
    }
  },
};

const { EmbedBuilder, PermissionFlags, resolvePermissionsToBitfield } = require("@erinjs/core");
const emoji = require('node-emoji');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
  
    async function updateLoadingMessage(msg, embed, steps, currentStep, manageEnabled = false, isDeleting = false, willCreate = true, usingCustomCategory = false) {
      const stepEmojis = {
        pending: '⏳',
        active: '⏳',
        done: '✅',
        skip: '⏭️'
      };
      
      let description = '';
      
      if (isDeleting) {
        const deleteSteps = [
          ...(steps.delTemps ? [{ key: 'delTemps', label: client.translate.get(db.language, "Commands.tempchannels.deletingTemps"), emoji: '🗑️' }] : []),
          ...(steps.delMain ? [{ key: 'delMain', label: client.translate.get(db.language, "Commands.tempchannels.deletingMain"), emoji: '🔊' }] : []),
          ...(steps.delCategory ? [{ key: 'delCategory', label: client.translate.get(db.language, "Commands.tempchannels.deletingCategory"), emoji: '📁' }] : []),
          ...(steps.delManage ? [{ key: 'delManage', label: client.translate.get(db.language, "Commands.tempchannels.deletingManage"), emoji: '📋' }] : [])
        ];
        
        for (const step of deleteSteps) {
          let status = stepEmojis.pending;
          if (steps[step.key] === 'active') status = stepEmojis.active;
          if (steps[step.key] === 'done') status = stepEmojis.done;
          description += `${status} ${step.emoji} ${step.label}\n`;
        }
        
        if (deleteSteps.length === 0) {
          description = client.translate.get(db.language, "Commands.tempchannels.noDeleteNeeded");
        }
        
        if (willCreate) {
          description += '\n' + (client.translate.get(db.language, "Commands.tempchannels.creatingNew")) + '\n\n';
        }
      }
      
      if (willCreate) {
        const categoryLabel = usingCustomCategory 
          ? client.translate.get(db.language, "Commands.tempchannels.usingCategory") || 'Using existing category'
          : client.translate.get(db.language, "Commands.tempchannels.loadingCategory");
        
        const allSteps = [
          { key: 'category', label: categoryLabel, emoji: '📁' },
          { key: 'voice', label: client.translate.get(db.language, "Commands.tempchannels.loadingVoice"), emoji: '🔊' },
          ...(manageEnabled ? [
            { key: 'manageChannel', label: client.translate.get(db.language, "Commands.tempchannels.loadingManageChannel"), emoji: '📋' },
            { key: 'manageMessage', label: client.translate.get(db.language, "Commands.tempchannels.loadingManageMessage"), emoji: '📝' }
          ] : [])
        ];
        
        for (const step of allSteps) {
          let status = stepEmojis.pending;
          if (steps[step.key] === 'active') status = stepEmojis.active;
          if (steps[step.key] === 'done') status = stepEmojis.done;
          if (steps[step.key] === 'skip') status = stepEmojis.skip;
          description += `${status} ${step.emoji} ${step.label}\n`;
        }
      } else if (manageEnabled && !isDeleting) {
        const manageOnlySteps = [
          { key: 'manageChannel', label: client.translate.get(db.language, "Commands.tempchannels.loadingManageChannel"), emoji: '📋' },
          { key: 'manageMessage', label: client.translate.get(db.language, "Commands.tempchannels.loadingManageMessage"), emoji: '📝' }
        ];
        
        for (const step of manageOnlySteps) {
          let status = stepEmojis.pending;
          if (steps[step.key] === 'active') status = stepEmojis.active;
          if (steps[step.key] === 'done') status = stepEmojis.done;
          if (steps[step.key] === 'skip') status = stepEmojis.skip;
          description += `${status} ${step.emoji} ${step.label}\n`;
        }
      }
      
      embed.setDescription(description || client.translate.get(db.language, "Commands.tempchannels.processing"));
      return await msg.edit({ embeds: [embed] });
    }

    async function configManage(type, msg, category = null, loadingMsg = null, loadingEmbed = null, steps = null, skipBaseSteps = false) {
      if (type === "create") {
        if (loadingMsg && loadingEmbed && steps) {
          steps.manageChannel = 'active';
          await updateLoadingMessage(loadingMsg, loadingEmbed, steps, 'manageChannel', true, false, !skipBaseSteps, false);
          await delay(500);
        }
        
        const channel = await msg.guild.createChannel({
          type: 0,
          name: client.translate.get(db.language, "Commands.tempchannels.manageCreate"),
          parent_id: category ? category.id : db.config?.customParent ? db.config?.customParent : db.parentChannel,
        });
        
        await channel.editPermission(msg.guild.roles.find((r) => r.name === "@everyone").id, {
          type: 0,
          deny: resolvePermissionsToBitfield(["SendMessages", "AddReactions"])
        });
        
        if (loadingMsg && loadingEmbed && steps) {
          steps.manageChannel = 'done';
          steps.manageMessage = 'active';
          await updateLoadingMessage(loadingMsg, loadingEmbed, steps, 'manageMessage', true, false, !skipBaseSteps, false);
          await delay(500);
        }

        const CDNLang = {
          en_EN: "https://functious-cdn.vercel.app/api/images/ef27463013d7f69f67a0f3eb38129717.png",
          es_ES: "https://functious-cdn.vercel.app/api/images/9e51affa3d366da1cb46aba84246d712.png", 
          pt_BR: "https://functious-cdn.vercel.app/api/images/bf709079782d5097798381835cf1e69b.png",
          ar_AR: "https://functious-cdn.vercel.app/api/images/2791aacd0a1aef7ae25e124759f601a7.png"
        }
        
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLORS.INFO)
          .setTitle(client.translate.get(db.language, "Commands.tempchannels.manageTitle"))
          .setImage(CDNLang[db.language])
          .setFooter({ text: client.translate.get(db.language, "Commands.tempchannels.manageFooter") });
        
        const message = await channel.send({ embeds: [embed] });
        const reactions = ['<:rename:1502164676598628060>', '<:userlimit:1502164677802393309>', '<:region:1502164672647593687>', '<:privacy:1502164674153348824>', '<:unblock:1502164681409494751>', '<:block:1502164675642326745>', '<:transfer:1502164678616088286>', '<:close:1502185371235901763>'];
        
        for (const reaction of reactions) {
          await message.react(reaction).catch(() => {});
          await delay(250);
        }
        
        if (loadingMsg && loadingEmbed && steps) {
          steps.manageMessage = 'done';
          await updateLoadingMessage(loadingMsg, loadingEmbed, steps, 'complete', true, false, !skipBaseSteps, false);
        }
        
        return { channel, message };
      } else if (type === "delete") {
        if (typeof db.config?.manage == 'string') {
          try {
            const channel = await client.channels.resolve(db.config.manage);
            if (channel) await channel.delete();
          } catch { }
          return null;
        } else {
          return db.config?.manage ?? null;
        }
      }
    }
    
    async function disableTemps(deleteOptions = { temps: true, main: true, category: true, manage: true }, loadingMsg = null, loadingEmbed = null, manageEnabled = false, willCreate = true, usingCustomCategory = false) {
      if (!db.parentChannel && !db.childChannel && db.tempChannels?.length === 0) return false;
      
      const hasTemps = db.tempChannels?.length > 0;
      const hasMain = !!db.childChannel;
      const hasCategory = !!db.parentChannel && !db.config?.customParent;
      const hasManage = !!db.config?.manage;
      
      const steps = {
        delTemps: deleteOptions.temps && hasTemps ? 'pending' : null,
        delMain: deleteOptions.main && hasMain ? 'pending' : null,
        delCategory: deleteOptions.category && hasCategory ? 'pending' : null,
        delManage: deleteOptions.manage && hasManage ? 'pending' : null,
        category: usingCustomCategory ? 'done' : 'pending',
        voice: 'pending',
        manageChannel: manageEnabled ? 'pending' : 'skip',
        manageMessage: manageEnabled ? 'pending' : 'skip'
      };
      
      if (loadingMsg && loadingEmbed) {
        await updateLoadingMessage(loadingMsg, loadingEmbed, steps, null, manageEnabled, true, willCreate, usingCustomCategory);
      }
      
      await client.database.updateGuild(message.guildId, {
        parentChannel: deleteOptions.category ? null : db.parentChannel,
        childChannel: deleteOptions.main ? null : db.childChannel,
        tempChannels: deleteOptions.temps ? [] : db.tempChannels,
        config: (deleteOptions.manage && db.config?.manage) ? { ...db.config, manage: null, manageMessage: null } : db.config,
      });
      
      try {
        if (deleteOptions.temps && hasTemps) {
          steps.delTemps = 'active';
          if (loadingMsg && loadingEmbed) await updateLoadingMessage(loadingMsg, loadingEmbed, steps, null, manageEnabled, true, willCreate, usingCustomCategory);
          
          for (const entry of db.tempChannels) {
            const channelId = typeof entry === "string" ? entry : (entry?.channelId ?? entry?.id);
            if (!channelId) continue;
            const channel = await client.channels.resolve(channelId);
            if (channel) await channel.delete();
            await delay(250);
          }
          steps.delTemps = 'done';
          if (loadingMsg && loadingEmbed) await updateLoadingMessage(loadingMsg, loadingEmbed, steps, null, manageEnabled, true, willCreate, usingCustomCategory);
          await delay(300);
        }
        
        if (deleteOptions.manage && hasManage) {
          steps.delManage = 'active';
          if (loadingMsg && loadingEmbed) await updateLoadingMessage(loadingMsg, loadingEmbed, steps, null, manageEnabled, true, willCreate, usingCustomCategory);
          await configManage("delete");
          steps.delManage = 'done';
          if (loadingMsg && loadingEmbed) await updateLoadingMessage(loadingMsg, loadingEmbed, steps, null, manageEnabled, true, willCreate, usingCustomCategory);
          await delay(300);
        }
        
        if (deleteOptions.main && hasMain) {
          steps.delMain = 'active';
          if (loadingMsg && loadingEmbed) await updateLoadingMessage(loadingMsg, loadingEmbed, steps, null, manageEnabled, true, willCreate, usingCustomCategory);
          const childChannel = await client.channels.resolve(db.childChannel);
          if (childChannel) await childChannel.delete();
          steps.delMain = 'done';
          if (loadingMsg && loadingEmbed) await updateLoadingMessage(loadingMsg, loadingEmbed, steps, null, manageEnabled, true, willCreate, usingCustomCategory);
          await delay(300);
        }
        
        if (deleteOptions.category && hasCategory) {
          steps.delCategory = 'active';
          if (loadingMsg && loadingEmbed) await updateLoadingMessage(loadingMsg, loadingEmbed, steps, null, manageEnabled, true, willCreate, usingCustomCategory);
          const parentChannel = await client.channels.resolve(db.parentChannel);
          if (parentChannel) await parentChannel.delete();
          steps.delCategory = 'done';
          if (loadingMsg && loadingEmbed) await updateLoadingMessage(loadingMsg, loadingEmbed, steps, null, manageEnabled, true, willCreate, usingCustomCategory);
          await delay(300);
        }
      } catch  { };
      
      return steps;
    }
    
    async function enableTemps(customCat = null, manage = null, loadingMsg = null, loadingEmbed = null) {
      try {
        const usingCustomCategory = !!customCat || !!db.config?.customParent;
        
        const steps = {
          category: usingCustomCategory ? 'done' : 'pending',
          voice: 'pending',
          manageChannel: manage ? 'pending' : 'skip',
          manageMessage: manage ? 'pending' : 'skip'
        };
        
        if (loadingMsg && loadingEmbed) {
          loadingEmbed.setTitle(client.translate.get(db.language, "Commands.tempchannels.creatingNew"));
          await updateLoadingMessage(loadingMsg, loadingEmbed, steps, 'category', manage, false, true, usingCustomCategory);
        }
        
        let category;
        if (customCat) {
          category = await client.channels.resolve(customCat.id);
          if (!category || category.type !== 4) return null;
          steps.category = 'done';
        } else {
          if (db.config?.customParent) {
            category = await client.channels.resolve(db.config.customParent);
            if (!category || category.type !== 4) return null;
            steps.category = 'done';
          } else {
            steps.category = 'active';
            if (loadingMsg && loadingEmbed) {
              await updateLoadingMessage(loadingMsg, loadingEmbed, steps, 'category', manage, false, true, usingCustomCategory);
            }
            await delay(500);
            
            category = await message.guild.createChannel({
              type: 4,
              name: client.translate.get(db.language, "Commands.tempchannels.tempChannels"),
            });
            steps.category = 'done';
          }
        }
        
        if (loadingMsg && loadingEmbed) {
          await updateLoadingMessage(loadingMsg, loadingEmbed, steps, 'category', manage, false, true, usingCustomCategory);
          await delay(300);
        }
        
        steps.voice = 'active';
        if (loadingMsg && loadingEmbed) {
          await updateLoadingMessage(loadingMsg, loadingEmbed, steps, 'voice', manage);
        }
        await delay(500);

        const voiceChannel = await message.guild.createChannel({
          type: 2,
          name: client.translate.get(db.language, "Commands.tempchannels.joinCreate"),
          parent_id: category.id,
          bitrate: 64000,
        });
        steps.voice = 'done';
        
        if (loadingMsg && loadingEmbed) {
          await updateLoadingMessage(loadingMsg, loadingEmbed, steps, 'voice', manage);
          await delay(300);
        }
        
        let manageChannel = null;
        let manageMessage = null;
        if (manage ? manage : db.config?.manage) {
          const opts = await configManage("create", message, category, loadingMsg, loadingEmbed, steps);
          manageChannel = opts.channel;
          manageMessage = opts.message;
        }

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

              const loadingEmbed = createEmbed(EMBED_COLORS.INFO, client.translate.get(db.language, "Commands.tempchannels.resetting"), "");
              const loadingMsg = await message.reply({ embeds: [loadingEmbed] });

              if (reset) await disableTemps({ temps: true, main: true, category: true, manage: true }, loadingMsg, loadingEmbed, false, true, false);
              const vc = await enableTemps(null, null, loadingMsg, loadingEmbed);
              if (!vc) {
                const errorEmbed = createEmbed(EMBED_COLORS.ERROR, null, client.translate.get(db.language, "Commands.tempchannels.failedSetup"));
                return await loadingMsg.edit({ embeds: [errorEmbed] });
              }
              const { category, voiceChannel } = vc;
              
              await client.database.updateGuild(message.guildId, {
                parentChannel: category.id,
                childChannel: voiceChannel.id,
                config: {
                  ...(db.config ?? {}),
                  customParent: null,
                },
              });
              
              const successEmbed = createEmbed(EMBED_COLORS.SUCCESS, null, client.translate.get(db.language, "Commands.tempchannels.successSetup", { voiceChannel: `<#${voiceChannel.id}>` }));
              await loadingMsg.edit({ embeds: [successEmbed] });
            }
            break;

          case "config":
            {
              const argsString = args.join(" ").replace(/\bset\b|\bconfig\b/gi, " ");
              const parsed = parseArguments(argsString);

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

              let counting = false;
              if (countingRaw === "") counting = true;

              let reset = false;
              if (resetRaw === "") reset = true;
              
              let manage = false;
              if (manageRaw === "") manage = true;

              let targetCategoryId;
              const categoryValidation = await resolveCategory(message.guild, categoryRaw, client, db, "set config");
              if (categoryValidation) {
                if (!categoryValidation.valid) {
                  return message.reply({ embeds: [categoryValidation.embed] });
                }
                targetCategoryId = categoryValidation.value;
              }

              if (!channelName && !channelLimit && !counting && !targetCategoryId && !reset && !manage) {
                return message.reply(
                  { embeds: [createEmbed(EMBED_COLORS.ERROR, null, `${client.translate.get(db.language, "Commands.tempchannels.noArgs")} (\`name\`, \`limit\`, \`counting\`, \`category\`, \`manage\`).\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc set config {name:${client.translate.get(db.language, "Commands.tempchannels.myChannel")}} {limit:5} {counting} {category:1484784325810897153} {manage}\`\n- ${client.translate.get(db.language, "Commands.tempchannels.noArgsDesc")}`)] }
                );
              }

              if (!checkNotSetupForSet(db, client, message, "set config", reset)) return;

              const loadingEmbed = createEmbed(EMBED_COLORS.INFO, client.translate.get(db.language, "Commands.tempchannels.resetting"), "");
              const loadingMsg = await message.reply({ embeds: [loadingEmbed] });

              const willCreate = !!(channelName || channelLimit || counting || targetCategoryId || manage);
              const usingCustomCategory = !!targetCategoryId;
              
              if (reset) {
                const didReset = await disableTemps({ temps: true, main: true, category: true, manage: true }, loadingMsg, loadingEmbed, manage, willCreate, usingCustomCategory);
                if (!channelName && !channelLimit && !counting && !targetCategoryId && !manage) {
                  if (!didReset) {
                    const errorEmbed = createEmbed(EMBED_COLORS.ERROR, null, client.translate.get(db.language, "Commands.tempchannels.noReset"));
                    return await loadingMsg.edit({ embeds: [errorEmbed] });
                  }
                  const successEmbed = createEmbed(EMBED_COLORS.SUCCESS, null, client.translate.get(db.language, "Commands.tempchannels.successReset"));
                  return await loadingMsg.edit({ embeds: [successEmbed] });
                }
              }
              
              const vc = await enableTemps(targetCategoryId, manage, loadingMsg, loadingEmbed);
              if (!vc) {
                const errorEmbed = createEmbed(EMBED_COLORS.ERROR, null, client.translate.get(db.language, "Commands.tempchannels.failedSetup"));
                return await loadingMsg.edit({ embeds: [errorEmbed] });
              }
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
              
              const successEmbed = createEmbed(EMBED_COLORS.SUCCESS, null, client.translate.get(db.language, "Commands.tempchannels.successSetup", { "voiceChannel": `<#${voiceChannel.id}>` }));
              await loadingMsg.edit({ embeds: [successEmbed] });
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
          
          let loadingMsg = null;
          let loadingEmbed = null;
          if (manageRaw === "") {
            const isRemovingManage = typeof currentConfig.manage == 'string';

            if (isRemovingManage) {
              await configManage("delete", message);
              updates.manage = null;
              updates.manageMessage = null;
            } else {
              loadingEmbed = createEmbed(EMBED_COLORS.INFO, client.translate.get(db.language, "Commands.tempchannels.resetting"), client.translate.get(db.language, "Commands.tempchannels.loadingManageChannel"));
              loadingMsg = await message.reply({ embeds: [loadingEmbed] });

              const category = await client.channels.resolve(db.parentChannel);
              const result = await configManage("create", message, category, loadingMsg, loadingEmbed, {
                manageChannel: 'pending',
                manageMessage: 'pending'
              }, true);
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

          const successEmbed = createEmbed(EMBED_COLORS.SUCCESS, null,
            `${client.translate.get(db.language, "Commands.tempchannels.successEdit")}:\n\n${changedFields}`
          );

          if (loadingMsg) {
            await loadingMsg.edit({ embeds: [successEmbed] });
          } else {
            await message.reply({ embeds: [successEmbed] });
          }
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

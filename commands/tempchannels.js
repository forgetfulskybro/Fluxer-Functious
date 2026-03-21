const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");

module.exports = {
  config: {
    name: "tempchannels",
    usage: true,
    cooldown: 3000,
    available: true,
    permissions: {
      name: "Manage Guild",
      bitField: PermissionFlags.ManageGuild,
    },
    aliases: ["tc", "tempchannel"],
  },
  run: async (client, message, args, db) => {
    async function disableTemps() {
      if (!db.parentChannel && !db.childChannel && db.tempChannels?.length === 0) return false;
      
      try {
        const parentChannel = await client.channels.resolve(db.parentChannel);
        const childChannel = await client.channels.resolve(db.childChannel);
        
        if (parentChannel) await parentChannel.delete();
        if (childChannel) await childChannel.delete();
        
        if (db.tempChannels?.length > 0) {
          for (const channelId of db.tempChannels) {
            const channel = await client.channels.resolve(channelId);
            if (channel) await channel.delete();
          }
        }
      } catch { };
      
      return await client.database.updateGuild(message.guildId, { parentChannel: null, childChannel: null, tempChannels: [], config: null });
    }
    
    async function enableTemps() {
      try {
      const category = await message.guild.createChannel({
        type: 4,
        name: client.translate.get(db.language, "Commands.tempchannels.tempChannels"),
      });
      
      const voiceChannel = await message.guild.createChannel({
        type: 2,
        name: client.translate.get(db.language, "Commands.tempchannels.joinCreate"),
        parent_id: category.id,
        bitrate: 64000,
      });
      
        return { category, voiceChannel }
      } catch (error) {
        return null;
      }
    }
    
    const embed = new EmbedBuilder()
      .setColor(`#A52F05`)
      .setTitle(client.translate.get(db.language, "Commands.tempchannels.helpUsage"))
      .setDescription(`${client.translate.get(db.language, "Commands.tempchannels.setup")}\n\`${db.prefix}tc set default\`\n\n${client.translate.get(db.language, "Commands.tempchannels.resetSetup", { "default": "default", "config": "config" })}\n\`${db.prefix}tc set [${client.translate.get(db.language, "Commands.tempchannels.option")}, e.g. default | config] {reset}\`\n\n${client.translate.get(db.language, "Commands.tempchannels.configuration")}\n\`${db.prefix}tc set config {name:${client.translate.get(db.language, "Commands.tempchannels.myChannel")}} {limit:5} {counting:on}\`\n\n${client.translate.get(db.language, "Commands.tempchannels.viewConfig")}\n\`${db.prefix}tc view\`\n\n**${client.translate.get(db.language, "Commands.tempchannels.optional")}**\n- \`{name:...}\`: ${client.translate.get(db.language, "Commands.tempchannels.nameDefine")}\n- \`{limit:...}\`: ${client.translate.get(db.language, "Commands.tempchannels.limitDefine")}\n- \`{counting:on}\`: ${client.translate.get(db.language, "Commands.tempchannels.countingDefine")}\n- \`{reset}\`: ${client.translate.get(db.language, "Commands.tempchannels.resetDefine")}\n\n**${client.translate.get(db.language, "Commands.tempchannels.examples")}**\n\`${db.prefix}tc set default\`\n\`${db.prefix}tc set config {name:Private Room} {limit:2} {counting:on}\`\n\`${db.prefix}tc set config {reset}\`\n\`${db.prefix}tc view\``)
    
    if (!args[0]) return message.reply({ embeds: [embed] });
    switch (args[0]?.toLowerCase()) {
      default: "help;"
      case "help":
        message.reply({ embeds: [embed] });
        break;
      
      case "view":
        message.reply({ embeds: [new EmbedBuilder().setTitle(client.translate.get(db.language, "Commands.tempchannels.tempConfig")).setDescription(`**${client.translate.get(db.language, "Commands.tempchannels.category")}**: <#${db.parentChannel}>\n**${client.translate.get(db.language, "Commands.tempchannels.mainChannel")}**: <#${db.childChannel}>\n\n**${client.translate.get(db.language, "Commands.tempchannels.channelName")}**: ${db.config?.channelName ?? client.translate.get(db.language, "Commands.tempchannels.notSet")}\n**${client.translate.get(db.language, "Commands.tempchannels.userLimit")}**: ${db.config?.limit ?? client.translate.get(db.language, "Commands.tempchannels.notSet")}\n**${client.translate.get(db.language, "Commands.tempchannels.countingToggle")}**: ${db.config?.counting ? client.translate.get(db.language, "Commands.tempchannels.on") : client.translate.get(db.language, "Commands.tempchannels.off")}`)] });
        break;

      case "set":
        switch (args[1]) {
          default: 
            message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.tempchannels.provideArg")} (\`default\` | \`config\`).\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc set default\``)] });
            break
          case "default":
            {
              const raw = args.join(" ").replace(/\bset\b|\bdefault\b/gi, " ");
              const matches = [...raw.matchAll(/\{\s*([a-zA-Z]+)(?:\s*:\s*([^}]+))?\}/g)];
              const parsed = Object.create(null);
              for (const m of matches) parsed[m[1].toLowerCase()] = (m[2] ?? "").trim();

              const resetRaw = parsed.reset;

              let reset = false;
              if (resetRaw === "") reset = true;

              if ((db.parentChannel || db.childChannel) && !reset) {
                const base = String(message.content ?? `${db.prefix}tc set default`).trim();
                const suggestion = base.includes("{reset:") ? base : `${base} {reset}`;
                return message.reply({
                  embeds: [
                    new EmbedBuilder().setDescription(
                      `${client.translate.get(db.language, "Commands.tempchannels.alreadySetup", { "option": "{reset}" })}\n\n\`\`\`\n${suggestion}\n\`\`\``,
                    ),
                  ],
                });
              }

              if (reset) await disableTemps();
              const vc = await enableTemps();
              if (!vc) return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.tempchannels.failedSetup")).setColor(`#FF0000`)] });
              const { category, voiceChannel } = vc;
              
              client.database.updateGuild(message.guildId, { parentChannel: category.id, childChannel: voiceChannel.id });
              message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.tempchannels.successSetup", { voiceChannel: `<#${voiceChannel.id}>` }))] });
            }
            break;

          case "config":
            {
              const raw = args.join(" ").replace(/\bset\b|\bconfig\b/gi, " ");
              const matches = [...raw.matchAll(/\{\s*([a-zA-Z]+)(?:\s*:\s*([^}]+))?\}/g)];
              const parsed = Object.create(null);
              for (const m of matches) parsed[m[1].toLowerCase()] = (m[2] ?? "").trim();

              const channelNameRaw = parsed.name;
              const limitRaw = parsed.limit;
              const countingRaw = parsed.counting;
              const resetRaw = parsed.reset;
              //const manageRaw = parsed.manage;
              
              let channelName;
              if (channelNameRaw) {
                const n = String(channelNameRaw).trim();
                if (n.length === 0) {
                  return message.reply(
                    { embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.tempchannels.channelNameRaw")}\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc set config {name:${client.translate.get(db.language, "Commands.tempchannels.myChannel")}}\`\n- ${client.translate.get(db.language, "Commands.tempchannels.channelNameDesc")}`)] }
                  );
                }
                
                if (n.length > 26) {
                  return message.reply(
                    { embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.tempchannels.channelNameLength")}\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc set config {name:${client.translate.get(db.language, "Commands.tempchannels.myChannel")}}\`\n- ${client.translate.get(db.language, "Commands.tempchannels.channelNameDesc")}`)] }
                  );
                }
                channelName = n;
              }

              let channelLimit;
              if (limitRaw) {
                const n = Number(String(limitRaw).trim());
                if (!Number.isFinite(n) || n < 0 || n > 99) {
                  return message.reply(
                    { embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.tempchannels.channelLimit")}\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc set config {limit:5}\`\n- ${client.translate.get(db.language, "Commands.tempchannels.channelLimitDesc")}`)] }
                  );
                }
                channelLimit = n;
              }

              let counting;
              if (countingRaw === "") counting = true;

              let reset = false;
              if (resetRaw === "") reset = true;

              // let manage;
              // if (manageRaw) {
              //   const v = String(manageRaw).trim().toLowerCase();
              //   if (v === "true" || v === "on") manage = true;
              //   else {
              //     return message.reply(
              //       { embeds: [new EmbedBuilder().setDescription(`Please provide a valid manage option (\`{manage:true}\` or \`{manage:on}\`).\n**Example**:\n\`${db.prefix}tc set config {manage:true}\``)] }
              //     );
              //   }
              // }

              if ((db.parentChannel || db.childChannel) && !reset) {
                const base = String(message.content ?? `${db.prefix}tc set config`).trim();
                const suggestion = base.includes("{reset:") ? base : `${base} {reset}`;
                return message.reply({
                  embeds: [
                    new EmbedBuilder().setDescription(
                      `${client.translate.get(db.language, "Commands.tempchannels.alreadySetup", { "option": "{reset}" })}\n\n\`\`\`\n${suggestion}\n\`\`\``,
                    ),
                  ],
                });
              }

              if (reset) {
                const didReset = await disableTemps();
                if (!channelName && !channelLimit && !counting) {
                  if (!didReset) {
                    return message.reply({
                      embeds: [
                        new EmbedBuilder().setDescription(
                          client.translate.get(db.language, "Commands.tempchannels.noReset"),
                        ),
                      ],
                    });
                  }
                  return message.reply({
                    embeds: [
                      new EmbedBuilder().setDescription(
                        client.translate.get(db.language, "Commands.tempchannels.successReset"),
                      ),
                    ],
                  });
                }
              }

              if (!channelName && !channelLimit && !counting && !reset) {
                return message.reply(
                  { embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.tempchannels.noArgs")} (\`name\`, \`limit\`, \`counting\`).\n**${client.translate.get(db.language, "Commands.tempchannels.example")}**:\n\`${db.prefix}tc set config {name:${client.translate.get(db.language, "Commands.tempchannels.myChannel")}} {limit:5} {counting:on}\`\n- ${client.translate.get(db.language, "Commands.tempchannels.noArgsDesc")}`)] }
                );
              }
              
              const vc = await enableTemps();
              if (!vc) return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.tempchannels.failedSetup")).setColor(`#FF0000`)] });
              const { category, voiceChannel } = vc;

              await client.database.updateGuild(message.guildId, {
                config: {
                  ...(channelName ? { channelName } : {}),
                  ...(channelLimit ? { channelLimit } : {}),
                  ...(counting ? { counting } : {}),
                }, // ...(manage  ? { manage } : {}),
                parentChannel: category.id,
                childChannel: voiceChannel.id,
              });
              
              message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.tempchannels.successSetup", { "voiceChannel": `<#${voiceChannel.id}>` }))] });
            }
            break;
        }
        break;
    }
  },
};

const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const getRoles = require('../functions/getRoles');
const { trackGuildUpdates } = require('../api/trackSettings');

module.exports = {
  config: {
    name: "bypass",
    usage: "help",
    cooldown: 2000,
    available: true,
    permissions: {
      name: "Administrator",
      bitField: PermissionFlags.Administrator,
    },
    aliases: ["bp"],
  },
  run: async (client, message, args, db) => {
    const permCmds = client.commands
      .filter((c) => c.config.permissions?.bitField)
      .map((c) => c.config.name);
    permCmds.push("timezone");
    permCmds.push("all");
    permCmds.push("polls");    

    const arg = args.join(" ").replace(/add|remove|edit/gi, '').split("|").map(x => x.trim()).filter(x => x);
    const role = arg[0];
    const cmds = arg[1]?.split(",").map(x => x.trim()).filter(x => x);

    if (args[0]) {
      if (!role && args[0].toLowerCase() !== "view") return message.reply({
        embeds: [
          new EmbedBuilder()
            .setDescription(`${client.translate.get(db.language, "Commands.bypass.roleName")}:\n\`${db.prefix}bypass ${args[0].toLowerCase()} Moderator ${args[0].toLowerCase() !== "remove" ? `| roles, giveaway` : ``}\``)
            .setColor(`#FF0000`),
        ]
      });
      
      if (!cmds && args[0]?.toLowerCase() !== "view" && args[0]?.toLowerCase() !== "remove") return message.reply({
        embeds: [
          new EmbedBuilder()
            .setDescription(`${client.translate.get(db.language, "Commands.bypass.provideCommands", { "role": role })}:\n\`${db.prefix}bypass add ${role} | roles, giveaway\`\n\n**${client.translate.get(db.language, "Commands.bypass.lockCommands")}**\n\`${permCmds.join(", ")}\``)
            .setColor(`#FF0000`),
        ]
      });
    }
    
    let type;
    const invalidCmds = [];
    let roleIds = true;
    if (args[0] && args[0]?.toLowerCase() !== "view") roleIds = await getRoles([role], message, client, db, false, false, false);
    if (!roleIds) return;
    
    switch (args[0]?.toLowerCase()) {
      default:
        "help";
      case "help":
        message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(client.translate.get(db.language, "Commands.bypass.viewHelp"))
              .setDescription(
                `${client.translate.get(db.language, "Commands.bypass.explanation")}\n**${client.translate.get(db.language, "Commands.bypass.lockCommands")}**:\n\`${permCmds.join(", ")}\`\n\n**${client.translate.get(db.language, "Commands.bypass.adding")}**\n\`${db.prefix}bypass add [${client.translate.get(db.language, "Commands.bypass.rolename")}] | [${client.translate.get(db.language, "Commands.bypass.lockCommands")}, e.g. roles, giveaway]\`\n\n**${client.translate.get(db.language, "Commands.bypass.editing")}**\n\`${db.prefix}bypass edit [${client.translate.get(db.language, "Commands.bypass.rolename")}] | [${client.translate.get(db.language, "Commands.bypass.lockCommands")}, e.g. roles, giveaway]\`\n\n**${client.translate.get(db.language, "Commands.bypass.removing")}**\n\`${db.prefix}bypass remove [${client.translate.get(db.language, "Commands.bypass.rolename")}]\`\n\n**${client.translate.get(db.language, "Commands.bypass.viewing")}**\n\`${db.prefix}bypass view\`\n\n**${client.translate.get(db.language, "Commands.bypass.example")}**: \`${db.prefix}bypass add Moderator | giveaway, autoroles\``,
              )
              .setColor(`#A52F05`),
          ],
        });
        break;

      case "add":
        if (db.bypassRoles.length > 15) return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(client.translate.get(db.language, "Commands.bypass.maximumBypass"))
              .setColor(`#FF0000`),
          ]
        });
      
        if (db.bypassRoles.length > 0 && db.bypassRoles.find((r) => r.role === roleIds[0].id)) return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(`${client.translate.get(db.language, "Commands.bypass.roleAlready")}: \`${db.bypassRoles.find((r) => r.role === roleIds[0].id)?.commands.join(", ")}\`\n\n${client.translate.get(db.language, "Commands.bypass.roleUse")}\n\`${db.prefix}bypass edit ${role} | [${client.translate.get(db.language, "Commands.bypass.lockCommands")}, e.g. giveaway, roles]\``)
              .setColor(`#FF0000`),
          ]
        });
        
        for (let i = 0; cmds.length > i; i++) {
          if (!permCmds.includes(cmds[i].toLowerCase())) invalidCmds.push(cmds[i].toLowerCase())
        }
        
        if (invalidCmds.length > 0) return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(`${client.translate.get(db.language, "Commands.bypass.invalidCmds")}\n**${client.translate.get(db.language, "Commands.bypass.commands")}**: \`${invalidCmds.join(", ")}\``)
              .setColor(`#FF0000`),
          ]
        });
        
        if (cmds.includes("all")) {
          message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(`${client.translate.get(db.language, "Commands.bypass.successAll")} <@&${roleIds[0].id}>`)
                .setColor(`#A52F05`),
            ]
          });
          
          type = ["all"];
        } else {
          message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(`${client.translate.get(db.language, "Commands.bypass.success", { "role": `<@&${roleIds[0].id}>` })}:\n\`${cmds.join(", ")}\``)
                .setColor(`#A52F05`),
            ]
          });
          
          type = cmds;
        }
        
        await client.database.updateGuild(message.guild.id, { bypassRoles: [...db.bypassRoles, { role: roleIds[0].id, commands: type }] });

        await trackGuildUpdates(client, {
          guildId: message.guildId,
          userId: message.author.id,
          existing: db,
          updates: { bypassRoles: [...db.bypassRoles, { role: roleIds[0].id, commands: type }] },
        });

        break;

      case "remove":        
        if (!db.bypassRoles.find((r) => r.role === roleIds[0].id)) return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(client.translate.get(db.language, "Commands.bypass.notBypassed"))
              .setColor(`#FF0000`),
          ]
        });
        
        message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(client.translate.get(db.language, "Commands.bypass.removeSuccess", { "role": `<@&${roleIds[0].id}>`}))
              .setColor(`#A52F05`),
          ]
        });
        
        const roles = db.bypassRoles.filter(() => !roleIds[0].id);
        await client.database.updateGuild(message.guild.id, { bypassRoles: roles });

        await trackGuildUpdates(client, {
          guildId: message.guildId,
          userId: message.author.id,
          existing: db,
          updates: { bypassRoles: roles },
        });

        break;
      
      case "edit":        
        const bypassedRole = db.bypassRoles.find((r) => r.role === roleIds[0].id);
        if (!bypassedRole) return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(client.translate.get(db.language, "Commands.bypass.notBypassedEdit"))
              .setColor(`#FF0000`),
          ]
        });
        
        for (let i = 0; cmds.length > i; i++) {
          if (!permCmds.includes(cmds[i].toLowerCase())) invalidCmds.push(cmds[i].toLowerCase())
        }
        
        if (invalidCmds.length > 0) return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(`${client.translate.get(db.language, "Commands.bypass.invalidCmds")}\n**${client.translate.get(db.language, "Commands.bypass.commands")}**: \`${invalidCmds.join(", ")}\``)
              .setColor(`#FF0000`),
          ]
        });
        
        if (cmds.includes("all")) type = ["all"];
        else type = cmds;
      
        message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(`${client.translate.get(db.language, "Commands.bypass.editSuccess", { "role": `<@&${roleIds[0].id}>` })}:\n\n**${client.translate.get(db.language, "Commands.bypass.old")}**\n\`${bypassedRole.commands.join(", ")}\`\n\n**${client.translate.get(db.language, "Commands.bypass.new")}**\n\`${type.join(", ")}\``)
              .setColor(`#A52F05`),
          ]
        });
        
        const editCmds = db.bypassRoles.filter(() => !roleIds[0].id);

        await trackGuildUpdates(client, {
          guildId: message.guildId,
          userId: message.author.id,
          existing: db,
          updates: { bypassRoles: [...editCmds, { role: roleIds[0].id, commands: type }] },
        });

        await client.database.updateGuild(message.guild.id, { bypassRoles: [...editCmds, { role: roleIds[0].id, commands: type }] });
        break;
      
      case "view": 
        if (db.bypassRoles.length === 0) return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(client.translate.get(db.language, "Commands.bypass.noRolesView"))
              .setColor(`#FF0000`),
          ]
        });
        
        message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(client.translate.get(db.language, "Commands.bypass.bypassedRoles"))
              .setDescription(
                db.bypassRoles.map((r, i) => {
                  const cmdsDisplay = r.commands.includes("all")
                    ? "All commands"
                    : `\`${r.commands.join("`, `")}\``;
                  return `**${i + 1}.** <@&${r.role}>\n┗ ${cmdsDisplay}`;
                }).join("\n\n")
              )
              .setFooter({ text: `${db.bypassRoles.length} bypass role${db.bypassRoles.length !== 1 ? "s" : ""}` })
              .setColor(`#A52F05`),
          ]
        });
        break;
    }
  },
};

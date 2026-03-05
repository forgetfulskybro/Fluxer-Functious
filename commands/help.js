const { EmbedBuilder } = require("@fluxerjs/core")
module.exports = {
    config: {
        name: "help",
        available: true,
        cooldown: 3000,
        permissions: {},
        aliases: []
    },
  run: async (client, message, args, db) => {
        if (args[0] && client.commands.filter(c => c.config.available !== "Owner").get(args[0].toLowerCase()) || client.commands.filter(c => c.config.available !== "Owner").find(c => c.config.aliases.includes(args[0].toLowerCase()))) {
            const command = client.commands.get(args[0].toLowerCase()) || client.commands.find(c => c.config.aliases.includes(args[0].toLowerCase()));
            if (!command) return;

            let usage = '';
            if (command.config.usage) {
                usage = client.translate.get(db.language, `Commands.${command.config.name}.usage`);
            }

            const embed = new EmbedBuilder()
                .setColor('#A52F05')
                .setTitle(`${client.translate.get(db.language, 'Commands.help.embeds.first.cmdName')}: ${command.config.name}`)
                .setDescription(
                    client.translate.get(db.language, `Commands.${command.config.name}.description`)
                )
                .addFields(
                    { 
                        name: client.translate.get(db.language, 'Commands.help.embeds.first.cmdAvail'), 
                        value: command.config.available 
                            ? client.translate.get(db.language, 'Commands.help.embeds.first.cmdAvail2') 
                            : client.translate.get(db.language, 'Commands.help.embeds.first.cmdAvail3'),
                        inline: true 
                    },
                    { 
                        name: client.translate.get(db.language, 'Commands.help.embeds.first.cmdCool'), 
                        value: `${command.config.cooldown / 1000}s`,
                        inline: true 
                    },
                    { 
                        name: client.translate.get(db.language, 'Commands.help.embeds.first.cmdPerms'), 
                        value: command.config.permissions?.name 
                            ? command.config.permissions.name 
                            : client.translate.get(db.language, 'Commands.help.embeds.first.cmdPerms2'),
                        inline: true 
                    }
                );
            
            if (command.config.aliases.length > 0) {
                embed.addFields({
                    name: client.translate.get(db.language, 'Commands.help.embeds.first.cmdAlias'),
                    value: command.config.aliases.map(a => `\`${a}\``).join(', '),
                    inline: false
                });
            }
            
            embed.addFields({
                name: client.translate.get(db.language, 'Commands.help.embeds.first.cmdUsage'),
                value: `\`\`\`\n${db.prefix}${command.config.name} ${usage}\n\`\`\``,
                inline: false
            });

            return message.channel.send({ embeds: [embed] });
        }

        const embed = new EmbedBuilder()
            .setDescription(`${client.translate.get(db.language, 'Commands.help.embeds.second.start')}\n${client.commands.filter(c => c.config.available && c.config.available !== "Owner").map(c => `\`${c.config.name}\``).join(", ")}${client.commands.filter(c => c.config.available === false).size > 0 ? `\n\n${client.translate.get(db.language, 'Commands.help.embeds.second.middle')}\n${client.commands.filter(c => c.config.available === false).map(c => `\`${c.config.name}\``).join(", ")}` : ""}\n\n${client.translate.get(db.language, 'Commands.help.embeds.second.end')} \`${client.config.prefix}help [${client.translate.get(db.language, 'Commands.help.embeds.second.end2')}]\``)
            .setColor(`#A52F05`);

        message.channel.send({ embeds: [embed] })
    },
};

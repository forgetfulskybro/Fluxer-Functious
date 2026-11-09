const { EmbedBuilder } = require("@fluxerjs/core");
const { dashboardHelpField, dashboardPageForCommand } = require("../functions/dashboardHelp");

module.exports = {
    config: {
        name: "help",
        available: true,
        cooldown: 3000,
        permissions: {},
        aliases: ["h"]
    },
    run: async (client, message, args, db) => {
        const disabledNames = new Set(
            (Array.isArray(db.commandSettings) ? db.commandSettings : [])
                .filter((setting) => setting?.enabled === false)
                .map((setting) => setting.name)
        );
        const isCommunityDisabled = (command) =>
            disabledNames.has(command.config.name);

        const requested = args[0]?.toLowerCase();
        const command = requested
            ? client.commands.get(requested) ||
              client.commands.find(
                  (entry) =>
                      entry.config.available !== "Owner" &&
                      Array.isArray(entry.config.aliases) &&
                      entry.config.aliases.includes(requested)
              )
            : null;

        if (command && command.config.available !== "Owner") {
            let usage = "";
            if (typeof command.config.usage === "string") {
                usage = command.config.usage;
            } else if (command.config.usage) {
                usage = client.translate.get(
                    db.language,
                    `Commands.${command.config.name}.usage`
                );
            }

            const availabilityKey = isCommunityDisabled(command)
                ? "cmdAvail4"
                : command.config.available
                  ? "cmdAvail2"
                  : "cmdAvail3";

            const embed = new EmbedBuilder()
                .setColor(db.theme)
                .setTitle(
                    `${client.translate.get(db.language, "Commands.help.embeds.first.cmdName")}: ${command.config.name}`
                )
                .setDescription(
                    client.translate.get(
                        db.language,
                        `Commands.${command.config.name}.description`
                    )
                )
                .addFields(
                    {
                        name: client.translate.get(db.language, "Commands.help.embeds.first.cmdAvail"),
                        value: client.translate.get(
                            db.language,
                            `Commands.help.embeds.first.${availabilityKey}`
                        ),
                        inline: true
                    },
                    {
                        name: client.translate.get(db.language, "Commands.help.embeds.first.cmdCool"),
                        value: `${command.config.cooldown / 1000}s`,
                        inline: true
                    },
                    {
                        name: client.translate.get(db.language, "Commands.help.embeds.first.cmdPerms"),
                        value: command.config.permissions?.name
                            ? command.config.permissions.name
                            : client.translate.get(db.language, "Commands.help.embeds.first.cmdPerms2"),
                        inline: true
                    }
                );

            const aliases = Array.isArray(command.config.aliases)
                ? command.config.aliases
                : [];

            if (aliases.length > 0) {
                embed.addFields({
                    name: client.translate.get(db.language, "Commands.help.embeds.first.cmdAlias"),
                    value: aliases.map((alias) => `\`${alias}\``).join(", "),
                    inline: false
                });
            }

            embed.addFields({
                name: client.translate.get(db.language, "Commands.help.embeds.first.cmdUsage"),
                value: `\`\`\`\n${db.prefix}${command.config.name} ${usage}\n\`\`\``,
                inline: false
            });

            const dashboardPage = dashboardPageForCommand(command.config.name);
            if (dashboardPage) {
                embed.addFields(
                    dashboardHelpField(client, db, message.guildId, dashboardPage)
                );
            }

            return message.channel.send({ embeds: [embed] });
        }

        const visibleCommands = client.commands.filter(
            (entry) =>
                entry.config.available &&
                entry.config.available !== "Owner"
        );
        const availableCommands = visibleCommands.filter(
            (entry) => !isCommunityDisabled(entry)
        );
        const communityDisabledCommands = visibleCommands.filter((entry) =>
            isCommunityDisabled(entry)
        );
        const unavailableCommands = client.commands.filter(
            (entry) => entry.config.available === false
        );
        const formatCommands = (commands) =>
            commands
                .map((entry) => `\`${entry.config.name}\``)
                .join(", ");

        const sections = [
            `${client.translate.get(db.language, "Commands.help.embeds.second.start")}\n${formatCommands(availableCommands)}`
        ];

        if (communityDisabledCommands.size > 0) {
            sections.push(
                `${client.translate.get(db.language, "Commands.help.embeds.second.disabled")}\n${formatCommands(communityDisabledCommands)}`
            );
        }

        if (unavailableCommands.size > 0) {
            sections.push(
                `${client.translate.get(db.language, "Commands.help.embeds.second.middle")}\n${formatCommands(unavailableCommands)}`
            );
        }

        sections.push(
            client.translate.get(
                db.language,
                "Commands.help.embeds.second.end",
                {
                    cmd: `\`${db.prefix}help [${client.translate.get(db.language, "Commands.help.embeds.second.end2")}]\``
                }
            )
        );

        const embed = new EmbedBuilder()
            .setDescription(sections.join("\n\n"))
            .setColor(db.theme);

        return message.channel.send({ embeds: [embed] });
    },
};

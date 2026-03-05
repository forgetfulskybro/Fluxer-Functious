const { EmbedBuilder } = require("@fluxerjs/core");
const Giveaways = require("../models/giveaways");
const emojis = [{ name: "1️⃣", id: 0 }, { name: "2️⃣", id: 1 }, { name: "3️⃣", id: 2 }, { name: "4️⃣", id: 3 }, { name: "5️⃣", id: 4 }, { name: "6️⃣", id: 5 }, { name: "7️⃣", id: 6 }, { name: "8️⃣", id: 7 }, { name: "9️⃣", id: 8 }, { name: "🔟", id: 9 }, { name: "🛑", id: "stop" }]

module.exports = async (client, message, user) => {
    if (user.bot) return;
    const userId = user.id;
    const emojiId = message.emoji?.name;
    const pollCheck = client.polls.get(message.messageId);
    const collector = client.messageCollector.get(userId);
    const editCollector = client.messageEdit.get(userId);

  if (collector && collector.messageId === message.messageId && collector.channelId === message.channelId) {
      let emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
        const emoji = collector.rolesDone.find(e => e.emoji === emote);
        if (emoji) {
            collector.rolesDone = collector.rolesDone.filter(object => object.emoji != emote);
            collector.roles.unshift([emoji.role, { name: emoji.name }]);
            collector.regex.unshift(emoji.name);

            const newMsg = await (await client.channels.resolve(message.channelId))?.messages?.fetch(message.messageId)
            return newMsg.edit(collector.type === "content" ? { content: newMsg.content.replace(`${emote} ${emoji.name}`, `{role:${emoji.name}}`) } : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(newMsg.embeds[0].description.replace(`${emote} ${emoji.name}`, `{role:${emoji.name}}`))] }).catch(() => { });
        }
    } else if (editCollector && editCollector.messageId === message.messageId && editCollector.channelId === message.channelId) {
        let emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
        const emoji = editCollector.rolesDone.find(e => e.emoji === emote);
        if (emoji) {
            editCollector.rolesDone = editCollector.rolesDone.filter(object => object.emoji != emote);
            editCollector.roles.unshift([emoji.role, { name: emoji.name }]);
            editCollector.regex.unshift(emoji.name);

            const newMsg = await (await client.channels.resolve(message.channelId))?.messages?.fetch(message.messageId)
            return newMsg.edit(editCollector.type === "content" ? { content: newMsg.content.replace(`${emote} ${emoji.name}`, `{role:${emoji.name}}`) } : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(newMsg.embeds[0].description.replace(`${emote} ${emoji.name}`, `{role:${emoji.name}}`))] }).catch(() => { });
        }
    } else if (pollCheck) {
        if (client.reactions.get(userId)) return client.users.get(userId)?.createDM().then(dm => dm.send(client.translate.get(pollCheck.language, "Events.messageReactionRemove.tooFast"))).catch(() => { });
        let convert = emojis.findIndex(e => e.name === emojiId);
        if (convert === 0 && convert !== 10 || convert !== -1 && convert !== 10) {
            if (!pollCheck.users.includes(userId)) return;

            let tooMuch = [];
            if (pollCheck.poll.options.description.length > 80) tooMuch.push(`**${client.translate.get(pollCheck.language, "Events.messageReactionRemove.title")}**: ${pollCheck.poll.options.description}`)
            pollCheck.poll.voteOptions.name.filter(e => e).forEach((e, i) => {
                i++
                if (e.length > 70) {
                    tooMuch.push(`**${i}.** ${e}`)
                }
            });

            pollCheck.users = pollCheck.users.filter(object => object != userId);
            const user = (client.users.cache.get(userId)) || await client.users.fetch(userId);
            await pollCheck.poll.removeVote(convert, userId, user.displayAvatarURL(), message.messageId);
            
            const pollImage = await fetch(`${process.env.CDN}/api/upload`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      apikey: process.env.CDN_KEY,
                      image: pollCheck.poll.canvas.toDataURL('image/png'),
                      timeframe: pollCheck.poll.time,
                      messageId: message.messageId
                    })
            }).then((i) => i.json())
          
            const newMsg = await (await client.channels.resolve(pollCheck.channelId))?.messages?.fetch(pollCheck.messageId)
            newMsg.edit({ embeds: [new EmbedBuilder().setDescription(`${tooMuch.length > 0 ? tooMuch.map(e => e).join("\n") : ""}\n_ _`).setImage(`${process.env.CDN}${pollImage.url}`).setColor(`#A52F05`)] }).catch(() => { });
            client.reactions.set(userId, Date.now() + 3000)
            return setTimeout(() => client.reactions.delete(userId), 3000)
        } else return;
    } else {
        if (client.reactions.get(userId)) return;
        const db = await Giveaways.findOne({ messageId: message.messageId });
        if (db && !db.ended) {
            if (emojiId === client.config.emojis.confetti) {
                if (!db.users.find(u => u.userID === userId)) return;
                const filtered = db.users.filter(object => object.userID != userId)
                db.users = filtered;
                const filtered2 = db.picking.filter(object => object.userID != userId)
                db.picking = filtered2;
                db.save();

                client.reactions.set(userId, Date.now() + 3000)
                setTimeout(() => client.reactions.delete(userId), 3000)

                client.users.get(userId)?.createDM().then(dm => dm.send(`${client.translate.get(db.language, "Events.messageReactionRemove.left")} [${db.prize}](https://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId})!\n${client.translate.get(db.language, "Events.messageReactionRemove.left2")} **${db.users.length}** ${client.translate.get(db.language, "Events.messageReactionRemove.left3")}!`)).catch(() => { });
            }
        } else {
            const db2 = await client.database.getGuild(message.guildId, true)
            let emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
            if (db2 && db2.roles.find(e => e.msgId === message.messageId) && db2.roles.find(e => e.roles.find(e => e.emoji === emote))) {
                const roles = [];
                db2.roles.find(e => e.msgId === message.messageId).roles.map(e => roles.push(e));
                const role = roles.find(e => e.emoji === emote);
                const member = await (client.guilds.get(message.guildId) || await client.guilds.fetch(message.guildId))?.fetchMember(userId);
                if (!member) return;

                let error = false;
                if (!member.roles.cache.has(role.role)) return;

                client.reactions.set(userId, Date.now() + 1500);
                setTimeout(() => client.reactions.delete(userId), 1500);

                await member.roles.remove(role.role).catch(() => { error = true })
                const guild = await client.guilds.get(message.guildId);
                if (error) {
                    if (db2.dm) member?.user?.createDM().then((dm) => { dm.send(`**[${guild.name}]** ${client.translate.get(db2.language, "Events.messageReactionRemove.noPerms").replace("{role}", `**${role.name}**`)}!`) }).catch(() => { });
                } else {
                    if (db2.dm) member?.user?.createDM().then((dm) => { dm.send(`**[${guild.name}]** ${client.translate.get(db2.language, "Events.messageReactionRemove.success").replace("{role}", `**${role.name}**`)}!`) }).catch(() => { });
                }
            }
        }
    }
}
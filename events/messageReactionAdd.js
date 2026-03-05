const { EmbedBuilder } = require("@fluxerjs/core");
const PollDB = require("../models/polls");
const Giveaways = require("../models/giveaways");
const emojis = [{ name: "1️⃣", id: 0 }, { name: "2️⃣", id: 1 }, { name: "3️⃣", id: 2 }, { name: "4️⃣", id: 3 }, { name: "5️⃣", id: 4 }, { name: "6️⃣", id: 5 }, { name: "7️⃣", id: 6 }, { name: "8️⃣", id: 7 }, { name: "9️⃣", id: 8 }, { name: "🔟", id: 9 }, { name: "🛑", id: "stop" }]

module.exports = async (client, message, user) => {
    if (user.bot) return;
    const userId = user.id;
    const emojiId = message.emoji?.name;
    const paginateCheck = client.paginate.get(userId);
    const pollCheck = client.polls.get(message.messageId);
    const collector = client.messageCollector.get(userId);
    const editCollector = client.messageEdit.get(userId);
    
    if (collector && collector.messageId === message.messageId || collector?.oldMessageId && collector?.oldMessageId === message.messageId && collector.channelId === message.channelId) {
        if (emojiId === client.config.emojis.check) {
            if (collector.roles.length === 0) {
                const db = await client.database.getGuild(message.guildId);
                (await (await client.channels.resolve(collector.channelId))?.messages?.fetch(collector?.oldMessageId))?.delete().catch(()=> {})
                const reactions = [...collector.rolesDone.map(e => e.emoji)];
                const newMsg = await (await client.channels.resolve(message.channelId))?.messages?.fetch(message.messageId)
                newMsg.channel.send(collector.type === "content" ? { content: `${newMsg.content}\n\n> [!NOTE]\n> ${client.translate.get(db.language, "Events.messageReactionAdd.cooldown")}` } : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(`${newMsg.embeds[0].description}\n\n> Note\n> ${client.translate.get(db.language, "Events.messageReactionAdd.cooldown")}`)] }).then(async (m) => {
                  for (const reaction of reactions) {
                      await m.react(reaction).catch(() => {});
                  }
                  
                  db.roles.push({ msgId: m.id, chanId: message.channelId, roles: [...collector.rolesDone] });
                  await client.database.updateGuild(message.guildId, { roles: db.roles });
                });
                
                newMsg.delete();
                clearTimeout(client.messageCollector.get(userId).timeout);
                return client.messageCollector.delete(userId);
            } else return;
        } else if (emojiId === client.config.emojis.cross) {
            const db = await client.database.getGuild(message.guildId);
            client.messageCollector.delete(userId);
            const channel = await (await client.channels.resolve(message.channelId))?.messages.fetch(message.messageId);
            channel.delete({ silent: true })
            return (await client.channels.resolve(message.channelId))?.send({ embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(client.translate.get(db.language, "Events.messageReactionAdd.deleteCollector"))] })
        } else {
            if (collector.roles.length === 0) return;
            let emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
            collector.rolesDone.push({ emoji: emote, role: collector.roles[0][0], name: collector.roles[0][1].name });
            const newMsg = await (await client.channels.resolve(message.channelId))?.messages?.fetch(message.messageId)
            newMsg.edit(collector.type === "content" ? { content: newMsg.content.replace(`{role:${collector.regex[0]}}`, `${emote} ${collector.roles[0][1].name}`) } : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(newMsg.embeds[0].description.replace(`{role:${collector.regex[0]}}`, `${emote} ${collector.roles[0][1].name}`))] })
            collector.roles.shift();
            return collector.regex.shift();
        }
    } else if (editCollector && editCollector.messageId === message.messageId || editCollector?.botMessage && editCollector?.botMessage === message.messageId && editCollector.channelId === message.channelId) {
        if (emojiId === client.config.emojis.check) {
            if (editCollector.roles.length === 0) {
                const db = await client.database.getGuild(message.guildId);
                const oldMsg = await (await client.channels.resolve(editCollector.channelId))?.messages?.fetch(editCollector?.oldMessageId);
                const botMsg = await (await client.channels.resolve(editCollector.channelId))?.messages?.fetch(editCollector?.botMessage);
              
                oldMsg.delete().catch(()=> {});
                botMsg.delete().catch(()=> {});
              
                const reactions = [...editCollector.rolesDone.map(e => e.emoji)];
                const newMsg = await (await client.channels.resolve(message.channelId))?.messages?.fetch(message.messageId)
                newMsg.channel.send(editCollector.type === "content" ? { content: `${newMsg.content}\n\n> [!NOTE]\n> ${client.translate.get(db.language, "Events.messageReactionAdd.cooldown")}` } : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(`${newMsg.embeds[0].description}\n\n> Note\n> ${client.translate.get(db.language, "Events.messageReactionAdd.cooldown")}`)] }).then(async (msg) => {
                  for (const reaction of reactions) {
                      await msg.react(reaction).catch(() => {});
                  }
                  
                  db.roles = [
                    ...db.roles.filter(e => e.msgId !== editCollector.oldMessageId),
                    {
                      msgId: msg.id,
                      chanId: message.channelId,
                      roles: [...editCollector.rolesDone]
                    }
                  ];
                    
                  await client.database.updateGuild(message.guildId, { roles: db.roles });
                });

                newMsg.delete();
                clearTimeout(client.messageEdit.get(userId).timeout);
                return client.messageEdit.delete(userId);
            } else return;
        } else if (emojiId === client.config.emojis.cross) {
            const db = await client.database.getGuild(message.guildId);
            client.messageEdit.delete(userId);
            const channel = await (await client.channels.resolve(message.channelId))?.messages.fetch(message.messageId);
            channel.delete({ silent: true })
            return (await client.channels.resolve(message.channelId))?.send({ embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(client.translate.get(db.language, "Events.messageReactionAdd.deleteCollector"))] })
        } else {
            if (editCollector.roles.length === 0) return;
            let emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
            editCollector.rolesDone.push({ emoji: emote, role: editCollector.roles[0][0], name: editCollector.roles[0][1].name });
            const newMsg = await (await client.channels.resolve(message.channelId))?.messages?.fetch(message.messageId)
            newMsg.edit(editCollector.type === "content" ? { content: newMsg.content.replace(`{role:${editCollector.regex[0]}}`, `${emote} ${editCollector.roles[0][1].name}`) } : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(newMsg.embeds[0].description.replace(`{role:${editCollector.regex[0]}}`, `${emote} ${editCollector.roles[0][1].name}`))] })
            editCollector.roles.shift();
            return editCollector.regex.shift();
        }
    } else if (paginateCheck && paginateCheck.message == message.messageId) {
        let pages = paginateCheck.pages;
        let page = paginateCheck.page;
        switch (emojiId) {
            case "⏪":
                if (page !== 0) {
                  const msg = await (await client.channels.resolve(paginateCheck.channel))?.messages?.fetch(paginateCheck.message);
                  await msg.edit({ embeds: [pages[0]] });
                  return paginateCheck.page = 0
                } else {
                    return;
                }
            case "⬅️":
                if (pages[page - 1]) {
                  const msg = await (await client.channels.resolve(paginateCheck.channel))?.messages?.fetch(paginateCheck.message);
                  await msg.edit({ embeds: [pages[--page]] });
                  return paginateCheck.page = paginateCheck.page - 1
                } else {
                    return;
                }
            case "➡️":
                if (pages[page + 1]) {
                  const msg = await (await client.channels.resolve(paginateCheck.channel))?.messages?.fetch(paginateCheck.message);
                  await msg.edit({ embeds: [pages[++page]] });
                  return paginateCheck.page = paginateCheck.page + 1
                } else {
                    return;
                }
            case "⏩":
                if (page !== pages.length) {
                  const msg = await (await client.channels.resolve(paginateCheck.channel))?.messages?.fetch(paginateCheck.message);
                  await msg.edit({ embeds: [pages[pages.length-1]] });
                  return paginateCheck.page = pages.length - 1
                } else {
                    return;
                }
        }
    } else if (pollCheck) {
        let tooMuch = [];
        if (pollCheck.poll.options.description.length > 80) tooMuch.push(`**${client.translate.get(pollCheck.lang, "Events.messageReactionAdd.title")}**: ${pollCheck.poll.options.description}`)
        pollCheck.poll.voteOptions.name.filter(e => e).forEach((e, i) => {
            i++
            if (e.length > 70) {
                tooMuch.push(`**${i}.** ${e}`)
            }
        });

        let convert = emojis.findIndex(e => e.name === emojiId);
        if (convert === 10 && pollCheck.owner === userId) {
          await PollDB.findOneAndDelete({ messageId: message.messageId });
          await pollCheck.poll.update();
           const pollImage = await fetch(`${process.env.CDN}/api/upload`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              apikey: process.env.CDN_KEY,
              image: pollCheck.poll.canvas.toDataURL('image/png'),
              timeframe: pollCheck.poll.time,
              messageId: message.messageId,
              last: true
            })
          }).then((i) => i.json())
            
          
          const newMsg = await (await client.channels.resolve(pollCheck.channelId))?.messages?.fetch(pollCheck.messageId)
          newMsg.edit({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(pollCheck.lang, "Events.messageReactionAdd.owner")} (<@${pollCheck.owner}>) ${client.translate.get(pollCheck.lang, "Events.messageReactionAdd.end")}:`).setImage(`${process.env.CDN}${pollImage.url}`).setColor(`#A52F05`)]}).catch(() => { });
          return client.polls.delete(message.messageId);
        } else if (convert === 0 && convert !== 10 || convert !== -1 && convert !== 10) {
          if (client.reactions.get(userId)) return client.users.get(userId)?.createDM().then(dm => dm.send(client.translate.get(pollCheck.lang, "Events.messageReactionAdd.tooFast"))).catch(() => { });
          if (pollCheck.users.includes(userId)) return;
          pollCheck.users.push(userId);
          const user = (client.users.cache.get(userId)) || (await client.users.fetch(userId));
          await pollCheck.poll.addVote(convert, userId, user.displayAvatarURL({ size: 256, format: 'png' }), message.messageId);
            
          let tooMuch = [];
          if (pollCheck.poll.options.description.length > 80) tooMuch.push(`**${client.translate.get(pollCheck.language, "Events.messageReactionRemove.title")}**: ${pollCheck.poll.options.description}`)
          pollCheck.poll.voteOptions.name.filter(e => e).forEach((e, i) => {
            i++
            if (e.length > 70) {
              tooMuch.push(`**${i}.** ${e}`)
            }
          });
          
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
        const db = await Giveaways.findOne({ messageId: message.messageId });
        if (db) {
            if (emojiId === client.config.emojis.confetti && db && !db.ended) {
                if (client.reactions.get(userId)) return;
                if (db.users.find(u => u.userID === userId)) return;
                db.users.push({ userID: userId });
                db.picking.push({ userID: userId });
                db.save();

                client.reactions.set(userId, Date.now() + 3000)
                setTimeout(() => client.reactions.delete(userId), 3000)

                client.users.get(userId)?.createDM().then(dm => dm.send(`${client.translate.get(db.lang, "Events.messageReactionAdd.joined")} [${db.prize}](https://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId})!\n${client.translate.get(db.lang, "Events.messageReactionAdd.joined2")} **${db.users.length}** ${client.translate.get(db.lang, "Events.messageReactionAdd.joined3")}`)).catch(() => { });
            } else if (emojiId === client.config.emojis.stop && db && db.owner === userId && !db.ended) {
                let endDate = Date.now();

                if (db.users.length === 0) {
                    const noUsers = new EmbedBuilder()
                      .setColor("#A52F05")
                      .setTitle(db.prize)
                      .setDescription(`${client.translate.get(db.lang, "Events.messageReactionAdd.early")}\n${client.translate.get(db.lang, "Events.messageReactionAdd.endNone")}!\n\n${client.translate.get(db.lang, "Events.messageReactionAdd.ended")}: <t:${Math.floor((endDate) / 1000)}:R>\n${client.translate.get(db.language, "Commands.giveaway.hosted")}: <@${db.owner}>\n${client.translate.get(db.lang, "Events.messageReactionAdd.winnersNone")}${db.requirement ? `\n\n${client.translate.get(db.lang, "Events.messageReactionAdd.reqs")}:\n${db.requirement}` : ``}`)

                    await db.updateOne({ ended: true, endDate: endDate })
                    await db.save();
                    const foundMsg = await (await client.channels.resolve(db.channelId))?.messages?.fetch(db.messageId);
                    return foundMsg?.edit({ embeds: [noUsers] });
                }

                for (let i = 0; i < db.winners; i++) {
                    let winner = db.picking[Math.floor(Math.random() * db.picking.length)];
                    if (winner) {
                        const filtered = db.picking.filter(object => object.userID != winner.userID)
                        db.picking = filtered;
                        db.pickedWinners.push({ id: winner.userID })
                    }
                }

                await db.updateOne({ ended: true, endDate: endDate })
                await db.save();

                const noUsers = new EmbedBuilder()
                  .setColor("#A52F05")
                  .setTitle(db.prize)
                  .setDescription(`${client.translate.get(db.lang, "Events.messageReactionAdd.early")}\n\n${client.translate.get(db.lang, "Events.messageReactionAdd.ended")}: <t:${Math.floor((endDate) / 1000)}:R>\n${client.translate.get(db.language, "Commands.giveaway.hosted")}: <@${db.owner}>\n${client.translate.get(db.lang, "Events.messageReactionAdd.partici")}: ${db.users.length}\n${client.translate.get(db.lang, "Events.messageReactionAdd.winners")}: ${db.pickedWinners.length > 0 ? db.pickedWinners.map(w => `<@${w.id}>`).join(", ") : client.translate.get(db.lang, "Events.messageReactionAdd.none")}${db.requirement ? `\n${client.translate.get(db.lang, "Events.messageReactionAdd.reqs")}: ${db.requirement}` : ``}`)
                
                const foundChannel = await client.channels.resolve(db.channelId);
                const foundMsg = await foundChannel?.messages?.fetch(db.messageId);
                foundMsg.edit({ embeds: [noUsers] }).catch(() => { });
                foundChannel.send({ content: `${client.translate.get(db.lang, "Events.messageReactionAdd.congrats")} ${db.pickedWinners.map(w => `<@${w.id}>`).join(", ")}! ${client.translate.get(db.lang, "Events.messageReactionAdd.youWon")} **${db.prize}**\nhttps://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId}` }).catch(() => {})
              
                client.reactions.set(userId, Date.now() + 3000)
                setTimeout(() => client.reactions.delete(userId), 3000)
            }
        } else {
            let emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
            const db2 = await client.database.getGuild(message.guildId, true)
            if (db2 && db2.roles.find(e => e.msgId === message.messageId) && db2.roles.find(e => e.roles.find(e => e.emoji === emote))) {
                if (client.reactions.get(userId)) return;

                const roles = [];
                db2.roles.find(e => e.msgId === message.messageId).roles.map(e => roles.push(e));
                const role = roles.find(e => e.emoji === emote);
                const member = await (client.guilds.get(message.guildId) || await client.guilds.fetch(message.guildId))?.fetchMember(userId);
                if (!member) return;

                let error = false;
                if (member.roles.cache.has(role.role)) return;

                client.reactions.set(userId, Date.now() + 1500);
                setTimeout(() => client.reactions.delete(userId), 1500);

                await member.roles.add(role.role).catch(() => { error = true })

                const guild = await client.guilds.get(message.guildId);
                if (error && db2.dm) {
                    member?.user?.createDM().then((dm) => { dm.send(`**[${guild.name}]** ${client.translate.get(db2.language, "Events.messageReactionAdd.noPerms").replace("{role}", `**${role.name}**`)}!`) }).catch(() => { });
                } else if (db2.dm) {
                    member?.user?.createDM().then((dm) => { dm.send(`**[${guild.name}]** ${client.translate.get(db2.language, "Events.messageReactionAdd.success").replace("{role}", `**${role.name}**`)}!`) }).catch(() => { });
                }
            }
        }
    }
}
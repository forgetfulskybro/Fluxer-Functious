const { EmbedBuilder } = require("@fluxerjs/core");
const PollDB = require("../models/polls");

const emojis = [
    { name: "1️⃣", id: 0 }, { name: "2️⃣", id: 1 }, { name: "3️⃣", id: 2 },
    { name: "4️⃣", id: 3 }, { name: "5️⃣", id: 4 }, { name: "6️⃣", id: 5 },
    { name: "7️⃣", id: 6 }, { name: "8️⃣", id: 7 }, { name: "9️⃣", id: 8 },
    { name: "🔟", id: 9 }, { name: "🛑", id: "stop" }
];

module.exports = async (client, message, userId, pollCheck, reactionMsg, emojiId) => {
    const convert = emojis.findIndex(e => e.name === emojiId);

    if (convert === 10 && pollCheck.owner === userId) {
        await PollDB.findOneAndDelete({ messageId: message.messageId });
        await pollCheck.poll.update();

        const pollImage = await fetch(`${process.env.CDN}/api/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apikey: process.env.CDN_KEY,
                image: pollCheck.poll.canvas.toDataURL('image/png'),
                timeframe: pollCheck.poll.time,
                messageId: message.messageId,
                last: true
            })
        }).then(r => r.json());

        await reactionMsg?.edit({
            embeds: [new EmbedBuilder()
                .setDescription(`${client.translate.get(pollCheck.lang, "Events.messageReactionAdd.owner")} (<@${pollCheck.owner}>) ${client.translate.get(pollCheck.lang, "Events.messageReactionAdd.end")}:`)
                .setImage(`${process.env.CDN}${pollImage.url}`)
                .setColor("#A52F05")]
        }).catch(() => {});

        return client.polls.delete(message.messageId);
    }

    if (convert >= 0 && convert !== 10) {
      const used = client.reactions.get(userId);
      if (used) {
        if (client.timeout.get(userId)) return;
        client.timeout.set(userId, 5000);
        setTimeout(() => client.timeout.delete(userId), 5000);
        
        return client.users.get(userId)?.createDM().then(dm => dm.send(client.translate.get(pollCheck.lang, "Events.messageReactionAdd.tooFast"))).catch(() => {});
      }

      if (pollCheck.users.find((u) => u.user === userId)) return;
      if (pollCheck.users.find((u) => u.user === userId) && pollCheck.users.find((u) => u.user === userId).option !== convert) return;

      client.reactions.set(userId, Date.now() + 5000);
      setTimeout(() => client.reactions.delete(userId), 5000);
        
      pollCheck.users.push({ user: userId, option: convert });
      const fetchedUser = await client.users.fetch(userId);
      await pollCheck.poll.addVote(
        convert,
        userId,
        fetchedUser.displayAvatarURL?.({ size: 256, format: 'png' }) ?? fetchedUser.avatarURL ?? "/assets/default-avatar.png",
        message.messageId
      );

        let tooMuch = [];
        if (pollCheck.poll.options.description.length > 80)
            tooMuch.push(`**${client.translate.get(pollCheck.lang, "Events.messageReactionAdd.title")}**: ${pollCheck.poll.options.description}`);

        pollCheck.poll.voteOptions.name.filter(e => e).forEach((e, i) => {
            i++;
            if (e.length > 70) tooMuch.push(`**${i}.** ${e}`);
        });

        const pollImage = await fetch(`${process.env.CDN}/api/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apikey: process.env.CDN_KEY,
                image: pollCheck.poll.canvas.toDataURL('image/png'),
                timeframe: pollCheck.poll.time,
                messageId: message.messageId
            })
        }).then(r => r.json());

        await reactionMsg?.edit({
            embeds: [new EmbedBuilder()
                .setDescription(`${tooMuch.length ? tooMuch.join("\n") : ""}\n_ _`)
                .setImage(`${process.env.CDN}${pollImage.url}`)
                .setColor("#A52F05")]
        }).catch(() => {});
    }
};

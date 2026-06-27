const { EmbedBuilder } = require('@erinjs/core');
const PollDB = require("../models/polls");
const Canvas = require('canvas');

class Polls {
    constructor({ time, client, name, options, users, avatars, votes, owner, lang }) {
        this.client = client;
        this.time = time;
        if (votes) this.votes = votes;
        else this.votes = options.name.length === 2 ? [0, 0] : options.name.length === 3 ? [0, 0, 0] : options.name.length === 4 ? [0, 0, 0, 0] : options.name.length === 5 ? [0, 0, 0, 0, 0] : options.name.length === 6 ? [0, 0, 0, 0, 0, 0] : options.name.length === 7 ? [0, 0, 0, 0, 0, 0, 0] : options.name.length === 8 ? [0, 0, 0, 0, 0, 0, 0, 0] : options.name.length === 9 ? [0, 0, 0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        this.users = users || [];
        this.avatars = avatars || [];
        this.options = { name: name.name, description: name.description };
        this.voteOptions = options;
        this.owner = owner;
        this.lang = lang;
        this.size = { canvas: options.name.length === 2 ? 200 : options.name.length === 3 ? 250 : options.name.length === 4 ? 300 : options.name.length === 5 ? 350 : options.name.length === 6 ? 400 : options.name.length === 7 ? 450 : options.name.length === 8 ? 500 : options.name.length === 9 ? 550 : 600, bar: options.name.length === 2 ? 150 : options.name.length === 3 ? 200 : options.name.length === 4 ? 250 : options.name.length === 5 ? 300 : options.name.length === 6 ? 350 : options.name.length === 7 ? 400 : options.name.length === 8 ? 450 : options.name.length === 9 ? 500 : 550 };
        this.voteQueue = [];
        this.processing = false;
        this.debounceTimer = null;
        this.debounceDelay = 500;
    }

    async start(message, poll, first = false) {
        this.client.polls.set(message.id, { poll, messageId: message.id, channelId: message.channelId, serverId: message.guildId, owner: this.owner })

        if (first) {
          const pollImage = await fetch(`${process.env.CDN}/api/upload`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              apikey: process.env.CDN_KEY,
              image: poll.canvas.toDataURL('image/png'),
              timeframe: poll.time,
              messageId: message.id,
            })
          }).then((i) => i.json())

          message.edit({ embeds: [new EmbedBuilder().setDescription(`${this.client.translate.get(this.lang, "Commands.giveaway.time")}: <t:${Math.floor((this.time + Date.now()) / 1000)}:R>${first.tooMuch.length > 0 ? `\n\n${first.tooMuch.map(e => e).join("\n")}` : ""}`).setImage(`${process.env.CDN}${pollImage.url}`).setColor(`#A52F05`)] }).catch(() => { })
        }

        if (this.time < 0) return;
        const savedPoll = await (new PollDB({
          owner: this.owner,
          serverId: message.guildId,
          channelId: message.channelId,
          messageId: message.id,
          avatars: this.avatars,
          users: this.users,
          votes: this.votes,
          name: this.options.name,
          desc: this.options.description,
          options: this.voteOptions,
          time: this.time,
          lang: this.lang,
          now: Date.now(),
        }).save());
        return savedPoll;
    }

    textHeight(text, ctx, m) {
        let metrics = m || ctx.measureText(text);
        return metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    }

    roundRect(ctx, x, y, width, height, radius, fill, stroke) {
        if (typeof stroke === 'undefined') {
            stroke = true;
        }
        if (typeof radius === 'undefined') {
            radius = 5;
        }
        if (typeof radius === 'number') {
            radius = { tl: radius, tr: radius, br: radius, bl: radius };
        } else {
            var defaultRadius = { tl: 0, tr: 0, br: 0, bl: 0 };
            for (var side in defaultRadius) {
                radius[side] = radius[side] || defaultRadius[side];
            }
        }
        ctx.beginPath();
        ctx.moveTo(x + radius.tl, y);
        ctx.lineTo(x + width - radius.tr, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
        ctx.lineTo(x + width, y + height - radius.br);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
        ctx.lineTo(x + radius.bl, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
        ctx.lineTo(x, y + radius.tl);
        ctx.quadraticCurveTo(x, y, x + radius.tl, y);
        ctx.closePath();
        if (fill) {
            ctx.fill();
        }
        if (stroke) {
            ctx.stroke();
        }
    }

    async update() {
        let roundRect = this.roundRect;
        let textHeight = this.textHeight;

        var width = 600, height = this.size.canvas, padding = 10;
        const canvas = Canvas.createCanvas(width, height);
        this.canvas = canvas;
        const ctx = this.canvas.getContext('2d');
        this.ctx = ctx;

        let name = this.options.name?.length > 70 ? this.options?.name.slice(0, 67) + "..." : this.options.name;
        var nameHeight = textHeight(name, ctx);

        let description = this.options.description.length > 80 ? this.options.description.slice(0, 77) + "..." : this.options.description;
        var descHeight = textHeight(description, ctx);

        ctx.fillStyle = "#23272A";
        roundRect(ctx, 0, 0, width, height, 5, true, false); // background

        //ctx.fillStyle = "#4E535A";
        //ctx.font = `normal 12px Sans-Serif`;
        //ctx.fillText(name, padding, padding + 2 + nameHeight / 2); // name

        ctx.fillStyle = "#FFFFFF";
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
      
        ctx.font = '17px Arial, "Noto Sans", "DejaVu Sans", sans-serif';
        ctx.fillText(description, padding, padding + 15 + nameHeight + descHeight / 2); // description

        var headerHeight = padding + descHeight + nameHeight + 15;
        var dataWidth = width - padding * 2;
        var barHeight = 40;
        var votes = this.votes;
        var names = this.voteOptions.name;

        this.drawVoteBars(ctx, dataWidth - 20, barHeight, votes, { pad: padding, hHeight: headerHeight }, names);
        await this.drawFooter(ctx, padding, padding + headerHeight + barHeight * 2 + 20, width, height, padding, this.avatars);
    }

    addVote(option, user, avatar, id) {
        return new Promise((resolve, reject) => {
            this.voteQueue.push({
                resolve,
                reject,
                type: 'add',
                args: [option, user, avatar, id]
            });
            this.scheduleFlush();
        });
    }

    removeVote(option, user, id) {
        return new Promise((resolve, reject) => {
            this.voteQueue.push({
                resolve,
                reject,
                type: 'remove',
                args: [option, user, id]
            });
            this.scheduleFlush();
        });
    }

    scheduleFlush() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => this.flush(), this.debounceDelay);
    }

    async flush() {
        if (this.processing) return;
        this.processing = true;
        this.debounceTimer = null;

        const batch = [];
        while (this.voteQueue.length > 0) {
            batch.push(this.voteQueue.shift());
        }

        if (batch.length === 0) {
            this.processing = false;
            return;
        }

        for (const item of batch) {
            try {
                if (item.type === 'add') {
                    const [option, user, avatar, id] = item.args;
                    this.votes[option]++;
                    await PollDB.findOneAndUpdate({ messageId: id }, { $push: { users: { user: user, option: option, avatar: avatar } }, $inc: { [`votes.${option}`]: 1 } });
                } else if (item.type === 'remove') {
                    const [option, user, id] = item.args;
                    this.votes[option]--;
                    await PollDB.findOneAndUpdate({ messageId: id }, { $pull: { users: { user: user, option: option } }, $inc: { [`votes.${option}`]: -1 } });
                }
            } catch (err) {
                item.reject(err);
            }
        }

        await this.update();

        for (const item of batch) {
            if (item.resolve) item.resolve(this.canvas);
        }

        this.processing = false;

        if (this.voteQueue.length > 0) {
            this.scheduleFlush();
        }
    }

    drawVoteBars(ctx, width, height, votes, vars, names, vote) {
        let roundRect = this.roundRect;
        let textHeight = this.textHeight;
        let padding = vars.pad;
        let headerHeight = vars.hHeight;
        let sum = votes.reduce((prev, curr) => prev + curr);
        let percentages = votes.map((v) => Math.floor(v / (sum / 100) * 10) / 10);
        ctx.save();
        ctx.translate(padding, padding + headerHeight);

        var barPadding = 5;
        percentages.forEach((percentage, i) => {
            if (!percentage) percentage = 0;
            let paddingLeft = (vote != undefined) ? 30 : 0;

            ctx.fillStyle = "#2C2F33";
            let y = (height + 10) * i;
            roundRect(ctx, 20, y, width, height, 5, true, false);

            if (vote == i || percentage) { ctx.fillStyle = "#A52F05"; }
            else { ctx.fillStyle = "#24282B"; } // percentage display
            roundRect(ctx, 20, y, width * (votes[i] / (sum / 100) / 100), height, 5, true, false);

            ctx.fillStyle = "#4E535A";
            let h = textHeight(i + 1, ctx);
            ctx.fillText(i + 1, 0, y + height / 2 + h / 2);

            ctx.fillStyle = "#FFFFFF";
            h = textHeight(names[i], ctx);
            const nameText = names[i].length > 65 ? names[i].slice(0, 62) + "..." : names[i];
            ctx.fillText(nameText, 30 + paddingLeft, y + height / 2 + h / 2);

            if (vote != undefined) {
                ctx.strokeStyle = "#FFFFFF"; 
                ctx.fillStyle = "#717cf4";
                ctx.beginPath();
                ctx.arc(35, y + height / 2, 6, 0, 2 * Math.PI);
                ctx.closePath();
                ctx.stroke();
                if (vote == i) {
                    ctx.beginPath();
                    ctx.arc(35, y + height / 2, 3, 0, 2 * Math.PI);
                    ctx.closePath();
                    ctx.fill();
                }
            }

            ctx.fillStyle = "#2C2F33";
            const percText = percentage + "% (" + votes[i] + ")";
            let metrics = ctx.measureText(percText);
            let percW = metrics.width;
            let percH = textHeight(percText, ctx, metrics);

            const barCenterY = y + height / 2;
            const textY = barCenterY + percH / 2;
            const bgY = textY - percH - 4;
            const bgHeight = percH + 12;

            if (vote == i || vote == undefined) 
                roundRect(ctx, width - barPadding - percW - 3, bgY, percW + 5, bgHeight, 5, true, false);

            ctx.fillStyle = "#A52F05";
            ctx.fillText(percText, width - barPadding - percW, textY);
        });
        ctx.restore();
    }

    async drawFooter(ctx, x, y, width, height, padding, users) {
        ctx.save();
        ctx.translate(10, this.size.bar);

        var rad = 18;
        ctx.fillStyle = "#4E535A";
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#4E535A";
        ctx.beginPath();
        ctx.moveTo(0 - padding, 0);
        ctx.lineTo(width, 0);
        ctx.stroke();

        let votes = (this.votes.reduce((p, c) => p + c) == 1) ? `${this.votes.reduce((p, c) => p + c)} vote` : `${this.votes.reduce((p, c) => p + c)} votes`;
        let metrics = ctx.measureText(votes);
        let h = this.textHeight(votes, ctx, metrics);
        ctx.fillText(votes, 5, rad + h);

        // Avatars
        const avatars = this.users.map(u => u.avatar).filter(a => a).slice(0, 15);
        var pos = rad * avatars.length + 10 + metrics.width;
        var yPos = 6;
        avatars.reverse();
        for (let i = 0; i < avatars.length; i++) {
            ctx.beginPath();
            const avatarURL = avatars[i];

            const a = Canvas.createCanvas(rad * 2, rad * 2);
            const context = a.getContext("2d");

            context.beginPath();
            context.arc(rad, rad, rad, 0, Math.PI * 2, true);
            context.closePath();
            context.clip();

            const loadedAvatar = await Canvas.loadImage(avatarURL);
            context.drawImage(loadedAvatar, 0, 0, rad * 2, rad * 2);
            ctx.drawImage(a, pos, yPos);

            ctx.closePath();
            pos -= rad;
        }
    }
}

module.exports = Polls;
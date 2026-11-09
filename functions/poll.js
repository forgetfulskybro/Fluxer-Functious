const { EmbedBuilder } = require('@fluxerjs/core');
const PollDB = require("../models/polls");
const Canvas = require('canvas');

const FONT = 'Arial';
const COLORS = {
  background: '#23272A',
  panel: '#2C2F33',
  accent: '#A52F05',
  text: '#FFFFFF',
  muted: '#9AA0A6',
};
const CANVAS_WIDTH = 600;
const HEADER_BASE_X = 10;
const HEADER_BASE_Y = 34;
const BARS_BASE_X = 10;
const BARS_BASE_Y = 48;
const BAR_WIDTH = 560;
const BAR_HEIGHT = 40;
const BAR_GAP = 10;
const BARS_PANEL_X = 20;
const FOOTER_BASE_X = 10;
const FOOTER_BASE_HEIGHT = 44;
const QUESTION_SIZE = 17;
const OPTION_SIZE = 17;
const FOOTER_SIZE = 17;
const RADIUS = 8;
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 10;

function pollCanvasHeight(optionCount) {
  const numeric = Number(optionCount);
  const count = Number.isFinite(numeric)
    ? Math.max(MIN_POLL_OPTIONS, Math.min(MAX_POLL_OPTIONS, Math.round(numeric)))
    : MIN_POLL_OPTIONS;
  return Math.min(600, 200 + Math.max(0, count - MIN_POLL_OPTIONS) * 50);
}

function fitText(ctx, text, maxWidth) {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${text.slice(0, mid)}...`;
    if (ctx.measureText(candidate).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low)}...`;
}

function wrapText(ctx, text, maxWidth, maxLines) {
  if (maxWidth <= 0) return [];
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  const fitted = lines.map((line) => fitText(ctx, line, maxWidth));
  const limit = Math.max(1, maxLines);
  if (fitted.length <= limit) return fitted;

  const visible = fitted.slice(0, limit);
  if (!visible[limit - 1].endsWith('...')) {
    visible[limit - 1] = fitText(ctx, `${visible[limit - 1]}...`, maxWidth);
  }
  return visible;
}

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
    const optionCount = Array.isArray(options.name) ? options.name.length : 2;
    this.size = { canvas: pollCanvasHeight(optionCount) };
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

      message.edit({ embeds: [new EmbedBuilder().setDescription(`${this.client.translate.get(this.lang, "Commands.giveaway.time")}: <t:${Math.floor((this.time + Date.now()) / 1000)}:R>${first.tooMuch.length > 0 ? `\n\n${first.tooMuch.map(e => e).join("\n")}` : ""}`).setImage(`${process.env.CDN}${pollImage.url}`).setColor("#A52F05")] }).catch(() => { })
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
    const clamped = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + clamped, y);
    ctx.lineTo(x + width - clamped, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + clamped);
    ctx.lineTo(x + width, y + height - clamped);
    ctx.quadraticCurveTo(x + width, y + height, x + width - clamped, y + height);
    ctx.lineTo(x + clamped, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - clamped);
    ctx.lineTo(x, y + clamped);
    ctx.quadraticCurveTo(x, y, x + clamped, y);
    ctx.closePath();
    if (fill) {
      ctx.fill();
    }
    if (stroke) {
      ctx.stroke();
    }
  }

  async update() {
    const roundRect = this.roundRect;
    const width = CANVAS_WIDTH;
    const height = this.size.canvas;
    const canvas = Canvas.createCanvas(width, height);
    this.canvas = canvas;
    const ctx = this.canvas.getContext('2d');
    this.ctx = ctx;

    const description = this.options.description?.length > 80
      ? this.options.description.slice(0, 77) + '...'
      : this.options.description || '';

    ctx.fillStyle = COLORS.background;
    roundRect(ctx, 0, 0, width, height, RADIUS, true, false);

    ctx.fillStyle = COLORS.text;
    ctx.font = `normal ${QUESTION_SIZE}px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    const headerX = HEADER_BASE_X;
    const headerY = HEADER_BASE_Y;
    const headerWidth = width - HEADER_BASE_X * 2;
    const lineHeight = Math.round(QUESTION_SIZE * 1.3);
    const headerLines = wrapText(ctx, description, headerWidth, 1);
    ctx.textAlign = 'left';
    headerLines.forEach((line, index) => {
      ctx.fillText(line, headerX, headerY + index * lineHeight);
    });

    this.drawVoteBars(ctx, BAR_WIDTH, BAR_HEIGHT, this.votes, this.voteOptions.name);
    await this.drawFooter(ctx, width, height);
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

    try {
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
          item.rejected = true;
          item.reject(err);
        }
      }

      await this.update();

      for (const item of batch) {
        if (!item.rejected && item.resolve) item.resolve(this.canvas);
      }
    } catch (err) {
      for (const item of batch) {
        if (!item.rejected && item.reject) item.reject(err);
      }
    } finally {
      this.processing = false;

      if (this.voteQueue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  drawVoteBars(ctx, width, height, votes, names) {
    const { roundRect, textHeight } = this;
    const sum = votes.reduce((prev, curr) => prev + Number(curr || 0), 0);
    const percentages = votes.map((v) => sum > 0 ? Math.floor((Number(v || 0) / sum) * 1000) / 10 : 0);
    const optionFontSize = OPTION_SIZE;
    const detailFontSize = Math.max(10, Math.round(optionFontSize * 0.7));
    ctx.save();
    ctx.translate(BARS_BASE_X, BARS_BASE_Y);
    ctx.textAlign = 'left';
    ctx.font = `normal ${optionFontSize}px ${FONT}`;

    const barPadding = 5;
    const radius = Math.min(RADIUS, height / 2);
    percentages.forEach((percentage, i) => {
      const y = (height + BAR_GAP) * i;
      ctx.fillStyle = COLORS.panel;
      roundRect(ctx, BARS_PANEL_X, y, width, height, radius, true, false);

      const fillWidth = sum > 0 ? width * (Number(votes[i] || 0) / sum) : 0;
      if (fillWidth > 0) {
        ctx.fillStyle = COLORS.accent;
        roundRect(ctx, BARS_PANEL_X, y, fillWidth, height, radius, true, false);
      }

      ctx.fillStyle = COLORS.muted;
      ctx.font = `normal ${optionFontSize}px ${FONT}`;
      const rankHeight = textHeight(i + 1, ctx);
      ctx.fillText(i + 1, 0, y + height / 2 + rankHeight / 2);

      const parts = [
        `${percentage}%`,
        `(${Number(votes[i] || 0)})`,
      ];

      ctx.font = `normal ${detailFontSize}px ${FONT}`;
      const percText = parts.join(' ');
      const percMetrics = percText ? ctx.measureText(percText) : { width: 0 };
      const percW = percMetrics.width;
      const rightSpace = percText ? percW + 20 : 8;

      ctx.font = `normal ${optionFontSize}px ${FONT}`;
      const labelX = 30;
      const nameText = fitText(ctx, String(names[i] ?? ''), width - labelX - rightSpace);
      ctx.fillStyle = COLORS.text;
      const nameHeight = textHeight(nameText, ctx);
      ctx.fillText(nameText, labelX, y + height / 2 + nameHeight / 2);

      if (percText) {
        ctx.font = `normal ${detailFontSize}px ${FONT}`;
        const percH = textHeight(percText, ctx, percMetrics);
        const barCenterY = y + height / 2;
        const textY = barCenterY + percH / 2;
        const bgY = textY - percH - 4;
        const bgHeight = percH + 12;
        ctx.fillStyle = COLORS.panel;
        roundRect(ctx, width - barPadding - percW - 3, bgY, percW + 5, bgHeight, radius, true, false);
        ctx.fillStyle = COLORS.text;
        ctx.fillText(percText, width - barPadding - percW, textY);
      }
    });
    ctx.restore();
  }

  async drawFooter(ctx, width, height) {
    const rad = 18;
    ctx.save();
    ctx.translate(FOOTER_BASE_X, height - FOOTER_BASE_HEIGHT);
    ctx.textAlign = 'left';

    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.muted;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(width - 20, 0);
    ctx.stroke();

    let pos = 5;
    const total = this.votes.reduce((prev, curr) => prev + Number(curr || 0), 0);
    const totalText = `${total} ${total === 1 ? 'vote' : 'votes'}`;
    ctx.font = `normal ${FOOTER_SIZE}px ${FONT}`;
    ctx.fillStyle = COLORS.text;
    const metrics = ctx.measureText(totalText);
    const h = this.textHeight(totalText, ctx, metrics);
    ctx.fillText(totalText, 5, rad + h);
    pos = 5 + metrics.width + 12;

    const avatars = this.users.map((u) => u.avatar).filter((a) => a).slice(0, 12);
    for (const avatarURL of avatars) {
      const avatarCanvas = Canvas.createCanvas(rad * 2, rad * 2);
      const avatarCtx = avatarCanvas.getContext('2d');
      avatarCtx.fillStyle = COLORS.panel;
      avatarCtx.beginPath();
      avatarCtx.arc(rad, rad, rad, 0, Math.PI * 2);
      avatarCtx.closePath();
      avatarCtx.fill();

      try {
        const image = await Canvas.loadImage(avatarURL);
        avatarCtx.save();
        avatarCtx.beginPath();
        avatarCtx.arc(rad, rad, rad, 0, Math.PI * 2);
        avatarCtx.closePath();
        avatarCtx.clip();
        avatarCtx.drawImage(image, 0, 0, rad * 2, rad * 2);
        avatarCtx.restore();
      } catch {}

      ctx.drawImage(avatarCanvas, pos, 6);
      pos += rad * 2 + 4;
    }

    ctx.restore();
  }
}

module.exports = Polls;

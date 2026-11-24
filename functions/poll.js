const { EmbedBuilder } = require('@fluxerjs/core');
const PollDB = require("../models/polls");
const Canvas = require('canvas');

const FONT = 'Arial';

const THEMES = Object.freeze({
  ember: {
    name: 'Ember',
    background: '#23272A',
    panel: '#2C2F33',
    accent: '#A52F05',
    text: '#FFFFFF',
    muted: '#9AA0A6',
  },
  midnight: {
    name: 'Midnight',
    background: '#0F172A',
    panel: '#1E293B',
    accent: '#4F46E5',
    text: '#F8FAFC',
    muted: '#94A3B8',
  },
  ocean: {
    name: 'Ocean',
    background: '#082F49',
    panel: '#0C4A6E',
    accent: '#0369A1',
    text: '#F0F9FF',
    muted: '#7DD3FC',
  },
  forest: {
    name: 'Forest',
    background: '#13231A',
    panel: '#1E3A2A',
    accent: '#15803D',
    text: '#F0FDF4',
    muted: '#86EFAC',
  },
  sunset: {
    name: 'Sunset',
    background: '#2B1B2F',
    panel: '#432A48',
    accent: '#C2410C',
    text: '#FFF7ED',
    muted: '#FDBA74',
  },
  candy: {
    name: 'Candy',
    background: '#2A1722',
    panel: '#431F33',
    accent: '#BE185D',
    text: '#FFF1F5',
    muted: '#F9A8D4',
  },
  mono: {
    name: 'Mono',
    background: '#18181B',
    panel: '#27272A',
    accent: '#52525B',
    text: '#FAFAFA',
    muted: '#A1A1AA',
  },
});
const DEFAULT_THEME = 'ember';

const LAYOUTS = Object.freeze({
  bars: { name: 'Bars' },
  compact: { name: 'Compact' },
  cards: { name: 'Cards' },
  minimal: { name: 'Minimal' },
});
const DEFAULT_LAYOUT = 'bars';
const LAYOUT_ALIASES = {
  bar: 'bars',
  classic: 'bars',
  card: 'cards',
  grid: 'cards',
  thin: 'compact',
  list: 'minimal',
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
const FOOTER_GAP = 52;
const QUESTION_SIZE = 17;
const OPTION_SIZE = 17;
const FOOTER_SIZE = 17;
const RADIUS = 8;
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 10;
const OPTION_LABEL_X = 30;
const OPTION_DETAIL_SIZE = Math.max(10, Math.round(OPTION_SIZE * 0.7));
const OPTION_DETAIL_GAP = 20;
const OPTION_ZERO_DETAIL = '0% (0)';

const COMPACT_BASE_Y = 44;
const COMPACT_BAR_HEIGHT = 28;
const COMPACT_BAR_GAP = 8;
const COMPACT_OPTION_SIZE = 15;

const MINIMAL_BASE_Y = 44;
const MINIMAL_ROW_HEIGHT = 34;
const MINIMAL_OPTION_SIZE = 15;
const MINIMAL_DETAIL_SIZE = 12;

const CARDS_BASE_Y = 48;
const CARDS_MARGIN_X = 20;
const CARDS_CARD_WIDTH = 273;
const CARDS_CARD_HEIGHT = 64;
const CARDS_GAP_X = 14;
const CARDS_GAP_Y = 12;

const measureCanvas = Canvas.createCanvas(1, 1);
const measureCtx = measureCanvas.getContext('2d');
measureCtx.font = `normal ${QUESTION_SIZE}px ${FONT}`;

const optionMeasureCanvas = Canvas.createCanvas(1, 1);
const optionMeasureCtx = optionMeasureCanvas.getContext('2d');

function clampOptionCount(optionCount) {
  const numeric = Number(optionCount);
  return Number.isFinite(numeric)
    ? Math.max(MIN_POLL_OPTIONS, Math.min(MAX_POLL_OPTIONS, Math.round(numeric)))
    : MIN_POLL_OPTIONS;
}

function findTheme(value) {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;

  if (THEMES[raw]) return { key: raw, ...THEMES[raw] };

  const match = Object.entries(THEMES)
    .find(([, theme]) => theme.name.toLowerCase() === raw);
  return match ? { key: match[0], ...match[1] } : null;
}

function resolveTheme(value) {
  return findTheme(value) ?? { key: DEFAULT_THEME, ...THEMES[DEFAULT_THEME] };
}

function findLayout(value) {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;

  const key = LAYOUT_ALIASES[raw] ?? raw;
  if (LAYOUTS[key]) return { key, ...LAYOUTS[key] };

  const match = Object.entries(LAYOUTS)
    .find(([, layout]) => layout.name.toLowerCase() === raw);
  return match ? { key: match[0], ...match[1] } : null;
}

function resolveLayout(value) {
  return findLayout(value) ?? { key: DEFAULT_LAYOUT, ...LAYOUTS[DEFAULT_LAYOUT] };
}

function pollCanvasHeight(optionCount, layout = DEFAULT_LAYOUT) {
  const count = clampOptionCount(optionCount);

  switch (resolveLayout(layout).key) {
    case 'compact':
      return COMPACT_BASE_Y + count * (COMPACT_BAR_HEIGHT + COMPACT_BAR_GAP) + FOOTER_GAP;
    case 'minimal':
      return MINIMAL_BASE_Y + count * MINIMAL_ROW_HEIGHT + FOOTER_GAP;
    case 'cards':
      return CARDS_BASE_Y + Math.ceil(count / 2) * (CARDS_CARD_HEIGHT + CARDS_GAP_Y) + FOOTER_GAP;
    default:
      return Math.min(600, 200 + Math.max(0, count - MIN_POLL_OPTIONS) * 50);
  }
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

function titleFitsImage(text, poll) {
  if (poll && typeof poll.titleTruncated === 'boolean') return !poll.titleTruncated;

  const value = String(text ?? '').trim();
  if (!value) return true;
  if (value.length > 80) return false;

  const normalized = value.replace(/\s+/g, ' ');
  const [line] = wrapText(measureCtx, value, CANVAS_WIDTH - HEADER_BASE_X * 2, 1);
  return line === normalized;
}

function optionFitsImage(text, poll, index) {
  const flag = poll?.optionTruncated?.[index];
  if (typeof flag === 'boolean') return !flag;

  const value = String(text ?? '');
  if (!value) return true;

  optionMeasureCtx.font = `normal ${OPTION_DETAIL_SIZE}px ${FONT}`;
  const detailWidth = optionMeasureCtx.measureText(OPTION_ZERO_DETAIL).width;
  optionMeasureCtx.font = `normal ${OPTION_SIZE}px ${FONT}`;
  const maxWidth = BAR_WIDTH - OPTION_LABEL_X - (detailWidth + OPTION_DETAIL_GAP);
  return optionMeasureCtx.measureText(value).width <= maxWidth;
}

class Polls {
  constructor({ time, client, name, options, users, avatars, votes, owner, lang, theme, layout }) {
    this.client = client;
    this.time = time;
    if (votes) this.votes = votes;
    else this.votes = new Array(Array.isArray(options?.name) ? options.name.length : MIN_POLL_OPTIONS).fill(0);
    this.users = users || [];
    this.avatars = avatars || [];
    this.options = { name: name.name, description: name.description };
    this.voteOptions = options;
    this.owner = owner;
    this.lang = lang;

    const palette = resolveTheme(theme);
    this.palette = palette;
    this.themeKey = palette.key;
    this.layoutKey = resolveLayout(layout).key;

    const optionCount = Array.isArray(options.name) ? options.name.length : MIN_POLL_OPTIONS;
    this.size = { canvas: pollCanvasHeight(optionCount, this.layoutKey) };
    this.optionTruncated = [];
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

      message.edit({ embeds: [new EmbedBuilder().setDescription(`${this.client.translate.get(this.lang, "Commands.giveaway.time")}: <t:${Math.floor((this.time + Date.now()) / 1000)}:R>${first.tooMuch.length > 0 ? `\n\n${first.tooMuch.map(e => e).join("\n")}` : ""}`).setImage(`${process.env.CDN}${pollImage.url}`).setColor(this.palette.accent)] }).catch(() => { })
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
    const width = CANVAS_WIDTH;
    const height = this.size.canvas;
    const canvas = Canvas.createCanvas(width, height);
    this.canvas = canvas;
    const ctx = this.canvas.getContext('2d');
    this.ctx = ctx;

    const description = this.options.description?.length > 80
      ? this.options.description.slice(0, 77) + '...'
      : this.options.description || '';

    ctx.fillStyle = this.palette.background;
    this.roundRect(ctx, 0, 0, width, height, RADIUS, true, false);

    ctx.fillStyle = this.palette.text;
    ctx.font = `normal ${QUESTION_SIZE}px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    const headerX = HEADER_BASE_X;
    const headerY = HEADER_BASE_Y;
    const headerWidth = width - HEADER_BASE_X * 2;
    const lineHeight = Math.round(QUESTION_SIZE * 1.3);
    const headerLines = wrapText(ctx, description, headerWidth, 1);
    const fullDescription = String(this.options.description ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    this.titleTruncated =
      this.options.description?.length > 80 || (headerLines[0] ?? '') !== fullDescription;
    ctx.textAlign = 'left';
    headerLines.forEach((line, index) => {
      ctx.fillText(line, headerX, headerY + index * lineHeight);
    });

    this.optionTruncated = [];
    this.drawBody(ctx, width);
    await this.drawFooter(ctx, width, height);
  }

  drawBody(ctx, width) {
    switch (this.layoutKey) {
      case 'compact':
        return this.drawBars(ctx, BAR_WIDTH, {
          baseY: COMPACT_BASE_Y,
          barHeight: COMPACT_BAR_HEIGHT,
          gap: COMPACT_BAR_GAP,
          panelX: BARS_PANEL_X,
          radius: 6,
          optionSize: COMPACT_OPTION_SIZE,
          labelX: OPTION_LABEL_X,
        });
      case 'minimal':
        return this.drawMinimal(ctx, width);
      case 'cards':
        return this.drawCards(ctx, width);
      default:
        return this.drawBars(ctx, BAR_WIDTH, {
          baseY: BARS_BASE_Y,
          barHeight: BAR_HEIGHT,
          gap: BAR_GAP,
          panelX: BARS_PANEL_X,
          radius: RADIUS,
          optionSize: OPTION_SIZE,
          labelX: OPTION_LABEL_X,
        });
    }
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

  drawBars(ctx, barWidth, { baseY, barHeight, gap, panelX, radius, optionSize, labelX }) {
    const { textHeight, roundRect, palette } = this;
    const sum = this.votes.reduce((prev, curr) => prev + Number(curr || 0), 0);
    const percentages = this.votes.map((v) => sum > 0 ? Math.floor((Number(v || 0) / sum) * 1000) / 10 : 0);
    const detailSize = Math.max(9, Math.round(optionSize * 0.7));
    ctx.save();
    ctx.translate(BARS_BASE_X, baseY);
    ctx.textAlign = 'left';
    ctx.font = `normal ${optionSize}px ${FONT}`;

    const barPadding = 5;
    const clampedRadius = Math.min(radius, barHeight / 2);
    percentages.forEach((percentage, i) => {
      const y = (barHeight + gap) * i;
      ctx.fillStyle = palette.panel;
      roundRect(ctx, panelX, y, barWidth, barHeight, clampedRadius, true, false);

      const fillWidth = sum > 0 ? barWidth * (Number(this.votes[i] || 0) / sum) : 0;
      if (fillWidth > 0) {
        ctx.fillStyle = palette.accent;
        roundRect(ctx, panelX, y, fillWidth, barHeight, clampedRadius, true, false);
      }

      ctx.fillStyle = palette.muted;
      ctx.font = `normal ${optionSize}px ${FONT}`;
      const rankHeight = textHeight(i + 1, ctx);
      ctx.fillText(i + 1, 0, y + barHeight / 2 + rankHeight / 2);

      const percText = `${percentage}% (${Number(this.votes[i] || 0)})`;

      ctx.font = `normal ${detailSize}px ${FONT}`;
      const percMetrics = percText ? ctx.measureText(percText) : { width: 0 };
      const percW = percMetrics.width;
      const rightSpace = percText ? percW + 20 : 8;

      ctx.font = `normal ${optionSize}px ${FONT}`;
      const fullName = String(this.voteOptions.name[i] ?? '');
      const nameText = fitText(ctx, fullName, barWidth - labelX - rightSpace);
      this.optionTruncated[i] = nameText !== fullName;
      ctx.fillStyle = palette.text;
      const nameHeight = textHeight(nameText, ctx);
      ctx.fillText(nameText, labelX, y + barHeight / 2 + nameHeight / 2);

      if (percText) {
        ctx.font = `normal ${detailSize}px ${FONT}`;
        const ascent = Number(percMetrics.actualBoundingBoxAscent) || 0;
        const descent = Number(percMetrics.actualBoundingBoxDescent) || 0;
        const percH = ascent + descent;
        const barCenterY = y + barHeight / 2;
        const textY = barCenterY + (ascent - descent) / 2;
        const pillPadding = 4;
        const bgHeight = percH + pillPadding * 2;
        const bgY = barCenterY - bgHeight / 2;
        const bgX = barWidth - barPadding - percW - pillPadding;
        ctx.fillStyle = palette.panel;
        roundRect(ctx, bgX, bgY, percW + pillPadding * 2, bgHeight, Math.min(clampedRadius, bgHeight / 2), true, false);
        ctx.fillStyle = palette.text;
        ctx.fillText(percText, barWidth - barPadding - percW, textY);
      }
    });
    ctx.restore();
  }

  drawMinimal(ctx, width) {
    const { roundRect, palette } = this;
    const sum = this.votes.reduce((prev, curr) => prev + Number(curr || 0), 0);
    const percentages = this.votes.map((v) => sum > 0 ? Math.floor((Number(v || 0) / sum) * 1000) / 10 : 0);
    const left = OPTION_LABEL_X - BARS_BASE_X;
    const right = width - 20;

    ctx.save();
    ctx.translate(BARS_BASE_X, 0);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    percentages.forEach((percentage, i) => {
      const y = MINIMAL_BASE_Y + i * MINIMAL_ROW_HEIGHT;
      const textY = y + 15;
      const votes = Number(this.votes[i] || 0);
      const detail = `${percentage}% (${votes})`;

      ctx.fillStyle = palette.muted;
      ctx.font = `normal ${MINIMAL_OPTION_SIZE}px ${FONT}`;
      ctx.fillText(i + 1, 0, textY);

      ctx.font = `normal ${MINIMAL_DETAIL_SIZE}px ${FONT}`;
      const detailWidth = ctx.measureText(detail).width;
      const fullName = String(this.voteOptions.name[i] ?? '');
      const nameText = fitText(ctx, fullName, right - left - detailWidth - 16);
      this.optionTruncated[i] = nameText !== fullName;

      ctx.fillStyle = palette.text;
      ctx.font = `normal ${MINIMAL_OPTION_SIZE}px ${FONT}`;
      ctx.fillText(nameText, left, textY);

      ctx.fillStyle = palette.muted;
      ctx.font = `normal ${MINIMAL_DETAIL_SIZE}px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(detail, right, textY);
      ctx.textAlign = 'left';

      const trackY = y + 27;
      const trackWidth = right - left;
      ctx.fillStyle = palette.panel;
      roundRect(ctx, left, trackY, trackWidth, 4, 2, true, false);

      const fraction = sum > 0 ? votes / sum : 0;
      if (fraction > 0) {
        ctx.fillStyle = palette.accent;
        roundRect(ctx, left, trackY, trackWidth * fraction, 4, 2, true, false);
      }
    });

    ctx.restore();
  }

  drawCards(ctx, width) {
    const { roundRect, palette } = this;
    const sum = this.votes.reduce((prev, curr) => prev + Number(curr || 0), 0);
    const percentages = this.votes.map((v) => sum > 0 ? Math.floor((Number(v || 0) / sum) * 1000) / 10 : 0);
    const count = this.votes.length;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < count; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const lastOdd = count % 2 === 1 && i === count - 1;
      const cardWidth = lastOdd ? width - CARDS_MARGIN_X * 2 : CARDS_CARD_WIDTH;
      const x = lastOdd
        ? CARDS_MARGIN_X
        : CARDS_MARGIN_X + col * (CARDS_CARD_WIDTH + CARDS_GAP_X);
      const y = CARDS_BASE_Y + row * (CARDS_CARD_HEIGHT + CARDS_GAP_Y);

      ctx.fillStyle = palette.panel;
      roundRect(ctx, x, y, cardWidth, CARDS_CARD_HEIGHT, RADIUS, true, false);

      const percentage = `${percentages[i]}%`;
      ctx.font = `normal 16px ${FONT}`;
      ctx.fillStyle = palette.text;
      ctx.textAlign = 'right';
      ctx.fillText(percentage, x + cardWidth - 14, y + 24);

      const votes = Number(this.votes[i] || 0);
      ctx.font = `normal 11px ${FONT}`;
      ctx.fillStyle = palette.muted;
      ctx.fillText(`${votes} ${votes === 1 ? 'vote' : 'votes'}`, x + cardWidth - 14, y + 40);
      ctx.textAlign = 'left';

      ctx.font = `normal 12px ${FONT}`;
      ctx.fillStyle = palette.muted;
      ctx.fillText(String(i + 1), x + 14, y + 24);

      ctx.font = `normal 16px ${FONT}`;
      const percentageWidth = ctx.measureText(percentage).width;
      const fullName = String(this.voteOptions.name[i] ?? '');
      const labelX = x + 30;
      const nameText = fitText(ctx, fullName, cardWidth - 30 - 14 - percentageWidth - 12);
      this.optionTruncated[i] = nameText !== fullName;

      ctx.font = `normal 15px ${FONT}`;
      ctx.fillStyle = palette.text;
      ctx.fillText(nameText, labelX, y + 24);

      const trackX = x + 14;
      const trackY = y + CARDS_CARD_HEIGHT - 15;
      const trackWidth = cardWidth - 28;
      ctx.fillStyle = palette.background;
      roundRect(ctx, trackX, trackY, trackWidth, 5, 3, true, false);

      const fraction = sum > 0 ? votes / sum : 0;
      if (fraction > 0) {
        ctx.fillStyle = palette.accent;
        roundRect(ctx, trackX, trackY, trackWidth * fraction, 5, 3, true, false);
      }
    }

    ctx.restore();
  }

  async drawFooter(ctx, width, height) {
    const { roundRect, palette } = this;
    const rad = 18;
    ctx.save();
    ctx.translate(FOOTER_BASE_X, height - FOOTER_BASE_HEIGHT);
    ctx.textAlign = 'left';

    ctx.lineWidth = 2;
    ctx.strokeStyle = palette.muted;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(width - 20, 0);
    ctx.stroke();

    let pos = 5;
    const total = this.votes.reduce((prev, curr) => prev + Number(curr || 0), 0);
    const totalText = `${total} ${total === 1 ? 'vote' : 'votes'}`;
    ctx.font = `normal ${FOOTER_SIZE}px ${FONT}`;
    ctx.fillStyle = palette.text;
    const metrics = ctx.measureText(totalText);
    const h = this.textHeight(totalText, ctx, metrics);
    ctx.fillText(totalText, 5, rad + h);
    pos = 5 + metrics.width + 12;

    const avatars = this.users.map((u) => u.avatar).filter((a) => a).slice(0, 12);
    for (const avatarURL of avatars) {
      const avatarCanvas = Canvas.createCanvas(rad * 2, rad * 2);
      const avatarCtx = avatarCanvas.getContext('2d');
      avatarCtx.fillStyle = palette.panel;
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
module.exports.titleFitsImage = titleFitsImage;
module.exports.optionFitsImage = optionFitsImage;
module.exports.THEMES = THEMES;
module.exports.LAYOUTS = LAYOUTS;
module.exports.DEFAULT_THEME = DEFAULT_THEME;
module.exports.DEFAULT_LAYOUT = DEFAULT_LAYOUT;
module.exports.findTheme = findTheme;
module.exports.findLayout = findLayout;
module.exports.resolveTheme = resolveTheme;
module.exports.resolveLayout = resolveLayout;

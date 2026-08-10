const { RuntimeError } = require('./errors.js');

const NAMED_COLORS = {
  default: 0,
  white: 16777215,
  aqua: 1752220,
  green: 5763719,
  blue: 3447003,
  yellow: 16705372,
  purple: 10181046,
  pink: 15277667,
  fuchsia: 15418782,
  gold: 15844367,
  orange: 15105570,
  red: 15548997,
  grey: 9807270,
  gray: 9807270,
  navy: 3426654,
  darkaqua: 1146986,
  darkgreen: 2067276,
  darkblue: 2123412,
  darkpurple: 7419530,
  darkpink: 11342935,
  darkfuchsia: 11342935,
  darkgold: 12745742,
  darkorange: 11027200,
  darkred: 10038562,
  darkgrey: 9936031,
  darkgray: 9936031,
  darkerer: 8359053,
  darkernotquiteblack: 2303786,
  lightgrey: 12370112,
  lightgray: 12370112,
  blurple: 5793266,
  greyple: 10070709,
};

function parseColor(input) {
  if (typeof input === 'number') {
    const n = Math.trunc(input);
    if (n < 0 || n > 0xffffff) throw new RuntimeError(`color out of range (0-16777215): ${n}`);
    return n;
  }
  if (typeof input === 'string') {
    const s = input.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(s)) {
      return parseInt(s.replace('#', ''), 16);
    }
    if (/^#?[0-9a-fA-F]{8}$/.test(s)) {
      return parseInt(s.replace('#', '').slice(0, 6), 16);
    }
    const key = s.toLowerCase().replace(/[^a-z]/g, '');
    if (key in NAMED_COLORS) return NAMED_COLORS[key];
    throw new RuntimeError(`unknown color '${s}' (use a number, #RRGGBB, or a named color)`);
  }
  throw new RuntimeError(`invalid color: ${input}`);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const LIMITS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  footer: 2048,
  author: 256,
};

class EmbedBuilder {
  constructor() {
    this.data = {};
    this._isFluxerEmbed = true;
  }

  title(value) {
    if (value === undefined) return this.data.title;
    this.data.title = String(value).slice(0, LIMITS.title);
    return this;
  }

  description(value) {
    if (value === undefined) return this.data.description;
    this.data.description = String(value).slice(0, LIMITS.description);
    return this;
  }

  color(value) {
    if (value === undefined) return this.data.color;
    this.data.color = parseColor(value);
    return this;
  }

  url(value) {
    if (value === undefined) return this.data.url;
    this.data.url = String(value);
    return this;
  }

  author(name, url, iconUrl) {
    if (name === undefined) return this.data.author;
    if (typeof name === 'object' && name !== null) {
      const a = { name: String(name.name ?? '').slice(0, LIMITS.author) };
      if (name.url != null) a.url = String(name.url);
      if (name.icon_url != null) a.icon_url = String(name.icon_url);
      if (name.iconUrl != null) a.icon_url = String(name.iconUrl);
      this.data.author = a;
    } else {
      const a = { name: String(name).slice(0, LIMITS.author) };
      if (url != null) a.url = String(url);
      if (iconUrl != null) a.icon_url = String(iconUrl);
      this.data.author = a;
    }
    return this;
  }

  thumbnail(url) {
    if (url === undefined) return this.data.thumbnail;
    this.data.thumbnail = { url: String(url) };
    return this;
  }

  image(url) {
    if (url === undefined) return this.data.image;
    this.data.image = { url: String(url) };
    return this;
  }

  footer(text, iconUrl) {
    if (text === undefined) return this.data.footer;
    const f = { text: String(text).slice(0, LIMITS.footer) };
    if (iconUrl != null) f.icon_url = String(iconUrl);
    this.data.footer = f;
    return this;
  }

  timestamp(value) {
    if (value === undefined) return this.data.timestamp;
    if (value instanceof Date) {
      this.data.timestamp = value.toISOString();
    } else if (typeof value === 'number') {
      this.data.timestamp = new Date(value).toISOString();
    } else {
      this.data.timestamp = String(value);
    }
    return this;
  }

  field(name, value, inline) {
    this.data.fields = this.data.fields || [];
    if (this.data.fields.length >= LIMITS.fields) {
      throw new RuntimeError(`embeds support at most ${LIMITS.fields} fields`);
    }
    this.data.fields.push({
      name: String(name).slice(0, LIMITS.fieldName),
      value: String(value).slice(0, LIMITS.fieldValue),
      inline: Boolean(inline),
    });
    return this;
  }

  addField(name, value, inline) {
    return this.field(name, value, inline);
  }

  addFields(fields) {
    if (Array.isArray(fields)) {
      for (const f of fields) {
        this.field(f.name, f.value, f.inline);
      }
      return this;
    }
    for (const arg of arguments) {
      this.field(arg.name, arg.value, arg.inline);
    }
    return this;
  }

  toJSON() {
    const out = {};
    for (const key of ['title', 'description', 'color', 'url', 'timestamp', 'author', 'thumbnail', 'image', 'footer', 'fields']) {
      if (this.data[key] !== undefined) out[key] = this.data[key];
    }
    if (out.fields && out.fields.length === 0) delete out.fields;
    return out;
  }

  toJson() {
    return this.toJSON();
  }

  toString() {
    const parts = [];
    if (this.data.title) parts.push(this.data.title);
    if (this.data.description) parts.push(this.data.description);
    if (this.data.fields) {
      for (const f of this.data.fields) parts.push(`${f.name}: ${f.value}`);
    }
    return parts.join('\n');
  }
}


for (const [method, setter] of [
  ['setTitle', 'title'],
  ['setDescription', 'description'],
  ['setColor', 'color'],
  ['setURL', 'url'],
  ['setAuthor', 'author'],
  ['setThumbnail', 'thumbnail'],
  ['setImage', 'image'],
  ['setFooter', 'footer'],
  ['setTimestamp', 'timestamp'],
  ['setFields', 'fields'],
]) {
  if (setter === 'fields') {
    EmbedBuilder.prototype[method] = function setFields(...fields) {
      this.data.fields = [];
      for (const f of fields) this.field(f.name, f.value, f.inline);
      return this;
    };
  } else {
    EmbedBuilder.prototype[method] = function (...args) {
      return this[setter](...args);
    };
  }
}

function embed() {
  return new EmbedBuilder();
}

module.exports = { EmbedBuilder, NAMED_COLORS, embed };
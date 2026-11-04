const fs = require("fs");
const path = require("path");
const config = require("../config");
const { getUserProfiles } = require("./userProfiles");

const LANGUAGES_DIR = path.join(__dirname, "..", "languages");
const BASE_LANGUAGE = "en_EN";
const LANGUAGE_REGEX = /^[a-z]{2}_[A-Z]{2}$/;

const LANGUAGE_META = {
  en_EN: { name: "English", native: "English" },
  ar_AR: { name: "Arabic", native: "العربية" },
  de_DE: { name: "German", native: "Deutsch" },
  es_ES: { name: "Spanish", native: "Español" },
  fr_FR: { name: "French", native: "Français" },
  pl_PL: { name: "Polish", native: "Polski" },
  pt_BR: { name: "Portuguese (Brazil)", native: "Português (Brasil)" },
  tr_TR: { name: "Turkish", native: "Türkçe" },
};

function discoverLanguages() {
  let codes = [];
  try {
    codes = fs
      .readdirSync(LANGUAGES_DIR)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length))
      .filter((code) => LANGUAGE_REGEX.test(code));
  } catch {
    codes = [];
  }

  if (!codes.includes(BASE_LANGUAGE)) codes.push(BASE_LANGUAGE);

  return codes.sort((a, b) =>
    a === BASE_LANGUAGE ? -1 : b === BASE_LANGUAGE ? 1 : a.localeCompare(b),
  );
}

function isLanguage(code) {
  return typeof code === "string" && LANGUAGE_REGEX.test(code) && discoverLanguages().includes(code);
}

function languageMeta(code) {
  const meta = LANGUAGE_META[code] ?? {};
  return {
    code,
    name: meta.name ?? code,
    native: meta.native ?? code,
    isBase: code === BASE_LANGUAGE,
  };
}

function readLanguageFile(code) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(LANGUAGES_DIR, `${code}.json`), "utf8"),
    );
  } catch {
    return null;
  }
}

function flatten(object, prefix = "", out = {}) {
  if (object === null || typeof object !== "object") {
    if (prefix) out[prefix] = object;
    return out;
  }

  for (const [key, value] of Object.entries(object)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") {
      flatten(value, next, out);
    } else {
      out[next] = value;
    }
  }

  return out;
}

function getBaseStrings() {
  return flatten(readLanguageFile(BASE_LANGUAGE) ?? {});
}

async function getBaseStringsWithDocs(client) {
  const baseStrings = { ...getBaseStrings() };
  let docs = [];

  try {
    docs = await client.database.translationModel
      .find({ language: BASE_LANGUAGE, status: "approved" })
      .lean();
  } catch {
    docs = [];
  }

  for (const doc of docs) {
    if (!doc || typeof doc.key !== "string") continue;
    if (typeof doc.value !== "string" || !doc.value.trim()) continue;
    baseStrings[doc.key] = doc.value;
  }

  return baseStrings;
}

function getStaticStrings(code) {
  return flatten(readLanguageFile(code) ?? {});
}

function clearLanguageFileCache() {
  let files = [];
  try {
    files = fs.readdirSync(LANGUAGES_DIR).filter((file) => file.endsWith(".json"));
  } catch {
    return 0;
  }

  let cleared = 0;
  for (const file of files) {
    try {
      const resolved = require.resolve(path.join(LANGUAGES_DIR, file));
      if (require.cache[resolved]) {
        delete require.cache[resolved];
        cleared++;
      }
    } catch {}
  }
  return cleared;
}

function serializeString(code, key, baseValue, staticStrings, docMap) {
  const base = typeof baseValue === "string" ? baseValue : String(baseValue ?? "");
  const category = key.split(".")[0];

  if (code === BASE_LANGUAGE) {
    return {
      key,
      category,
      baseValue: base,
      value: base,
      status: "approved",
      updatedAt: null,
      updatedBy: null,
      translatedBy: null,
      translatedAt: null,
      approvedAt: null,
      editedAt: null,
      previous: null,
      notes: [],
    };
  }

  const rawStatic = staticStrings[key];
  const staticValue = typeof rawStatic === "string" ? rawStatic : "";
  const doc = docMap.get(key) ?? null;
  const value = doc ? String(doc.value ?? "") : staticValue;

  let status;
  if (!value.trim() || value === base) status = "untranslated";
  else if (!doc) status = "approved";
  else if (doc.base !== base) status = "outdated";
  else status = doc.status === "approved" ? "approved" : "pending";

  return {
    key,
    category,
    baseValue: base,
    value,
    status,
    updatedAt: doc?.updatedAt ?? null,
    updatedBy: doc?.updatedBy ?? null,
    translatedBy:
      doc?.translatedBy ??
      (doc?.status !== "approved" ? doc?.updatedBy ?? null : null),
    translatedAt:
      doc?.translatedAt ??
      (doc?.status !== "approved"
        ? doc?.editedAt ?? doc?.updatedAt ?? null
        : null),
    editedAt: doc?.editedAt ?? doc?.updatedAt ?? null,
    approvedAt:
      doc?.approvedAt ?? (status === "approved" ? doc?.updatedAt ?? null : null),
    previous:
      doc?.previous && typeof doc.previous.value === "string" && doc.previous.value
        ? {
            value: doc.previous.value,
            status: doc.previous.status === "pending" ? "pending" : "approved",
            updatedAt: doc.previous.updatedAt ?? null,
          }
        : null,
    notes: (doc?.notes ?? []).map((note) => ({
      id: note.id,
      userId: note.userId,
      text: note.text,
      createdAt: note.createdAt,
    })),
  };
}

function buildStrings(code, baseStrings, staticStrings, docs) {
  const docMap = new Map(
    docs.filter((doc) => doc && typeof doc.key === "string").map((doc) => [doc.key, doc]),
  );

  return Object.keys(baseStrings).map((key) =>
    serializeString(code, key, baseStrings[key], staticStrings, docMap),
  );
}

function summarize(strings) {
  const total = strings.length;
  let translated = 0;
  let approved = 0;
  let pending = 0;
  let outdated = 0;
  let untranslated = 0;

  for (const string of strings) {
    if (string.status === "untranslated") {
      untranslated++;
      continue;
    }
    translated++;
    if (string.status === "approved") approved++;
    else if (string.status === "pending") pending++;
    else if (string.status === "outdated") outdated++;
  }

  const percent = total ? Math.round((translated / total) * 1000) / 10 : 0;
  const approvedPercent = total ? Math.round((approved / total) * 1000) / 10 : 0;

  return {
    total,
    translated,
    approved,
    pending,
    outdated,
    untranslated,
    percent,
    approvedPercent,
  };
}

async function getLanguageData(client, code) {
  if (!isLanguage(code)) return null;

  const baseStrings = await getBaseStringsWithDocs(client);
  const staticStrings = code === BASE_LANGUAGE ? {} : getStaticStrings(code);
  let docs = [];

  if (code !== BASE_LANGUAGE) {
    try {
      docs = await client.database.translationModel.find({ language: code }).lean();
    } catch {
      docs = [];
    }
  }

  const strings = buildStrings(code, baseStrings, staticStrings, docs);

  return {
    language: languageMeta(code),
    stats: summarize(strings),
    strings,
  };
}

async function getLanguageSummaries(client) {
  const codes = discoverLanguages();
  const baseStrings = await getBaseStringsWithDocs(client);
  let docs = [];

  try {
    docs = await client.database.translationModel
      .find({ language: { $ne: BASE_LANGUAGE } })
      .lean();
  } catch {
    docs = [];
  }

  const grouped = new Map();
  for (const doc of docs) {
    if (!grouped.has(doc.language)) grouped.set(doc.language, []);
    grouped.get(doc.language).push(doc);
  }

  return codes.map((code) => {
    const staticStrings = code === BASE_LANGUAGE ? {} : getStaticStrings(code);
    const strings = buildStrings(
      code,
      baseStrings,
      staticStrings,
      grouped.get(code) ?? [],
    );

    return {
      ...languageMeta(code),
      stats: summarize(strings),
    };
  });
}

function normalizePermissions(raw, isOwner) {
  const source = raw ?? {};
  const languages = Array.isArray(source.languages)
    ? [...new Set(source.languages.filter(isLanguage).filter((code) => code !== BASE_LANGUAGE))]
    : [];
  const requestedLanguages = Array.isArray(source.requestedLanguages)
    ? [...new Set(source.requestedLanguages.filter(isLanguage).filter((code) => code !== BASE_LANGUAGE))]
        .filter((code) => !languages.includes(code))
    : [];

  return {
    languages,
    requestedLanguages,
    proofreader: Boolean(source.proofreader) || isOwner,
    developer: Boolean(source.developer) || isOwner,
  };
}

function isOwner(userId) {
  return (config.owners ?? []).map(String).includes(String(userId));
}

async function getPermissions(client, userId) {
  if (!userId || !/^\d{17,20}$/.test(String(userId))) return null;

  const user = await client.database.getUser(String(userId), false);
  return {
    userId: String(userId),
    ...normalizePermissions(user?.translations, isOwner(userId)),
  };
}

function canTranslate(permissions, language) {
  if (!permissions) return false;
  return Boolean(permissions.developer) || permissions.languages.includes(language);
}

function canReview(permissions) {
  if (!permissions) return false;
  return Boolean(permissions.developer) || Boolean(permissions.proofreader);
}

async function getTranslators(client) {
  const owners = (config.owners ?? []).map(String);
  const users = await client.database.userModel
    .find({
      $or: [
        { "translations.languages.0": { $exists: true } },
        { "translations.requestedLanguages.0": { $exists: true } },
        { "translations.proofreader": true },
        { "translations.developer": true },
      ],
    })
    .lean();

  const byId = new Map(users.map((user) => [String(user.userId), user]));

  for (const ownerId of owners) {
    if (byId.has(ownerId)) continue;
    const user = await client.database.getUser(ownerId, false).catch(() => null);
    byId.set(
      ownerId,
      user ? (user.toObject ? user.toObject() : user) : { userId: ownerId, translations: {} },
    );
  }

  const ids = [...byId.keys()];
  const profiles = ids.length ? await getUserProfiles(client, ids) : {};

  let contributionRows = [];
  try {
    contributionRows = await client.database.translationModel.aggregate([
      { $match: { updatedBy: { $nin: [null, ""] } } },
      {
        $group: {
          _id: "$updatedBy",
          approved: {
            $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] },
          },
          total: { $sum: 1 },
        },
      },
    ]);
  } catch {
    contributionRows = [];
  }

  const contributions = new Map(
    contributionRows.map((row) => [String(row._id), { approved: row.approved, total: row.total }]),
  );

  return ids
    .map((userId) => {
      const user = byId.get(userId);
      const owner = owners.includes(userId);
      const permissions = {
        userId,
        ...normalizePermissions(user?.translations, owner),
      };
      const contributionsForUser = contributions.get(userId) ?? { approved: 0, total: 0 };

      return {
        userId,
        owner,
        permissions,
        profile: profiles[userId] ?? null,
        contributions: contributionsForUser,
      };
    })
    .sort((a, b) => {
      if (a.owner !== b.owner) return a.owner ? -1 : 1;
      if (a.permissions.developer !== b.permissions.developer) {
        return a.permissions.developer ? -1 : 1;
      }
      if (a.permissions.proofreader !== b.permissions.proofreader) {
        return a.permissions.proofreader ? -1 : 1;
      }
      const nameA = a.profile?.globalName || a.profile?.username || a.userId;
      const nameB = b.profile?.globalName || b.profile?.username || b.userId;
      return String(nameA).localeCompare(String(nameB));
    });
}

function setPath(object, key, value) {
  const parts = key.split(".");
  let current = object;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

function buildExportFile(data, includePending) {
  const out = {};

  for (const string of data.strings) {
    if (!string.value || string.value === string.baseValue) continue;
    if (string.status === "approved") {
      setPath(out, string.key, string.value);
    } else if (includePending && (string.status === "pending" || string.status === "outdated")) {
      setPath(out, string.key, string.value);
    }
  }

  return out;
}

module.exports = {
  BASE_LANGUAGE,
  discoverLanguages,
  isLanguage,
  languageMeta,
  readLanguageFile,
  flatten,
  getBaseStrings,
  getBaseStringsWithDocs,
  getStaticStrings,
  clearLanguageFileCache,
  getLanguageData,
  getLanguageSummaries,
  getPermissions,
  normalizePermissions,
  canTranslate,
  canReview,
  isOwner,
  getTranslators,
  buildExportFile,
  summarize,
};

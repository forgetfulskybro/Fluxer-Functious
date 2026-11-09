const { Router } = require("express");
const { randomUUID } = require("crypto");
const { makeRequireApiKey } = require("../middleware");
const { createZip } = require("../../functions/createZip");
const { validateImageUrl } = require("../../functions/validateImageUrl");
const { getUserProfiles } = require("../../functions/userProfiles");
const {
  BASE_LANGUAGE,
  discoverLanguages,
  isLanguage,
  readLanguageFile,
  flatten,
  languageMeta,
  getBaseStringsWithDocs,
  getStaticStrings,
  clearLanguageFileCache,
  getLanguageData,
  buildLanguageData,
  getLanguageSummaries,
  getPermissions,
  normalizePermissions,
  canTranslate,
  canReview,
  canModerate,
  isOwner,
  getTranslators,
  buildExportFile,
} = require("../../functions/translationStore");

const MAX_VALUE_LENGTH = 6000;
const MAX_NOTE_LENGTH = 2000;
const BULK_WRITE_BATCH = 1000;
const BULK_ACTIONS = new Set([
  "approve",
  "unreview",
  "outdated",
  "untranslated",
  "seed",
  "note",
]);
const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

function placeholdersIn(value) {
  return new Set(
    (String(value ?? "").match(PLACEHOLDER_PATTERN) ?? []).map((token) =>
      token.slice(1, -1),
    ),
  );
}

function validatePlaceholders(baseValue, value) {
  const expected = placeholdersIn(baseValue);
  const actual = placeholdersIn(value);
  const missing = [...expected].filter((name) => !actual.has(name));
  const unexpected = [...actual].filter((name) => !expected.has(name));

  if (missing.length === 0 && unexpected.length === 0) return null;

  const details = [];
  if (missing.length > 0) {
    details.push(`missing ${missing.map((name) => `{${name}}`).join(", ")}`);
  }
  if (unexpected.length > 0) {
    details.push(
      `unexpected ${unexpected.map((name) => `{${name}}`).join(", ")}`,
    );
  }

  return `Keep the English placeholders unchanged: ${details.join("; ")}.`;
}

function storedTranslationStatus(doc, value, english) {
  if (!value.trim() || value === english) return "untranslated";
  if (!doc) return "approved";
  if (doc.base !== english) return "outdated";
  return doc.status === "approved" ? "approved" : "pending";
}

function userIdFrom(req) {
  return String(req.headers["x-user-id"] ?? "").trim();
}

function languageListFrom(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [
    ...new Set(
      raw
        .map((code) => String(code).trim())
        .filter((code) => code && code !== BASE_LANGUAGE && isLanguage(code)),
    ),
  ];
}

function permissionsPayload(permissions) {
  return {
    languages: permissions.languages,
    requestedLanguages: permissions.requestedLanguages,
    proofreader: permissions.proofreader,
    moderator: permissions.moderator,
    developer: permissions.developer,
  };
}

function translationsRouter(client, apiKey) {
  const router = Router();
  const requireApiKey = makeRequireApiKey(apiKey);
  const model = client.database.translationModel;

  async function requireUser(req, res) {
    const userId = userIdFrom(req);
    if (!userId) {
      res.status(401).json({ error: "You need to be signed in" });
      return null;
    }

    const permissions = await getPermissions(client, userId);
    if (!permissions) {
      res.status(401).json({ error: "You need to be signed in" });
      return null;
    }

    return permissions;
  }

  async function respondWithString(res, language, key) {
    const data = await getLanguageData(client, language);
    return res.json({
      ok: true,
      string: data?.strings.find((entry) => entry.key === key) ?? null,
      stats: data?.stats ?? null,
    });
  }

  async function ensureDocument(language, key, baseValue) {
    const existing = await model.findOne({ language, key });
    if (existing) return existing;

    const staticValue = getStaticStrings(language)[key] ?? "";
    return model.create({
      language,
      key,
      value: typeof staticValue === "string" ? staticValue : "",
      base: baseValue,
      status: "approved",
      updatedAt: 0,
    });
  }

  async function runBulkEdit(
    req,
    res,
    permissions,
    requestedLanguages,
    primaryLanguage,
  ) {
    const action = String(req.body?.action ?? "");
    if (!BULK_ACTIONS.has(action)) {
      return res.status(400).json({ error: "Invalid bulk action" });
    }

    const languageCodes = [...new Set(requestedLanguages)].filter(
      (code) => code !== BASE_LANGUAGE && isLanguage(code),
    );
    if (languageCodes.length === 0) {
      return res.status(404).json({ error: "Language not found" });
    }

    let note = "";
    let imageUrl = "";
    if (action === "note") {
      note = String(req.body?.note ?? "").trim();
      if (note.length > MAX_NOTE_LENGTH) {
        return res.status(400).json({ error: "Note is too long" });
      }

      try {
        imageUrl = await validateImageUrl(req.body?.imageUrl);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      if (!note && !imageUrl) {
        return res.status(400).json({ error: "Write a note first" });
      }
    }

    const docsPromise = Promise.resolve()
      .then(() =>
        model.find({ language: { $in: languageCodes } }).lean(),
      )
      .catch(() => []);
    const [baseStrings, existingDocs] = await Promise.all([
      getBaseStringsWithDocs(client),
      docsPromise,
    ]);

    const requestedKeys = Array.isArray(req.body?.keys)
      ? [...new Set(req.body.keys.map(String))]
      : Object.keys(baseStrings);
    const keys = requestedKeys.filter(
      (key) =>
        Object.prototype.hasOwnProperty.call(baseStrings, key) &&
        typeof baseStrings[key] === "string",
    );

    if (keys.length === 0) {
      return res.status(400).json({ error: "No strings selected" });
    }

    const docMap = new Map(
      (Array.isArray(existingDocs) ? existingDocs : [])
        .filter(
          (doc) =>
            doc &&
            typeof doc.language === "string" &&
            typeof doc.key === "string",
        )
        .map((doc) => [`${doc.language}\u0000${doc.key}`, doc]),
    );
    const ops = [];
    const skippedByLanguage = new Map(
      languageCodes.map((code) => [code, 0]),
    );
    const changedKeysByLanguage = new Map(
      languageCodes.map((code) => [code, new Set()]),
    );

    for (const code of languageCodes) {
      const staticStrings = getStaticStrings(code);
      const skipped = skippedByLanguage;
      const changedKeys = changedKeysByLanguage.get(code);

      for (const key of keys) {
        const english = String(baseStrings[key] ?? "");
        if (!english.trim()) {
          skipped.set(code, (skipped.get(code) ?? 0) + 1);
          continue;
        }

        const doc = docMap.get(`${code}\u0000${key}`);
        const stored = doc ? doc.value : staticStrings[key];
        const value = typeof stored === "string" ? stored : "";
        const status = storedTranslationStatus(doc, value, english);
        const now = Date.now();

        if (action === "note") {
          const staticValue =
            typeof staticStrings[key] === "string" ? staticStrings[key] : "";
          const insertValue = doc ? value : staticValue;

          ops.push({
            updateOne: {
              filter: { language: code, key },
              update: {
                $push: {
                  notes: {
                    id: randomUUID(),
                    userId: permissions.userId,
                    text: note,
                    imageUrl,
                    createdAt: now,
                  },
                },
                $setOnInsert: {
                  value: insertValue,
                  base: english,
                  status:
                    insertValue.trim() && insertValue !== english
                      ? "approved"
                      : "pending",
                  updatedAt: 0,
                },
              },
              upsert: true,
            },
          });
          changedKeys.add(key);
          continue;
        }

        if (action === "seed") {
          if (value === english || value.trim()) {
            skipped.set(code, (skipped.get(code) ?? 0) + 1);
            continue;
          }

          ops.push({
            updateOne: {
              filter: { language: code, key },
              update: {
                $set: {
                  value: english,
                  base: english,
                  status: "pending",
                  updatedBy: permissions.userId,
                  updatedAt: now,
                  editedAt: now,
                  approvedAt: null,
                  translatedBy: null,
                  translatedAt: null,
                  previous: null,
                },
              },
              upsert: true,
            },
          });
          changedKeys.add(key);
          continue;
        }

        if (status === "untranslated") {
          skipped.set(code, (skipped.get(code) ?? 0) + 1);
          continue;
        }
        if (action === "approve" && status === "approved") {
          skipped.set(code, (skipped.get(code) ?? 0) + 1);
          continue;
        }
        if (action === "unreview" && status === "pending") {
          skipped.set(code, (skipped.get(code) ?? 0) + 1);
          continue;
        }
        if (action === "outdated" && status === "outdated") {
          skipped.set(code, (skipped.get(code) ?? 0) + 1);
          continue;
        }
        if (action === "approve" && validatePlaceholders(english, value)) {
          skipped.set(code, (skipped.get(code) ?? 0) + 1);
          continue;
        }

        let update;

        if (action === "approve") {
          update = {
            value,
            base: english,
            status: "approved",
            updatedBy: permissions.userId,
            updatedAt: now,
            approvedAt: now,
            editedAt: doc?.editedAt ?? doc?.updatedAt ?? now,
            previous: null,
          };
          if (doc && !doc.translatedBy && doc.status === "pending") {
            update.translatedBy = doc.updatedBy ?? null;
            update.translatedAt = doc.editedAt ?? doc.updatedAt ?? null;
          }
        } else if (action === "unreview") {
          update = {
            value,
            base: english,
            status: "pending",
            updatedBy: permissions.userId,
            updatedAt: now,
            editedAt: doc?.editedAt ?? doc?.updatedAt ?? now,
          };
          if (!doc || doc.status === "approved") {
            update.previous = {
              value,
              status: "approved",
              updatedBy: doc?.updatedBy ?? null,
              updatedAt: doc?.updatedAt ?? 0,
            };
          }
        } else if (action === "outdated") {
          update = {
            value,
            base: "",
            status: doc?.status === "approved" ? "approved" : "pending",
            updatedBy: permissions.userId,
            updatedAt: now,
            editedAt: now,
          };
        } else {
          update = {
            value: "",
            base: english,
            status: "pending",
            updatedBy: permissions.userId,
            updatedAt: now,
            editedAt: now,
            approvedAt: null,
            translatedBy: null,
            translatedAt: null,
            previous: null,
          };
        }

        ops.push({
          updateOne: {
            filter: { language: code, key },
            update: { $set: update },
            upsert: true,
          },
        });
        changedKeys.add(key);
      }
    }

    for (let i = 0; i < ops.length; i += BULK_WRITE_BATCH) {
      await model.bulkWrite(ops.slice(i, i + BULK_WRITE_BATCH), {
        ordered: false,
      });
    }

    const changedKeyList = [
      ...new Set(ops.map((entry) => entry.updateOne.filter.key)),
    ];

    if (changedKeyList.length > 0) {
      try {
        const changedDocs = await model
          .find({
            language: { $in: languageCodes },
            key: { $in: changedKeyList },
          })
          .lean();
        for (const doc of Array.isArray(changedDocs) ? changedDocs : []) {
          if (
            doc &&
            typeof doc.language === "string" &&
            typeof doc.key === "string"
          ) {
            docMap.set(`${doc.language}\u0000${doc.key}`, doc);
          }
        }
      } catch {
        const refreshed = await model
          .find({ language: { $in: languageCodes } })
          .lean()
          .catch(() => []);
        for (const doc of Array.isArray(refreshed) ? refreshed : []) {
          if (
            doc &&
            typeof doc.language === "string" &&
            typeof doc.key === "string"
          ) {
            docMap.set(`${doc.language}\u0000${doc.key}`, doc);
          }
        }
      }
    }

    const docsByLanguage = new Map(
      languageCodes.map((code) => [code, []]),
    );
    for (const doc of docMap.values()) {
      if (docsByLanguage.has(doc.language)) {
        docsByLanguage.get(doc.language).push(doc);
      }
    }

    const dataByLanguage = new Map();
    for (const code of languageCodes) {
      dataByLanguage.set(
        code,
        buildLanguageData(code, baseStrings, docsByLanguage.get(code) ?? []),
      );
    }

    const primary = languageCodes.includes(primaryLanguage)
      ? primaryLanguage
      : languageCodes[0];
    const primaryData = dataByLanguage.get(primary);
    const primaryChanged = changedKeysByLanguage.get(primary) ?? new Set();
    const skipped = [...skippedByLanguage.values()].reduce(
      (total, count) => total + count,
      0,
    );

    return res.json({
      ok: true,
      action,
      changed: ops.length,
      skipped,
      stats: primaryData?.stats ?? null,
      strings: (primaryData?.strings ?? []).filter((entry) =>
        primaryChanged.has(entry.key),
      ),
      languages: languageCodes.map((code) => ({
        ...languageMeta(code),
        changed: changedKeysByLanguage.get(code)?.size ?? 0,
        skipped: skippedByLanguage.get(code) ?? 0,
        stats: dataByLanguage.get(code)?.stats ?? null,
      })),
    });
  }

  router.get("/", requireApiKey, async (_req, res) => {
    try {
      const languages = await getLanguageSummaries(client);
      return res.json({ languages });
    } catch (err) {
      console.error("[API] GET /api/translations:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/me", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;
      return res.json({ permissions });
    } catch (err) {
      console.error("[API] GET /api/translations/me:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/request", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;

      const requested = languageListFrom(req.body?.languages);

      const user = await client.database.getUser(permissions.userId, true);
      const current = user?.translations ?? {};
      const approved = Array.isArray(current.languages) ? current.languages : [];
      const requestedLanguages = requested.filter(
        (code) => !approved.includes(code),
      );

      const next = {
        languages: approved,
        requestedLanguages,
        proofreader: Boolean(current.proofreader),
        moderator: Boolean(current.moderator),
        developer: Boolean(current.developer),
      };

      await client.database.updateUser(permissions.userId, { translations: next }, true);

      return res.json({
        permissions: {
          userId: permissions.userId,
          ...normalizePermissions(next, isOwner(permissions.userId)),
        },
      });
    } catch (err) {
      console.error("[API] POST /api/translations/request:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/import", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;
      if (!permissions.developer) {
        return res.status(403).json({ error: "Developer access required" });
      }

      const files = Array.isArray(req.body?.files)
        ? req.body.files.slice(0, 25)
        : [];
      if (files.length === 0) {
        return res.status(400).json({ error: "No translation files were provided" });
      }

      const baseStrings = await getBaseStringsWithDocs(client);
      const languages = [];
      const errors = [];
      let imported = 0;
      let skipped = 0;
      let added = 0;
      let updated = 0;
      let removed = 0;

      for (const file of files) {
        const name = String(file?.name ?? "");
        const content = typeof file?.content === "string" ? file.content : null;
        const match = name.match(/([a-z]{2}_[A-Z]{2})\.json$/i);
        const code = match?.[1];

        if (!code || !isLanguage(code)) {
          errors.push(`${name || "Unknown file"}: language not found`);
          continue;
        }
        if (content === null) {
          errors.push(`${name}: no file content`);
          continue;
        }
        if (content.length > 4 * 1024 * 1024) {
          errors.push(`${name}: file is too large`);
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch {
          errors.push(`${name}: invalid JSON`);
          continue;
        }

        const strings = flatten(parsed);
        const fileKeys = new Set(Object.keys(strings));
        let existingDocs;
        try {
          existingDocs = await model
            .find({ language: code })
            .select({ key: 1, value: 1, base: 1, status: 1 })
            .lean();
        } catch (err) {
          errors.push(`${name}: ${err.message}`);
          continue;
        }
        const existingByKey = new Map(
          existingDocs
            .filter((doc) => doc && typeof doc.key === "string")
            .map((doc) => [doc.key, doc]),
        );
        const isBase = code === BASE_LANGUAGE;
        const seedLanguages = isBase
          ? discoverLanguages().filter((language) => language !== BASE_LANGUAGE)
          : [];
        const seedStaticStrings = new Map(
          seedLanguages.map((language) => [
            language,
            getStaticStrings(language),
          ]),
        );
        const importedBaseValues = [];
        const ops = [];
        let fileImported = 0;
        let fileAdded = 0;
        let fileUpdated = 0;
        let fileRemoved = 0;

        for (const [key, value] of Object.entries(strings)) {
          if (typeof value !== "string" || !value.trim()) {
            skipped++;
            continue;
          }

          const english = isBase ? value : baseStrings[key];
          if (
            !isBase &&
            (!Object.prototype.hasOwnProperty.call(baseStrings, key) ||
              typeof english !== "string" ||
              value === english)
          ) {
            skipped++;
            continue;
          }

          const existing = existingByKey.get(key);
          if (!existing) {
            fileAdded++;
          } else if (
            existing.value !== value ||
            existing.base !== english ||
            existing.status !== "approved"
          ) {
            fileUpdated++;
          }

          const now = Date.now();
          ops.push({
            updateOne: {
              filter: { language: code, key },
              update: {
                $set: {
                  value,
                  base: english,
                  status: "approved",
                  updatedBy: permissions.userId,
                  translatedBy: permissions.userId,
                  translatedAt: now,
                  updatedAt: now,
                  approvedAt: now,
                  editedAt: now,
                },
              },
              upsert: true,
            },
          });
          fileImported++;

          if (isBase) {
            importedBaseValues.push([key, value]);
            const previousBase = baseStrings[key];
            const sourceChanged =
              Object.prototype.hasOwnProperty.call(baseStrings, key) &&
              previousBase !== value;

            for (const language of seedLanguages) {
              const staticStrings = seedStaticStrings.get(language);
              const hasStaticValue = Object.prototype.hasOwnProperty.call(
                staticStrings,
                key,
              );

              if (!sourceChanged && hasStaticValue) {
                continue;
              }

              const rawStaticValue = staticStrings[key];
              const staticValue =
                typeof rawStaticValue === "string" ? rawStaticValue : "";
              const staticIsTranslated =
                staticValue.trim() !== "" &&
                staticValue !== previousBase &&
                staticValue !== value;
              const seedValue =
                sourceChanged && staticIsTranslated ? staticValue : "";

              ops.push({
                updateOne: {
                  filter: { language, key },
                  update: {
                    $setOnInsert: {
                      value: seedValue,
                      ...(!sourceChanged ? { status: "pending" } : {}),
                      updatedBy: null,
                      translatedBy: null,
                      translatedAt: null,
                      updatedAt: 0,
                      approvedAt: null,
                      editedAt: null,
                      previous: null,
                      notes: [],
                    },
                    $set: sourceChanged
                      ? { base: value, status: "pending" }
                      : { base: value },
                  },
                  upsert: true,
                },
              });
            }
          }
        }

        try {
          for (let i = 0; i < ops.length; i += 500) {
            await model.bulkWrite(ops.slice(i, i + 500), { ordered: false });
          }
        } catch (err) {
          errors.push(`${name}: ${err.message}`);
          continue;
        }

        const removedKeys = existingDocs
          .map((doc) => doc.key)
          .filter((key) => typeof key === "string" && !fileKeys.has(key));

        if (removedKeys.length > 0) {
          try {
            const result = await model.deleteMany({
              language: code,
              key: { $in: removedKeys },
            });
            fileRemoved = result.deletedCount ?? 0;
          } catch (err) {
            errors.push(`${name}: ${err.message}`);
          }
        }

        for (const [key, value] of importedBaseValues) {
          baseStrings[key] = value;
        }

        imported += fileImported;
        added += fileAdded;
        updated += fileUpdated;
        removed += fileRemoved;
        const meta = languageMeta(code);
        const existing = languages.find((entry) => entry.code === code);
        if (existing) {
          existing.strings += fileImported;
          existing.added += fileAdded;
          existing.updated += fileUpdated;
          existing.removed += fileRemoved;
        } else {
          languages.push({
            code,
            name: meta.name,
            native: meta.native,
            strings: fileImported,
            added: fileAdded,
            updated: fileUpdated,
            removed: fileRemoved,
          });
        }
      }

      if (languages.length === 0 && errors.length > 0) {
        return res.status(400).json({ error: errors[0] });
      }

      return res.json({
        ok: true,
        strings: imported,
        added,
        updated,
        removed,
        skipped,
        languages,
        errors,
      });
    } catch (err) {
      console.error("[API] POST /api/translations/import:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/refresh", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;
      if (!permissions.developer) {
        return res.status(403).json({ error: "Developer access required" });
      }

      if (!client.translate || typeof client.translate.reload !== "function") {
        return res
          .status(503)
          .json({ error: "Translation handler is not available" });
      }

      clearLanguageFileCache();
      const result = await client.translate.reload(client.database);
      if (result && result !== "Success") throw new Error(result);

      const languages = await getLanguageSummaries(client);
      return res.json({ ok: true, languages });
    } catch (err) {
      console.error("[API] POST /api/translations/refresh:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/translators", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;
      if (!canModerate(permissions)) {
        return res.status(403).json({ error: "Moderator access required" });
      }

      const translators = await getTranslators(client);
      return res.json({ translators });
    } catch (err) {
      console.error("[API] GET /api/translations/translators:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/translators/:userId/contributions", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;
      if (!canModerate(permissions)) {
        return res.status(403).json({ error: "Moderator access required" });
      }

      const targetId = String(req.params.userId ?? "");
      if (!/^\d{17,20}$/.test(targetId)) {
        return res.status(400).json({ error: "Invalid user ID" });
      }

      const docsPromise = Promise.resolve()
        .then(() =>
          model.find({ language: { $ne: BASE_LANGUAGE } }).lean(),
        )
        .catch(() => []);
      const [baseStrings, docs] = await Promise.all([
        getBaseStringsWithDocs(client),
        docsPromise,
      ]);

      const contributions = [];
      for (const doc of Array.isArray(docs) ? docs : []) {
        if (
          !doc ||
          typeof doc.language !== "string" ||
          typeof doc.key !== "string"
        ) {
          continue;
        }

        const english = String(baseStrings[doc.key] ?? "");
        const value = String(doc.value ?? "");
        const translationAuthor =
          doc.translatedBy ??
          (doc.status !== "approved" ? doc.updatedBy ?? null : null);
        const ownsTranslation =
          Boolean(value.trim()) &&
          value !== english &&
          translationAuthor === targetId;
        const notes = (Array.isArray(doc.notes) ? doc.notes : [])
          .filter((note) => note && note.userId === targetId)
          .map((note) => ({
            id: note.id,
            userId: note.userId,
            text: note.text ?? "",
            imageUrl: note.imageUrl ?? "",
            createdAt: note.createdAt ?? 0,
          }));

        if (!ownsTranslation && notes.length === 0) continue;

        contributions.push({
          language: doc.language,
          key: doc.key,
          baseValue: english,
          value,
          status: storedTranslationStatus(doc, value, english),
          updatedAt: doc.updatedAt ?? null,
          translatedBy: doc.translatedBy ?? null,
          updatedBy: doc.updatedBy ?? null,
          ownsTranslation,
          notes,
        });
      }

      contributions.sort(
        (a, b) =>
          a.language.localeCompare(b.language) || a.key.localeCompare(b.key),
      );

      return res.json({ contributions });
    } catch (err) {
      console.error(
        "[API] GET /api/translations/translators/:userId/contributions:",
        err,
      );
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/translators/:userId/bulk-delete", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;
      if (!canModerate(permissions)) {
        return res.status(403).json({ error: "Moderator access required" });
      }

      const targetId = String(req.params.userId ?? "");
      if (!/^\d{17,20}$/.test(targetId)) {
        return res.status(400).json({ error: "Invalid user ID" });
      }

      const action = String(req.body?.action ?? "");
      if (action !== "notes" && action !== "translations") {
        return res.status(400).json({ error: "Invalid bulk delete action" });
      }

      const items = [];
      const seen = new Set();
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
      for (const raw of rawItems) {
        const language = String(raw?.language ?? "");
        const key = String(raw?.key ?? "");
        if (
          !language ||
          !key ||
          language === BASE_LANGUAGE ||
          !isLanguage(language)
        ) {
          continue;
        }

        const itemKey = `${language}\u0000${key}`;
        if (seen.has(itemKey)) continue;
        seen.add(itemKey);
        items.push({ language, key });
      }

      if (items.length === 0) {
        return res.status(400).json({ error: "No contributions selected" });
      }
      if (items.length > 1000) {
        return res
          .status(400)
          .json({ error: "Select no more than 1,000 contributions at once" });
      }

      const languageCodes = [...new Set(items.map((item) => item.language))];
      const keys = [...new Set(items.map((item) => item.key))];
      const docsPromise = Promise.resolve().then(() =>
        model
          .find({ language: { $in: languageCodes }, key: { $in: keys } })
          .lean(),
      );
      const [baseStrings, docs] = await Promise.all([
        getBaseStringsWithDocs(client),
        docsPromise,
      ]);

      const docsByKey = new Map();
      for (const doc of Array.isArray(docs) ? docs : []) {
        if (
          doc &&
          typeof doc.language === "string" &&
          typeof doc.key === "string"
        ) {
          docsByKey.set(`${doc.language}\u0000${doc.key}`, doc);
        }
      }

      const now = Date.now();
      const ops = [];
      let removedNotes = 0;
      let removedTranslations = 0;

      for (const item of items) {
        const doc = docsByKey.get(`${item.language}\u0000${item.key}`);
        if (!doc) continue;

        if (action === "notes") {
          const count = (Array.isArray(doc.notes) ? doc.notes : []).filter(
            (note) => note && note.userId === targetId,
          ).length;
          if (count === 0) continue;

          removedNotes += count;
          ops.push({
            updateOne: {
              filter: { _id: doc._id },
              update: { $pull: { notes: { userId: targetId } } },
            },
          });
          continue;
        }

        const english = String(baseStrings[item.key] ?? "");
        const value = String(doc.value ?? "");
        const translationAuthor =
          doc.translatedBy ??
          (doc.status !== "approved" ? doc.updatedBy ?? null : null);
        const ownsTranslation =
          Boolean(value.trim()) &&
          value !== english &&
          translationAuthor === targetId;
        if (!ownsTranslation) continue;

        removedTranslations += 1;
        ops.push({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                value: "",
                base: english,
                status: "pending",
                updatedBy: permissions.userId,
                translatedBy: null,
                translatedAt: null,
                updatedAt: now,
                approvedAt: null,
                editedAt: now,
                previous: null,
              },
            },
          },
        });
      }

      for (let i = 0; i < ops.length; i += BULK_WRITE_BATCH) {
        await model.bulkWrite(ops.slice(i, i + BULK_WRITE_BATCH), {
          ordered: false,
        });
      }

      return res.json({
        ok: true,
        action,
        removedNotes,
        removedTranslations,
        updated: ops.length,
      });
    } catch (err) {
      console.error(
        "[API] POST /api/translations/translators/:userId/bulk-delete:",
        err,
      );
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.patch("/translators/:userId", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;
      if (!permissions.developer) {
        return res.status(403).json({ error: "Developer access required" });
      }

      const targetId = String(req.params.userId ?? "");
      if (!/^\d{17,20}$/.test(targetId)) {
        return res.status(400).json({ error: "Invalid user ID" });
      }

      const user = await client.database.getUser(targetId, true);
      if (!user) {
        return res.status(500).json({ error: "Failed to load that user" });
      }

      const current = user.translations ?? {};
      const body = req.body ?? {};
      const actorIsOwner = isOwner(permissions.userId);

      if (!actorIsOwner && body.developer !== undefined) {
        return res
          .status(403)
          .json({ error: "Only the owner can change developer access" });
      }

      const languages = body.languages !== undefined
        ? languageListFrom(body.languages)
        : Array.isArray(current.languages)
          ? current.languages
          : [];
      const owner = isOwner(targetId);
      const proofreader = owner
        ? true
        : body.proofreader !== undefined
          ? Boolean(body.proofreader)
          : Boolean(current.proofreader);
      const moderator = owner
        ? true
        : body.moderator !== undefined
          ? Boolean(body.moderator)
          : Boolean(current.moderator);
      const developer = owner
        ? true
        : body.developer !== undefined
          ? Boolean(body.developer)
          : Boolean(current.developer);
      const requestedLanguages = (Array.isArray(current.requestedLanguages)
        ? current.requestedLanguages
        : []
      ).filter((code) => !languages.includes(code));

      const next = {
        languages,
        requestedLanguages,
        proofreader,
        moderator,
        developer,
      };

      await client.database.updateUser(targetId, { translations: next }, true);

      const profiles = await getUserProfiles(client, [targetId]);
      return res.json({
        translator: {
          userId: targetId,
          owner,
          permissions: { userId: targetId, ...normalizePermissions(next, owner) },
          profile: profiles[targetId] ?? null,
        },
      });
    } catch (err) {
      console.error("[API] PATCH /api/translations/translators:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/translators/:userId", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;
      if (!permissions.developer) {
        return res.status(403).json({ error: "Developer access required" });
      }

      const targetId = String(req.params.userId ?? "");
      if (!/^\d{17,20}$/.test(targetId)) {
        return res.status(400).json({ error: "Invalid user ID" });
      }
      if (isOwner(targetId)) {
        return res.status(403).json({ error: "Owners cannot be removed" });
      }
      if (targetId === permissions.userId) {
        return res.status(400).json({ error: "You cannot remove yourself" });
      }

      const user = await client.database.getUser(targetId, false);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (!isOwner(permissions.userId) && Boolean(user.translations?.developer)) {
        return res
          .status(403)
          .json({ error: "Only the owner can remove developer access" });
      }

      await client.database.updateUser(
        targetId,
        {
          translations: {
            languages: [],
            requestedLanguages: [],
            proofreader: false,
            moderator: false,
            developer: false,
          },
        },
        true,
      );

      return res.json({ ok: true });
    } catch (err) {
      console.error("[API] DELETE /api/translations/translators:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/export", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;
      if (!permissions.developer) {
        return res.status(403).json({ error: "Developer access required" });
      }

      const requested = languageListFrom(req.query.languages);
      const codes = requested.length
        ? requested
        : discoverLanguages().filter((code) => code !== BASE_LANGUAGE);
      const includePending = ["1", "true", "yes"].includes(
        String(req.query.includePending ?? "").toLowerCase(),
      );

      if (codes.length === 0) {
        return res.status(400).json({ error: "No languages selected" });
      }

      const files = [];

      for (const code of codes) {
        if (!isLanguage(code)) continue;

        let content;
        if (code === BASE_LANGUAGE) {
          content = readLanguageFile(BASE_LANGUAGE) ?? {};
        } else {
          const data = await getLanguageData(client, code);
          if (!data) continue;
          content = buildExportFile(data, includePending);
        }

        files.push({
          name: `${code}.json`,
          content: `${JSON.stringify(content, null, 2)}\n`,
        });
      }

      if (files.length === 0) {
        return res.status(400).json({ error: "No translations to export" });
      }

      const archive = createZip(files);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="functious-translations.zip"',
      );
      res.setHeader("Cache-Control", "no-store");
      return res.send(archive);
    } catch (err) {
      console.error("[API] GET /api/translations/export:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/:language/bulk", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;
      if (!permissions.developer) {
        return res.status(403).json({ error: "Developer access required" });
      }

      const code = String(req.params.language ?? "");
      if (!isLanguage(code)) {
        return res.status(404).json({ error: "Language not found" });
      }
      if (code === BASE_LANGUAGE) {
        return res
          .status(400)
          .json({ error: "The source language cannot be bulk edited" });
      }

      return runBulkEdit(req, res, permissions, [code], code);
    } catch (err) {
      console.error("[API] POST /api/translations/:language/bulk:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/bulk", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;
      if (!permissions.developer) {
        return res.status(403).json({ error: "Developer access required" });
      }

      const codes = discoverLanguages().filter(
        (code) => code !== BASE_LANGUAGE,
      );
      return runBulkEdit(
        req,
        res,
        permissions,
        codes,
        String(req.body?.displayLanguage ?? ""),
      );
    } catch (err) {
      console.error("[API] POST /api/translations/bulk:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/:language", requireApiKey, async (req, res) => {
    try {
      const code = String(req.params.language ?? "");
      if (!isLanguage(code)) {
        return res.status(404).json({ error: "Language not found" });
      }

      const data = await getLanguageData(client, code);
      if (!data) return res.status(404).json({ error: "Language not found" });
      return res.json(data);
    } catch (err) {
      console.error("[API] GET /api/translations/:language:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.put("/:language/:key", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;

      const code = String(req.params.language ?? "");
      const key = String(req.params.key ?? "");
      if (!isLanguage(code)) {
        return res.status(404).json({ error: "Language not found" });
      }
      if (code === BASE_LANGUAGE) {
        return res.status(400).json({ error: "The source language cannot be edited" });
      }
      if (!canTranslate(permissions, code)) {
        return res.status(403).json({ error: "You do not have access to this language" });
      }

      const value = req.body?.value;
      if (typeof value !== "string") {
        return res.status(400).json({ error: "value must be a string" });
      }
      if (value.length > MAX_VALUE_LENGTH) {
        return res.status(400).json({ error: "Translation is too long" });
      }

      const baseStrings = await getBaseStringsWithDocs(client);
      if (!Object.prototype.hasOwnProperty.call(baseStrings, key)) {
        return res.status(404).json({ error: "String not found" });
      }

      const placeholderProblem = validatePlaceholders(baseStrings[key], value);
      if (placeholderProblem) {
        return res.status(400).json({ error: placeholderProblem });
      }

      const baseValue = String(baseStrings[key] ?? "");
      const existing = await model.findOne({ language: code, key });

      const storedValue = existing
        ? String(existing.value ?? "")
        : String(getStaticStrings(code)[key] ?? "");
      const storedWasApproved = existing ? existing.status === "approved" : true;

      const now = Date.now();
      const update = {
        value,
        base: baseValue,
        status: "pending",
        updatedBy: permissions.userId,
        translatedBy: permissions.userId,
        translatedAt: now,
        updatedAt: now,
        editedAt: now,
      };

      if (
        storedWasApproved &&
        storedValue.trim() !== "" &&
        storedValue !== baseValue &&
        storedValue !== value
      ) {
        update.previous = {
          value: storedValue,
          status: "approved",
          updatedBy: existing?.updatedBy ?? null,
          updatedAt: existing?.updatedAt ?? 0,
        };
      }

      await model.findOneAndUpdate(
        { language: code, key },
        { $set: update },
        { upsert: true, setDefaultsOnInsert: true },
      );

      return respondWithString(res, code, key);
    } catch (err) {
      console.error("[API] PUT /api/translations/:language/:key:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/:language/:key", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;

      const code = String(req.params.language ?? "");
      const key = String(req.params.key ?? "");
      if (!isLanguage(code)) {
        return res.status(404).json({ error: "Language not found" });
      }
      if (code === BASE_LANGUAGE) {
        return res.status(400).json({ error: "The source language cannot be edited" });
      }
      if (!canModerate(permissions)) {
        return res.status(403).json({ error: "Moderator access required" });
      }

      const baseStrings = await getBaseStringsWithDocs(client);
      if (!Object.prototype.hasOwnProperty.call(baseStrings, key)) {
        return res.status(404).json({ error: "String not found" });
      }

      const existing = await model.findOne({ language: code, key });
      const currentValue = existing
        ? String(existing.value ?? "")
        : String(getStaticStrings(code)[key] ?? "");
      if (!currentValue.trim()) {
        return res.status(400).json({ error: "This string has no translation to remove" });
      }

      const now = Date.now();
      await model.findOneAndUpdate(
        { language: code, key },
        {
          $set: {
            value: "",
            base: String(baseStrings[key] ?? ""),
            status: "pending",
            updatedBy: permissions.userId,
            translatedBy: null,
            translatedAt: null,
            updatedAt: now,
            approvedAt: null,
            editedAt: now,
            previous: null,
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );

      return respondWithString(res, code, key);
    } catch (err) {
      console.error("[API] DELETE /api/translations/:language/:key:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/:language/:key/approve", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;

      const code = String(req.params.language ?? "");
      const key = String(req.params.key ?? "");
      if (!isLanguage(code)) {
        return res.status(404).json({ error: "Language not found" });
      }
      if (code === BASE_LANGUAGE) {
        return res.status(400).json({ error: "The source language cannot be reviewed" });
      }
      if (!canReview(permissions)) {
        return res.status(403).json({ error: "Proofreader access required" });
      }

      const baseStrings = await getBaseStringsWithDocs(client);
      if (!Object.prototype.hasOwnProperty.call(baseStrings, key)) {
        return res.status(404).json({ error: "String not found" });
      }

      const doc = await model.findOne({ language: code, key });
      if (!doc) {
        return res.status(400).json({ error: "Save a translation before approving it" });
      }

      const value = String(doc.value ?? "");
      if (!value.trim() || value === String(baseStrings[key] ?? "")) {
        return res.status(400).json({ error: "Add a translation before approving it" });
      }

      const placeholderProblem = validatePlaceholders(baseStrings[key], value);
      if (placeholderProblem) {
        return res.status(400).json({ error: placeholderProblem });
      }

      const previousUpdatedAt = doc.updatedAt;
      const now = Date.now();
      if (!doc.translatedBy && doc.status === "pending") {
        doc.translatedBy = doc.updatedBy ?? null;
        doc.translatedAt = doc.editedAt ?? doc.updatedAt ?? null;
      }
      doc.status = "approved";
      doc.base = String(baseStrings[key] ?? "");
      doc.updatedBy = permissions.userId;
      doc.updatedAt = now;
      doc.approvedAt = now;
      doc.editedAt = doc.editedAt ?? (previousUpdatedAt || null);
      doc.previous = null;
      await doc.save();

      return respondWithString(res, code, key);
    } catch (err) {
      console.error("[API] POST /api/translations/:language/:key/approve:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/:language/:key/revert", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;

      const code = String(req.params.language ?? "");
      const key = String(req.params.key ?? "");
      if (!isLanguage(code)) {
        return res.status(404).json({ error: "Language not found" });
      }
      if (code === BASE_LANGUAGE) {
        return res.status(400).json({ error: "The source language cannot be reviewed" });
      }
      if (!canReview(permissions)) {
        return res.status(403).json({ error: "Proofreader access required" });
      }

      const baseStrings = await getBaseStringsWithDocs(client);
      if (!Object.prototype.hasOwnProperty.call(baseStrings, key)) {
        return res.status(404).json({ error: "String not found" });
      }

      const doc = await model.findOne({ language: code, key });
      if (!doc) {
        return res.status(400).json({ error: "This string is not awaiting review" });
      }

      const restorablePrevious =
        doc.previous && String(doc.previous.value ?? "").trim()
          ? doc.previous
          : null;
      
      const undoingRevert =
        doc.status !== "pending" &&
        restorablePrevious &&
        restorablePrevious.status === "pending";

      if (doc.status !== "pending" && !undoingRevert) {
        return res.status(400).json({ error: "This string is not awaiting review" });
      }

      const replaced = {
        value: String(doc.value ?? ""),
        status: doc.status === "approved" ? "approved" : "pending",
        updatedBy: doc.updatedBy ?? null,
        updatedAt: doc.updatedAt ?? 0,
      };

      if (restorablePrevious) {
        const restoredStatus =
          restorablePrevious.status === "pending" ? "pending" : "approved";
        doc.value = String(restorablePrevious.value);
        doc.status = restoredStatus;
        doc.base = String(baseStrings[key] ?? "");
        doc.updatedBy = restorablePrevious.updatedBy ?? null;
        doc.translatedBy = restorablePrevious.updatedBy ?? null;
        doc.translatedAt = restorablePrevious.updatedAt ?? null;
        doc.updatedAt = restorablePrevious.updatedAt ?? 0;
        doc.approvedAt =
          restoredStatus === "approved"
            ? restorablePrevious.updatedAt || Date.now()
            : null;
      } else {
        doc.value = "";
        doc.base = String(baseStrings[key] ?? "");
        doc.status = "pending";
        doc.updatedBy = permissions.userId;
        doc.translatedBy = null;
        doc.translatedAt = null;
        doc.updatedAt = Date.now();
        doc.approvedAt = null;
      }

      doc.editedAt = Date.now();
      doc.previous =
        replaced.value.trim() && replaced.value !== doc.value ? replaced : null;
      await doc.save();

      return respondWithString(res, code, key);
    } catch (err) {
      console.error("[API] POST /api/translations/:language/:key/revert:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/:language/:key/notes", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;

      const code = String(req.params.language ?? "");
      const key = String(req.params.key ?? "");
      if (!isLanguage(code)) {
        return res.status(404).json({ error: "Language not found" });
      }
      if (code === BASE_LANGUAGE) {
        return res.status(400).json({ error: "The source language has no notes" });
      }
      if (!canTranslate(permissions, code) && !canReview(permissions)) {
        return res.status(403).json({ error: "Translator access required" });
      }

      const text = String(req.body?.text ?? "").trim();
      if (text.length > MAX_NOTE_LENGTH) {
        return res.status(400).json({ error: "Note is too long" });
      }

      let imageUrl = "";
      try {
        imageUrl = await validateImageUrl(req.body?.imageUrl);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      if (!text && !imageUrl) {
        return res.status(400).json({ error: "Write a note first" });
      }

      const baseStrings = await getBaseStringsWithDocs(client);
      if (!Object.prototype.hasOwnProperty.call(baseStrings, key)) {
        return res.status(404).json({ error: "String not found" });
      }

      const doc = await ensureDocument(code, key, String(baseStrings[key] ?? ""));
      doc.notes.push({
        id: randomUUID(),
        userId: permissions.userId,
        text,
        imageUrl,
        createdAt: Date.now(),
      });
      await doc.save();

      return respondWithString(res, code, key);
    } catch (err) {
      console.error("[API] POST /api/translations/:language/:key/notes:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/:language/:key/notes/:noteId", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;

      const code = String(req.params.language ?? "");
      const key = String(req.params.key ?? "");
      const noteId = String(req.params.noteId ?? "");
      if (!isLanguage(code)) {
        return res.status(404).json({ error: "Language not found" });
      }

      const doc = await model.findOne({ language: code, key });
      const note = doc?.notes?.find((entry) => entry.id === noteId);
      if (!doc || !note) {
        return res.status(404).json({ error: "Note not found" });
      }

      if (
        note.userId !== permissions.userId &&
        !canReview(permissions) &&
        !canModerate(permissions)
      ) {
        return res.status(403).json({ error: "You can only delete your own notes" });
      }

      doc.notes = doc.notes.filter((entry) => entry.id !== noteId);
      await doc.save();

      return respondWithString(res, code, key);
    } catch (err) {
      console.error("[API] DELETE /api/translations/:language/:key/notes/:noteId:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

module.exports = translationsRouter;

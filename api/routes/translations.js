const { Router } = require("express");
const { randomUUID } = require("crypto");
const { makeRequireApiKey } = require("../middleware");
const { createZip } = require("../../functions/createZip");
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
  getLanguageData,
  getLanguageSummaries,
  getPermissions,
  normalizePermissions,
  canTranslate,
  canReview,
  isOwner,
  getTranslators,
  buildExportFile,
} = require("../../functions/translationStore");

const MAX_VALUE_LENGTH = 6000;
const MAX_NOTE_LENGTH = 500;
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
                      status: "pending",
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

        for (const [key, value] of importedBaseValues) {
          baseStrings[key] = value;
        }

        imported += fileImported;
        const meta = languageMeta(code);
        const existing = languages.find((entry) => entry.code === code);
        if (existing) existing.strings += fileImported;
        else {
          languages.push({
            code,
            name: meta.name,
            native: meta.native,
            strings: fileImported,
          });
        }
      }

      if (languages.length === 0 && errors.length > 0) {
        return res.status(400).json({ error: errors[0] });
      }

      return res.json({
        ok: true,
        strings: imported,
        skipped,
        languages,
        errors,
      });
    } catch (err) {
      console.error("[API] POST /api/translations/import:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/translators", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;
      if (!permissions.developer) {
        return res.status(403).json({ error: "Developer access required" });
      }

      const translators = await getTranslators(client);
      return res.json({ translators });
    } catch (err) {
      console.error("[API] GET /api/translations/translators:", err);
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

      await client.database.updateUser(
        targetId,
        {
          translations: {
            languages: [],
            requestedLanguages: [],
            proofreader: false,
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
        return res.status(400).json({ error: "The source language cannot be bulk edited" });
      }

      const action = String(req.body?.action ?? "");
      if (action !== "approve" && action !== "unreview") {
        return res.status(400).json({ error: "Invalid bulk action" });
      }

      const baseStrings = await getBaseStringsWithDocs(client);
      const staticStrings = getStaticStrings(code);
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

      let docs = [];
      try {
        docs = await model.find({ language: code }).lean();
      } catch {
        docs = [];
      }
      const docMap = new Map(
        docs
          .filter((doc) => doc && typeof doc.key === "string")
          .map((doc) => [doc.key, doc]),
      );

      const ops = [];
      let skipped = 0;

      for (const key of keys) {
        const english = String(baseStrings[key] ?? "");
        const doc = docMap.get(key);
        const stored = doc ? doc.value : staticStrings[key];
        const value = typeof stored === "string" ? stored : "";

        if (!value.trim() || value === english) {
          skipped++;
          continue;
        }
        if (action === "approve" && validatePlaceholders(english, value)) {
          skipped++;
          continue;
        }

        const now = Date.now();
        const update = {
          value,
          base: english,
          status: action === "approve" ? "approved" : "pending",
          updatedBy: permissions.userId,
          updatedAt: now,
        };

        if (action === "approve") {
          if (doc && !doc.translatedBy && doc.status === "pending") {
            update.translatedBy = doc.updatedBy ?? null;
            update.translatedAt = doc.editedAt ?? doc.updatedAt ?? null;
          }
          update.approvedAt = now;
          if (doc && !doc.editedAt) update.editedAt = doc.updatedAt || null;
          update.previous = null;
        } else if (!doc || doc.status === "approved") {
          update.previous = {
            value,
            status: "approved",
            updatedBy: doc?.updatedBy ?? null,
            updatedAt: doc?.updatedAt ?? 0,
          };
        }

        ops.push({
          updateOne: {
            filter: { language: code, key },
            update: { $set: update },
            upsert: true,
          },
        });
      }

      for (let i = 0; i < ops.length; i += 500) {
        await model.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      }

      const data = await getLanguageData(client, code);
      const changedKeys = new Set(ops.map((entry) => entry.updateOne.filter.key));

      return res.json({
        ok: true,
        action,
        changed: ops.length,
        skipped,
        stats: data?.stats ?? null,
        strings: (data?.strings ?? []).filter((entry) =>
          changedKeys.has(entry.key),
        ),
      });
    } catch (err) {
      console.error("[API] POST /api/translations/:language/bulk:", err);
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

  router.post("/:language/:key/approve", requireApiKey, async (req, res) => {
    try {
      const permissions = await requireUser(req, res);
      if (!permissions) return;

      const code = String(req.params.language ?? "");
      const key = String(req.params.key ?? "");
      if (!isLanguage(code)) {
        return res.status(404).json({ error: "Language not found" });
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
      if (!text) return res.status(400).json({ error: "Write a note first" });
      if (text.length > MAX_NOTE_LENGTH) {
        return res.status(400).json({ error: "Note is too long" });
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

      if (note.userId !== permissions.userId && !canReview(permissions)) {
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

const { Router } = require('express');
const { makeRequireApiKey } = require('../middleware');
const { validDay } = require('../../functions/birthdayHelpers');
const { getUserProfile, getUserProfiles } = require('../../functions/userProfiles');

const MAX_BATCH_IDS = 100;

function normalizeBirthday(birthday) {
  return {
    day: birthday?.day ?? null,
    month: birthday?.month ?? null,
    age: birthday?.age ?? null,
    lastBirthday: birthday?.lastBirthday ?? null,
    ping: birthday?.ping ?? true,
    enabledGuilds: birthday?.enabledGuilds ?? [],
  };
}

function usersRouter(client, apiKey) {
  const router = Router();
  const requireApiKey = makeRequireApiKey(apiKey);

  router.get('/:userId', requireApiKey, async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await client.database.getUser(userId, false);
      if (!user) return res.status(404).json({ error: 'User not found' });

      return res.json({
        userId: user.userId,
        timezone: user.timezone,
        reminderCount: user.reminders?.length ?? 0,
        birthday: normalizeBirthday(user.birthday),
      });
    } catch (err) {
      console.error('[API] GET /api/users/:userId:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/:userId', requireApiKey, async (req, res) => {
    try {
      const { userId } = req.params;
      const body = req.body ?? {};

      const user = await client.database.getUser(userId, true);
      const updates = {};

      if (body.timezone !== undefined) {
        if (body.timezone !== null && typeof body.timezone !== 'string') {
          return res.status(400).json({ error: 'timezone must be a string or null' });
        }
        updates.timezone = body.timezone;
      }

      if (body.birthday !== undefined) {
        if (typeof body.birthday !== 'object' || body.birthday === null) {
          return res.status(400).json({ error: 'birthday must be an object' });
        }
        const incoming = body.birthday;
        const current = user.birthday ?? {};
        const next = { ...current };

        const hasDateField = 'day' in incoming || 'month' in incoming;
        if (hasDateField) {
          const day = incoming.day ?? null;
          const month = incoming.month ?? null;
          if ((day === null) !== (month === null)) {
            return res.status(400).json({ error: 'day and month must both be set or both be cleared' });
          }
          if (day !== null) {
            if (!Number.isInteger(day) || day < 1 || day > 31) {
              return res.status(400).json({ error: 'day must be between 1 and 31' });
            }
            if (!Number.isInteger(month) || month < 1 || month > 12) {
              return res.status(400).json({ error: 'month must be between 1 and 12' });
            }
            if (!validDay(month, day)) {
              return res.status(400).json({ error: 'Invalid day for that month' });
            }
            if (day !== current.day || month !== current.month) {
              next.lastBirthday = null;
            }
          }
          next.day = day;
          next.month = month;
        }

        if ('age' in incoming) {
          const age = incoming.age ?? null;
          if (age !== null && (!Number.isInteger(age) || age < 1 || age > 150)) {
            return res.status(400).json({ error: 'age must be an integer between 1 and 150' });
          }
          next.age = age;
        }

        if ('ping' in incoming) {
          if (typeof incoming.ping !== 'boolean') {
            return res.status(400).json({ error: 'ping must be a boolean' });
          }
          next.ping = incoming.ping;
        }

        if ('enabledGuilds' in incoming) {
          if (!Array.isArray(incoming.enabledGuilds)) {
            return res.status(400).json({ error: 'enabledGuilds must be an array' });
          }
          const guildIds = [...new Set(incoming.enabledGuilds.map((id) => String(id)))];
          for (const guildId of guildIds) {
            const guild = await client.database.getGuild(guildId, false);
            if (guild?.birthdayBlacklist?.includes(userId)) {
              return res.status(403).json({
                error: 'You are blacklisted from birthday announcements in this server',
              });
            }
          }
          next.enabledGuilds = guildIds;
        }

        updates.birthday = next;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      await client.database.updateUser(userId, updates, true);
      return res.json({ ok: true, birthday: normalizeBirthday(updates.birthday ?? user.birthday) });
    } catch (err) {
      console.error('[API] PATCH /api/users/:userId:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:userId/birthdays/blacklist-status', requireApiKey, async (req, res) => {
    try {
      const { userId } = req.params;
      const guildIds = String(req.query.guilds ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^\d{17,20}$/.test(s));

      const blacklisted = {};
      for (const guildId of guildIds) {
        const guild = await client.database.getGuild(guildId, false);
        blacklisted[guildId] = Array.isArray(guild?.birthdayBlacklist)
          ? guild.birthdayBlacklist.includes(userId)
          : false;
      }
      return res.json({ blacklisted });
    } catch (err) {
      console.error('[API] GET /api/users/:userId/birthdays/blacklist-status:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:userId/profile', requireApiKey, async (req, res) => {
    try {
      const { userId } = req.params;
      if (!/^\d{17,20}$/.test(userId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      return res.json(getUserProfile(client, userId));
    } catch (err) {
      console.error('[API] GET /api/users/:userId/profile:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/profiles', requireApiKey, async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids)
        ? [...new Set(req.body.ids.map(String))]
        : [];
      const validIds = ids
        .filter((id) => /^\d{17,20}$/.test(id))
        .slice(0, MAX_BATCH_IDS);
      const profiles = await getUserProfiles(client, validIds);
      return res.json({ profiles });
    } catch (err) {
      console.error('[API] POST /api/users/profiles:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:userId/reminders', requireApiKey, async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await client.database.getUser(userId, false);
      if (!user) return res.json({ reminders: [] });
      return res.json({ reminders: user.reminders ?? [] });
    } catch (err) {
      console.error('[API] GET reminders:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/:userId/reminders', requireApiKey, async (req, res) => {
    try {
      const { userId } = req.params;
      const { message, timestamp } = req.body;

      if (!message || !timestamp) {
        return res.status(400).json({ error: 'message and timestamp are required' });
      }

      const MAX_SECONDS = 63115209;
      const nowTs = Math.floor(Date.now() / 1000);
      const ts = Number(timestamp);

      if (ts - nowTs > MAX_SECONDS) {
        return res.status(400).json({ error: 'Reminder cannot be more than 2 years in the future' });
      }
      if (ts <= nowTs + 59) {
        return res.status(400).json({ error: 'Reminder must be at least 1 minute in the future' });
      }

      const user = await client.database.getUser(userId, true);
      const newReminder = {
        id: require('crypto').randomUUID(),
        message: String(message).slice(0, 400),
        timestamp: ts,
        createdAt: Math.floor(Date.now() / 1000),
        type: 'dm',
      };

      const reminders = [...(user.reminders ?? []), newReminder];
      await client.database.updateUser(userId, { reminders }, true);
      return res.json({ reminder: newReminder });
    } catch (err) {
      console.error('[API] POST reminder:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/:userId/reminders/:reminderId', requireApiKey, async (req, res) => {
    try {
      const { userId, reminderId } = req.params;
      const { message, timestamp } = req.body;

      const user = await client.database.getUser(userId, false);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const reminders = (user.reminders ?? []).map((r) => {
        if (r.id !== reminderId) return r;
        return {
          ...r,
          ...(message !== undefined ? { message: String(message).slice(0, 400) } : {}),
          ...(timestamp !== undefined ? { timestamp: Number(timestamp) } : {}),
        };
      });

      await client.database.updateUser(userId, { reminders }, false);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] PATCH reminder:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/:userId/reminders/:reminderId', requireApiKey, async (req, res) => {
    try {
      const { userId, reminderId } = req.params;

      const user = await client.database.getUser(userId, false);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const reminders = (user.reminders ?? []).filter((r) => r.id !== reminderId);
      await client.database.updateUser(userId, { reminders }, false);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] DELETE reminder:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = usersRouter;

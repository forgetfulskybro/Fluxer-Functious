const { Router } = require('express');
const { makeRequireApiKey } = require('../middleware');

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
      });
    } catch (err) {
      console.error('[API] GET /api/users/:userId:', err);
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

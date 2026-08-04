const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');

const tempChannelsRouter = require('./routes/tempchannels');
const giveawaysRouter = require('./routes/giveaways');
const guildsRouter = require('./routes/guilds');
const oauthRouter = require('./routes/oauth');
const pollsRouter = require('./routes/polls');
const usersRouter = require('./routes/users');

function createApiServer(client) {
  const app = express();
  const port = process.env.API_PORT || 4000;
  const apiKey = process.env.API_KEY;
  const allowedOrigin = process.env.WEBSITE_URL || 'http://localhost:3000';

  app.use(express.json());
  app.use(cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  }));

  app.get('/health', (_req, res) => {
    res.json(getBotStatus(client));
  });

  app.use('/api/oauth', oauthRouter(client, apiKey));
  app.use('/api/guilds', guildsRouter(client, apiKey));
  app.use('/api/guilds/:guildId/polls', pollsRouter(client, apiKey));
  app.use('/api/guilds/:guildId/giveaways', giveawaysRouter(client, apiKey));
  app.use('/api/guilds/:guildId/tempchannels', tempChannelsRouter(client, apiKey));
  app.use('/api/users', usersRouter(client, apiKey));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/health/ws' });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify(getBotStatus(client)));

    const interval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(getBotStatus(client)));
      }
    }, 5000);

    ws.on('close', () => clearInterval(interval));
    ws.on('error', () => clearInterval(interval));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[API] :: Connected to ${port}`);
  });

  return { app, server, wss };
}

function getBotStatus(client) {
  return {
    ok: true,
    online: client.isReady ? client.isReady() : false,
    uptime: process.uptime(),
    guilds: client.guilds?.size ?? 0,
    timestamp: Date.now(),
  };
}

module.exports = createApiServer;

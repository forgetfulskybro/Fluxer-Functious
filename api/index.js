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
  const port = Number(process.env.API_PORT) || 4000;
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
    try {
      ws.send(JSON.stringify(getBotStatus(client)));
    } catch (err) {
      console.error('[API] :: Failed to send initial WS status:', err);
    }

    const interval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify(getBotStatus(client)));
        } catch (err) {
          console.error('[API] :: Failed to send WS status:', err);
          clearInterval(interval);
        }
      }
    }, 5000);

    ws.on('close', () => clearInterval(interval));
    ws.on('error', (err) => {
      console.error('[API] :: WebSocket client error:', err);
      clearInterval(interval);
    });
  });

  wss.on('error', (err) => {
    console.error('[API] :: WebSocketServer error:', err);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[API] :: Port ${port} is already in use`);
    } else if (err.code === 'EACCES') {
      console.error(`[API] :: Permission denied binding to port ${port}`);
    } else {
      console.error('[API] :: Server error:', err);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    const addr = server.address();
    console.log(`[API] :: Listening on ${addr.address}:${addr.port}`);
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
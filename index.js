require('dotenv').config({ quiet: true });
const getVoiceStates = require('./functions/getVoiceStates');
const { Collection } = require("@discordjs/collection");
const color = require("./functions/colorCodes");
const { Client } = require("@fluxerjs/core");
const Sentry = require("@sentry/node");

const client = new Client({ 
  intents: 0,
  presence: {
    custom_status: {
      emoji_id: "",
      emoji_name: "",
      text: "Looking for f!help"
    }
  },
  waitForGuilds: true
});

const TranslationHandler = require("./handlers/translation");
const DatabaseHandler = require("./handlers/database");

if (process.env.SENTRY_DSN) Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 1.0, profilesSampleRate: 1.0 });

client.config = require("./config");
client.translate = new TranslationHandler();
client.database = new DatabaseHandler(process.env.MONGODB);
client.database.connectToDatabase();
client.database.cacheSweeper(client);
client.database.guildSweeper(client);
client.sentry = Sentry;

["observedVoiceUsers", "observedVoiceBots", "reactions", "paginate", "timeout", "polls", "used", "messageCollector", "messageEdit"].forEach(x => client[x] = new Map());
["aliases", "commands", "event", "functions", "reactionHandlers"].forEach(x => client[x] = new Collection());
["command", "event", "function"].forEach(x => require(`./handlers/${x}`)(client));

process.on("unhandledRejection", (reason, p) => {
  console.log(color("%", "%4[Error_Handling] :: Unhandled Rejection/Catch%c"));
  console.log(reason);
});
process.on("uncaughtException", (err, origin) => {
  console.log(color("%", "%4[Error_Handling] :: Uncaught Exception/Catch%c"));
  console.log(err);
});
process.on("uncaughtExceptionMonitor", (err, origin) => {
  console.log(color("%", "%4[Error_Handling] :: Uncaught Exception/Catch (MONITOR)%c"));
  console.log(err);
});
 
getVoiceStates(client);
client.login(process.env.TOKEN);
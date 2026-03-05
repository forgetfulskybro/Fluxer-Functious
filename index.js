require('dotenv').config({ quiet: true });
const { Client } = require("@fluxerjs/core");
const { Collection } = require("@discordjs/collection");
const Sentry = require("@sentry/node");

const checkGiveaways = require("./functions/checkGiveaways");
const giveawaysEnd = require("./functions/giveawaysEnd");
const checkRoles = require("./functions/checkRoles");
const checkPolls = require("./functions/checkPolls");
const color = require("./functions/colorCodes");

// For self-hosted versions of Fluxer, use this layout:
// { withGuilds: true, rest: { baseURL: `https://fluxer.exeli.us/api`, api: `https://fluxer.exeli.us/api` } }
// Of course change the URLs to your hosted one's URLs
const client = new Client({ withGuilds: true }); 
const TranslationHandler = require("./handlers/translation");
const DatabaseHandler = require("./handlers/database");

if (process.env.SENTRY_DSN) Sentry.init({ dsn: process.env.SENTRY_DSN });

client.config = require("./config");
client.translate = new TranslationHandler();
client.database = new DatabaseHandler(process.env.MONGODB);
client.database.connectToDatabase();
client.database.cacheSweeper(client);
client.database.guildSweeper(client);
client.sentry = Sentry;

["reactions", "paginate", "timeout", "polls", "used", "messageCollector", "messageEdit"].forEach(x => client[x] = new Map());
["aliases", "commands", "event", "functions"].forEach(x => client[x] = new Collection());
["command", "event", "function"].forEach(x => require(`./handlers/${x}`)(client));

client.on("ready", async () => {
  console.log(color("%", `%2[Bot_Ready]%7 :: ${client.user.username} is ready`));
  
  await checkPolls(client);
  await checkGiveaways(client);
  await giveawaysEnd(client);
  await checkRoles(client);
});

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

client.login(process.env.TOKEN);
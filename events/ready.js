const checkVoiceStates = require("../functions/checkVoiceStates");
const checkGiveaways = require("../functions/checkGiveaways");
const giveawaysEnd = require("../functions/giveawaysEnd");
const checkRoles = require("../functions/checkRoles");
const checkPolls = require("../functions/checkPolls");
const color = require("../functions/colorCodes");

module.exports = async (client) => {
  console.log(color("%", `%2[Bot_Ready]%7 :: ${client.user.username} is ready`));

  setTimeout(async () => { await checkVoiceStates(client) }, 4500);
  await checkGiveaways(client);
  await giveawaysEnd(client);
  await checkPolls(client);
  await checkRoles(client);
}

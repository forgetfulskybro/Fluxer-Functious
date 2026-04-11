const { startTimedRolesCron } = require("../functions/checkTimedRoles");
const { startReminderCron } = require("../functions/checkReminders");
const { startGiveawaysCron } = require("../functions/giveawaysEnd");
const checkVoiceStates = require("../functions/checkVoiceStates");
const { startPollsCron } = require("../functions/checkPolls");
const checkRoles = require("../functions/checkRoles");
const color = require("../functions/colorCodes");

module.exports = async (client) => {
  console.log(color("%", `%2[Bot_Ready]%7 :: ${client.user.username} is ready`));

  setTimeout(async () => { await checkVoiceStates(client) }, 4500);
  startTimedRolesCron(client);
  startGiveawaysCron(client);
  startReminderCron(client);
  await checkRoles(client);
  startPollsCron(client);
}

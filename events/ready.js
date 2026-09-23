const { startCron: startScheduledCron } = require("../functions/checkScheduledMessages");
const { startCron: startTimedRolesCron } = require("../functions/checkTimedRoles");
const { startCron: startGiveawayCron } = require("../functions/checkGiveaways");
const { startCron: startPollsCron } = require("../functions/checkPolls");
const { startReminderCron } = require("../functions/checkReminders");
const { startBirthdayCheck } = require("../functions/checkBirthdays");
const checkVoiceStates = require("../functions/checkVoiceStates");
const checkManage = require("../functions/checkManage");
const checkRoles = require("../functions/checkRoles");
const color = require("../functions/colorCodes");

module.exports = async (client) => {
  console.log(color("%", `%2[Bot_Ready]%7 :: ${client.user.username} is ready`));
  
  if (client.cluster) {
    client.cluster.triggerReady();
  }

  client.user.setPresence({
    status: 'online',
    customStatus: { text: 'Looking for f!help' },
  });

  setTimeout(async () => { await checkVoiceStates(client) }, 4500);
  startTimedRolesCron(client);
  startReminderCron(client);
  startScheduledCron(client);
  startGiveawayCron(client);
  startBirthdayCheck(client);
  await checkManage(client);
  await checkRoles(client);
  startPollsCron(client);
}

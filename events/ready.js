import checkVoiceStates from "../functions/checkVoiceStates";
import checkGiveaways from "../functions/checkGiveaways";
import giveawaysEnd from "../functions/giveawaysEnd";
import checkRoles from "../functions/checkRoles";
import checkPolls from "../functions/checkPolls";
import color from "../functions/colorCodes";

export default async (client) => {
  console.log(color("%", `%2[Bot_Ready]%7 :: ${client.user.username} is ready`));

  setTimeout(async () => { await checkVoiceStates(client) }, 4500);
  await checkGiveaways(client);
  await giveawaysEnd(client);
  await checkPolls(client);
  await checkRoles(client);
}

const { EmbedBuilder } = require("@fluxerjs/core");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CDN_LANG = {
  en_EN: "https://functious-cdn.vercel.app/api/images/ef27463013d7f69f67a0f3eb38129717.png",
  es_ES: "https://functious-cdn.vercel.app/api/images/9e51affa3d366da1cb46aba84246d712.png",
  pt_BR: "https://functious-cdn.vercel.app/api/images/bf709079782d5097798381835cf1e69b.png",
  ar_AR: "https://functious-cdn.vercel.app/api/images/2791aacd0a1aef7ae25e124759f601a7.png",
};

const MANAGE_REACTIONS = [
  '<:rename:1502164676598628060>',
  '<:userlimit:1502164677802393309>',
  '<:region:1502164672647593687>',
  '<:privacy:1502164674153348824>',
  '<:unblock:1502164681409494751>',
  '<:block:1502164675642326745>',
  '<:transfer:1502164678616088286>',
  '<:close:1502185371235901763>',
];

async function sendManagePanel(client, channel, db, inVc = channel?.type === 2) {
  const embed = new EmbedBuilder()
    .setColor(db.theme)
    .setTitle(client.translate.get(db.language, "Commands.tempchannels.manageTitle"))
    .setImage(CDN_LANG[db.language] ?? CDN_LANG.en_EN)
    .setFooter({ text: client.translate.get(db.language, inVc ? "Commands.tempchannels.manageFooterVc" : "Commands.tempchannels.manageFooter") });

  const message = await channel.send({ embeds: [embed] });

  for (const reaction of MANAGE_REACTIONS) {
    await message.react(reaction).catch(() => {});
    await delay(250);
  }

  return message;
}

module.exports = { sendManagePanel, MANAGE_REACTIONS, CDN_LANG };

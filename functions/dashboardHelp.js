const COMMAND_DASHBOARD_PAGES = Object.freeze({
  autoroles: "roles-permissions",
  birthday: "birthdays",
  bypass: "roles-permissions",
  events: "events",
  forms: "forms",
  giveaway: "giveaways",
  language: "configuration",
  mediachannels: "media-channels",
  policy: "configuration?tab=policies",
  polls: "polls",
  prefix: "configuration",
  roles: "reaction-roles",
  schedule: "schedules",
  sticky: "stickies",
  tags: "tags",
  tempchannels: "tempchannels",
  theme: "configuration",
});

function dashboardUrl(guildId, page = "") {
  const base = (process.env.WEBSITE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const path = page ? `/${String(page).replace(/^\/+/, "")}` : "";
  return guildId ? `${base}/dashboard/${guildId}${path}` : `${base}/dashboard`;
}

function dashboardHelpBody(client, db, guildId, page) {
  const url = dashboardUrl(guildId, page);
  return client.translate.get(
    db.language,
    "Commands.help.embeds.first.dashboardLink",
    { url }
  );
}

function dashboardHelpText(client, db, guildId, page) {
  const title = client.translate.get(
    db.language,
    "Commands.help.embeds.first.dashboard"
  );
  return `**${title}**\n${dashboardHelpBody(client, db, guildId, page)}`;
}

function dashboardHelpField(client, db, guildId, page) {
  return {
    name: client.translate.get(db.language, "Commands.help.embeds.first.dashboard"),
    value: dashboardHelpBody(client, db, guildId, page),
    inline: false,
  };
}

function dashboardPageForCommand(commandName) {
  return COMMAND_DASHBOARD_PAGES[String(commandName ?? "").toLowerCase()] ?? null;
}

module.exports = {
  COMMAND_DASHBOARD_PAGES,
  dashboardHelpBody,
  dashboardHelpField,
  dashboardHelpText,
  dashboardPageForCommand,
  dashboardUrl,
};

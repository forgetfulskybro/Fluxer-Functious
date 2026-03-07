const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
module.exports = {
  config: {
    name: "bypass",
    usage: true,
    cooldown: 2000,
    available: false,
    permissions: {
      name: "Manage Guild",
      bitField: PermissionFlags.ManageGuild,
    },
    aliases: [],
  },
  run: async (client, message, args, db) => {
    
  }
}
const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const Paginator = require('../functions/pagination');

module.exports = {
  config: {
    name: "tags",
    usage: "help",
    cooldown: 3000,
    available: true,
    permissions: {
      name: "Manage Guild",
      bitField: PermissionFlags.ManageGuild,
    },
    aliases: ["tag"],
  },
  run: async (client, message, args, db) => {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      default:
        if (args[0]) {
          const tagName = args[0];
          const tag = db.tags?.find(t => t.name.toLowerCase() === tagName.toLowerCase());
          
          if (!tag) {
            return message.reply({
              embeds: [
                new EmbedBuilder()
                  .setDescription(client.translate.get(db.language, "Commands.tags.notFound", { "name": tagName }))
                  .setColor("#FF0000")
              ]
            });
          }
          
          tag.uses++;
          await client.database.updateGuild(message.guild.id, { tags: db.tags });
          
          if (tag.type === "text") {
            message.channel.send({ content: tag.content });
          } else if (tag.type === "embed") {
            const embed = new EmbedBuilder()
              .setColor(tag.embedData.color || "#A52F05")
              .setDescription(tag.embedData.description);
            
            message.channel.send({ embeds: [embed] });
          }
          return;
        }
      case "help":
        const embed = new EmbedBuilder()
          .setColor("#A52F05")
          .setTitle(client.translate.get(db.language, "Commands.tags.title"))
          .setDescription(
            `**${client.translate.get(db.language, "Commands.tags.creatingTags")}**\n\`${db.prefix}tags add ${client.translate.get(db.language, "Commands.tags.placeholders.name")} text ${client.translate.get(db.language, "Commands.tags.placeholders.content")}\` - ${client.translate.get(db.language, "Commands.tags.creatingText")}\n\`${db.prefix}tags add ${client.translate.get(db.language, "Commands.tags.placeholders.name")} embed ${client.translate.get(db.language, "Commands.tags.placeholders.description")}\` - ${client.translate.get(db.language, "Commands.tags.creatingEmbed")}\n\n**${client.translate.get(db.language, "Commands.tags.usingTags")}**\n\`${db.prefix}tags ${client.translate.get(db.language, "Commands.tags.placeholders.name")}\` - ${client.translate.get(db.language, "Commands.tags.sendTag")}\n\n**${client.translate.get(db.language, "Commands.tags.managingTags")}**\n\`${db.prefix}tags list\` - ${client.translate.get(db.language, "Commands.tags.listTags")}\n\`${db.prefix}tags view ${client.translate.get(db.language, "Commands.tags.placeholders.name")}\` - ${client.translate.get(db.language, "Commands.tags.viewDetails")}\n\`${db.prefix}tags edit ${client.translate.get(db.language, "Commands.tags.placeholders.name")}\` - ${client.translate.get(db.language, "Commands.tags.editTag")}\n\`${db.prefix}tags remove ${client.translate.get(db.language, "Commands.tags.placeholders.name")}\` - ${client.translate.get(db.language, "Commands.tags.deleteTag")}`
          );
        message.reply({ embeds: [embed] });
        break;

      case "add":
        if (!args[1]) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(`${client.translate.get(db.language, "Commands.tags.provideName")}\n${client.translate.get(db.language, "Commands.tags.usage")}: \`${db.prefix}tags add ${client.translate.get(db.language, "Commands.tags.placeholders.name")} text ${client.translate.get(db.language, "Commands.tags.placeholders.content")}\``)
                .setColor("#FF0000")
            ]
          });
        }
        
        const tagName = args[1];
        
        if (tagName.includes(' ')) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(client.translate.get(db.language, "Commands.tags.noSpaces"))
                .setColor("#FF0000")
            ]
          });
        }
        
        if (tagName.length < 1 || tagName.length > 32) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(client.translate.get(db.language, "Commands.tags.nameLength"))
                .setColor("#FF0000")
            ]
          });
        }
        
        const existingTag = db.tags?.find(t => t.name.toLowerCase() === tagName.toLowerCase());
        if (existingTag) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(client.translate.get(db.language, "Commands.tags.alreadyExists", { "name": tagName }))
                .setColor("#FF0000")
            ]
          });
        }
        
        if (db.tags?.length >= 50) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(client.translate.get(db.language, "Commands.tags.maxTags"))
                .setColor("#FF0000")
            ]
          });
        }
        
        if (!args[2]) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(`${client.translate.get(db.language, "Commands.tags.specifyType")}\n${client.translate.get(db.language, "Commands.tags.usage")}: \`${db.prefix}tags add ${client.translate.get(db.language, "Commands.tags.placeholders.name")} text ${client.translate.get(db.language, "Commands.tags.placeholders.content")}\``)
                .setColor("#FF0000")
            ]
          });
        }
        
        const tagType = args[2].toLowerCase();
        if (tagType !== "text" && tagType !== "embed") {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(client.translate.get(db.language, "Commands.tags.invalidType"))
                .setColor("#FF0000")
            ]
          });
        }
        
        const content = args.slice(3).join(' ');
        
        if (!content && tagType === "text") {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(`${client.translate.get(db.language, "Commands.tags.provideContent")}\n${client.translate.get(db.language, "Commands.tags.usage")}: \`${db.prefix}tags add ${client.translate.get(db.language, "Commands.tags.placeholders.name")} text ${client.translate.get(db.language, "Commands.tags.placeholders.content")}\``)
                .setColor("#FF0000")
            ]
          });
        }
        
        if (!content && tagType === "embed") {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(`${client.translate.get(db.language, "Commands.tags.provideDescription")}\n${client.translate.get(db.language, "Commands.tags.usage")}: \`${db.prefix}tags add ${client.translate.get(db.language, "Commands.tags.placeholders.name")} embed ${client.translate.get(db.language, "Commands.tags.placeholders.description")}\``)
                .setColor("#FF0000")
            ]
          });
        }
        
        if (tagType === "text" && content.length > 2000) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(client.translate.get(db.language, "Commands.tags.textTooLong"))
                .setColor("#FF0000")
            ]
          });
        }
        
        if (tagType === "embed" && content.length > 4096) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(client.translate.get(db.language, "Commands.tags.embedTooLong"))
                .setColor("#FF0000")
            ]
          });
        }
        
        const newTag = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: tagName,
          type: tagType,
          content: tagType === "text" ? content : null,
          embedData: tagType === "embed" ? { description: content } : null,
          createdBy: message.author.id,
          createdAt: Date.now(),
          uses: 0
        };
        
        await client.database.updateGuild(message.guild.id, { tags: [...(db.tags || []), newTag] });
        
        message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(client.translate.get(db.language, "Commands.tags.createdSuccess", { "name": tagName }))
              .setColor("#A52F05")
          ]
        });
        break;

      case "remove":
        if (!args[1]) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(`${client.translate.get(db.language, "Commands.tags.provideRemoveName")}\n${client.translate.get(db.language, "Commands.tags.usage")}: \`${db.prefix}tags remove ${client.translate.get(db.language, "Commands.tags.placeholders.name")}\``)
                .setColor("#FF0000")
            ]
          });
        }
        
        const tagToRemove = args[1];
        const tagIndex = db.tags?.findIndex(t => t.name.toLowerCase() === tagToRemove.toLowerCase());
        
        if (tagIndex === -1 || tagIndex === undefined) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(client.translate.get(db.language, "Commands.tags.notFound", { "name": tagToRemove }))
                .setColor("#FF0000")
            ]
          });
        }
        
        const removedTag = db.tags[tagIndex];
        
        const confirmEmbed = new EmbedBuilder()
          .setColor("#A52F05")
          .setDescription(client.translate.get(db.language, "Commands.tags.confirmDelete", { "name": removedTag.name }))
          .addFields(
            { name: client.translate.get(db.language, "Commands.tags.type"), value: removedTag.type === "text" ? client.translate.get(db.language, "Commands.tags.text") : client.translate.get(db.language, "Commands.tags.embed"), inline: true },
            { name: client.translate.get(db.language, "Commands.tags.uses"), value: removedTag.uses.toString(), inline: true }
          );
        
        const confirmMsg = await message.reply({ embeds: [confirmEmbed] });
        await confirmMsg.react("✅");
        await confirmMsg.react("❌");
        
        const filter = (reaction, user) => {
          return ["✅", "❌"].includes(reaction.emoji.name) && user.id === message.author.id;
        };
        
        try {
          const collector = confirmMsg.createReactionCollector({ filter, time: 30000 });
          
          collector.on("collect", async (reaction) => {
            if (reaction.emoji.name === "✅") {
              const updatedTags = db.tags.filter((_, i) => i !== tagIndex);
              await client.database.updateGuild(message.guild.id, { tags: updatedTags });
              
              await confirmMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setDescription(client.translate.get(db.language, "Commands.tags.deletedSuccess", { "name": removedTag.name }))
                    .setColor("#A52F05")
                ]
              });
              await confirmMsg.removeAllReactions();
            } else if (reaction.emoji.name === "❌") {
              await confirmMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setDescription(client.translate.get(db.language, "Commands.tags.deleteCancelled"))
                    .setColor("#A52F05")
                ]
              });
              await confirmMsg.removeAllReactions();
            }
            collector.stop();
          });
          
          collector.on("end", (collected, reason) => {
            if (reason === "time") {
              confirmMsg.removeAllReactions().catch(() => {});
            }
          });
        } catch (err) {
          console.error("Error in reaction collector:", err);
        }
        break;

      case "edit":
        if (!args[1]) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(`${client.translate.get(db.language, "Commands.tags.provideEditName")}\n${client.translate.get(db.language, "Commands.tags.usage")}: \`${db.prefix}tags edit ${client.translate.get(db.language, "Commands.tags.placeholders.name")}\``)
                .setColor("#FF0000")
            ]
          });
        }
        
        const tagToEdit = args[1];
        const editTagIndex = db.tags?.findIndex(t => t.name.toLowerCase() === tagToEdit.toLowerCase());
        
        if (editTagIndex === -1 || editTagIndex === undefined) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(client.translate.get(db.language, "Commands.tags.notFound", { "name": tagToEdit }))
                .setColor("#FF0000")
            ]
          });
        }
        
        const editingTag = db.tags[editTagIndex];
        
        const currentInfo = new EmbedBuilder()
          .setColor("#A52F05")
          .setTitle(client.translate.get(db.language, "Commands.tags.editing", { "name": editingTag.name }))
          .addFields(
            { name: client.translate.get(db.language, "Commands.tags.type"), value: editingTag.type === "text" ? `📝 ${client.translate.get(db.language, "Commands.tags.text")}` : `📄 ${client.translate.get(db.language, "Commands.tags.embed")}`, inline: true },
            { name: client.translate.get(db.language, "Commands.tags.uses"), value: editingTag.uses.toString(), inline: true },
            { name: client.translate.get(db.language, "Commands.tags.created"), value: `<t:${Math.floor(editingTag.createdAt / 1000)}:R>`, inline: true }
          );
        
        if (editingTag.type === "text") {
          currentInfo.addFields({ name: client.translate.get(db.language, "Commands.tags.content"), value: editingTag.content.substring(0, 1024) + (editingTag.content.length > 1024 ? "..." : "") });
        } else {
          currentInfo.addFields({ name: client.translate.get(db.language, "Commands.tags.descriptionField"), value: editingTag.embedData.description.substring(0, 1024) + (editingTag.embedData.description.length > 1024 ? "..." : "") });
        }
        
        const menuEmbed = new EmbedBuilder()
          .setColor("#A52F05")
          .setTitle(client.translate.get(db.language, "Commands.tags.editOptions"))
          .setDescription(client.translate.get(db.language, "Commands.tags.editOptionsDesc"))
          .addFields(
            { name: "1️⃣", value: client.translate.get(db.language, "Commands.tags.editName"), inline: true },
            { name: "2️⃣", value: client.translate.get(db.language, "Commands.tags.editContent"), inline: true },
            { name: "3️⃣", value: client.translate.get(db.language, "Commands.tags.toggleType"), inline: true },
            { name: "❌", value: client.translate.get(db.language, "Commands.tags.cancel"), inline: true }
          );
        
        const menuMsg = await message.reply({ embeds: [currentInfo, menuEmbed] });
        await menuMsg.react("1️⃣");
        await menuMsg.react("2️⃣");
        await menuMsg.react("3️⃣");
        await menuMsg.react("❌");
        
        const editFilter = (reaction, user) => {
          return ["1️⃣", "2️⃣", "3️⃣", "❌"].includes(reaction.emoji.name) && user.id === message.author.id;
        };
        
        try {
          const editCollector = menuMsg.createReactionCollector({ filter: editFilter, time: 60000 });
          
          editCollector.on("collect", async (reaction) => {
            if (reaction.emoji.name === "1️⃣") {
              await menuMsg.removeAllReactions();
              await menuMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setColor("#A52F05")
                    .setDescription(client.translate.get(db.language, "Commands.tags.replyNewName"))
                ]
              });
              
              const nameFilter = (m) => m.author.id === message.author.id;
              const nameCollector = message.channel.createMessageCollector({ filter: nameFilter, time: 60000, max: 1 });
              
              nameCollector.on("collect", async (m) => {
                const newName = m.content.trim();
                
                if (newName.includes(' ')) {
                  return m.reply({
                    embeds: [
                      new EmbedBuilder()
                        .setDescription(client.translate.get(db.language, "Commands.tags.noSpaces"))
                        .setColor("#FF0000")
                    ]
                  });
                }
                
                if (newName.length < 1 || newName.length > 32) {
                  return m.reply({
                    embeds: [
                      new EmbedBuilder()
                        .setDescription(client.translate.get(db.language, "Commands.tags.nameLength"))
                        .setColor("#FF0000")
                    ]
                  });
                }
                
                const duplicateCheck = db.tags?.find(t => t.name.toLowerCase() === newName.toLowerCase() && t.id !== editingTag.id);
                if (duplicateCheck) {
                  return m.reply({
                    embeds: [
                      new EmbedBuilder()
                        .setDescription(client.translate.get(db.language, "Commands.tags.alreadyExists", { "name": newName }))
                        .setColor("#FF0000")
                    ]
                  });
                }
                
                const updatedTags = [...db.tags];
                updatedTags[editTagIndex].name = newName;
                await client.database.updateGuild(message.guild.id, { tags: updatedTags });
                
                await menuMsg.edit({
                  embeds: [
                    new EmbedBuilder()
                      .setDescription(client.translate.get(db.language, "Commands.tags.nameChanged", { "name": newName }))
                      .setColor("#A52F05")
                  ]
                });
                nameCollector.stop();
              });
              
            } else if (reaction.emoji.name === "2️⃣") {
              await menuMsg.removeAllReactions();
              await menuMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setColor("#A52F05")
                    .setDescription(client.translate.get(db.language, "Commands.tags.replyNewContent"))
                ]
              });
              
              const contentFilter = (m) => m.author.id === message.author.id;
              const contentCollector = message.channel.createMessageCollector({ filter: contentFilter, time: 60000, max: 1 });
              
              contentCollector.on("collect", async (m) => {
                const newContent = m.content.trim();
                
                if (editingTag.type === "text" && newContent.length > 2000) {
                  return m.reply({
                    embeds: [
                      new EmbedBuilder()
                        .setDescription(client.translate.get(db.language, "Commands.tags.textTooLong"))
                        .setColor("#FF0000")
                    ]
                  });
                }
                
                if (editingTag.type === "embed" && newContent.length > 4096) {
                  return m.reply({
                    embeds: [
                      new EmbedBuilder()
                        .setDescription(client.translate.get(db.language, "Commands.tags.embedTooLong"))
                        .setColor("#FF0000")
                    ]
                  });
                }
                
                const updatedTags = [...db.tags];
                if (editingTag.type === "text") {
                  updatedTags[editTagIndex].content = newContent;
                } else {
                  updatedTags[editTagIndex].embedData.description = newContent;
                }
                await client.database.updateGuild(message.guild.id, { tags: updatedTags });
                
                await menuMsg.edit({
                  embeds: [
                    new EmbedBuilder()
                      .setDescription(client.translate.get(db.language, "Commands.tags.contentUpdated"))
                      .setColor("#A52F05")
                  ]
                });
                contentCollector.stop();
              });
              
            } else if (reaction.emoji.name === "3️⃣") {
              const updatedTags = [...db.tags];
              const oldType = updatedTags[editTagIndex].type;
              const newType = oldType === "text" ? "embed" : "text";
              
              if (oldType === "text") {
                const textContent = updatedTags[editTagIndex].content;
                updatedTags[editTagIndex].type = "embed";
                updatedTags[editTagIndex].embedData = { description: textContent };
                updatedTags[editTagIndex].content = null;
              } else {
                const embedDescription = updatedTags[editTagIndex].embedData.description;
                updatedTags[editTagIndex].type = "text";
                updatedTags[editTagIndex].content = embedDescription;
                updatedTags[editTagIndex].embedData = null;
              }
              
              await client.database.updateGuild(message.guild.id, { tags: updatedTags });
              
              await menuMsg.removeAllReactions();
              await menuMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setDescription(client.translate.get(db.language, "Commands.tags.typeChanged", { "oldType": oldType, "newType": newType }))
                    .setColor("#A52F05")
                ]
              });
              
            } else if (reaction.emoji.name === "❌") {
              await menuMsg.removeAllReactions();
              await menuMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setDescription(client.translate.get(db.language, "Commands.tags.editCancelled"))
                    .setColor("#A52F05")
                ]
              });
            }
            editCollector.stop();
          });
          
          editCollector.on("end", (collected, reason) => {
            if (reason === "time") {
              menuMsg.removeAllReactions().catch(() => {});
            }
          });
        } catch (err) {
          console.error("Error in edit collector:", err);
        }
        break;

      case "view":
        if (!args[1]) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(`${client.translate.get(db.language, "Commands.tags.provideViewName")}\n${client.translate.get(db.language, "Commands.tags.usage")}: \`${db.prefix}tags view ${client.translate.get(db.language, "Commands.tags.placeholders.name")}\``)
                .setColor("#FF0000")
            ]
          });
        }
        
        const tagToView = args[1];
        const viewTag = db.tags?.find(t => t.name.toLowerCase() === tagToView.toLowerCase());
        
        if (!viewTag) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(client.translate.get(db.language, "Commands.tags.notFound", { "name": tagToView }))
                .setColor("#FF0000")
            ]
          });
        }
        
        const viewEmbed = new EmbedBuilder()
          .setColor("#A52F05")
          .setTitle(client.translate.get(db.language, "Commands.tags.tagInfo", { "name": viewTag.name }))
          .addFields(
            { name: client.translate.get(db.language, "Commands.tags.type"), value: viewTag.type === "text" ? `📝 ${client.translate.get(db.language, "Commands.tags.text")}` : `📄 ${client.translate.get(db.language, "Commands.tags.embed")}`, inline: true },
            { name: client.translate.get(db.language, "Commands.tags.uses"), value: viewTag.uses.toString(), inline: true },
            { name: client.translate.get(db.language, "Commands.tags.createdBy"), value: `<@${viewTag.createdBy}>`, inline: true },
            { name: client.translate.get(db.language, "Commands.tags.createdAt"), value: `<t:${Math.floor(viewTag.createdAt / 1000)}:F>`, inline: true }
          );
        
        if (viewTag.type === "text") {
          viewEmbed.addFields({ name: client.translate.get(db.language, "Commands.tags.content"), value: viewTag.content.substring(0, 1024) + (viewTag.content.length > 1024 ? "..." : "") });
        } else {
          viewEmbed.addFields({ name: client.translate.get(db.language, "Commands.tags.descriptionField"), value: viewTag.embedData.description.substring(0, 1024) + (viewTag.embedData.description.length > 1024 ? "..." : "") });
        }
        
        message.reply({ embeds: [viewEmbed] });
        break;

      case "list":
        if (!db.tags || db.tags.length === 0) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(client.translate.get(db.language, "Commands.tags.noTags"))
                .setColor("#FF0000")
            ]
          });
        }
        
        const tagsPerPage = 10;
        const pages = [];
        
        for (let i = 0; i < db.tags.length; i += tagsPerPage) {
          const pageTags = db.tags.slice(i, i + tagsPerPage);
          const pageEmbed = new EmbedBuilder()
            .setColor("#A52F05")
            .setTitle(client.translate.get(db.language, "Commands.tags.tagsList"))
            .setDescription(pageTags.map((tag, index) => {
              const emoji = tag.type === "text" ? "📝" : "📄";
              return `**${i + index + 1}.** ${tag.name} - ${tag.uses} ${client.translate.get(db.language, "Commands.tags.uses")} (${emoji})`;
            }).join("\n"));
          pages.push(pageEmbed);
        }
        
        const paginator = new Paginator({
          user: message.author.id,
          client: client,
          timeout: 60000
        });
        
        pages.forEach(page => paginator.add(page));
        await paginator.start(message.channel);
        break;
    }
  },
};

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  AuditLogEvent
} = require("discord.js");

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const BOT_CONTROL_SECRET = process.env.BOT_CONTROL_SECRET;
const PORT = process.env.PORT || 3000;

const CONFIG_FILE = path.join(__dirname, "logs-config.json");

if (!TOKEN) throw new Error("Missing DISCORD_TOKEN");
if (!CLIENT_ID) throw new Error("Missing DISCORD_CLIENT_ID");
if (!BOT_CONTROL_SECRET) throw new Error("Missing BOT_CONTROL_SECRET");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.GuildMember
  ]
});

const LOG_TYPES = {
  deletedMessages: "Deleted Messages",
  editedMessages: "Edited Messages",
  memberJoin: "Member Joined",
  memberLeave: "Member Left",
  voiceJoin: "Voice Joined",
  voiceLeave: "Voice Left",
  roleAdded: "Role Added",
  roleRemoved: "Role Removed",
  channelCreated: "Channel Created",
  channelDeleted: "Channel Deleted",
  channelUpdated: "Channel Updated",
  roleUpdated: "Role Updated",
  nameChanged: "Nickname Changed",
  serverUpdated: "Server Updated",
  memberBanned: "Member Banned",
  voiceMuted: "Voice Muted"
};

const TYPE_NAMES = Object.keys(LOG_TYPES);

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Config load error:", error);
  }

  return {};
}

let config = loadConfig();

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function ensureGuildConfig(guildId) {
  if (!config[guildId]) config[guildId] = {};

  for (const type of TYPE_NAMES) {
    if (!config[guildId][type]) {
      config[guildId][type] = {
        channelId: null,
        enabled: false
      };
    }
  }

  saveConfig();
}

function userLabel(user) {
  if (!user) return "Unknown";

  return `${user.tag || user.username || "Unknown"}\nID: ${user.id}`;
}

function getAvatarURL(user) {
  if (!user || typeof user.displayAvatarURL !== "function") {
    return null;
  }

  return user.displayAvatarURL({
    size: 256,
    extension: "png"
  });
}

async function sendLog(
  guild,
  type,
  description,
  actor = null,
  target = null,
  extraFields = []
) {
  try {
    if (!guild) return;

    ensureGuildConfig(guild.id);

    const entry = config[guild.id][type];

    if (!entry || !entry.enabled || !entry.channelId) return;

    const channel = await guild.channels
      .fetch(entry.channelId)
      .catch(() => null);

    if (!channel || !channel.isTextBased() || !channel.send) return;

    const embed = new EmbedBuilder()
      .setColor(0x8b0000)
      .setTitle(`PW VENOM LOG • ${LOG_TYPES[type] || type}`)
      .setDescription(
        String(description || "No details available").slice(0, 4000)
      )
      .setFooter({
        text: `Server: ${guild.name} • ID: ${guild.id}`
      })
      .setTimestamp();

    if (actor) {
      const actorUser = actor.user || actor;
      const avatarURL = getAvatarURL(actorUser);

      embed.addFields({
        name: "Actor",
        value: userLabel(actorUser).slice(0, 1024),
        inline: true
      });

      if (avatarURL) {
        embed.setAuthor({
          name: actorUser.tag || actorUser.username || "Unknown",
          iconURL: avatarURL
        });

        embed.setThumbnail(avatarURL);
      }
    } else {
      embed.addFields({
        name: "Actor",
        value: "Unknown — actor could not be identified",
        inline: true
      });
    }

    if (target) {
      embed.addFields({
        name: "Target",
        value: String(target).slice(0, 1024),
        inline: true
      });
    }

    for (const field of extraFields) {
      embed.addFields({
        name: String(field.name).slice(0, 256),
        value: String(field.value || "None").slice(0, 1024),
        inline: field.inline ?? false
      });
    }

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Log send error:", error.message);
  }
}

async function findAuditActor(guild, auditType, targetId = null) {
  try {
    const logs = await guild.fetchAuditLogs({
      type: auditType,
      limit: 6
    });

    const now = Date.now();

    const entry = logs.entries.find(item => {
      const recent = now - item.createdTimestamp < 15000;
      const targetMatches =
        !targetId || item.target?.id === targetId;

      return recent && targetMatches;
    });

    return entry || null;
  } catch (error) {
    console.error("Audit log unavailable:", error.message);
    return null;
  }
}

// Dashboard API
const app = express();

app.use(express.json({ limit: "20kb" }));

function authenticateApi(req, res, next) {
  const auth = req.headers.authorization || "";
  const expected = `Bearer ${BOT_CONTROL_SECRET}`;

  const a = Buffer.from(auth);
  const b = Buffer.from(expected);

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    botReady: client.isReady()
  });
});

app.get(
  "/api/guilds/:guildId/config",
  authenticateApi,
  (req, res) => {
    const { guildId } = req.params;

    if (!/^\d{17,20}$/.test(guildId)) {
      return res.status(400).json({
        error: "Invalid guild ID"
      });
    }

    if (!client.guilds.cache.has(guildId)) {
      return res.status(404).json({
        error: "Bot is not in this server"
      });
    }

    ensureGuildConfig(guildId);

    const settings = config[guildId];

    const channelId =
      Object.values(settings).find(entry => entry.channelId)?.channelId || "";

    const events = TYPE_NAMES.filter(type => settings[type].enabled);

    res.json({
      channelId,
      events,
      settings
    });
  }
);

app.put(
  "/api/guilds/:guildId/config",
  authenticateApi,
  async (req, res) => {
    try {
      const { guildId } = req.params;

      if (!/^\d{17,20}$/.test(guildId)) {
        return res.status(400).json({
          error: "Invalid guild ID"
        });
      }

      const guild = client.guilds.cache.get(guildId);

      if (!guild) {
        return res.status(404).json({
          error: "Bot is not in this server"
        });
      }

      const { channelId, events } = req.body || {};

      if (
        typeof channelId !== "string" ||
        !Array.isArray(events) ||
        !events.every(
          type => typeof type === "string" && TYPE_NAMES.includes(type)
        )
      ) {
        return res.status(400).json({
          error: "Invalid channelId or events"
        });
      }

      const channel = await guild.channels
        .fetch(channelId)
        .catch(() => null);

      if (!channel || channel.type !== ChannelType.GuildText) {
        return res.status(400).json({
          error: "Channel must be a text channel"
        });
      }

      const botMember = guild.members.me;
      const permissions = botMember
        ? channel.permissionsFor(botMember)
        : null;

      if (
        !permissions ||
        !permissions.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks
        ])
      ) {
        return res.status(400).json({
          error: "Bot lacks permissions in the selected channel"
        });
      }

      ensureGuildConfig(guildId);

      for (const type of TYPE_NAMES) {
        config[guildId][type] = {
          channelId,
          enabled: events.includes(type)
        };
      }

      saveConfig();

      res.json({
        ok: true,
        message: "Log settings saved"
      });
    } catch (error) {
      console.error("API save error:", error);

      res.status(500).json({
        error: "Could not save configuration"
      });
    }
  }
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`PW VENOM LOG API listening on port ${PORT}`);
});

// Slash command
const setupCommand = new SlashCommandBuilder()
  .setName("setup-logs")
  .setDescription("Configure PW VENOM LOG")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

client.once(Events.ClientReady, async readyClient => {
  console.log(`PW VENOM LOG online as ${readyClient.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: [setupCommand.toJSON()] }
    );

    console.log("Slash commands registered");
  } catch (error) {
    console.error("Command registration error:", error);
  }
});

// Setup menu
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "setup-logs"
    ) {
      if (
        !interaction.guild ||
        !interaction.memberPermissions?.has(
          PermissionFlagsBits.Administrator
        )
      ) {
        return interaction.reply({
          content: "Administrator permission required.",
          ephemeral: true
        });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId("pw_log_type")
        .setPlaceholder("Choose a log event")
        .addOptions(
          TYPE_NAMES.map(type => ({
            label: LOG_TYPES[type],
            value: type
          }))
        );

      return interaction.reply({
        content: "Choose a log event to configure.",
        components: [
          new ActionRowBuilder().addComponents(menu)
        ],
        ephemeral: true
      });
    }

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "pw_log_type"
    ) {
      const type = interaction.values[0];

      const channelMenu = new ChannelSelectMenuBuilder()
        .setCustomId(`pw_log_channel:${type}`)
        .setPlaceholder("Choose a log channel")
        .setChannelTypes(ChannelType.GuildText);

      return interaction.update({
        content: `Selected: ${LOG_TYPES[type]}. Choose a channel.`,
        components: [
          new ActionRowBuilder().addComponents(channelMenu)
        ]
      });
    }

    if (
      interaction.isChannelSelectMenu() &&
      interaction.customId.startsWith("pw_log_channel:")
    ) {
      const type = interaction.customId.split(":")[1];
      const channelId = interaction.values[0];

      if (!TYPE_NAMES.includes(type)) {
        return interaction.reply({
          content: "Unknown log type.",
          ephemeral: true
        });
      }

      ensureGuildConfig(interaction.guildId);

      config[interaction.guildId][type].channelId = channelId;

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`pw_log_enable:${type}`)
          .setLabel("Enable")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`pw_log_disable:${type}`)
          .setLabel("Disable")
          .setStyle(ButtonStyle.Danger)
      );

      saveConfig();

      return interaction.update({
        content: `Channel saved for ${LOG_TYPES[type]}.`,
        components: [buttons]
      });
    }

    if (
      interaction.isButton() &&
      /^(pw_log_enable|pw_log_disable):/.test(interaction.customId)
    ) {
      const [action, type] = interaction.customId.split(":");

      if (!TYPE_NAMES.includes(type)) {
        return interaction.reply({
          content: "Unknown log type.",
          ephemeral: true
        });
      }

      ensureGuildConfig(interaction.guildId);

      config[interaction.guildId][type].enabled =
        action === "pw_log_enable";

      saveConfig();

      return interaction.update({
        content: `${LOG_TYPES[type]}: ${
          action === "pw_log_enable" ? "Enabled" : "Disabled"
        }.`,
        components: []
      });
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "An error occurred. Check the bot logs.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// 1. Deleted messages
client.on(Events.MessageDelete, async message => {
  if (!message.guild || message.author?.bot) return;

  const audit = await findAuditActor(
    message.guild,
    AuditLogEvent.MessageDelete,
    message.author?.id
  );

  await sendLog(
    message.guild,
    "deletedMessages",
    `Message deleted in <#${message.channelId}>.`,
    audit?.executor || null,
    message.author ? userLabel(message.author) : "Message author unavailable",
    [
      {
        name: "Deleted Content",
        value: message.content || "Content unavailable"
      },
      {
        name: "Channel ID",
        value: message.channelId
      }
    ]
  );
});

// 2. Edited messages
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;

  try {
    if (oldMessage.partial) {
      oldMessage = await oldMessage.fetch().catch(() => oldMessage);
    }

    if (newMessage.partial) {
      newMessage = await newMessage.fetch().catch(() => newMessage);
    }

    if (newMessage.author?.bot) return;

    const before = oldMessage.content || "Content unavailable";
    const after = newMessage.content || "Content unavailable";

    if (before === after) return;

    await sendLog(
      newMessage.guild,
      "editedMessages",
      `Message edited in <#${newMessage.channelId}>.`,
      newMessage.author,
      userLabel(newMessage.author),
      [
        { name: "Before", value: before },
        { name: "After", value: after },
        {
          name: "Message Link",
          value: `https://discord.com/channels/${newMessage.guild.id}/${newMessage.channelId}/${newMessage.id}`
        }
      ]
    );
  } catch (error) {
    console.error("Message update error:", error);
  }
});

// 3. Member joined
client.on(Events.GuildMemberAdd, member => {
  sendLog(
    member.guild,
    "memberJoin",
    `${member.user.tag} joined the server.`,
    member.user,
    userLabel(member.user)
  );
});

// 4. Member left
client.on(Events.GuildMemberRemove, member => {
  sendLog(
    member.guild,
    "memberLeave",
    `${member.user.tag} left the server.`,
    member.user,
    userLabel(member.user)
  );
});

// 5, 6, 16. Voice join, leave, and server mute
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const member = newState.member || oldState.member;

  if (!member || member.user.bot) return;

  if (!oldState.channelId && newState.channelId) {
    await sendLog(
      member.guild,
      "voiceJoin",
      `${member.user.tag} joined <#${newState.channelId}>.`,
      member.user,
      userLabel(member.user)
    );
  }

  if (oldState.channelId && !newState.channelId) {
    await sendLog(
      member.guild,
      "voiceLeave",
      `${member.user.tag} left <#${oldState.channelId}>.`,
      member.user,
      userLabel(member.user)
    );
  }

  if (oldState.serverMute !== newState.serverMute) {
    const audit = await findAuditActor(
      member.guild,
      AuditLogEvent.MemberUpdate,
      member.id
    );

    await sendLog(
      member.guild,
      "voiceMuted",
      `${member.user.tag} server mute changed to ${newState.serverMute}.`,
      audit?.executor || null,
      userLabel(member.user),
      [
        {
          name: "Server Muted",
          value: String(newState.serverMute)
        }
      ]
    );
  }
});

// 7, 8, 13. Role and nickname changes
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());

  for (const roleId of newRoles) {
    if (!oldRoles.has(roleId)) {
      const role = newMember.guild.roles.cache.get(roleId);

      const audit = await findAuditActor(
        newMember.guild,
        AuditLogEvent.MemberRoleUpdate,
        newMember.id
      );

      if (role) {
        await sendLog(
          newMember.guild,
          "roleAdded",
          `Role ${role.name} added to ${newMember.user.tag}.`,
          audit?.executor || null,
          userLabel(newMember.user),
          [
            {
              name: "Role",
              value: `${role.name}\nID: ${role.id}`
            }
          ]
        );
      }
    }
  }

  for (const roleId of oldRoles) {
    if (!newRoles.has(roleId)) {
      const role = oldMember.guild.roles.cache.get(roleId);

      const audit = await findAuditActor(
        oldMember.guild,
        AuditLogEvent.MemberRoleUpdate,
        oldMember.id
      );

      if (role) {
        await sendLog(
          oldMember.guild,
          "roleRemoved",
          `Role ${role.name} removed from ${oldMember.user.tag}.`,
          audit?.executor || null,
          userLabel(oldMember.user),
          [
            {
              name: "Role",
              value: `${role.name}\nID: ${role.id}`
            }
          ]
        );
      }
    }
  }

  if (oldMember.nickname !== newMember.nickname) {
    const audit = await findAuditActor(
      newMember.guild,
      AuditLogEvent.MemberUpdate,
      newMember.id
    );

    await sendLog(
      newMember.guild,
      "nameChanged",
      `${newMember.user.tag} nickname changed.`,
      audit?.executor || null,
      userLabel(newMember.user),
      [
        {
          name: "Before",
          value: oldMember.nickname || "None"
        },
        {
          name: "After",
          value: newMember.nickname || "None"
        }
      ]
    );
  }
});

// 9. Channel created
client.on(Events.ChannelCreate, async channel => {
  if (!channel.guild) return;

  const audit = await findAuditActor(
    channel.guild,
    AuditLogEvent.ChannelCreate,
    channel.id
  );

  await sendLog(
    channel.guild,
    "channelCreated",
    `Channel created: ${channel.name}.`,
    audit?.executor || null,
    `${channel.name}\nID: ${channel.id}`
  );
});

// 10. Channel deleted
client.on(Events.ChannelDelete, async channel => {
  if (!channel.guild) return;

  const audit = await findAuditActor(
    channel.guild,
    AuditLogEvent.ChannelDelete,
    channel.id
  );

  await sendLog(
    channel.guild,
    "channelDeleted",
    `Channel deleted: ${channel.name}.`,
    audit?.executor || null,
    `${channel.name}\nID: ${channel.id}`
  );
});

// 11. Channel updated
client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;

  const audit = await findAuditActor(
    newChannel.guild,
    AuditLogEvent.ChannelUpdate,
    newChannel.id
  );

  await sendLog(
    newChannel.guild,
    "channelUpdated",
    `Channel updated: ${oldChannel.name} → ${newChannel.name}.`,
    audit?.executor || null,
    `${newChannel.name}\nID: ${newChannel.id}`,
    [
      {
        name: "Before",
        value: `Name: ${oldChannel.name}\nTopic: ${oldChannel.topic || "None"}`
      },
      {
        name: "After",
        value: `Name: ${newChannel.name}\nTopic: ${newChannel.topic || "None"}`
      }
    ]
  );
});

// 12. Role updated
client.on(Events.RoleUpdate, async (oldRole, newRole) => {
  const audit = await findAuditActor(
    newRole.guild,
    AuditLogEvent.RoleUpdate,
    newRole.id
  );

  await sendLog(
    newRole.guild,
    "roleUpdated",
    `Role updated: ${oldRole.name} → ${newRole.name}.`,
    audit?.executor || null,
    `${newRole.name}\nID: ${newRole.id}`,
    [
      {
        name: "Before",
        value: `Name: ${oldRole.name}\nColor: ${oldRole.hexColor}`
      },
      {
        name: "After",
        value: `Name: ${newRole.name}\nColor: ${newRole.hexColor}`
      }
    ]
  );
});

// 14. Server updated
client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
  const audit = await findAuditActor(
    newGuild,
    AuditLogEvent.GuildUpdate,
    newGuild.id
  );

  await sendLog(
    newGuild,
    "serverUpdated",
    "Server settings updated.",
    audit?.executor || null,
    `${newGuild.name}\nID: ${newGuild.id}`,
    [
      {
        name: "Before",
        value: `Name: ${oldGuild.name}`
      },
      {
        name: "After",
        value: `Name: ${newGuild.name}`
      }
    ]
  );
});

// 15. Member banned
client.on(Events.GuildBanAdd, async ban => {
  const audit = await findAuditActor(
    ban.guild,
    AuditLogEvent.MemberBanAdd,
    ban.user.id
  );

  await sendLog(
    ban.guild,
    "memberBanned",
    `${ban.user.tag} was banned.`,
    audit?.executor || null,
    userLabel(ban.user)
  );
});

client.login(TOKEN).catch(error => {
  console.error("Discord login failed:", error);
});
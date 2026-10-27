
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  AuditLogEvent,
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  throw new Error(
    "Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in Railway Variables"
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

const CONFIG_FILE = path.join(__dirname, "logs-config.json");

const LOG_TYPES = {
  deletedMessages: "🗑️・Deleted Messages",
  editedMessages: "✏️・Edited Messages",
  memberJoin: "📥・Member Join",
  memberLeave: "📤・Member Leave",
  voiceJoin: "🎙️・Voice Join",
  voiceLeave: "🔇・Voice Leave",
  roleAdded: "🎭・Role Added",
  roleRemoved: "➖・Role Removed",
  channelCreated: "🟢・Channel Created",
  channelDeleted: "🔴・Channel Deleted",
  channelUpdated: "🛠️・Channel Updated",
  roleUpdated: "⚙️・Role Updated",
  nameChanged: "📝・Name Changed",
  serverUpdated: "🏰・Server Updated",
  memberBanned: "🔨・Member Banned",
  voiceMuted: "🔇・Voice Muted",
};

const TYPE_NAMES = Object.keys(LOG_TYPES);

function loadConfig() {
  try {
    return fs.existsSync(CONFIG_FILE)
      ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
      : {};
  } catch {
    return {};
  }
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
        enabled: false,
      };
    }
  }

  saveConfig();
}

function getEntry(guildId, type) {
  return config[guildId]?.[type];
}

// Sends a log with the responsible user's avatar when available.
async function sendLog(
  guild,
  type,
  description,
  actor = null,
  target = null
) {
  const entry = getEntry(guild.id, type);
  if (!entry?.enabled || !entry.channelId) return;

  const channel =
    guild.channels.cache.get(entry.channelId) ||
    await guild.channels.fetch(entry.channelId).catch(() => null);

  if (!channel?.isTextBased() || !channel.send) return;

  const embed = new EmbedBuilder()
    .setColor(0x9b0000)
    .setTitle(LOG_TYPES[type] || "Server Log")
    .setDescription(
      String(description || "No details available").slice(0, 4000)
    )
    .setTimestamp();

  if (actor) {
    embed.addFields({
      name: "👤 Responsible User",
      value:
        `${actor.tag || actor.username || "Unknown"}\n` +
        `ID: \`${actor.id}\``,
      inline: true,
    });

    if (actor.displayAvatarURL) {
      embed.setThumbnail(
        actor.displayAvatarURL({ size: 256 })
      );
    }
  } else if (target?.displayAvatarURL) {
    embed.addFields({
      name: "👤 Responsible User",
      value: "Could not identify the actor",
      inline: true,
    });

    embed.setThumbnail(
      target.displayAvatarURL({ size: 256 })
    );
  }

  if (target?.id) {
    embed.addFields({
      name: "🎯 Target",
      value:
        `${target.tag || target.username || target.user?.tag || "Member"}\n` +
        `ID: \`${target.id}\``,
      inline: true,
    });
  }

  await channel.send({ embeds: [embed] }).catch((err) => {
    console.error("Could not send log:", err.message);
  });
}

// Audit logs can be delayed, so actor identification is best-effort.
async function findAuditActor(guild, auditType, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({
      type: auditType,
      limit: 6,
    });

    const now = Date.now();

    const entry = logs.entries.find((item) => {
      const targetMatches =
        !targetId || !item.target || item.target.id === targetId;

      return (
        targetMatches &&
        now - item.createdTimestamp < 15000
      );
    });

    return entry?.executor || null;
  } catch (error) {
    console.warn("Audit log unavailable:", error.message);
    return null;
  }
}

const setupCommand = new SlashCommandBuilder()
  .setName("setup-logs")
  .setDescription("Configure PW VENOM LOG channels")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const rest = new REST({ version: "10" }).setToken(TOKEN);

client.once("ready", async () => {
  console.log(`PW VENOM LOG online as ${client.user.tag}`);

  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: [setupCommand.toJSON()],
    });
    console.log("Slash command registered.");
  } catch (error) {
    console.error("Command registration error:", error);
  }
});

// Setup menu
client.on("interactionCreate", async (interaction) => {
  if (!interaction.guildId) return;

  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "setup-logs"
  ) {
    ensureGuildConfig(interaction.guildId);

    const menu = new StringSelectMenuBuilder()
      .setCustomId("logs_type")
      .setPlaceholder("Choose a log type")
      .addOptions(
        TYPE_NAMES.map((type) => ({
          label: LOG_TYPES[type].replace(/^[^\s]+・/, ""),
          value: type,
          description: `Configure ${type}`,
        }))
      );

    const embed = new EmbedBuilder()
      .setColor(0x9b0000)
      .setTitle("🕷️ PW VENOM LOG")
      .setDescription(
        "Choose a log type, select its text channel, then enable it."
      );

    return interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true,
    });
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "logs_type"
  ) {
    const type = interaction.values[0];

    const channelMenu = new ChannelSelectMenuBuilder()
      .setCustomId(`logs_channel:${type}`)
      .setPlaceholder("Choose a log channel")
      .setChannelTypes(ChannelType.GuildText);

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`logs_enable:${type}`)
        .setLabel("Enable")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`logs_disable:${type}`)
        .setLabel("Disable")
        .setStyle(ButtonStyle.Danger)
    );

    return interaction.reply({
      content:
        `Selected: **${LOG_TYPES[type]}**\n` +
        "Choose the channel, then press Enable.",
      components: [
        new ActionRowBuilder().addComponents(channelMenu),
        buttons,
      ],
      ephemeral: true,
    });
  }

  if (
    interaction.isChannelSelectMenu() &&
    interaction.customId.startsWith("logs_channel:")
  ) {
    const type = interaction.customId.split(":")[1];

    ensureGuildConfig(interaction.guildId);
    config[interaction.guildId][type].channelId =
      interaction.values[0];
    saveConfig();

    return interaction.reply({
      content: `Channel saved for ${LOG_TYPES[type]}. Press Enable.`,
      ephemeral: true,
    });
  }

  if (
    interaction.isButton() &&
    (interaction.customId.startsWith("logs_enable:") ||
      interaction.customId.startsWith("logs_disable:"))
  ) {
    const [action, type] = interaction.customId.split(":");

    ensureGuildConfig(interaction.guildId);
    const entry = config[interaction.guildId][type];

    if (action === "logs_enable" && !entry.channelId) {
      return interaction.reply({
        content: "Choose a log channel first.",
        ephemeral: true,
      });
    }

    entry.enabled = action === "logs_enable";
    saveConfig();

    return interaction.reply({
      content:
        `${LOG_TYPES[type]}: ` +
        `${entry.enabled ? "ENABLED ✅" : "DISABLED ❌"}`,
      ephemeral: true,
    });
  }
});

// 1. Deleted messages
client.on("messageDelete", async (message) => {
  if (!message.guild) return;

  const actor = await findAuditActor(
    message.guild,
    AuditLogEvent.MessageDelete,
    message.author?.id
  );

  await sendLog(
    message.guild,
    "deletedMessages",
    `**Channel:** #${message.channel?.name || "Unknown"}\n` +
      `**Message author:** ${message.author?.tag || "Unknown"}\n` +
      `**Content:**\n${message.content || "[Unavailable or not cached]"}`,
    actor,
    message.author
  );
});

// 2. Edited messages: before and after
client.on("messageUpdate", async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;

  if (oldMessage.partial) {
    oldMessage = await oldMessage.fetch().catch(() => oldMessage);
  }

  const before = oldMessage.content || "[Old content unavailable]";
  const after = newMessage.content || "[New content unavailable]";

  if (before === after) return;

  await sendLog(
    newMessage.guild,
    "editedMessages",
    `**Channel:** #${newMessage.channel?.name || "Unknown"}\n` +
      `**Author:** ${newMessage.author?.tag || "Unknown"}\n\n` +
      `**Before:**\n${before}\n\n**After:**\n${after}`,
    null,
    newMessage.author
  );
});

// 3. Member join
client.on("guildMemberAdd", async (member) => {
  await sendLog(
    member.guild,
    "memberJoin",
    `**Member:** ${member.user.tag}\nID: \`${member.id}\``,
    null,
    member.user
  );
});

// 4. Member leave or kick
client.on("guildMemberRemove", async (member) => {
  const actor = await findAuditActor(
    member.guild,
    AuditLogEvent.MemberKick,
    member.id
  );

  await sendLog(
    member.guild,
    "memberLeave",
    `**Member:** ${member.user?.tag || member.id}\nID: \`${member.id}\``,
    actor,
    member.user
  );
});

// 5, 6 and 16. Voice join, leave and server mute/deafen
client.on("voiceStateUpdate", async (oldState, newState) => {
  const member = newState.member || oldState.member;
  const guild = newState.guild;

  if (!oldState.channelId && newState.channelId) {
    await sendLog(
      guild,
      "voiceJoin",
      `**Member:** ${member?.user.tag || "Unknown"}\n` +
        `**Channel:** ${newState.channel?.name || "Unknown"}`,
      null,
      member?.user
    );
  }

  if (oldState.channelId && !newState.channelId) {
    await sendLog(
      guild,
      "voiceLeave",
      `**Member:** ${member?.user.tag || "Unknown"}\n` +
        `**Channel:** ${oldState.channel?.name || "Unknown"}`,
      null,
      member?.user
    );
  }

  if (
    oldState.serverMute !== newState.serverMute ||
    oldState.serverDeaf !== newState.serverDeaf
  ) {
    const changes = [];

    if (oldState.serverMute !== newState.serverMute) {
      changes.push(
        `Server mute: **${newState.serverMute ? "ON" : "OFF"}**`
      );
    }

    if (oldState.serverDeaf !== newState.serverDeaf) {
      changes.push(
        `Server deaf: **${newState.serverDeaf ? "ON" : "OFF"}**`
      );
    }

    const actor = await findAuditActor(
      guild,
      AuditLogEvent.MemberUpdate,
      member?.id
    );

    await sendLog(
      guild,
      "voiceMuted",
      `**Member:** ${member?.user.tag || "Unknown"}\n` +
        changes.join("\n"),
      actor,
      member?.user
    );
  }
});

// 7, 8 and 13. Roles added/removed and nickname changed
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());

  for (const roleId of newRoles) {
    if (!oldRoles.has(roleId)) {
      const role = newMember.guild.roles.cache.get(roleId);
      const actor = await findAuditActor(
        newMember.guild,
        AuditLogEvent.MemberRoleUpdate,
        newMember.id
      );

      await sendLog(
        newMember.guild,
        "roleAdded",
        `**Member:** ${newMember.user.tag}\n` +
          `**Role:** ${role?.name || roleId}`,
        actor,
        newMember.user
      );
    }
  }

  for (const roleId of oldRoles) {
    if (!newRoles.has(roleId)) {
      const role = oldMember.guild.roles.cache.get(roleId);
      const actor = await findAuditActor(
        newMember.guild,
        AuditLogEvent.MemberRoleUpdate,
        newMember.id
      );

      await sendLog(
        newMember.guild,
        "roleRemoved",
        `**Member:** ${newMember.user.tag}\n` +
          `**Role:** ${role?.name || roleId}`,
        actor,
        newMember.user
      );
    }
  }

  if (oldMember.nickname !== newMember.nickname) {
    const actor = await findAuditActor(
      newMember.guild,
      AuditLogEvent.MemberUpdate,
      newMember.id
    );

    await sendLog(
      newMember.guild,
      "nameChanged",
      `**Member:** ${newMember.user.tag}\n` +
        `**Old nickname:** ${oldMember.nickname || "None"}\n` +
        `**New nickname:** ${newMember.nickname || "None"}`,
      actor,
      newMember.user
    );
  }
});

// 9. Channel created
client.on("channelCreate", async (channel) => {
  if (!channel.guild) return;

  const actor = await findAuditActor(
    channel.guild,
    AuditLogEvent.ChannelCreate,
    channel.id
  );

  await sendLog(
    channel.guild,
    "channelCreated",
    `**Channel:** ${channel.name}\nID: \`${channel.id}\``,
    actor
  );
});

// 10. Channel deleted
client.on("channelDelete", async (channel) => {
  if (!channel.guild) return;

  const actor = await findAuditActor(
    channel.guild,
    AuditLogEvent.ChannelDelete,
    channel.id
  );

  await sendLog(
    channel.guild,
    "channelDeleted",
    `**Channel:** ${channel.name}\nID: \`${channel.id}\``,
    actor
  );
});

// 11. Channel updated
client.on("channelUpdate", async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;

  const changes = [];

  if (oldChannel.name !== newChannel.name) {
    changes.push(`Name: ${oldChannel.name} → ${newChannel.name}`);
  }

  if (oldChannel.parentId !== newChannel.parentId) {
    changes.push("Category changed");
  }

  if (oldChannel.topic !== newChannel.topic) {
    changes.push("Topic changed");
  }

  const oldPerms = oldChannel.permissionOverwrites?.cache;
  const newPerms = newChannel.permissionOverwrites?.cache;

  if (oldPerms && newPerms) {
    const a = oldPerms.map((p) =>
      `${p.id}:${p.allow.bitfield}:${p.deny.bitfield}`
    ).sort().join("|");

    const b = newPerms.map((p) =>
      `${p.id}:${p.allow.bitfield}:${p.deny.bitfield}`
    ).sort().join("|");

    if (a !== b) changes.push("Permissions changed");
  }

  if (!changes.length) return;

  const actor = await findAuditActor(
    newChannel.guild,
    AuditLogEvent.ChannelUpdate,
    newChannel.id
  );

  await sendLog(
    newChannel.guild,
    "channelUpdated",
    `**Channel:** ${newChannel.name}\n${changes.join("\n")}`,
    actor
  );
});

// 12. Role updated
client.on("roleUpdate", async (oldRole, newRole) => {
  const changes = [];

  if (oldRole.name !== newRole.name) {
    changes.push(`Name: ${oldRole.name} → ${newRole.name}`);
  }

  if (oldRole.color !== newRole.color) changes.push("Color changed");

  if (
    oldRole.permissions.bitfield !== newRole.permissions.bitfield
  ) {
    changes.push("Permissions changed");
  }

  if (oldRole.hoist !== newRole.hoist) {
    changes.push("Display separately changed");
  }

  if (oldRole.mentionable !== newRole.mentionable) {
    changes.push("Mentionable changed");
  }

  if (!changes.length) return;

  const actor = await findAuditActor(
    newRole.guild,
    AuditLogEvent.RoleUpdate,
    newRole.id
  );

  await sendLog(
    newRole.guild,
    "roleUpdated",
    `**Role:** ${newRole.name}\n${changes.join("\n")}`,
    actor
  );
});

// 14. Server updated
client.on("guildUpdate", async (oldGuild, newGuild) => {
  const changes = [];

  if (oldGuild.name !== newGuild.name) {
    changes.push(`Name: ${oldGuild.name} → ${newGuild.name}`);
  }

  if (oldGuild.icon !== newGuild.icon) changes.push("Server icon changed");
  if (oldGuild.banner !== newGuild.banner) changes.push("Server banner changed");

  if (oldGuild.description !== newGuild.description) {
    changes.push("Server description changed");
  }

  if (!changes.length) return;

  const actor = await findAuditActor(
    newGuild,
    AuditLogEvent.GuildUpdate,
    newGuild.id
  );

  await sendLog(
    newGuild,
    "serverUpdated",
    changes.join("\n"),
    actor
  );
});

// 15. Member banned
client.on("guildBanAdd", async (ban) => {
  const actor = await findAuditActor(
    ban.guild,
    AuditLogEvent.MemberBanAdd,
    ban.user.id
  );

  await sendLog(
    ban.guild,
    "memberBanned",
    `**Banned member:** ${ban.user.tag || ban.user.username}\n` +
      `ID: \`${ban.user.id}\``,
    actor,
    ban.user
  );
});

client.login(TOKEN);


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
    GatewayIntentBits.GuildEmojisAndStickers,
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
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, "{}");
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (error) {
    console.error("Config load error:", error);
    return {};
  }
}

let config = loadConfig();

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getEntry(guildId, type) {
  return config[guildId]?.[type];
}

async function sendLog(guild, type, description, actor = null) {
  const entry = getEntry(guild.id, type);
  if (!entry || !entry.enabled || !entry.channelId) return;

  const channel = guild.channels.cache.get(entry.channelId)
    || await guild.channels.fetch(entry.channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x9b0000)
    .setTitle(LOG_TYPES[type] || "Server Log")
    .setDescription(String(description || "No details available").slice(0, 4000))
    .setTimestamp();

  if (actor) {
    embed.addFields({
      name: "👤 Responsible User",
      value: `${actor.tag || actor.username || actor.id}\nID: \`${actor.id}\``,
    });
  }

  await channel.send({ embeds: [embed] }).catch((err) => {
    console.error("Could not send log:", err.message);
  });
}

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
      return targetMatches && now - item.createdTimestamp < 15000;
    });

    return entry?.executor || null;
  } catch (error) {
    console.warn("Audit log unavailable:", error.message);
    return null;
  }
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
    console.log("Slash commands registered.");
  } catch (error) {
    console.error("Command registration error:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand() &&
      interaction.commandName === "setup-logs") {
    ensureGuildConfig(interaction.guildId);

    const menu = new StringSelectMenuBuilder()
      .setCustomId("logs_type")
      .setPlaceholder("Choose a log type")
      .addOptions(
        TYPE_NAMES.map((type) => ({
          label: LOG_TYPES[type].replace(/^[^\s]+・/, ""),
          value: type,
          description: `Configure ${LOG_TYPES[type].replace(/^[^\s]+・/, "")}`,
          emoji: LOG_TYPES[type].split("・")[0],
        }))
      );

    const row = new ActionRowBuilder().addComponents(menu);

    const embed = new EmbedBuilder()
      .setColor(0x9b0000)
      .setTitle("🕷️ PW VENOM LOG")
      .setDescription(
        "Select a log type, choose its text channel, then enable it."
      );

    return interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  }

  if (!interaction.guildId) return;

  if (interaction.isStringSelectMenu() &&
      interaction.customId === "logs_type") {
    const type = interaction.values[0];
    const row = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`logs_channel:${type}`)
        .setPlaceholder("Choose a log text channel")
        .setChannelTypes(ChannelType.GuildText)
    );

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
      content: `Selected: **${LOG_TYPES[type]}**\nChoose a channel, then enable the log.`,
      components: [row, buttons],
      ephemeral: true,
    });
  }

  if (interaction.isChannelSelectMenu() &&
      interaction.customId.startsWith("logs_channel:")) {
    const type = interaction.customId.split(":")[1];
    const channelId = interaction.values[0];

    ensureGuildConfig(interaction.guildId);
    config[interaction.guildId][type].channelId = channelId;
    saveConfig();

    return interaction.update({
      content: `Channel saved for **${LOG_TYPES[type]}**. Now press Enable.`,
      components: interaction.message.components,
    });
  }

  if (interaction.isButton() &&
      (interaction.customId.startsWith("logs_enable:") ||
       interaction.customId.startsWith("logs_disable:"))) {
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
      content: `${LOG_TYPES[type]}: ${entry.enabled ? "ENABLED ✅" : "DISABLED ❌"}`,
      ephemeral: true,
    });
  }
});

// 1. Deleted Messages
client.on("messageDelete", async (message) => {
  if (!message.guild) return;

  const channelName = message.channel?.name || "Unknown";
  const content = message.content || "[Content unavailable or not cached]";
  const actor = await findAuditActor(
    message.guild,
    AuditLogEvent.MessageDelete,
    message.author?.id
  );

  await sendLog(
    message.guild,
    "deletedMessages",
    `**Channel:** #${channelName}\n**Author:** ${message.author?.tag || "Unknown"}\n**Content:**\n${content}`,
    actor
  );
});

// 2. Edited Messages (before and after)
client.on("messageUpdate", async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;

  if (oldMessage.partial) {
    await oldMessage.fetch().catch(() => null);
  }

  const before = oldMessage.content || "[Old content unavailable]";
  const after = newMessage.content || "[New content unavailable]";
  if (before === after) return;

  await sendLog(
    newMessage.guild,
    "editedMessages",
    `**Author:** ${newMessage.author?.tag || "Unknown"}\n**Channel:** #${newMessage.channel?.name || "unknown"}\n**Before:**\n${before}\n\n**After:**\n${after}`
  );
});

// 3. Member Join
client.on("guildMemberAdd", async (member) => {
  await sendLog(
    member.guild,
    "memberJoin",
    `**Member:** ${member.user.tag}\n**ID:** \`${member.id}\``
  );
});

// 4. Member Leave
client.on("guildMemberRemove", async (member) => {
  const actor = await findAuditActor(
    member.guild,
    AuditLogEvent.MemberKick,
    member.id
  );

  await sendLog(
    member.guild,
    "memberLeave",
    `**Member:** ${member.user?.tag || member.id}\n**ID:** \`${member.id}\``,
    actor
  );
});

// 5 and 6. Voice Join / Leave, and 16. Voice Muted
client.on("voiceStateUpdate", async (oldState, newState) => {
  const member = newState.member || oldState.member;
  const guild = newState.guild;

  if (!oldState.channelId && newState.channelId) {
    await sendLog(
      guild,
      "voiceJoin",
      `**Member:** ${member?.user.tag || "Unknown"}\n**Channel:** ${newState.channel?.name || "Unknown"}`
    );
  }

  if (oldState.channelId && !newState.channelId) {
    await sendLog(
      guild,
      "voiceLeave",
      `**Member:** ${member?.user.tag || "Unknown"}\n**Channel:** ${oldState.channel?.name || "Unknown"}`
    );
  }

  if (oldState.serverMute !== newState.serverMute ||
      oldState.serverDeaf !== newState.serverDeaf) {
    const changes = [];
    if (oldState.serverMute !== newState.serverMute) {
      changes.push(`Server mute: **${newState.serverMute ? "ON" : "OFF"}**`);
    }
    if (oldState.serverDeaf !== newState.serverDeaf) {
      changes.push(`Server deaf: **${newState.serverDeaf ? "ON" : "OFF"}**`);
    }

    const actor = await findAuditActor(
      guild,
      AuditLogEvent.MemberUpdate,
      member?.id
    );

    await sendLog(
      guild,
      "voiceMuted",
      `**Member:** ${member?.user.tag || "Unknown"}\n${changes.join("\n")}`,
      actor
    );
  }
});

// 7 and 8. Role Added / Removed
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
        `**Member:** ${newMember.user.tag}\n**Role:** ${role?.name || roleId}`,
        actor
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
        `**Member:** ${newMember.user.tag}\n**Role:** ${role?.name || roleId}`,
        actor
      );
    }
  }

  // 13. Name Changed
  if (oldMember.nickname !== newMember.nickname ||
      oldMember.user.username !== newMember.user.username) {
    await sendLog(
      newMember.guild,
      "nameChanged",
      `**Member:** ${newMember.user.tag}\n**Old nickname:** ${oldMember.nickname || "None"}\n**New nickname:** ${newMember.nickname || "None"}`
    );
  }
});

// 9. Channel Created
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
    `**Channel:** ${channel.name}\n**ID:** \`${channel.id}\``,
    actor
  );
});

// 10. Channel Deleted
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
    `**Channel:** ${channel.name}\n**ID:** \`${channel.id}\``,
    actor
  );
});

// 11. Channel Updated
client.on("channelUpdate", async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;

  const changes = [];
  if (oldChannel.name !== newChannel.name) {
    changes.push(`Name: **${oldChannel.name}** → **${newChannel.name}**`);
  }
  if (oldChannel.parentId !== newChannel.parentId) {
    changes.push("Category changed");
  }
  if (oldChannel.topic !== newChannel.topic) {
    changes.push("Topic changed");
  }
  if (oldChannel.permissionOverwrites?.cache &&
      newChannel.permissionOverwrites?.cache) {
    const oldPerms = oldChannel.permissionOverwrites.cache.map((p) =>
      `${p.id}:${p.allow.bitfield}:${p.deny.bitfield}`
    ).sort().join("|");
    const newPerms = newChannel.permissionOverwrites.cache.map((p) =>
      `${p.id}:${p.allow.bitfield}:${p.deny.bitfield}`
    ).sort().join("|");
    if (oldPerms !== newPerms) changes.push("Permissions changed");
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

// 12. Role Updated
client.on("roleUpdate", async (oldRole, newRole) => {
  const changes = [];

  if (oldRole.name !== newRole.name) {
    changes.push(`Name: **${oldRole.name}** → **${newRole.name}**`);
  }
  if (oldRole.color !== newRole.color) changes.push("Color changed");
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
    changes.push("Permissions changed");
  }
  if (oldRole.hoist !== newRole.hoist) changes.push("Display separately changed");
  if (oldRole.mentionable !== newRole.mentionable) changes.push("Mentionable changed");

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

// 14. Server Updated
client.on("guildUpdate", async (oldGuild, newGuild) => {
  const changes = [];

  if (oldGuild.name !== newGuild.name) {
    changes.push(`Name: **${oldGuild.name}** → **${newGuild.name}**`);
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

// 15. Member Banned
client.on("guildBanAdd", async (ban) => {
  const actor = await findAuditActor(
    ban.guild,
    AuditLogEvent.MemberBanAdd,
    ban.user.id
  );

  await sendLog(
    ban.guild,
    "memberBanned",
    `**Banned member:** ${ban.user.tag || ban.user.username}\n**ID:** \`${ban.user.id}\``,
    actor
  );
});

client.login(TOKEN);

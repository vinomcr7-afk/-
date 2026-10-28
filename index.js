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
  Events
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
  deletedMessages: "Deleted messages",
  editedMessages: "Edited messages",
  memberJoin: "Member joined",
  memberLeave: "Member left",
  voiceJoin: "Joined voice",
  voiceLeave: "Left voice",
  roleAdded: "Role added",
  roleRemoved: "Role removed",
  channelCreated: "Channel created",
  channelDeleted: "Channel deleted",
  channelUpdated: "Channel updated",
  roleUpdated: "Role updated",
  nameChanged: "Nickname changed",
  serverUpdated: "Server updated",
  memberBanned: "Member banned",
  voiceMuted: "Voice mute changed"
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

async function sendLog(guild, type, description, actor = null, target = null) {
  try {
    ensureGuildConfig(guild.id);

    const entry = config[guild.id][type];
    if (!entry || !entry.enabled || !entry.channelId) return;

    const channel = await guild.channels.fetch(entry.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(0x8b0000)
      .setTitle(`PW VENOM LOG • ${LOG_TYPES[type] || type}`)
      .setDescription(description.slice(0, 4000))
      .setTimestamp();

    if (actor) embed.addFields({
      name: "Actor",
      value: String(actor).slice(0, 1024)
    });

    if (target) embed.addFields({
      name: "Target",
      value: String(target).slice(0, 1024)
    });

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Log send error:", error);
  }
}

async function findAuditActor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find(item =>
      item.target?.id === targetId &&
      Date.now() - item.createdTimestamp < 15000
    );
    return entry?.executor?.tag || null;
  } catch {
    return null;
  }
}

const app = express();
app.use(express.json({ limit: "20kb" }));

function authenticateApi(req, res, next) {
  const auth = req.headers.authorization || "";
  const expected = `Bearer ${BOT_CONTROL_SECRET}`;

  const a = Buffer.from(auth);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

app.get("/health", (req, res) => {
  res.json({ ok: true, botReady: client.isReady() });
});

app.get("/api/guilds/:guildId/config", authenticateApi, (req, res) => {
  const { guildId } = req.params;

  if (!/^\d{17,20}$/.test(guildId)) {
    return res.status(400).json({ error: "Invalid guild ID" });
  }

  if (!client.guilds.cache.has(guildId)) {
    return res.status(404).json({ error: "Bot is not in this server" });
  }

  ensureGuildConfig(guildId);

  const settings = config[guildId];
  const channelId =
    Object.values(settings).find(entry => entry.channelId)?.channelId || "";

  const events = TYPE_NAMES.filter(type => settings[type].enabled);

  res.json({ channelId, events, settings });
});

app.put("/api/guilds/:guildId/config", authenticateApi, async (req, res) => {
  try {
    const { guildId } = req.params;

    if (!/^\d{17,20}$/.test(guildId)) {
      return res.status(400).json({ error: "Invalid guild ID" });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Bot is not in this server" });
    }

    const { channelId, events } = req.body || {};

    if (
      typeof channelId !== "string" ||
      !Array.isArray(events) ||
      !events.every(type => typeof type === "string" && TYPE_NAMES.includes(type))
    ) {
      return res.status(400).json({ error: "Invalid channelId or events" });
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);

    if (!channel || channel.type !== ChannelType.GuildText) {
      return res.status(400).json({
        error: "Channel must be a text channel in this server"
      });
    }

    const botMember = guild.members.me;
    const permissions = channel.permissionsFor(botMember);

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
    res.json({ ok: true, message: "Log settings saved" });
  } catch (error) {
    console.error("API save error:", error);
    res.status(500).json({ error: "Could not save configuration" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`PW VENOM LOG API listening on port ${PORT}`);
});

const setupCommand = new SlashCommandBuilder()
  .setName("setup-logs")
  .setDescription("Configure PW VENOM LOG event settings")
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

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === "setup-logs") {
    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: "Administrator permission required.",
        ephemeral: true
      });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId("pw_log_type")
      .setPlaceholder("Choose a log event")
      .addOptions(TYPE_NAMES.map(type => ({
        label: LOG_TYPES[type],
        value: type
      })));

    return interaction.reply({
      content: "Choose a log event, then select a text channel and enable it.",
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "pw_log_type") {
    const type = interaction.values[0];

    const channelMenu = new ChannelSelectMenuBuilder()
      .setCustomId(`pw_log_channel:${type}`)
      .setPlaceholder("Choose a log channel")
      .setChannelTypes(ChannelType.GuildText);

    return interaction.update({
      content: `Selected: **${LOG_TYPES[type]}**. Choose a channel.`,
      components: [new ActionRowBuilder().addComponents(channelMenu)]
    });
  }

  if (interaction.isChannelSelectMenu() && interaction.customId.startsWith("pw_log_channel:")) {
    const type = interaction.customId.split(":")[1];
    const channelId = interaction.values[0];

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
      content: `Channel saved for **${LOG_TYPES[type]}**. Choose Enable or Disable.`,
      components: [buttons]
    });
  }

  if (interaction.isButton() && /^(pw_log_enable|pw_log_disable):/.test(interaction.customId)) {
    const [action, type] = interaction.customId.split(":");

    if (!TYPE_NAMES.includes(type)) {
      return interaction.reply({ content: "Unknown log type.", ephemeral: true });
    }

    ensureGuildConfig(interaction.guildId);
    config[interaction.guildId][type].enabled = action === "pw_log_enable";
    saveConfig();

    return interaction.update({
      content: `**${LOG_TYPES[type]}** is now ${action === "pw_log_enable" ? "enabled" : "disabled"}.`,
      components: []
    });
  }
});

client.on(Events.MessageDelete, async message => {
  if (!message.guild || message.author?.bot) return;
  await sendLog(
    message.guild,
    "deletedMessages",
    `Message deleted in <#${message.channelId}>.\nContent: ${(message.content || "[No content available]").slice(0, 3000)}`,
    null,
    message.author?.tag || "Unknown user"
  );
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.partial) oldMessage = await oldMessage.fetch().catch(() => oldMessage);

  await sendLog(
    newMessage.guild,
    "editedMessages",
    `Message edited in <#${newMessage.channelId}>.\nBefore: ${(oldMessage.content || "[No content]").slice(0, 1500)}\nAfter: ${(newMessage.content || "[No content]").slice(0, 1500)}`,
    null,
    newMessage.author?.tag || "Unknown user"
  );
});

client.on(Events.GuildMemberAdd, member => {
  sendLog(member.guild, "memberJoin", `${member.user.tag} joined the server.`, null, member.user.tag);
});

client.on(Events.GuildMemberRemove, member => {
  sendLog(member.guild, "memberLeave", `${member.user.tag} left the server.`, null, member.user.tag);
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  if (!oldState.channelId && newState.channelId) {
    sendLog(member.guild, "voiceJoin", `${member.user.tag} joined <#${newState.channelId}>.`);
  }

  if (oldState.channelId && !newState.channelId) {
    sendLog(member.guild, "voiceLeave", `${member.user.tag} left <#${oldState.channelId}>.`);
  }

  if (oldState.serverMute !== newState.serverMute) {
    sendLog(member.guild, "voiceMuted", `${member.user.tag} server mute changed to ${newState.serverMute}.`);
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());

  for (const roleId of newRoles) {
    if (!oldRoles.has(roleId)) {
      const role = newMember.guild.roles.cache.get(roleId);
      if (role) sendLog(newMember.guild, "roleAdded", `Role <@&${roleId}> added to ${newMember.user.tag}.`);
    }
  }

  for (const roleId of oldRoles) {
    if (!newRoles.has(roleId)) {
      const role = oldMember.guild.roles.cache.get(roleId);
      if (role) sendLog(newMember.guild, "roleRemoved", `Role <@&${roleId}> removed from ${newMember.user.tag}.`);
    }
  }

  if (oldMember.nickname !== newMember.nickname) {
    sendLog(newMember.guild, "nameChanged", `${newMember.user.tag} nickname changed from ${oldMember.nickname || "none"} to ${newMember.nickname || "none"}.`);
  }
});

client.on(Events.ChannelCreate, channel => {
  if (channel.guild) sendLog(channel.guild, "channelCreated", `Channel created: ${channel.name} (${channel.id}).`);
});

client.on(Events.ChannelDelete, channel => {
  if (channel.guild) sendLog(channel.guild, "channelDeleted", `Channel deleted: ${channel.name} (${channel.id}).`);
});

client.on(Events.ChannelUpdate, (oldChannel, newChannel) => {
  if (newChannel.guild) sendLog(newChannel.guild, "channelUpdated", `Channel updated: ${oldChannel.name} → ${newChannel.name}.`);
});

client.on(Events.RoleUpdate, (oldRole, newRole) => {
  sendLog(newRole.guild, "roleUpdated", `Role updated: ${oldRole.name} → ${newRole.name}.`);
});

client.on(Events.GuildUpdate, (oldGuild, newGuild) => {
  sendLog(newGuild, "serverUpdated", `Server updated: ${oldGuild.name} → ${newGuild.name}.`);
});

client.on(Events.GuildBanAdd, ban => {
  sendLog(ban.guild, "memberBanned", `${ban.user.tag} was banned.`);
});

client.login(TOKEN).catch(error => {
  console.error("Discord login failed:", error);
});
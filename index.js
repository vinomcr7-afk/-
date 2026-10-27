
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
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
} = require("discord.js");

const { joinVoiceChannel, entersState, VoiceConnectionStatus } =
  require("@discordjs/voice");

const express = require("express");
const fs = require("fs");
const crypto = require("crypto");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;

const API_SECRET = process.env.BOT_CONTROL_SECRET;
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = "./logs-config.json";

if (!TOKEN) throw new Error("DISCORD_TOKEN is missing");
if (!API_SECRET) throw new Error("BOT_CONTROL_SECRET is missing");

const CATEGORIES = {
  messages: "💬 Messages",
  members: "👥 Members",
  voice: "🔊 Voice",
  moderation: "🛡️ Moderation",
  roles: "🎭 Roles",
  channels: "📁 Channels",
  server: "⚙️ Server Events",
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.GuildMember,
  ],
});

let configs = {};

function defaults() {
  return Object.fromEntries(
    Object.keys(CATEGORIES).map(key => [
      key,
      { enabled: false, channel: null },
    ])
  );
}

function loadConfigs() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      for (const [guildId, config] of Object.entries(data)) {
        configs[guildId] = { ...defaults(), ...config };
      }
    }
  } catch (error) {
    console.error("Config load error:", error);
  }
}

function getConfig(guildId) {
  if (!configs[guildId]) configs[guildId] = defaults();
  return configs[guildId];
}

function saveConfigs() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
}

loadConfigs();

async function sendLog(guild, category, title, description, color = 0x202225) {
  try {
    const setting = getConfig(guild.id)[category];
    if (!setting?.enabled || !setting.channel) return;

    const channel = await guild.channels
      .fetch(setting.channel)
      .catch(() => null);

    if (!channel || !channel.isTextBased() || !channel.isSendable()) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(String(description || "No details").slice(0, 4000))
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Log send error:", error.message);
  }
}

function userInfo(user) {
  return `${user?.tag || "Unknown"} (${user?.id || "unknown"})`;
}

// ---------- Slash command ----------

const setupCommand = new SlashCommandBuilder()
  .setName("setup-logs")
  .setDescription("Configure server logging")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

async function registerCommands() {
  if (!CLIENT_ID || !GUILD_ID) {
    console.log("Skipping slash-command registration: set CLIENT_ID and GUILD_ID.");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: [setupCommand.toJSON()] }
  );

  console.log("Slash commands registered.");
}

function makePanel() {
  const categoryMenu = new StringSelectMenuBuilder()
    .setCustomId("logs_category")
    .setPlaceholder("Choose a log category")
    .addOptions(
      Object.entries(CATEGORIES).map(([value, label]) => ({
        label,
        value,
      }))
    );

  return {
    content: "**PW VENOM LOGS**\nChoose a category to configure its log channel.",
    components: [new ActionRowBuilder().addComponents(categoryMenu)],
  };
}

async function showCategory(interaction, category) {
  const config = getConfig(interaction.guildId)[category];

  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId(`logs_channel:${category}`)
    .setPlaceholder("Choose a text channel")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`logs_toggle:${category}`)
      .setLabel(config.enabled ? "Disable logs" : "Enable logs")
      .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("logs_refresh")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.update({
    content:
      `**${CATEGORIES[category]}**\n` +
      `Status: **${config.enabled ? "Enabled" : "Disabled"}**\n` +
      `Channel: ${config.channel ? `<#${config.channel}>` : "Not selected"}`,
    components: [
      new ActionRowBuilder().addComponents(channelMenu),
      buttons,
    ],
  });
}

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand() &&
        interaction.commandName === "setup-logs") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "Administrator permission is required.",
          ephemeral: true,
        });
      }

      return interaction.reply({
        ...makePanel(),
        ephemeral: true,
      });
    }

    if (!interaction.inGuild()) return;

    if (interaction.isStringSelectMenu() &&
        interaction.customId === "logs_category") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "No permission.", ephemeral: true });
      }
      return showCategory(interaction, interaction.values[0]);
    }

    if (interaction.isChannelSelectMenu() &&
        interaction.customId.startsWith("logs_channel:")) {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "No permission.", ephemeral: true });
      }

      const category = interaction.customId.split(":")[1];
      if (!Object.hasOwn(CATEGORIES, category)) return;

      const channelId = interaction.values[0];
      getConfig(interaction.guildId)[category].channel = channelId;
      saveConfigs();

      return showCategory(interaction, category);
    }

    if (interaction.isButton() &&
        interaction.customId.startsWith("logs_toggle:")) {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "No permission.", ephemeral: true });
      }

      const category = interaction.customId.split(":")[1];
      if (!Object.hasOwn(CATEGORIES, category)) return;

      const setting = getConfig(interaction.guildId)[category];

      if (!setting.enabled && !setting.channel) {
        return interaction.reply({
          content: "Select a text channel first.",
          ephemeral: true,
        });
      }

      setting.enabled = !setting.enabled;
      saveConfigs();
      return showCategory(interaction, category);
    }

    if (interaction.isButton() && interaction.customId === "logs_refresh") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "No permission.", ephemeral: true });
      }
      return interaction.update(makePanel());
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "An error occurred. Check the bot logs.",
        ephemeral: true,
      }).catch(() => {});
    }
  }
});

// ---------- Message logs ----------

client.on(Events.MessageDelete, async message => {
  if (!message.guild || message.author?.bot) return;

  await sendLog(
    message.guild,
    "messages",
    "🗑️ Message Deleted",
    `Author: ${userInfo(message.author)}\nChannel: <#${message.channelId}>\nContent: ${(message.content || "Unavailable").slice(0, 1500)}`,
    0xED4245
  );
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;

  await sendLog(
    newMessage.guild,
    "messages",
    "✏️ Message Edited",
    `Author: ${userInfo(newMessage.author)}\nChannel: <#${newMessage.channelId}>\nBefore: ${(oldMessage.content || "Unavailable").slice(0, 1000)}\nAfter: ${(newMessage.content || "Unavailable").slice(0, 1000)}`
  );
});

// ---------- Member logs ----------

client.on(Events.GuildMemberAdd, async member => {
  await sendLog(
    member.guild,
    "members",
    "📥 Member Joined",
    `${userInfo(member.user)}\nMembers: ${member.guild.memberCount}`,
    0x57F287
  );
});

client.on(Events.GuildMemberRemove, async member => {
  await sendLog(
    member.guild,
    "members",
    "📤 Member Left",
    `${userInfo(member.user)}\nMembers: ${member.guild.memberCount}`,
    0xED4245
  );
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (oldMember.nickname !== newMember.nickname) {
    await sendLog(
      newMember.guild,
      "members",
      "📝 Nickname Changed",
      `${userInfo(newMember.user)}\nBefore: ${oldMember.nickname || oldMember.user.username}\nAfter: ${newMember.nickname || newMember.user.username}`
    );
  }

  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());

  for (const id of newRoles) {
    if (!oldRoles.has(id)) {
      await sendLog(newMember.guild, "roles", "➕ Role Added",
        `${userInfo(newMember.user)} received <@&${id}>`);
    }
  }

  for (const id of oldRoles) {
    if (!newRoles.has(id)) {
      await sendLog(newMember.guild, "roles", "➖ Role Removed",
        `${userInfo(newMember.user)} lost role ID ${id}`);
    }
  }
});

// ---------- Voice logs ----------

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;
  if (!member) return;

  if (oldState.channelId !== newState.channelId) {
    let description;

    if (!oldState.channelId) {
      description = `${userInfo(member.user)} joined <#${newState.channelId}>`;
    } else if (!newState.channelId) {
      description = `${userInfo(member.user)} left <#${oldState.channelId}>`;
    } else {
      description = `${userInfo(member.user)} moved from <#${oldState.channelId}> to <#${newState.channelId}>`;
    }

    await sendLog(guild, "voice", "🔊 Voice Channel Update", description);
  }

  if (oldState.serverMute !== newState.serverMute) {
    await sendLog(guild, "voice", "🎙️ Server Mute Changed",
      `${userInfo(member.user)}: ${newState.serverMute ? "Muted" : "Unmuted"}`);
  }

  if (oldState.serverDeaf !== newState.serverDeaf) {
    await sendLog(guild, "voice", "🔇 Server Deafen Changed",
      `${userInfo(member.user)}: ${newState.serverDeaf ? "Deafened" : "Undeafened"}`);
  }
});

// ---------- Moderation logs ----------

client.on(Events.GuildBanAdd, async ban => {
  await sendLog(ban.guild, "moderation", "🔨 Member Banned",
    userInfo(ban.user), 0xED4245);
});

client.on(Events.GuildBanRemove, async ban => {
  await sendLog(ban.guild, "moderation", "♻️ Member Unbanned",
    userInfo(ban.user), 0x57F287);
});

// ---------- Channel logs ----------

client.on(Events.ChannelCreate, async channel => {
  if (!channel.guild) return;
  await sendLog(channel.guild, "channels", "📁 Channel Created",
    `${channel.name} (${channel.id})`);
});

client.on(Events.ChannelDelete, async channel => {
  if (!channel.guild) return;
  await sendLog(channel.guild, "channels", "🗑️ Channel Deleted",
    `${channel.name} (${channel.id})`);
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.guild || oldChannel.name === newChannel.name) return;

  await sendLog(newChannel.guild, "channels", "✏️ Channel Renamed",
    `Before: ${oldChannel.name}\nAfter: ${newChannel.name}`);
});

// ---------- Role logs ----------

client.on(Events.GuildRoleCreate, async role => {
  await sendLog(role.guild, "roles", "🎭 Role Created",
    `${role.name} (${role.id})`);
});

client.on(Events.GuildRoleDelete, async role => {
  await sendLog(role.guild, "roles", "🗑️ Role Deleted",
    `${role.name} (${role.id})`);
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  if (oldRole.name === newRole.name) return;

  await sendLog(newRole.guild, "roles", "✏️ Role Renamed",
    `Before: ${oldRole.name}\nAfter: ${newRole.name}`);
});

// ---------- Protected website API ----------

const api = express();
api.use(express.json({ limit: "20kb" }));

function validSecret(req, res, next) {
  const supplied = req.get("x-bot-secret") || "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(API_SECRET);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

api.get("/health", (req, res) => {
  res.json({ ok: true, app: "PW VENOM BOT API" });
});

api.use("/api", validSecret);

api.get("/api/guild/:guildId", async (req, res) => {
  try {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) {
      return res.status(404).json({ error: "Bot is not in this server" });
    }

    const channels = guild.channels.cache
      .filter(channel => channel.type === ChannelType.GuildText)
      .map(channel => ({ id: channel.id, name: channel.name }));

    res.json({
      guild: { id: guild.id, name: guild.name },
      categories: CATEGORIES,
      config: getConfig(guild.id),
      channels,
    });
  } catch (error) {
    console.error("API read error:", error);
    res.status(500).json({ error: "Could not load settings" });
  }
});

api.put("/api/guild/:guildId", async (req, res) => {
  try {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) {
      return res.status(404).json({ error: "Bot is not in this server" });
    }

    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Invalid settings" });
    }

    const config = getConfig(guild.id);

    for (const key of Object.keys(CATEGORIES)) {
      if (!Object.hasOwn(req.body, key)) continue;

      const item = req.body[key];

      if (!item || typeof item.enabled !== "boolean") {
        return res.status(400).json({ error: `Invalid setting: ${key}` });
      }

      const channelId = item.channel;

      if (channelId !== null && typeof channelId !== "string") {
        return res.status(400).json({ error: `Invalid channel: ${key}` });
      }

      if (channelId !== null) {
        const channel = await guild.channels.fetch(channelId).catch(() => null);

        if (!channel || channel.type !== ChannelType.GuildText) {
          return res.status(400).json({ error: `Invalid text channel: ${key}` });
        }
      }

      if (item.enabled && !channelId) {
        return res.status(400).json({
          error: `Choose a channel before enabling ${key}`,
        });
      }

      config[key] = { enabled: item.enabled, channel: channelId };
    }

    saveConfigs();
    res.json({ ok: true, config });
  } catch (error) {
    console.error("API save error:", error);
    res.status(500).json({ error: "Could not save settings" });
  }
});

api.listen(PORT, "0.0.0.0", () => {
  console.log(`PW VENOM BOT API listening on ${PORT}`);
});

// ---------- Start bot and optional voice connection ----------

client.once(Events.ClientReady, async readyClient => {
  console.log(`PW VENOM LOGS online as ${readyClient.user.tag}`);

  registerCommands().catch(error => {
    console.error("Command registration failed:", error);
  });

  if (!VOICE_CHANNEL_ID) {
    console.log("VOICE_CHANNEL_ID is not set; skipping voice auto-join.");
    return;
  }

  try {
    const channel = await readyClient.channels.fetch(VOICE_CHANNEL_ID);

    if (!channel || !channel.isVoiceBased() || !channel.guild) {
      console.error("VOICE_CHANNEL_ID is not a valid voice channel.");
      return;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    console.log("PW VENOM connected to voice!");

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      console.warn("Voice connection disconnected.");
    });
  } catch (error) {
    console.error("Voice connection error:", error);
  }
});

client.on("error", error => {
  console.error("Discord client error:", error);
});

client.login(TOKEN);

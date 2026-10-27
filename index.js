
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
  ButtonStyle
} = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} = require("@discordjs/voice");

const express = require("express");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID || "";
const BOT_CONTROL_SECRET = process.env.BOT_CONTROL_SECRET;

if (!TOKEN || !CLIENT_ID) {
  throw new Error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in Railway Variables");
}

const app = express();
app.use(express.json({ limit: "100kb" }));

const CONFIG_FILE = path.join(__dirname, "logs-config.json");

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (error) {
    console.error("Config read error:", error);
    return {};
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

let config = readConfig();

// ================= LOG CATEGORIES =================

const CATEGORIES = {
  messages: {
    label: "🗑️・رسائل محذوفة ومعدلة",
    description: "Deleted and edited messages"
  },
  members: {
    label: "📥・دخول وخروج الأعضاء",
    description: "Member join and leave"
  },
  voice: {
    label: "🎙️・دخول وخروج الفويس",
    description: "Voice join, leave and move"
  },
  roles: {
    label: "🎭・إعطاء وإزالة الرتب",
    description: "Member role changes"
  },
  roleCreate: {
    label: "🆕・إضافة رول",
    description: "New role created"
  },
  channelCreate: {
    label: "🟢・إضافة روم",
    description: "New channel created"
  },
  channelDelete: {
    label: "🔴・إزالة روم",
    description: "Channel deleted"
  }
};

function getGuildConfig(guildId) {
  if (!config[guildId]) config[guildId] = {};
  return config[guildId];
}

async function sendLog(guild, category, title, description) {
  try {
    const channelId = config[guild.id]?.[category];
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !channel.send) return;

    const embed = new EmbedBuilder()
      .setColor(0x171717)
      .setTitle(title)
      .setDescription(String(description || "No details").slice(0, 4000))
      .setFooter({ text: "VENOM LOG" })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error(`Log error [${category}]:`, error.message);
  }
}

// ================= DISCORD CLIENT =================

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

// ================= SETUP COMMAND =================

const setupCommand = new SlashCommandBuilder()
  .setName("setup-logs")
  .setDescription("Configure VENOM LOG for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const rest = new REST({ version: "10" }).setToken(TOKEN);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`VENOM LOG online as ${readyClient.user.tag}`);

  try {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: [setupCommand.toJSON()] }
    );
    console.log("Global /setup-logs command registered");
  } catch (error) {
    console.error("Slash command registration failed:", error);
  }

  // Optional voice auto-join
  if (VOICE_CHANNEL_ID) {
    try {
      const channel = await readyClient.channels.fetch(VOICE_CHANNEL_ID);

      if (!channel || !channel.isVoiceBased() || !channel.guild) {
        console.error("VOICE_CHANNEL_ID is not a valid voice channel");
        return;
      }

      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true
      });

      connection.on(VoiceConnectionStatus.Disconnected, () => {
        console.log("Voice connection disconnected");
      });

      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      console.log(`Connected to voice: ${channel.name}`);
    } catch (error) {
      console.error("Voice join failed:", error.message);
    }
  }
});

// ================= SETUP INTERACTIONS =================

const pendingSetup = new Map();

function categoryMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("venom_category")
    .setPlaceholder("Choose a log category")
    .addOptions(
      Object.entries(CATEGORIES).map(([value, category]) => ({
        label: category.label.slice(0, 100),
        description: category.description,
        value
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function channelMenu() {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId("venom_log_channel")
    .setPlaceholder("Choose the log channel")
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);

  return new ActionRowBuilder().addComponents(menu);
}

function setupButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("venom_enable")
      .setLabel("Enable logs")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("venom_disable")
      .setLabel("Disable logs")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("venom_back")
      .setLabel("Back to categories")
      .setStyle(ButtonStyle.Secondary)
  );
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== "setup-logs") return;

      if (!interaction.guild) {
        return interaction.reply({
          content: "Use this command inside a server.",
          ephemeral: true
        });
      }

      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          content: "You need Manage Server permission.",
          ephemeral: true
        });
      }

      return interaction.reply({
        content: "🕷️ **VENOM LOG — Choose a category**",
        components: [categoryMenu()],
        ephemeral: true
      });
    }

    if (!interaction.guild) return;

    if (interaction.isStringSelectMenu() &&
        interaction.customId === "venom_category") {
      const category = interaction.values[0];
      pendingSetup.set(interaction.user.id, {
        guildId: interaction.guild.id,
        category
      });

      const currentChannel = config[interaction.guild.id]?.[category];

      return interaction.update({
        content:
          `**${CATEGORIES[category].label}**\n` +
          `Current channel: ${currentChannel ? `<#${currentChannel}>` : "Not configured"}\n` +
          "Choose the channel, then enable the category.",
        components: [channelMenu(), setupButtons()]
      });
    }

    if (interaction.isChannelSelectMenu() &&
        interaction.customId === "venom_log_channel") {
      const pending = pendingSetup.get(interaction.user.id);

      if (!pending || pending.guildId !== interaction.guild.id) {
        return interaction.reply({
          content: "Choose a category first with /setup-logs.",
          ephemeral: true
        });
      }

      const channelId = interaction.values[0];
      const guildConfig = getGuildConfig(interaction.guild.id);
      guildConfig[pending.category] = channelId;
      saveConfig(config);

      return interaction.update({
        content:
          `Selected <#${channelId}> for **${CATEGORIES[pending.category].label}**.\n` +
          "Press **Enable logs** to keep this category active.",
        components: [channelMenu(), setupButtons()]
      });
    }

    if (interaction.isButton() &&
        ["venom_enable", "venom_disable", "venom_back"].includes(interaction.customId)) {
      const pending = pendingSetup.get(interaction.user.id);

      if (interaction.customId === "venom_back") {
        return interaction.update({
          content: "🕷️ **VENOM LOG — Choose a category**",
          components: [categoryMenu()]
        });
      }

      if (!pending || pending.guildId !== interaction.guild.id) {
        return interaction.reply({
          content: "Choose a category first with /setup-logs.",
          ephemeral: true
        });
      }

      const guildConfig = getGuildConfig(interaction.guild.id);

      if (interaction.customId === "venom_enable") {
        if (!guildConfig[pending.category]) {
          return interaction.reply({
            content: "Choose a log channel first.",
            ephemeral: true
          });
        }

        guildConfig[`${pending.category}_enabled`] = true;
        saveConfig(config);

        return interaction.update({
          content: `✅ Enabled **${CATEGORIES[pending.category].label}**.`,
          components: [categoryMenu()]
        });
      }

      guildConfig[`${pending.category}_enabled`] = false;
      saveConfig(config);

      return interaction.update({
        content: `❌ Disabled **${CATEGORIES[pending.category].label}**.`,
        components: [categoryMenu()]
      });
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Something went wrong. Check Railway Deploy Logs.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ================= LOG EVENTS =================

// 1. Deleted messages
client.on(Events.MessageDelete, async (message) => {
  if (!message.guild || message.author?.bot) return;
  if (config[message.guild.id]?.messages_enabled === false) return;

  const content = message.content || "Message content unavailable";
  await sendLog(
    message.guild,
    "messages",
    "🗑️・الرسائل المحذوفة",
    `**Member:** ${message.author?.tag || "Unknown"}\n` +
    `**Channel:** <#${message.channelId}>\n` +
    `**Content:**\n${content.slice(0, 3000)}`
  );
});

// 2. Edited messages — old and new content
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;
  if (config[newMessage.guild.id]?.messages_enabled === false) return;

  if (oldMessage.partial) {
    oldMessage = await oldMessage.fetch().catch(() => oldMessage);
  }
  if (newMessage.partial) {
    newMessage = await newMessage.fetch().catch(() => newMessage);
  }

  if (oldMessage.author?.bot || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;

  await sendLog(
    newMessage.guild,
    "messages",
    "✏️・الرسائل المعدّلة",
    `**Member:** ${newMessage.author?.tag || "Unknown"}\n` +
    `**Channel:** <#${newMessage.channelId}>\n` +
    `**Before:**\n${(oldMessage.content || "Unavailable").slice(0, 1500)}\n\n` +
    `**After:**\n${(newMessage.content || "Unavailable").slice(0, 1500)}`
  );
});

// 3. Member join
client.on(Events.GuildMemberAdd, async (member) => {
  if (config[member.guild.id]?.members_enabled === false) return;

  await sendLog(
    member.guild,
    "members",
    "📥・دخول عضو",
    `**Member:** ${member.user.tag}\n**ID:** ${member.id}`
  );
});

// 3. Member leave
client.on(Events.GuildMemberRemove, async (member) => {
  if (config[member.guild.id]?.members_enabled === false) return;

  await sendLog(
    member.guild,
    "members",
    "📤・خروج عضو",
    `**Member:** ${member.user?.tag || "Unknown"}\n**ID:** ${member.id}`
  );
});

// 4. Voice join / leave / move
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  if (config[member.guild.id]?.voice_enabled === false) return;

  let action = "";

  if (!oldState.channelId && newState.channelId) {
    action = `Joined <#${newState.channelId}>`;
  } else if (oldState.channelId && !newState.channelId) {
    action = `Left **${oldState.channel?.name || "voice channel"}**`;
  } else if (oldState.channelId !== newState.channelId) {
    action = `Moved from **${oldState.channel?.name || "unknown"}** to <#${newState.channelId}>`;
  }

  if (!action) return;

  await sendLog(
    member.guild,
    "voice",
    "🎙️・دخول وخروج الفويس",
    `**Member:** ${member.user.tag}\n${action}`
  );
});

// 5. Member role added / removed
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (config[newMember.guild.id]?.roles_enabled === false) return;

  const added = newMember.roles.cache.filter(
    role => !oldMember.roles.cache.has(role.id)
  );
  const removed = oldMember.roles.cache.filter(
    role => !newMember.roles.cache.has(role.id)
  );

  for (const role of added.values()) {
    await sendLog(
      newMember.guild,
      "roles",
      "🎭・إعطاء رول",
      `**Member:** ${newMember.user.tag}\n**Role:** ${role.name}`
    );
  }

  for (const role of removed.values()) {
    await sendLog(
      newMember.guild,
      "roles",
      "🎭・إزالة رول",
      `**Member:** ${newMember.user.tag}\n**Role:** ${role.name}`
    );
  }
});

// 6. Role created
client.on(Events.GuildRoleCreate, async (role) => {
  if (config[role.guild.id]?.roleCreate_enabled === false) return;

  await sendLog(
    role.guild,
    "roleCreate",
    "🆕・إضافة رول",
    `**Role:** ${role.name}\n**ID:** ${role.id}`
  );
});

// 7. Channel created
client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild) return;
  if (config[channel.guild.id]?.channelCreate_enabled === false) return;

  await sendLog(
    channel.guild,
    "channelCreate",
    "🟢・إضافة روم",
    `**Channel:** ${channel.name}\n**ID:** ${channel.id}`
  );
});

// 8. Channel deleted
client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild) return;
  if (config[channel.guild.id]?.channelDelete_enabled === false) return;

  await sendLog(
    channel.guild,
    "channelDelete",
    "🔴・إزالة روم",
    `**Channel:** ${channel.name}\n**ID:** ${channel.id}`
  );
});

// ================= OPTIONAL WEBSITE API =================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    botReady: client.isReady(),
    bot: client.user?.tag || null
  });
});

function authorizeApi(req, res, next) {
  if (!BOT_CONTROL_SECRET ||
      req.get("x-bot-secret") !== BOT_CONTROL_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/api/guild/:guildId", authorizeApi, (req, res) => {
  res.json(config[req.params.guildId] || {});
});

app.put("/api/guild/:guildId", authorizeApi, (req, res) => {
  const guildId = req.params.guildId;

  if (!/^\d{17,20}$/.test(guildId)) {
    return res.status(400).json({ error: "Invalid guild ID" });
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ error: "Invalid config" });
  }

  const allowedKeys = [
    ...Object.keys(CATEGORIES),
    ...Object.keys(CATEGORIES).map(key => `${key}_enabled`)
  ];

  for (const key of Object.keys(req.body)) {
    if (!allowedKeys.includes(key)) {
      return res.status(400).json({ error: `Unsupported key: ${key}` });
    }
  }

  for (const key of Object.keys(CATEGORIES)) {
    if (req.body[key] !== undefined &&
        !/^\d{17,20}$/.test(String(req.body[key]))) {
      return res.status(400).json({ error: `Invalid channel ID for ${key}` });
    }
  }

  config[guildId] = {
    ...(config[guildId] || {}),
    ...req.body
  };

  saveConfig(config);
  res.json({ success: true, config: config[guildId] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`VENOM LOG API listening on ${PORT}`);
});

client.login(TOKEN).catch(error => {
  console.error("Discord login failed:", error.message);
  process.exit(1);
});

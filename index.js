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
  entersState,
  VoiceConnectionStatus
} = require("@discordjs/voice");

const express = require("express");
const fs = require("fs");
const crypto = require("crypto");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
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
  server: "⚙️ Server Events"
};

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

let configs = {};

function defaults() {
  return Object.fromEntries(
    Object.keys(CATEGORIES).map(key => [
      key,
      { enabled: false, channel: null }
    ])
  );
}

function loadConfigs() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(
        fs.readFileSync(CONFIG_FILE, "utf8")
      );

      for (const [id, cfg] of Object.entries(data)) {
        configs[id] = { ...defaults(), ...cfg };
      }
    }
  } catch (error) {
    console.error("Config load error:", error);
  }
}

function getConfig(guildId) {
  if (!configs[guildId]) {
    configs[guildId] = defaults();
  }

  return configs[guildId];
}

function saveConfigs() {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(configs, null, 2)
    );
  } catch (error) {
    console.error("Config save error:", error);
  }
}

function userInfo(user) {
  return `${user?.tag || user?.username || "Unknown"} (${user?.id || "unknown"})`;
}

loadConfigs();

async function sendLog(
  guild,
  category,
  title,
  description,
  color = 0x202225
) {
  try {
    const setting = getConfig(guild.id)[category];

    if (!setting?.enabled || !setting.channel) return;

    const channel = await guild.channels
      .fetch(setting.channel)
      .catch(() => null);

    if (!channel?.isTextBased() || !channel.isSendable()) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(
        String(description || "No details").slice(0, 4000)
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Log send error:", error.message);
  }
}

// أمر إعداد اللوق
const setupCommand = new SlashCommandBuilder()
  .setName("setup-logs")
  .setDescription("Configure logging channels for this server")
  .setDefaultMemberPermissions(
    PermissionFlagsBits.Administrator
  );

async function registerCommands() {
  if (!CLIENT_ID) {
    throw new Error("DISCORD_CLIENT_ID is missing");
  }

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: [setupCommand.toJSON()] }
  );

  console.log("Global /setup-logs command registered.");
}

function makePanel() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("logs_category")
    .setPlaceholder("Choose a log category")
    .addOptions(
      Object.entries(CATEGORIES).map(([value, label]) => ({
        label,
        value,
        description: `Configure ${value} logs`
      }))
    );

  return {
    content:
      "**🕷️ PW VENOM LOGS**\nChoose a category, then select its destination channel.",
    components: [
      new ActionRowBuilder().addComponents(menu)
    ]
  };
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );
}

async function showCategory(interaction, category) {
  if (!Object.hasOwn(CATEGORIES, category)) {
    return interaction.reply({
      content: "Unknown category.",
      ephemeral: true
    });
  }

  const cfg = getConfig(interaction.guildId)[category];

  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId(`logs_channel:${category}`)
    .setPlaceholder("Choose a text channel")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`logs_toggle:${category}`)
      .setLabel(cfg.enabled ? "Disable logs" : "Enable logs")
      .setStyle(
        cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success
      ),

    new ButtonBuilder()
      .setCustomId("logs_refresh")
      .setLabel("Back to categories")
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.update({
    content:
      `**${CATEGORIES[category]}**\n` +
      `Status: **${cfg.enabled ? "Enabled" : "Disabled"}**\n` +
      `Channel: ${cfg.channel ? `<#${cfg.channel}>` : "Not selected"}\n\n` +
      "Choose a text channel, then enable logs.",

    components: [
      new ActionRowBuilder().addComponents(channelMenu),
      buttons
    ]
  });
}

// التعامل مع الأوامر والأزرار
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "setup-logs"
    ) {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: "Use this command inside a server.",
          ephemeral: true
        });
      }

      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: "Administrator permission is required.",
          ephemeral: true
        });
      }

      return interaction.reply({
        ...makePanel(),
        ephemeral: true
      });
    }

    if (!interaction.inGuild()) return;

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "logs_category"
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: "Administrator permission is required.",
          ephemeral: true
        });
      }

      return showCategory(
        interaction,
        interaction.values[0]
      );
    }

    if (
      interaction.isChannelSelectMenu() &&
      interaction.customId.startsWith("logs_channel:")
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: "Administrator permission is required.",
          ephemeral: true
        });
      }

      const category = interaction.customId.split(":")[1];

      if (!Object.hasOwn(CATEGORIES, category)) {
        return interaction.reply({
          content: "Unknown category.",
          ephemeral: true
        });
      }

      const channelId = interaction.values[0];

      const channel = await interaction.guild.channels
        .fetch(channelId)
        .catch(() => null);

      if (!channel || channel.type !== ChannelType.GuildText) {
        return interaction.reply({
          content: "Please select a text channel.",
          ephemeral: true
        });
      }

      const me = interaction.guild.members.me;
      const perms = me ? channel.permissionsFor(me) : null;

      if (
        !perms?.has(PermissionFlagsBits.ViewChannel) ||
        !perms?.has(PermissionFlagsBits.SendMessages) ||
        !perms?.has(PermissionFlagsBits.EmbedLinks)
      ) {
        return interaction.reply({
          content:
            "I need View Channel, Send Messages, and Embed Links in that channel.",
          ephemeral: true
        });
      }

      getConfig(interaction.guildId)[category].channel =
        channelId;

      saveConfigs();

      return showCategory(interaction, category);
    }

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("logs_toggle:")
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: "Administrator permission is required.",
          ephemeral: true
        });
      }

      const category = interaction.customId.split(":")[1];

      if (!Object.hasOwn(CATEGORIES, category)) {
        return interaction.reply({
          content: "Unknown category.",
          ephemeral: true
        });
      }

      const setting = getConfig(interaction.guildId)[category];

      if (!setting.enabled && !setting.channel) {
        return interaction.reply({
          content: "Select a text channel first.",
          ephemeral: true
        });
      }

      setting.enabled = !setting.enabled;
      saveConfigs();

      return showCategory(interaction, category);
    }

    if (
      interaction.isButton() &&
      interaction.customId === "logs_refresh"
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: "Administrator permission is required.",
          ephemeral: true
        });
      }

      return interaction.update(makePanel());
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (
      interaction.isRepliable() &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction.reply({
        content: "An error occurred. Check Railway logs.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// تسجيل حذف الرسائل
client.on(Events.MessageDelete, async message => {
  if (!message.guild || message.author?.bot) return;

  await sendLog(
    message.guild,
    "messages",
    "🗑️ Message Deleted",
    `Author: ${userInfo(message.author)}\n` +
    `Channel: <#${message.channelId}>\n` +
    `Content: ${(message.content || "Unavailable").slice(0, 1500)}`,
    0xED4245
  );
});

// تسجيل تعديل الرسائل
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (
    !newMessage.guild ||
    newMessage.author?.bot ||
    oldMessage.content === newMessage.content
  ) return;

  await sendLog(
    newMessage.guild,
    "messages",
    "✏️ Message Edited",
    `Author: ${userInfo(newMessage.author)}\n` +
    `Channel: <#${newMessage.channelId}>\n` +
    `Before: ${(oldMessage.content || "Unavailable").slice(0, 1000)}\n` +
    `After: ${(newMessage.content || "Unavailable").slice(0, 1000)}`
  );
});

// دخول وخروج الأعضاء
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

// تغيير الألقاب والرتب
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (oldMember.nickname !== newMember.nickname) {
    await sendLog(
      newMember.guild,
      "members",
      "📝 Nickname Changed",
      `${userInfo(newMember.user)}\n` +
      `Before: ${oldMember.nickname || oldMember.user.username}\n` +
      `After: ${newMember.nickname || newMember.user.username}`
    );
  }

  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());

  for (const id of newRoles) {
    if (!oldRoles.has(id)) {
      await sendLog(
        newMember.guild,
        "roles",
        "➕ Role Added",
        `${userInfo(newMember.user)} received <@&${id}>`
      );
    }
  }

  for (const id of oldRoles) {
    if (!newRoles.has(id)) {
      await sendLog(
        newMember.guild,
        "roles",
        "➖ Role Removed",
        `${userInfo(newMember.user)} lost role ID ${id}`
      );
    }
  }
});

// أحداث الصوت
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;

  if (!member) return;

  if (oldState.channelId !== newState.channelId) {
    let description;

    if (!oldState.channelId) {
      description =
        `${userInfo(member.user)} joined <#${newState.channelId}>`;
    } else if (!newState.channelId) {
      description =
        `${userInfo(member.user)} left <#${oldState.channelId}>`;
    } else {
      description =
        `${userInfo(member.user)} moved from <#${oldState.channelId}> to <#${newState.channelId}>`;
    }

    await sendLog(
      guild,
      "voice",
      "🔊 Voice Channel Update",
      description
    );
  }

  if (oldState.serverMute !== newState.serverMute) {
    await sendLog(
      guild,
      "voice",
      "🎙️ Server Mute Changed",
      `${userInfo(member.user)}: ${newState.serverMute ? "Muted" : "Unmuted"}`
    );
  }

  if (oldState.serverDeaf !== newState.serverDeaf) {
    await sendLog(
      guild,
      "voice",
      "🔇 Server Deafen Changed",
      `${userInfo(member.user)}: ${newState.serverDeaf ? "Deafened" : "Undeafened"}`
    );
  }
});

// الحظر وفك الحظر
client.on(Events.GuildBanAdd, async ban => {
  await sendLog(
    ban.guild,
    "moderation",
    "🔨 Member Banned",
    userInfo(ban.user),
    0xED4245
  );
});

client.on(Events.GuildBanRemove, async ban => {
  await sendLog(
    ban.guild,
    "moderation",
    "♻️ Member Unbanned",
    userInfo(ban.user),
    0x57F287
  );
});

// إنشاء وحذف وتغيير أسماء القنوات
client.on(Events.ChannelCreate, async channel => {
  if (!channel.guild) return;

  await sendLog(
    channel.guild,
    "channels",
    "📁 Channel Created",
    `${channel.name} (${channel.id})`
  );
});

client.on(Events.ChannelDelete, async channel => {
  if (!channel.guild) return;

  await sendLog(
    channel.guild,
    "channels",
    "🗑️ Channel Deleted",
    `${channel.name} (${channel.id})`
  );
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.guild || oldChannel.name === newChannel.name) return;

  await sendLog(
    newChannel.guild,
    "channels",
    "✏️ Channel Renamed",
    `Before: ${oldChannel.name}\nAfter: ${newChannel.name}`
  );
});

// إنشاء وحذف وتغيير أسماء الرتب
client.on(Events.GuildRoleCreate, async role => {
  await sendLog(
    role.guild,
    "roles",
    "🎭 Role Created",
    `${role.name} (${role.id})`
  );
});

client.on(Events.GuildRoleDelete, async role => {
  await sendLog(
    role.guild,
    "roles",
    "🗑️ Role Deleted",
    `${role.name} (${role.id})`
  );
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  if (oldRole.name === newRole.name) return;

  await sendLog(
    newRole.guild,
    "roles",
    "✏️ Role Renamed",
    `Before: ${oldRole.name}\nAfter: ${newRole.name}`
  );
});

// تغيير اسم السيرفر
client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
  if (oldGuild.name === newGuild.name) return;

  await sendLog(
    newGuild,
    "server",
    "🏷️ Server Renamed",
    `Before: ${oldGuild.name}\nAfter: ${newGuild.name}`
  );
});

// API للموقع
const api = express();
api.use(express.json({ limit: "20kb" }));

function validSecret(req, res, next) {
  const supplied = Buffer.from(req.get("x-bot-secret") || "");
  const expected = Buffer.from(API_SECRET);

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
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
      return res.status(404).json({
        error: "Bot is not in this server"
      });
    }

    const channels = guild.channels.cache
      .filter(channel => channel.type === ChannelType.GuildText)
      .map(channel => ({
        id: channel.id,
        name: channel.name
      }));

    res.json({
      guild: { id: guild.id, name: guild.name },
      categories: CATEGORIES,
      config: getConfig(guild.id),
      channels
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
      return res.status(404).json({
        error: "Bot is not in this server"
      });
    }

    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body)
    ) {
      return res.status(400).json({ error: "Invalid settings" });
    }

    const config = getConfig(guild.id);

    for (const key of Object.keys(CATEGORIES)) {
      if (!Object.hasOwn(req.body, key)) continue;

      const item = req.body[key];

      if (!item || typeof item.enabled !== "boolean") {
        return res.status(400).json({
          error: `Invalid setting: ${key}`
        });
      }

      const channelId = item.channel;

      if (channelId !== null && typeof channelId !== "string") {
        return res.status(400).json({
          error: `Invalid channel: ${key}`
        });
      }

      if (channelId !== null) {
        const channel = await guild.channels
          .fetch(channelId)
          .catch(() => null);

        if (!channel || channel.type !== ChannelType.GuildText) {
          return res.status(400).json({
            error: `Invalid text channel: ${key}`
          });
        }
      }

      if (item.enabled && !channelId) {
        return res.status(400).json({
          error: `Choose a channel before enabling ${key}`
        });
      }

      config[key] = {
        enabled: item.enabled,
        channel: channelId
      };
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

// تشغيل البوت والاتصال الصوتي الاختياري
client.once(Events.ClientReady, async ready => {
  console.log(`PW VENOM LOGS online as ${ready.user.tag}`);

  registerCommands().catch(error => {
    console.error("Command registration failed:", error);
  });

  if (!VOICE_CHANNEL_ID) {
    console.log("VOICE_CHANNEL_ID is not set; skipping voice auto-join.");
    return;
  }

  try {
    const channel = await ready.channels.fetch(VOICE_CHANNEL_ID);

    if (!channel || !channel.isVoiceBased() || !channel.guild) {
      console.error("VOICE_CHANNEL_ID is not a valid voice channel.");
      return;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true
    });

    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      30000
    );

    console.log("PW VENOM connected to voice!");

    connection.on(
      VoiceConnectionStatus.Disconnected,
      () => console.warn("Voice connection disconnected.")
    );
  } catch (error) {
    console.error("Voice connection error:", error);
  }
});

client.on("error", error => {
  console.error("Discord client error:", error);
});

client.login(TOKEN);
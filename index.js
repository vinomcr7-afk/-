
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

const fs = require("fs");
const path = require("path");

// =============== CONFIG ===============

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  throw new Error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in Railway Variables");
}

const CONFIG_FILE = path.join(__dirname, "logs-config.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

let configs = loadConfig();

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
}

function getConfig(guildId) {
  if (!configs[guildId]) configs[guildId] = {};
  return configs[guildId];
}

// =============== LOG TYPES ===============

const LOG_TYPES = {
  deleted: {
    label: "🗑️・Deleted Messages",
    description: "Deleted messages"
  },
  edited: {
    label: "✏️・Edited Messages",
    description: "Edited messages"
  },
  memberJoin: {
    label: "📥・Member Join",
    description: "Members joining"
  },
  memberLeave: {
    label: "📤・Member Leave",
    description: "Members leaving"
  },
  voiceJoin: {
    label: "🎙️・Voice Join",
    description: "Members joining voice"
  },
  voiceLeave: {
    label: "🔇・Voice Leave",
    description: "Members leaving voice"
  },
  roleAdded: {
    label: "🎭・Role Added",
    description: "Role assigned to member"
  },
  roleRemoved: {
    label: "➖・Role Removed",
    description: "Role removed from member"
  },
  channelCreated: {
    label: "🟢・Channel Created",
    description: "New channel created"
  },
  channelDeleted: {
    label: "🔴・Channel Deleted",
    description: "Channel deleted"
  }
};

// =============== CLIENT ===============

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.GuildMember
  ]
});

// =============== SEND LOG ===============

async function sendLog(guild, type, title, description) {
  try {
    const entry = configs[guild.id]?.[type];

    if (!entry?.enabled || !entry?.channelId) return;

    const channel = await guild.channels
      .fetch(entry.channelId)
      .catch(() => null);

    if (!channel || !channel.isTextBased() || !channel.send) return;

    const embed = new EmbedBuilder()
      .setColor(0x171717)
      .setTitle(title)
      .setDescription(String(description).slice(0, 4000))
      .setFooter({ text: "VENOM LOG" })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error(`Log error (${type}):`, error.message);
  }
}

// =============== SLASH COMMAND ===============

const command = new SlashCommandBuilder()
  .setName("setup-logs")
  .setDescription("Configure VENOM LOG")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const rest = new REST({ version: "10" }).setToken(TOKEN);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`VENOM LOG online as ${readyClient.user.tag}`);

  try {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: [command.toJSON()] }
    );
    console.log("Global /setup-logs registered");
  } catch (error) {
    console.error("Command registration error:", error);
  }
});

// =============== SETUP MENU ===============

const sessions = new Map();

function makeCategoryMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("venom_categories")
    .setPlaceholder("Select a log type")
    .addOptions(
      Object.entries(LOG_TYPES).map(([value, item]) => ({
        label: item.label,
        description: item.description,
        value
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function makeChannelMenu() {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId("venom_channel")
    .setPlaceholder("Select a log channel")
    .setChannelTypes(
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement
    );

  return new ActionRowBuilder().addComponents(menu);
}

function makeButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("venom_enable")
      .setLabel("Enable")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("venom_disable")
      .setLabel("Disable")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("venom_back")
      .setLabel("Back")
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

      if (!interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageGuild
      )) {
        return interaction.reply({
          content: "You need Manage Server permission.",
          ephemeral: true
        });
      }

      return interaction.reply({
        content: "🕷️ VENOM LOG — Select a log type",
        components: [makeCategoryMenu()],
        ephemeral: true
      });
    }

    if (!interaction.guild) return;

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "venom_categories"
    ) {
      const type = interaction.values[0];

      sessions.set(interaction.user.id, {
        guildId: interaction.guild.id,
        type
      });

      const entry = configs[interaction.guild.id]?.[type];

      return interaction.update({
        content:
          `**${LOG_TYPES[type].label}**\n` +
          `Current channel: ${entry?.channelId ? `<#${entry.channelId}>` : "Not set"}\n` +
          `Status: ${entry?.enabled ? "Enabled" : "Disabled"}\n` +
          "Select a channel, then press Enable.",
        components: [makeChannelMenu(), makeButtons()]
      });
    }

    if (
      interaction.isChannelSelectMenu() &&
      interaction.customId === "venom_channel"
    ) {
      const session = sessions.get(interaction.user.id);

      if (!session || session.guildId !== interaction.guild.id) {
        return interaction.reply({
          content: "Run /setup-logs and select a category first.",
          ephemeral: true
        });
      }

      const channelId = interaction.values[0];
      const settings = getConfig(interaction.guild.id);

      if (!settings[session.type]) {
        settings[session.type] = {
          channelId: null,
          enabled: false
        };
      }

      settings[session.type].channelId = channelId;
      saveConfig();

      return interaction.update({
        content:
          `Selected <#${channelId}> for **${LOG_TYPES[session.type].label}**.\n` +
          "Press Enable to activate this log.",
        components: [makeChannelMenu(), makeButtons()]
      });
    }

    if (
      interaction.isButton() &&
      ["venom_enable", "venom_disable", "venom_back"].includes(
        interaction.customId
      )
    ) {
      if (interaction.customId === "venom_back") {
        return interaction.update({
          content: "🕷️ VENOM LOG — Select a log type",
          components: [makeCategoryMenu()]
        });
      }

      const session = sessions.get(interaction.user.id);

      if (!session || session.guildId !== interaction.guild.id) {
        return interaction.reply({
          content: "Run /setup-logs and select a category first.",
          ephemeral: true
        });
      }

      const settings = getConfig(interaction.guild.id);
      const entry = settings[session.type];

      if (interaction.customId === "venom_enable") {
        if (!entry?.channelId) {
          return interaction.reply({
            content: "Select a channel first.",
            ephemeral: true
          });
        }

        entry.enabled = true;
        saveConfig();

        return interaction.update({
          content:
            `✅ Enabled ${LOG_TYPES[session.type].label} in <#${entry.channelId}>.`,
          components: [makeCategoryMenu()]
        });
      }

      if (entry) entry.enabled = false;
      saveConfig();

      return interaction.update({
        content: `❌ Disabled ${LOG_TYPES[session.type].label}.`,
        components: [makeCategoryMenu()]
      });
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.isRepliable() &&
        !interaction.replied &&
        !interaction.deferred) {
      await interaction.reply({
        content: "An error occurred. Check Railway Deploy Logs.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// =============== 1. DELETED MESSAGES ===============

client.on(Events.MessageDelete, async (message) => {
  if (!message.guild || message.author?.bot) return;

  const content = message.content ||
    "Content unavailable (message may not have been cached)";

  await sendLog(
    message.guild,
    "deleted",
    "🗑️・Deleted Messages",
    `**Author:** ${message.author?.tag || "Unknown"}\n` +
    `**Channel:** <#${message.channelId}>\n` +
    `**Content:**\n${content.slice(0, 3000)}`
  );
});

// =============== 2. EDITED MESSAGES ===============

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;

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
    "edited",
    "✏️・Edited Messages",
    `**Author:** ${newMessage.author?.tag || "Unknown"}\n` +
    `**Channel:** <#${newMessage.channelId}>\n` +
    `**Before:**\n${(oldMessage.content || "Content unavailable").slice(0, 1500)}\n\n` +
    `**After:**\n${(newMessage.content || "Content unavailable").slice(0, 1500)}`
  );
});

// =============== 3. MEMBER JOIN ===============

client.on(Events.GuildMemberAdd, async (member) => {
  await sendLog(
    member.guild,
    "memberJoin",
    "📥・Member Join",
    `**Member:** ${member.user.tag}\n**ID:** ${member.id}`
  );
});

// =============== 4. MEMBER LEAVE ===============

client.on(Events.GuildMemberRemove, async (member) => {
  await sendLog(
    member.guild,
    "memberLeave",
    "📤・Member Leave",
    `**Member:** ${member.user?.tag || "Unknown"}\n**ID:** ${member.id}`
  );
});

// =============== 5 & 6. VOICE JOIN / LEAVE ===============

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  if (!oldState.channelId && newState.channelId) {
    await sendLog(
      member.guild,
      "voiceJoin",
      "🎙️・Voice Join",
      `**Member:** ${member.user.tag}\n**Channel:** <#${newState.channelId}>`
    );
  }

  if (oldState.channelId && !newState.channelId) {
    await sendLog(
      member.guild,
      "voiceLeave",
      "🔇・Voice Leave",
      `**Member:** ${member.user.tag}\n**Channel:** ${oldState.channel?.name || "Unknown"}`
    );
  }
});

// =============== 7 & 8. ROLE ADDED / REMOVED ===============

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const added = newMember.roles.cache.filter(
    role => !oldMember.roles.cache.has(role.id)
  );

  const removed = oldMember.roles.cache.filter(
    role => !newMember.roles.cache.has(role.id)
  );

  for (const role of added.values()) {
    await sendLog(
      newMember.guild,
      "roleAdded",
      "🎭・Role Added",
      `**Member:** ${newMember.user.tag}\n**Role:** ${role.name}`
    );
  }

  for (const role of removed.values()) {
    await sendLog(
      newMember.guild,
      "roleRemoved",
      "➖・Role Removed",
      `**Member:** ${newMember.user.tag}\n**Role:** ${role.name}`
    );
  }
});

// =============== 9. CHANNEL CREATED ===============

client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild) return;

  await sendLog(
    channel.guild,
    "channelCreated",
    "🟢・Channel Created",
    `**Channel:** ${channel.name}\n**ID:** ${channel.id}`
  );
});

// =============== 10. CHANNEL DELETED ===============

client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild) return;

  await sendLog(
    channel.guild,
    "channelDeleted",
    "🔴・Channel Deleted",
    `**Channel:** ${channel.name}\n**ID:** ${channel.id}`
  );
});

// =============== LOGIN ===============

client.login(TOKEN).catch(error => {
  console.error("Discord login failed:", error.message);
  process.exit(1);
});

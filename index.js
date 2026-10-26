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

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) throw new Error("DISCORD_TOKEN is missing!");

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

const FILE = path.join(__dirname, "logs-config.json");

const CATEGORIES = {
  messages: "💬 Messages",
  members: "👥 Members",
  voice: "🔊 Voice",
  moderation: "🛡️ Moderation",
  roles: "🎭 Roles",
  channels: "📁 Channels",
  server: "⚙️ Server Events"
};

const defaults = () => ({
  messages: { enabled: false, channel: null },
  members: { enabled: false, channel: null },
  voice: { enabled: false, channel: null },
  moderation: { enabled: false, channel: null },
  roles: { enabled: false, channel: null },
  channels: { enabled: false, channel: null },
  server: { enabled: false, channel: null }
});

let configs = {};

try {
  if (fs.existsSync(FILE)) {
    configs = JSON.parse(fs.readFileSync(FILE, "utf8"));
  }
} catch (error) {
  console.error("Config read error:", error);
}

function saveConfigs() {
  fs.writeFileSync(FILE, JSON.stringify(configs, null, 2));
}

function getConfig(guildId) {
  if (!configs[guildId]) configs[guildId] = defaults();

  for (const key of Object.keys(CATEGORIES)) {
    if (!configs[guildId][key]) {
      configs[guildId][key] = {
        enabled: false,
        channel: null
      };
    }
  }

  return configs[guildId];
}

function makePanel(guild, selected = "messages") {
  const config = getConfig(guild.id);
  const category = CATEGORIES[selected];
  const setting = config[selected];

  const embed = new EmbedBuilder()
    .setColor(0x8B0000)
    .setTitle("🕷️ PW VENOM LOGS")
    .setDescription(
      "Choose a log category, select its channel, then enable or disable it.\n\n" +
      `**Selected:** ${category}\n` +
      `**Status:** ${setting.enabled ? "🟢 Enabled" : "🔴 Disabled"}\n` +
      `**Log channel:** ${
        setting.channel
          ? `<#${setting.channel}>`
          : "Not selected"
      }\n\n` +
      "Only server administrators can change these settings."
    )
    .setFooter({ text: `Category: ${selected}` });

  const categoryMenu = new StringSelectMenuBuilder()
    .setCustomId("logs_category")
    .setPlaceholder("Choose a log category")
    .addOptions(
      Object.entries(CATEGORIES).map(([value, label]) => ({
        label: label.replace(/^[^\w]+ /, ""),
        value,
        description: `Configure ${label.replace(/^[^\w]+ /, "")}`,
        default: value === selected
      }))
    );

  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId(`logs_channel:${selected}`)
    .setPlaceholder("Choose a channel for this log")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);

  const toggleButton = new ButtonBuilder()
    .setCustomId(`logs_toggle:${selected}`)
    .setLabel(setting.enabled ? "Disable logs" : "Enable logs")
    .setStyle(setting.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const refreshButton = new ButtonBuilder()
    .setCustomId(`logs_refresh:${selected}`)
    .setLabel("Refresh")
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(categoryMenu),
      new ActionRowBuilder().addComponents(channelMenu),
      new ActionRowBuilder().addComponents(toggleButton, refreshButton)
    ],
    flags: 64
  };
}

async function sendLog(guild, category, title, description, color = 0x8B0000) {
  try {
    const setting = getConfig(guild.id)[category];

    if (!setting.enabled || !setting.channel) return;

    const channel = await guild.channels.fetch(setting.channel).catch(() => null);

    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(String(description).slice(0, 4000))
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Log error:", error.message);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`PW VENOM LOGS online as ${client.user.tag}`);

  const command = new SlashCommandBuilder()
    .setName("setup-logs")
    .setDescription("Open the PW VENOM LOGS control panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  for (const guild of client.guilds.cache.values()) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guild.id),
        { body: [command.toJSON()] }
      );
      console.log(`Registered /setup-logs in ${guild.name}`);
    } catch (error) {
      console.error(`Command registration error in ${guild.name}:`, error.message);
    }
  }
});

// Control panel
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== "setup-logs") return;

      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "❌ Only server administrators can use this panel.",
          flags: 64
        });
      }

      return interaction.reply(makePanel(interaction.guild, "messages"));
    }

    if (!interaction.inGuild()) return;

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: "❌ Only server administrators can change log settings.",
        flags: 64
      });
    }

    if (interaction.isStringSelectMenu() &&
        interaction.customId === "logs_category") {
      return interaction.update(
        makePanel(interaction.guild, interaction.values[0])
      );
    }

    if (interaction.isChannelSelectMenu() &&
        interaction.customId.startsWith("logs_channel:")) {
      const category = interaction.customId.split(":")[1];
      const channelId = interaction.values[0];

      getConfig(interaction.guildId)[category].channel = channelId;
      saveConfigs();

      return interaction.update(makePanel(interaction.guild, category));
    }

    if (interaction.isButton() &&
        interaction.customId.startsWith("logs_toggle:")) {
      const category = interaction.customId.split(":")[1];
      const setting = getConfig(interaction.guildId)[category];

      if (!setting.channel) {
        return interaction.reply({
          content: "⚠️ Choose a log channel first!",
          flags: 64
        });
      }

      setting.enabled = !setting.enabled;
      saveConfigs();

      return interaction.update(makePanel(interaction.guild, category));
    }

    if (interaction.isButton() &&
        interaction.customId.startsWith("logs_refresh:")) {
      const category = interaction.customId.split(":")[1];
      return interaction.update(makePanel(interaction.guild, category));
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Something went wrong. Check Railway Logs.",
        flags: 64
      }).catch(() => {});
    }
  }
});

// Message deleted
client.on(Events.MessageDelete, async message => {
  if (!message.guild || message.author?.bot) return;

  await sendLog(
    message.guild,
    "messages",
    "🗑️ Message Deleted",
    `**Author:** ${message.author || "Unknown"}\n` +
    `**Channel:** ${message.channel}\n` +
    `**Content:** ${message.content || "Unavailable"}`
  );
});

// Message edited
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;

  if (oldMessage.partial) {
    await oldMessage.fetch().catch(() => null);
  }

  if (oldMessage.content === newMessage.content) return;

  await sendLog(
    newMessage.guild,
    "messages",
    "✏️ Message Edited",
    `**Author:** ${newMessage.author || "Unknown"}\n` +
    `**Channel:** ${newMessage.channel}\n` +
    `**Before:** ${oldMessage.content || "Unavailable"}\n` +
    `**After:** ${newMessage.content || "Unavailable"}`
  );
});

// Member joined
client.on(Events.GuildMemberAdd, async member => {
  await sendLog(
    member.guild,
    "members",
    "📥 Member Joined",
    `${member.user.tag} (${member.id})`
  );
});

// Member left
client.on(Events.GuildMemberRemove, async member => {
  await sendLog(
    member.guild,
    "members",
    "📤 Member Left",
    `${member.user?.tag || member.id} (${member.id})`
  );
});

// Nickname and role changes
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (oldMember.nickname !== newMember.nickname) {
    await sendLog(
      newMember.guild,
      "members",
      "🏷️ Nickname Changed",
      `**Member:** ${newMember.user.tag}\n` +
      `**Before:** ${oldMember.nickname || oldMember.user.username}\n` +
      `**After:** ${newMember.nickname || newMember.user.username}`
    );
  }

  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());

  const added = [...newRoles].filter(id => !oldRoles.has(id));
  const removed = [...oldRoles].filter(id => !newRoles.has(id));

  for (const id of added) {
    const role = newMember.guild.roles.cache.get(id);
    await sendLog(
      newMember.guild,
      "roles",
      "➕ Role Added to Member",
      `**Member:** ${newMember.user.tag}\n**Role:** ${role || id}`
    );
  }

  for (const id of removed) {
    const role = oldMember.guild.roles.cache.get(id);
    await sendLog(
      newMember.guild,
      "roles",
      "➖ Role Removed from Member",
      `**Member:** ${newMember.user.tag}\n**Role:** ${role || id}`
    );
  }
});

// Voice actions
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;
  if (!guild || !member) return;

  if (!oldState.channelId && newState.channelId) {
    await sendLog(guild, "voice", "🔊 Joined Voice",
      `${member.user.tag} joined <#${newState.channelId}>`);
  } else if (oldState.channelId && !newState.channelId) {
    await sendLog(guild, "voice", "🔇 Left Voice",
      `${member.user.tag} left <#${oldState.channelId}>`);
  } else if (oldState.channelId !== newState.channelId) {
    await sendLog(guild, "voice", "🔁 Voice Channel Changed",
      `${member.user.tag}: <#${oldState.channelId}> ➜ <#${newState.channelId}>`);
  } else if (oldState.serverMute !== newState.serverMute ||
             oldState.serverDeaf !== newState.serverDeaf) {
    await sendLog(guild, "voice", "🎙️ Voice Status Changed",
      `${member.user.tag}\nServer mute: ${newState.serverMute}\nServer deaf: ${newState.serverDeaf}`);
  }
});

// Ban and unban
client.on(Events.GuildBanAdd, async ban => {
  await sendLog(ban.guild, "moderation", "🔨 Member Banned",
    `${ban.user.tag} (${ban.user.id})`);
});

client.on(Events.GuildBanRemove, async ban => {
  await sendLog(ban.guild, "moderation", "🔓 Member Unbanned",
    `${ban.user.tag} (${ban.user.id})`);
});

// Channel actions
client.on(Events.ChannelCreate, async channel => {
  if (!channel.guild) return;

  await sendLog(channel.guild, "channels", "📁 Channel Created",
    `**Name:** ${channel.name}\n**ID:** ${channel.id}`);
});

client.on(Events.ChannelDelete, async channel => {
  if (!channel.guild) return;

  await sendLog(channel.guild, "channels", "🗑️ Channel Deleted",
    `**Name:** ${channel.name}\n**ID:** ${channel.id}`);
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;

  if (oldChannel.name !== newChannel.name) {
    await sendLog(newChannel.guild, "channels", "✏️ Channel Renamed",
      `**Before:** ${oldChannel.name}\n**After:** ${newChannel.name}`);
  }
});

// Role actions
client.on(Events.GuildRoleCreate, async role => {
  await sendLog(role.guild, "roles", "🎭 Role Created",
    `**Role:** ${role.name}\n**ID:** ${role.id}`);
});

client.on(Events.GuildRoleDelete, async role => {
  await sendLog(role.guild, "roles", "🗑️ Role Deleted",
    `**Role:** ${role.name}\n**ID:** ${role.id}`);
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  if (oldRole.name !== newRole.name) {
    await sendLog(newRole.guild, "roles", "✏️ Role Renamed",
      `**Before:** ${oldRole.name}\n**After:** ${newRole.name}`);
  }
});

client.login(TOKEN);
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  AuditLogEvent,
  Events
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ==========================================
// PW VENOM LOGS 🕷️
// Discord.js v14
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "❌ Missing DISCORD_TOKEN, CLIENT_ID or GUILD_ID in Railway Variables."
  );
  process.exit(1);
}

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
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember,
    Partials.User
  ]
});

// ==========================================
// STORAGE
// ==========================================

const DATA_DIR = path.join(__dirname, "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({}, null, 2));
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getLogChannelId(guildId) {
  const config = readConfig();
  return config[guildId]?.logChannelId || process.env.LOG_CHANNEL_ID;
}

// ==========================================
// COLORS & EMBEDS
// ==========================================

const RED = 0xD00000;
const BLACK = 0x111111;

function createEmbed(title, description, color = RED) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`🕷️ PW VENOM LOGS | ${title}`)
    .setDescription(description || "No details available.")
    .setTimestamp()
    .setFooter({
      text: "PW VENOM LOGS",
      iconURL: client.user?.displayAvatarURL()
    });
}

async function sendLog(guild, embed) {
  try {
    const channelId = getLogChannelId(guild.id);

    if (!channelId) return;

    const channel = await guild.channels
      .fetch(channelId)
      .catch(() => null);

    if (!channel || !channel.isTextBased()) return;

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Log send error:", error.message);
  }
}

// ==========================================
// USER INFORMATION
// ==========================================

function userInfo(user) {
  if (!user) {
    return "غير معروف";
  }

  return [
    `**الاسم:** ${user.username}`,
    `**المنشن:** ${user}`,
    `**ID:** \`${user.id}\``
  ].join("\n");
}

function setUserThumbnail(embed, user) {
  if (user) {
    embed.setThumbnail(
      user.displayAvatarURL({ size: 256 })
    );
  }

  return embed;
}

function clip(text, max = 900) {
  if (!text) return "لا يوجد محتوى";

  return text.length > max
    ? text.slice(0, max) + "..."
    : text;
}

// ==========================================
// AUDIT LOG DETECTION
// ==========================================

const auditCache = new Map();

async function findExecutor(
  guild,
  action,
  targetId = null,
  maxAge = 15000
) {
  try {
    const logs = await guild.fetchAuditLogs({
      type: action,
      limit: 6
    });

    const now = Date.now();

    for (const entry of logs.entries.values()) {
      if (now - entry.createdTimestamp > maxAge) {
        continue;
      }

      if (
        targetId &&
        entry.target?.id &&
        entry.target.id !== targetId
      ) {
        continue;
      }

      const cacheKey = `${guild.id}:${entry.id}`;

      if (auditCache.has(cacheKey)) {
        continue;
      }

      auditCache.set(cacheKey, now);

      return {
        executor: entry.executor,
        reason: entry.reason || "لم يتم تحديد السبب",
        entry
      };
    }
  } catch (error) {
    console.error("Audit log error:", error.message);
  }

  return null;
}

// Clean old cache entries
setInterval(() => {
  const now = Date.now();

  for (const [key, timestamp] of auditCache.entries()) {
    if (now - timestamp > 60000) {
      auditCache.delete(key);
    }
  }
}, 30000).unref();

// ==========================================
// SLASH COMMANDS
// ==========================================

const commands = [
  new SlashCommandBuilder()
    .setName("setlogs")
    .setDescription("تحديد قناة سجلات السيرفر")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("اختر قناة اللوق")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    ),

  new SlashCommandBuilder()
    .setName("logstest")
    .setDescription("اختبار نظام اللوق")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    ),

  new SlashCommandBuilder()
    .setName("loginfo")
    .setDescription("عرض إعدادات اللوق الحالية")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )
].map(command => command.toJSON());

// ==========================================
// REGISTER COMMANDS
// ==========================================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("✅ Slash commands registered.");
}

// ==========================================
// READY
// ==========================================

client.once(Events.ClientReady, async readyClient => {
  console.log(`✅ ${readyClient.user.tag} is online!`);
  console.log("🕷️ PW VENOM LOGS started.");

  try {
    await registerCommands();
  } catch (error) {
    console.error("Command registration error:", error);
  }

  client.user.setPresence({
    activities: [
      {
        name: "PW VENOM LOGS 🕷️",
        type: 3
      }
    ],
    status: "online"
  });
});

// ==========================================
// COMMAND HANDLER
// ==========================================

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "setlogs") {
    const channel = interaction.options.getChannel("channel");

    if (!channel.isTextBased()) {
      return interaction.reply({
        content: "❌ اختر قناة نصية.",
        ephemeral: true
      });
    }

    const config = readConfig();

    config[interaction.guildId] = {
      ...config[interaction.guildId],
      logChannelId: channel.id
    };

    saveConfig(config);

    return interaction.reply({
      content: `✅ تم تحديد قناة اللوق: ${channel}`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "logstest") {
    await interaction.reply({
      content: "✅ تم إرسال رسالة اختبار إلى قناة اللوق.",
      ephemeral: true
    });

    const embed = createEmbed(
      "TEST",
      "🕷️ نظام PW VENOM LOGS يعمل بنجاح!"
    );

    setUserThumbnail(embed, interaction.user);

    return sendLog(interaction.guild, embed);
  }

  if (interaction.commandName === "loginfo") {
    const channelId = getLogChannelId(interaction.guildId);

    return interaction.reply({
      content: channelId
        ? `📋 قناة اللوق الحالية: <#${channelId}>`
        : "❌ لم يتم إعداد قناة اللوق. استخدم /setlogs",
      ephemeral: true
    });
  }
});

// ==========================================
// MESSAGE DELETE
// ==========================================

client.on(Events.MessageDelete, async message => {
  if (!message.guild) return;

  const embed = createEmbed(
    "MESSAGE DELETED",
    [
      `**صاحب الرسالة:** ${message.author || "غير معروف"}`,
      `**ID:** \`${message.author?.id || "Unknown"}\``,
      `**القناة:** ${message.channel}`,
      `**محتوى الرسالة:**`,
      clip(message.content),
      "",
      "⚠️ لا يمكن تحديد الشخص الذي حذف الرسالة العادية بشكل موثوق من Audit Logs."
    ].join("\n")
  );

  if (message.author) {
    setUserThumbnail(embed, message.author);
  }

  if (message.attachments?.size) {
    embed.addFields({
      name: "المرفقات",
      value: message.attachments
        .map(a => a.url)
        .join("\n")
        .slice(0, 1000)
    });
  }

  await sendLog(message.guild, embed);
});

// ==========================================
// MESSAGE EDIT
// ==========================================

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;

  if (oldMessage.partial || newMessage.partial) {
    try {
      await oldMessage.fetch();
      await newMessage.fetch();
    } catch {
      return;
    }
  }

  if (oldMessage.content === newMessage.content) return;

  const embed = createEmbed(
    "MESSAGE EDITED",
    [
      `**الكاتب:** ${newMessage.author || "غير معروف"}`,
      `**القناة:** ${newMessage.channel}`,
      `**قبل التعديل:**`,
      clip(oldMessage.content),
      "",
      `**بعد التعديل:**`,
      clip(newMessage.content),
      "",
      `[الانتقال إلى الرسالة](${newMessage.url})`
    ].join("\n")
  );

  setUserThumbnail(embed, newMessage.author);

  await sendLog(newMessage.guild, embed);
});

// ==========================================
// MEMBER JOIN
// ==========================================

client.on(Events.GuildMemberAdd, async member => {
  const embed = createEmbed(
    "MEMBER JOINED",
    [
      `**العضو:** ${member.user}`,
      `**الاسم:** ${member.user.username}`,
      `**ID:** \`${member.id}\``,
      `**عدد الأعضاء:** ${member.guild.memberCount}`,
      `**الحساب أُنشئ:** <t:${Math.floor(
        member.user.createdTimestamp / 1000
      )}:R>`
    ].join("\n"),
    0x2ECC71
  );

  setUserThumbnail(embed, member.user);

  await sendLog(member.guild, embed);
});

// ==========================================
// MEMBER LEAVE / POSSIBLE KICK
// ==========================================

client.on(Events.GuildMemberRemove, async member => {
  const guild = member.guild;

  // A leave event alone does not prove a kick.
  const result = await findExecutor(
    guild,
    AuditLogEvent.MemberKick,
    member.id
  );

  const embed = createEmbed(
    result ? "MEMBER KICKED" : "MEMBER LEFT",
    [
      `**العضو:** ${member.user || member.id}`,
      `**ID:** \`${member.id}\``,
      result
        ? `**منفّذ الطرد:**\n${userInfo(result.executor)}`
        : "**السبب:** لم يتم إثبات أن العضو طُرد؛ ربما غادر بنفسه.",
      result
        ? `**سبب الطرد:** ${result.reason}`
        : ""
    ].filter(Boolean).join("\n")
  );

  if (result?.executor) {
    setUserThumbnail(embed, result.executor);
  } else if (member.user) {
    setUserThumbnail(embed, member.user);
  }

  await sendLog(guild, embed);
});

// ==========================================
// BAN ADD
// ==========================================

client.on(Events.GuildBanAdd, async ban => {
  const result = await findExecutor(
    ban.guild,
    AuditLogEvent.MemberBanAdd,
    ban.user.id
  );

  const embed = createEmbed(
    "MEMBER BANNED",
    [
      `**العضو المحظور:** ${userInfo(ban.user)}`,
      result
        ? `**منفّذ الحظر:**\n${userInfo(result.executor)}`
        : "**منفّذ الحظر:** غير معروف",
      result ? `**السبب:** ${result.reason}` : ""
    ].filter(Boolean).join("\n")
  );

  setUserThumbnail(embed, result?.executor || ban.user);

  await sendLog(ban.guild, embed);
});

// ==========================================
// BAN REMOVE
// ==========================================

client.on(Events.GuildBanRemove, async ban => {
  const result = await findExecutor(
    ban.guild,
    AuditLogEvent.MemberBanRemove,
    ban.user.id
  );

  const embed = createEmbed(
    "MEMBER UNBANNED",
    [
      `**العضو:** ${userInfo(ban.user)}`,
      result
        ? `**منفّذ فك الحظر:**\n${userInfo(result.executor)}`
        : "**منفّذ فك الحظر:** غير معروف"
    ].join("\n")
  );

  setUserThumbnail(embed, result?.executor || ban.user);

  await sendLog(ban.guild, embed);
});

// ==========================================
// CHANNEL CREATE
// ==========================================

client.on(Events.ChannelCreate, async channel => {
  if (!channel.guild) return;

  const result = await findExecutor(
    channel.guild,
    AuditLogEvent.ChannelCreate,
    channel.id
  );

  const embed = createEmbed(
    "CHANNEL CREATED",
    [
      `**القناة:** ${channel}`,
      `**اسم القناة:** ${channel.name}`,
      `**ID:** \`${channel.id}\``,
      result
        ? `**منشئ القناة:**\n${userInfo(result.executor)}`
        : "**منشئ القناة:** غير معروف"
    ].join("\n")
  );

  setUserThumbnail(embed, result?.executor);

  await sendLog(channel.guild, embed);
});

// ==========================================
// CHANNEL DELETE
// ==========================================

client.on(Events.ChannelDelete, async channel => {
  if (!channel.guild) return;

  const result = await findExecutor(
    channel.guild,
    AuditLogEvent.ChannelDelete,
    channel.id
  );

  const embed = createEmbed(
    "CHANNEL DELETED",
    [
      `**اسم القناة:** ${channel.name}`,
      `**ID:** \`${channel.id}\``,
      result
        ? `**منفّذ الحذف:**\n${userInfo(result.executor)}`
        : "**منفّذ الحذف:** غير معروف"
    ].join("\n")
  );

  setUserThumbnail(embed, result?.executor);

  await sendLog(channel.guild, embed);
});

// ==========================================
// ROLE CREATE
// ==========================================

client.on(Events.GuildRoleCreate, async role => {
  const result = await findExecutor(
    role.guild,
    AuditLogEvent.RoleCreate,
    role.id
  );

  const embed = createEmbed(
    "ROLE CREATED",
    [
      `**اسم الرتبة:** ${role.name}`,
      `**ID:** \`${role.id}\``,
      result
        ? `**منشئ الرتبة:**\n${userInfo(result.executor)}`
        : "**منشئ الرتبة:** غير معروف"
    ].join("\n")
  );

  setUserThumbnail(embed, result?.executor);

  await sendLog(role.guild, embed);
});

// ==========================================
// ROLE DELETE
// ==========================================

client.on(Events.GuildRoleDelete, async role => {
  const result = await findExecutor(
    role.guild,
    AuditLogEvent.RoleDelete,
    role.id
  );

  const embed = createEmbed(
    "ROLE DELETED",
    [
      `**اسم الرتبة:** ${role.name}`,
      `**ID:** \`${role.id}\``,
      result
        ? `**منفّذ الحذف:**\n${userInfo(result.executor)}`
        : "**منفّذ الحذف:** غير معروف"
    ].join("\n")
  );

  setUserThumbnail(embed, result?.executor);

  await sendLog(role.guild, embed);
});

// ==========================================
// ROLE UPDATE
// ==========================================

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  const result = await findExecutor(
    newRole.guild,
    AuditLogEvent.RoleUpdate,
    newRole.id
  );

  const embed = createEmbed(
    "ROLE UPDATED",
    [
      `**الرتبة:** ${newRole.name}`,
      `**ID:** \`${newRole.id}\``,
      `**الاسم السابق:** ${oldRole.name}`,
      `**الاسم الجديد:** ${newRole.name}`,
      result
        ? `**منفّذ التعديل:**\n${userInfo(result.executor)}`
        : "**منفّذ التعديل:** غير معروف"
    ].join("\n")
  );

  setUserThumbnail(embed, result?.executor);

  await sendLog(newRole.guild, embed);
});

// ==========================================
// MEMBER UPDATE / ROLES / NICKNAME
// ==========================================

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());

  const added = [...newRoles].filter(id => !oldRoles.has(id));
  const removed = [...oldRoles].filter(id => !newRoles.has(id));

  const nicknameChanged =
    oldMember.nickname !== newMember.nickname;

  if (!added.length && !removed.length && !nicknameChanged) return;

  const result = await findExecutor(
    newMember.guild,
    AuditLogEvent.MemberRoleUpdate,
    newMember.id
  );

  const details = [];

  if (added.length) {
    details.push(
      `**رتب أُضيفت:** ${added.map(id => `<@&${id}>`).join(", ")}`
    );
  }

  if (removed.length) {
    details.push(
      `**رتب أُزيلت:** ${removed.map(id => `<@&${id}>`).join(", ")}`
    );
  }

  if (nicknameChanged) {
    details.push(
      `**الاسم السابق:** ${oldMember.nickname || oldMember.user.username}`,
      `**الاسم الجديد:** ${newMember.nickname || newMember.user.username}`
    );
  }

  details.push(
    result
      ? `**منفّذ التغيير:**\n${userInfo(result.executor)}`
      : "**منفّذ التغيير:** غير معروف"
  );

  const embed = createEmbed(
    "MEMBER UPDATED",
    `**العضو:** ${newMember.user}\n\n${details.join("\n")}`
  );

  setUserThumbnail(embed, result?.executor || newMember.user);

  await sendLog(newMember.guild, embed);
});

// ==========================================
// VOICE STATE
// ==========================================

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const member = newState.member || oldState.member;

  if (!member || member.user.bot) return;

  let title = "";
  let description = "";

  if (!oldState.channelId && newState.channelId) {
    title = "VOICE JOIN";
    description = `🎙️ ${member.user} دخل إلى ${newState.channel}`;
  } else if (oldState.channelId && !newState.channelId) {
    title = "VOICE LEAVE";
    description = `🎙️ ${member.user} خرج من ${oldState.channel}`;
  } else if (
    oldState.channelId &&
    newState.channelId &&
    oldState.channelId !== newState.channelId
  ) {
    title = "VOICE MOVE";
    description =
      `**العضو:** ${member.user}\n` +
      `**من:** ${oldState.channel}\n` +
      `**إلى:** ${newState.channel}`;
  } else {
    return;
  }

  const embed = createEmbed(
    title,
    `${description}\n**ID:** \`${member.id}\``,
    BLACK
  );

  setUserThumbnail(embed, member.user);

  await sendLog(newState.guild || oldState.guild, embed);
});

// ==========================================
// BULK MESSAGE DELETE
// ==========================================

client.on(Events.MessageBulkDelete, async (messages, channel) => {
  if (!channel.guild) return;

  const result = await findExecutor(
    channel.guild,
    AuditLogEvent.MessageBulkDelete,
    null
  );

  const embed = createEmbed(
    "BULK MESSAGE DELETE",
    [
      `**القناة:** ${channel}`,
      `**عدد الرسائل المحذوفة:** ${messages.size}`,
      result
        ? `**منفّذ الحذف:**\n${userInfo(result.executor)}`
        : "**منفّذ الحذف:** غير معروف"
    ].join("\n")
  );

  setUserThumbnail(embed, result?.executor);

  await sendLog(channel.guild, embed);
});

// ==========================================
// GUILD UPDATE
// ==========================================

client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
  if (
    oldGuild.name === newGuild.name &&
    oldGuild.icon === newGuild.icon
  ) {
    return;
  }

  const result = await findExecutor(
    newGuild,
    AuditLogEvent.GuildUpdate,
    newGuild.id
  );

  const embed = createEmbed(
    "SERVER UPDATED",
    [
      `**الاسم السابق:** ${oldGuild.name}`,
      `**الاسم الجديد:** ${newGuild.name}`,
      result
        ? `**منفّذ التعديل:**\n${userInfo(result.executor)}`
        : "**منفّذ التعديل:** غير معروف"
    ].join("\n")
  );

  setUserThumbnail(embed, result?.executor);

  await sendLog(newGuild, embed);
});

// ==========================================
// ERROR HANDLING
// ==========================================

client.on("error", error => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

// ==========================================
// LOGIN
// ==========================================

client.login(TOKEN);
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  Events,
  ChannelType
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CATEGORY_NAME = "PW VENOM LOGS";

if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN!");
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
    Partials.Message,
    Partials.Channel,
    Partials.GuildMember
  ]
});

const LOGS = {
  messages: "message-logs",
  members: "member-logs",
  voice: "voice-logs",
  moderation: "moderation-logs",
  roles: "role-logs",
  channels: "channel-logs",
  nicknames: "nickname-logs"
};

function makeEmbed(title, description, color = 0x5865f2) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description.slice(0, 4000))
    .setTimestamp()
    .setFooter({ text: "PW VENOM LOGS 🕷️" });
}

async function setupLogs(guild) {
  try {
    let category = guild.channels.cache.find(
      c => c.type === ChannelType.GuildCategory &&
      c.name === CATEGORY_NAME
    );

    if (!category) {
      category = await guild.channels.create({
        name: CATEGORY_NAME,
        type: ChannelType.GuildCategory
      });
    }

    for (const name of Object.values(LOGS)) {
      let channel = guild.channels.cache.find(
        c => c.type === ChannelType.GuildText &&
        c.name === name
      );

      if (!channel) {
        await guild.channels.create({
          name,
          type: ChannelType.GuildText,
          parent: category.id
        });
      } else if (channel.parentId !== category.id) {
        await channel.setParent(category.id);
      }
    }

    console.log("PW VENOM LOGS channels ready!");
  } catch (error) {
    console.error("Channel setup error:", error.message);
  }
}

async function sendLog(guild, type, embed) {
  try {
    let channel = guild.channels.cache.find(
      c => c.type === ChannelType.GuildText &&
      c.name === LOGS[type]
    );

    if (!channel) {
      await setupLogs(guild);

      channel = guild.channels.cache.find(
        c => c.type === ChannelType.GuildText &&
        c.name === LOGS[type]
      );
    }

    if (channel) {
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error("Log error:", error.message);
  }
}

client.once(Events.ClientReady, async ready => {
  console.log(`PW VENOM LOGS online as ${ready.user.tag}`);

  for (const guild of ready.guilds.cache.values()) {
    await setupLogs(guild);
  }
});

client.on(Events.GuildCreate, async guild => {
  await setupLogs(guild);
});

// MESSAGE LOGS
client.on(Events.MessageDelete, async message => {
  if (!message.guild || message.author?.bot) return;

  await sendLog(
    message.guild,
    "messages",
    makeEmbed(
      "🗑️ Message Deleted",
      `Author: ${message.author?.tag || "Unknown"}\n` +
      `Channel: <#${message.channelId}>\n` +
      `Content: ${message.content || "Content unavailable"}`,
      0xed4245
    )
  );
});

client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
  if (!newMsg.guild || newMsg.author?.bot) return;

  if (oldMsg.partial) {
    try {
      await oldMsg.fetch();
    } catch {}
  }

  const before = oldMsg.content || "Unavailable";
  const after = newMsg.content || "Unavailable";

  if (before === after) return;

  await sendLog(
    newMsg.guild,
    "messages",
    makeEmbed(
      "✏️ Message Edited",
      `Author: ${newMsg.author?.tag || "Unknown"}\n` +
      `Channel: <#${newMsg.channelId}>\n` +
      `Before: ${before.slice(0, 1200)}\n` +
      `After: ${after.slice(0, 1200)}`,
      0xfee75c
    )
  );
});

// MEMBER LOGS
client.on(Events.GuildMemberAdd, async member => {
  await sendLog(
    member.guild,
    "members",
    makeEmbed(
      "📥 Member Joined",
      `Member: ${member.user.tag}\nID: ${member.id}`,
      0x57f287
    )
  );
});

client.on(Events.GuildMemberRemove, async member => {
  await sendLog(
    member.guild,
    "members",
    makeEmbed(
      "📤 Member Left",
      `Member: ${member.user?.tag || "Unknown"}\nID: ${member.id}`,
      0xed4245
    )
  );
});

// VOICE LOGS
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const member = newState.member || oldState.member;

  if (!member || member.user.bot) return;

  let title;
  let description;

  if (!oldState.channelId && newState.channelId) {
    title = "🎙️ Voice Joined";
    description = `${member.user.tag} joined <#${newState.channelId}>`;
  } else if (oldState.channelId && !newState.channelId) {
    title = "🔇 Voice Left";
    description = `${member.user.tag} left <#${oldState.channelId}>`;
  } else if (oldState.channelId !== newState.channelId) {
    title = "🔀 Voice Changed";
    description =
      `${member.user.tag}\n` +
      `From: <#${oldState.channelId}>\n` +
      `To: <#${newState.channelId}>`;
  } else {
    return;
  }

  await sendLog(
    newState.guild,
    "voice",
    makeEmbed(title, description)
  );
});

// BAN LOGS
client.on(Events.GuildBanAdd, async ban => {
  await sendLog(
    ban.guild,
    "moderation",
    makeEmbed(
      "🔨 Member Banned",
      `User: ${ban.user.tag}\nID: ${ban.user.id}`,
      0xed4245
    )
  );
});

client.on(Events.GuildBanRemove, async ban => {
  await sendLog(
    ban.guild,
    "moderation",
    makeEmbed(
      "♻️ Member Unbanned",
      `User: ${ban.user.tag}\nID: ${ban.user.id}`,
      0x57f287
    )
  );
});

// ROLE LOGS
client.on(Events.GuildRoleCreate, async role => {
  await sendLog(
    role.guild,
    "roles",
    makeEmbed("🆕 Role Created", `Role: ${role.name}\nID: ${role.id}`)
  );
});

client.on(Events.GuildRoleDelete, async role => {
  await sendLog(
    role.guild,
    "roles",
    makeEmbed("🗑️ Role Deleted", `Role: ${role.name}\nID: ${role.id}`)
  );
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  await sendLog(
    newRole.guild,
    "roles",
    makeEmbed(
      "✏️ Role Updated",
      `Before: ${oldRole.name}\nAfter: ${newRole.name}`
    )
  );
});

// CHANNEL LOGS
client.on(Events.ChannelCreate, async channel => {
  if (!channel.guild || channel.parent?.name === CATEGORY_NAME) return;

  await sendLog(
    channel.guild,
    "channels",
    makeEmbed("🆕 Channel Created", `Channel: ${channel.name}`)
  );
});

client.on(Events.ChannelDelete, async channel => {
  if (!channel.guild || channel.parent?.name === CATEGORY_NAME) return;

  await sendLog(
    channel.guild,
    "channels",
    makeEmbed("🗑️ Channel Deleted", `Channel: ${channel.name}`)
  );
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.guild || newChannel.parent?.name === CATEGORY_NAME) return;

  await sendLog(
    newChannel.guild,
    "channels",
    makeEmbed(
      "✏️ Channel Updated",
      `Before: ${oldChannel.name}\nAfter: ${newChannel.name}`
    )
  );
});

// NICKNAME AND MEMBER ROLE LOGS
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (oldMember.nickname !== newMember.nickname) {
    await sendLog(
      newMember.guild,
      "nicknames",
      makeEmbed(
        "📝 Nickname Changed",
        `Member: ${newMember.user.tag}\n` +
        `Before: ${oldMember.nickname || oldMember.user.username}\n` +
        `After: ${newMember.nickname || newMember.user.username}`
      )
    );
  }

  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());

  const added = [...newRoles].filter(id => !oldRoles.has(id));
  const removed = [...oldRoles].filter(id => !newRoles.has(id));

  if (added.length || removed.length) {
    const changes = [];

    if (added.length) {
      changes.push(
        `Added: ${added.map(id => `<@&${id}>`).join(", ")}`
      );
    }

    if (removed.length) {
      changes.push(
        `Removed: ${removed.map(id => `<@&${id}>`).join(", ")}`
      );
    }

    await sendLog(
      newMember.guild,
      "roles",
      makeEmbed(
        "👤 Member Roles Updated",
        `Member: ${newMember.user.tag}\n${changes.join("\n")}`
      )
    );
  }
});

client.on(Events.Error, error => {
  console.error("Discord error:", error.message);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled error:", error);
});

client.login(TOKEN);
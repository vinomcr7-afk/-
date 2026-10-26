const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  Events,
  AuditLogEvent,
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN environment variable.");
  process.exit(1);
}
if (!LOG_CHANNEL_ID) {
  console.error("Missing LOG_CHANNEL_ID environment variable.");
  process.exit(1);
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

async function sendLog(guild, embed) {
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!channel || !channel.isTextBased() || !channel.send) {
      console.error("LOG_CHANNEL_ID must be a text channel the bot can access.");
      return;
    }
    if (channel.guildId && channel.guildId !== guild.id) {
      console.error("The configured log channel is not in the event's server.");
      return;
    }
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Could not send log:", error.message);
  }
}

function makeEmbed(title, description, color = 0x5865f2) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description || "No additional details.")
    .setTimestamp()
    .setFooter({ text: "PW VENOM LOGS" });
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`PW VENOM LOGS online as ${readyClient.user.tag}`);
});

client.on(Events.MessageDelete, async (message) => {
  if (!message.guild || message.author?.bot) return;
  const author = message.author ? `${message.author.tag} (${message.author.id})` : "Unknown / unavailable";
  const content = message.content?.trim() || "[Message content unavailable]";
  await sendLog(message.guild, makeEmbed(
    "🗑️ Message Deleted",
    `**Author:** ${author}\n**Channel:** <#${message.channelId}>\n**Content:** ${content.slice(0, 3000)}`,
    0xed4245
  ));
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.partial) {
    try { await oldMessage.fetch(); } catch { /* old content may be unavailable */ }
  }
  const before = oldMessage.content?.trim() || "[Old content unavailable]";
  const after = newMessage.content?.trim() || "[New content unavailable]";
  if (before === after) return;
  await sendLog(newMessage.guild, makeEmbed(
    "✏️ Message Edited",
    `**Author:** ${newMessage.author?.tag || "Unknown"}\n**Channel:** <#${newMessage.channelId}>\n**Before:** ${before.slice(0, 1400)}\n**After:** ${after.slice(0, 1400)}\n[Jump to message](${newMessage.url})`,
    0xfee75c
  ));
});

client.on(Events.GuildMemberAdd, async (member) => {
  await sendLog(member.guild, makeEmbed(
    "📥 Member Joined",
    `**Member:** ${member.user.tag} (${member.id})\n**Account created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
    0x57f287
  ));
});

client.on(Events.GuildMemberRemove, async (member) => {
  const tag = member.user?.tag || "Unknown member";
  await sendLog(member.guild, makeEmbed(
    "📤 Member Left",
    `**Member:** ${tag} (${member.id})`,
    0xed4245
  ));
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  let action;
  let details;
  if (!oldState.channelId && newState.channelId) {
    action = "🎙️ Joined Voice Channel";
    details = `**Member:** ${member.user.tag}\n**Channel:** <#${newState.channelId}>`;
  } else if (oldState.channelId && !newState.channelId) {
    action = "🔇 Left Voice Channel";
    details = `**Member:** ${member.user.tag}\n**Channel:** <#${oldState.channelId}>`;
  } else if (oldState.channelId !== newState.channelId) {
    action = "🔀 Voice Channel Changed";
    details = `**Member:** ${member.user.tag}\n**From:** <#${oldState.channelId}>\n**To:** <#${newState.channelId}>`;
  } else {
    return;
  }
  await sendLog(newState.guild, makeEmbed(action, details, 0x5865f2));
});

client.on(Events.GuildRoleCreate, async (role) => {
  await sendLog(role.guild, makeEmbed("🆕 Role Created", `**Role:** ${role.name}\n**ID:** ${role.id}`, 0x57f287));
});
client.on(Events.GuildRoleDelete, async (role) => {
  await sendLog(role.guild, makeEmbed("🗑️ Role Deleted", `**Role:** ${role.name}\n**ID:** ${role.id}`, 0xed4245));
});
client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  await sendLog(newRole.guild, makeEmbed("✏️ Role Updated", `**Role:** ${newRole.name}\n**ID:** ${newRole.id}`, 0xfee75c));
});

client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild) return;
  await sendLog(channel.guild, makeEmbed("🆕 Channel Created", `**Channel:** ${channel.name}\n**ID:** ${channel.id}`, 0x57f287));
});
client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild) return;
  await sendLog(channel.guild, makeEmbed("🗑️ Channel Deleted", `**Channel:** ${channel.name}\n**ID:** ${channel.id}`, 0xed4245));
});
client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  await sendLog(newChannel.guild, makeEmbed("✏️ Channel Updated", `**Channel:** ${newChannel.name}\n**ID:** ${newChannel.id}`, 0xfee75c));
});

client.on(Events.GuildBanAdd, async (ban) => {
  await sendLog(ban.guild, makeEmbed("🔨 Member Banned", `**User:** ${ban.user.tag} (${ban.user.id})`, 0xed4245));
});
client.on(Events.GuildBanRemove, async (ban) => {
  await sendLog(ban.guild, makeEmbed("♻️ Member Unbanned", `**User:** ${ban.user.tag} (${ban.user.id})`, 0x57f287));
});

client.on(Events.Error, (error) => console.error("Discord client error:", error));
process.on("unhandledRejection", (error) => console.error("Unhandled rejection:", error));

client.login(TOKEN);

const express = require("express");

const app = express();
app.use(express.json({ limit: "20kb" }));

const PORT = process.env.PORT || 3000;
const BOT_CONTROL_SECRET = process.env.BOT_CONTROL_SECRET;

if (!BOT_CONTROL_SECRET) {
  throw new Error("Missing BOT_CONTROL_SECRET in Railway Variables");
}

function authenticateApi(req, res, next) {
  const auth = req.headers.authorization || "";
  const expected = `Bearer ${BOT_CONTROL_SECRET}`;

  if (auth.length !== expected.length) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const crypto = require("crypto");

  if (!crypto.timingSafeEqual(
    Buffer.from(auth),
    Buffer.from(expected)
  )) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    botReady: client.isReady()
  });
});

app.get(
  "/api/guilds/:guildId/config",
  authenticateApi,
  async (req, res) => {
    try {
      const guildId = req.params.guildId;

      if (!/^\d{17,20}$/.test(guildId)) {
        return res.status(400).json({ error: "Invalid guild ID" });
      }

      const guild = client.guilds.cache.get(guildId);

      if (!guild) {
        return res.status(404).json({
          error: "Bot is not in this server"
        });
      }

      ensureGuildConfig(guildId);

      const settings = config[guildId];
      const channelId =
        Object.values(settings).find(
          entry => entry.channelId
        )?.channelId || "";

      const events = Object.keys(settings).filter(
        type => settings[type].enabled
      );

      res.json({
        channelId,
        events,
        settings
      });
    } catch (error) {
      console.error("API read error:", error);
      res.status(500).json({ error: "Could not read configuration" });
    }
  }
);

app.put(
  "/api/guilds/:guildId/config",
  authenticateApi,
  async (req, res) => {
    try {
      const guildId = req.params.guildId;

      if (!/^\d{17,20}$/.test(guildId)) {
        return res.status(400).json({ error: "Invalid guild ID" });
      }

      const guild = client.guilds.cache.get(guildId);

      if (!guild) {
        return res.status(404).json({
          error: "Bot is not in this server"
        });
      }

      const { channelId, events } = req.body || {};

      if (
        typeof channelId !== "string" ||
        !Array.isArray(events) ||
        !events.every(
          type => typeof type === "string" && TYPE_NAMES.includes(type)
        )
      ) {
        return res.status(400).json({
          error: "Invalid channelId or events"
        });
      }

      const channel = await guild.channels
        .fetch(channelId)
        .catch(() => null);

      if (
        !channel ||
        channel.type !== ChannelType.GuildText
      ) {
        return res.status(400).json({
          error: "Channel must be a text channel in this server"
        });
      }

      const botMember = guild.members.me;

      if (
        !botMember ||
        !channel.permissionsFor(botMember)?.has([
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

      res.json({
        ok: true,
        message: "Log settings saved"
      });
    } catch (error) {
      console.error("API save error:", error);
      res.status(500).json({
        error: "Could not save configuration"
      });
    }
  }
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`PW VENOM LOG API listening on port ${PORT}`);
});
const { App } = require("@slack/bolt");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

app.event("app_mention", async ({ event, say }) => {
  await say("Bot is alive ✅");
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("⚡ Slack bot is running!");
})();
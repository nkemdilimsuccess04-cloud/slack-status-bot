const { App, ExpressReceiver } = require("@slack/bolt");

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// When bot is mentioned
app.event("app_mention", async ({ event, say }) => {
  await say("Bot is alive ✅");
});

// Listen to all messages
app.message(async ({ message }) => {
  if (message.subtype) return; // ignore bot messages
  console.log("New message:", message.text);
});

const port = process.env.PORT || 3000;

receiver.app.listen(port, () => {
  console.log(`⚡ Slack bot running on port ${port}`);
});
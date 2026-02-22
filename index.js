const { App, ExpressReceiver } = require("@slack/bolt");

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

app.event("app_mention", async ({ event, say }) => {
  await say("Bot is alive ✅");
});

const port = process.env.PORT || 3000;

receiver.app.listen(port, () => {
  console.log(`⚡ Slack bot running on port ${port}`);
});
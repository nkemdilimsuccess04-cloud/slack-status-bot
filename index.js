const { App, ExpressReceiver } = require("@slack/bolt");
const sqlite3 = require("sqlite3").verbose();

// Create / connect database
const db = new sqlite3.Database("./messages.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT,
      channel TEXT,
      text TEXT,
      ts TEXT
    )
  `);
});

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// Mention response
app.event("app_mention", async ({ event, say }) => {
  await say("Bot is alive ✅");
});

// Listen to all messages
app.message(async ({ message }) => {
  if (message.subtype) return;

  console.log("New message:", message.text);

  db.run(
    `INSERT INTO messages (user, channel, text, ts) VALUES (?, ?, ?, ?)`,
    [message.user, message.channel, message.text, message.ts]
  );
});

const port = process.env.PORT || 3000;

receiver.app.listen(port, () => {
  console.log(`⚡ Slack bot running on port ${port}`);
});
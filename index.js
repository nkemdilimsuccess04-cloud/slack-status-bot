const { App, ExpressReceiver } = require("@slack/bolt");
const sqlite3 = require("sqlite3").verbose();
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

  db.run(`
    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client TEXT,
      editor TEXT,
      status TEXT,
      blocked INTEGER,
      original_text TEXT,
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

app.event("app_mention", async ({ event, say }) => {
  const text = event.text.toLowerCase();

  if (text.includes("last 5")) {
    db.all(
      `SELECT text FROM messages ORDER BY id DESC LIMIT 5`,
      [],
      async (err, rows) => {
        if (err || !rows || rows.length === 0) {
          await say("No messages stored yet.");
          return;
        }

        const response = rows
          .map((row, index) => `${index + 1}. ${row.text}`)
          .join("\n");

        await say(`Here are the last 5 messages:\n${response}`);
      }
    );
  }

  else if (text.includes("blocked")) {
    db.all(
      `SELECT client, editor FROM operations WHERE blocked = 1`,
      [],
      async (err, rows) => {
        if (err || !rows || rows.length === 0) {
          await say("No blocked operations found.");
          return;
        }

        const response = rows
          .map(row =>
            row.client
              ? `Client ${row.client} is blocked`
              : `Editor ${row.editor} is blocked`
          )
          .join("\n");

        await say(`Blocked items:\n${response}`);
      }
    );
  }

  else {
    await say("Bot is alive");
  }
});

app.message(async ({ message }) => {
  if (message.subtype) return;

  db.run(
    `INSERT INTO messages (user, channel, text, ts) VALUES (?, ?, ?, ?)`,
    [message.user, message.channel, message.text, message.ts]
  );

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Extract structured operational data from Slack messages.

Return JSON ONLY with:
{
  "client": string or null,
  "editor": string or null,
  "status": "delivered" | "in_progress" | "blocked" | "waiting" | null,
  "blocked": true | false | null
}

If irrelevant, return null for everything.
          `,
        },
        {
          role: "user",
          content: message.text,
        },
      ],
      temperature: 0,
    });

    const result = JSON.parse(completion.choices[0].message.content);

    db.run(
      `INSERT INTO operations (client, editor, status, blocked, original_text, ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        result.client,
        result.editor,
        result.status,
        result.blocked ? 1 : 0,
        message.text,
        message.ts,
      ]
    );

    console.log("Structured data stored:", result);

  } catch (err) {
    console.error("OpenAI extraction failed:", err.message);
  }
});

const port = process.env.PORT || 3000;

receiver.app.listen(port, () => {
  console.log(`Slack bot running on port ${port}`);
});
const { App, ExpressReceiver } = require("@slack/bolt");
const sqlite3 = require("sqlite3").verbose();
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const db = new sqlite3.Database("./messages.db");

/* ===========================
   DATABASE SETUP
=========================== */
db.serialize(() => {

  // Raw message history
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT,
      channel TEXT,
      text TEXT,
      ts TEXT
    )
  `);

  // LIVE production state (one row per client)
  db.run(`
    CREATE TABLE IF NOT EXISTS production_state (
      client TEXT PRIMARY KEY,
      editor TEXT,
      status TEXT,
      blocked INTEGER,
      last_update_ts TEXT
    )
  `);

});

/* ===========================
   SLACK INIT
=========================== */
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

/* ===========================
   AI QUESTION HANDLER
=========================== */
app.event("app_mention", async ({ event, say }) => {

  const question = event.text
    .replace(/<@[^>]+>/g, "")
    .trim();

  // Get current production state
  db.all(`SELECT * FROM production_state`, [], async (err, rows) => {

    if (err) {
      await say("Error retrieving production data.");
      return;
    }

    if (!rows || rows.length === 0) {
      await say("No production data available yet.");
      return;
    }

    try {

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `
You are an internal production operations assistant.

Use ONLY the provided production data to answer the user's question.

You may:
- Identify blocked clients
- Identify editors who have not delivered
- Calculate delays using last_update_ts (Slack timestamps are Unix epoch in seconds)
- Explain how long ago something happened
- Summarize risks

If the answer cannot be determined from the data, say so clearly.

Be concise, factual, and operational.
            `
          },
          {
            role: "user",
            content: `
Production Data:
${JSON.stringify(rows, null, 2)}

User Question:
${question}
            `
          }
        ]
      });

      const answer = completion.choices[0].message.content;

      await say(answer);

    } catch (e) {
      console.error(e);
      await say("AI processing failed.");
    }

  });

});

/* ===========================
   MESSAGE LISTENER
=========================== */
app.message(async ({ message }) => {

  if (message.subtype) return;

  // Store raw message
  db.run(
    `INSERT INTO messages (user, channel, text, ts) VALUES (?, ?, ?, ?)`,
    [message.user, message.channel, message.text, message.ts]
  );

  try {

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
Extract structured operational data from Slack messages.

Return JSON ONLY:
{
  "client": string or null,
  "editor": string or null,
  "status": "delivered" | "in_progress" | "blocked" | "waiting" | null,
  "blocked": true | false | null
}

If irrelevant return all null.
          `
        },
        {
          role: "user",
          content: message.text
        }
      ]
    });

    const result = JSON.parse(
      completion.choices[0].message.content
    );

    // If no meaningful production data → ignore
    if (!result.client) return;

    // UPSERT live production state
    db.run(
      `
      INSERT OR REPLACE INTO production_state
      (client, editor, status, blocked, last_update_ts)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        result.client,
        result.editor,
        result.status,
        result.blocked === true
          ? 1
          : result.blocked === false
          ? 0
          : null,
        message.ts
      ]
    );

  } catch (err) {
    console.error("OpenAI extraction failed:", err.message);
  }

});

/* ===========================
   START SERVER
=========================== */
const port = process.env.PORT || 3000;

receiver.app.listen(port, () => {
  console.log(`Slack bot running on port ${port}`);
});
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
   AI QUESTION BRAIN
=========================== */
app.event("app_mention", async ({ event, say }) => {
  const question = event.text
    .replace(/<@[^>]+>/g, "")
    .trim();

  // Pull latest state per client/editor
  db.all(
    `
    SELECT *
    FROM operations
    WHERE id IN (
      SELECT MAX(id)
      FROM operations
      WHERE client IS NOT NULL OR editor IS NOT NULL
      GROUP BY COALESCE(client, editor)
    )
    `,
    [],
    async (err, rows) => {
      if (err) {
        await say("Database error.");
        return;
      }

      if (!rows || rows.length === 0) {
        await say("No production data available yet.");
        return;
      }

      const now = Date.now();

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0,
          messages: [
            {
              role: "system",
              content: `
You are an operations intelligence assistant.

You receive structured production state data.

Each record includes:
- client
- editor
- status
- blocked (1, 0, or null)
- ts (Slack timestamp)
- current_time

You must:
- Answer the user's question clearly
- Identify blocked clients
- Identify editors who have not delivered
- Calculate time delays if asked
- Summarize production state if requested
- Detect waiting or in-progress items
- Use logical reasoning

If no relevant data exists, say so clearly.

Respond professionally and clearly.
              `,
            },
            {
              role: "user",
              content: `
Current time (ms): ${now}

Production state:
${JSON.stringify(rows, null, 2)}

User question:
${question}
              `,
            },
          ],
        });

        await say(completion.choices[0].message.content);

      } catch (err) {
        await say("Error processing production intelligence.");
      }
    }
  );
});

/* ===========================
   MESSAGE LISTENER
=========================== */
app.message(async ({ message }) => {
  if (message.subtype) return;

  // Store raw Slack message
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

Rules:
- If someone says "delivered", status = delivered.
- If someone says "blocked", blocked = true.
- If someone says "waiting", status = waiting.
- If someone says "in progress", status = in_progress.
- Extract client names if mentioned.
- Extract editor names if mentioned.
- If message is irrelevant to production, return null for everything.

Return JSON ONLY:
{
  "client": string or null,
  "editor": string or null,
  "status": "delivered" | "in_progress" | "blocked" | "waiting" | null,
  "blocked": true | false | null
}
          `,
        },
        {
          role: "user",
          content: message.text,
        },
      ],
    });

    const result = JSON.parse(
      completion.choices[0].message.content
    );

    // Do not insert empty garbage
    if (!result.client && !result.editor) return;

    db.run(
      `
      INSERT INTO operations 
      (client, editor, status, blocked, original_text, ts)
      VALUES (?, ?, ?, ?, ?, ?)
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
        message.text,
        message.ts,
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
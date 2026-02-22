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

  db.all(
    `
    SELECT *
    FROM operations
    WHERE id IN (
      SELECT MAX(id)
      FROM operations
      WHERE client IS NOT NULL
      GROUP BY client
    )
    `,
    [],
    async (err, rows) => {
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
You are an internal operations intelligence assistant.

You receive structured production state data.

Each record contains:
- client
- editor
- status
- blocked (1 or 0)
- ts (Slack timestamp)
- current_time

You must:
- Identify blocked clients
- Identify editors who have not delivered
- Detect delays
- Calculate how long ago something happened
- Summarize production
- Make reasonable assumptions if data is incomplete
- Be concise and professional

If the answer cannot be determined, say so clearly.
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
        await say("AI reasoning error.");
      }
    }
  );
});

/* ===========================
   MESSAGE LISTENER (RESILIENT)
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
Extract structured production data from Slack messages.

Be tolerant of inconsistent wording.

Interpret synonyms:
- "done", "finished", "completed" → delivered
- "working", "ongoing" → in_progress
- "pending", "awaiting", "reviewing" → waiting
- "stuck", "issue", "problem" → blocked

If no production signal exists, return all null.

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

    // Fetch channel name (client fallback)
    const channelInfo = await app.client.conversations.info({
      token: process.env.SLACK_BOT_TOKEN,
      channel: message.channel,
    });

    const channelName = channelInfo.channel.name;

    // Use channel name as client if missing
    const clientName = result.client || channelName;

    // Ignore noise (must detect status or blocked)
    if (!result.status && result.blocked !== true) return;

    db.run(
      `
      INSERT INTO operations
      (client, editor, status, blocked, original_text, ts)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        clientName,
        result.editor,
        result.status,
        result.blocked === true ? 1 :
        result.blocked === false ? 0 : null,
        message.text,
        message.ts,
      ]
    );

  } catch (err) {
    console.error("Extraction failed:", err.message);
  }
});

/* ===========================
   START SERVER
=========================== */
const port = process.env.PORT || 3000;

receiver.app.listen(port, () => {
  console.log(`Slack bot running on port ${port}`);
});
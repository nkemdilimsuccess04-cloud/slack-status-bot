app.event("app_mention", async ({ event, say }) => {
  const text = event.text
    .replace(/<@[^>]+>/g, "")
    .trim()
    .toLowerCase();

  // LAST 5
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

  // BLOCKED
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

  // STATUS SNAPSHOT (NEW)
  else if (text.includes("status")) {
    db.all(
      `
      SELECT o1.client, o1.editor, o1.status, o1.blocked, o1.ts
      FROM operations o1
      INNER JOIN (
          SELECT client, MAX(ts) as max_ts
          FROM operations
          WHERE client IS NOT NULL
          GROUP BY client
      ) o2
      ON o1.client = o2.client AND o1.ts = o2.max_ts
      `,
      [],
      async (err, rows) => {
        if (err || !rows || rows.length === 0) {
          await say("No operations found.");
          return;
        }

        const response = rows.map(row => {
          const state = row.blocked ? "BLOCKED" : row.status;
          return `${row.client} — ${state} — ${row.editor || "No editor"}`;
        }).join("\n");

        await say(`OPERATIONS SNAPSHOT:\n\n${response}`);
      }
    );
  }

  else {
    await say("Bot is alive");
  }
});
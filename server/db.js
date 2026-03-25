const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/cache.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS summaries (
    chat_id      TEXT PRIMARY KEY,
    chat_name    TEXT,
    community    TEXT,
    chat_type    TEXT,
    msg_count    INTEGER,
    staff_count  INTEGER,
    generated_at TEXT,
    digest       TEXT
  );

  CREATE TABLE IF NOT EXISTS job_meta (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    last_run TEXT,
    run_date TEXT
  );
`);

const stmts = {
  upsertSummary: db.prepare(`
    INSERT INTO summaries (chat_id, chat_name, community, chat_type, msg_count, staff_count, generated_at, digest)
    VALUES (@chat_id, @chat_name, @community, @chat_type, @msg_count, @staff_count, @generated_at, @digest)
    ON CONFLICT(chat_id) DO UPDATE SET
      chat_name    = excluded.chat_name,
      community    = excluded.community,
      chat_type    = excluded.chat_type,
      msg_count    = excluded.msg_count,
      staff_count  = excluded.staff_count,
      generated_at = excluded.generated_at,
      digest       = excluded.digest
  `),
  upsertMeta: db.prepare(`
    INSERT INTO job_meta (id, last_run, run_date) VALUES (1, @last_run, @run_date)
    ON CONFLICT(id) DO UPDATE SET last_run = excluded.last_run, run_date = excluded.run_date
  `),
  allSummaries: db.prepare('SELECT * FROM summaries'),
  getMeta:      db.prepare('SELECT last_run, run_date FROM job_meta WHERE id = 1'),
  clearSummaries: db.prepare('DELETE FROM summaries'),
};

const saveAll = db.transaction((summaries, lastRun, date) => {
  stmts.clearSummaries.run();
  for (const [chatId, s] of Object.entries(summaries)) {
    stmts.upsertSummary.run({
      chat_id:      chatId,
      chat_name:    s.chatName,
      community:    s.community,
      chat_type:    s.chatType,
      msg_count:    s.msgCount,
      staff_count:  s.staffCount,
      generated_at: s.generatedAt,
      digest:       JSON.stringify(s.digest),
    });
  }
  stmts.upsertMeta.run({ last_run: lastRun, run_date: date });
});

function saveSummaries(summaries, lastRun, date) {
  try {
    saveAll(summaries, lastRun, date);
    console.log(`[DB] Saved ${Object.keys(summaries).length} summaries`);
  } catch (e) {
    console.error('[DB] Save failed:', e.message);
  }
}

function loadSummaries() {
  try {
    const rows = stmts.allSummaries.all();
    const meta = stmts.getMeta.get();
    if (!meta || !rows.length) return null;

    const summaries = {};
    for (const row of rows) {
      summaries[row.chat_id] = {
        chatName:    row.chat_name,
        community:   row.community,
        chatType:    row.chat_type,
        msgCount:    row.msg_count,
        staffCount:  row.staff_count,
        generatedAt: row.generated_at,
        digest:      JSON.parse(row.digest),
      };
    }
    console.log(`[DB] Loaded ${rows.length} cached summaries from ${meta.run_date}`);
    return { summaries, lastRun: meta.last_run, date: meta.run_date };
  } catch (e) {
    console.error('[DB] Load failed:', e.message);
    return null;
  }
}

module.exports = { saveSummaries, loadSummaries };

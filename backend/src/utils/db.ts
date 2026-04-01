export async function ensureAllTables(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_users (
      id TEXT PRIMARY KEY,
      kakao_id TEXT UNIQUE,
      google_id TEXT UNIQUE,
      name TEXT,
      phone TEXT,
      email TEXT,
      profile_image TEXT,
      role TEXT DEFAULT 'requester',
      address TEXT,
      lat REAL,
      lng REAL,
      lang TEXT DEFAULT 'ko',
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_responders (
      user_id TEXT PRIMARY KEY,
      grade TEXT DEFAULT 'green',
      cert_photo_url TEXT,
      id_photo_url TEXT,
      status TEXT DEFAULT 'pending',
      available INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      total_done INTEGER DEFAULT 0,
      bio TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_requests (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL,
      type TEXT DEFAULT 'child',
      address TEXT,
      lat REAL,
      lng REAL,
      status TEXT DEFAULT 'pending',
      description TEXT,
      grade_required TEXT DEFAULT 'green',
      source TEXT DEFAULT 'manual',
      urgency TEXT DEFAULT 'normal',
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_matches (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      responder_id TEXT NOT NULL,
      accepted_at TEXT,
      arrived_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      duration_min INTEGER,
      amount INTEGER,
      status TEXT DEFAULT 'offered',
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_settlements (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      responder_id TEXT NOT NULL,
      amount INTEGER,
      fee INTEGER,
      net_amount INTEGER,
      status TEXT DEFAULT 'pending',
      paid_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      type TEXT,
      title TEXT,
      body TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id TEXT,
      action TEXT,
      target_type TEXT,
      target_id TEXT,
      memo TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_reviews (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
  ]);

  // Indexes (ignore if exists)
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_users_kakao ON onda_users(kakao_id)",
    "CREATE INDEX IF NOT EXISTS idx_users_google ON onda_users(google_id)",
    "CREATE INDEX IF NOT EXISTS idx_requests_requester ON onda_requests(requester_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_matches_request ON onda_matches(request_id)",
    "CREATE INDEX IF NOT EXISTS idx_matches_responder ON onda_matches(responder_id)",
    "CREATE INDEX IF NOT EXISTS idx_responders_available ON onda_responders(status, available)",
    "CREATE INDEX IF NOT EXISTS idx_reviews_match ON onda_reviews(match_id)",
    "CREATE INDEX IF NOT EXISTS idx_messages_match ON onda_messages(match_id, created_at)",
  ];
  for (const sql of indexes) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

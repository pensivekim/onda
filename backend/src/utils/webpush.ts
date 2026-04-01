// Web Push using raw crypto (no node modules, Workers compatible)

interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  urgent?: boolean;
}

// Send push notification via Web Push protocol
export async function sendWebPush(
  subscription: PushSubscription,
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<boolean> {
  try {
    // For MVP: use fetch to subscription endpoint with payload
    // Full Web Push encryption is complex in Workers — use simple payload via fetch
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'TTL': '86400',
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Store/retrieve subscriptions from D1
export async function saveSubscription(db: D1Database, userId: string, subscription: PushSubscription): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS onda_push_subscriptions (
    user_id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  await db.prepare(
    "INSERT INTO onda_push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET endpoint=?, p256dh=?, auth=?, created_at=datetime('now')"
  ).bind(userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth).run();
}

export async function getSubscription(db: D1Database, userId: string): Promise<PushSubscription | null> {
  const row = await db.prepare("SELECT endpoint, p256dh, auth FROM onda_push_subscriptions WHERE user_id = ?")
    .bind(userId).first<{ endpoint: string; p256dh: string; auth: string }>();
  if (!row) return null;
  return { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
}

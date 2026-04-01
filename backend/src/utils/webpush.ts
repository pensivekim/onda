// Notification system — D1-based polling (Workers compatible, no RFC 8291 needed)
// Pattern: server inserts notification → client polls → shows via Notification API

export async function sendNotification(
  db: D1Database,
  userId: string,
  title: string,
  body: string,
  type: string = 'general',
  urgent: boolean = false
): Promise<void> {
  await db.prepare(
    "INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)"
  ).bind(userId, type, title, body).run();
}

// Get unread notifications for a user
export async function getUnreadNotifications(
  db: D1Database,
  userId: string,
  limit: number = 10
): Promise<any[]> {
  const result = await db.prepare(
    "SELECT id, type, title, body, created_at FROM onda_notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC LIMIT ?"
  ).bind(userId, limit).all();
  return result.results;
}

// Mark notifications as read
export async function markNotificationsRead(
  db: D1Database,
  ids: number[]
): Promise<void> {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.prepare(`UPDATE onda_notifications SET read = 1 WHERE id IN (${placeholders})`).bind(...ids).run();
}

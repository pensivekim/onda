// 온다 텔레그램판 — 바탕(표·방·글·통로 부르기). 2026-11-22 대표 결정: 어르신·가족·도우미·상황실 모두 텔레그램 하나로.
// 기존 표는 고치지 않는다. 새 표만 IF NOT EXISTS 로 만든다. 출동 상태·정산은 기존 흐름(responderRoutes) 그대로.
import type { Env } from "../../types";
import { tongro, type Tongro, type Key } from "./tongro";

export type TgEnv = Env & {
  TONGRO_BASE?: string; TONGRO_SERVICE?: string; TONGRO_SECRET?: string;
  TG_OFFER_SECONDS?: string; TG_OFFER_SECONDS_WEB?: string; TG_WEBAPP_URL?: string; HI_ONDA_SECRET?: string;
};
export const DEFAULT_TONGRO = "https://alim-tongro.ansimservice.workers.dev";
export const offerSeconds = (env: TgEnv) => Math.min(300, Math.max(20, Number(env.TG_OFFER_SECONDS) || 50));
export const webappUrl = (env: TgEnv) => env.TG_WEBAPP_URL || `${env.FRONTEND_URL || "https://onda.genomic.cc"}/tg`;

/** 통로가 설정 안 됐으면 null — 그러면 텔레그램판은 조용히 쉬고 기존 앱은 그대로 돈다 */
export function tg(env: TgEnv, fetchImpl?: typeof fetch): Tongro | null {
  if (!env.TONGRO_SECRET) return null;
  return tongro({ base: env.TONGRO_BASE || DEFAULT_TONGRO, service: env.TONGRO_SERVICE || "onda", secret: env.TONGRO_SECRET, fetchImpl });
}

export const roomOf = (userId: string) => `u:${userId}`;
export const opsRoom = (name: string) => `ops:${name}`;

export async function ensureTgCareTables(db: D1Database) {
  await db.batch([
    // 텔레그램 방과 묶인 사람 (방 이름 u:<온다 사용자 id>, 상황실은 ops:<이름>)
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_tgc_people (
      room_key TEXT PRIMARY KEY,
      user_id TEXT,
      kind TEXT NOT NULL,              -- elder | family | helper | member | ops
      linked INTEGER DEFAULT 0,
      tg_name TEXT,
      linked_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    // 첫 방문 때 도우미가 등록한 어르신
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_tgc_elders (
      elder_id TEXT PRIMARY KEY,
      enrolled_by TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    // 말벗(hi.genomic.cc) 어르신과 같은 분 — 말벗 기기 코드(link_code)로 묶는다 (2026-11-22)
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_tgc_hi_link (
      hi_code TEXT PRIMARY KEY,
      elder_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_tgc_family (
      elder_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      relation TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (elder_id, family_id)
    )`),
    // 출동 한 건의 차례(누구에게 몇 번째로 부탁했는지)와 알린 상태
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_tgc_dispatch (
      request_id TEXT PRIMARY KEY,
      elder_id TEXT NOT NULL,
      asked_by TEXT,
      queue TEXT NOT NULL,             -- JSON 도우미 id 차례
      idx INTEGER DEFAULT 0,           -- 다음에 부탁할 차례
      state TEXT DEFAULT 'offering',   -- offering | exhausted | accepted | done | cancelled
      cur_match TEXT,
      offer_ref TEXT,
      offered_at INTEGER,
      notified TEXT,                   -- 가족·상황실에 마지막으로 알린 상태
      emergency INTEGER DEFAULT 0,
      live_refs TEXT,                  -- JSON {방: 실시간 위치 메시지 번호}
      live_at INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
  ]);
  for (const sql of [
    "CREATE INDEX IF NOT EXISTS idx_tgc_people_user ON onda_tgc_people(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tgc_family_fam ON onda_tgc_family(family_id)",
    "CREATE INDEX IF NOT EXISTS idx_tgc_dispatch_state ON onda_tgc_dispatch(state)",
    "CREATE INDEX IF NOT EXISTS idx_tgc_dispatch_elder ON onda_tgc_dispatch(elder_id, state)",
  ]) { try { await db.prepare(sql).run(); } catch { /* 이미 있음 */ } }
  // 2026-11-23: 부탁마다 기다리는 시간(텔레그램 50초·앱 90초) — 예전 표에 칸 더하기
  try { await db.prepare("ALTER TABLE onda_tgc_dispatch ADD COLUMN offer_s INTEGER").run(); } catch { /* 이미 있음 */ }
}

/** «김○○» — 도우미 부탁·상황실 단체방에는 성만 (다올과 같은 규칙) */
export function mask(name: string | null | undefined): string {
  const n = (name || "").trim();
  return n ? `${n[0]}○○` : "○○○";
}

export const KB_ELDER = (env: TgEnv): Key[][] => [
  [{ text: "🆘 도와주세요" }],
  [{ text: "📍 내 위치 보내기", request_location: true }],
  [{ text: "👨‍👩‍👧 가족 묶기" }],
];
export const KB_FAMILY = (env: TgEnv): Key[][] => [
  [{ text: "🆘 어르신께 출동 부탁" }],
  [{ text: "📋 지금 상황", web_app: webappUrl(env) }],
];
export const KB_HELPER = (env: TgEnv): Key[][] => [
  [{ text: "🟢 출동 받기 켜기" }, { text: "⚪ 끄기" }],
  [{ text: "📍 지금 위치 보내기", request_location: true }],
  [{ text: "📱 온다 열기", web_app: webappUrl(env) }],
];
export const TXT = {
  sosAsk: "숨쉬기 힘들거나, 쓰러지셨거나, 피가 많이 나나요?",
  call119: "🚑 지금 바로 119 에 전화하세요.\n전화기에서 1 1 9 를 누르시면 됩니다.\n도우미도 함께 보내 드립니다.",
  helper119: "🚑 위급하면 먼저 119 에 전화해 주세요(1 1 9).\n어르신을 혼자 옮기지 마시고 구급대를 기다려 주세요.\n가족과 상황실에도 알렸습니다.",
  liveHow: "가시는 길을 가족이 볼 수 있게 «실시간 위치»를 켜 주세요.\n📎(클립) → 위치 → «실시간 위치 공유» → 1시간",
};

export async function personByRoom(db: D1Database, room: string) {
  return db.prepare("SELECT * FROM onda_tgc_people WHERE room_key = ?").bind(room).first<{ room_key: string; user_id: string; kind: string; linked: number }>();
}
export async function userName(db: D1Database, id: string | null | undefined) {
  if (!id) return "";
  return (await db.prepare("SELECT name FROM onda_users WHERE id = ?").bind(id).first<{ name: string }>())?.name || "";
}
/** 어르신의 연결된 가족 방 */
export async function familyRooms(db: D1Database, elderId: string): Promise<string[]> {
  const r = await db.prepare(
    `SELECT p.room_key FROM onda_tgc_family f JOIN onda_tgc_people p ON p.user_id = f.family_id
      WHERE f.elder_id = ? AND p.linked = 1 AND p.kind = 'family'`).bind(elderId).all<{ room_key: string }>();
  return r.results.map((x) => x.room_key);
}
export async function opsRooms(db: D1Database): Promise<string[]> {
  const r = await db.prepare("SELECT room_key FROM onda_tgc_people WHERE kind = 'ops' AND linked = 1").all<{ room_key: string }>();
  return r.results.map((x) => x.room_key);
}
export async function isLinked(db: D1Database, room: string) {
  return !!(await db.prepare("SELECT 1 FROM onda_tgc_people WHERE room_key = ? AND linked = 1").bind(room).first());
}

/** 여러 방에 같은 글 — 한 방이 실패해도 나머지는 보낸다 */
export async function sendMany(t: Tongro | null, db: D1Database, rooms: string[], text: string, extra: Record<string, unknown> = {}) {
  if (!t) return;
  for (const room of [...new Set(rooms)]) {
    if (!(await isLinked(db, room))) continue;          // 1:1 이 아닌 곳에서 잘못 연 개인 링크 등 — 온다가 인정한 방에만
    try { await t.send({ room, text, ...extra } as any); } catch { /* 장부는 통로에 남음 */ } }
}

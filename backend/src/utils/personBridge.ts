/**
 * personBridge.ts — 표준 phoneHash 다리 기록 (onda, 2단계, append-only, best-effort)
 *
 * 제공자(responder) phone 저장 직후 호출. cphash(canonicalPhoneHash, salt 동일 시 qr와 일치)를
 * onda_users.id 에 매핑(onda_person_bridge upsert). 기존 phone UPDATE·신청 로직과 무관한 추가 레이어.
 *
 * graceful: salt 미설정 / phone 빈값·무효 / cphash 무결성 실패 / DB 쓰기 실패 → 조용히 skip.
 *   제공자 신청 본체는 절대 실패하지 않는다(전체 try/catch). 호출부는 c.executionCtx.waitUntil로 비차단 발사.
 *
 * 저장소: D1(onda는 D1-native). qr는 KV였으나 공유되는 건 cphash 값 하나뿐 — 저장 방식은 로컬 선택.
 */
import { canonicalPhoneHash } from "./canonicalPhone";

const CPHASH_RE = /^[a-f0-9]{64}$/;

export async function recordOndaPersonBridge(
  db: D1Database,
  userId: string,
  rawPhone: string,
  salt: string,
): Promise<void> {
  if (!salt || !userId || !rawPhone || !rawPhone.trim()) return;
  try {
    const cphash = await canonicalPhoneHash(rawPhone, salt);
    if (!CPHASH_RE.test(cphash)) return;            // put 전 무결성 검증 (1단계 CPHASH_RE 동일)
    await db
      .prepare(
        `INSERT INTO onda_person_bridge (cphash, user_id, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(cphash) DO UPDATE SET user_id = excluded.user_id, updated_at = datetime('now')`,
      )
      .bind(cphash, userId)
      .run();
  } catch {
    /* best-effort — 제공자 신청 본체 무관 */
  }
}

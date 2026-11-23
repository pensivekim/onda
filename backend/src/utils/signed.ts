// 바깥 장치(말벗·감지 장치)가 보내는 자동 출동 신호 확인 — 2026-11-23 보안 고침
// 전에는 /api/dispatch/webhook · /api/detect/dispatch 가 열쇠 확인 없이 열려 있어, 아무나 아무 주소로 출동을 만들 수 있었다.
// 서명: 머리말 x-hi-ts(초) · x-hi-sig = HMAC-SHA256(HI_ONDA_SECRET, ts + "." + sha256(본문)) 16진수. 5분 안, 같은 서명은 한 번만.
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export function safeEqual(a: string, b: string) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}
export async function hmacHex(secret: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
/** 맞으면 본문(JSON) 돌려줌, 아니면 null. kv 가 있으면 같은 서명 재사용 막음 */
export async function verifySigned(body: string, ts: string | undefined, sig: string | undefined, secret: string | undefined, kv?: KVNamespace): Promise<any | null> {
  if (!secret) return null;
  const t = Number(ts || 0);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return null;
  const want = await hmacHex(secret, t + "." + hex(await crypto.subtle.digest("SHA-256", enc.encode(body))));
  if (!safeEqual(want, sig || "")) return null;
  if (kv) {
    const k = `sig:${(sig || "").slice(0, 64)}`;
    if (await kv.get(k)) return null;
    await kv.put(k, "1", { expirationTtl: 600 });
  }
  try { return JSON.parse(body); } catch { return null; }
}

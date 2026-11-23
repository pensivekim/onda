// 알림 통로 쓰는 쪽 (I:\알림통로_20261026\code\client\tongro_client.mjs 를 온다용 TS 로 옮긴 것 — 통로 원본은 고치지 않음)
// 봇 열쇠는 통로에만 있다. 온다는 서비스 비밀(TONGRO_SECRET)로 서명해 «이 방에 이걸 보내 줘»만 부탁한다.
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function hmac(secret: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
const sha = async (d: string | Uint8Array) => hex(await crypto.subtle.digest("SHA-256", typeof d === "string" ? enc.encode(d) : d));
function eq(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
const nonce = () => crypto.randomUUID().slice(0, 8);

export type Btn = { text: string; data?: string; url?: string; web_app?: string };
export type Key = { text: string; request_location?: boolean; web_app?: string };
export interface SendMsg { room: string; text: string; html?: boolean; buttons?: Btn[][]; keyboard?: Key[][] | null; reply_to_ref?: string }

export function tongro(o: { base: string; service: string; secret: string; fetchImpl?: typeof fetch }) {
  const f = o.fetchImpl || fetch;
  async function call(path: string, body: unknown) {
    const ts = String(Math.floor(Date.now() / 1000));
    const bytes = enc.encode(JSON.stringify(body));
    const r = await f(o.base.replace(/\/$/, "") + path, { method: "POST", body: bytes, headers: {
      "x-svc": o.service, "x-ts": ts, "x-sig": await hmac(o.secret, ts + "." + await sha(bytes)),
      "content-type": "application/json", "content-length": String(bytes.byteLength) } });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 502) throw Object.assign(new Error(`알림 통로 ${path} ${r.status}: ${j.error || ""}`), { status: r.status });
    return j;
  }
  return {
    send: (m: SendMsg) => call("/v1/send", { ...m, n: nonce() }),
    edit: (m: { ref: string; text?: string; html?: boolean; buttons?: Btn[][] | null }) => call("/v1/edit", { ...m, n: nonce() }),
    startLink: (room: string, ttl_hours = 72) => call("/v1/start-link", { room, ttl_hours, n: nonce() }),
    sendLocation: (room: string, lat: number, lng: number, live_period?: number, text?: string) =>
      call("/v1/send", { room, location: { lat, lng, live_period }, text, n: nonce() }),
    editLocation: (ref: string, lat: number, lng: number) => call("/v1/edit", { ref, location: { lat, lng }, n: nonce() }),
    stopLocation: (ref: string) => call("/v1/edit", { ref, stop_live: true, n: nonce() }),
    webappVerify: (init_data: string) => call("/v1/webapp-verify", { init_data, max_age_s: 3600, n: nonce() }),   // 미니 앱을 연 뒤 1시간까지만
    menu: (room: string, text: string, url: string) => call("/v1/menu", { room, text, url, n: nonce() }),
  };
}
export type Tongro = ReturnType<typeof tongro>;

/** 통로가 넘겨준 것(버튼 눌림·방 연결·말·위치) 확인 — 5분 안·서명 맞음 */
export async function verifyTongro(body: string, ts: string | undefined, sig: string | undefined, secret: string): Promise<any | null> {
  const t = +(ts || 0);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return null;
  if (!eq(await hmac(secret, t + "." + await sha(body)), sig || "")) return null;
  try { return JSON.parse(body); } catch { return null; }
}

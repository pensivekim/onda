// canonicalPhone.ts — 표준 phoneHash (생태계 공통 '같은 사람' 식별 다리)
//
// 1단계 범위: qr-prize-event + kbsbiz 한 클러스터에만 append-only로 적용.
// 의존성 0 (WebCrypto 전역 crypto.subtle 만 사용) → hi/radar/onda 등 다른 워커 레포에
// 그대로 복사해도 동일 입력 → 동일 출력이 보장되도록 순수하게 작성.
//
// 정규화 규칙은 qr 기존 normalizePhone(utils/validate.ts:17-27)과 글자 단위 동일:
//   - 숫자와 + 만 남김
//   - 선행 '+' 또는 '00'(국제접두) 제거
//   - 한국 모바일 E.164(82 + 1…) → 도메스틱(0 + 1…) 캐논화
//   → 같은 사람을 +82 표기로 넣든 010 표기로 넣든 한 해시로 수렴.
//
// [솔트 — 절대 변경 금지]
//   salt = CANONICAL_PHONE_SALT (wrangler secret, ADMIN_SECRET 과 분리된 '생태계 공용 마스터키').
//   이 솔트는 앞으로 hi/radar/onda 등 모든 레포에 동일하게 주입된다. 한번 정하면 절대 바꾸지 않는다.
//   (바꾸면 이미 쌓인 모든 표준해시가 무효가 됨.) 값은 어디에도 평문 기록 금지.
//   주입 기록(이름/시점/환경)은 배포 시 README 또는 wrangler 환경 메모에 1줄로 남긴다.

/**
 * 전화번호 정규화 (표기 차이 캐논화). 해시 입력 직전 단계.
 * qr normalizePhone 과 동일 규칙. null/undefined 안전 가드만 추가(빈 문자열 처리).
 */
export function canonicalizePhone(raw: string): string {
  let p = (raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  else if (p.startsWith('00')) p = p.slice(2);
  // 한국 모바일 E.164(82 + national prefix '1' + 8~9자리) → 도메스틱(0 + …)
  if (/^821\d{8,9}$/.test(p)) p = '0' + p.slice(2);
  return p;
}

/**
 * 표준 phoneHash — HMAC-SHA256(정규화번호, salt) → hex 소문자.
 * @param raw  사용자가 입력한 원본 전화번호 (어떤 표기든 허용)
 * @param salt CANONICAL_PHONE_SALT (생태계 공용 솔트, 호출부에서 env로 주입)
 */
export async function canonicalPhoneHash(raw: string, salt: string): Promise<string> {
  const norm = canonicalizePhone(raw);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(norm));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

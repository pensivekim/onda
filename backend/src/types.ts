export interface Env {
  DB: D1Database;
  LOCATION_KV: KVNamespace;
  CERT_BUCKET: R2Bucket;
  JWT_SECRET: string;
  KAKAO_CLIENT_ID: string;
  KAKAO_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  NHN_APPKEY: string;
  NHN_SECRET_KEY: string;
  NHN_SMS_SENDER: string;
  FRONTEND_URL: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  LINE_CHANNEL_ID: string;
  LINE_CHANNEL_SECRET: string;
  PADDLE_WEBHOOK_SECRET: string;
  GEMINI_API_KEY: string;
  OPENAI_API_KEY: string;
  // 2단계 표준 phoneHash 다리 — 생태계 공용 솔트(qr와 동일값 주입). 미설정 시 다리 graceful no-op. 절대 변경 금지.
  CANONICAL_PHONE_SALT?: string;
}

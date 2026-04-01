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
}

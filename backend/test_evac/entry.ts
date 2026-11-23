// 시험용 입구(배포 안 함): 새 이웃대피 라우트 + 텔레그램 + 기존 출동자 라우트(수락·상태)
import { Hono } from "hono";
import { evacRoutes } from "../src/features/evac-dispatch/evacRoutes";
import { evacTelegramRoutes } from "../src/features/evac-dispatch/telegram";
import { responderRoutes } from "../src/routes/responderRoutes";
const app = new Hono<any>();
app.route("/", evacRoutes);
app.route("/", evacTelegramRoutes);
app.route("/", responderRoutes);
export default app;

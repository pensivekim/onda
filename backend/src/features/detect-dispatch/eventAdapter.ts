// LUMIZOOM schema 2.1 event/det → onda dispatch 입력(DetectionInput) 어댑터 (순수 함수, 격리 신규)
// LUMIZOOM event = {time, track, zone, severity, actions, message}
// 추가 신호(옵션 ctx)로 트랙별 상향 근거 주입: 무기(싸움 det cls guns/knife) · 군중 임계 · 68 바이탈/응급.

import type { DetectionInput } from "./grade";

export interface LumizoomEvent {
  time?: string;
  track: string;                              // fall|fire|drowning|fight|intrusion|wander|crowd
  zone?: string;
  severity?: string;                          // normal|warn|alert
  actions?: string[];
  message?: string;
}

export interface DispatchContext {
  facility_id?: string;
  facility_name?: string;
  lat?: number;
  lng?: number;
  address?: string;
  weapon?: boolean;                           // 싸움 det cls = guns/knife 감지 시
  crowd_over_threshold?: boolean;             // 군중 crowd[].count > threshold
  vitals?: DetectionInput["vitals"];          // 68 바이탈 동반 시(낙상+무반응 등)
  emergency?: DetectionInput["emergency"];    // 68 응급버튼/외침
  situation?: string;                         // 68 상황판정
}

export type DispatchPayload = DetectionInput & {
  facility_id?: string; facility_name?: string;
  lat?: number; lng?: number; address?: string;
  source_system?: string;
};

/** LUMIZOOM 감지 이벤트 → /api/detect/dispatch 페이로드. ctx로 트랙별 상향 신호 주입. */
export function eventToDispatch(event: LumizoomEvent, ctx: DispatchContext = {}): DispatchPayload {
  const track = (event.track || "").toLowerCase();
  const payload: DispatchPayload = {
    event_type: track,
    detail: event.message || `${event.track}@${event.zone || "?"}`,
    source_system: "lumizoom",
    facility_id: ctx.facility_id,
    facility_name: ctx.facility_name,
    address: ctx.address || event.zone,
    lat: ctx.lat,
    lng: ctx.lng,
  };

  // 군중: 이벤트 severity=alert 이거나 ctx 임계초과면 임계 초과로 간주
  if (track === "crowd" || track === "군중") {
    payload.crowd_over_threshold = ctx.crowd_over_threshold ?? (event.severity === "alert");
  }
  // 싸움: 무기 동반 여부(det cls guns/knife) 주입 → grade에서 RED 상향
  if (track === "fight" || track === "싸움") {
    payload.weapon = ctx.weapon ?? false;
  }
  // 68 동반 신호(있을 때만)
  if (ctx.vitals) payload.vitals = ctx.vitals;
  if (ctx.emergency) payload.emergency = ctx.emergency;
  if (ctx.situation) payload.situation = ctx.situation;

  return payload;
}

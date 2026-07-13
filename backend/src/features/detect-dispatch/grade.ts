// 감지→대응 결합 v1: 위험유형·바이탈·상황판정 → 출동자 등급 매핑 (순수 함수, 격리 신규)
// 등급: GREEN(검증 시민/경증) · ORANGE(전문 돌봄/요양) · RED(의료 전문/무반응·바이탈이상)
// 철학: triage.ts와 동일 — "애매하면 더 높은 등급"(보수적). LLM 불필요한 결정형 규칙.
//
// ★7트랙 등급 매핑 (2026-07-13 완성 · 잠정 = 실제 출동 부르는 결정이므로 대표 확인 대상):
//   fire(화재)      → RED     즉시 생명위협
//   drowning(익수)  → RED     즉시 생명위협(수중)
//   fall(낙상)      → ORANGE, 단 무반응/바이탈이상 동반 시 RED (기존 로직)
//   fight(싸움)     → ORANGE, 무기(weapon) 동반 시 RED로 상향 (TENTATIVE)
//   intrusion(침입) → ORANGE
//   wander(배회)    → ORANGE
//   crowd(군중밀집) → 임계밀도 초과(crowd_over_threshold) ORANGE / 평상 GREEN
//   + 무반응·SPO2<90·HR/호흡 이상·응급버튼 = 트랙 무관 RED/상향(기존)
// ※ 각 // TENTATIVE 표기 = 대표 확인 후 프로덕션 확정. 실배포·실연동은 이 파일 밖(대표 승인).

export type Grade = "green" | "orange" | "red";
export type Urgency = "normal" | "urgent" | "emergency";

export interface Vitals {
  spo2?: number;        // %  (68 SM_Sensor.SPO2)
  hr?: number;          // bpm (SM_Sensor.HeartRate)
  br?: number;          // br/min (SM_Sensor.BreathRate)
  responsive?: boolean; // 반응 여부 (ER/센서 파생, false = 무반응)
}

export interface DetectionInput {
  event_type: string;                        // fall|fire|drowning|fight|intrusion|wander|crowd|sound|no_response|vital_abnormal 등 (7트랙+hi/68 공통)
  situation?: string;                        // 68 Total_Labeling.Estimation: 정상|외출|식사|수면|주의|위험
  vitals?: Vitals;
  emergency?: { button?: number; shout?: number }; // 68 ER_Sensor
  weapon?: boolean;                          // 싸움: 무기(총·칼) 동반 여부 → RED 상향 (TENTATIVE)
  crowd_over_threshold?: boolean;            // 군중: 임계 밀도 초과 여부 → ORANGE (아니면 GREEN)
  detail?: string;
}

export interface TriageDecision {
  grade: Grade;
  urgency: Urgency;
  call119: boolean;
  reason: string;
}

// 상황판정 정규화(한/영)
const SITU_DANGER = new Set(["위험", "danger", "critical"]);
const SITU_CAUTION = new Set(["주의", "caution", "warning"]);

// 무반응/의료응급 계열 이벤트 타입 (+ 익수=즉시 생명위협)
const RED_EVENTS = new Set(["no_response", "unconscious", "무반응", "cardiac", "seizure", "stroke", "vital_abnormal",
                            "drowning", "익수"]);   // TENTATIVE: 익수 RED — 대표 확인
// 전문 돌봄 계열 이벤트 타입 (+ 싸움=잠정 ORANGE, 무기 시 RED 상향)
const ORANGE_EVENTS = new Set(["fall", "wander", "배회", "intrusion", "fever", "dementia", "confusion",
                               "fight", "싸움"]);   // TENTATIVE: 싸움 ORANGE — 대표 확인

function anyVitalCritical(v?: Vitals): string | null {
  if (!v) return null;
  if (v.responsive === false) return "무반응";
  if (v.spo2 != null && v.spo2 < 90) return `SPO2 ${v.spo2}%(<90)`;
  if (v.hr != null && (v.hr < 40 || v.hr > 140)) return `HR ${v.hr}(이상)`;
  if (v.br != null && (v.br < 6 || v.br > 30)) return `호흡 ${v.br}(이상)`;
  return null;
}

/** 위험유형+바이탈+상황판정 → 출동등급 결정(보수적). */
export function mapDetectionToGrade(input: DetectionInput): TriageDecision {
  const ev = (input.event_type || "").toLowerCase();
  const situ = (input.situation || "").toLowerCase();
  const v = input.vitals;
  const button = input.emergency?.button === 1;
  const shout = input.emergency?.shout === 1;

  // ---------- RED: 의료 전문 (무반응·바이탈이상·생명위협) ----------
  const vitalCrit = anyVitalCritical(v);
  const redReasons: string[] = [];
  if (vitalCrit) redReasons.push(vitalCrit);
  if (RED_EVENTS.has(ev)) redReasons.push(`이벤트=${input.event_type}`);
  if (ev === "fire") redReasons.push("화재(생명위협)");                       // TENTATIVE: 화재 RED — 대표 확인
  if ((ev === "fight" || ev === "싸움") && input.weapon) redReasons.push("싸움+무기(상향)"); // TENTATIVE: 무기 시 RED
  if (SITU_DANGER.has(situ) && (button || vitalCrit)) redReasons.push("상황=위험+응급신호");
  if (redReasons.length) {
    const lifeThreat =
      v?.responsive === false ||
      (v?.spo2 != null && v.spo2 < 85) ||
      (v?.br != null && v.br < 6) ||
      (v?.hr != null && (v.hr < 35 || v.hr > 160)) ||
      ev === "fire" || ev === "drowning" || ev === "익수";
    return {
      grade: "red",
      urgency: "emergency",
      call119: !!lifeThreat,
      reason: "RED: " + redReasons.join(", "),
    };
  }

  // ---------- 군중 밀집: 임계 초과 ORANGE / 평상 GREEN (TENTATIVE: 대표 확인) ----------
  if (ev === "crowd" || ev === "군중") {
    if (input.crowd_over_threshold) {
      return { grade: "orange", urgency: "urgent", call119: false,
               reason: "ORANGE: 군중 임계밀도 초과" };
    }
    return { grade: "green", urgency: "normal", call119: false,
             reason: "GREEN: 군중 평상(임계 이하)" };
  }

  // ---------- ORANGE: 전문 돌봄 (요양·주의·도움요청) ----------
  const orangeReasons: string[] = [];
  if (ORANGE_EVENTS.has(ev)) orangeReasons.push(`이벤트=${input.event_type}`);
  if (SITU_CAUTION.has(situ)) orangeReasons.push("상황=주의");
  if (button || shout) orangeReasons.push(button ? "응급버튼(바이탈 정상)" : "외침(바이탈 정상)");
  if (orangeReasons.length) {
    return {
      grade: "orange",
      urgency: "urgent",
      call119: false,
      reason: "ORANGE: " + orangeReasons.join(", "),
    };
  }

  // ---------- GREEN: 검증 시민 (경증·모니터링) ----------
  return {
    grade: "green",
    urgency: "normal",
    call119: false,
    reason: `GREEN: 경증/모니터링(${input.event_type}${situ ? "/" + input.situation : ""})`,
  };
}

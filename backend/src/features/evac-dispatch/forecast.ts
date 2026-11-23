// 이웃대피 1단계: 마을재난예보 출력 형식 v1 → 출동 후보 (순수 함수, 격리 신규)
// 약속 문서: C:\Users\admin\disaster_forecast\ops\결과형식_마을재난예보_출력_v1.md (2026-10-26, 마을재난예보 창)
//   한 줄 = 한 읍면동 × 한 재난. 온다는 level 이 상위10% 이상이거나 already=1 인 줄만 후보로 쓴다.
// 마을재난예보 창의 코드·파일은 고치지 않는다(읽기만).

export interface ForecastRow {
  issued_at: string;      // 2026-10-26T11:40+09:00
  target_day: string;     // 2026-10-27
  run: string;            // 전날판 | 새벽판
  hazard: string;         // 하천범람·산사태·산불·폭염·한파·대설·강풍·큰비
  emd_code: string;       // 7자리
  sido: string;
  sgg: string;
  emd: string;
  rank: number;
  n: number;
  level: string;          // 상위5% | 상위10% | 기준넘음
  already: number;        // 1/0 (새벽판만)
  pop: number;
  a65: number;
  a80: number;
  deadline: string;       // 18:00
  shelter_name: string;
  shelter_lat: number | null;
  shelter_lon: number | null;
  shelter_km: number | null;
}

const NUM = new Set(["rank", "n", "already", "pop", "a65", "a80"]);
const NUM_OR_NULL = new Set(["shelter_lat", "shelter_lon", "shelter_km"]);

/** CSV 한 줄을 칸으로 나눈다(큰따옴표 안 쉼표 허용). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 객체(JSON) 또는 CSV 한 줄 → ForecastRow. 모르는 칸은 버리고, 빠진 칸은 기본값. */
export function normalizeRow(raw: Record<string, unknown>): ForecastRow {
  const g = (k: string) => (raw[k] === undefined || raw[k] === null ? "" : String(raw[k]).trim());
  const r: Record<string, unknown> = {};
  for (const k of ["issued_at", "target_day", "run", "hazard", "emd_code", "sido", "sgg", "emd",
                   "level", "deadline", "shelter_name"]) r[k] = g(k);
  for (const k of NUM) { const v = Number(g(k)); r[k] = Number.isFinite(v) ? v : 0; }
  for (const k of NUM_OR_NULL) { const s = g(k); const v = Number(s); r[k] = s !== "" && Number.isFinite(v) ? v : null; }
  if (!r.deadline) r.deadline = "18:00";
  return r as unknown as ForecastRow;
}

/** 내일위험_YYYYMMDD.csv / 새벽갱신_YYYYMMDD.csv 본문 → 줄 목록. BOM·빈 줄 허용. */
export function parseForecastCsv(text: string): ForecastRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    const o: Record<string, unknown> = {};
    head.forEach((h, i) => { o[h] = cells[i]; });
    return normalizeRow(o);
  });
}

/** 약속 문서 규칙: 상위10% 이상(상위5% 포함) 또는 이미 기준을 넘은 줄만 출동 후보. */
export function isDispatchCandidate(r: ForecastRow): boolean {
  // 날짜가 YYYY-MM-DD 가 아니면 버린다 — 마감 시각이 깨지고 같은 경보가 갈라지는 것 막음 (2026-10-26 검토 반영)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.target_day)) return false;
  return r.level === "상위5%" || r.level === "상위10%" || r.already === 1;
}

/** 같은 날·같은 재난·같은 읍면동은 한 경보로 묶는다(전날판 → 새벽판 갱신 시 같은 id). */
export function alertKey(r: ForecastRow): string {
  return `${r.target_day}|${r.hazard}|${r.emd_code}`;
}

/** 대피 마감 시각(KST) — target_day + deadline. 이미 기준을 넘었으면(새벽판 already=1) 지금 바로. */
export function deadlineIso(r: ForecastRow): string {
  const hhmm = /^\d{1,2}:\d{2}$/.test(r.deadline) ? r.deadline.padStart(5, "0") : "18:00";
  return `${r.target_day}T${hhmm}:00+09:00`;
}

export type AlertLevel = "watch" | "evacuate_now";

/** 전날판 = 사전 점검(도우미가 미리 살펴봄) / 새벽판에서 이미 넘음 = 바로 대피 준비. */
export function alertStage(r: ForecastRow): AlertLevel {
  return r.already === 1 ? "evacuate_now" : "watch";
}

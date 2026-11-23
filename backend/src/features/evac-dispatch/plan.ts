// 이웃대피 1단계: 대피 대상자 × 도우미 → 출동 계획 (순수 함수, 격리 신규)
// 원칙: 1:1 담당 도우미(행안부 대피도우미 방식)를 먼저, 못 오면 가장 가까운 검증 이웃으로.
//       거동 상태가 무거울수록 높은 등급(그린→오렌지) — triage.ts·grade.ts 와 같은 «애매하면 높게».

import type { Grade } from "../detect-dispatch/grade";

export type Mobility = "walk" | "assist" | "wheelchair" | "bed";
//  walk       혼자 걸음(안내만)          → 그린
//  assist     부축 필요                  → 그린(검증 시민 가능)
//  wheelchair 휠체어                     → 오렌지(요양보호사·사회복지사)
//  bed        누워 지냄(와상)            → 오렌지 + 도우미 2명

export interface EvacPerson {
  id: string;
  emd_code: string;
  name: string;
  mobility: Mobility;
  lat: number;
  lng: number;
  helper_id?: string | null;   // 1:1 담당 도우미(onda_users.id)
}

export interface HelperState {
  user_id: string;
  grade: Grade;
  lat: number | null;          // LOCATION_KV 마지막 위치(30초 TTL). 없으면 null
  lng: number | null;
  available: boolean;
}

export interface Offer { user_id: string; grade: Grade; km: number | null; preferred: boolean }

export interface PersonPlan {
  person_id: string;
  grade: Grade;
  helpers_needed: number;
  offers: Offer[];
  shortfall: boolean;          // 제안할 사람이 필요한 수보다 적음 → 군청·119 로 넘길 대상
}

const RANK: Record<Grade, number> = { green: 0, orange: 1, red: 2 };

export function gradeForMobility(m: Mobility): Grade {
  return m === "wheelchair" || m === "bed" ? "orange" : "green";
}

export function helpersNeeded(m: Mobility): number {
  return m === "bed" ? 2 : 1;
}

/** 상위 등급은 하위 요청도 할 수 있다(dispatchRoute.ts GRADE_IN 과 같은 규칙). */
export function canServe(helper: Grade, required: Grade): boolean {
  return RANK[helper] >= RANK[required];
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface PlanOptions {
  radiusKm?: number;     // 기본 5km (dispatchRoute.ts 와 같음)
  extraOffers?: number;  // 필요한 수보다 몇 명 더 제안할지(기본 2 — 60초 안 받으면 만료되므로 여유)
  busy?: Set<string>;    // 이번 경보에서 이미 다른 분을 맡은 도우미(한 사람이 두 집을 동시에 못 감)
  exclude?: Map<string, Set<string>>; // 사람별로 다시 부르지 않을 도우미(그분 칸을 거절·만료한 사람)
}

/** 한 사람에 대한 제안 순서: 담당 도우미 → 가까운 순(등급·반경·바쁨 거름). */
export function planForPerson(p: EvacPerson, helpers: HelperState[], opt: PlanOptions = {}): PersonPlan {
  const radius = opt.radiusKm ?? 5;
  const extra = opt.extraOffers ?? 2;
  const busy = new Set<string>(opt.busy ?? []);
  (opt.exclude?.get(p.id) ?? new Set<string>()).forEach((u) => busy.add(u));
  const grade = gradeForMobility(p.mobility);
  const need = helpersNeeded(p.mobility);
  const want = need + extra;

  const offers: Offer[] = [];
  const pref = p.helper_id ? helpers.find((h) => h.user_id === p.helper_id) : undefined;
  // 담당 도우미는 위치가 없어도(앱을 안 켜 둠) 먼저 부른다 — 1:1 짝의 뜻. 등급이 모자라면 «동행»으로 같이 제안.
  if (pref && pref.available && !busy.has(pref.user_id)) {
    const km = pref.lat != null && pref.lng != null ? round2(haversineKm(p.lat, p.lng, pref.lat, pref.lng)) : null;
    offers.push({ user_id: pref.user_id, grade: pref.grade, km, preferred: true });
  }

  const near = helpers
    .filter((h) => h.available && h.user_id !== p.helper_id && !busy.has(h.user_id))
    .filter((h) => canServe(h.grade, grade))
    .filter((h) => h.lat != null && h.lng != null)
    .map((h) => ({ h, km: haversineKm(p.lat, p.lng, h.lat as number, h.lng as number) }))
    .filter((x) => x.km <= radius)
    .sort((a, b) => a.km - b.km);

  for (const x of near) {
    if (offers.length >= want) break;
    offers.push({ user_id: x.h.user_id, grade: x.h.grade, km: round2(x.km), preferred: false });
  }

  // 등급을 채우는 사람 수(담당 도우미가 그린인데 오렌지가 필요하면 그 사람은 동행으로만 셈)
  const qualified = offers.filter((o) => canServe(o.grade, grade)).length;
  return { person_id: p.id, grade, helpers_needed: need, offers, shortfall: qualified < need };
}

/**
 * 한 경보(한 읍면동)의 전체 계획 — 두 번에 나눠 잡는다.
 *  1차: 무거운 분(와상→휠체어→부축→걸음)부터 «꼭 필요한 수»만 잡는다(여유 없이).
 *  2차: 남은 도우미로 여유 제안(60초 만료 대비)을 같은 순서로 나눈다.
 * 한 사람이 여유 몫까지 먼저 다 가져가 다음 분이 0명이 되는 일을 막는다(2026-10-26 시험에서 실제로 생김).
 * 같은 도우미는 한 경보에서 한 집에만 제안된다.
 */
export function planForAlert(people: EvacPerson[], helpers: HelperState[], opt: PlanOptions = {}): PersonPlan[] {
  const order: Record<Mobility, number> = { bed: 0, wheelchair: 1, assist: 2, walk: 3 };
  const extra = opt.extraOffers ?? 2;
  const busy = new Set<string>(opt.busy ?? []);
  const sorted = [...people].sort((a, b) => order[a.mobility] - order[b.mobility]);
  const plans = new Map<string, PersonPlan>();
  // 담당 도우미는 자기 어르신 몫으로 먼저 떼어 둔다 — 다른 분이 «가장 가까운 이웃»으로 먼저 가져가지 않게
  // (2026-10-26 로컬 검토: 걸음 어르신 둘 중 다른 분이 담당 도우미를 가져가 담당 어르신이 엉뚱한 이웃에게 간 일)
  const reserved = new Set<string>(people.map((p) => p.helper_id).filter((x): x is string => !!x));
  for (const p of sorted) {
    const others = new Set<string>(busy);
    reserved.forEach((h) => { if (h !== p.helper_id) others.add(h); });
    const plan = planForPerson(p, helpers, { ...opt, busy: others, extraOffers: 0 });
    plan.offers.forEach((o) => busy.add(o.user_id));
    plans.set(p.id, plan);
  }
  for (let round = 0; round < extra; round++) {
    for (const p of sorted) {
      const plan = plans.get(p.id)!;
      const more = planForPerson({ ...p, helper_id: null }, helpers, { ...opt, busy, extraOffers: 0 });
      const next = more.offers.find((o) => !busy.has(o.user_id));
      if (next) { plan.offers.push(next); busy.add(next.user_id); }
    }
  }
  for (const plan of plans.values()) {
    const p = sorted.find((x) => x.id === plan.person_id)!;
    const qualified = plan.offers.filter((o) => canServe(o.grade, gradeForMobility(p.mobility))).length;
    plan.shortfall = qualified < plan.helpers_needed;
  }
  return sorted.map((p) => plans.get(p.id)!);
}

/** 군청 상황실 숫자: 명단 대비 대피 완료·이동 중·못 감. */
export type TaskStatus = "planned" | "offered" | "no_answer" | "accepted" | "arrived" | "at_shelter" | "unreachable" | "handed_over";
//  no_answer   제안이 모두 만료·거절 → 다시 배정 필요(아직 실패 아님)
//  unreachable 도우미가 현장에서 «못 모심»을 누름 / handed_over 군청·119 로 넘김

export function summarize(statuses: TaskStatus[]) {
  const c = (s: TaskStatus) => statuses.filter((x) => x === s).length;
  const total = statuses.length;
  const done = c("at_shelter");
  return {
    total,
    done,
    moving: c("accepted") + c("arrived"),
    waiting: c("planned") + c("offered") + c("no_answer"),
    needs_reoffer: c("no_answer"),
    unassigned: c("planned") + c("no_answer"), // 대피 시작 뒤 아직 아무에게도 안 간 칸(새로 생긴 칸 포함) — «다시 배정» 버튼 수
    failed: c("unreachable") + c("handed_over"),
    done_pct: total ? Math.round((done / total) * 1000) / 10 : 0,
  };
}

/**
 * 기존 온다 출동 흐름의 match 상태(responderRoutes.ts) → 대피 칸 상태.
 * 도우미는 새 화면 없이 기존 앱 버튼(수락→이동중→도착→돌봄중→완료)을 그대로 누른다. «완료» = 대피소 도착.
 */
export function deriveTaskStatus(matchStatuses: string[], flag: "none" | "unreachable" | "handed_over" = "none", planned = false): TaskStatus {
  if (flag !== "none") return flag;
  const has = (s: string) => matchStatuses.includes(s);
  if (has("completed")) return "at_shelter";
  if (has("arrived") || has("in_progress")) return "arrived";
  if (has("accepted") || has("moving")) return "accepted";
  if (has("offered")) return "offered";
  return planned ? "planned" : "no_answer";
}

function round2(x: number) { return Math.round(x * 100) / 100; }

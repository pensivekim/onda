// 다올(구 가칭 이웃대피) 3단계: 군청 상황실 화면 (/admin/evac) — 2026-10-26 신규
// 큰 화면(상황실 TV)과 노트북 모두에서 읽히게: 위에 큰 숫자 4개 + 진행 막대, 아래 마을별 카드.
// 10초마다 새로 읽음. 버튼은 «대피 시작», «다시 배정», «119·읍면사무소로 넘김» 세 가지뿐.
// 디자인 규칙(CLAUDE.md): 선 없이 배경색 차이로만 구분, 순검정 금지, 빨강(primary)은 긴급 버튼에만.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

type Status = 'planned' | 'offered' | 'no_answer' | 'accepted' | 'arrived' | 'at_shelter' | 'unreachable' | 'handed_over';
interface Summary { total: number; done: number; moving: number; waiting: number; needs_reoffer: number; unassigned?: number; failed: number; done_pct: number }
interface Row { task_id: string; person: string; mobility: string; slot?: number; status: Status; helper_name?: string | null; note?: string | null }
interface Alert {
  id: string; target_day: string; hazard: string; sgg: string; emd: string; level: string;
  stage: 'watch' | 'evacuate_now'; status: 'open' | 'started' | 'closed'; deadline_at: string;
  shelter_name: string | null; a65: number; a80: number; summary: Summary; remaining: Row[]; moving?: Row[];
}

const MOB: Record<string, string> = { walk: '혼자 걸음', assist: '부축 필요', wheelchair: '휠체어', bed: '와상' };
const ST: Record<Status, { label: string; cls: string }> = {
  planned:     { label: '대기',            cls: 'bg-surface-high text-on-surface-variant' },
  offered:     { label: '이웃 찾는 중',     cls: 'bg-secondary-container text-secondary' },
  no_answer:   { label: '다시 배정 필요',   cls: 'bg-orange-grade-bg text-orange-grade' },
  accepted:    { label: '가는 중',          cls: 'bg-secondary-container text-secondary' },
  arrived:     { label: '모시는 중',        cls: 'bg-trust-green-bg text-trust-green' },
  at_shelter:  { label: '대피 완료',        cls: 'bg-trust-green-bg text-trust-green' },
  unreachable: { label: '못 모심',          cls: 'bg-error-container text-error' },
  handed_over: { label: '119·읍면 넘김',    cls: 'bg-surface-high text-on-surface' },
};

// 남은 분 목록 순서: 손이 필요한 칸이 위로
const URGENCY: Record<string, number> = { unreachable: 0, no_answer: 1, planned: 2, offered: 3, accepted: 4, arrived: 5, handed_over: 6, at_shelter: 7 };

function remainText(deadline: string, now: number) {
  const ms = new Date(deadline).getTime() - now;
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return '마감 지남';
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}시간 ${m}분 남음` : `${m}분 남음`;
}
function hhmm(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
}

export default function EvacBoard() {
  const { token } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [day, setDay] = useState<string>('');
  const [showDate, setShowDate] = useState(false);
  const [busy, setBusy] = useState<string>('');
  const [msg, setMsg] = useState<string>('');
  const [loadedAt, setLoadedAt] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());

  const load = useCallback(async () => {
    if (!token) return;
    const d = await api.get(`/api/evac/board${day ? `?day=${day}` : ''}`, token);
    if (d.alerts) { setAlerts(d.alerts); setLoadedAt(Date.now()); }
    else if (d.error) setMsg(`불러오지 못했습니다 (${d.error})`);
  }, [token, day]);

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 8000); return () => clearTimeout(t); }, [msg]);

  const total = useMemo(() => alerts.reduce((a, x) => ({
    total: a.total + x.summary.total, done: a.done + x.summary.done, moving: a.moving + x.summary.moving,
    waiting: a.waiting + x.summary.waiting, failed: a.failed + x.summary.failed,
  }), { total: 0, done: 0, moving: 0, waiting: 0, failed: 0 }), [alerts]);
  const pct = total.total ? Math.round((total.done / total.total) * 100) : 0;

  const start = async (a: Alert, again = false) => {
    if (!again && !window.confirm(`${a.sgg} ${a.emd} — ${a.hazard} 대피를 시작합니다.\n명단 ${a.summary.total}분의 담당·이웃 도우미에게 출동 부탁이 나갑니다.`)) return;
    setBusy(a.id);
    const r = await api.post(`/api/evac/alerts/${encodeURIComponent(a.id)}/start`, {}, token!);
    setBusy('');
    setMsg(r.ok ? `${a.emd}: 출동 부탁 ${r.offered ?? 0}건을 보냈습니다${r.shortfall ? ` · 도우미가 모자란 분 ${r.shortfall}명` : ''}` : `실패: ${r.error}`);
    load();
  };
  const handover = async (row: Row) => {
    if (!window.confirm(`${row.person} 어르신을 119·읍면사무소로 넘긴 것으로 표시합니다.`)) return;
    await api.post(`/api/evac/tasks/${row.task_id}/flag`, { flag: 'handed_over', note: '군청: 119·읍면사무소 연계' }, token!);
    load();
  };

  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-6xl mx-auto px-5 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold text-on-surface">다올 상황실</h1>
            <p className="text-sm text-on-surface-variant mt-1">
              {loadedAt ? `${new Date(loadedAt).toLocaleTimeString('ko-KR', { hour12: false })} 기준 · 10초마다 새로 고침` : '불러오는 중…'}
            </p>
          </div>
          {/* 날짜 칸은 누를 때만 보임 — 브라우저 언어에 따라 «mm/dd/yyyy» 같은 영어 자리표시가 뜨는 것 막음 */}
          {showDate || day ? (
            <label className="flex items-center gap-2 text-sm text-on-surface-variant">
              날짜
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} lang="ko"
                className="bg-surface-card rounded-xl px-3 py-2 text-on-surface" />
              <button onClick={() => { setDay(''); setShowDate(false); }} className="px-3 py-2 rounded-xl bg-surface-low">진행 중 전체</button>
            </label>
          ) : (
            <button onClick={() => setShowDate(true)} className="text-sm px-3 py-2 rounded-xl bg-surface-card text-on-surface-variant">날짜별로 보기</button>
          )}
        </div>

        {/* 큰 숫자 4개 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          {[
            { label: '대피 완료', v: total.done, cls: 'text-trust-green' },
            { label: '이동 중', v: total.moving, cls: 'text-secondary' },
            { label: '남은 분', v: total.waiting, cls: 'text-orange-grade' },
            { label: '못 모심·넘김', v: total.failed, cls: 'text-error' },
          ].map((k) => (
            <div key={k.label} className="bg-surface-card rounded-card p-5">
              <div className={`font-display font-extrabold text-4xl md:text-5xl ${k.cls}`}>{k.v}<span className="text-xl ml-1">명</span></div>
              <div className="text-sm text-on-surface-variant mt-1">{k.label}</div>
            </div>
          ))}
        </div>
        <div className="bg-surface-card rounded-card p-5 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-semibold">전체 {total.total}명 중 대피 완료</span>
            <span className="font-display font-bold text-trust-green">{pct}%</span>
          </div>
          <div className="h-4 rounded-full bg-surface-low overflow-hidden">
            <div className="h-full bg-trust-green transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {msg && <div className="bg-secondary-container text-secondary rounded-card px-5 py-3 mb-4 text-sm font-semibold">{msg}</div>}

        {alerts.length === 0 && loadedAt > 0 && (
          <div className="bg-surface-low rounded-card p-10 text-center text-on-surface-variant">지금 대피 경보가 없습니다.</div>
        )}

        <div className={`grid grid-cols-1 gap-4 ${alerts.length > 1 ? 'lg:grid-cols-2' : ''}`}>
          {alerts.map((a) => {
            const s = a.summary;
            const p = s.total ? Math.round((s.done / s.total) * 100) : 0;
            const urgent = a.stage === 'evacuate_now';
            return (
              <section key={a.id} className={`rounded-card p-5 ${urgent ? 'bg-error-container/40' : 'bg-surface-card'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-on-surface-variant">{a.target_day} · {a.sgg}</div>
                    <h2 className="font-display text-xl font-bold">{a.emd} <span className="text-base font-semibold text-on-surface-variant">{a.hazard}</span></h2>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs">
                      <span className={`px-2 py-1 rounded-full font-semibold ${urgent ? 'bg-primary text-on-primary' : 'bg-orange-grade-bg text-orange-grade'}`}>
                        {urgent ? '바로 대피' : '사전 점검 중'}
                      </span>
                      <span className="px-2 py-1 rounded-full bg-surface-low">마감 {hhmm(a.deadline_at)} · {remainText(a.deadline_at, now)}</span>
                      <span className="px-2 py-1 rounded-full bg-surface-low">대피소 {a.shelter_name || '지정 대피소'}</span>
                      <span className="px-2 py-1 rounded-full bg-surface-low">65세+ {a.a65?.toLocaleString()} · 80세+ {a.a80?.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display text-3xl font-extrabold text-trust-green">{p}%</div>
                    <div className="text-xs text-on-surface-variant">{s.done}/{s.total}명 완료</div>
                  </div>
                </div>

                <div className="h-2 rounded-full bg-surface-low overflow-hidden mt-4">
                  <div className="h-full bg-trust-green transition-all duration-700" style={{ width: `${p}%` }} />
                </div>
                <div className="flex gap-4 text-xs text-on-surface-variant mt-2">
                  <span>이동 중 {s.moving}</span><span>남은 분 {s.waiting}</span><span>못 모심·넘김 {s.failed}</span>
                </div>

                <div className="flex gap-2 mt-4">
                  {a.status === 'open' && (
                    <button disabled={busy === a.id} onClick={() => start(a)}
                      className="flex-1 py-3 rounded-xl bg-primary text-on-primary font-display font-bold disabled:opacity-50">
                      {busy === a.id ? '보내는 중…' : '대피 시작'}
                    </button>
                  )}
                  {a.status !== 'open' && (s.unassigned ?? s.needs_reoffer) > 0 && (
                    <button disabled={busy === a.id} onClick={() => start(a, true)}
                      className="flex-1 py-3 rounded-xl bg-orange-grade text-white font-display font-bold disabled:opacity-50">
                      다시 배정 ({s.unassigned ?? s.needs_reoffer}칸)
                    </button>
                  )}
                </div>

                {a.status !== 'open' && (
                  <a href={`/admin/evac/report/${encodeURIComponent(a.id)}`}
                    className="mt-2 block text-center py-2 rounded-xl bg-surface-low text-sm font-semibold text-on-surface">결과 보고서</a>
                )}

                {a.remaining.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-bold mb-2">아직 대피소에 닿지 않은 분</h3>
                    <ul className="flex flex-col gap-2">
                      {[...a.remaining].sort((x, y) => (URGENCY[x.status] ?? 9) - (URGENCY[y.status] ?? 9) || x.person.localeCompare(y.person, 'ko') || (x.slot || 1) - (y.slot || 1)).map((r) => (
                        <li key={r.task_id} className="bg-surface rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-sm truncate">
                              {r.person} 어르신 <span className="font-normal text-on-surface-variant">· {MOB[r.mobility] || r.mobility}{r.slot && r.slot > 1 ? ` (도우미 ${r.slot})` : ''}</span>
                            </div>
                            <div className="text-xs text-on-surface-variant truncate">
                              {r.helper_name ? `도우미 ${r.helper_name}` : '도우미 미정'}{r.note ? ` · ${r.note}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${ST[r.status]?.cls || ''}`}>{ST[r.status]?.label || r.status}</span>
                            {['no_answer', 'unreachable'].includes(r.status) && a.status !== 'open' && (
                              <button onClick={() => handover(r)} className="px-2 py-1 rounded-lg bg-surface-high text-xs font-semibold">119·읍면사무소로 넘김</button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

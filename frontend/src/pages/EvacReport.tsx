// 다올 대피 결과 보고 (/admin/evac/report/:id) — 2026-10-26 신규
// 군청이 군수·도에 올리는 한 장. 화면에서 바로 인쇄(A4)하거나 PDF 로 저장한다.
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

function toDate(v?: string | null) {
  if (!v) return null;
  // DB 기본값 'YYYY-MM-DD HH:MM:SS'(UTC) 와 ISO 둘 다 받음
  const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? v.replace(' ', 'T') + 'Z' : v;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmt(v?: string | null, withDate = false) {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit',
    ...(withDate ? { month: 'long', day: 'numeric' } : {}),
  });
}
function gap(a?: string | null, b?: string | null) {
  const x = toDate(a), y = toDate(b);
  if (!x || !y) return '—';
  const m = Math.max(0, Math.round((y.getTime() - x.getTime()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
}

export default function EvacReport() {
  const { id } = useParams();
  const { token } = useAuth();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!token || !id) return;
    api.get(`/api/evac/alerts/${encodeURIComponent(id)}/report`, token).then((r: any) => (r.ok ? setD(r) : setErr(r.error || '불러오지 못했습니다')));
  }, [token, id]);

  if (err) return <div className="p-10 text-center text-on-surface-variant">{err}</div>;
  if (!d) return <div className="p-10 text-center text-on-surface-variant">보고서를 만드는 중…</div>;
  const a = d.alert, t = d.timeline, n = d.totals;
  const failed = d.people.filter((p: any) => p.result === '못 모심' || p.result === '119·읍면사무소 연계');

  return (
    <div className="min-h-screen bg-surface print:bg-white">
      <div className="max-w-3xl mx-auto px-6 py-8 print:p-0">
        <div className="flex justify-between items-center mb-6 print:hidden">
          <Link to="/admin/evac" className="text-sm text-secondary font-semibold">← 상황실로</Link>
          <button onClick={() => window.print()} className="px-5 py-2 rounded-xl bg-on-surface text-surface font-bold">인쇄 · PDF 저장</button>
        </div>

        <article className="bg-surface-card rounded-card p-8 print:rounded-none print:p-0">
          <header className="mb-6">
            <div className="text-sm text-on-surface-variant">{a.sido} {a.sgg}</div>
            <h1 className="font-display text-2xl font-bold mt-1">{a.emd} {a.hazard} 대피 결과 보고</h1>
            <div className="text-sm text-on-surface-variant mt-1">{a.target_day} · 작성 {fmt(d.generated_at, true)} · 다올</div>
          </header>

          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { k: '대상 어르신', v: `${n.people}명` },
              { k: '대피 완료', v: `${n.done}명` },
              { k: '119·읍면 연계', v: `${n.handed_over + n.unreachable}명` },
              { k: '참여 이웃', v: `${n.helpers}명` },
            ].map((x) => (
              <div key={x.k} className="bg-surface-low rounded-xl p-4">
                <div className="font-display text-2xl font-extrabold">{x.v}</div>
                <div className="text-xs text-on-surface-variant mt-1">{x.k}</div>
              </div>
            ))}
          </section>

          <section className="mb-6">
            <h2 className="font-display font-bold mb-2">진행 시각</h2>
            <table className="w-full text-sm">
              <tbody>
                {[
                  ['경보 접수', fmt(t.received_at, true), ''],
                  ['대피 시작(군청)', fmt(t.started_at, true), `접수 뒤 ${gap(t.received_at, t.started_at)}`],
                  ['첫 이웃 출발', fmt(t.first_accept_at, true), `시작 뒤 ${gap(t.started_at, t.first_accept_at)}`],
                  ['마지막 대피소 도착', fmt(t.last_shelter_at, true), `시작 뒤 ${gap(t.started_at, t.last_shelter_at)}`],
                  ['대피 마감', fmt(a.deadline_at, true), `대피소 ${a.shelter_name || '지정 대피소'}`],
                ].map(([k, v, m]) => (
                  <tr key={k} className="odd:bg-surface-low">
                    <td className="px-3 py-2 font-semibold w-40">{k}</td><td className="px-3 py-2">{v}</td><td className="px-3 py-2 text-on-surface-variant">{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="mb-6">
            <h2 className="font-display font-bold mb-2">어르신별 결과</h2>
            <table className="w-full text-sm">
              <thead><tr className="bg-surface-high text-left whitespace-nowrap">
                <th className="px-3 py-2">어르신</th><th className="px-3 py-2">거동</th><th className="px-3 py-2">도우미</th>
                <th className="px-3 py-2">댁 도착</th><th className="px-3 py-2">대피소 도착</th><th className="px-3 py-2">결과</th>
              </tr></thead>
              <tbody>
                {d.people.map((p: any, i: number) => (
                  <tr key={i} className="odd:bg-surface-low whitespace-nowrap">
                    <td className="px-3 py-2">{p.name}{p.slot > 1 ? ` (도우미 ${p.slot})` : ''}</td>
                    <td className="px-3 py-2">{p.mobility}</td>
                    <td className="px-3 py-2">{p.helper || '—'}</td>
                    <td className="px-3 py-2">{fmt(p.arrived_at)}</td>
                    <td className="px-3 py-2">{fmt(p.sheltered_at)}</td>
                    <td className={`px-3 py-2 font-semibold ${p.result === '대피 완료' ? 'text-trust-green' : p.result === '진행 중' ? 'text-secondary' : 'text-error'}`}>{p.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {failed.length > 0 && (
            <section className="mb-6">
              <h2 className="font-display font-bold mb-2">이웃이 모시지 못한 분과 조치</h2>
              <ul className="text-sm list-none flex flex-col gap-1">
                {failed.map((p: any, i: number) => <li key={i} className="bg-surface-low rounded-lg px-3 py-2">{p.name} ({p.mobility}) — {p.result}{p.note ? ` · ${p.note}` : ''}</li>)}
              </ul>
            </section>
          )}

          <section className="text-sm text-on-surface-variant">
            출동 활동비 합계 {n.cost_krw.toLocaleString()}원 ({a.sgg} 계약에서 정산) · 이 보고는 재난안전법에 따른 «스스로 대피하기 어려운 주민 사전 지원» 이행 기록으로 보관합니다.
          </section>
        </article>
      </div>
    </div>
  );
}

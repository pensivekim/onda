// 온다 텔레그램판 — 어르신·가족 미니 앱 (/tg/home)
// 2026-11-24 다시 만듦: 지금 상황 띠 · 도우미가 집에서 얼마나 떨어졌는지 · 단계 시각 · 위급 · 지난 기록.
// 지도 타일은 바깥 서버에 위치를 보내게 되므로 쓰지 않고, 집을 가운데 둔 거리 그림으로 보여 준다.
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

type Now = {
  requestId: string; state: string; emergency: boolean; createdAt: string; reqStatus?: string;
  match: null | { status: string; acceptedAt?: string; arrivedAt?: string; startedAt?: string; completedAt?: string; helper: string };
  near?: null | { m: number; dx: number; dy: number };
};

const BANNER: Record<string, [string, string]> = {
  offering: ['가까운 도우미께 부탁하는 중', 'bg-orange-grade-bg text-orange-grade'],
  exhausted: ['도우미를 찾는 중 — 상황실이 연락드립니다', 'bg-orange-grade-bg text-orange-grade'],
  accepted: ['도우미가 곧 출발합니다', 'bg-trust-green-bg text-trust-green'],
  moving: ['도우미가 오는 중입니다', 'bg-trust-green-bg text-trust-green'],
  arrived: ['도우미가 도착했습니다', 'bg-trust-green-bg text-trust-green'],
  in_progress: ['도우미가 돌봐 드리는 중입니다', 'bg-trust-green-bg text-trust-green'],
};
const STEPS = [['accepted', '맡음'], ['moving', '출발'], ['arrived', '도착'], ['in_progress', '돌봄'], ['completed', '마침']];

const hm = (s?: string) => {
  if (!s) return '';
  const d = new Date(s.includes('T') || s.endsWith('Z') ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(+d) ? '' : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
};
const day = (s: string) => {
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(+d) ? '' : d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) + ' ' + hm(s);
};
const dist = (m: number) => (m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`);

function Near({ near }: { near: NonNullable<Now['near']> }) {
  // 집이 가운데, 도우미 점은 방향 그대로 · 거리는 1.5km 까지 원 안에 줄여 그림
  const R = 90, max = 1500, k = Math.min(1, near.m / max) * R / Math.max(1, Math.hypot(near.dx, near.dy));
  const x = 110 + near.dx * k, y = 110 - near.dy * k;
  return (
    <svg viewBox="0 0 220 220" className="w-full max-w-[240px] mx-auto" aria-label={`도우미가 집에서 ${dist(near.m)}`}>
      <circle cx="110" cy="110" r="90" fill="none" stroke="currentColor" strokeOpacity=".15" />
      <circle cx="110" cy="110" r="45" fill="none" stroke="currentColor" strokeOpacity=".1" />
      <line x1="110" y1="110" x2={x} y2={y} stroke="#4F8A7E" strokeWidth="2" strokeDasharray="4 4" />
      <text x="110" y="116" textAnchor="middle" fontSize="20">🏠</text>
      <circle cx={x} cy={y} r="9" fill="#E3A23B" />
      <text x="110" y="214" textAnchor="middle" fontSize="12" fill="currentColor" opacity=".6">바깥 원 1.5km</text>
    </svg>
  );
}

function Elder({ id, token }: { id: string; token: string }) {
  const [d, setD] = useState<{ elder: { name: string }; now: Now | null; past: Now[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const f = () => api.get(`/api/tg/elders/${id}/now`, token).then((x: any) => (x.elder ? (setD(x), setErr('')) : setErr('불러오지 못했습니다'))).catch(() => setErr('연결이 끊겼습니다 — 다시 시도 중'));
    f(); const iv = setInterval(f, 8000); return () => clearInterval(iv);
  }, [id, token]);
  if (!d) return <div className="bg-surface-card rounded-card p-6 mb-4 text-on-surface-variant">{err || '불러오는 중…'}</div>;
  const n = d.now;
  const st = n?.match?.status || n?.state || '';
  const [txt, cls] = BANNER[st] || ['지금은 진행 중인 부탁이 없습니다', 'bg-surface-low text-on-surface-variant'];
  const at = n?.match ? { accepted: n.match.acceptedAt, arrived: n.match.arrivedAt, in_progress: n.match.startedAt, completed: n.match.completedAt } as Record<string, string | undefined> : {};
  const idx = STEPS.findIndex(([k]) => k === n?.match?.status);
  return (
    <section className="mb-8">
      <h2 className="font-display text-xl font-bold mb-3">{d.elder.name} 어르신</h2>
      <div className={`rounded-card p-5 mb-3 ${cls}`}>
        <p className="text-xl font-bold leading-snug">{txt}</p>
        {n && <p className="text-sm mt-1 opacity-80">부탁한 시각 {hm(n.createdAt)}{n.match ? ` · ${n.match.helper} 도우미` : ''}</p>}
      </div>
      {n?.emergency && (
        <a href="tel:119" className="block bg-error text-white rounded-card p-4 mb-3 text-center text-lg font-bold">🚑 위급 — 119 에 먼저 전화하세요</a>
      )}
      {n?.match && (
        <div className="bg-surface-card rounded-card p-5 mb-3">
          <ol className="flex justify-between text-center mb-4">
            {STEPS.map(([k, label], i) => (
              <li key={k} className="flex-1">
                <div className={`mx-auto w-4 h-4 rounded-full mb-1 ${i <= idx ? 'bg-secondary' : 'bg-surface-low'}`} />
                <div className={`text-sm ${i <= idx ? 'font-bold' : 'text-on-surface-variant'}`}>{label}</div>
                <div className="text-xs text-on-surface-variant">{hm(at[k])}</div>
              </li>
            ))}
          </ol>
          {n.near ? (
            <>
              <Near near={n.near} />
              <p className="text-center text-lg font-semibold mt-2">집에서 약 {dist(n.near.m)}</p>
            </>
          ) : n.match.status !== 'completed' && (
            <p className="text-center text-on-surface-variant text-sm">도우미 위치는 도우미가 «위치 함께 보기»를 켜면 보입니다.</p>
          )}
        </div>
      )}
      {d.past.length > 0 && (
        <details className="bg-surface-card rounded-card p-4">
          <summary className="font-semibold cursor-pointer">지난 기록 {d.past.length}건</summary>
          <ul className="mt-3 flex flex-col gap-2">
            {d.past.map((p) => (
              <li key={p.requestId} className="flex justify-between text-sm">
                <span>{day(p.createdAt)}{p.emergency ? ' · 위급' : ''}</span>
                <span className="text-on-surface-variant">{p.match?.status === 'completed' ? `마침 ${hm(p.match.completedAt)}` : p.state === 'cancelled' ? '닫힘' : '끝남'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export default function TgHome() {
  const { token } = useAuth();
  const [me, setMe] = useState<any>(null);
  useEffect(() => { if (token) api.get('/api/tg/me', token).then(setMe); }, [token]);
  if (!me) return <div className="min-h-screen flex items-center justify-center text-on-surface-variant">불러오는 중…</div>;
  return (
    <div className="min-h-screen max-w-md mx-auto px-5 py-8 break-keep">
      <h1 className="font-display text-2xl font-bold mb-6">온다</h1>
      {me.elders.length === 0 && <p className="text-on-surface-variant">연결된 어르신이 없습니다.</p>}
      {me.elders.map((e: any) => <Elder key={e.elderId} id={e.elderId} token={token!} />)}
      <p className="text-on-surface-variant text-base mt-2 leading-relaxed">도움이 필요하면 대화방 아래 «도와주세요» 큰 단추를 누르세요.</p>
    </div>
  );
}

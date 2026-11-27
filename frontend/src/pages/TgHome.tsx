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

type Circle = { family: number; helpers: number; malbeot: boolean };

// 지킴 원: 평소에는 집 창에 불이 켜진 그림(말벗이 곁에 있음), 출동 중에는 같은 원 안에 도우미 점이 집 쪽으로 다가온다.
// 지도 타일은 위치를 바깥 서버에 보내게 되므로 쓰지 않는다. 거리는 1.5km 까지 원 안에 줄여 그림.
function Ring({ near, tone, moving }: { near?: Now['near']; tone: 'calm' | 'wait' | 'go' | 'sos'; moving: boolean }) {
  const glow = { calm: '#E3A23B', wait: '#E3A23B', go: '#7FC3A3', sos: '#F08A73' }[tone];
  let dot: { x: number; y: number } | null = null;
  if (near) {
    const R = 96, r0 = 44, max = 1500, rr = r0 + Math.min(1, near.m / max) * (R - r0), k = rr / Math.max(1, Math.hypot(near.dx, near.dy));   // 가까워도 집 그림과 겹치지 않게 44px 부터
    dot = { x: 120 + near.dx * k, y: 120 - near.dy * k };
  }
  return (
    <svg viewBox="0 0 240 240" className="w-full max-w-[260px] mx-auto block" role="img"
      aria-label={near ? `도우미가 집에서 ${dist(near.m)}` : '집을 지키는 중'}>
      <defs>
        <radialGradient id="lamp" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={glow} stopOpacity=".55" />
          <stop offset="100%" stopColor={glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="120" cy="120" r="112" fill="none" stroke="#fff" strokeOpacity=".10" />
      <circle cx="120" cy="120" r="76" fill="none" stroke="#fff" strokeOpacity=".08" />
      <circle cx="120" cy="120" r="40" fill="none" stroke="#fff" strokeOpacity=".06" />
      <circle cx="120" cy="120" r="60" fill="url(#lamp)" className={moving ? '' : 'ring-breathe'} />
      {/* 집 */}
      <path d="M96 128 L120 106 L144 128 L144 150 L96 150 Z" fill="#F4F7F5" />
      <path d="M90 130 L120 102 L150 130" fill="none" stroke="#F4F7F5" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="112" y="128" width="16" height="13" rx="2" fill={glow} />
      {dot && (
        <>
          <line x1="120" y1="126" x2={dot.x} y2={dot.y} stroke={glow} strokeWidth="2" strokeDasharray="4 5" />
          <circle cx={dot.x} cy={dot.y} r="13" fill={glow} fillOpacity=".25" />
          <circle cx={dot.x} cy={dot.y} r="7" fill={glow} />
        </>
      )}
    </svg>
  );
}

const TONE: Record<string, 'calm' | 'wait' | 'go' | 'sos'> = {
  offering: 'wait', exhausted: 'wait', accepted: 'go', moving: 'go', arrived: 'go', in_progress: 'go', completed: 'calm',
};

function Elder({ id, token }: { id: string; token: string }) {
  const [d, setD] = useState<{ elder: { name: string }; circle?: Circle; now: Now | null; past: Now[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const f = () => api.get(`/api/tg/elders/${id}/now`, token).then((x: any) => (x.elder ? (setD(x), setErr('')) : setErr('어르신 정보를 받지 못했습니다. 잠시 뒤 다시 열어 주세요.'))).catch(() => setErr('연결이 끊겼습니다. 다시 잇는 중입니다.'));
    f(); const iv = setInterval(f, 5000); return () => clearInterval(iv);
  }, [id, token]);
  if (!d) return <div className="rounded-[28px] bg-primary text-on-primary/80 p-8 mb-4 text-center">{err || '어르신 소식을 받는 중…'}</div>;
  const n = d.now, c = d.circle;
  const name = String(d.elder.name || '').replace(/^가상\s*/, '');
  const st = n?.match?.status || n?.state || '';
  const tone = n?.emergency ? 'sos' : (TONE[st] || 'calm');
  const [txt] = BANNER[st] || [''];
  const at = n?.match ? { accepted: n.match.acceptedAt, arrived: n.match.arrivedAt, in_progress: n.match.startedAt, completed: n.match.completedAt } as Record<string, string | undefined> : {};
  const idx = STEPS.findIndex(([k]) => k === n?.match?.status);
  const headline = n ? txt : '오늘도 곁에서 지키고 있어요';
  const sub = n
    ? (n.near ? `${n.match?.helper} 도우미 · 집에서 약 ${dist(n.near.m)}` : n.match ? `${n.match.helper} 도우미가 맡았습니다 · ${hm(n.match.acceptedAt)}` : `부탁한 시각 ${hm(n.createdAt)}`)
    : c?.malbeot ? '말벗이 집 안을 살피고, 일이 생기면 가족과 가까운 도우미에게 바로 알립니다.' : '도움이 필요하면 가족과 가까운 도우미에게 바로 이어 드립니다.';
  const ringBg = { calm: 'bg-primary', wait: 'bg-[#3A2E12]', go: 'bg-primary', sos: 'bg-[#4A1A12]' }[tone];
  return (
    <section className="mb-8">
      <div className={`rounded-[28px] ${ringBg} text-on-primary px-6 pt-6 pb-7 transition-colors duration-700`}>
        <p className="text-on-primary/70 text-base">{name} 어르신 댁</p>
        <Ring near={n?.near} tone={tone} moving={!!n} />
        <h2 className="font-display text-[26px] leading-tight font-bold text-center mt-2">{headline}</h2>
        <p className="text-center text-on-primary/80 text-base mt-2 leading-relaxed">{sub}</p>
        {n?.emergency && (
          <a href="tel:119" className="mt-5 block bg-error text-white rounded-2xl py-4 text-center text-lg font-bold">🚑 위급합니다 — 119 에 먼저 전화하기</a>
        )}
      </div>

      {c && (
        <dl className="mt-4 grid grid-cols-3 bg-surface-card rounded-2xl text-center divide-x divide-surface-high">
          <div className="py-4 px-2">
            <dt className="text-sm text-on-surface-variant">말벗</dt>
            <dd className={`mt-1 text-lg font-bold ${c.malbeot ? 'text-trust-green' : 'text-on-surface-variant'}`}>{c.malbeot ? '지키는 중' : '연결 전'}</dd>
          </div>
          <div className="py-4 px-2">
            <dt className="text-sm text-on-surface-variant">가족</dt>
            <dd className="mt-1 text-lg font-bold">{c.family}명</dd>
          </div>
          <div className="py-4 px-2">
            <dt className="text-sm text-on-surface-variant">온다 도우미</dt>
            <dd className="mt-1 text-lg font-bold">{c.helpers}명</dd>
          </div>
        </dl>
      )}

      {n?.match && (
        <div className="mt-4 bg-surface-card rounded-2xl p-5">
          <ol className="flex justify-between text-center">
            {STEPS.map(([k, label], i) => (
              <li key={k} className="flex-1 relative">
                <div className={`mx-auto w-5 h-5 rounded-full mb-1.5 ${i <= idx ? 'bg-secondary' : 'bg-surface-high'}`} />
                <div className={`text-sm ${i <= idx ? 'font-bold' : 'text-on-surface-variant'}`}>{label}</div>
                <div className="text-xs text-on-surface-variant h-4">{hm(at[k])}</div>
              </li>
            ))}
          </ol>
          {!n.near && n.match.status !== 'completed' && (
            <p className="text-center text-on-surface-variant text-sm mt-3">도우미가 «위치 함께 보기»를 켜면 오는 길이 원 안에 보입니다.</p>
          )}
        </div>
      )}

      <div className="mt-4 bg-surface-card rounded-2xl p-5">
        <h3 className="font-bold text-lg">지난 소식</h3>
        {d.past.length === 0 ? (
          <p className="text-on-surface-variant text-base mt-2">아직 도움을 부른 일이 없습니다.</p>
        ) : (
          <ul className="mt-3 border-l-2 border-surface-high pl-4 flex flex-col gap-3">
            {d.past.map((p) => (
              <li key={p.requestId} className="relative">
                <span className={`absolute -left-[23px] top-1.5 w-3 h-3 rounded-full ${p.match?.status === 'completed' ? 'bg-secondary' : 'bg-surface-high'}`} />
                <p className="text-base font-semibold">{day(p.createdAt)}{p.emergency ? ' · 위급' : ''}</p>
                <p className="text-sm text-on-surface-variant">{p.match?.status === 'completed' ? `${p.match.helper} 도우미가 돌봄을 마침 ${hm(p.match.completedAt)}` : p.match ? `${p.match.helper} 도우미가 다녀감` : p.state === 'cancelled' ? '부탁을 닫음' : '마무리됨'}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function TgHome() {
  const { token } = useAuth();
  const [me, setMe] = useState<any>(null);
  useEffect(() => { if (token) api.get('/api/tg/me', token).then(setMe); }, [token]);
  if (!me) return <div className="min-h-screen flex items-center justify-center text-on-surface-variant">불러오는 중…</div>;
  return (
    <div className="min-h-screen max-w-md mx-auto px-4 pt-5 pb-10 break-keep">
      <style>{`@keyframes ringBreathe{0%,100%{opacity:.55;transform:scale(.92)}50%{opacity:1;transform:scale(1.06)}}.ring-breathe{transform-origin:120px 120px;animation:ringBreathe 4.5s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.ring-breathe{animation:none}}`}</style>
      {me.elders.length === 0 && (
        <div className="bg-surface-card rounded-2xl p-6 text-base leading-relaxed">아직 연결된 어르신이 없습니다. 담당 도우미에게 받은 가족 링크를 눌러 연결해 주세요.</div>
      )}
      {me.elders.map((e: any) => <Elder key={e.elderId} id={e.elderId} token={token!} />)}
      <div className="bg-surface-low rounded-2xl p-5 text-base leading-relaxed">
        <p className="font-bold">급할 때</p>
        <p className="text-on-surface-variant mt-1">이 화면을 닫고 텔레그램 «온다» 대화방 맨 아래, 글 쓰는 칸 밑의 <b className="text-on-surface">«🆘 어르신께 출동 부탁»</b> 단추를 누르면 가까운 도우미가 갑니다.</p>
        <p className="text-on-surface-variant mt-1">단추가 안 보이면 글 쓰는 칸 오른쪽의 <b className="text-on-surface">네모 네 칸(⌨)</b> 모양을 누르세요.</p>
        <p className="text-on-surface-variant mt-1">숨쉬기 힘들어하시거나 의식이 없으시면 먼저 <a href="tel:119" className="text-error font-bold underline">119</a>에 전화하세요.</p>
      </div>
    </div>
  );
}

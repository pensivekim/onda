// 온다 텔레그램판 — 어르신·가족 미니 앱 (/tg/home): 지금 상황만 크게. 부탁은 대화방의 큰 단추로.
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

const STATE: Record<string, string> = {
  offering: '🔔 가까운 도우미께 부탁하는 중', exhausted: '⏳ 도우미를 찾는 중 — 상황실이 연락드립니다',
  accepted: '✅ 도우미가 맡았습니다', done: '🙏 지난 돌봄을 마쳤습니다', cancelled: '지난 부탁은 닫혔습니다',
};
const STEP: Record<string, string> = { accepted: '곧 출발합니다', moving: '오는 중입니다', arrived: '도착했습니다', in_progress: '돌봄 중입니다', completed: '마쳤습니다' };

export default function TgHome() {
  const { token } = useAuth();
  const [me, setMe] = useState<any>(null);
  useEffect(() => {
    if (!token) return;
    const f = () => api.get('/api/tg/me', token).then(setMe);
    f(); const iv = setInterval(f, 10000); return () => clearInterval(iv);
  }, [token]);
  if (!me) return <div className="min-h-screen flex items-center justify-center text-on-surface-variant">불러오는 중…</div>;
  return (
    <div className="min-h-screen max-w-md mx-auto px-5 py-8 break-keep">
      <h1 className="font-display text-2xl font-bold mb-6">온다</h1>
      {me.elders.length === 0 && <p className="text-on-surface-variant">연결된 어르신이 없습니다.</p>}
      {me.elders.map((e: any) => (
        <div key={e.elderId} className="bg-surface-card rounded-card p-6 mb-4">
          <p className="font-display text-xl font-bold mb-3">{e.name} 어르신</p>
          {!e.last ? <p className="text-on-surface-variant text-lg">아직 부탁한 적이 없습니다.</p> : (
            <>
              <p className="text-xl font-semibold mb-1">{STATE[e.last.state] || e.last.state}</p>
              {e.last.notified && e.last.state !== 'done' && <p className="text-lg text-on-surface-variant">도우미가 {STEP[e.last.notified]}</p>}
              {e.last.emergency ? <p className="text-error font-bold mt-3">🚑 위급 — 119 에 먼저 전화하세요</p> : null}
            </>
          )}
        </div>
      ))}
      <p className="text-on-surface-variant text-base mt-6 leading-relaxed">도움이 필요하면 대화방 아래 «도와주세요» 큰 단추를 누르세요. 도우미 오는 길은 대화방 지도에서 보입니다.</p>
    </div>
  );
}

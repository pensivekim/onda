import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';
import StatusBadge from '../components/StatusBadge';

export default function ResponderHome() {
  const { user, token } = useAuth();
  const [responder, setResponder] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);

  const load = () => {
    if (!token) return;
    api.get('/api/responders/me', token).then((d: any) => { if (d.responder) setResponder(d.responder); });
  };

  useEffect(() => { load(); }, [token]);

  const toggleAvailable = async () => {
    if (!responder) return;
    const newVal = responder.available ? 0 : 1;
    await api.patch('/api/responders/available', { available: newVal }, token!);
    setResponder({ ...responder, available: newVal });
  };

  const accept = async (matchId: string) => {
    await api.post(`/api/matches/${matchId}/accept`, {}, token!);
    load();
  };

  const reject = async (matchId: string) => {
    await api.post(`/api/matches/${matchId}/reject`, {}, token!);
    load();
  };

  if (!responder) {
    return (
      <div className="min-h-screen">
        <NavBar />
        <div className="max-w-md mx-auto px-5 py-8 text-center">
          <div className="text-5xl mb-4">🏃</div>
          <h1 className="font-display text-xl font-bold mb-2">출동자 등록이 필요합니다</h1>
          <p className="text-on-surface-variant text-sm mb-6">출동자로 활동하려면 먼저 등록해주세요.</p>
          <button onClick={async () => {
            await api.post('/api/responders/register', { bio: '', phone: '' }, token!);
            load();
          }} className="bg-primary text-on-primary px-8 py-3 rounded-xl font-display font-bold">
            출동자 등록하기
          </button>
        </div>
      </div>
    );
  }

  if (responder.status === 'pending') {
    return (
      <div className="min-h-screen">
        <NavBar />
        <div className="max-w-md mx-auto px-5 py-8 text-center">
          <div className="text-5xl mb-4">⏳</div>
          <h1 className="font-display text-xl font-bold mb-2">승인 대기 중</h1>
          <p className="text-on-surface-variant text-sm">관리자가 검토 후 승인합니다. 잠시만 기다려주세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="max-w-md mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-xl font-bold">{user?.name} 출동자</h1>
            <p className="text-on-surface-variant text-sm">완료 {responder.total_done}건</p>
          </div>
          <button onClick={toggleAvailable}
            className={`px-5 py-2.5 rounded-full font-bold text-sm transition ${
              responder.available
                ? 'bg-trust-green text-white'
                : 'bg-surface-high text-on-surface-variant'
            }`}>
            {responder.available ? '대기 ON' : '대기 OFF'}
          </button>
        </div>

        <h2 className="font-display font-bold mb-3">수신된 요청</h2>
        {matches.length === 0 ? (
          <div className="bg-surface-low rounded-card p-8 text-center text-on-surface-variant text-sm">
            {responder.available ? '요청을 기다리는 중...' : '대기를 켜면 요청을 받을 수 있습니다'}
          </div>
        ) : matches.map((m: any) => (
          <div key={m.id} className="bg-surface-card rounded-card p-4 mb-3">
            <div className="flex items-center justify-between mb-2">
              <StatusBadge status={m.status} />
              <span className="text-xs text-on-surface-variant">{new Date(m.created_at).toLocaleString('ko-KR')}</span>
            </div>
            {m.status === 'offered' && (
              <div className="flex gap-2 mt-3">
                <button onClick={() => accept(m.id)} className="flex-1 py-2.5 bg-primary text-on-primary rounded-xl font-bold text-sm">수락</button>
                <button onClick={() => reject(m.id)} className="flex-1 py-2.5 bg-surface-high text-on-surface-variant rounded-xl font-bold text-sm">거절</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

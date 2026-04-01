import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';
import StatusBadge from '../components/StatusBadge';

const NEXT_STATUS: Record<string, { label: string; next: string }> = {
  accepted: { label: '이동 시작', next: 'moving' },
  moving: { label: '도착 완료', next: 'arrived' },
  arrived: { label: '돌봄 시작', next: 'in_progress' },
  in_progress: { label: '돌봄 완료', next: 'completed' },
};

export default function MatchDetail() {
  const { id } = useParams();
  const { token } = useAuth();
  const [match, setMatch] = useState<any>(null);
  const [elapsed, setElapsed] = useState('');

  const load = () => {
    if (token && id) {
      // Get match via dispatch status (using request_id from match)
      api.get(`/api/dispatch/${id}/status`, token).then((d: any) => {
        if (d.activeMatch) setMatch(d.activeMatch);
      });
    }
  };

  useEffect(() => { load(); }, [id, token]);

  // Timer for in_progress
  useEffect(() => {
    if (match?.status !== 'in_progress' || !match?.started_at) return;
    const interval = setInterval(() => {
      const mins = Math.floor((Date.now() - new Date(match.started_at).getTime()) / 60000);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      setElapsed(h > 0 ? `${h}시간 ${m}분` : `${m}분`);
    }, 1000);
    return () => clearInterval(interval);
  }, [match?.status, match?.started_at]);

  const updateStatus = async (next: string) => {
    if (!id || !token) return;
    await api.patch(`/api/matches/${id}/status`, { status: next }, token);
    load();
  };

  if (!match) return <div className="min-h-screen"><NavBar /><div className="p-8 text-center text-on-surface-variant">Loading...</div></div>;

  const action = NEXT_STATUS[match.status];

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="max-w-md mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-xl font-bold">출동 상세</h1>
          <StatusBadge status={match.status} />
        </div>

        <div className="bg-surface-card rounded-card p-5 mb-4">
          <p className="text-sm text-on-surface-variant">{match.address || '주소 정보 없음'}</p>
          {match.description && <p className="text-sm text-on-surface-variant mt-1">{match.description}</p>}
        </div>

        {match.status === 'in_progress' && elapsed && (
          <div className="bg-orange-grade-bg rounded-card p-5 mb-4 text-center">
            <p className="text-sm text-orange-grade font-medium">돌봄 진행 중</p>
            <p className="text-2xl font-display font-bold text-orange-grade mt-1">{elapsed}</p>
          </div>
        )}

        {match.status === 'completed' && match.amount && (
          <div className="bg-trust-green-bg rounded-card p-5 mb-4 text-center">
            <p className="text-sm text-trust-green font-medium">돌봄 완료</p>
            <p className="text-2xl font-display font-bold text-trust-green mt-1">{match.duration_min}분 / {match.amount.toLocaleString()}원</p>
          </div>
        )}

        {action && (
          <button onClick={() => updateStatus(action.next)}
            className="w-full py-4 rounded-xl bg-primary text-on-primary font-display font-bold text-lg mt-4"
            style={{ boxShadow: '0px 12px 32px rgba(183,16,42,0.2)' }}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

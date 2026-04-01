import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';
import StatusBadge from '../components/StatusBadge';

const STEPS = ['pending', 'accepted', 'moving', 'arrived', 'in_progress', 'completed'];
const STEP_LABELS = ['매칭중', '수락', '이동중', '도착', '돌봄중', '완료'];

export default function RequestStatus() {
  const { id } = useParams();
  const { token } = useAuth();
  const [data, setData] = useState<any>(null);

  const load = () => {
    if (token && id) api.get(`/api/dispatch/${id}/status`, token).then(setData);
  };

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [id, token]);

  if (!data) return <div className="min-h-screen"><NavBar /><div className="p-8 text-center text-on-surface-variant">Loading...</div></div>;

  const req = data.request;
  const match = data.activeMatch;
  const currentStep = match ? STEPS.indexOf(match.status) : (req.status === 'pending' ? 0 : -1);

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="max-w-md mx-auto px-5 py-8">
        <h1 className="font-display text-xl font-bold mb-6">요청 상태</h1>

        {/* Progress bar */}
        <div className="flex items-center gap-1 mb-8">
          {STEP_LABELS.map((label, i) => (
            <div key={i} className="flex-1 text-center">
              <div className={`h-2 rounded-full mb-1 ${i <= currentStep ? 'bg-primary' : 'bg-surface-high'}`} />
              <span className={`text-[10px] ${i <= currentStep ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}>{label}</span>
            </div>
          ))}
        </div>

        {/* Status card */}
        <div className="bg-surface-card rounded-card p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="font-display font-bold">{req.type === 'child' ? '아이 돌봄' : req.type === 'elder' ? '어르신 돌봄' : '돌봄 요청'}</span>
            <StatusBadge status={match?.status || req.status} />
          </div>
          <p className="text-sm text-on-surface-variant">{req.address}</p>
          {req.description && <p className="text-sm text-on-surface-variant mt-1">{req.description}</p>}
        </div>

        {/* Matched responder */}
        {match && (
          <div className="bg-trust-green-bg rounded-card p-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-trust-green/20 flex items-center justify-center text-trust-green font-bold text-lg">
                {(match.responder_name || '?')[0]}
              </div>
              <div>
                <div className="font-semibold">{match.responder_name}</div>
                <div className="text-xs text-on-surface-variant flex items-center gap-2">
                  <span className="text-trust-green">🟢 {match.grade || 'green'}</span>
                  {match.total_done > 0 && <span>출동 {match.total_done}회</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {!match && req.status === 'pending' && (
          <div className="bg-surface-low rounded-card p-8 text-center">
            <div className="text-3xl mb-2">🔍</div>
            <p className="text-on-surface-variant text-sm">주변 출동자를 찾고 있습니다...</p>
          </div>
        )}
      </div>
    </div>
  );
}

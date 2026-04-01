import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';
import StatusBadge from '../components/StatusBadge';
import ChatPanel from '../components/ChatPanel';
import ReviewPanel from '../components/ReviewPanel';
import { useLang } from '../i18n';

export default function MatchDetail() {
  const { id } = useParams();
  const { token } = useAuth();
  const { t } = useLang();
  const [match, setMatch] = useState<any>(null);
  const [elapsed, setElapsed] = useState('');

  const NEXT: Record<string, { label: string; next: string }> = {
    accepted: { label: t('startMoving'), next: 'moving' },
    moving: { label: t('arrivedBtn'), next: 'arrived' },
    arrived: { label: t('startCare'), next: 'in_progress' },
    in_progress: { label: t('completeCare'), next: 'completed' },
  };

  const load = () => { if (token && id) api.get(`/api/matches/${id}`, token).then((d: any) => { if (d.match) setMatch(d.match); }); };
  useEffect(() => { load(); }, [id, token]);

  useEffect(() => {
    if (match?.status !== 'in_progress' || !match?.started_at) return;
    const iv = setInterval(() => {
      const mins = Math.floor((Date.now() - new Date(match.started_at).getTime()) / 60000);
      const h = Math.floor(mins / 60), m = mins % 60;
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`);
    }, 1000);
    return () => clearInterval(iv);
  }, [match?.status, match?.started_at]);

  const updateStatus = async (next: string) => { if (id && token) { await api.patch(`/api/matches/${id}/status`, { status: next }, token); load(); } };

  if (!match) return <div className="min-h-screen"><NavBar /><div className="p-8 text-center text-on-surface-variant">Loading...</div></div>;
  const action = NEXT[match.status];

  return (
    <div className="min-h-screen"><NavBar />
      <div className="max-w-md mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-xl font-bold">{t('matchTitle')}</h1>
          <StatusBadge status={match.status} />
        </div>
        <div className="bg-surface-card rounded-card p-5 mb-4">
          <p className="text-sm text-on-surface-variant">{match.address || t('noAddress')}</p>
        </div>
        {match.status === 'in_progress' && elapsed && (
          <div className="bg-orange-grade-bg rounded-card p-5 mb-4 text-center">
            <p className="text-sm text-orange-grade font-medium">{t('careInProgress')}</p>
            <p className="text-2xl font-display font-bold text-orange-grade mt-1">{elapsed}</p>
          </div>
        )}
        {match.status === 'completed' && match.amount && (
          <div className="bg-trust-green-bg rounded-card p-5 mb-4 text-center">
            <p className="text-sm text-trust-green font-medium">{t('careCompleted')}</p>
            <p className="text-2xl font-display font-bold text-trust-green mt-1">{match.duration_min}min / {match.amount.toLocaleString()}KRW</p>
          </div>
        )}
        {action && (
          <button onClick={() => updateStatus(action.next)}
            className="w-full py-4 rounded-xl bg-primary text-on-primary font-display font-bold text-lg mt-4"
            style={{ boxShadow: '0px 12px 32px rgba(183,16,42,0.2)' }}>
            {action.label}
          </button>
        )}

        {/* Chat */}
        {['accepted','moving','arrived','in_progress'].includes(match.status) && (
          <div className="mt-4"><ChatPanel matchId={id!} /></div>
        )}

        {/* Review after completion */}
        {match.status === 'completed' && (
          <div className="mt-4"><ReviewPanel matchId={id!} /></div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';
import StatusBadge from '../components/StatusBadge';
import ChatPanel from '../components/ChatPanel';
import ReviewPanel from '../components/ReviewPanel';
import { useLang } from '../i18n';

const STEPS = ['pending', 'accepted', 'moving', 'arrived', 'in_progress', 'completed'];

export default function RequestStatus() {
  const { id } = useParams();
  const { token } = useAuth();
  const { t } = useLang();
  const [data, setData] = useState<any>(null);
  const STEP_LABELS = [t('stepMatching'), t('stepAccepted'), t('stepMoving'), t('stepArrived'), t('stepCaring'), t('stepDone')];

  const load = () => { if (token && id) api.get(`/api/dispatch/${id}/status`, token).then(setData); };
  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv); }, [id, token]);

  if (!data) return <div className="min-h-screen"><NavBar /><div className="p-8 text-center text-on-surface-variant">Loading...</div></div>;

  const req = data.request;
  const match = data.activeMatch;
  const currentStep = match ? STEPS.indexOf(match.status) : (req.status === 'pending' ? 0 : -1);

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="max-w-md mx-auto px-5 py-8">
        <h1 className="font-display text-xl font-bold mb-6">{t('statusTitle')}</h1>
        <div className="flex items-center gap-1 mb-8">
          {STEP_LABELS.map((label, i) => (
            <div key={i} className="flex-1 text-center">
              <div className={`h-2 rounded-full mb-1 ${i <= currentStep ? 'bg-primary' : 'bg-surface-high'}`} />
              <span className={`text-[10px] ${i <= currentStep ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}>{label}</span>
            </div>
          ))}
        </div>
        <div className="bg-surface-card rounded-card p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="font-display font-bold">{req.type === 'child' ? t('typeChild') : req.type === 'elder' ? t('typeElder') : t('typeOther')}</span>
            <StatusBadge status={match?.status || req.status} />
          </div>
          <p className="text-sm text-on-surface-variant">{req.address}</p>
          {req.description && <p className="text-sm text-on-surface-variant mt-1">{req.description}</p>}
        </div>
        {match && (
          <div className="bg-trust-green-bg rounded-card p-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-trust-green/20 flex items-center justify-center text-trust-green font-bold text-lg">
                {(match.responder_name || '?')[0]}
              </div>
              <div>
                <div className="font-semibold">{match.responder_name}</div>
                <div className="text-xs text-on-surface-variant flex items-center gap-2">
                  <span className={match.grade === 'orange' ? 'text-orange-grade' : match.grade === 'red' ? 'text-error' : 'text-trust-green'}>
                    {match.grade === 'orange' ? '🟠' : match.grade === 'red' ? '🔴' : '🟢'} {match.grade || 'green'}
                  </span>
                  {match.total_done > 0 && <span>{match.total_done}{t('done')}</span>}
                </div>
              </div>
            </div>
          </div>
        )}
        {!match && req.status === 'pending' && (
          <div className="bg-surface-low rounded-card p-8 text-center">
            <div className="text-3xl mb-2">🔍</div>
            <p className="text-on-surface-variant text-sm">{t('searching')}</p>
          </div>
        )}

        {/* Emergency SOS + Responder Location — during active dispatch */}
        {match && ['accepted','moving','arrived','in_progress'].includes(match.status) && (
          <div className="mt-4 flex gap-3">
            <a href="tel:112" className="flex-1 py-3 bg-error text-white rounded-xl font-bold text-center text-sm">
              🚨 {t('sos112')}
            </a>
            <button onClick={async () => {
              const d = await api.get(`/api/dispatch/${id}/responder-location`, token!);
              if (d.available) alert(`${t('sosResponderLoc')}: ${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}`);
            }} className="flex-1 py-3 bg-secondary-container text-secondary rounded-xl font-bold text-sm">
              📍 {t('sosResponderLoc')}
            </button>
          </div>
        )}

        {/* Chat — active matches only */}
        {match && ['accepted','moving','arrived','in_progress'].includes(match.status) && (
          <div className="mt-4"><ChatPanel matchId={match.id} /></div>
        )}

        {/* Review — completed matches */}
        {match?.status === 'completed' && (
          <div className="mt-4"><ReviewPanel matchId={match.id} /></div>
        )}
      </div>
    </div>
  );
}

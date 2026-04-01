import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';
import StatusBadge from '../components/StatusBadge';
import { useLang } from '../i18n';

export default function ResponderHome() {
  const { user, token } = useAuth();
  const { t } = useLang();
  const [responder, setResponder] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);

  const load = () => { if (token) api.get('/api/responders/me', token).then((d: any) => { if (d.responder) setResponder(d.responder); }); };
  useEffect(() => { load(); }, [token]);

  const toggleAvailable = async () => {
    if (!responder) return;
    await api.patch('/api/responders/available', { available: responder.available ? 0 : 1 }, token!);
    setResponder({ ...responder, available: responder.available ? 0 : 1 });
  };

  if (!responder) return (
    <div className="min-h-screen"><NavBar />
      <div className="max-w-md mx-auto px-5 py-8 text-center">
        <div className="text-5xl mb-4">🏃</div>
        <h1 className="font-display text-xl font-bold mb-2">{t('needRegister')}</h1>
        <p className="text-on-surface-variant text-sm mb-6">{t('needRegisterSub')}</p>
        <button onClick={async () => { await api.post('/api/responders/register', {}, token!); load(); }}
          className="bg-primary text-on-primary px-8 py-3 rounded-xl font-display font-bold">{t('registerBtn')}</button>
      </div>
    </div>
  );

  if (responder.status === 'pending') return (
    <div className="min-h-screen"><NavBar />
      <div className="max-w-md mx-auto px-5 py-8 text-center">
        <div className="text-5xl mb-4">⏳</div>
        <h1 className="font-display text-xl font-bold mb-2">{t('pendingApproval')}</h1>
        <p className="text-on-surface-variant text-sm">{t('pendingApprovalSub')}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen"><NavBar />
      <div className="max-w-md mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-xl font-bold">{user?.name} {t('responderTitle')}</h1>
            <p className="text-on-surface-variant text-sm">{t('stepDone')} {responder.total_done}{t('done')}</p>
          </div>
          <button onClick={toggleAvailable}
            className={`px-5 py-2.5 rounded-full font-bold text-sm transition ${responder.available ? 'bg-trust-green text-white' : 'bg-surface-high text-on-surface-variant'}`}>
            {responder.available ? t('availOn') : t('availOff')}
          </button>
        </div>
        <h2 className="font-display font-bold mb-3">{t('incomingRequests')}</h2>
        <div className="bg-surface-low rounded-card p-8 text-center text-on-surface-variant text-sm">
          {responder.available ? t('waitingRequests') : t('turnOnToReceive')}
        </div>
      </div>
    </div>
  );
}

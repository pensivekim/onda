import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';
import SOSButton from '../components/SOSButton';
import StatusBadge from '../components/StatusBadge';
import { useLang } from '../i18n';

export default function RequesterHome() {
  const { user, token } = useAuth();
  const { t } = useLang();
  const [requests, setRequests] = useState<any[]>([]);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    api.get('/api/requests/my', token).then((d: any) => setRequests(d.requests || []));
    api.get('/api/wallet/balance', token).then((d: any) => setBalance(d.balance || 0));
  }, [token]);

  const TYPE_LABELS: Record<string, string> = { child: t('typeChild'), elder: t('typeElder'), disabled: t('typeDisabled'), other: t('typeOther') };

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="max-w-md mx-auto px-5 py-8">
        <h1 className="font-display text-2xl font-bold mb-2">{user?.name}{t('hello')}</h1>
        <p className="text-on-surface-variant text-sm mb-10">{t('sosSub')}</p>
        {/* Wallet balance */}
        {balance !== null && (
          <Link to="/wallet" className="block bg-surface-card rounded-card p-4 mb-8 flex items-center justify-between">
            <div>
              <span className="text-xs text-on-surface-variant">{t('walletBalance')}</span>
              <p className="font-display font-bold text-lg">{balance.toLocaleString()}</p>
            </div>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${balance <= 10000 ? 'bg-error-container text-error' : 'bg-trust-green-bg text-trust-green'}`}>
              {balance <= 10000 ? t('walletLow') : t('walletOk')}
            </span>
          </Link>
        )}

        <SOSButton />
        <h2 className="font-display text-lg font-bold mt-12 mb-4">{t('recentRequests')}</h2>
        {requests.length === 0 ? (
          <div className="bg-surface-low rounded-card p-8 text-center text-on-surface-variant text-sm">{t('noRequests')}</div>
        ) : (
          <div className="flex flex-col gap-3">
            {requests.map((r: any) => (
              <a key={r.id} href={`/requester/status/${r.id}`} className="bg-surface-card rounded-card p-4 block">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm">{TYPE_LABELS[r.type] || r.type}</span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-xs text-on-surface-variant truncate">{r.address || r.description || '-'}</p>
                <p className="text-xs text-on-surface-variant mt-1">{new Date(r.created_at).toLocaleString('ko-KR')}</p>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

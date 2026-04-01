import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';
import { useLang } from '../i18n';

const CHARGE_OPTIONS = [50000, 100000, 200000, 500000];

export default function WalletPage() {
  const { token } = useAuth();
  const { t } = useLang();
  const [balance, setBalance] = useState(0);
  const [lowBalance, setLowBalance] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [chargeAmount, setChargeAmount] = useState(50000);
  const [charging, setCharging] = useState(false);
  const [chargeResult, setChargeResult] = useState<any>(null);

  const load = () => {
    if (!token) return;
    api.get('/api/wallet/balance', token).then((d: any) => {
      setBalance(d.balance || 0);
      setLowBalance(d.lowBalance || false);
    });
    api.get('/api/wallet/transactions', token).then((d: any) => setTransactions(d.transactions || []));
  };

  useEffect(() => { load(); }, [token]);

  const charge = async () => {
    setCharging(true);
    const d = await api.post('/api/wallet/charge', { amount: chargeAmount }, token!);
    setChargeResult(d);
    setCharging(false);
  };

  const TYPE_LABELS: Record<string, { label: string; color: string }> = {
    charge: { label: '충전', color: 'text-trust-green' },
    charge_pending: { label: '충전 대기', color: 'text-orange-grade' },
    deduct: { label: '사용', color: 'text-primary' },
    gov_deposit: { label: '지자체 지원', color: 'text-secondary' },
    sponsor_deposit: { label: '스폰서 지원', color: 'text-secondary' },
  };

  return (
    <div className="min-h-screen"><NavBar />
      <div className="max-w-md mx-auto px-5 py-8">
        {/* Balance card */}
        <div className="rounded-card p-6 mb-6 text-center text-white" style={{ background: 'linear-gradient(135deg, #b7102a, #db313f)' }}>
          <p className="text-sm opacity-80 mb-1">예치금 잔액</p>
          <p className="font-display text-4xl font-extrabold">{balance.toLocaleString()}<span className="text-lg ml-1">원</span></p>
          {lowBalance && (
            <p className="mt-2 text-xs bg-white/20 rounded-full px-3 py-1 inline-block">잔액이 부족합니다. 충전해주세요.</p>
          )}
        </div>

        {/* Charge section */}
        <div className="bg-surface-card rounded-card p-5 mb-6">
          <h2 className="font-display font-bold mb-3">예치금 충전</h2>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {CHARGE_OPTIONS.map(amt => (
              <button key={amt} onClick={() => setChargeAmount(amt)}
                className={`py-3 rounded-xl text-sm font-bold transition ${
                  chargeAmount === amt ? 'bg-primary text-on-primary' : 'bg-surface-low text-on-surface'}`}>
                {amt.toLocaleString()}원
              </button>
            ))}
          </div>
          <button onClick={charge} disabled={charging}
            className="w-full py-3.5 rounded-xl bg-primary text-on-primary font-display font-bold disabled:opacity-40">
            {charging ? '처리 중...' : `${chargeAmount.toLocaleString()}원 충전하기`}
          </button>

          {chargeResult && chargeResult.ok && (
            <div className="mt-4 bg-surface-low rounded-xl p-4 text-sm">
              <p className="font-semibold mb-2">계좌이체 안내</p>
              <p className="text-on-surface-variant">은행: {chargeResult.bankInfo.bank}</p>
              <p className="text-on-surface-variant">계좌: {chargeResult.bankInfo.account}</p>
              <p className="text-on-surface-variant">예금주: {chargeResult.bankInfo.holder}</p>
              <p className="text-on-surface-variant mt-2">입금 확인 후 충전이 완료됩니다.</p>
            </div>
          )}
        </div>

        {/* Transaction history */}
        <h2 className="font-display font-bold mb-3">거래 내역</h2>
        {transactions.length === 0 ? (
          <div className="bg-surface-low rounded-card p-8 text-center text-on-surface-variant text-sm">거래 내역이 없습니다</div>
        ) : (
          <div className="flex flex-col gap-2">
            {transactions.map((txn: any) => {
              const info = TYPE_LABELS[txn.type] || { label: txn.type, color: 'text-on-surface' };
              return (
                <div key={txn.id} className="bg-surface-card rounded-card p-4 flex items-center justify-between">
                  <div>
                    <span className={`text-sm font-semibold ${info.color}`}>{info.label}</span>
                    <p className="text-xs text-on-surface-variant mt-0.5">{new Date(txn.created_at).toLocaleString('ko-KR')}</p>
                  </div>
                  <span className={`font-display font-bold ${txn.amount >= 0 ? 'text-trust-green' : 'text-primary'}`}>
                    {txn.amount >= 0 ? '+' : ''}{txn.amount.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

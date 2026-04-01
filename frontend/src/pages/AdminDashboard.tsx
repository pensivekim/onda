import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';
import StatusBadge from '../components/StatusBadge';

type Tab = 'stats' | 'responders' | 'requests' | 'settlements';

export default function AdminDashboard() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>('stats');
  const [stats, setStats] = useState<any>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);

  const load = () => {
    if (!token) return;
    api.get('/api/admin/stats', token).then(setStats);
    api.get('/api/admin/responders/pending', token).then((d: any) => setPending(d.responders || []));
    api.get('/api/admin/requests?limit=20', token).then((d: any) => setRequests(d.requests || []));
    api.get('/api/admin/settlements/pending', token).then((d: any) => setSettlements(d.settlements || []));
  };

  useEffect(() => { load(); }, [token]);

  const approve = async (id: string) => { await api.patch(`/api/admin/responders/${id}/approve`, {}, token!); load(); };
  const suspend = async (id: string) => { await api.patch(`/api/admin/responders/${id}/suspend`, {}, token!); load(); };
  const pay = async (id: string) => { await api.patch(`/api/admin/settlements/${id}/pay`, {}, token!); load(); };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'stats', label: '통계' },
    { key: 'responders', label: '출동자 승인' },
    { key: 'requests', label: '요청 현황' },
    { key: 'settlements', label: '정산' },
  ];

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="max-w-2xl mx-auto px-5 py-6">
        <h1 className="font-display text-2xl font-bold mb-4">관리자 대시보드</h1>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition ${
                tab === t.key ? 'bg-primary text-on-primary' : 'bg-surface-low text-on-surface-variant'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Stats */}
        {tab === 'stats' && stats && (
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: '전체 사용자', value: stats.totalUsers },
              { label: '승인 출동자', value: stats.approvedResponders },
              { label: '승인 대기', value: stats.pendingResponders },
              { label: '오늘 요청', value: stats.requestsToday },
              { label: '오늘 완료', value: stats.completedToday },
            ].map((s, i) => (
              <div key={i} className="bg-surface-card rounded-card p-5 text-center">
                <div className="text-3xl font-display font-bold text-primary">{s.value}</div>
                <div className="text-xs text-on-surface-variant mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Pending Responders */}
        {tab === 'responders' && (
          <div className="flex flex-col gap-3">
            {pending.length === 0 ? (
              <div className="bg-surface-low rounded-card p-8 text-center text-on-surface-variant text-sm">승인 대기 중인 출동자가 없습니다</div>
            ) : pending.map((r: any) => (
              <div key={r.user_id} className="bg-surface-card rounded-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-semibold">{r.name}</span>
                    <span className="text-xs text-on-surface-variant ml-2">{r.phone}</span>
                  </div>
                  <StatusBadge status="pending" />
                </div>
                {r.bio && <p className="text-sm text-on-surface-variant mb-3">{r.bio}</p>}
                <div className="flex gap-2">
                  <button onClick={() => approve(r.user_id)} className="flex-1 py-2 bg-trust-green text-white rounded-xl text-sm font-bold">승인</button>
                  <button onClick={() => suspend(r.user_id)} className="flex-1 py-2 bg-surface-high text-on-surface-variant rounded-xl text-sm font-bold">거절</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Requests */}
        {tab === 'requests' && (
          <div className="flex flex-col gap-3">
            {requests.map((r: any) => (
              <div key={r.id} className="bg-surface-card rounded-card p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">{r.requester_name || '요청자'}</span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-xs text-on-surface-variant">{r.address || r.description || '-'}</p>
                <p className="text-xs text-on-surface-variant mt-1">{new Date(r.created_at).toLocaleString('ko-KR')}</p>
              </div>
            ))}
          </div>
        )}

        {/* Settlements */}
        {tab === 'settlements' && (
          <div className="flex flex-col gap-3">
            {settlements.length === 0 ? (
              <div className="bg-surface-low rounded-card p-8 text-center text-on-surface-variant text-sm">정산 대기 건이 없습니다</div>
            ) : settlements.map((s: any) => (
              <div key={s.id} className="bg-surface-card rounded-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold">{s.responder_name}</span>
                  <span className="font-display font-bold text-primary">{(s.net_amount || 0).toLocaleString()}원</span>
                </div>
                <p className="text-xs text-on-surface-variant">수수료 {(s.fee || 0).toLocaleString()}원 / 총액 {(s.amount || 0).toLocaleString()}원</p>
                <button onClick={() => pay(s.id)} className="mt-3 w-full py-2 bg-primary text-on-primary rounded-xl text-sm font-bold">정산 처리</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';
import StatusBadge from '../components/StatusBadge';
import { useLang } from '../i18n';

type Tab = 'stats' | 'responders' | 'licenses' | 'safety' | 'requests' | 'settlements' | 'gov' | 'sponsors';

const LICENSE_LABELS: Record<string, string> = {
  nurse: '간호사', doctor: '의사', emt: '응급구조사',
  caregiver: '요양보호사', social_worker: '사회복지사', childcare_teacher: '보육교사',
};

export default function AdminDashboard() {
  const { token } = useAuth();
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>('stats');
  const [stats, setStats] = useState<any>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);
  const [govContracts, setGovContracts] = useState<any[]>([]);
  const [sponsors, setSponsors] = useState<any[]>([]);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [warnedResponders, setWarnedResponders] = useState<any[]>([]);
  const [impact, setImpact] = useState<any>(null);

  const load = () => {
    if (!token) return;
    api.get('/api/admin/stats', token).then(setStats);
    api.get('/api/admin/responders/pending', token).then((d: any) => setPending(d.responders || []));
    api.get('/api/admin/licenses/pending', token).then((d: any) => setLicenses(d.licenses || []));
    api.get('/api/admin/requests?limit=20', token).then((d: any) => setRequests(d.requests || []));
    api.get('/api/admin/settlements/pending', token).then((d: any) => setSettlements(d.settlements || []));
    api.get('/api/admin/gov-contracts', token).then((d: any) => setGovContracts(d.contracts || []));
    api.get('/api/admin/sponsors', token).then((d: any) => setSponsors(d.sponsors || []));
    api.get('/api/admin/complaints?status=pending', token).then((d: any) => setComplaints(d.complaints || []));
    api.get('/api/admin/responders/warned', token).then((d: any) => setWarnedResponders(d.responders || []));
    api.get('/api/public/impact').then(setImpact);
  };
  useEffect(() => { load(); }, [token]);

  const approve = async (id: string) => { await api.patch(`/api/admin/responders/${id}/approve`, {}, token!); load(); };
  const suspendR = async (id: string) => { await api.patch(`/api/admin/responders/${id}/suspend`, {}, token!); load(); };
  const pay = async (id: string) => { await api.patch(`/api/admin/settlements/${id}/pay`, {}, token!); load(); };
  const resolveComplaint = async (id: string, action: string) => { await api.patch(`/api/admin/complaints/${id}/resolve`, { action }, token!); load(); };
  const reinstateResponder = async (id: string) => { await api.patch(`/api/admin/responders/${id}/reinstate`, {}, token!); load(); };
  const verifyLicense = async (id: string) => { await api.patch(`/api/admin/licenses/${id}/verify`, {}, token!); load(); };
  const rejectLicense = async (id: string) => { await api.patch(`/api/admin/licenses/${id}/reject`, {}, token!); load(); };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'stats', label: t('tabStats') },
    { key: 'responders', label: t('tabResponders') },
    { key: 'licenses', label: '면허검증' },
    { key: 'safety', label: '안전관리' },
    { key: 'requests', label: t('tabRequests') },
    { key: 'settlements', label: t('tabSettlements') },
    { key: 'gov', label: '지자체' },
    { key: 'sponsors', label: '스폰서' },
  ];

  return (
    <div className="min-h-screen"><NavBar />
      <div className="max-w-2xl mx-auto px-5 py-6">
        <h1 className="font-display text-2xl font-bold mb-4">{t('adminTitle')}</h1>
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {TABS.map(tb => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition ${tab === tb.key ? 'bg-primary text-on-primary' : 'bg-surface-low text-on-surface-variant'}`}>
              {tb.label}
            </button>
          ))}
        </div>

        {/* Stats */}
        {tab === 'stats' && stats && (
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: t('totalUsers'), value: stats.totalUsers },
              { label: t('approvedResponders'), value: stats.approvedResponders },
              { label: t('pendingResponders'), value: stats.pendingResponders },
              { label: t('requestsToday'), value: stats.requestsToday },
              { label: t('completedToday'), value: stats.completedToday },
              { label: '경고 출동자', value: stats.warnedResponders || 0 },
              { label: '정지 출동자', value: stats.suspendedResponders || 0 },
              { label: '민원 대기', value: stats.pendingComplaints || 0 },
            ].map((s, i) => (
              <div key={i} className="bg-surface-card rounded-card p-5 text-center">
                <div className="text-3xl font-display font-bold text-primary">{s.value}</div>
                <div className="text-xs text-on-surface-variant mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Responders */}
        {tab === 'responders' && (
          <div className="flex flex-col gap-3">
            {pending.length === 0 ? <div className="bg-surface-low rounded-card p-8 text-center text-on-surface-variant text-sm">{t('noPending')}</div>
            : pending.map((r: any) => (
              <div key={r.user_id} className="bg-surface-card rounded-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-semibold">{r.name}</span>
                    <span className={`ml-2 text-xs ${r.grade === 'red' ? 'text-error' : r.grade === 'orange' ? 'text-orange-grade' : 'text-trust-green'}`}>
                      {r.grade === 'red' ? '🔴' : r.grade === 'orange' ? '🟠' : '🟢'} {r.grade}
                    </span>
                  </div>
                  <StatusBadge status="pending" />
                </div>
                {r.bio && <p className="text-xs text-on-surface-variant mb-2">{r.bio}</p>}
                <div className="flex gap-2">
                  <button onClick={() => approve(r.user_id)} className="flex-1 py-2 bg-trust-green text-white rounded-xl text-sm font-bold">{t('approve')}</button>
                  <button onClick={() => suspendR(r.user_id)} className="flex-1 py-2 bg-surface-high text-on-surface-variant rounded-xl text-sm font-bold">{t('suspend')}</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* License Verification */}
        {tab === 'licenses' && (
          <div className="flex flex-col gap-3">
            {licenses.length === 0 ? <div className="bg-surface-low rounded-card p-8 text-center text-on-surface-variant text-sm">검증 대기 면허가 없습니다</div>
            : licenses.map((l: any) => (
              <div key={l.id} className="bg-surface-card rounded-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-semibold">{l.responder_name}</span>
                    <span className={`ml-2 text-xs ${l.grade === 'red' ? 'text-error' : 'text-orange-grade'}`}>
                      {l.grade === 'red' ? '🔴' : '🟠'} {l.grade}
                    </span>
                  </div>
                  <span className="text-xs bg-secondary-container text-secondary px-2 py-1 rounded-full">{LICENSE_LABELS[l.license_type] || l.license_type}</span>
                </div>
                {l.license_number && <p className="text-xs text-on-surface-variant mb-2">면허번호: {l.license_number}</p>}
                {l.license_photo_url && <img src={l.license_photo_url} alt="license" className="w-full rounded-lg mb-2 max-h-40 object-cover"/>}
                <div className="flex gap-2">
                  <button onClick={() => verifyLicense(l.id)} className="flex-1 py-2 bg-trust-green text-white rounded-xl text-sm font-bold">검증 승인</button>
                  <button onClick={() => rejectLicense(l.id)} className="flex-1 py-2 bg-surface-high text-on-surface-variant rounded-xl text-sm font-bold">거부</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Safety Management */}
        {tab === 'safety' && (
          <div className="flex flex-col gap-4">
            <h3 className="font-display font-bold">민원 대기 ({complaints.length}건)</h3>
            {complaints.length === 0 ? <div className="bg-surface-low rounded-card p-6 text-center text-on-surface-variant text-sm">대기 중인 민원이 없습니다</div>
            : complaints.map((co: any) => (
              <div key={co.id} className="bg-surface-card rounded-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm">{co.reporter_name} → {co.target_name}</span>
                  <span className="text-xs bg-error-container text-error px-2 py-0.5 rounded-full">{co.reason}</span>
                </div>
                {co.detail && <p className="text-xs text-on-surface-variant mb-3">{co.detail}</p>}
                <div className="flex gap-2">
                  <button onClick={() => resolveComplaint(co.id, 'dismissed')} className="flex-1 py-2 bg-surface-high text-on-surface-variant rounded-xl text-xs font-bold">기각</button>
                  <button onClick={() => resolveComplaint(co.id, 'warning')} className="flex-1 py-2 bg-orange-grade-bg text-orange-grade rounded-xl text-xs font-bold">경고</button>
                  <button onClick={() => resolveComplaint(co.id, 'suspended')} className="flex-1 py-2 bg-error-container text-error rounded-xl text-xs font-bold">정지</button>
                </div>
              </div>
            ))}

            <h3 className="font-display font-bold mt-4">경고/정지 출동자 ({warnedResponders.length}명)</h3>
            {warnedResponders.length === 0 ? <div className="bg-surface-low rounded-card p-6 text-center text-on-surface-variant text-sm">경고/정지된 출동자가 없습니다</div>
            : warnedResponders.map((r: any) => (
              <div key={r.user_id} className="bg-surface-card rounded-card p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold">{r.name}</span>
                  <div className="flex items-center gap-2">
                    {r.warning_count > 0 && <span className="text-xs bg-orange-grade-bg text-orange-grade px-2 py-0.5 rounded-full">경고 {r.warning_count}회</span>}
                    {r.status === 'suspended' && <span className="text-xs bg-error-container text-error px-2 py-0.5 rounded-full">정지</span>}
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant">평점 {r.rating || '-'} / 완료 {r.total_done}건</p>
                {r.suspended_reason && <p className="text-xs text-error mt-1">사유: {r.suspended_reason}</p>}
                {r.status === 'suspended' && (
                  <button onClick={() => reinstateResponder(r.user_id)} className="mt-2 w-full py-2 bg-trust-green text-white rounded-xl text-xs font-bold">정지 해제</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Requests */}
        {tab === 'requests' && requests.map((r: any) => (
          <div key={r.id} className="bg-surface-card rounded-card p-4 mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-sm">{r.requester_name || '-'}</span>
              <StatusBadge status={r.status} />
            </div>
            <p className="text-xs text-on-surface-variant">{r.address || r.description || '-'}</p>
            {r.source === 'hi_webhook' && <span className="text-[10px] bg-error-container text-error px-2 py-0.5 rounded-full mt-1 inline-block">hi.genomic.cc</span>}
          </div>
        ))}

        {/* Settlements */}
        {tab === 'settlements' && (
          <div className="flex flex-col gap-3">
            {settlements.length === 0 ? <div className="bg-surface-low rounded-card p-8 text-center text-on-surface-variant text-sm">{t('noSettlements')}</div>
            : settlements.map((s: any) => (
              <div key={s.id} className="bg-surface-card rounded-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold">{s.responder_name}</span>
                  <span className="font-display font-bold text-primary">{(s.net_amount || 0).toLocaleString()}KRW</span>
                </div>
                <p className="text-xs text-on-surface-variant">{t('fee')} {(s.fee || 0).toLocaleString()} / {t('total')} {(s.amount || 0).toLocaleString()}</p>
                <button onClick={() => pay(s.id)} className="mt-3 w-full py-2 bg-primary text-on-primary rounded-xl text-sm font-bold">{t('payBtn')}</button>
              </div>
            ))}
          </div>
        )}

        {/* Gov Contracts */}
        {tab === 'gov' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-on-surface-variant mb-2">지자체와 계약하면 취약계층이 무료로 온다 서비스를 이용하고, 지자체가 대납합니다.</p>
            {govContracts.length === 0 ? <div className="bg-surface-low rounded-card p-8 text-center text-on-surface-variant text-sm">등록된 지자체 계약이 없습니다</div>
            : govContracts.map((g: any) => (
              <div key={g.id} className="bg-surface-card rounded-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-display font-bold">{g.gov_name}</span>
                  <span className="text-xs text-on-surface-variant">{g.region}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-surface-low rounded-lg p-2">
                    <div className="font-bold text-primary">{(g.budget / 10000).toLocaleString()}만원</div>
                    <div className="text-on-surface-variant">예산</div>
                  </div>
                  <div className="bg-surface-low rounded-lg p-2">
                    <div className="font-bold text-orange-grade">{(g.spent / 10000).toLocaleString()}만원</div>
                    <div className="text-on-surface-variant">사용</div>
                  </div>
                  <div className="bg-surface-low rounded-lg p-2">
                    <div className="font-bold">{g.used_requests_month}/{g.max_requests_month}</div>
                    <div className="text-on-surface-variant">이번달</div>
                  </div>
                </div>
                <StatusBadge status={g.status} />
              </div>
            ))}
          </div>
        )}

        {/* Sponsors */}
        {tab === 'sponsors' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-on-surface-variant mb-2">기업 CSR 예산으로 지역 긴급 돌봄을 후원합니다.</p>
            {sponsors.length === 0 ? <div className="bg-surface-low rounded-card p-8 text-center text-on-surface-variant text-sm">등록된 스폰서가 없습니다</div>
            : sponsors.map((s: any) => (
              <div key={s.id} className="bg-surface-card rounded-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-display font-bold">{s.company_name}</span>
                  <span className="text-xs text-on-surface-variant">{s.region}</span>
                </div>
                {s.message && <p className="text-xs text-on-surface-variant mb-2 italic">"{s.message}"</p>}
                <div className="flex gap-2 text-center text-xs">
                  <div className="flex-1 bg-surface-low rounded-lg p-2">
                    <div className="font-bold text-primary">{(s.budget / 10000).toLocaleString()}만원</div>
                    <div className="text-on-surface-variant">후원 예산</div>
                  </div>
                  <div className="flex-1 bg-surface-low rounded-lg p-2">
                    <div className="font-bold text-orange-grade">{(s.spent / 10000).toLocaleString()}만원</div>
                    <div className="text-on-surface-variant">사용</div>
                  </div>
                </div>
              </div>
            ))}

            {/* Impact (KBS marketing data) */}
            {impact?.stats && (
              <div className="bg-surface-card rounded-card p-5 mt-4">
                <h3 className="font-display font-bold mb-3">온다 임팩트 (KBS 마케팅용)</h3>
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="bg-surface-low rounded-lg p-2"><div className="font-bold text-lg">{impact.stats.completedCare}</div>돌봄 완료</div>
                  <div className="bg-surface-low rounded-lg p-2"><div className="font-bold text-lg">{impact.stats.verifiedHelpers}</div>검증 출동자</div>
                  <div className="bg-surface-low rounded-lg p-2"><div className="font-bold text-lg">{impact.stats.averageRating}</div>평균 평점</div>
                  <div className="bg-surface-low rounded-lg p-2"><div className="font-bold text-lg">{impact.stats.govPartnerships + impact.stats.corporateSponsors}</div>파트너</div>
                </div>
                <p className="text-[10px] text-on-surface-variant mt-2 text-center">
                  API: onda-backend.pensive-kim.workers.dev/api/public/impact
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

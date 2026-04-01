import { useEffect, useState, useRef } from 'react';
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
  const [regForm, setRegForm] = useState({ bio: '', phone: '', grade: 'green', criminalCheck: false, sexOffenderCheck: false, serviceOath: false });
  const [certFile, setCertFile] = useState<File | null>(null);
  const [registering, setRegistering] = useState(false);
  const watchRef = useRef<number | null>(null);

  const load = () => {
    if (!token) return;
    api.get('/api/responders/me', token).then((d: any) => { if (d.responder) setResponder(d.responder); });
    api.get('/api/matches/offered', token).then((d: any) => setMatches(d.matches || []));
  };
  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv); }, [token]);

  // Auto-send location when available
  useEffect(() => {
    if (!responder?.available || !token) {
      if (watchRef.current !== null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
      return;
    }
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => { api.patch('/api/responders/location', { lat: pos.coords.latitude, lng: pos.coords.longitude }, token); },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
    return () => { if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current); };
  }, [responder?.available, token]);

  const toggleAvailable = async () => {
    if (!responder) return;
    const newVal = responder.available ? 0 : 1;
    await api.patch('/api/responders/available', { available: newVal }, token!);
    setResponder({ ...responder, available: newVal });
  };

  const register = async () => {
    setRegistering(true);
    await api.post('/api/responders/register', {
      bio: regForm.bio, phone: regForm.phone, grade: regForm.grade,
      criminalCheckAgreed: regForm.criminalCheck, sexOffenderCheckAgreed: regForm.sexOffenderCheck, serviceOathAgreed: regForm.serviceOath,
    }, token!);
    // Upload cert photo if selected
    if (certFile) {
      const fd = new FormData();
      fd.append('file', certFile);
      await fetch(`${api.API_URL}/api/responders/upload-cert`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd,
      });
    }
    setRegistering(false);
    load();
  };

  // Not registered
  if (!responder) return (
    <div className="min-h-screen"><NavBar />
      <div className="max-w-md mx-auto px-5 py-8">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🏃</div>
          <h1 className="font-display text-xl font-bold mb-2">{t('needRegister')}</h1>
          <p className="text-on-surface-variant text-sm">{t('needRegisterSub')}</p>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-sm font-semibold text-on-surface-variant mb-1 block">출동자 등급</label>
            <select value={regForm.grade} onChange={e => setRegForm({ ...regForm, grade: e.target.value })}
              className="w-full p-3.5 rounded-xl bg-surface-low text-on-surface outline-none">
              <option value="green">🟢 그린 — 검증된 시민 (시급 25,000원)</option>
              <option value="orange">🟠 오렌지 — 요양보호사/사회복지사/보육교사 (시급 40,000원)</option>
              <option value="red">🔴 레드 — 의사/간호사/응급구조사 (시급 80,000원)</option>
            </select>
            {(regForm.grade === 'orange' || regForm.grade === 'red') && (
              <p className={`text-xs mt-1 ${regForm.grade === 'red' ? 'text-error' : 'text-orange-grade'}`}>
                {regForm.grade === 'red' ? '의료 면허증 사진 업로드가 필요합니다' : '자격증 사진 업로드가 필요합니다'}
              </p>
            )}
          </div>
          <input value={regForm.phone} onChange={e => setRegForm({ ...regForm, phone: e.target.value })}
            placeholder="전화번호" type="tel"
            className="w-full p-3.5 rounded-xl bg-surface-low text-on-surface outline-none focus:ring-2 focus:ring-primary/30"/>
          <textarea value={regForm.bio} onChange={e => setRegForm({ ...regForm, bio: e.target.value })}
            placeholder="자기소개 (경력, 자격증 등)" rows={3}
            className="w-full p-3.5 rounded-xl bg-surface-low text-on-surface outline-none resize-none focus:ring-2 focus:ring-primary/30"/>
          <div>
            <label className="text-sm font-semibold text-on-surface-variant mb-1 block">자격증/신분증 사진</label>
            <input type="file" accept="image/*" onChange={e => setCertFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-on-surface-variant file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-surface-low file:text-on-surface file:font-semibold file:cursor-pointer"/>
          </div>
          <div className="bg-surface-low rounded-xl p-4 flex flex-col gap-3">
            <p className="text-sm font-semibold text-on-surface">안전 검증 동의 (필수)</p>
            <label className="flex items-start gap-2 text-xs text-on-surface-variant cursor-pointer">
              <input type="checkbox" checked={regForm.criminalCheck} onChange={e => setRegForm({...regForm, criminalCheck: e.target.checked})}
                className="mt-0.5 w-4 h-4 accent-primary"/>
              범죄경력 조회에 동의합니다
            </label>
            <label className="flex items-start gap-2 text-xs text-on-surface-variant cursor-pointer">
              <input type="checkbox" checked={regForm.sexOffenderCheck} onChange={e => setRegForm({...regForm, sexOffenderCheck: e.target.checked})}
                className="mt-0.5 w-4 h-4 accent-primary"/>
              성범죄 경력 조회에 동의합니다
            </label>
            <label className="flex items-start gap-2 text-xs text-on-surface-variant cursor-pointer">
              <input type="checkbox" checked={regForm.serviceOath} onChange={e => setRegForm({...regForm, serviceOath: e.target.checked})}
                className="mt-0.5 w-4 h-4 accent-primary"/>
              아동·노인 돌봄 서비스 서약서에 동의합니다
            </label>
          </div>
          <button onClick={register} disabled={registering || !regForm.phone || !regForm.criminalCheck || !regForm.sexOffenderCheck || !regForm.serviceOath}
            className="w-full py-3.5 rounded-xl bg-primary text-on-primary font-display font-bold disabled:opacity-40">
            {registering ? '등록 중...' : t('registerBtn')}
          </button>
        </div>
      </div>
    </div>
  );

  // Pending approval
  if (responder.status === 'pending') return (
    <div className="min-h-screen"><NavBar />
      <div className="max-w-md mx-auto px-5 py-8 text-center">
        <div className="text-5xl mb-4">⏳</div>
        <h1 className="font-display text-xl font-bold mb-2">{t('pendingApproval')}</h1>
        <p className="text-on-surface-variant text-sm">{t('pendingApprovalSub')}</p>
      </div>
    </div>
  );

  // Active responder
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
        {matches.length === 0 ? (
          <div className="bg-surface-low rounded-card p-8 text-center text-on-surface-variant text-sm">
            {responder.available ? t('waitingRequests') : t('turnOnToReceive')}
          </div>
        ) : matches.map((m: any) => (
          <div key={m.id} className="bg-surface-card rounded-card p-4 mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm">{m.requester_name || 'Requester'}</span>
              <StatusBadge status={m.status} />
            </div>
            <p className="text-xs text-on-surface-variant">{m.address || m.description || '-'}</p>
            {m.urgency === 'emergency' && <span className="text-xs bg-error-container text-error px-2 py-0.5 rounded-full mt-1 inline-block">Emergency</span>}
            {m.status === 'offered' && (
              <div className="flex gap-2 mt-3">
                <button onClick={async () => { await api.post(`/api/matches/${m.id}/accept`, {}, token!); load(); }}
                  className="flex-1 py-2.5 bg-primary text-on-primary rounded-xl font-bold text-sm">{t('accept')}</button>
                <button onClick={async () => { await api.post(`/api/matches/${m.id}/reject`, {}, token!); load(); }}
                  className="flex-1 py-2.5 bg-surface-high text-on-surface-variant rounded-xl font-bold text-sm">{t('reject')}</button>
              </div>
            )}
            {['accepted','moving','arrived','in_progress'].includes(m.status) && (
              <a href={`/responder/match/${m.id}`} className="block mt-3 text-center text-sm text-primary font-semibold">View Details</a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

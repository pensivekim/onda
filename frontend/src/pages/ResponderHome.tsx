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
  const [regForm, setRegForm] = useState({ bio: '', phone: '' });
  const [certFile, setCertFile] = useState<File | null>(null);
  const [registering, setRegistering] = useState(false);
  const watchRef = useRef<number | null>(null);

  const load = () => { if (token) api.get('/api/responders/me', token).then((d: any) => { if (d.responder) setResponder(d.responder); }); };
  useEffect(() => { load(); }, [token]);

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
    await api.post('/api/responders/register', { bio: regForm.bio, phone: regForm.phone }, token!);
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
          <button onClick={register} disabled={registering || !regForm.phone}
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
        <div className="bg-surface-low rounded-card p-8 text-center text-on-surface-variant text-sm">
          {responder.available ? t('waitingRequests') : t('turnOnToReceive')}
        </div>
      </div>
    </div>
  );
}

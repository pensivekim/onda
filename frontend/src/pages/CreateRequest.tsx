import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';
import { useLang } from '../i18n';

export default function CreateRequest() {
  const { token } = useAuth();
  const nav = useNavigate();
  const { t } = useLang();
  const [form, setForm] = useState({ type: 'child', address: '', description: '', urgency: 'normal', lat: 0, lng: 0 });
  const [loading, setLoading] = useState(false);
  const [locStatus, setLocStatus] = useState('');

  // Auto-detect location on mount
  useEffect(() => {
    if (!navigator.geolocation) return;
    setLocStatus('위치 감지 중...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm(f => ({ ...f, lat: pos.coords.latitude, lng: pos.coords.longitude }));
        setLocStatus(`위치 감지 완료 (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`);
      },
      () => setLocStatus('위치 감지 실패 — 주소를 직접 입력해주세요'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const submit = async () => {
    if (!form.address) return;
    setLoading(true);
    const d = await api.post('/api/dispatch/create', form, token!);
    if (d.requestId) nav(`/requester/status/${d.requestId}`);
    setLoading(false);
  };

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="max-w-md mx-auto px-5 py-8">
        <h1 className="font-display text-2xl font-bold mb-6">{t('createTitle')}</h1>
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-semibold text-on-surface-variant mb-1 block">{t('typeLabel')}</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
              className="w-full p-3.5 rounded-xl bg-surface-low text-on-surface font-body outline-none focus:ring-2 focus:ring-primary/30">
              <option value="child">{t('typeChild')}</option>
              <option value="elder">{t('typeElder')}</option>
              <option value="disabled">{t('typeDisabled')}</option>
              <option value="other">{t('typeOther')}</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold text-on-surface-variant mb-1 block">{t('addressLabel')}</label>
            <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
              placeholder={t('addressPlaceholder')}
              className="w-full p-3.5 rounded-xl bg-surface-low text-on-surface font-body outline-none focus:ring-2 focus:ring-primary/30"/>
            {locStatus && <p className="text-xs text-on-surface-variant mt-1">{locStatus}</p>}
          </div>
          <div>
            <label className="text-sm font-semibold text-on-surface-variant mb-1 block">{t('descLabel')}</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder={t('descPlaceholder')} rows={3}
              className="w-full p-3.5 rounded-xl bg-surface-low text-on-surface font-body outline-none resize-none focus:ring-2 focus:ring-primary/30"/>
          </div>
          <div>
            <label className="text-sm font-semibold text-on-surface-variant mb-1 block">{t('urgencyLabel')}</label>
            <select value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value })}
              className="w-full p-3.5 rounded-xl bg-surface-low text-on-surface font-body outline-none focus:ring-2 focus:ring-primary/30">
              <option value="normal">{t('urgencyNormal')}</option>
              <option value="urgent">{t('urgencyUrgent')}</option>
              <option value="emergency">{t('urgencyEmergency')}</option>
            </select>
          </div>
          <button onClick={submit} disabled={loading || !form.address}
            className="w-full py-4 rounded-xl bg-primary text-on-primary font-display font-bold text-lg mt-4 disabled:opacity-40"
            style={{ boxShadow: '0px 12px 32px rgba(183,16,42,0.2)' }}>
            {loading ? t('submitting') : t('submitRequest')}
          </button>
        </div>
      </div>
    </div>
  );
}

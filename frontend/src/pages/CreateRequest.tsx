import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';
import { useLang } from '../i18n';

interface TriageResult {
  grade: string; urgency: string; reason: string; call119: boolean; advice: string;
}

const GRADE_STYLES: Record<string, { bg: string; text: string; emoji: string; label: string }> = {
  green: { bg: 'bg-trust-green-bg', text: 'text-trust-green', emoji: '🟢', label: 'Green (Verified Citizen)' },
  orange: { bg: 'bg-orange-grade-bg', text: 'text-orange-grade', emoji: '🟠', label: 'Orange (Professional)' },
  red: { bg: 'bg-error-container', text: 'text-error', emoji: '🔴', label: 'Red (Medical)' },
};

export default function CreateRequest() {
  const { token } = useAuth();
  const nav = useNavigate();
  const { t } = useLang();
  const [form, setForm] = useState({ type: 'child', address: '', description: '', urgency: 'normal', lat: 0, lng: 0 });
  const [loading, setLoading] = useState(false);
  const [locStatus, setLocStatus] = useState('');
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [triageLoading, setTriageLoading] = useState(false);

  // Auto-detect location
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

  // AI triage when description changes (debounce 1s, min 10 chars)
  useEffect(() => {
    if (form.description.trim().length < 10) { setTriage(null); return; }
    const timer = setTimeout(async () => {
      setTriageLoading(true);
      try {
        const d = await api.post('/api/triage', { description: form.description }, token!);
        if (d.ok) {
          setTriage(d as TriageResult);
          // Auto-apply AI recommendation
          setForm(f => ({ ...f, urgency: d.urgency }));
        }
      } catch {}
      setTriageLoading(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, [form.description]);

  const submit = async () => {
    if (!form.address) return;
    setLoading(true);
    const d = await api.post('/api/dispatch/create', { ...form, gradeRequired: triage?.grade }, token!);
    if (d.requestId) nav(`/requester/status/${d.requestId}`);
    setLoading(false);
  };

  const gs = triage ? GRADE_STYLES[triage.grade] || GRADE_STYLES.green : null;

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
            {triageLoading && <p className="text-xs text-secondary mt-1">AI 상황 분석 중...</p>}
          </div>

          {/* AI Triage Result */}
          {triage && gs && (
            <div className={`${gs.bg} rounded-xl p-4`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{gs.emoji}</span>
                <span className={`font-display font-bold text-sm ${gs.text}`}>AI 추천: {gs.label}</span>
              </div>
              <p className={`text-xs ${gs.text} mb-1`}>{triage.reason}</p>
              <p className="text-xs text-on-surface-variant">{triage.advice}</p>
              {triage.call119 && (
                <a href="tel:119" className="mt-3 block w-full py-3 bg-error text-white rounded-xl font-bold text-center text-sm">
                  🚨 119 즉시 호출 (AI 권고)
                </a>
              )}
            </div>
          )}

          <div>
            <label className="text-sm font-semibold text-on-surface-variant mb-1 block">
              {t('urgencyLabel')} {triage && <span className="text-xs text-secondary font-normal">(AI 자동 설정됨)</span>}
            </label>
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

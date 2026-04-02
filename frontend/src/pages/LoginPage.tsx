import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';
import { useLang } from '../i18n';
import { detectRegion } from '../regionConfig';

export default function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const { t } = useLang();
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [consent, setConsent] = useState([false, false, false, false, false, false, false]);
  const requiredCount = 6; // first 6 are required
  const allRequiredChecked = consent.slice(0, requiredCount).every(Boolean);

  // Handle OAuth callback tokens
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    const refreshToken = params.get('refresh_token');
    if (token && refreshToken) {
      login(token, refreshToken);
      history.replaceState(null, '', '/login');
    }
  }, []);

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      if (user.role === 'admin') nav('/admin', { replace: true });
      else if (user.role === 'responder') nav('/responder', { replace: true });
      else nav('/requester', { replace: true });
    }
  }, [user]);

  const emailLogin = async () => {
    if (!email || !pw) { setError('Enter email and password'); return; }
    setLoading(true); setError('');
    try {
      const d = await api.post('/api/auth/login', { email: email.toLowerCase().trim(), password: pw });
      if (d.ok && d.token) {
        login(d.token, d.refreshToken);
      } else {
        setError(d.error || 'Login failed');
      }
    } catch { setError('Network error'); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="flex items-center justify-center px-6 py-20">
        <div className="bg-surface-card rounded-card p-10 w-full max-w-sm text-center" style={{ boxShadow: '0px 12px 32px rgba(25,28,29,0.06)' }}>
          <div className="text-5xl mb-4">🛡️</div>
          <h1 className="font-display text-2xl font-bold mb-2">{t('loginTitle')}</h1>
          <p className="text-on-surface-variant text-sm mb-8">{t('loginSub')}</p>

          {/* Consent checkboxes */}
          <div className="text-left text-xs text-on-surface-variant mb-6 p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)' }}>
            <p className="font-semibold text-on-surface text-sm mb-2">{t('consentTitle')}</p>
            {[
              { label: t('consentTerms'), req: true },
              { label: t('consentPrivacy'), req: true },
              { label: t('consentLocation'), req: true },
              { label: t('consentEmergency'), req: true },
              { label: t('consentResponderInfo'), req: true },
              { label: t('consentPayment'), req: true },
              { label: t('consentMarketing'), req: false },
            ].map((item, i) => (
              <label key={i} className="flex items-start gap-2 py-1 cursor-pointer">
                <input type="checkbox" checked={consent[i]} onChange={() => {
                  const c = [...consent]; c[i] = !c[i]; setConsent(c);
                }} className="mt-0.5 accent-primary" />
                <span>{item.req ? '[' + t('required') + '] ' : '[' + t('optional') + '] '}{item.label}</span>
              </label>
            ))}
            <label className="flex items-center gap-2 pt-2 mt-1 border-t border-outline-variant font-semibold text-on-surface cursor-pointer">
              <input type="checkbox" checked={consent.every(Boolean)} onChange={(e) => {
                setConsent(consent.map(() => e.target.checked));
              }} className="accent-primary" />
              <span>{t('consentAll')}</span>
            </label>
          </div>

          {(() => {
            const region = detectRegion();
            const isLineRegion = ['JP', 'TH', 'ID'].includes(region);
            const isKR = region === 'KR';

            const dis = !allRequiredChecked;
            const disStyle = dis ? { opacity: 0.4, pointerEvents: 'none' as const } : {};

            const kakaoBtn = (
              <a key="kakao" href={dis ? undefined : `${api.API_URL}/api/auth/kakao`}
                onClick={e => { if (dis) e.preventDefault(); }}
                className="flex items-center justify-center gap-3 w-full py-3.5 rounded-xl font-bold text-base mb-3 cursor-pointer"
                style={{ background: '#FEE500', color: '#191919', ...disStyle }}>
                {t('kakaoLogin')}
              </a>
            );
            const googleBtn = (
              <a key="google" href={dis ? undefined : `${api.API_URL}/api/auth/google`}
                onClick={e => { if (dis) e.preventDefault(); }}
                className="flex items-center justify-center gap-3 w-full py-3.5 rounded-xl font-bold text-base mb-3 cursor-pointer bg-white text-on-surface"
                style={{ border: '1.5px solid #e8e9eb', ...disStyle }}>
                <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                {t('googleLogin')}
              </a>
            );
            const lineBtn = (
              <a key="line" href={dis ? undefined : `${api.API_URL}/api/auth/line`}
                onClick={e => { if (dis) e.preventDefault(); }}
                className="flex items-center justify-center gap-3 w-full py-3.5 rounded-xl font-bold text-base mb-3 cursor-pointer text-white"
                style={{ background: '#06C755', ...disStyle }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
                {t('lineLogin')}
              </a>
            );

            // Order: LINE first for JP/TH/ID, Kakao first for KR, Google always
            if (isLineRegion) return <>{lineBtn}{googleBtn}{kakaoBtn}</>;
            if (isKR) return <>{kakaoBtn}{lineBtn}{googleBtn}</>;
            return <>{googleBtn}{lineBtn}{kakaoBtn}</>;
          })()}

          <button onClick={() => setShowEmail(!showEmail)}
            className="text-xs text-on-surface-variant hover:text-primary mt-3 cursor-pointer transition">
            관리자 로그인
          </button>

          {showEmail && (
            <div className="mt-3 flex flex-col gap-2">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="Email" autoComplete="email"
                className="w-full p-3 rounded-xl bg-surface-low text-on-surface text-sm outline-none focus:ring-2 focus:ring-primary/30"/>
              <input type="password" value={pw} onChange={e => setPw(e.target.value)}
                placeholder="Password" autoComplete="current-password"
                onKeyDown={e => { if (e.key === 'Enter') emailLogin(); }}
                className="w-full p-3 rounded-xl bg-surface-low text-on-surface text-sm outline-none focus:ring-2 focus:ring-primary/30"/>
              <button onClick={emailLogin} disabled={loading}
                className="w-full py-3 rounded-xl bg-primary text-on-primary font-bold text-sm disabled:opacity-40">
                {loading ? '...' : t('login')}
              </button>
              {error && <p className="text-xs text-error">{error}</p>}
            </div>
          )}

          <p className="text-xs text-on-surface-variant mt-6">&copy; 2026 Genomic Inc.</p>
        </div>
      </div>
    </div>
  );
}

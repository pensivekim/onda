import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../api';

interface User { id: string; name: string; role: string; }
interface AuthCtx { user: User | null; token: string | null; login: (t: string, rt: string) => void; logout: () => void; loading: boolean; }

const AuthContext = createContext<AuthCtx>({ user: null, token: null, login: () => {}, logout: () => {}, loading: true });

// Push subscription
async function initPush(token: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw-push.js');
    const existing = await reg.pushManager.getSubscription();
    if (existing) return; // already subscribed

    const keyRes = await api.get('/api/push/vapid-key');
    if (!keyRes.publicKey) return;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyRes.publicKey,
    });
    await api.post('/api/push/subscribe', { subscription: sub.toJSON() }, token);
  } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('onda_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    api.post('/api/auth/verify', { token }).then((d: any) => {
      if (d.valid) {
        setUser({ id: d.userId, name: d.name, role: d.role });
        // Init push after login verified
        setTimeout(() => initPush(token), 3000);
      }
      else { localStorage.removeItem('onda_token'); setToken(null); }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  const login = (t: string, rt: string) => {
    localStorage.setItem('onda_token', t);
    localStorage.setItem('onda_refresh_token', rt);
    setToken(t);
  };

  const logout = () => {
    localStorage.removeItem('onda_token');
    localStorage.removeItem('onda_refresh_token');
    setToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, token, login, logout, loading }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

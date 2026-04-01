import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { api } from '../api';

interface User { id: string; name: string; role: string; }
interface AuthCtx { user: User | null; token: string | null; login: (t: string, rt: string) => void; logout: () => void; loading: boolean; }

const AuthContext = createContext<AuthCtx>({ user: null, token: null, login: () => {}, logout: () => {}, loading: true });

// Poll notifications + show via Notification API
function startNotificationPolling(token: string) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();

  setInterval(async () => {
    try {
      const d = await api.get('/api/notifications/pending', token);
      if (!d.notifications?.length) return;
      const ids: number[] = [];
      for (const n of d.notifications) {
        ids.push(n.id);
        if (Notification.permission === 'granted') {
          new Notification(n.title, { body: n.body, tag: `onda-${n.id}` });
        }
      }
      if (ids.length) api.post('/api/notifications/read', { ids }, token).catch(() => {});
    } catch {}
  }, 10000); // Poll every 10 seconds
}

// Auto-refresh token before expiry
async function refreshTokenIfNeeded(token: string, setToken: (t: string) => void) {
  try {
    // Decode JWT payload to check exp
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expiresIn = (payload.exp * 1000) - Date.now();
    // Refresh if less than 2 hours remaining
    if (expiresIn > 2 * 3600000) return;
    const refreshToken = localStorage.getItem('onda_refresh_token');
    if (!refreshToken) return;
    const d = await api.post('/api/auth/refresh', { refreshToken });
    if (d.token) {
      localStorage.setItem('onda_token', d.token);
      setToken(d.token);
    }
  } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('onda_token'));
  const [loading, setLoading] = useState(true);
  const pollingStarted = useRef(false);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    api.post('/api/auth/verify', { token }).then((d: any) => {
      if (d.valid) {
        setUser({ id: d.userId, name: d.name, role: d.role });
        // Start notification polling (once)
        if (!pollingStarted.current) {
          pollingStarted.current = true;
          startNotificationPolling(token);
        }
        // Auto-refresh token
        refreshTokenIfNeeded(token, setToken);
      } else {
        localStorage.removeItem('onda_token');
        setToken(null);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  // Periodic token refresh check (every 30 min)
  useEffect(() => {
    if (!token) return;
    const iv = setInterval(() => refreshTokenIfNeeded(token, setToken), 30 * 60000);
    return () => clearInterval(iv);
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

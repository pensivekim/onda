import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';

export default function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();

  // Handle OAuth callback tokens
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    const refreshToken = params.get('refresh_token');
    if (token && refreshToken) {
      login(token, refreshToken);
      // Clean URL
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

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="flex items-center justify-center px-6 py-20">
        <div className="bg-surface-card rounded-card p-10 w-full max-w-sm text-center" style={{ boxShadow: '0px 12px 32px rgba(25,28,29,0.06)' }}>
          <div className="text-5xl mb-4">🛡️</div>
          <h1 className="font-display text-2xl font-bold mb-2">온다</h1>
          <p className="text-on-surface-variant text-sm mb-8">긴급 돌봄 O2O 플랫폼</p>

          <a
            href={`${api.API_URL}/api/auth/kakao`}
            className="flex items-center justify-center gap-3 w-full py-3.5 rounded-xl font-bold text-base mb-3 cursor-pointer"
            style={{ background: '#FEE500', color: '#191919' }}
          >
            카카오로 시작하기
          </a>

          <a
            href={`${api.API_URL}/api/auth/google`}
            className="flex items-center justify-center gap-3 w-full py-3.5 rounded-xl font-bold text-base cursor-pointer bg-white text-on-surface"
            style={{ border: '1.5px solid #e8e9eb' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Google로 시작하기
          </a>

          <p className="text-xs text-on-surface-variant mt-8 leading-relaxed">
            가입 시 <a href="#" className="text-primary">이용약관</a> 및 <a href="#" className="text-primary">개인정보처리방침</a>에 동의합니다.
          </p>
        </div>
      </div>
    </div>
  );
}

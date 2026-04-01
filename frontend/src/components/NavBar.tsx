import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function NavBar() {
  const { user, logout } = useAuth();
  return (
    <nav className="sticky top-0 z-50 backdrop-blur-[20px] bg-surface/80" style={{ borderBottom: 'none' }}>
      <div className="max-w-2xl mx-auto flex items-center justify-between px-5 py-3">
        <Link to="/" className="font-display text-xl font-extrabold text-primary tracking-tight">온다</Link>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm text-on-surface-variant font-medium">{user.name}</span>
              <button onClick={logout} className="text-xs text-on-surface-variant hover:text-primary transition">로그아웃</button>
            </>
          ) : (
            <Link to="/login" className="text-sm font-semibold text-primary">로그인</Link>
          )}
        </div>
      </div>
    </nav>
  );
}

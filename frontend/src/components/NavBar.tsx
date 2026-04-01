import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../i18n';
import LangSelector from './LangSelector';

export default function NavBar() {
  const { user, logout } = useAuth();
  const { t } = useLang();
  return (
    <nav className="sticky top-0 z-50 backdrop-blur-[20px] bg-surface/80" style={{ borderBottom: 'none' }}>
      <div className="max-w-2xl mx-auto flex items-center justify-between px-5 py-3">
        <Link to="/" className="font-display text-xl font-extrabold text-primary tracking-tight">온다</Link>
        <div className="flex items-center gap-3">
          <LangSelector />
          {user ? (
            <>
              <span className="text-sm text-on-surface-variant font-medium">{user.name}</span>
              <button onClick={logout} className="text-xs text-on-surface-variant hover:text-primary transition">{t('logout')}</button>
            </>
          ) : (
            <Link to="/login" className="text-sm font-semibold text-primary">{t('login')}</Link>
          )}
        </div>
      </div>
    </nav>
  );
}

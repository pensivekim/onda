import { Link } from 'react-router-dom';
import NavBar from '../components/NavBar';
import { useLang } from '../i18n';

export default function LandingPage() {
  const { t } = useLang();
  const STEPS = [
    { emoji: '🆘', title: t('step1'), desc: t('step1d') },
    { emoji: '🔍', title: t('step2'), desc: t('step2d') },
    { emoji: '🏃', title: t('step3'), desc: t('step3d') },
  ];

  return (
    <div className="min-h-screen">
      <NavBar />
      <section className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #b7102a, #db313f)' }}>
        <div className="max-w-2xl mx-auto px-6 py-20 text-center text-white">
          <h1 className="font-display text-5xl font-extrabold mb-4 leading-tight">{t('heroTitle')}</h1>
          <p className="text-lg opacity-90 mb-8 leading-relaxed font-body whitespace-pre-line">{t('heroSub')}</p>
          <Link to="/login" className="inline-block bg-white text-primary font-display font-bold text-lg px-10 py-4 rounded-card"
            style={{ boxShadow: '0px 12px 32px rgba(25,28,29,0.15)' }}>
            {t('heroCta')}
          </Link>
        </div>
      </section>

      <section className="max-w-2xl mx-auto px-6 py-16">
        <h2 className="font-display text-2xl font-bold text-center mb-10">{t('howTitle')}</h2>
        <div className="grid grid-cols-1 gap-4">
          {STEPS.map((s, i) => (
            <div key={i} className="bg-surface-card rounded-card p-6 flex items-center gap-5">
              <span className="text-4xl flex-shrink-0">{s.emoji}</span>
              <div>
                <h3 className="font-display font-bold text-lg">{s.title}</h3>
                <p className="text-on-surface-variant text-sm mt-1 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-surface-low">
        <div className="max-w-2xl mx-auto px-6 py-16 text-center">
          <h2 className="font-display text-2xl font-bold mb-4">{t('responderCta')}</h2>
          <p className="text-on-surface-variant mb-8 leading-relaxed">{t('responderCtaSub')}</p>
          <Link to="/login" className="inline-block bg-on-surface text-surface font-display font-bold px-8 py-3 rounded-card">{t('responderBtn')}</Link>
        </div>
      </section>

      <footer className="max-w-2xl mx-auto px-6 py-10 text-center">
        <p className="text-xs text-on-surface-variant leading-relaxed">
          (주)제노믹 | 392-88-01401 | 대표 김창훈<br/>대구광역시 서구 국채보상로46길 65-20
        </p>
      </footer>
    </div>
  );
}

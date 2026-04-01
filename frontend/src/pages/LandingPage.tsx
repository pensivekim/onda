import { Link } from 'react-router-dom';
import NavBar from '../components/NavBar';

const STEPS = [
  { emoji: '🆘', title: '요청', desc: '긴급 상황 발생 시 한 번 탭으로 돌봄 요청' },
  { emoji: '🔍', title: '매칭', desc: '반경 3km 내 검증된 출동자에게 즉시 전달' },
  { emoji: '🏃', title: '출동', desc: '가장 가까운 출동자가 현장으로 달려갑니다' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <NavBar />
      {/* Hero */}
      <section className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #b7102a, #db313f)' }}>
        <div className="max-w-2xl mx-auto px-6 py-20 text-center text-white">
          <h1 className="font-display text-5xl font-extrabold mb-4 leading-tight">온다</h1>
          <p className="text-lg opacity-90 mb-8 leading-relaxed font-body">
            긴급한 순간,<br/>가장 가까운 검증된 사람이 달려옵니다
          </p>
          <Link
            to="/login"
            className="inline-block bg-white text-primary font-display font-bold text-lg px-10 py-4 rounded-card"
            style={{ boxShadow: '0px 12px 32px rgba(25,28,29,0.15)' }}
          >
            긴급 돌봄 요청하기
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-2xl mx-auto px-6 py-16">
        <h2 className="font-display text-2xl font-bold text-center mb-10">어떻게 작동하나요?</h2>
        <div className="grid grid-cols-1 gap-4">
          {STEPS.map((s, i) => (
            <div key={i} className="bg-surface-card rounded-card p-6 flex items-center gap-5" style={{ boxShadow: 'none' }}>
              <span className="text-4xl flex-shrink-0">{s.emoji}</span>
              <div>
                <h3 className="font-display font-bold text-lg">{s.title}</h3>
                <p className="text-on-surface-variant text-sm mt-1 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Responder CTA */}
      <section className="bg-surface-low">
        <div className="max-w-2xl mx-auto px-6 py-16 text-center">
          <h2 className="font-display text-2xl font-bold mb-4">출동자로 참여하세요</h2>
          <p className="text-on-surface-variant mb-8 leading-relaxed">
            검증된 시민으로 등록하고, 긴급 돌봄이 필요한 이웃을 도우며 보상을 받으세요.
          </p>
          <Link to="/login" className="inline-block bg-on-surface text-surface font-display font-bold px-8 py-3 rounded-card">
            출동자 등록하기
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-2xl mx-auto px-6 py-10 text-center">
        <p className="text-xs text-on-surface-variant leading-relaxed">
          (주)제노믹 | 사업자등록번호 392-88-01401 | 대표 김창훈<br/>
          대구광역시 서구 국채보상로46길 65-20
        </p>
      </footer>
    </div>
  );
}

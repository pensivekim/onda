// 온다 텔레그램판 미니 앱 입구 (/tg) — 텔레그램 안에서 열리면 텔레그램 확인(알림 통로가 함)으로 온다 로그인 후 역할 화면으로
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import qrcode from '../vendor/qrcode.js';

declare global { interface Window { Telegram?: any } }

/** 텔레그램 미니 앱 도구 불러오기 (텔레그램 공식 주소) */
export function loadTelegramSdk(): Promise<any> {
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.onload = () => resolve(window.Telegram?.WebApp || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

export default function TgEntry() {
  const { login } = useAuth();
  const [msg, setMsg] = useState('텔레그램 확인 중입니다…');
  const [link, setLink] = useState('');

  useEffect(() => {
    (async () => {
      const wa = await loadTelegramSdk();
      if (!wa?.initData) {
        // 텔레그램 밖(웹 앱에 로그인한 도우미·관리자): 내 텔레그램 묶기 QR
        const tok = localStorage.getItem('onda_token');
        if (tok) {
          const d = await api.post('/api/tg/link/me', {}, tok);
          if (d.url) { setLink(d.url); setMsg('휴대폰 카메라로 찍으면 텔레그램 온다 봇과 연결됩니다 (1시간 안).'); return; }
        }
        setMsg('텔레그램 안에서 열어 주세요. 봇 대화방 아래 «온다 열기» 단추를 누르시면 됩니다.'); return;
      }
      wa.ready(); wa.expand();
      const d = await api.post('/api/tg/webapp-login', { initData: wa.initData });
      if (!d.token) { setMsg(d.error || '온다와 연결되지 않은 텔레그램입니다. 담당 도우미에게 QR 을 다시 받아 주세요.'); return; }
      login(d.token, d.refreshToken);
      // 새로 불러와서 로그인 확인이 끝난 뒤 화면을 연다(바로 넘기면 확인 전이라 로그인 화면으로 튕김)
      window.location.replace(d.kind === 'helper' ? '/tg/helper' : '/tg/home');
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-6 break-keep">
      <div className="max-w-sm w-full">
        <p className="text-on-surface-variant text-center text-lg leading-relaxed">{msg}</p>
        {link && <QrBox url={link} />}
      </div>
    </div>
  );
}

function QrBox({ url }: { url: string }) {
  const q = qrcode(0, 'M'); q.addData(url); q.make();
  return (
    <div className="bg-surface-card rounded-card p-4 mt-6">
      <div dangerouslySetInnerHTML={{ __html: q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) }} style={{ maxWidth: 260, margin: '0 auto' }} />
      <a href={url} className="block text-center text-secondary font-semibold mt-3">이 휴대폰이면 여기를 누르세요</a>
    </div>
  );
}

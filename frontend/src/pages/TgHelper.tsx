// 온다 텔레그램판 — 도우미 미니 앱 (/tg/helper)
// 첫 방문: 어르신 등록 → 어르신 휴대폰으로 QR 찍게 → 가족 QR. 출동 목록은 기존 도우미 화면(/responder).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import qrcode from '../vendor/qrcode.js';

function Qr({ url }: { url: string }) {
  const q = qrcode(0, 'M'); q.addData(url); q.make();
  return <div className="bg-surface-card rounded-card p-4 flex justify-center" dangerouslySetInnerHTML={{ __html: q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) }} style={{ maxWidth: 280, margin: '0 auto' }} />;
}

export default function TgHelper() {
  const { token } = useAuth();
  const [elders, setElders] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', address: '', lat: 0, lng: 0, notes: '', hi_code: '' });
  const [qr, setQr] = useState<{ title: string; url: string } | null>(null);
  const [err, setErr] = useState('');
  const load = () => token && api.get('/api/tg/elders/mine', token).then((d: any) => setElders(d.elders || []));
  useEffect(() => { load(); }, [token]);

  const here = () => navigator.geolocation?.getCurrentPosition(
    (p) => setForm((f) => ({ ...f, lat: p.coords.latitude, lng: p.coords.longitude })),
    () => setErr('위치를 못 받았습니다. 주소만 적어도 됩니다.'), { enableHighAccuracy: true, timeout: 10000 });

  const enroll = async () => {
    setErr('');
    if (!form.name.trim()) { setErr('어르신 성함을 적어 주세요.'); return; }
    const d = await api.post('/api/tg/elders', form, token!);
    if (!d.url) { setErr(d.error || '등록하지 못했습니다.'); return; }
    setQr({ title: `${form.name} 어르신 휴대폰 카메라로 찍어 주세요 (6시간 안)`, url: d.url });
    setForm({ name: '', address: '', lat: 0, lng: 0, notes: '', hi_code: '' });
    load();
  };
  const familyQr = async (e: any) => {
    const d = await api.post(`/api/tg/elders/${e.elder_id}/family-link`, { relation: '가족' }, token!);
    if (d.url) setQr({ title: `${e.name} 어르신 가족 휴대폰으로 찍어 주세요 (3일 안, 한 번만)`, url: d.url });
  };

  const input = 'w-full bg-surface-low rounded-card px-4 py-3 mb-3 text-base';
  return (
    <div className="min-h-screen max-w-md mx-auto px-5 py-6 break-keep">
      <h1 className="font-display text-2xl font-bold mb-1">도우미</h1>
      <p className="text-on-surface-variant text-sm mb-6">첫 방문 때 어르신 텔레그램 설치·가입을 도와 드린 뒤 등록하세요.</p>

      {qr && (
        <div className="bg-trust-green-bg rounded-card p-5 mb-6">
          <p className="font-semibold mb-3 text-center">{qr.title}</p>
          <Qr url={qr.url} />
          <p className="text-xs text-on-surface-variant mt-3 text-center break-all">{qr.url}</p>
          <button onClick={() => setQr(null)} className="w-full mt-3 bg-surface-card rounded-card py-3 font-semibold">닫기</button>
        </div>
      )}

      <div className="bg-surface-card rounded-card p-5 mb-6">
        <h2 className="font-display font-bold mb-3">어르신 등록</h2>
        <input className={input} placeholder="성함" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={input} placeholder="주소" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <button onClick={here} className="w-full bg-surface-low rounded-card py-3 mb-3 font-semibold">
          📍 지금 이 집 위치로 {form.lat ? '(받음)' : ''}
        </button>
        <input className={input} placeholder="말벗을 쓰시면 말벗 연결 코드 (없으면 비움)" value={form.hi_code} onChange={(e) => setForm({ ...form, hi_code: e.target.value })} />
        <textarea className={input} placeholder="알아 둘 점 (거동·약·현관 비밀번호는 적지 마세요)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        {err && <p className="text-error text-sm mb-3">{err}</p>}
        <button onClick={enroll} className="w-full bg-primary text-on-primary rounded-card py-4 font-bold text-lg">등록하고 QR 만들기</button>
      </div>

      <h2 className="font-display font-bold mb-3">내가 등록한 어르신</h2>
      <div className="flex flex-col gap-3 mb-8">
        {elders.length === 0 && <div className="bg-surface-low rounded-card p-6 text-center text-on-surface-variant text-sm">아직 없습니다.</div>}
        {elders.map((e) => (
          <div key={e.elder_id} className="bg-surface-card rounded-card p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{e.name} 어르신</span>
              <span className={`text-xs px-3 py-1 rounded-full ${e.linked ? 'bg-trust-green-bg text-trust-green' : 'bg-orange-grade-bg text-orange-grade'}`}>{e.linked ? '텔레그램 연결됨' : '연결 전'}</span>
            </div>
            <p className="text-xs text-on-surface-variant mt-1">{e.address || '-'} · 가족 {e.family}명</p>
            <button onClick={() => familyQr(e)} className="w-full mt-3 bg-surface-low rounded-card py-3 font-semibold">👨‍👩‍👧 가족 QR 보여 주기</button>
          </div>
        ))}
      </div>
      <Link to="/responder" className="block w-full text-center bg-secondary text-on-primary rounded-card py-4 font-bold">출동 목록 열기</Link>
    </div>
  );
}

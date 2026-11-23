// 온다 텔레그램판 — 도우미 미니 앱 (/tg/helper)
// 2026-11-24: 맨 위에 «출동 받는 중» 스위치 · 받은 부탁(수락/못 갑니다) · 지금 출동(단계 단추·위치 함께 보기).
// 그 아래 첫 방문용: 어르신 등록 → 어르신 휴대폰으로 QR 찍게 → 가족 QR.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import qrcode from '../vendor/qrcode.js';

function Qr({ url }: { url: string }) {
  const q = qrcode(0, 'M'); q.addData(url); q.make();
  return <div className="bg-surface-card rounded-card p-4 flex justify-center" dangerouslySetInnerHTML={{ __html: q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) }} style={{ maxWidth: 280, margin: '0 auto' }} />;
}

const NEXT: Record<string, [string, string]> = {
  accepted: ['moving', '출발했어요'], moving: ['arrived', '도착했어요'], arrived: ['in_progress', '돌봄 시작'], in_progress: ['completed', '마쳤어요'],
};
const STEP_KO: Record<string, string> = { accepted: '맡음', moving: '가는 중', arrived: '도착', in_progress: '돌봄 중' };

function Dispatch({ token }: { token: string }) {
  const [avail, setAvail] = useState<number | null>(null);
  const [list, setList] = useState<any[]>([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [share, setShare] = useState(false);
  const watch = useRef<number | null>(null);
  const last = useRef(0);
  const load = () => api.get('/api/matches/offered', token).then((d: any) => setList(d.matches || [])).catch(() => {});
  useEffect(() => {
    api.get('/api/responders/me', token).then((d: any) => setAvail(d.responder ? Number(d.responder.available) : null)).catch(() => {});
    load(); const iv = setInterval(load, 8000); return () => clearInterval(iv);
  }, [token]);
  const cur = list.find((m) => NEXT[m.status]);
  const offers = list.filter((m) => m.status === 'offered');
  // 지금 출동이 있으면 위치를 30초마다 한 번만 보낸다 — 끝나면 바로 끈다
  useEffect(() => {
    const on = share && !!cur && !!navigator.geolocation;
    if (on && watch.current == null) {
      watch.current = navigator.geolocation.watchPosition((p) => {
        if (Date.now() - last.current < 30000) return;
        last.current = Date.now();
        api.patch('/api/responders/location', { lat: p.coords.latitude, lng: p.coords.longitude }, token).catch(() => {});
      }, () => setMsg('위치를 못 받았습니다. 휴대폰 위치 권한을 확인해 주세요.'), { enableHighAccuracy: true });
    }
    if (!on && watch.current != null) { navigator.geolocation.clearWatch(watch.current); watch.current = null; }
    return () => { if (watch.current != null && !on) { navigator.geolocation.clearWatch(watch.current); watch.current = null; } };
  }, [share, cur?.id]);
  useEffect(() => () => { if (watch.current != null) navigator.geolocation.clearWatch(watch.current); }, []);

  const toggle = async () => {
    const v = avail ? 0 : 1;
    const d: any = await api.patch('/api/responders/available', { available: v }, token).catch(() => null);
    if (d?.ok) setAvail(d.available);
  };
  const act = async (id: string, path: string, method = 'POST', body?: any) => {
    setBusy(id); setMsg('');
    const p = `/api/matches/${id}/${path}`;
    const r: any = await (method === 'PATCH' ? api.patch(p, body, token) : api.post(p, body || {}, token)).catch(() => ({ error: 'net' }));
    if (r?.error) setMsg(['taken', 'not offered', 'Invalid transition'].includes(r.error) ? '이미 다른 도우미가 맡았거나 단계가 바뀌었습니다.' : '보내지 못했습니다. 다시 눌러 주세요.');
    setBusy(''); load();
  };

  return (
    <div className="mb-6">
      {avail != null && (
        <button onClick={toggle} className={`w-full rounded-card p-4 mb-4 flex items-center justify-between font-bold text-lg ${avail ? 'bg-trust-green-bg text-trust-green' : 'bg-surface-low text-on-surface-variant'}`}>
          <span>{avail ? '출동 받는 중' : '지금은 쉬는 중'}</span>
          <span className={`w-14 h-8 rounded-full relative ${avail ? 'bg-trust-green' : 'bg-gray-300'}`}><span className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${avail ? 'left-7' : 'left-1'}`} /></span>
        </button>
      )}
      {msg && <p className="text-error text-sm mb-3">{msg}</p>}
      {offers.map((m) => (
        <div key={m.id} className="bg-orange-grade-bg rounded-card p-5 mb-4">
          <p className="text-sm text-orange-grade font-bold mb-1">{m.urgency === 'urgent' || m.urgency === 'emergency' ? '🚨 급한 부탁' : '🔔 받은 부탁'}</p>
          <p className="text-xl font-bold">{m.requester_name || '어르신'}</p>
          <p className="text-sm text-on-surface-variant mb-4">{m.address || '주소는 수락하면 보입니다'}</p>
          <div className="grid grid-cols-2 gap-3">
            <button disabled={busy === m.id} onClick={() => act(m.id, 'accept')} className="bg-primary text-on-primary rounded-card py-4 font-bold text-lg">수락</button>
            <button disabled={busy === m.id} onClick={() => act(m.id, 'reject')} className="bg-surface-card rounded-card py-4 font-semibold">못 갑니다</button>
          </div>
        </div>
      ))}
      {cur && (
        <div className="bg-surface-card rounded-card p-5 mb-4">
          <p className="text-sm text-trust-green font-bold mb-1">지금 출동 · {STEP_KO[cur.status]}</p>
          <p className="text-xl font-bold">{cur.requester_name || '어르신'}</p>
          <p className="text-sm text-on-surface-variant mb-4">{cur.address || '-'}</p>
          <button disabled={busy === cur.id} onClick={() => act(cur.id, 'status', 'PATCH', { status: NEXT[cur.status][0] })} className="w-full bg-primary text-on-primary rounded-card py-4 font-bold text-lg mb-3">{NEXT[cur.status][1]}</button>
          <button onClick={() => setShare(!share)} className={`w-full rounded-card py-3 font-semibold ${share ? 'bg-trust-green-bg text-trust-green' : 'bg-surface-low'}`}>📍 위치 함께 보기 {share ? '켜짐' : '꺼짐'}</button>
          <p className="text-xs text-on-surface-variant mt-3">위급하면 119 에 먼저 전화하고, 대화방의 «위급해요» 단추를 눌러 주세요.</p>
        </div>
      )}
      {!cur && offers.length === 0 && avail != null && (
        <div className="bg-surface-low rounded-card p-5 text-center text-on-surface-variant text-sm">지금 받은 부탁이 없습니다. 부탁이 오면 대화방과 여기에 함께 뜹니다.</div>
      )}
    </div>
  );
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
      <div className="mb-2" />
      {token && <Dispatch token={token} />}
      <p className="text-on-surface-variant text-sm mb-4">첫 방문 때 어르신 텔레그램 설치·가입을 도와 드린 뒤 등록하세요.</p>

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

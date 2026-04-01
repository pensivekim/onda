import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import NavBar from '../components/NavBar';

export default function CreateRequest() {
  const { token } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ type: 'child', address: '', description: '', urgency: 'normal' });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.address) return;
    setLoading(true);
    const d = await api.post('/api/dispatch/create', form, token!);
    if (d.requestId) nav(`/requester/status/${d.requestId}`);
    setLoading(false);
  };

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="max-w-md mx-auto px-5 py-8">
        <h1 className="font-display text-2xl font-bold mb-6">긴급 돌봄 요청</h1>

        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-semibold text-on-surface-variant mb-1 block">돌봄 유형</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
              className="w-full p-3.5 rounded-xl bg-surface-low text-on-surface font-body outline-none focus:ring-2 focus:ring-primary/30">
              <option value="child">아이 돌봄</option>
              <option value="elder">어르신 돌봄</option>
              <option value="disabled">장애인 돌봄</option>
              <option value="other">기타</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold text-on-surface-variant mb-1 block">주소</label>
            <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
              placeholder="출동 장소 주소 입력"
              className="w-full p-3.5 rounded-xl bg-surface-low text-on-surface font-body outline-none focus:ring-2 focus:ring-primary/30"/>
          </div>

          <div>
            <label className="text-sm font-semibold text-on-surface-variant mb-1 block">상황 설명</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="어떤 상황인지 간단히 알려주세요"
              rows={3}
              className="w-full p-3.5 rounded-xl bg-surface-low text-on-surface font-body outline-none resize-none focus:ring-2 focus:ring-primary/30"/>
          </div>

          <div>
            <label className="text-sm font-semibold text-on-surface-variant mb-1 block">긴급도</label>
            <select value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value })}
              className="w-full p-3.5 rounded-xl bg-surface-low text-on-surface font-body outline-none focus:ring-2 focus:ring-primary/30">
              <option value="normal">일반</option>
              <option value="urgent">긴급</option>
              <option value="emergency">응급</option>
            </select>
          </div>

          <button onClick={submit} disabled={loading || !form.address}
            className="w-full py-4 rounded-xl bg-primary text-on-primary font-display font-bold text-lg mt-4 disabled:opacity-40"
            style={{ boxShadow: '0px 12px 32px rgba(183,16,42,0.2)' }}>
            {loading ? '요청 중...' : '출동 요청하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

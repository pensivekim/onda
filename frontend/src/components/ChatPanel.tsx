import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { useLang } from '../i18n';

interface Message { id: number; sender_id: string; sender_name: string; content: string; created_at: string; }

export default function ChatPanel({ matchId }: { matchId: string }) {
  const { user, token } = useAuth();
  const { t } = useLang();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef(0);

  const load = () => {
    if (!token || !matchId) return;
    api.get(`/api/chat/${matchId}?after=${lastIdRef.current}`, token).then((d: any) => {
      if (d.messages?.length) {
        setMessages(prev => [...prev, ...d.messages]);
        lastIdRef.current = d.messages[d.messages.length - 1].id;
      }
    });
  };

  useEffect(() => { load(); const iv = setInterval(load, 3000); return () => clearInterval(iv); }, [matchId, token]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    await api.post(`/api/chat/${matchId}`, { content: input.trim() }, token!);
    setInput('');
    load();
    setSending(false);
  };

  return (
    <div className="bg-surface-card rounded-card overflow-hidden">
      <div className="px-4 py-3 bg-surface-low">
        <span className="font-display font-bold text-sm">{t('chatTitle')}</span>
      </div>
      <div className="h-48 overflow-y-auto px-4 py-2 flex flex-col gap-2">
        {messages.length === 0 && <p className="text-xs text-on-surface-variant text-center py-6">{t('chatEmpty')}</p>}
        {messages.map(m => (
          <div key={m.id} className={`flex flex-col ${m.sender_id === user?.id ? 'items-end' : 'items-start'}`}>
            <span className="text-[10px] text-on-surface-variant mb-0.5">{m.sender_name}</span>
            <div className={`px-3 py-2 rounded-2xl max-w-[80%] text-sm ${
              m.sender_id === user?.id ? 'bg-primary text-on-primary rounded-br-sm' : 'bg-surface-low text-on-surface rounded-bl-sm'
            }`}>{m.content}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 px-3 py-2 bg-surface-low">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }}
          placeholder={t('chatPlaceholder')}
          className="flex-1 px-3 py-2 rounded-xl bg-surface text-on-surface text-sm outline-none"/>
        <button onClick={send} disabled={sending || !input.trim()}
          className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-40">
          {t('chatSend')}
        </button>
      </div>
    </div>
  );
}

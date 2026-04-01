import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { useLang } from '../i18n';

export default function ReviewPanel({ matchId }: { matchId: string }) {
  const { token } = useAuth();
  const { t } = useLang();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [existing, setExisting] = useState(false);

  useEffect(() => {
    if (!token || !matchId) return;
    api.get(`/api/reviews/${matchId}`, token).then((d: any) => {
      if (d.reviews?.length > 0) setExisting(true);
    });
  }, [matchId, token]);

  const submit = async () => {
    if (!token) return;
    const d = await api.post('/api/reviews', { matchId, rating, comment }, token);
    if (d.ok) setSubmitted(true);
  };

  if (existing || submitted) {
    return (
      <div className="bg-trust-green-bg rounded-card p-5 text-center">
        <span className="text-2xl">{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span>
        <p className="text-sm text-trust-green font-medium mt-1">{submitted ? t('reviewDone') : t('reviewExists')}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-card rounded-card p-5">
      <h3 className="font-display font-bold text-sm mb-3">{t('reviewTitle')}</h3>
      <div className="flex gap-1 justify-center mb-3">
        {[1,2,3,4,5].map(n => (
          <button key={n} onClick={() => setRating(n)}
            className={`text-3xl transition ${n <= rating ? 'text-primary' : 'text-surface-high'}`}>★</button>
        ))}
      </div>
      <textarea value={comment} onChange={e => setComment(e.target.value)}
        placeholder={t('reviewPlaceholder')} rows={2}
        className="w-full p-3 rounded-xl bg-surface-low text-on-surface text-sm outline-none resize-none mb-3"/>
      <button onClick={submit} className="w-full py-3 rounded-xl bg-primary text-on-primary font-bold text-sm">{t('reviewSubmit')}</button>
    </div>
  );
}

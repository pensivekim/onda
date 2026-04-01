import { useState } from 'react';
import { LANGS, useLang } from '../i18n';

export default function LangSelector() {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const current = LANGS.find(l => l.code === lang) || LANGS[0];

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-primary transition px-2 py-1 rounded-lg">
        <span>{current.flag}</span>
        <span className="hidden sm:inline">{current.name}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-surface-card rounded-card p-2 max-h-80 overflow-y-auto w-48"
               style={{ boxShadow: '0px 12px 32px rgba(25,28,29,0.12)' }}>
            {LANGS.map(l => (
              <button key={l.code} onClick={() => { setLang(l.code); setOpen(false); }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition ${
                  l.code === lang ? 'bg-surface-low font-semibold text-primary' : 'hover:bg-surface-low text-on-surface'}`}>
                <span>{l.flag}</span> {l.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

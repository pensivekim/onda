// Frontend region config (mirrors backend regions.ts)

export interface FrontRegion {
  code: string;
  name: string;
  flag: string;
  currency: string;
  currencySymbol: string;
  rates: { green: number; orange: number; red: number };
  authProviders: string[];
}

export const REGIONS: FrontRegion[] = [
  { code: 'KR', name: '한국', flag: '🇰🇷', currency: 'KRW', currencySymbol: '₩', rates: { green: 25000, orange: 40000, red: 80000 }, authProviders: ['kakao', 'google'] },
  { code: 'JP', name: '日本', flag: '🇯🇵', currency: 'JPY', currencySymbol: '¥', rates: { green: 2500, orange: 4000, red: 8000 }, authProviders: ['google', 'line'] },
  { code: 'TH', name: 'ไทย', flag: '🇹🇭', currency: 'THB', currencySymbol: '฿', rates: { green: 300, orange: 500, red: 1000 }, authProviders: ['google', 'line'] },
  { code: 'VN', name: 'Việt Nam', flag: '🇻🇳', currency: 'VND', currencySymbol: '₫', rates: { green: 100000, orange: 200000, red: 400000 }, authProviders: ['google'] },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩', currency: 'IDR', currencySymbol: 'Rp', rates: { green: 75000, orange: 150000, red: 300000 }, authProviders: ['google'] },
  { code: 'AE', name: 'UAE', flag: '🇦🇪', currency: 'AED', currencySymbol: 'د.إ', rates: { green: 100, orange: 200, red: 400 }, authProviders: ['google'] },
];

export function detectRegion(): string {
  const saved = localStorage.getItem('onda_region');
  if (saved) return saved;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  if (tz.includes('Tokyo')) return 'JP';
  if (tz.includes('Bangkok')) return 'TH';
  if (tz.includes('Ho_Chi_Minh') || tz.includes('Saigon')) return 'VN';
  if (tz.includes('Jakarta')) return 'ID';
  if (tz.includes('Dubai') || tz.includes('Riyadh')) return 'AE';
  if (tz.includes('Seoul')) return 'KR';
  return 'KR';
}

export function setRegion(code: string) {
  localStorage.setItem('onda_region', code);
}

export function getRegion(code?: string): FrontRegion {
  const c = code || detectRegion();
  return REGIONS.find(r => r.code === c) || REGIONS[0];
}

export function formatCurrency(amount: number, regionCode?: string): string {
  const r = getRegion(regionCode);
  return `${r.currencySymbol}${amount.toLocaleString()}`;
}

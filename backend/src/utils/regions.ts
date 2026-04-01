// Global region configuration — all country-specific settings in one place

export interface RegionConfig {
  code: string;           // ISO 3166-1 alpha-2
  name: string;
  currency: string;       // ISO 4217
  currencySymbol: string;
  timezone: string;       // IANA timezone
  defaultLang: string;
  matchRadiusKm: number;
  authProviders: string[]; // available OAuth providers
  phonePrefix: string;
  // Grade hourly rates in local currency
  rates: {
    green: number;
    orange: number;
    red: number;
  };
  // Platform fee percentage
  feePercent: number;
  // License types recognized in this region
  licenseTypes: { id: string; name: string; grade: 'orange' | 'red' }[];
  // Regulatory notes
  regulations: string;
  // Map provider
  mapProvider: 'kakao' | 'google';
  // Active status
  active: boolean;
}

export const REGIONS: Record<string, RegionConfig> = {
  KR: {
    code: 'KR', name: 'South Korea', currency: 'KRW', currencySymbol: '₩',
    timezone: 'Asia/Seoul', defaultLang: 'ko', matchRadiusKm: 3,
    authProviders: ['kakao', 'google'], phonePrefix: '+82',
    rates: { green: 25000, orange: 40000, red: 80000 },
    feePercent: 15,
    licenseTypes: [
      { id: 'caregiver', name: '요양보호사', grade: 'orange' },
      { id: 'social_worker', name: '사회복지사', grade: 'orange' },
      { id: 'childcare_teacher', name: '보육교사', grade: 'orange' },
      { id: 'nurse', name: '간호사', grade: 'red' },
      { id: 'doctor', name: '의사', grade: 'red' },
      { id: 'emt', name: '응급구조사', grade: 'red' },
    ],
    regulations: 'Care worker registration under Ministry of Health and Welfare',
    mapProvider: 'kakao', active: true,
  },
  JP: {
    code: 'JP', name: 'Japan', currency: 'JPY', currencySymbol: '¥',
    timezone: 'Asia/Tokyo', defaultLang: 'ja', matchRadiusKm: 3,
    authProviders: ['google', 'line'], phonePrefix: '+81',
    rates: { green: 2500, orange: 4000, red: 8000 },
    feePercent: 15,
    licenseTypes: [
      { id: 'kaigo_fukushishi', name: '介護福祉士', grade: 'orange' },
      { id: 'home_helper', name: 'ホームヘルパー', grade: 'orange' },
      { id: 'kangoshi', name: '看護師', grade: 'red' },
      { id: 'ishi', name: '医師', grade: 'red' },
      { id: 'kyukyukyumeishi', name: '救急救命士', grade: 'red' },
    ],
    regulations: 'Kaigo Hoken (Long-term Care Insurance) Act compliance',
    mapProvider: 'google', active: true,
  },
  TH: {
    code: 'TH', name: 'Thailand', currency: 'THB', currencySymbol: '฿',
    timezone: 'Asia/Bangkok', defaultLang: 'th', matchRadiusKm: 5,
    authProviders: ['google', 'line'], phonePrefix: '+66',
    rates: { green: 300, orange: 500, red: 1000 },
    feePercent: 15,
    licenseTypes: [
      { id: 'caregiver_th', name: 'ผู้ดูแลผู้สูงอายุ', grade: 'orange' },
      { id: 'nurse_th', name: 'พยาบาล', grade: 'red' },
      { id: 'doctor_th', name: 'แพทย์', grade: 'red' },
    ],
    regulations: 'Thai Elderly Care Act B.E. 2546',
    mapProvider: 'google', active: true,
  },
  VN: {
    code: 'VN', name: 'Vietnam', currency: 'VND', currencySymbol: '₫',
    timezone: 'Asia/Ho_Chi_Minh', defaultLang: 'vi', matchRadiusKm: 5,
    authProviders: ['google'], phonePrefix: '+84',
    rates: { green: 100000, orange: 200000, red: 400000 },
    feePercent: 15,
    licenseTypes: [
      { id: 'caregiver_vn', name: 'Nhân viên chăm sóc', grade: 'orange' },
      { id: 'nurse_vn', name: 'Y tá', grade: 'red' },
      { id: 'doctor_vn', name: 'Bác sĩ', grade: 'red' },
    ],
    regulations: 'Vietnam Law on Elderly No. 39/2009/QH12',
    mapProvider: 'google', active: true,
  },
  ID: {
    code: 'ID', name: 'Indonesia', currency: 'IDR', currencySymbol: 'Rp',
    timezone: 'Asia/Jakarta', defaultLang: 'id', matchRadiusKm: 5,
    authProviders: ['google'], phonePrefix: '+62',
    rates: { green: 75000, orange: 150000, red: 300000 },
    feePercent: 15,
    licenseTypes: [
      { id: 'caregiver_id', name: 'Perawat Lansia', grade: 'orange' },
      { id: 'nurse_id', name: 'Perawat', grade: 'red' },
      { id: 'doctor_id', name: 'Dokter', grade: 'red' },
    ],
    regulations: 'UU No. 13/1998 tentang Kesejahteraan Lanjut Usia',
    mapProvider: 'google', active: true,
  },
  AE: {
    code: 'AE', name: 'UAE', currency: 'AED', currencySymbol: 'د.إ',
    timezone: 'Asia/Dubai', defaultLang: 'ar', matchRadiusKm: 5,
    authProviders: ['google'], phonePrefix: '+971',
    rates: { green: 100, orange: 200, red: 400 },
    feePercent: 15,
    licenseTypes: [
      { id: 'caregiver_ae', name: 'مقدم رعاية', grade: 'orange' },
      { id: 'nurse_ae', name: 'ممرض/ة', grade: 'red' },
      { id: 'doctor_ae', name: 'طبيب', grade: 'red' },
    ],
    regulations: 'UAE Federal Decree-Law on Senior Citizens Rights',
    mapProvider: 'google', active: true,
  },
  SA: {
    code: 'SA', name: 'Saudi Arabia', currency: 'SAR', currencySymbol: '﷼',
    timezone: 'Asia/Riyadh', defaultLang: 'ar', matchRadiusKm: 5,
    authProviders: ['google'], phonePrefix: '+966',
    rates: { green: 100, orange: 200, red: 400 },
    feePercent: 15,
    licenseTypes: [
      { id: 'caregiver_sa', name: 'مقدم رعاية', grade: 'orange' },
      { id: 'nurse_sa', name: 'ممرض/ة', grade: 'red' },
    ],
    regulations: 'Saudi Vision 2030 healthcare reform',
    mapProvider: 'google', active: true,
  },
};

export function getRegion(code: string): RegionConfig {
  return REGIONS[code.toUpperCase()] || REGIONS.KR;
}

export function getRegionByLang(lang: string): RegionConfig {
  const langToRegion: Record<string, string> = {
    ko: 'KR', ja: 'JP', th: 'TH', vi: 'VN', id: 'ID', ar: 'AE',
  };
  return REGIONS[langToRegion[lang] || 'KR'] || REGIONS.KR;
}

export function formatCurrency(amount: number, regionCode: string): string {
  const r = getRegion(regionCode);
  return `${r.currencySymbol}${amount.toLocaleString()}`;
}

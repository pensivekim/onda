/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // 2026-11-23 제노믹 공통 디자인(genomic-biz\디자인_공통) — 홈페이지 결. 이름은 그대로, 값만 공통으로
      colors: {
        primary: '#0E2B2C',            // 밤 초록: 주요 단추
        'primary-container': '#285051',
        'on-primary': '#ffffff',
        surface: '#EEF2F0',            // 안개
        'surface-low': '#F4F7F5',
        'surface-card': '#ffffff',
        'surface-high': '#E1E8E4',
        'on-surface': '#172322',       // 먹
        'on-surface-variant': '#5E6D6A',
        secondary: '#4F8A7E',          // 차분한 초록
        'secondary-container': '#E6F1EC',
        error: '#B83A26',              // 위험·긴급(SOS·119)에만
        'error-container': '#F8E4DE',
        'trust-green': '#286647',
        'trust-green-bg': '#E6F1EA',
        'orange-grade': '#795616',
        'orange-grade-bg': '#FBF1DE',
        amber: '#E3A23B',              // 호박: 강조
      },
      fontFamily: {
        display: ['"IBM Plex Sans KR"', '"Pretendard Variable"', 'sans-serif'],
        body: ['"Pretendard Variable"', 'Pretendard', '"Apple SD Gothic Neo"', '"Malgun Gothic"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '1rem',
      },
      keyframes: {
        pulse_sos: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(184,58,38,0.5)' },
          '50%': { boxShadow: '0 0 0 20px rgba(184,58,38,0)' },
        },
      },
      animation: {
        'pulse-sos': 'pulse_sos 2s infinite',
      },
    },
  },
  plugins: [],
}

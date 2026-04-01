/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#b7102a',
        'primary-container': '#db313f',
        'on-primary': '#ffffff',
        surface: '#f8f9fa',
        'surface-low': '#f3f4f5',
        'surface-card': '#ffffff',
        'surface-high': '#e8e9eb',
        'on-surface': '#191c1d',
        'on-surface-variant': '#6b6e70',
        secondary: '#445a7f',
        'secondary-container': '#bbd3fd',
        error: '#93000a',
        'error-container': '#ffdad6',
        'trust-green': '#2e7d32',
        'trust-green-bg': '#e8f5e9',
        'orange-grade': '#b45e00',
        'orange-grade-bg': '#fff3e0',
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'sans-serif'],
        body: ['Manrope', 'sans-serif'],
      },
      borderRadius: {
        card: '1rem',
      },
      keyframes: {
        pulse_sos: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(183,16,42,0.5)' },
          '50%': { boxShadow: '0 0 0 20px rgba(183,16,42,0)' },
        },
      },
      animation: {
        'pulse-sos': 'pulse_sos 2s infinite',
      },
    },
  },
  plugins: [],
}

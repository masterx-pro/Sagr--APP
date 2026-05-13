/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cameriere: '#1565C0',
        bar: '#E65100',
        cucina: '#B71C1C',
        admin: '#4A148C',
        sfondo: '#1a1a2e',
        pannello: '#16213e',
        bordo: '#0f3460'
      },
      minHeight: {
        'btn': '48px'
      },
      screens: {
        'mobile-landscape': { 'raw': '(orientation: landscape) and (max-height: 500px)' }
      }
    }
  },
  plugins: []
}

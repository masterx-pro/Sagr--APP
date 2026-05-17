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
        // ── Legacy aliases (back-compat con index.css esistente) ──
        cameriere: '#A0302C',
        bar:       '#B8541F',
        cucina:    '#8B2120',
        admin:     '#5A3A7A',
        cassa:     '#2D7A3E',
        sfondo:    '#1A0F0A',
        pannello:  '#2A1A14',
        bordo:     '#5C3D2E',

        // ── Dark palette (token nuovi) ──
        bg:           '#1A0F0A',
        surface:      '#2A1A14',
        surfaceElev:  '#3A2318',
        surfaceHi:    '#4A2E22',
        border:       '#5C3D2E',
        borderSoft:   '#3F2A1F',
        divider:      'rgba(196,168,130,0.12)',
        text:         '#FAF5EA',
        textSoft:     '#C4A882',
        textMute:     '#8A6E55',
        textDim:      '#6A5340',
        wine:         '#A0302C',
        wineDeep:     '#7A1B1B',
        wineSoft:     'rgba(160,48,44,0.18)',
        gold:         '#D4A043',
        goldDeep:     '#A07A2C',
        goldSoft:     'rgba(212,160,67,0.16)',
        success:      '#3AAA52',
        successSoft:  'rgba(58,170,82,0.16)',
        successInk:   '#2A7A3E',
        warning:      '#F0A820',
        warningSoft:  'rgba(240,168,32,0.16)',
        warningInk:   '#8A5E08',
        danger:       '#E84040',
        dangerSoft:   'rgba(232,64,64,0.16)',
        dangerInk:    '#8A1818',
        info:         '#4FB0E8',
        infoSoft:     'rgba(79,176,232,0.16)',

        // ── Role gradient stops ──
        'role-cameriere-from': '#A0302C',
        'role-cameriere-to':   '#5C1212',
        'role-cucina-from':    '#8B2120',
        'role-cucina-to':      '#3E0A0A',
        'role-bar-from':       '#B8541F',
        'role-bar-to':         '#5C2410',
        'role-cassa-from':     '#2D7A3E',
        'role-cassa-to':       '#143E1F',
        'role-admin-from':     '#5A3A7A',
        'role-admin-to':       '#2A1845',
      },
      fontFamily: {
        display: ['"DM Serif Display"', 'Georgia', '"Times New Roman"', 'serif'],
        ui:      ['Manrope', '-apple-system', 'system-ui', 'sans-serif'],
        sans:    ['Manrope', '-apple-system', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', '"SF Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        btn:     '12px',
        badge:   '8px',
        card:    '16px',
        'card-lg': '18px',
        sheet:   '24px',
        fab:     '22px',
        phone:   '999px',
      },
      boxShadow: {
        sm:    '0 1px 2px rgba(40,15,8,0.4)',
        md:    '0 4px 14px rgba(40,15,8,0.5)',
        lg:    '0 12px 30px rgba(40,15,8,0.55)',
        cta:   '0 8px 24px rgba(212,160,67,0.5)',
        alert: '0 0 0 1px rgba(232,64,64,0.4), 0 6px 18px rgba(232,64,64,0.18)',
        wine:  '0 0 0 1px rgba(160,48,44,0.5), 0 6px 18px rgba(160,48,44,0.25)',
      },
      keyframes: {
        pulseDot: {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%':       { transform: 'scale(1.7)', opacity: '0.55' },
        },
        pulseRing: {
          '0%':   { boxShadow: '0 0 0 0 rgba(58,170,82,0.5)' },
          '70%':  { boxShadow: '0 0 0 14px rgba(58,170,82,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(58,170,82,0)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.45' },
        },
        pulseUrgent: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(232,64,64,0.55)' },
          '50%':      { boxShadow: '0 0 0 8px rgba(232,64,64,0)' },
        },
      },
      animation: {
        pulseDot:    'pulseDot 1.6s ease-in-out infinite',
        pulseRing:   'pulseRing 1.8s ease-out infinite',
        blink:       'blink 1.6s ease-in-out infinite',
        pulseUrgent: 'pulseUrgent 1.4s ease-in-out infinite',
      },
      minHeight: {
        btn: '48px',
      },
      screens: {
        'mobile-landscape': { 'raw': '(orientation: landscape) and (max-height: 500px)' }
      },
    }
  },
  plugins: []
}

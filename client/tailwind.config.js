/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Geist Variable"', '"Geist"', '"Inter"', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Geist Mono Variable"', '"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        page: 'var(--page-bg)',
        'page-2': 'var(--page-bg-secondary)',
        nav: 'var(--nav-blue)',
        'nav-hover': 'var(--nav-hover)',
        navy: 'var(--hero-navy)',
        'navy-alt': 'var(--hero-navy-alt)',
        primary: 'var(--primary-blue)',
        'primary-hover': 'var(--primary-hover)',
        electric: 'var(--electric-blue)',
        bright: 'var(--bright-blue)',
        deep: 'var(--deep-blue)',
        card: 'var(--card-bg)',
        ink: 'var(--text-dark)',
        'ink-2': 'var(--text-medium)',
        muted: 'var(--text-muted)',
        line: 'var(--line)',
        amber: 'var(--amber)',
        warning: 'var(--warning)',
        success: 'var(--success)',
        danger: 'var(--danger)',
        tint: 'var(--tint)',
      },
      boxShadow: {
        card: '0 8px 18px rgba(35,55,75,.10)',
        'card-hover': '0 12px 24px rgba(35,55,75,.13)',
        hero: '0 10px 24px rgba(20,38,52,.20)',
        pill: '0 6px 14px rgba(79,143,216,.30)',
        'pill-hover': '0 10px 20px rgba(62,127,199,.34)',
      },
      borderRadius: {
        card: '14px',
        hero: '20px',
      },
      maxWidth: {
        page: '1240px',
      },
    },
  },
  plugins: [],
};

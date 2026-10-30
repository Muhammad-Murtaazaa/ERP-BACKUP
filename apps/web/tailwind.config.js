/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        surface: {
          DEFAULT: 'var(--surface)',
          raised: 'var(--surface-raised)',
          strong: 'var(--surface-strong)',
          muted: 'var(--surface-muted)',
          subtle: 'var(--surface-raised)',
          lavender: 'var(--lime-soft)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          muted: 'var(--ink-muted)',
          subtle: 'var(--ink-subtle)',
          faint: 'var(--ink-faint)',
        },
        lime: {
          DEFAULT: 'var(--lime)',
          soft: 'var(--lime-soft)',
          line: 'var(--lime-line)',
          tint: 'var(--lime-tint)',
        },
        'on-lime': 'var(--on-lime)',
        'pill-bg': 'var(--pill-bg)',
        'pill-ink': 'var(--pill-ink)',
        'paper-bg': 'var(--paper-bg)',
        'paper-line': 'var(--paper-line)',

        // Backwards compatibility mappings for older views
        brand: {
          DEFAULT: 'var(--lime)',
          hover: 'var(--lime)',
          focus: 'var(--lime)',
        },
        'text-primary': 'var(--ink)',
        'text-secondary': 'var(--ink-muted)',
        'text-muted': 'var(--ink-subtle)',
        'border-decorative': 'var(--line)',
        'border-control': 'var(--line-strong)',
        status: {
          'success-text': 'var(--positive)',
          'success-surface': 'var(--positive-soft)',
          'warning-text': 'var(--warning)',
          'warning-surface': 'var(--warning-soft)',
          'danger-text': 'var(--danger)',
          'danger-surface': 'var(--danger-soft)',
          'info-text': 'var(--info)',
          'info-surface': 'var(--info-soft)',
        },
      },
      fontFamily: {
        sans: ['"Instrument Sans"', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      borderRadius: {
        none: '0px',
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
        '3xl': '24px',
        full: '9999px',
      },
      boxShadow: {
        float: 'var(--shadow-float)',
      },
    },
  },
  plugins: [],
};

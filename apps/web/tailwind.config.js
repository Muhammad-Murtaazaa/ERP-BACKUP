/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#F7F8FC',
        surface: '#FFFFFF',
        'surface-subtle': '#F1F4F9',
        'surface-lavender': '#F2EEFF',
        brand: {
          DEFAULT: '#5940B8',
          hover: '#463091',
          focus: '#5B3CC4',
        },
        'text-primary': '#182235',
        'text-secondary': '#46536B',
        'text-muted': '#5E6A7D',
        'border-decorative': '#D9DFEA',
        'border-control': '#7D8799',
        status: {
          'success-text': '#146341',
          'success-surface': '#EAF7EF',
          'warning-text': '#7A4700',
          'warning-surface': '#FFF4D6',
          'danger-text': '#A82430',
          'danger-surface': '#FDECEF',
          'info-text': '#234FA3',
          'info-surface': '#EDF3FF',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

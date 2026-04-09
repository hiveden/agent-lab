import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'ag-bg': '#0f1117',
        'ag-surface': '#161b22',
        'ag-border': '#21262d',
        'ag-text': '#e6edf3',
        'ag-text-2': '#8b949e',
      },
    },
  },
  plugins: [],
};

export default config;

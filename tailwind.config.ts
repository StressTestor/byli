import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Body + UI: Inter. Headlines + wordmark: Geist (display).
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-geist-sans)', 'var(--font-inter)', 'ui-sans-serif', 'sans-serif'],
      },
      colors: {
        // Single flat, desaturated indigo (~25% less saturation than indigo-400).
        // Used sparingly: wordmark mark, active state, links/hover, focus rings.
        // No gradients, no glow. Opacity modifiers (bg-accent/15) for surfaces.
        accent: {
          DEFAULT: '#8b8fdb',
          bright: '#a6a9e6',
          dim: '#6e72c4',
        },
      },
    },
  },
  plugins: [],
};

export default config;

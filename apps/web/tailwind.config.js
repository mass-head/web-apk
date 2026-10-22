/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        xs: '420px',
      },
      colors: {
        brand: {
          pine: '#12372A',
          moss: '#285943',
          gold: '#E9C46A',
          cream: '#F7F4EA',
          dark: '#202820',
        },
        midnight: {
          950: '#202820',
          900: '#12372A',
          850: '#153d2f',
          800: '#1c4938',
          750: '#225240',
          700: '#285943',
          600: '#346d53',
        },
        pine: {
          950: '#0c1b14',
          900: '#12372A',
          800: '#173d2f',
          700: '#1f4c3a',
          600: '#285943',
          500: '#347257',
        },
        moss: {
          900: '#18382b',
          800: '#204737',
          700: '#285943',
          600: '#357156',
          500: '#438b6b',
        },
        gold: {
          300: '#f6e4a8',
          400: '#edd284',
          500: '#E9C46A',
          600: '#d7af4e',
          700: '#b88f36',
        },
        cream: {
          50: '#F7F4EA',
          100: '#f0ecdc',
          200: '#e3dcbe',
          300: '#cec39a',
          400: '#b5a77c',
        },
        // Mapped aliases to ensure design uniformity across all components
        violet: {
          300: '#F7F4EA',
          400: '#E9C46A',
          500: '#285943',
          600: '#12372A',
          700: '#102e23',
        },
        cyan: {
          300: '#F7F4EA',
          400: '#E9C46A',
          500: '#d7af4e',
          600: '#285943',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
      },
      boxShadow: {
        'glow-gold': '0 0 25px -4px rgba(233, 196, 106, 0.45)',
        'glow-moss': '0 0 25px -4px rgba(40, 89, 67, 0.5)',
        'glow-pine': '0 0 25px -4px rgba(18, 55, 42, 0.6)',
        'glow-violet': '0 0 25px -4px rgba(233, 196, 106, 0.35)',
        'glow-cyan': '0 0 25px -4px rgba(233, 196, 106, 0.35)',
        'card': '0 8px 30px -4px rgba(18, 55, 42, 0.4), 0 0 0 1px rgba(40, 89, 67, 0.45)',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}

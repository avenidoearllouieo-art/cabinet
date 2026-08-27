/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        taptrack: {
          navy: '#0B1F3A',
          gold: '#F5B700',
          'gold-hover': '#D99E00',
          surface: '#F8FAFC',
          stripe: '#F9FAFB',
        },
      },
    },
  },
  plugins: [],
}

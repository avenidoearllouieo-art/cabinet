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
          navy: '#002B5B',
          gold: '#FFC107',
          'gold-hover': '#E0A800',
          surface: '#FFFFFF',
          stripe: '#FFFFFF',
        },
      },
    },
  },
  plugins: [],
}

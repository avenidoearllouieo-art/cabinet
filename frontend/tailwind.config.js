/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    screens: {
      sm: '600px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
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

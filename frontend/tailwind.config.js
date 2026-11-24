/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#1E3A8A",
        primarySoft: "#1D4ED8",
        surface: "#0B1220"
      }
    }
  },
  plugins: []
};

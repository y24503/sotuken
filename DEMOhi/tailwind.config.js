/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./script.js",
    "./src/**/*.{html,js}"
  ],
  theme: {
    extend: {
      fontFamily: {
        'tech-mono': ['Share Tech Mono', 'monospace'],
        'orbitron': ['Orbitron', 'monospace'],
        'fzgonta': ['FZGontaKana', 'sans-serif']
      }
    },
  },
  plugins: [
    // line-clamp は v3.3+ で標準搭載のため不要
  ],
}
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev: Vite on :5173 proxies /api to the career-ops server. The server's
// CSRF guard only accepts its own Host/Origin, so the proxy rewrites both.
const API = 'http://127.0.0.1:3700'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    proxy: { '/api': { target: API, changeOrigin: true, headers: { origin: API } } },
  },
})

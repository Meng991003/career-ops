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
    proxy: {
      '/api': {
        target: API,
        changeOrigin: true,
        configure: proxy => proxy.on('proxyReq', (proxyReq, req) => {
          // Only our own dev page may write: rewrite its Origin to the server's;
          // strip any other, so the server's guard rejects foreign writes (403).
          if (/^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(req.headers.origin ?? '')) proxyReq.setHeader('origin', API)
          else proxyReq.removeHeader('origin')
        }),
      },
    },
  },
})

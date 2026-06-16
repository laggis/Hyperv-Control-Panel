import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    hmr: {
      // When behind a TLS-terminating reverse proxy (e.g. Zoraxy / Nginx / Cloudflare),
      // the browser connects to the proxy on 443 over wss, but Vite itself listens
      // on plain ws:5173.  Set VITE_HMR_CLIENT_PORT=443 so the browser points at
      // the proxy, and leave the protocol as 'wss' for the proxied connection.
      // Without a proxy (local dev only), set VITE_HMR_PROTOCOL=ws to avoid
      // ERR_SSL_PROTOCOL_ERROR on port 5173.
      host: process.env.VITE_HMR_HOST || undefined,
      port: Number(process.env.VITE_HMR_PORT || 5173),
      protocol: process.env.VITE_HMR_PROTOCOL || 'ws',   // default to plain ws — safe for both local and proxied setups
      clientPort: process.env.VITE_HMR_CLIENT_PORT
        ? Number(process.env.VITE_HMR_CLIENT_PORT)
        : undefined,
    },
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      'vps.penguinhosting.host',
      '81.16.177.72',
    ],
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://81.16.177.72:3001',
        changeOrigin: true,
        ws: true,
      }
    }
  }
})

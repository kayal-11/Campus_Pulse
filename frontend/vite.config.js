import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendUrl = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8001'
const backendWsUrl = backendUrl.replace(/^http/i, 'ws')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backendUrl,
      '/ws': { target: backendWsUrl, ws: true },
      '/predict': backendUrl,
    },
  },
})

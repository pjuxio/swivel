import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // In dev, `npm run dev:api` serves /api on port 3001
  server: { proxy: { '/api': 'http://localhost:3001' } },
})

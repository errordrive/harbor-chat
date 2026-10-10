import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build output goes straight into ../public, which server.js serves.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
})

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  base: './', // relative asset paths so the built app works on any static host
  server: { port: 5173 },
})

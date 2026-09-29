import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths, so the build works from any sub-path (e.g. GitHub Pages /planbreeze/).
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Listen on all network interfaces so other devices on the LAN can open the app.
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
})

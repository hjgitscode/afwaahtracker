import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React app never talks to Oracle: every request goes to the Express API.
// In development /api is proxied to http://localhost:3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY || 'http://localhost:3000', changeOrigin: true },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY || 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});

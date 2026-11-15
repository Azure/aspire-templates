import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    proxy: {
      '/api': {
        target: process.env.SERVER_HTTPS || process.env.SERVER_HTTP || 'http://localhost:5384',
        changeOrigin: true,
      },
      '/realtime': {
        target: process.env.SERVER_HTTPS || process.env.SERVER_HTTP || 'http://localhost:5384',
        changeOrigin: true,
      },
    },
  },
});

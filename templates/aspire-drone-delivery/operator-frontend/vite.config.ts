import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Aspire passes OTLP settings to the dev server (WithOtlpExporter). The browser only learns the service
// name; the dashboard endpoint and API key stay in this process behind the /otlp proxy.
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const otlpHeaders = Object.fromEntries((process.env.OTEL_EXPORTER_OTLP_HEADERS ?? '')
  .split(',').map(pair => pair.split('=')).filter(([key, value]) => key && value)
  .map(([key, value]) => [key.trim(), decodeURIComponent(value.trim())]));
const otlpAttributes = Object.fromEntries((process.env.OTEL_RESOURCE_ATTRIBUTES ?? '')
  .split(',').map(pair => pair.split('=')).filter(([key, value]) => key && value));

export default defineConfig({
  plugins: [react()],
  define: {
    __OTEL__: JSON.stringify(otlpEndpoint
      ? { serviceName: process.env.OTEL_SERVICE_NAME ?? 'operator-site', attributes: otlpAttributes } : null),
  },
  resolve: { dedupe: ['react', 'react-dom', 'three'] },
  server: {
    proxy: {
      ...(otlpEndpoint ? {
        '/otlp': {
          target: otlpEndpoint, changeOrigin: true, headers: otlpHeaders,
          rewrite: (path: string) => path.replace(/^\/otlp/, ''),
        },
      } : {}),
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

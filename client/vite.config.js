import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// firmgate.io serves this under /finops — normalise env so Vite + router agree
function normalizeBase(raw) {
  const value = (raw || '/').trim();
  if (!value || value === '/') return '/';
  const withSlash = value.startsWith('/') ? value : `/${value}`;
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

const base = normalizeBase(process.env.VITE_BASE_PATH || process.env.BASE_PATH || '/');

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Dev only — prod firmgate/nginx terminates /finops and /finops/api separately
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});

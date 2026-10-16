import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8000' } },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});

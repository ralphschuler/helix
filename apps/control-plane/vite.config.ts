import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    outDir: 'dist/client',
    rollupOptions: {
      input: 'src/entry-client.tsx',
    },
  },
});

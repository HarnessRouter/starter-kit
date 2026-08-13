import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from the HarnessRouter image at /kits/sheets (see docker/install-kits.sh), so assets
// must be requested from there rather than from the root.
export default defineConfig({
  base: '/kits/sheets/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});

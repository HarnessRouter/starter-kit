import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { KIT_BASE } from './src/lib/kit.js';

// Served from the HarnessRouter image at /kits/<kit> (see docker/install-kits.sh), so assets must
// be requested from there rather than from the root.
export default defineConfig({
  base: KIT_BASE,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});

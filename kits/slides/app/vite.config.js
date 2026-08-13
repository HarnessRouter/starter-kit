import { copyFileSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The template library is kit data, not app data — it lives at kits/slides/templates/ and is the
// one copy. Staging it into public/ at build time is what makes it reachable at
// /kits/slides/templates.json without committing a second three-megabyte copy of it.
const stageTemplates = {
  name: 'stage-templates',
  buildStart() {
    mkdirSync('public', { recursive: true });
    copyFileSync('../templates/templates.json', 'public/templates.json');
  },
};

// Served from the HarnessRouter image at /kits/slides (see docker/install-kits.sh), so assets
// must be requested from there rather than from the root.
export default defineConfig({
  base: '/kits/slides/',
  plugins: [react(), stageTemplates],
  build: { outDir: 'dist', emptyOutDir: true },
});

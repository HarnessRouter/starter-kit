import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The template library is kit data, not app data — it lives at kits/dashboard/templates/ and is
// the one copy. Staging it into public/ at build time is what makes it reachable at
// /kits/dashboard/templates.json without committing a second copy of it.
const stageTemplates = {
  name: 'stage-templates',
  buildStart() {
    mkdirSync('public', { recursive: true });
    copyFileSync('../templates/templates.json', 'public/templates.json');
    // The card thumbnails are kit data too — captured pictures of each template's board, staged
    // the same way and for the same reason. Optional: a checkout without them still builds, and
    // the card falls back to the layout shape rather than a broken image.
    if (existsSync('../templates/thumbs')) {
      cpSync('../templates/thumbs', 'public/templates', { recursive: true });
    }
  },
};

// Served from the HarnessRouter image at /kits/dashboard (see docker/install-kits.sh), so assets
// must be requested from there rather than from the root.
export default defineConfig({
  base: '/kits/dashboard/',
  plugins: [react(), stageTemplates],
  build: { outDir: 'dist', emptyOutDir: true },
});

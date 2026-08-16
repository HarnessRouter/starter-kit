import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { KIT_BASE, KIT_ID } from './src/lib/kit.js';

// The template library is kit data, not app data — it lives at kits/<kit>/templates/ and is the
// one copy. Staging it into public/ at build time is what makes it reachable at
// /kits/<kit>/templates.json without committing a second copy of it.
//
// The library is written by whoever owns the kit folder, not by this app. When it is not there
// yet the build still has to produce a working app, so it stages an empty library and says so:
// the landing already renders "No templates are installed with this kit", which is the honest
// screen for exactly this situation. What it must never do is fail silently — hence the warning.
const stageTemplates = {
  name: 'stage-templates',
  buildStart() {
    mkdirSync('public', { recursive: true });
    const src = '../templates/templates.json';
    if (existsSync(src)) { cpSync(src, 'public/templates.json'); } else {
      this.warn(`${src} does not exist — building with an empty template library.`);
      writeFileSync('public/templates.json', '{"templates":[]}\n');
    }
    // The reference frames travel with the library for the same reason it does: they are kit
    // data, written by whoever owns the kit folder, and public/ is generated. A template that
    // names a frame which is not staged renders a blank card, so a missing folder is said out
    // loud rather than discovered as five empty rectangles.
    const refs = '../templates/reference';
    if (existsSync(refs)) cpSync(refs, 'public/templates', { recursive: true });
    else this.warn(`${refs} does not exist — templates will show their shape instead of a frame.`);
  },
};

// Excalidraw loads its fonts at run time from `window.EXCALIDRAW_ASSET_PATH` (set in main.jsx),
// resolving paths like `fonts/Excalifont/Excalifont-Regular-<hash>.woff2` against it. Without the
// files under our own base it falls back to unpkg — a third-party network call from a console
// that has to work on a box with no route to the internet.
//
// Three families, not the nine that ship: Xiaolai alone is 12 MB of the 13 MB folder and is only
// reached by CJK text in the hand-drawn font. These are the three the default toolbar can pick.
// (Cascadia, the code font, is deliberately not staged; a code-font caption falls back to the
// system monospace rather than 404-ing anything the canvas needs.)
const FONT_FAMILIES = ['Excalifont', 'Nunito', 'Virgil'];

const stageExcalidrawFonts = {
  name: 'stage-excalidraw-fonts',
  buildStart() {
    const from = 'node_modules/@excalidraw/excalidraw/dist/prod/fonts';
    for (const family of FONT_FAMILIES) {
      const src = `${from}/${family}`;
      if (!existsSync(src)) { this.warn(`${src} is missing — Excalidraw will fall back to a CDN for ${family}.`); continue; }
      mkdirSync(`public/fonts/${family}`, { recursive: true });
      cpSync(src, `public/fonts/${family}`, { recursive: true });
    }
  },
};

// Served from the HarnessRouter image at /kits/<kit> (see docker/install-kits.sh), so assets must
// be requested from there rather than from the root.
export default defineConfig({
  base: KIT_BASE,
  plugins: [react(), stageTemplates, stageExcalidrawFonts],
  build: { outDir: 'dist', emptyOutDir: true },
});

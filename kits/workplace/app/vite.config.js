import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { KIT_BASE } from './src/lib/kit.js';

// The teammate package is kit data, not app data: it lives at kits/workplace/teammate-plugin/ as
// an ordinary Agent Plugins folder anyone can read, and the app installs it on every teammate it
// creates. The app cannot read a folder at run time, so the build stages the package into public/
// as one JSON file — the exact `files` array POST /v1/harnesses takes — and the app fetches that.
// Generated, never committed: the folder is the one copy.
function packageFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: relative(root, p).split('\\').join('/'), content: readFileSync(p, 'utf8') });
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const stageTeammatePackage = {
  name: 'stage-teammate-package',
  buildStart() {
    mkdirSync('public', { recursive: true });
    const src = '../teammate-plugin';
    if (!existsSync(join(src, 'plugin.json'))) {
      // A missing package is a kit that cannot make teammates. Said out loud at build time,
      // not discovered as a 400 from the gateway on the first "Add to workplace".
      this.error(`${src}/plugin.json does not exist — the app cannot install teammates without it.`);
    }
    writeFileSync('public/teammate-plugin.json', JSON.stringify({ files: packageFiles(src) }));
  },
};

export default defineConfig({
  base: KIT_BASE,
  plugins: [stageTeammatePackage, react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist', emptyOutDir: true },
});

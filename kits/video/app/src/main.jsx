import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { KIT_BASE } from './lib/kit.js';
import 'highlight.js/styles/atom-one-dark.css';
import '@excalidraw/excalidraw/index.css';
import 'reifyui/styles/panels.css';
import 'reifyui/styles/chat.css';
import 'reifyui/styles/dialog.css';
import 'reifyui/styles/form.css';
import 'reifyui/styles/file.css';
import 'reifyui/styles/library.css';
import 'reifyui/styles/chip.css';
import 'reifyui/styles/preview.css';
import 'reifyui/styles/timeline.css';
import './styles/tokens.css';
import './styles/app.css';

// Before the first render, and before anything can ask for a glyph. Excalidraw resolves its fonts
// against this; without it they are fetched from a CDN, which is a third-party network call from a
// console that has to work on a box with no route to the internet. The files are staged into
// public/fonts at build time (vite.config.js).
window.EXCALIDRAW_ASSET_PATH = KIT_BASE;

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);

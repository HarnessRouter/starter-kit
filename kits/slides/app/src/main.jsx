import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogHost } from 'reifyui';
import App from './App.jsx';
import 'highlight.js/styles/atom-one-dark.css';
// The package paints every shared surface this app uses: the slide renderer, the conversation
// column, the library page (carousel / card / search / table), chips and popovers, the Modal
// shell, and the in-app alert/confirm that replace the browser's own popups. styles/app.css
// below carries only what is left — the parts that are Slides'.
import 'reifyui/styles/slides.css';
import 'reifyui/styles/chat.css';
import 'reifyui/styles/library.css';
import 'reifyui/styles/chip.css';
import 'reifyui/styles/preview.css';
import 'reifyui/styles/dialog.css';
import './styles/tokens.css';
import './styles/app.css';

// One DialogHost at the root: useDialog() anywhere below awaits a real in-app dialog instead of
// a native popup, and several open at once stack rather than trample each other.
createRoot(document.getElementById('root')).render(
  <StrictMode><DialogHost><App /></DialogHost></StrictMode>,
);

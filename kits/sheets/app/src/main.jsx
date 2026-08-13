import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import 'highlight.js/styles/atom-one-dark.css';
import 'reifyui/styles/sheet.css';
import 'reifyui/styles/chat.css';
import 'reifyui/styles/dialog.css';
import './styles/tokens.css';
import './styles/app.css';

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);

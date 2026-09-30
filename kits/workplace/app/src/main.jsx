import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import 'reifyui/styles/chat.css';
import 'reifyui/styles/dialog.css';
import 'reifyui/styles/form.css';
import 'reifyui/styles/file.css';
import 'reifyui/styles/chip.css';
import 'reifyui/styles/preview.css';
import 'reifyui/styles/mention.css';
import './styles/tokens.css';
import './styles/app.css';

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app.jsx';
import 'reifyui/styles/sheet.css';
import 'reifyui/styles/chat.css';
import './styles/tokens.css';
import './styles/app.css';

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);

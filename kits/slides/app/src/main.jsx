import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import 'reifyui/styles/slides.css';
import 'reifyui/styles/chat.css';
import './styles/tokens.css';
import './styles/app.css';

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);

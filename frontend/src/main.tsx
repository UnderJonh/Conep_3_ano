import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/orbitron/latin-800.css';
import './styles.css';
import './game.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

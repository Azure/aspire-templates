import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startTelemetry } from './telemetry';
import './theme.css';
import './styles.css';

startTelemetry();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

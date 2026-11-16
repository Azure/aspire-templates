import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startTelemetry } from './telemetry';
import './styles.css';

// Start tracing first so the initial snapshot fetch joins a trace; render regardless of the outcome.
void startTelemetry().finally(() =>
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>));

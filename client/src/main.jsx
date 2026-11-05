import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './style.css';
import { AuthProvider } from './context/AuthContext.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode><ErrorBoundary root><AuthProvider><App /></AuthProvider></ErrorBoundary></React.StrictMode>,
);

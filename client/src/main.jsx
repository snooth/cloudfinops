import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Strip trailing slash off Vite BASE_URL so BrowserRouter basename is "/finops" not "/finops/"
const basename = (import.meta.env.BASE_URL || '/')
  .replace(/\/+$/, '') || undefined;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);


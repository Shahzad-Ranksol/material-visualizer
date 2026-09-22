import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { StorefrontPage } from './components/StorefrontPage';
import { LandingPage } from './components/LandingPage';
import { AdminPage } from './components/AdminPage';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/studio" element={<App />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/store/:slug" element={<StorefrontPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

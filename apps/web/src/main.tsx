import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queries';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import { App } from './App';
import './design/tokens.css';
import './style.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

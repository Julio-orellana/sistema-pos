import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles/global.css';

const contenedor = document.getElementById('raiz');
if (contenedor === null) {
  throw new Error('No se encontró el elemento #raiz en index.html.');
}

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

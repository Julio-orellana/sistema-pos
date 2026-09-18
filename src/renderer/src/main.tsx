import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { instalarDesplazamientoPorArrastre } from './desplazamiento/desplazamiento-por-arrastre';
import './styles/global.css';

const contenedor = document.getElementById('raiz');
if (contenedor === null) {
  throw new Error('No se encontró el elemento #raiz en index.html.');
}

// Arrastrar para desplazar también cuando el dedo llega como mouse (§4.62).
instalarDesplazamientoPorArrastre(document);

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

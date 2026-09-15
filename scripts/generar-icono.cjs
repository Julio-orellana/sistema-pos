#!/usr/bin/env node
/**
 * Genera el ícono de la aplicación: `build/icon.png` y `build/icon.ico`.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ UN GUION Y NO UN ARCHIVO SUELTO
 * ---------------------------------------------------------------------------
 * El ícono es lo primero que Jimmy ve en su escritorio, así que no puede ser
 * el rombo genérico de Electron. Pero tampoco hay un diseñador en este
 * proyecto, así que se dibuja con lo que ya hay: **HTML y el Chromium que
 * Electron empaqueta**, el mismo criterio con que el recibo se maqueta en HTML
 * y no con una librería de PDF (§5). Queda en un guion, y no como un `.png`
 * pegado en el repositorio, para que se pueda volver a generar y para que el
 * dibujo se pueda leer y discutir: es código, no un binario opaco.
 *
 * Uso:  npm run icono
 *
 * ---------------------------------------------------------------------------
 * EL .ICO SE ESCRIBE ACÁ, A MANO, Y ES DELIBERADO
 * ---------------------------------------------------------------------------
 * Windows quiere un `.ico`, que es un contenedor de varios tamaños. Desde
 * Windows Vista un `.ico` puede llevar cada tamaño como un PNG completo
 * adentro, así que el formato se reduce a una cabecera de 6 bytes más una
 * entrada de 16 por imagen. Escribirlo acá evita agregar una dependencia
 * (`png-to-ico`, `sharp`) para 40 líneas, que es la misma decisión que §4.33
 * tomó para redimensionar las fotos con `nativeImage` en vez de sumar `sharp`.
 *
 * Los tamaños son los que Windows usa de verdad: 16 y 32 para la barra de
 * tareas y las listas, 48 para el escritorio, 64 y 128 para vistas grandes,
 * 256 para el explorador en «iconos extra grandes» y para el instalador.
 */
'use strict';

const { app, BrowserWindow, nativeImage } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const RAIZ = join(__dirname, '..');
const CARPETA = join(RAIZ, 'build');
const LADO = 512;
const TAMANOS_DEL_ICO = [16, 32, 48, 64, 128, 256];

/*
  El dibujo. Un saco de grano abierto, que es lo que la tienda vende, sobre el
  verde del tema de la aplicación. Sin texto: un ícono de 16 px con letras es
  una mancha, y el nombre ya va debajo del ícono en Windows.

  Los colores salen de la paleta de la pantalla de venta (§4.12) para que el
  ícono y la aplicación se vean de la misma familia.
*/
const DIBUJO = `
<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; width: ${LADO}px; height: ${LADO}px; background: transparent; }
  svg { display: block; }
</style>
<svg width="${LADO}" height="${LADO}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fondo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#16a34a"/>
      <stop offset="100%" stop-color="#15803d"/>
    </linearGradient>
  </defs>

  <!-- El cuadrado redondeado del fondo: la forma que Windows espera. -->
  <rect x="16" y="16" width="480" height="480" rx="104" fill="url(#fondo)"/>

  <!-- El saco: cuerpo, boca doblada y el grano que asoma. -->
  <path d="M176 196 h160 c14 0 24 12 21 26 l-30 168 c-3 17 -18 30 -35 30 h-72
           c-17 0 -32 -13 -35 -30 l-30 -168 c-3 -14 7 -26 21 -26 z"
        fill="#fefce8"/>
  <path d="M168 150 h176 c12 0 20 10 18 21 l-5 27 h-202 l-5 -27 c-2 -11 6 -21 18 -21 z"
        fill="#fde68a"/>
  <path d="M206 150 c14 -22 38 -34 50 -34 s36 12 50 34 z" fill="#ca8a04"/>

  <!-- Tres granos, para que se lea «a granel» y no «bolsa de papel». -->
  <ellipse cx="228" cy="126" rx="13" ry="19" transform="rotate(-18 228 126)" fill="#facc15"/>
  <ellipse cx="256" cy="116" rx="13" ry="19" fill="#facc15"/>
  <ellipse cx="284" cy="126" rx="13" ry="19" transform="rotate(18 284 126)" fill="#facc15"/>

  <!-- La banda del precio, que es lo que lo vuelve un punto de VENTA. -->
  <rect x="196" y="284" width="120" height="30" rx="15" fill="#15803d" opacity="0.22"/>
  <rect x="196" y="330" width="80" height="30" rx="15" fill="#15803d" opacity="0.22"/>
</svg>
`;

/** El `.ico`: cabecera de 6 bytes, una entrada de 16 por imagen, y los PNG detrás. */
function armarIco(imagenes) {
  const CABECERA = 6;
  const ENTRADA = 16;
  const cabecera = Buffer.alloc(CABECERA);
  cabecera.writeUInt16LE(0, 0); // reservado
  cabecera.writeUInt16LE(1, 2); // 1 = ícono
  cabecera.writeUInt16LE(imagenes.length, 4);

  const entradas = [];
  let desplazamiento = CABECERA + ENTRADA * imagenes.length;
  for (const { lado, png } of imagenes) {
    const entrada = Buffer.alloc(ENTRADA);
    // 0 significa 256: un byte no alcanza para el 256, y así lo define el formato.
    entrada.writeUInt8(lado >= 256 ? 0 : lado, 0);
    entrada.writeUInt8(lado >= 256 ? 0 : lado, 1);
    entrada.writeUInt8(0, 2); // colores de la paleta: ninguna
    entrada.writeUInt8(0, 3); // reservado
    entrada.writeUInt16LE(1, 4); // planos
    entrada.writeUInt16LE(32, 6); // bits por píxel
    entrada.writeUInt32LE(png.length, 8);
    entrada.writeUInt32LE(desplazamiento, 12);
    entradas.push(entrada);
    desplazamiento += png.length;
  }

  return Buffer.concat([cabecera, ...entradas, ...imagenes.map((i) => i.png)]);
}

async function main() {
  await app.whenReady();
  mkdirSync(CARPETA, { recursive: true });

  const ventana = new BrowserWindow({
    width: LADO,
    height: LADO,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true },
  });
  await ventana.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DIBUJO)}`);
  // Un respiro para que el SVG termine de pintarse antes de la captura.
  await new Promise((resolver) => setTimeout(resolver, 400));

  const captura = await ventana.webContents.capturePage({ x: 0, y: 0, width: LADO, height: LADO });
  const grande = captura.toPNG();
  writeFileSync(join(CARPETA, 'icon.png'), grande);

  const imagenes = TAMANOS_DEL_ICO.map((lado) => ({
    lado,
    png: nativeImage.createFromBuffer(grande).resize({ width: lado, height: lado, quality: 'best' }).toPNG(),
  }));
  const ico = armarIco(imagenes);
  writeFileSync(join(CARPETA, 'icon.ico'), ico);

  console.info(`build/icon.png  ${String(grande.length)} bytes, ${String(LADO)}x${String(LADO)}`);
  console.info(`build/icon.ico  ${String(ico.length)} bytes, tamaños: ${TAMANOS_DEL_ICO.join(', ')}`);
  ventana.destroy();
  app.quit();
}

main().catch((error) => {
  console.error(`[generar-icono] ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * A QUÉ PROYECTO DE SUPABASE QUEDA APUNTANDO LO QUE SE COMPILA.
 *
 * Los tres valores de `.env.empaquetado` se incrustan en el bundle del proceso
 * principal, para que la aplicación INSTALADA se conecte sola: en la
 * computadora del mostrador no hay variables de entorno que definir, y el
 * acceso directo que crea el instalador tampoco puede ponerlas (§4.38 de
 * CLAUDE.md).
 *
 * Los tres son públicos —la llave publicable, sola, no puede nada porque RLS
 * está activo sin políticas para `anon`—. **Ninguna contraseña se incrusta**:
 * la credencial de la terminal se teclea una vez en la pantalla de conexión.
 *
 * Sin el archivo se compila sin nube, que es un resultado válido. En los dos
 * casos se imprime a qué quedó apuntando: un instalador que apunta al proyecto
 * equivocado y no lo dice es exactamente la confusión que ya costó una vuelta.
 */
function nubeParaIncrustar() {
  const archivo = resolve(__dirname, '.env.empaquetado');
  if (!existsSync(archivo)) {
    console.info('[empaquetado] sin .env.empaquetado: se compila SIN proyecto de nube (las pantallas dirán «sin configurar»)');
    return null;
  }
  const valores: Record<string, string> = {};
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const limpia = linea.trim();
    if (limpia === '' || limpia.startsWith('#')) continue;
    const separador = limpia.indexOf('=');
    if (separador <= 0) continue;
    valores[limpia.slice(0, separador).trim()] = limpia.slice(separador + 1).trim();
  }
  const url = valores.POS_NUBE_URL ?? '';
  if (url === '') {
    console.info('[empaquetado] .env.empaquetado sin POS_NUBE_URL: se compila SIN proyecto de nube');
    return null;
  }
  const referencia = new URL(url).hostname.split('.')[0] ?? url;
  const proveedor = valores.POS_SYNC_PROVIDER ?? '';
  console.info(
    `[empaquetado] se INCRUSTA el proyecto de nube ${referencia} (${url}); proveedor: ${proveedor === 'supabase' ? 'SupabaseSyncProvider' : 'SIMULADO'}`,
  );
  if (valores.POS_NUBE_LLAVE_PUBLICABLE === undefined || valores.POS_NUBE_LLAVE_PUBLICABLE === '') {
    throw new Error('.env.empaquetado define POS_NUBE_URL pero no POS_NUBE_LLAVE_PUBLICABLE: la aplicación no podría conectarse.');
  }
  return { url, llavePublicable: valores.POS_NUBE_LLAVE_PUBLICABLE, proveedor };
}

const NUBE_INCRUSTADA = nubeParaIncrustar();

/**
 * Configuración de build para los tres procesos de la aplicación.
 *
 * Nota de arquitectura: electron-vite deja fuera del bundle las dependencias de
 * Node (opción `build.externalizeDeps`, activa por omisión). Eso es
 * imprescindible para better-sqlite3, que es un módulo nativo y no puede
 * empaquetarse. El renderer no lo declara como dependencia porque jamás debe
 * acceder a SQLite: solo habla por IPC con el proceso principal.
 */
export default defineConfig({
  main: {
    // Lo lee `src/main/configuracion-de-nube.ts`, que prefiere las variables
    // de entorno cuando existen: los arneses de verificación apuntan la
    // aplicación a donde ellos necesitan, y lo incrustado es el respaldo.
    define: {
      __NUBE_INCRUSTADA__: JSON.stringify(NUBE_INCRUSTADA),
    },
    build: {
      outDir: 'dist-electron/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main'),
      },
    },
  },
  preload: {
    build: {
      outDir: 'dist-electron/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/preload/index.ts') },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
  },
});

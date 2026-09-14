import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Configuración APARTE para las verificaciones que hablan con la nube de
 * verdad (`npm run verify:restauracion`).
 *
 * `npm test` NO las corre: la regla del proyecto es que las pruebas no
 * dependen de que Supabase esté disponible ni consumen su cuota (CLAUDE.md
 * §4, punto 4). Estos archivos terminan en `.nube.ts` a propósito, para que el
 * patrón `*.test.ts` de `vitest.config.ts` no los vea, y solo esta
 * configuración los incluye. Corren contra `pos-pruebas-descartable` y contra
 * ningún otro proyecto: el seguro de `scripts/proyectos-de-prueba.cjs` se
 * comprueba antes de la primera petición.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.nube.ts'],
    reporters: ['verbose'],
    fileParallelism: false,
    // Sube filas de verdad, baja filas de verdad, y con el internet de una
    // casa: minutos, no segundos.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
    },
  },
});

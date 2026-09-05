import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Configuración de pruebas automatizadas.
 *
 * Las pruebas corren en Node puro (sin Electron y sin navegador) porque lo que
 * se prueba es lógica de negocio y aritmética decimal. Eso las hace rápidas y
 * permite ejecutarlas sin abrir la aplicación ni depender de Supabase.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/shared/**/*.ts'],
      exclude: ['src/shared/**/__tests__/**'],
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});

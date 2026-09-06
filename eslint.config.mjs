// @ts-check
/**
 * Configuración de ESLint (formato plano).
 *
 * Además de las reglas de estilo, aquí viven GUARDARRAÍLES DE ARQUITECTURA:
 * reglas que hacen fallar el lint si alguien rompe una decisión del proyecto,
 * como que el renderer acceda a SQLite o que el dominio importe Supabase.
 * Preferimos que eso lo atrape una regla y no una revisión manual.
 */

import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/** Números que nunca cuentan como "mágicos": identidades aritméticas básicas. */
const NUMEROS_PERMITIDOS = [-1, 0, 1];

export default defineConfig(
  // La propia configuración de ESLint no se analiza con información de tipos:
  // no pertenece a ningún tsconfig del proyecto y las reglas con tipos no
  // pueden resolverla.
  globalIgnores([
    'node_modules/**',
    'dist/**',
    'dist-electron/**',
    'release/**',
    'coverage/**',
    'eslint.config.mjs',
    '*.config.js',
    // Guiones de diagnóstico que se ejecutan a mano con `npx electron`. No
    // pertenecen a ningún tsconfig, así que las reglas con información de
    // tipos no pueden analizarlos.
    'scripts/*.cjs',
  ]),

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // -------------------------------------------------------------------------
  // Reglas generales para todo el TypeScript del proyecto
  // -------------------------------------------------------------------------
  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- Tipado estricto: la razón de ser del proyecto -------------------
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: false, allowTypedFunctionExpressions: true, allowHigherOrderFunctions: true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // --- Variables sin usar ----------------------------------------------
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // --- Promesas: un `await` olvidado en una venta es una venta perdida --
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // --- Higiene general --------------------------------------------------
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // -------------------------------------------------------------------------
  // Números mágicos: prohibidos en el código de negocio
  // -------------------------------------------------------------------------
  // Un `0.16` suelto en medio de un cálculo es indefendible en una auditoría:
  // hay que poder leer QUÉ es ese número. La regla obliga a darle nombre.
  {
    files: ['src/shared/**/*.ts', 'src/main/**/*.ts'],
    rules: {
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: NUMEROS_PERMITIDOS,
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          enforceConst: true,
          detectObjects: false,
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // GUARDARRAÍL: el renderer no toca la máquina
  // -------------------------------------------------------------------------
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'better-sqlite3',
              message:
                'El renderer NUNCA accede a SQLite. Pedí los datos por IPC (ver src/shared/types/ipc.ts).',
            },
            {
              name: 'electron',
              message:
                'El renderer no importa Electron. Todo pasa por la API que expone el preload en window.pos.',
            },
            {
              name: '@supabase/supabase-js',
              message: 'La nube se accede desde el proceso principal a través de SyncProvider.',
            },
          ],
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'child_process'],
              message: 'El renderer no tiene acceso a Node. Usá un canal IPC.',
            },
            {
              group: ['@main/*', '../main/*', '../../main/*'],
              message: 'El renderer no importa código del proceso principal; solo el contrato de src/shared.',
            },
            {
              group: ['@shared/auth', '**/shared/auth'],
              message:
                'src/shared/auth.ts usa node:crypto y no existe en la ventana. El renderer manda el PIN por IPC y el proceso principal lo verifica; nunca calcula ni verifica hashes por su cuenta. Para el formato del PIN usá @shared/pin.',
            },
          ],
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // GUARDARRAÍL: el código compartido no depende de Electron ni de proveedores
  // -------------------------------------------------------------------------
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message:
                'src/shared se comparte con el renderer: no puede depender de Electron.',
            },
            {
              name: 'better-sqlite3',
              message: 'El acceso a datos vive en src/main, detrás de un repositorio.',
            },
            {
              name: '@supabase/supabase-js',
              message:
                'El dominio habla con la nube solo a través de la interfaz SyncProvider, nunca con el SDK.',
            },
          ],
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Proceso principal: entorno Node
  // -------------------------------------------------------------------------
  {
    files: ['src/main/**/*.ts', '*.config.ts', 'scripts/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // -------------------------------------------------------------------------
  // Pruebas y archivos de configuración: se relajan las reglas que estorban
  // -------------------------------------------------------------------------
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['*.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
);

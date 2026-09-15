/**
 * El guard de rol sobre los canales de conexión con la nube, y la
 * comprobación de que la contraseña no se escapa por este archivo.
 *
 * POR QUÉ TIENE SU PROPIA PRUEBA, igual que usuarios y reportes: la pantalla
 * solo aparece con rol administrativo, pero eso es comodidad, no control. Un
 * renderer comprometido invoca el canal igual. Quien de verdad rechaza es
 * `requiereRol` en el proceso principal.
 *
 * Y ACÁ HAY ALGO QUE LOS OTROS DOS MÓDULOS NO TIENEN: **por este archivo pasa
 * una contraseña**. Las comprobaciones del segundo bloque existen para que
 * ningún cambio futuro la registre, la devuelva ni la guarde de paso.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FUENTE = readFileSync(join(__dirname, '..', 'nube.ts'), 'utf8');

// ===========================================================================
describe('Ningún canal de la nube queda sin guard de rol administrativo', () => {
  it('hay tantos guards de rol administrativo como canales registrados', () => {
    const canales = FUENTE.match(/ipcMain\.handle\(/g) ?? [];
    const guards = FUENTE.match(/requiereRol\(sesion, 'administrativo'/g) ?? [];

    expect(canales.length).toBeGreaterThan(0);
    expect(guards.length).toBe(canales.length);
  });

  it('son los dos canales del módulo: estado y conectar', () => {
    expect((FUENTE.match(/ipcMain\.handle\(/g) ?? []).length).toBe(2);
  });

  it('NINGUNO exige solo sesión: `requiereSesion` dejaría conectar a un cajero', () => {
    expect(FUENTE).not.toContain('requiereSesion');
  });

  it('los dos canales son los esperados, por nombre', () => {
    expect(FUENTE).toContain('CANALES_IPC.nubeEstado');
    expect(FUENTE).toContain('CANALES_IPC.nubeConectar');
  });

  it('el canal que recibe la contraseña valida su payload con zod antes de usarlo', () => {
    expect(FUENTE).toContain('esquemaConexionDeNube.parse(payload)');
  });
});

// ===========================================================================
describe('La contraseña no se escapa por el módulo de IPC', () => {
  it('NO se registra en ninguna bitácora desde acá', () => {
    expect(FUENTE).not.toMatch(/registrar\(.*contrasena/);
    expect(FUENTE).not.toMatch(/console\.(log|info|warn|error)\(/);
  });

  it('NO se guarda el payload completo en ninguna variable de módulo', () => {
    // `datos` es local al manejador y muere con él. Cualquier asignación a
    // algo de mayor alcance sería una copia de la contraseña que sobrevive.
    expect(FUENTE).not.toMatch(/^(let|var|const)\s+\w*[Pp]ayload/m);
  });

  it('lo único que se hace con la contraseña es pasarla a conectar', () => {
    const usos = FUENTE.match(/datos\.contrasena/g) ?? [];

    expect(usos).toHaveLength(1);
    expect(FUENTE).toContain('nube.conectar(datos.correo, datos.contrasena)');
  });
});

/**
 * El guard de rol sobre los canales de sincronización.
 *
 * POR QUÉ TIENE SU PROPIA PRUEBA, igual que nube, usuarios y reportes: la
 * pantalla solo aparece con rol administrativo, pero eso es comodidad, no
 * control. Un renderer comprometido invoca el canal igual. Quien de verdad
 * rechaza es `requiereRol` en el proceso principal.
 *
 * ESTE ARCHIVO TIENE UNA EXCEPCIÓN A PROPÓSITO: `sincronizacionResumen` NO
 * lleva guard, porque lo consulta la barra de estado, que está montada
 * siempre —incluso antes de iniciar sesión— y no devuelve nada sensible. La
 * prueba lo comprueba por nombre, para que la excepción quede fijada y no
 * pueda ampliarse en silencio a un canal nuevo.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FUENTE = readFileSync(join(__dirname, '..', 'sincronizacion.ts'), 'utf8');

// ===========================================================================
describe('Tres de los cuatro canales exigen rol administrativo; el resumen no', () => {
  it('hay CUATRO canales en total', () => {
    expect((FUENTE.match(/ipcMain\.handle\(/g) ?? []).length).toBe(4);
  });

  it('hay tantos guards de rol administrativo como canales MENOS el resumen', () => {
    const canales = FUENTE.match(/ipcMain\.handle\(/g) ?? [];
    const guards = FUENTE.match(/requiereRol\(sesion, 'administrativo'/g) ?? [];

    expect(canales.length).toBeGreaterThan(0);
    expect(guards.length).toBe(canales.length - 1);
  });

  it('el ÚNICO canal sin guard es, por nombre, sincronizacionResumen', () => {
    // Se aísla el bloque de cada canal (desde su ipcMain.handle hasta el
    // próximo) y se comprueba, canal por canal, si tiene el guard.
    const bloques = FUENTE.split(/(?=ipcMain\.handle\()/).filter((b) =>
      b.startsWith('ipcMain.handle('),
    );
    expect(bloques).toHaveLength(4);

    const sinGuard = bloques.filter((b) => !b.includes("requiereRol(sesion, 'administrativo'"));
    expect(sinGuard).toHaveLength(1);
    expect(sinGuard[0]).toContain('CANALES_IPC.sincronizacionResumen');
  });

  it('NINGUNO de los tres protegidos exige solo sesión: eso dejaría entrar a un cajero', () => {
    expect(FUENTE).not.toContain('requiereSesion');
  });

  it('los cuatro canales son los esperados, por nombre', () => {
    expect(FUENTE).toContain('CANALES_IPC.sincronizacionResumen');
    expect(FUENTE).toContain('CANALES_IPC.sincronizacionDetalle');
    expect(FUENTE).toContain('CANALES_IPC.sincronizacionReintentarLote');
    expect(FUENTE).toContain('CANALES_IPC.sincronizacionSaltarLote');
  });

  it('el canal de saltar lote valida su payload con zod antes de usarlo', () => {
    expect(FUENTE).toContain('esquemaSaltoDeLote.parse(payload)');
  });

  it('el canal de reintentar valida su payload con zod antes de usarlo', () => {
    expect(FUENTE).toContain('esquemaLoteId.parse(payload)');
  });
});

// ===========================================================================
describe('Saltar un lote pasa por la MISMA verificación de PIN que el resto del sistema', () => {
  it('usa autorizarComoAdministrador, no una comparación propia', () => {
    expect(FUENTE).toContain('autenticacion.autorizarComoAdministrador');
  });

  it('con la superficie correcta, para que tenga su propio candado de intentos', () => {
    expect(FUENTE).toMatch(/autorizarComoAdministrador\(\s*datos\.pin,\s*'saltar_lote_de_sincronizacion'/);
  });

  it('el PIN no se registra en ninguna bitácora desde acá', () => {
    expect(FUENTE).not.toMatch(/registrar\(.*datos\.pin/);
    expect(FUENTE).not.toMatch(/console\.(log|info|warn|error)\(.*pin/i);
  });

  it('quien queda como autorizante es a quien coincidió el PIN, no un valor fijo', () => {
    expect(FUENTE).toContain('permiso.usuario.id');
  });
});

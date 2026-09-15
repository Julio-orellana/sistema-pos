/**
 * El guard de rol sobre los seis canales de la impresora (§4.43).
 *
 * Elegir la impresora cambia a dónde van los recibos de toda la tienda, y el
 * ticket de prueba gasta papel. El botón solo aparece con rol administrativo,
 * pero eso es comodidad: quien rechaza es `requiereRol`, en cada canal. Esta
 * prueba CUENTA, porque el riesgo es el séptimo canal que alguien agregue sin
 * envolver.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { esquemaConfirmacionDePrueba, esquemaNombreDeImpresora } from '@shared/types/ipc';

const FUENTE = readFileSync(join(__dirname, '..', 'impresora.ts'), 'utf8');

describe('Ningún canal de la impresora queda sin guard', () => {
  it('hay tantos guards de rol administrativo como canales registrados', () => {
    const canales = FUENTE.match(/ipcMain\.handle\(/g) ?? [];
    const guards = FUENTE.match(/requiereRol\(sesion, 'administrativo'/g) ?? [];
    expect(canales.length).toBe(6);
    expect(guards.length).toBe(canales.length);
  });

  it('ninguno exige solo sesión', () => {
    expect(FUENTE).not.toContain('requiereSesion');
  });

  it('los seis canales son los esperados, por nombre', () => {
    for (const canal of [
      'impresoraEstado',
      'impresoraListar',
      'impresoraGuardar',
      'impresoraQuitar',
      'impresoraImprimirPrueba',
      'impresoraConfirmarPrueba',
    ]) {
      expect(FUENTE).toContain(`CANALES_IPC.${canal}`);
    }
  });

  it('todos pasan por el envoltorio que comprueba que la respuesta se pueda clonar', () => {
    expect((FUENTE.match(/ejecutarConRespuesta\(/g) ?? []).length).toBe(6);
  });
});

describe('Lo que llega de la ventana se valida antes de usarlo', () => {
  it('guardar y probar pasan el nombre por su esquema; confirmar, el suyo', () => {
    expect((FUENTE.match(/esquemaNombreDeImpresora\.parse/g) ?? []).length).toBe(2);
    expect(FUENTE).toContain('esquemaConfirmacionDePrueba.parse');
  });

  it('un nombre vacío o de puros espacios se rechaza: sin impresora no hay a quién mandar el ticket', () => {
    expect(esquemaNombreDeImpresora.safeParse({ nombre: '' }).success).toBe(false);
    expect(esquemaNombreDeImpresora.safeParse({ nombre: '   ' }).success).toBe(false);
    expect(esquemaNombreDeImpresora.safeParse({}).success).toBe(false);
    expect(esquemaNombreDeImpresora.safeParse({ nombre: 'POS-80' }).success).toBe(true);
  });

  it('la confirmación solo acepta las tres respuestas y un id con forma de UUID', () => {
    const id = '0c2ebde1-fe5f-4d8b-a7c4-d137888109ca';
    expect(esquemaConfirmacionDePrueba.safeParse({ pruebaId: id, resultado: 'ilegible' }).success).toBe(true);
    expect(esquemaConfirmacionDePrueba.safeParse({ pruebaId: id, resultado: 'mas-o-menos' }).success).toBe(false);
    expect(esquemaConfirmacionDePrueba.safeParse({ pruebaId: 'x', resultado: 'bien' }).success).toBe(false);
  });
});

describe('Las impresoras simuladas no pueden llegar al instalador', () => {
  it('index.ts solo mira POS_IMPRESORAS_SIMULADAS con la aplicación SIN empaquetar', () => {
    const indice = readFileSync(join(__dirname, '..', '..', 'index.ts'), 'utf8');
    expect(indice).toContain("app.isPackaged ? '' : (process.env.POS_IMPRESORAS_SIMULADAS ?? '')");
    expect((indice.match(/process\.env\.POS_IMPRESORAS_SIMULADAS/g) ?? []).length).toBe(1);
  });
});

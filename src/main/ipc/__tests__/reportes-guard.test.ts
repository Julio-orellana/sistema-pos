/**
 * El guard de rol sobre los reportes y los topes de descuento.
 *
 * POR QUÉ TIENE SU PROPIA PRUEBA, igual que la de gestión de usuarios: los
 * botones solo aparecen con rol administrativo, pero eso es comodidad, no
 * control. Un renderer comprometido invoca el canal igual. Quien de verdad
 * rechaza es `requiereRol` en el proceso principal.
 *
 * Y LO QUE SE PROTEGE EN CADA GRUPO ES DISTINTO:
 *
 *   · Los REPORTES dicen cuánto entró a la tienda y qué hay en bodega. Un
 *     cajero necesita vender y reimprimir, no saber cuánto facturó el negocio.
 *   · Los TOPES deciden cuánto puede rebajar cada rol sin pedir permiso. Si un
 *     usuario de venta pudiera tocarlos, se subiría su propio límite y todo el
 *     mecanismo de autorización por PIN quedaría en nada.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FUENTE = readFileSync(join(__dirname, '..', 'reportes.ts'), 'utf8');

// ===========================================================================
describe('Ningún canal de reportes ni de topes queda sin guard', () => {
  it('hay tantos guards de rol administrativo como canales registrados', () => {
    const canales = FUENTE.match(/ipcMain\.handle\(/g) ?? [];
    const guards = FUENTE.match(/requiereRol\(sesion, 'administrativo'/g) ?? [];

    expect(canales.length).toBeGreaterThan(0);
    expect(guards.length).toBe(canales.length);
  });

  it('son los cinco canales del módulo: tres reportes y dos de topes', () => {
    // Si este número cambia sin que cambie el de arriba, alguien agregó un
    // canal sin guard o quitó uno sin querer.
    expect((FUENTE.match(/ipcMain\.handle\(/g) ?? []).length).toBe(5);
  });

  it('NINGUNO exige solo sesión: `requiereSesion` dejaría pasar a un cajero', () => {
    expect(FUENTE).not.toContain('requiereSesion');
  });

  it('los cinco canales son los esperados, por nombre', () => {
    for (const canal of [
      'reportesResumenDeVentas',
      'reportesVentasPorProducto',
      'reportesInventario',
      'limitesListar',
      'limitesFijar',
    ]) {
      expect(FUENTE).toContain(`CANALES_IPC.${canal}`);
    }
  });
});

// ===========================================================================
describe('Cada canal valida su payload con zod antes de usarlo', () => {
  /*
    El renderer se trata como entrada no confiable por principio (§5). Un
    período con una fecha inventada o un tope con un rol que no existe tienen
    que rebotar en el borde, no adentro del servicio.
  */
  it('los canales que reciben datos los pasan por un esquema', () => {
    expect(FUENTE).toContain('esquemaPeriodo.parse');
    expect(FUENTE).toContain('esquemaOrdenDeInventario.parse');
    expect(FUENTE).toContain('esquemaLimiteDeDescuento.parse');
  });

  it('fijar un tope registra al usuario EN SESIÓN, no uno que venga del payload', () => {
    // Si el id del actor viajara desde la ventana, cualquiera podría atribuirle
    // el cambio a otra persona, y la auditoría dejaría de servir para nada.
    expect(FUENTE).toContain('actorEnSesion(sesion)');
    expect(FUENTE).not.toContain('payload.usuarioId');
    expect(FUENTE).not.toContain('cambio.actorId');
  });
});

// ===========================================================================
describe('Los instantes exactos del período NO cruzan hacia la ventana', () => {
  it('el DTO que viaja lleva días y etiqueta, no las cadenas ISO del rango', () => {
    /*
      Es deliberado. La pantalla muestra días; los extremos exactos en UTC son un
      detalle de cómo se consultó la base. Mandarlos invitaría a que alguna
      pantalla futura hiciera su propia aritmética de fechas en vez de pedirle el
      período al proceso principal, que es donde vive la regla de la zona horaria.
    */
    expect(FUENTE).toContain('desdeDia');
    expect(FUENTE).toContain('hastaDia');
    expect(FUENTE).not.toContain('desdeIso:');
    expect(FUENTE).not.toContain('hastaIso:');
  });
});

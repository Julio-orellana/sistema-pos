/**
 * LA MIGRACIÓN 030: `recibos.pdf_path` deja de ser la ruta absoluta de la
 * máquina que emitió y pasa a `recibos/<nombre>.pdf`, relativa a la carpeta
 * de datos, como `productos.foto_path` desde siempre.
 *
 * `crearBaseMigrada` arranca vacía, así que ninguna otra prueba ejercita el
 * camino que más riesgo tiene: una base que YA tiene recibos con la
 * convención vieja —la de desarrollo de Julio, con ventas reales—. Acá se
 * aplican las migraciones hasta la anterior, se siembra a mano con rutas de
 * macOS y de Windows, y recién entonces corre la 030.
 */

import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { resolverRutaDePdf } from '@main/domain/recibo/ruta-de-pdf';
import { encolarLote } from '../bandeja-de-salida';
import { aplicarMigraciones, MIGRACIONES } from '../migrator';
import { crearRepositorios } from '../repositories';
import { crearBaseVacia } from './ayuda-base-de-datos';

const CARPETA_DE_DATOS_MAC = '/Users/jimmy/Library/Application Support/pos-agricola';
const NOMBRE_1 = 'recibo-000001-2026-09-11T19-09-34-701Z.pdf';
const NOMBRE_2 = 'recibo-000002-2026-09-11T19-10-02-118Z.pdf';
const NOMBRE_3 = 'recibo-000003-2026-09-12T10-00-00-000Z.pdf';
const RUTA_MAC = `${CARPETA_DE_DATOS_MAC}/recibos/${NOMBRE_1}`;
const RUTA_WINDOWS = `C:\\Users\\Jimmy\\AppData\\Roaming\\pos-agricola\\recibos\\${NOMBRE_2}`;
const YA_RELATIVA = `recibos/${NOMBRE_3}`;

let limpiar: (() => void) | null = null;

afterEach(() => {
  limpiar?.();
  limpiar = null;
});

/**
 * Se filtra por NÚMERO DE ORDEN y no por posición, por la misma razón que la
 * prueba de la 028: la 030 va a dejar de ser la última en cuanto exista la 031.
 */
function baseSinLa030(): Database {
  const nueva = crearBaseVacia();
  limpiar = nueva.limpiar;
  aplicarMigraciones(nueva.base, MIGRACIONES.filter((m) => m.orden < 30));
  return nueva.base;
}

/** Siembra un recibo por ruta, con su cadena mínima de llaves foráneas. Devuelve los ids de los recibos. */
function sembrarRecibos(base: Database, rutas: readonly string[]): string[] {
  const repos = crearRepositorios(base);
  const usuario = repos.usuarios.crear({ nombre: 'Jimmy', rol: 'administrativo', pinHash: 'hash-de-prueba' });
  const caja = repos.cajaSesiones.abrir({ usuarioId: usuario.id, montoInicial: '500' });
  return rutas.map((ruta, indice) => {
    const venta = repos.ventas.crear({
      cajaSesionId: caja.id,
      usuarioId: usuario.id,
      subtotal: '10.00',
      total: '10.00',
      formaPago: 'efectivo',
    });
    return repos.recibos.crear({ ventaId: venta.id, numeroRecibo: indice + 1, pdfPath: ruta }).id;
  });
}

function pdfPathDe(base: Database, id: string): string {
  return (base.prepare('SELECT pdf_path FROM recibos WHERE id = ?').get(id) as { pdf_path: string }).pdf_path;
}

describe('LA MIGRACIÓN 030 convierte las rutas absolutas que ya estaban guardadas', () => {
  it('una ruta absoluta de macOS queda como recibos/<nombre>', () => {
    const base = baseSinLa030();
    const [id] = sembrarRecibos(base, [RUTA_MAC]);
    expect(pdfPathDe(base, String(id))).toBe(RUTA_MAC);

    aplicarMigraciones(base, MIGRACIONES);

    expect(pdfPathDe(base, String(id))).toBe(`recibos/${NOMBRE_1}`);
  });

  it('una ruta absoluta de Windows, con barras invertidas, también', () => {
    const base = baseSinLa030();
    const [id] = sembrarRecibos(base, [RUTA_WINDOWS]);

    aplicarMigraciones(base, MIGRACIONES);

    expect(pdfPathDe(base, String(id))).toBe(`recibos/${NOMBRE_2}`);
  });

  it('una ruta que YA es relativa no se toca', () => {
    const base = baseSinLa030();
    const [id] = sembrarRecibos(base, [YA_RELATIVA]);

    aplicarMigraciones(base, MIGRACIONES);

    expect(pdfPathDe(base, String(id))).toBe(YA_RELATIVA);
  });

  it('LA RUTA RESUELTA DESPUÉS DE MIGRAR ES EL MISMO ARCHIVO QUE ANTES: nada se pierde en la máquina que emitió', () => {
    const base = baseSinLa030();
    const [id] = sembrarRecibos(base, [RUTA_MAC]);

    aplicarMigraciones(base, MIGRACIONES);

    expect(resolverRutaDePdf(CARPETA_DE_DATOS_MAC, pdfPathDe(base, String(id)))).toBe(RUTA_MAC);
  });

  it('lo que esperaba en sync_cola para recibos se mueve CON la fila, dentro del payload; lo ya sincronizado no se toca', () => {
    const base = baseSinLa030();
    const [pendiente, sincronizado] = sembrarRecibos(base, [RUTA_MAC, RUTA_WINDOWS]);
    encolarLote(base, [{ tabla: 'recibos', id: String(pendiente), operacion: 'insertar' }]);
    encolarLote(base, [{ tabla: 'recibos', id: String(sincronizado), operacion: 'insertar' }]);
    base
      .prepare("UPDATE sync_cola SET sincronizado_en = '2026-09-13T00:00:00.000Z' WHERE entidad_id = ?")
      .run(String(sincronizado));

    aplicarMigraciones(base, MIGRACIONES);

    const payloadDe = (id: string): { pdf_path: string } =>
      JSON.parse((base.prepare('SELECT payload FROM sync_cola WHERE entidad_id = ?').get(id) as { payload: string }).payload) as {
        pdf_path: string;
      };
    // El pendiente: payload = fila, byte a byte, como manda §4.17.
    expect(payloadDe(String(pendiente)).pdf_path).toBe(`recibos/${NOMBRE_1}`);
    expect(payloadDe(String(pendiente)).pdf_path).toBe(pdfPathDe(base, String(pendiente)));
    // El ya sincronizado es la constancia de lo que se ENVIÓ: conserva la ruta vieja.
    expect(payloadDe(String(sincronizado)).pdf_path).toBe(RUTA_WINDOWS);
    // Aunque su fila sí quedó convertida.
    expect(pdfPathDe(base, String(sincronizado))).toBe(`recibos/${NOMBRE_2}`);
  });

  it('en una base recién creada la 030 figura aplicada y no hay nada que convertir', () => {
    const nueva = crearBaseVacia();
    limpiar = nueva.limpiar;
    const resultado = aplicarMigraciones(nueva.base, MIGRACIONES);
    expect(resultado.aplicadasAhora).toContain('030_recibos_pdf_path_relativo');
    expect(join('recibos', NOMBRE_1)).toBe(`recibos/${NOMBRE_1}`);
  });
});

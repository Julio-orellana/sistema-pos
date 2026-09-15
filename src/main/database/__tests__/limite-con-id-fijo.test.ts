/**
 * EL ID DE UN TOPE DE DESCUENTO ES FIJO POR ROL, Y NO SE SORTEA.
 *
 * ===========================================================================
 * QUÉ DEFECTO CIERRA, Y POR QUÉ NINGUNA PRUEBA LOCAL LO HABÍA VISTO
 * ===========================================================================
 *
 * `escribir_fila`, la función de la nube que escribe cada fila (migración
 * `0023`), lo hace con `INSERT … ON CONFLICT (id) DO UPDATE`: el destino del
 * conflicto es **la llave primaria y nada más**. Un choque contra cualquier
 * OTRA restricción única no lo absorbe el upsert: sale como `23505` crudo, la
 * terminal lo clasifica —correctamente— como determinístico, y **la cola de
 * sincronización se detiene**.
 *
 * `limites_descuento` tiene `UNIQUE (rol)` además de su llave primaria. Con el
 * id sorteado en el cliente, la MISMA fila de negocio —el tope del rol
 * `venta`— podía llegar a la nube bajo dos ids distintos, y el segundo chocaba.
 * Medido contra `pos-pruebas-descartable` el 2026-09-14:
 *
 *     sincronizar_lote_simple -> HTTP 409
 *     {"code":"23505","details":"Key (rol)=(venta) already exists.", …}
 *     ciclo: cola_detenida; pendientes: 16
 *
 * **Ninguna prueba local podía verlo**, y conviene entender por qué: la
 * restricción que se viola vive en Postgres, y contra SQLite el `UNIQUE (rol)`
 * hace que el segundo id ni siquiera llegue a existir. El defecto solo aparece
 * cuando dos BASES distintas —una reinstalación, una restauración, una segunda
 * caja— le hablan a la misma nube. Ver CLAUDE.md §4.31.
 *
 * Lo que estas pruebas fijan es la condición que lo hace imposible: **la misma
 * fila de negocio tiene la misma llave primaria en toda instalación.**
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { crearBaseMigrada, crearBaseVacia } from './ayuda-base-de-datos';
import { aplicarMigraciones, MIGRACIONES } from '../migrator';
import { crearRepositorios, type Repositorios } from '../repositories';
import { ID_DE_LIMITE_POR_ROL } from '../repositories/limites-descuento';
import { ServicioDeLimitesDeDescuento } from '@main/domain/venta/servicio-de-limites-de-descuento';
import { generarHashDePin } from '@shared/auth';

let base: Database;
let limpiar: () => void;
let repos: Repositorios;

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
});

afterEach(() => {
  limpiar();
});

/** Fija un tope con valores cualesquiera; lo que importa es el id que queda. */
function fijar(rol: 'venta' | 'administrativo', porcentaje: string): string {
  return repos.limitesDescuento.fijar({
    rol,
    descuentoMaxPorcentaje: porcentaje,
    descuentoMaxMontoFijo: '20',
    editadoPor: null,
  }).id;
}

// ===========================================================================
describe('El id de un tope es el MISMO en toda instalación', () => {
  it('el rol venta siempre recibe el id fijo de venta', () => {
    expect(fijar('venta', '10')).toBe(ID_DE_LIMITE_POR_ROL.venta);
  });

  it('el rol administrativo recibe el suyo, y son distintos entre sí', () => {
    expect(fijar('administrativo', '100')).toBe(ID_DE_LIMITE_POR_ROL.administrativo);
    expect(ID_DE_LIMITE_POR_ROL.venta).not.toBe(ID_DE_LIMITE_POR_ROL.administrativo);
  });

  it('DOS BASES DISTINTAS le dan el mismo id al mismo rol: esto es el arreglo', () => {
    /*
      El corazón del asunto. Antes, dos instalaciones sorteaban dos ids para el
      tope del mismo rol, y la segunda que subiera chocaba contra UNIQUE (rol)
      en la nube con un 23505 que detenía la cola.
    */
    const idAca = fijar('venta', '10');

    const otra = crearBaseMigrada();
    const idAlla = crearRepositorios(otra.base).limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '35',
      descuentoMaxMontoFijo: '99',
      editadoPor: null,
    }).id;
    otra.limpiar();

    expect(idAlla).toBe(idAca);
  });

  it('volver a fijarlo con otros valores NO cambia el id', () => {
    const primero = fijar('venta', '10');
    const segundo = fijar('venta', '25');

    expect(segundo).toBe(primero);
  });

  it('BORRARLO Y VOLVER A CREARLO tampoco: antes acá salía un id nuevo', () => {
    /*
      `borrarPorRol` es una de las pocas operaciones que borran de verdad, y
      hasta la migración 028 la fila que volvía a nacer traía un UUID nuevo.
      Eso bastaba para romper la sincronización sin salir de UNA sola terminal.
    */
    const antes = fijar('venta', '10');
    expect(repos.limitesDescuento.borrarPorRol('venta')).toBe(true);
    const despues = fijar('venta', '10');

    expect(despues).toBe(antes);
  });
});

// ===========================================================================
describe('LA BASE lo hace cumplir: no alcanza con que el repositorio se porte bien', () => {
  /*
    Tercera capa, la de siempre: el repositorio decide y la base es la última
    red. Sin el CHECK, un módulo futuro que insertara con `nuevoId()` volvería a
    abrir el hueco sin que nada fallara acá, y el síntoma aparecería mucho
    después y del otro lado, como una cola detenida en la tienda.
  */
  const insertarConId = (id: string, rol: string): void => {
    base
      .prepare(
        `INSERT INTO limites_descuento (
           id, rol, descuento_max_porcentaje, descuento_max_monto_fijo, creado_en, actualizado_en
         ) VALUES (?, ?, '10.00', '20.00', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')`,
      )
      .run(id, rol);
  };

  it('un id sorteado se RECHAZA, aunque el rol sea válido', () => {
    expect(() => {
      insertarConId('11111111-2222-4333-8444-555555555555', 'venta');
    }).toThrow(/limites_descuento_id_fijo_por_rol/);
  });

  it('cruzar los dos ids —el de venta para administrativo— también se rechaza', () => {
    expect(() => {
      insertarConId(ID_DE_LIMITE_POR_ROL.venta, 'administrativo');
    }).toThrow(/limites_descuento_id_fijo_por_rol/);
  });

  it('y el par correcto pasa, que es el control de las dos de arriba', () => {
    expect(() => {
      insertarConId(ID_DE_LIMITE_POR_ROL.venta, 'venta');
    }).not.toThrow();
    expect(() => {
      insertarConId(ID_DE_LIMITE_POR_ROL.administrativo, 'administrativo');
    }).not.toThrow();
  });

  it('cambiar el id de una fila ya guardada también se rechaza', () => {
    fijar('venta', '10');

    expect(() => {
      base
        .prepare('UPDATE limites_descuento SET id = ? WHERE rol = ?')
        .run('99999999-8888-4777-8666-555555555555', 'venta');
    }).toThrow(/limites_descuento_id_fijo_por_rol/);
  });
});

// ===========================================================================
describe('Lo que se ENCOLA lleva el id fijo, que es lo que termina en la nube', () => {
  it('el payload que viaja trae el id fijo, no uno sorteado', () => {
    // Encola el SERVICIO, no el repositorio: es `conBandejaDeSalida` quien
    // escribe la fila de `sync_cola` dentro de la misma transacción (§4.17).
    const servicio = new ServicioDeLimitesDeDescuento({
      base,
      limites: repos.limitesDescuento,
      auditoria: repos.auditoria,
      nombreDeUsuario: (): string | null => null,
    });
    const jimmy = repos.usuarios.crear({
      nombre: 'Jimmy',
      rol: 'administrativo',
      pinHash: generarHashDePin('2468'),
    });
    servicio.fijar(jimmy.id, { rol: 'venta', porcentaje: '10', montoFijo: '20' });

    const fila = base
      .prepare(
        `SELECT entidad_id, payload FROM sync_cola
          WHERE entidad_tipo = 'limites_descuento' ORDER BY creado_en DESC LIMIT 1`,
      )
      .get() as { entidad_id: string; payload: string } | undefined;

    expect(fila).toBeDefined();
    expect(fila?.entidad_id).toBe(ID_DE_LIMITE_POR_ROL.venta);
    expect((JSON.parse(fila?.payload ?? '{}') as { id?: string }).id).toBe(
      ID_DE_LIMITE_POR_ROL.venta,
    );
  });
});

// ===========================================================================
describe('LA MIGRACIÓN 028 mueve lo que ya estaba, no solo lo que venga', () => {
  /*
    `crearBaseMigrada` arranca vacía, así que ninguna prueba de arriba ejercita
    el camino que más riesgo tiene: una base que YA tenía el tope con un id
    sorteado —la de desarrollo de Julio, sembrada con `npm run seed:limites`—.
    Acá se aplican las migraciones hasta la anterior, se siembra a mano, y
    recién entonces corre la 028.
  */
  const ID_VIEJO = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  function baseSinLa028(): { base: Database; limpiar: () => void } {
    const nueva = crearBaseVacia();
    /*
      Se filtra por NÚMERO DE ORDEN y no por posición (`slice(0, -1)`): la
      migración 028 dejó de ser la última en cuanto se agregó la 029, y un
      corte posicional habría empezado a excluir la migración equivocada sin
      que nada lo avisara. Filtrar por `orden < 28` sigue siendo correcto
      aunque se agreguen more migraciones después.
    */
    aplicarMigraciones(nueva.base, MIGRACIONES.filter((m) => m.orden < 28));
    return nueva;
  }

  it('una fila con id sorteado pasa a su id fijo, y el CHECK queda puesto', () => {
    const prueba = baseSinLa028();
    prueba.base
      .prepare(
        `INSERT INTO limites_descuento (
           id, rol, descuento_max_porcentaje, descuento_max_monto_fijo, creado_en, actualizado_en
         ) VALUES (?, 'venta', '10.00', '20.00', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
      )
      .run(ID_VIEJO);

    aplicarMigraciones(prueba.base, MIGRACIONES);

    const fila = prueba.base
      .prepare('SELECT id FROM limites_descuento WHERE rol = ?')
      .get('venta') as { id: string };
    expect(fila.id).toBe(ID_DE_LIMITE_POR_ROL.venta);

    // Y de paso: el CHECK sobrevive a la migración de datos.
    expect(() => {
      prueba.base.prepare('UPDATE limites_descuento SET id = ? WHERE rol = ?').run(ID_VIEJO, 'venta');
    }).toThrow(/limites_descuento_id_fijo_por_rol/);
    prueba.limpiar();
  });

  it('y lo que estaba ESPERANDO en la cola se mueve con ella, id y payload', () => {
    /*
      Sin esto quedaría un lote pendiente apuntando al id viejo y con el id
      viejo adentro del payload: al subirlo, la nube recibiría la fila con una
      llave primaria que en esta base ya no existe, y chocaría contra
      UNIQUE (rol). O sea, esta misma migración provocando el 23505 que vino a
      cerrar.
    */
    const prueba = baseSinLa028();
    prueba.base
      .prepare(
        `INSERT INTO limites_descuento (
           id, rol, descuento_max_porcentaje, descuento_max_monto_fijo, creado_en, actualizado_en
         ) VALUES (?, 'venta', '10.00', '20.00', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
      )
      .run(ID_VIEJO);
    prueba.base
      .prepare(
        `INSERT INTO sync_cola (id, entidad_tipo, entidad_id, operacion, payload, creado_en, lote_id, orden_en_lote)
         VALUES ('11111111-1111-4111-8111-111111111111', 'limites_descuento', ?, 'insertar', ?, '2026-09-01T00:00:00.000Z', 'lote-1', 0)`,
      )
      .run(ID_VIEJO, JSON.stringify({ id: ID_VIEJO, rol: 'venta', descuento_max_porcentaje: '10.00' }));

    aplicarMigraciones(prueba.base, MIGRACIONES);

    const enCola = prueba.base
      .prepare('SELECT entidad_id, payload FROM sync_cola WHERE entidad_tipo = ?')
      .get('limites_descuento') as { entidad_id: string; payload: string };

    expect(enCola.entidad_id).toBe(ID_DE_LIMITE_POR_ROL.venta);
    expect((JSON.parse(enCola.payload) as { id: string }).id).toBe(ID_DE_LIMITE_POR_ROL.venta);
    // El resto del payload no se toca.
    expect((JSON.parse(enCola.payload) as { rol: string }).rol).toBe('venta');
    prueba.limpiar();
  });

  it('sobre una base VACÍA es un no-op y no falla', () => {
    const prueba = baseSinLa028();
    expect(() => { aplicarMigraciones(prueba.base, MIGRACIONES); }).not.toThrow();
    expect(
      (prueba.base.prepare('SELECT count(*) AS n FROM limites_descuento').get() as { n: number }).n,
    ).toBe(0);
    prueba.limpiar();
  });
});

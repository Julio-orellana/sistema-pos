/**
 * Los topes de descuento, ya configurables desde la aplicación.
 *
 * LA PREGUNTA CENTRAL QUE ESTAS PRUEBAS CONTESTAN: si un administrador cambia
 * cuánto puede rebajar un rol, ¿queda registrado QUIÉN lo hizo? Hasta ahora la
 * única forma de tocar esta tabla era un guion de desarrollo, que dejaba
 * `editado_por` en NULL a propósito porque no había nadie detrás. Desde la
 * pantalla sí hay alguien, y tiene que quedar su nombre en la columna y su
 * asiento en la bitácora.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { ErrorDeNegocio } from '@main/database/errores';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import {
  ACCIONES_DE_LIMITE,
  ServicioDeLimitesDeDescuento,
  porcentajeSinEfectoExtra,
} from '../servicio-de-limites-de-descuento';

let base: Database;
let repos: Repositorios;
let servicio: ServicioDeLimitesDeDescuento;
let limpiar: () => void;
let idJimmy: string;

/**
 * Reloj inyectado, que avanza un minuto en cada cambio.
 *
 * Sin esto, dos cambios seguidos quedarían con la MISMA fecha y el orden de los
 * asientos sería ambiguo: la prueba pasaría o fallaría según el capricho del
 * motor. Es el mismo criterio de «nunca dejar un orden ambiguo» del reparto de
 * centavos (§5).
 */
let reloj = Date.parse('2026-09-11T20:00:00.000Z');

/** Un minuto, para separar dos cambios en la bitácora. */
const UN_MINUTO = 60_000;

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);

  idJimmy = repos.usuarios.crear({
    nombre: 'Jimmy',
    rol: 'administrativo',
    pinHash: generarHashDePin('2468'),
  }).id;

  reloj = Date.parse('2026-09-11T20:00:00.000Z');
  servicio = new ServicioDeLimitesDeDescuento({
    base,
    limites: repos.limitesDescuento,
    auditoria: repos.auditoria,
    nombreDeUsuario: (usuarioId): string | null =>
      repos.usuarios.obtenerPorId(usuarioId)?.nombre ?? null,
    ahora: (): number => {
      reloj += UN_MINUTO;
      return reloj;
    },
  });
});

afterEach(() => {
  limpiar();
});

/** Los asientos de esta acción, del más reciente al más viejo. */
function asientosDeLimite(): {
  accion: string;
  usuarioId: string | null;
  valorAnterior: string | null;
  valorNuevo: string | null;
}[] {
  return repos.auditoria
    .listarPorRango('2000-01-01', '2100-01-01')
    .filter((asiento) => asiento.accion === ACCIONES_DE_LIMITE.fijado)
    .map((asiento) => ({
      accion: asiento.accion,
      usuarioId: asiento.usuarioId,
      valorAnterior: asiento.valorAnterior,
      valorNuevo: asiento.valorNuevo,
    }));
}

// ===========================================================================
describe('Los dos roles aparecen SIEMPRE, tengan fila o no', () => {
  it('sin ninguna fila configurada, los dos salen en cero', () => {
    const limites = servicio.listar();

    expect(limites).toHaveLength(2);
    expect(limites.map((limite) => limite.rol)).toEqual(['venta', 'administrativo']);
    for (const limite of limites) {
      expect(limite.porcentaje).toBe('0.00');
      expect(limite.montoFijo).toBe('0.00');
      expect(limite.configurado).toBe(false);
    }
  });

  it('UN ROL SIN FILA ES TOPE CERO, y el reporte lo dice: `configurado` en false', () => {
    /*
      Es la distinción que más fácil se malinterpreta. Si el rol sin fila
      simplemente no apareciera en la lista, la pantalla mostraría un hueco y
      quien la mire podría leerlo como «este rol no tiene límite», que es
      exactamente lo contrario de lo que significa.
    */
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '10', montoFijo: '20' });
    const limites = servicio.listar();

    expect(limites.find((limite) => limite.rol === 'venta')?.configurado).toBe(true);
    expect(limites.find((limite) => limite.rol === 'administrativo')?.configurado).toBe(false);
    expect(limites.find((limite) => limite.rol === 'administrativo')?.porcentaje).toBe('0.00');
  });
});

// ===========================================================================
describe('CAMBIAR UN TOPE QUEDA AUDITADO CON EL USUARIO REAL, no en NULL', () => {
  it('la columna `editado_por` guarda el id del administrador que lo cambió', () => {
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '15', montoFijo: '30' });

    const fila = repos.limitesDescuento.obtenerPorRol('venta');
    expect(fila?.editadoPor).toBe(idJimmy);
    expect(fila?.editadoPor).not.toBeNull();
  });

  it('y la lista devuelve su NOMBRE, no su id', () => {
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '15', montoFijo: '30' });

    const limite = servicio.listar().find((una) => una.rol === 'venta');
    expect(limite?.editadoPor).toBe('Jimmy');
  });

  it('queda un asiento en auditoria_log con la acción y el usuario', () => {
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '15', montoFijo: '30' });

    const asientos = asientosDeLimite();
    expect(asientos).toHaveLength(1);
    expect(asientos[0]?.accion).toBe('limite_descuento_fijado');
    expect(asientos[0]?.usuarioId).toBe(idJimmy);
  });

  it('el asiento guarda el valor ANTERIOR y el NUEVO: se puede ver qué cambió', () => {
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '10', montoFijo: '20' });
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '25', montoFijo: '50' });

    // El más reciente primero: el reloj inyectado los separa un minuto, así que
    // el orden es el real y no depende del motor.
    const ultimo = asientosDeLimite()[0];
    expect(ultimo?.valorAnterior).toContain('10.00');
    expect(ultimo?.valorNuevo).toContain('25.00');
  });

  it('LA PRIMERA VEZ el valor anterior es null, no un cero inventado', () => {
    // No había fila: decir que «antes era 0.00» sería afirmar que alguien la
    // había configurado en cero, y no es lo mismo que no haberla configurado.
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '10', montoFijo: '20' });

    expect(asientosDeLimite()[0]?.valorAnterior).toBeNull();
  });

  it('una fila sembrada por el guion queda en NULL, y al editarla pasa a tener responsable', () => {
    // Es la diferencia que el prompt pidió mostrar: el guion no tiene detrás a
    // ninguna persona, y ponerle un usuario inventado sería atribuirle a alguien
    // una decisión que no tomó.
    repos.limitesDescuento.fijar({
      rol: 'venta',
      descuentoMaxPorcentaje: '10',
      descuentoMaxMontoFijo: '20',
    });
    expect(repos.limitesDescuento.obtenerPorRol('venta')?.editadoPor).toBeNull();
    expect(servicio.listar().find((una) => una.rol === 'venta')?.editadoPor).toBeNull();

    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '12', montoFijo: '25' });

    expect(repos.limitesDescuento.obtenerPorRol('venta')?.editadoPor).toBe(idJimmy);
    expect(servicio.listar().find((una) => una.rol === 'venta')?.editadoPor).toBe('Jimmy');
  });
});

// ===========================================================================
describe('Qué valores se aceptan y cuáles se rechazan con mensaje de negocio', () => {
  it('acepta cero: significa que ese rol no puede dar descuento', () => {
    const limite = servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '0', montoFijo: '0' });

    expect(limite.porcentaje).toBe('0.00');
    expect(limite.configurado).toBe(true);
  });

  it('acepta decimales y los guarda en forma canónica', () => {
    const limite = servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '7.5', montoFijo: '12.3' });

    expect(limite.porcentaje).toBe('7.50');
    expect(limite.montoFijo).toBe('12.30');
  });

  it('RECHAZA un porcentaje negativo ANTES de llegar al CHECK de la base', () => {
    try {
      servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '-5', montoFijo: '20' });
      throw new Error('Se esperaba un rechazo.');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeNegocio);
      expect((error as ErrorDeNegocio).codigo).toBe('DATO_INVALIDO');
      expect((error as ErrorDeNegocio).message).toContain('negativo');
      // El mensaje además dice qué hacer en su lugar.
      expect((error as ErrorDeNegocio).message).toContain('0');
    }
  });

  it('rechaza un monto fijo negativo igual', () => {
    expect(() =>
      servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '10', montoFijo: '-1' }),
    ).toThrow(ErrorDeNegocio);
  });

  it('un rechazo NO deja la fila a medias: no se escribe nada', () => {
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '10', montoFijo: '20' });
    expect(() =>
      servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '30', montoFijo: '-1' }),
    ).toThrow(ErrorDeNegocio);

    // Los dos valores viejos siguen intactos: el porcentaje válido no se coló.
    const fila = repos.limitesDescuento.obtenerPorRol('venta');
    expect(fila?.descuentoMaxPorcentaje.toFixed(2)).toBe('10.00');
    expect(fila?.descuentoMaxMontoFijo.toFixed(2)).toBe('20.00');
    expect(asientosDeLimite()).toHaveLength(1);
  });

  it('rechaza un campo vacío con un mensaje que dice qué poner', () => {
    try {
      servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '', montoFijo: '20' });
      throw new Error('Se esperaba un rechazo.');
    } catch (error) {
      expect((error as ErrorDeNegocio).message).toContain('vacío');
    }
  });

  it('rechaza un texto que no es un número', () => {
    expect(() =>
      servicio.fijar(idJimmy, { rol: 'venta', porcentaje: 'mucho', montoFijo: '20' }),
    ).toThrow(ErrorDeNegocio);
  });

  it('rechaza un rol que no existe', () => {
    expect(() =>
      servicio.fijar(idJimmy, {
        rol: 'gerente' as 'venta',
        porcentaje: '10',
        montoFijo: '20',
      }),
    ).toThrow(ErrorDeNegocio);
  });

  it('ACEPTA un porcentaje mayor que 100, pero la pantalla avisa que no sirve', () => {
    /*
      No se rechaza porque sería inventar una regla de negocio que nadie
      confirmó, y porque no autoriza nada más: el total ya tiene piso en cero.
      Se avisa sin bloquear, con el mismo criterio del aviso de inventario de la
      pantalla de venta (§4.12). Queda anotado como el punto 17 de §6.2.
    */
    const limite = servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '150', montoFijo: '20' });

    expect(limite.porcentaje).toBe('150.00');
    expect(porcentajeSinEfectoExtra('150.00')).toBe(true);
    expect(porcentajeSinEfectoExtra('100.00')).toBe(false);
    expect(porcentajeSinEfectoExtra('10.00')).toBe(false);
  });
});

// ===========================================================================
describe('Fijar un tope REEMPLAZA el anterior: hay uno solo por rol', () => {
  it('dos cambios seguidos dejan una sola fila, con el último valor', () => {
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '10', montoFijo: '20' });
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '25', montoFijo: '99' });

    const limites = servicio.listar().filter((una) => una.rol === 'venta');
    expect(limites).toHaveLength(1);
    expect(limites[0]?.porcentaje).toBe('25.00');
    expect(limites[0]?.montoFijo).toBe('99.00');
  });

  it('cambiar el de un rol NO toca el del otro', () => {
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '10', montoFijo: '20' });
    servicio.fijar(idJimmy, { rol: 'administrativo', porcentaje: '100', montoFijo: '1000' });
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '15', montoFijo: '40' });

    const administrativo = servicio.listar().find((una) => una.rol === 'administrativo');
    expect(administrativo?.porcentaje).toBe('100.00');
    expect(administrativo?.montoFijo).toBe('1000.00');
  });

  it('los dos cambios quedan en la bitácora: no se pisan entre sí', () => {
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '10', montoFijo: '20' });
    servicio.fijar(idJimmy, { rol: 'venta', porcentaje: '25', montoFijo: '99' });

    // La fila es una sola, pero el historial de quién la cambió es completo.
    expect(asientosDeLimite()).toHaveLength(2);
  });
});

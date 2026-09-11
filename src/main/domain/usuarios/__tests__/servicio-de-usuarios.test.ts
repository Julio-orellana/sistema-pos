/**
 * Gestión de usuarios: alta, edición, cambio de PIN y baja.
 *
 * ESTE MÓDULO CIERRA UN HUECO DE ALCANCE que existía desde el Prompt 3: el
 * sistema sabía crear UN usuario —el primer administrador, y solo con la tabla
 * vacía— y después de eso no había forma de dar de alta al cajero de la tienda.
 * Por eso varias de estas pruebas no se quedan en el servicio: comprueban que
 * el usuario recién creado PUEDE ENTRAR de verdad, usando el mismo servicio de
 * autenticación que usa la pantalla de ingreso. Un alta que no termina en un
 * ingreso posible no resuelve nada.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { ErrorDeNegocio } from '@main/database/errores';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { ServicioDeAutenticacion } from '../autenticacion';
import { ACCIONES_DE_USUARIO, ServicioDeUsuarios } from '../servicio-de-usuarios';

const PIN_DE_JIMMY = '2468';
const PIN_DE_ANA = '1357';

let base: Database;
let repos: Repositorios;
let usuarios: ServicioDeUsuarios;
let autenticacion: ServicioDeAutenticacion;
let limpiar: () => void;

/** El administrador que ya existe, el que haría el primer arranque. */
let idJimmy: string;

/** Los asientos de auditoría de una acción, en toda la base. */
function asientos(accion: string): readonly {
  readonly usuarioId: string | null;
  readonly entidadId: string | null;
  readonly valorNuevo: unknown;
}[] {
  return repos.auditoria
    .listarPorRango('1900-01-01', '2999-01-01')
    .filter((asiento) => asiento.accion === accion);
}

beforeEach(() => {
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);

  usuarios = new ServicioDeUsuarios({
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
  });
  autenticacion = new ServicioDeAutenticacion({
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
    bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
  });

  idJimmy = repos.usuarios.crear({
    nombre: 'Jimmy',
    rol: 'administrativo',
    pinHash: generarHashDePin(PIN_DE_JIMMY),
  }).id;
});

afterEach(() => {
  limpiar();
});

// ===========================================================================
describe('Dar de alta a alguien: el hueco que este módulo vino a cerrar', () => {
  it('un usuario de rol VENTA se crea activo y con su rol', () => {
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });

    expect(ana.nombre).toBe('Ana');
    expect(ana.rol).toBe('venta');
    expect(ana.activo).toBe(true);
  });

  it('y PUEDE INICIAR SESIÓN con el PIN que se le puso', () => {
    // Es la prueba que le da sentido a todo el módulo: un alta que no termina
    // en un ingreso posible no habría resuelto nada.
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });

    const ingreso = autenticacion.autenticar(ana.id, PIN_DE_ANA);
    expect(ingreso.autenticado).toBe(true);
    expect(ingreso.usuario?.id).toBe(ana.id);
    expect(ingreso.usuario?.rol).toBe('venta');
  });

  it('con OTRO PIN no entra: el que se guardó es el que se eligió', () => {
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });
    expect(autenticacion.autenticar(ana.id, '9999').autenticado).toBe(false);
  });

  it('también se puede crear un segundo ADMINISTRATIVO', () => {
    const rosa = usuarios.crear(idJimmy, {
      nombre: 'Rosa',
      rol: 'administrativo',
      pin: '4321',
    });

    expect(rosa.rol).toBe('administrativo');
    expect(autenticacion.autenticar(rosa.id, '4321').autenticado).toBe(true);
  });

  it('el PIN NO se guarda en claro en ningún lado', () => {
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });

    const guardado = repos.usuarios.obtenerPorId(ana.id);
    expect(guardado?.pinHash).not.toContain(PIN_DE_ANA);
    // Se usa el MISMO formato scrypt del resto del sistema, no otro inventado.
    expect(guardado?.pinHash.startsWith('scrypt$')).toBe(true);
  });

  it('el asiento de auditoría registra el alta y NO el PIN', () => {
    usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });

    const registrados = asientos(ACCIONES_DE_USUARIO.creado);
    expect(registrados).toHaveLength(1);
    // A nombre de quien lo creó, no del creado.
    expect(registrados[0]?.usuarioId).toBe(idJimmy);
    expect(JSON.stringify(registrados[0]?.valorNuevo)).not.toContain(PIN_DE_ANA);
  });

  it('el nombre se limpia de espacios sobrantes', () => {
    expect(usuarios.crear(idJimmy, { nombre: '  Ana  ', rol: 'venta', pin: PIN_DE_ANA }).nombre)
      .toBe('Ana');
  });

  it('un nombre repetido se rechaza', () => {
    usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });
    expect(() => usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1111' })).toThrow(
      ErrorDeNegocio,
    );
  });

  it('un nombre vacío se rechaza con un mensaje que lo nombra', () => {
    expect(() => usuarios.crear(idJimmy, { nombre: '   ', rol: 'venta', pin: PIN_DE_ANA }))
      .toThrow(/necesita un nombre/);
  });

  it('un PIN que no tenga cuatro dígitos se rechaza, y no se crea nadie', () => {
    for (const pin of ['123', '12345', 'abcd', '']) {
      expect(() => usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin })).toThrow(
        /cuatro dígitos/,
      );
    }
    // Ninguno de los intentos dejó un usuario a medias.
    expect(repos.usuarios.listarTodos()).toHaveLength(1);
  });
});

// ===========================================================================
describe('Dar de baja: deja de entrar, pero su historial queda intacto', () => {
  /** Crea a Ana y le registra una venta, para tener historial que conservar. */
  function anaConHistorial(): string {
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });
    const sesionId = repos.cajaSesiones.abrir({ usuarioId: ana.id, montoInicial: '500' }).id;
    repos.ventas.crear({
      cajaSesionId: sesionId,
      usuarioId: ana.id,
      subtotal: '10.00',
      total: '10.00',
      formaPago: 'efectivo',
    });
    return ana.id;
  }

  it('antes de la baja, Ana entra sin problema', () => {
    const idAna = anaConHistorial();
    expect(autenticacion.autenticar(idAna, PIN_DE_ANA).autenticado).toBe(true);
  });

  it('DESPUÉS de la baja NO entra, aunque acierte el PIN', () => {
    const idAna = anaConHistorial();
    usuarios.fijarActivo(idJimmy, idAna, false);

    const ingreso = autenticacion.autenticar(idAna, PIN_DE_ANA);
    expect(ingreso.autenticado).toBe(false);
    expect(ingreso.codigo).toBe('USUARIO_INACTIVO');
  });

  it('y NUNCA se borra: sigue en la tabla, con su fila', () => {
    const idAna = anaConHistorial();
    usuarios.fijarActivo(idJimmy, idAna, false);

    const guardado = repos.usuarios.obtenerPorId(idAna);
    expect(guardado).not.toBeNull();
    expect(guardado?.activo).toBe(false);
    expect(guardado?.nombre).toBe('Ana');
  });

  it('SU VENTA sigue ahí, atribuida a ella', () => {
    const idAna = anaConHistorial();
    usuarios.fijarActivo(idJimmy, idAna, false);

    const ventas = repos.ventas.listarPendientesDeSincronizar(10);
    expect(ventas).toHaveLength(1);
    expect(ventas[0]?.usuarioId).toBe(idAna);
  });

  it('SU AUDITORÍA sigue ahí: el alta no desaparece al darla de baja', () => {
    const idAna = anaConHistorial();
    usuarios.fijarActivo(idJimmy, idAna, false);

    expect(asientos(ACCIONES_DE_USUARIO.creado)[0]?.entidadId).toBe(idAna);
    expect(asientos(ACCIONES_DE_USUARIO.desactivado)[0]?.entidadId).toBe(idAna);
  });

  it('deja de ofrecerse en la pantalla de ingreso, que lista solo activos', () => {
    const idAna = anaConHistorial();
    usuarios.fijarActivo(idJimmy, idAna, false);

    expect(repos.usuarios.listarActivos().map((usuario) => usuario.nombre)).toEqual(['Jimmy']);
    // Pero la pantalla de gestión sí lo ve, para poder reactivarlo.
    expect(repos.usuarios.listarTodos()).toHaveLength(2);
  });

  it('reactivar lo deja entrar de nuevo, con el mismo PIN', () => {
    const idAna = anaConHistorial();
    usuarios.fijarActivo(idJimmy, idAna, false);
    usuarios.fijarActivo(idJimmy, idAna, true);

    expect(autenticacion.autenticar(idAna, PIN_DE_ANA).autenticado).toBe(true);
  });

  it('reactivar limpia el bloqueo por intentos que hubiera quedado puesto', () => {
    const idAna = anaConHistorial();
    // Tres PIN equivocados lo bloquean.
    for (let intento = 0; intento < 3; intento += 1) {
      autenticacion.autenticar(idAna, '0000');
    }
    expect(autenticacion.autenticar(idAna, PIN_DE_ANA).codigo).toBe('USUARIO_BLOQUEADO');

    usuarios.fijarActivo(idJimmy, idAna, false);
    usuarios.fijarActivo(idJimmy, idAna, true);

    // Volver a habilitarlo con el candado puesto lo dejaría afuera por una
    // razón que ya nadie recuerda.
    expect(autenticacion.autenticar(idAna, PIN_DE_ANA).autenticado).toBe(true);
  });

  it('dar de baja a quien ya estaba de baja no hace nada ni ensucia la auditoría', () => {
    const idAna = anaConHistorial();
    usuarios.fijarActivo(idJimmy, idAna, false);
    usuarios.fijarActivo(idJimmy, idAna, false);

    expect(asientos(ACCIONES_DE_USUARIO.desactivado)).toHaveLength(1);
  });
});

// ===========================================================================
/**
 * El invariante que ninguna otra capa puede proteger.
 *
 * Si se da de baja al último administrador activo, la tienda queda sin poder
 * abrir caja, cargar catálogo ni crear usuarios, y NO hay vuelta atrás: el
 * primer arranque solo se ofrece con la tabla vacía, y dar de baja no la vacía.
 */
describe('Siempre tiene que quedar un administrador activo', () => {
  it('no se puede dar de baja al ÚNICO administrador', () => {
    // El actor es alguien de VENTA a propósito: así se comprueba el invariante
    // en sí mismo, sin que lo tape la regla de «nadie se da de baja a sí
    // mismo». En producción este canal no lo alcanza un rol de venta, pero el
    // servicio no debe depender de eso para proteger el invariante.
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });
    expect(repos.usuarios.contarAdministradoresActivos()).toBe(1);

    expect(() => usuarios.fijarActivo(ana.id, idJimmy, false)).toThrow(
      /único administrador activo/,
    );
    // Y Jimmy sigue activo: el rechazo no dejó nada a medias.
    expect(repos.usuarios.obtenerPorId(idJimmy)?.activo).toBe(true);
  });

  it('no se puede quitarle el rol administrativo al ÚNICO administrador', () => {
    const rosa = usuarios.crear(idJimmy, { nombre: 'Rosa', rol: 'administrativo', pin: '4321' });
    // Rosa le quita el rol a Jimmy: quedaría ella, así que se permite.
    usuarios.editar(rosa.id, idJimmy, { nombre: 'Jimmy', rol: 'venta' });

    // Ahora Rosa es la única. Jimmy ya no puede, pero tampoco nadie más.
    expect(() => usuarios.editar(idJimmy, rosa.id, { nombre: 'Rosa', rol: 'venta' })).toThrow(
      /único administrador activo/,
    );
  });

  it('CON DOS administradores sí se puede dar de baja a uno', () => {
    const rosa = usuarios.crear(idJimmy, { nombre: 'Rosa', rol: 'administrativo', pin: '4321' });

    expect(usuarios.fijarActivo(rosa.id, idJimmy, false).activo).toBe(false);
    expect(repos.usuarios.contarAdministradoresActivos()).toBe(1);
  });

  it('un administrador de baja NO cuenta: no se puede dejar cero', () => {
    const rosa = usuarios.crear(idJimmy, { nombre: 'Rosa', rol: 'administrativo', pin: '4321' });
    usuarios.fijarActivo(idJimmy, rosa.id, false);

    // Queda solo Jimmy activo, así que ya no se lo puede dar de baja.
    expect(() => usuarios.fijarActivo(rosa.id, idJimmy, false)).toThrow(
      /único administrador activo/,
    );
  });

  it('nadie se da de baja a sí mismo', () => {
    const rosa = usuarios.crear(idJimmy, { nombre: 'Rosa', rol: 'administrativo', pin: '4321' });

    // Aunque quede otro administrador, y por lo tanto el invariante se cumpla.
    expect(() => usuarios.fijarActivo(rosa.id, rosa.id, false)).toThrow(/a vos mismo/);
  });

  it('nadie se cambia el rol a sí mismo', () => {
    const rosa = usuarios.crear(idJimmy, { nombre: 'Rosa', rol: 'administrativo', pin: '4321' });

    expect(() => usuarios.editar(rosa.id, rosa.id, { nombre: 'Rosa', rol: 'venta' })).toThrow(
      /a vos mismo/,
    );
  });

  it('pero sí se puede corregir el PROPIO nombre', () => {
    // El bloqueo es sobre el rol y el estado, no sobre el nombre: corregir un
    // acento en el propio nombre no tiene ningún riesgo.
    expect(usuarios.editar(idJimmy, idJimmy, { nombre: 'Jimmy Cano', rol: 'administrativo' })
      .nombre).toBe('Jimmy Cano');
  });
});

// ===========================================================================
describe('Editar nombre y rol, sin tocar el PIN', () => {
  it('cambia el nombre y el rol', () => {
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });
    const editada = usuarios.editar(idJimmy, ana.id, {
      nombre: 'Ana María',
      rol: 'administrativo',
    });

    expect(editada.nombre).toBe('Ana María');
    expect(editada.rol).toBe('administrativo');
  });

  it('NO toca el PIN: sigue entrando con el que tenía', () => {
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });
    usuarios.editar(idJimmy, ana.id, { nombre: 'Ana María', rol: 'administrativo' });

    expect(autenticacion.autenticar(ana.id, PIN_DE_ANA).autenticado).toBe(true);
  });

  it('el asiento guarda el antes y el después', () => {
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });
    usuarios.editar(idJimmy, ana.id, { nombre: 'Ana María', rol: 'administrativo' });

    const registrados = asientos(ACCIONES_DE_USUARIO.editado);
    expect(registrados).toHaveLength(1);
    expect(JSON.stringify(registrados[0]?.valorNuevo)).toContain('Ana María');
  });

  it('editar a alguien que no existe se explica sin hablar de la base', () => {
    expect(() =>
      usuarios.editar(idJimmy, '00000000-0000-4000-8000-000000000000', {
        nombre: 'Fantasma',
        rol: 'venta',
      }),
    ).toThrow(/No se encontró el usuario/);
  });
});

// ===========================================================================
describe('Cambiar el PIN es una acción aparte', () => {
  it('el PIN nuevo entra y el viejo ya no', () => {
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });
    usuarios.cambiarPin(idJimmy, ana.id, '8080');

    expect(autenticacion.autenticar(ana.id, '8080').autenticado).toBe(true);
    expect(autenticacion.autenticar(ana.id, PIN_DE_ANA).autenticado).toBe(false);
  });

  it('NO pide el PIN anterior: es lo que resuelve un olvido', () => {
    // Si lo pidiera, la persona que lo olvidó quedaría sin forma de volver a
    // entrar, que es justamente el problema que esta operación existe para
    // arreglar. Quien la ejecuta ya es un administrador con sesión iniciada.
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });
    expect(() => usuarios.cambiarPin(idJimmy, ana.id, '8080')).not.toThrow();
  });

  it('un PIN nuevo mal formado se rechaza y el viejo sigue sirviendo', () => {
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });

    expect(() => usuarios.cambiarPin(idJimmy, ana.id, '12')).toThrow(/cuatro dígitos/);
    expect(autenticacion.autenticar(ana.id, PIN_DE_ANA).autenticado).toBe(true);
  });

  it('la auditoría registra el hecho, NUNCA el PIN ni su hash', () => {
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_ANA });
    usuarios.cambiarPin(idJimmy, ana.id, '8080');

    const registrados = asientos(ACCIONES_DE_USUARIO.pinCambiado);
    expect(registrados).toHaveLength(1);
    const contenido = JSON.stringify(registrados[0]?.valorNuevo);
    expect(contenido).not.toContain('8080');
    expect(contenido).not.toContain('scrypt');
  });

  it('un administrador puede cambiarse su PROPIO PIN', () => {
    usuarios.cambiarPin(idJimmy, idJimmy, '9090');
    expect(autenticacion.autenticar(idJimmy, '9090').autenticado).toBe(true);
  });
});

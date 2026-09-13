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
    base,
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
  });
  autenticacion = new ServicioDeAutenticacion({
    base,
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
/**
 * Dos usuarios activos no pueden compartir el PIN.
 *
 * El daño no está donde parece. En el ingreso la colisión es acotada, porque
 * primero se elige el nombre. El problema serio está en el DIÁLOGO DE
 * AUTORIZACIÓN, que prueba el PIN contra todos los administradores activos y se
 * queda con el primero que coincida: con dos PIN iguales, la auditoría termina
 * nombrando a la persona equivocada, en silencio.
 */
describe('Dos usuarios activos no pueden tener el mismo PIN', () => {
  it('el SEGUNDO intento de usar el mismo PIN se rechaza', () => {
    usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1357' });

    expect(() => usuarios.crear(idJimmy, { nombre: 'Rosa', rol: 'venta', pin: '1357' })).toThrow(
      /ya está en uso/,
    );
  });

  it('y el segundo usuario NO queda creado a medias', () => {
    usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1357' });
    expect(() => usuarios.crear(idJimmy, { nombre: 'Rosa', rol: 'venta', pin: '1357' })).toThrow(
      ErrorDeNegocio,
    );

    expect(repos.usuarios.listarTodos().map((usuario) => usuario.nombre)).toEqual([
      'Ana',
      'Jimmy',
    ]);
  });

  it('EL MENSAJE NO NOMBRA NI INSINÚA de quién es el PIN', () => {
    // Decirlo convertiría este control en una forma de averiguar el PIN de otra
    // persona por eliminación: bastaría probar combinaciones al crear usuarios
    // y leer a quién nombra el rechazo.
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1357' });

    try {
      usuarios.crear(idJimmy, { nombre: 'Rosa', rol: 'venta', pin: '1357' });
      throw new Error('Se esperaba el rechazo por PIN repetido.');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeNegocio);
      const negocio = error as ErrorDeNegocio;

      // Ni el nombre, ni el id, ni el rol de la persona con la que colisiona.
      for (const texto of [negocio.mensajeParaElUsuario, negocio.causaTecnica]) {
        expect(texto).not.toContain('Ana');
        expect(texto).not.toContain('Jimmy');
        expect(texto).not.toContain(ana.id);
        expect(texto).not.toContain(idJimmy);
      }
      expect(negocio.mensajeParaElUsuario).toBe('Ese PIN ya está en uso. Elegí otro.');
    }
  });

  it('con otro PIN el segundo usuario se crea sin problema', () => {
    usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1357' });
    // 5791 no lo tiene nadie: ni Jimmy, que arranca con 2468, ni Ana.
    expect(usuarios.crear(idJimmy, { nombre: 'Rosa', rol: 'venta', pin: '5791' }).nombre).toBe(
      'Rosa',
    );
  });

  it('tampoco se puede chocar contra el PIN del ADMINISTRADOR que ya existía', () => {
    expect(() => usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: PIN_DE_JIMMY }))
      .toThrow(/ya está en uso/);
  });

  it('LA REGLA ES UNA SOLA para los dos roles, sin excepción por rol', () => {
    // El riesgo está concentrado en el administrativo, pero un usuario de venta
    // puede pasar a administrativo con una edición: una excepción por rol
    // envejecería mal en cuanto alguien cambie de rol.
    usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1357' });

    expect(() =>
      usuarios.crear(idJimmy, { nombre: 'Rosa', rol: 'administrativo', pin: '1357' }),
    ).toThrow(/ya está en uso/);
    expect(() => usuarios.crear(idJimmy, { nombre: 'Rosa', rol: 'venta', pin: '1357' })).toThrow(
      /ya está en uso/,
    );
  });

  it('al CAMBIAR el PIN también se comprueba', () => {
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1357' });

    expect(() => usuarios.cambiarPin(idJimmy, ana.id, PIN_DE_JIMMY)).toThrow(/ya está en uso/);
    // Y el PIN viejo de Ana sigue sirviendo: el rechazo no cambió nada.
    expect(autenticacion.autenticar(ana.id, '1357').autenticado).toBe(true);
  });

  it('volver a ponerle a alguien el PIN que YA TENÍA no es una colisión', () => {
    // Es una operación que no cambia nada; rechazarla con «ese PIN ya está en
    // uso» sería desconcertante.
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1357' });
    expect(() => usuarios.cambiarPin(idJimmy, ana.id, '1357')).not.toThrow();
    expect(autenticacion.autenticar(ana.id, '1357').autenticado).toBe(true);
  });

  it('el PIN de alguien DADO DE BAJA no reserva el número', () => {
    // Quien está de baja no inicia sesión ni autoriza nada, así que su PIN no
    // puede provocar ninguna de las dos confusiones.
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1357' });
    usuarios.fijarActivo(idJimmy, ana.id, false);

    expect(usuarios.crear(idJimmy, { nombre: 'Rosa', rol: 'venta', pin: '1357' }).nombre).toBe(
      'Rosa',
    );
  });

  it('también choca contra el PIN REMOTO de un administrador', () => {
    // El diálogo de autorización prueba los dos, así que un PIN nuevo igual al
    // remoto de alguien produce la misma atribución equivocada.
    autenticacion.configurarPinRemoto(idJimmy, '9753');

    expect(() => usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '9753' })).toThrow(
      /ya está en uso/,
    );
  });
});

// ===========================================================================
/**
 * LA REGLA EN LA DIRECCIÓN CONTRARIA: el PIN remoto.
 *
 * `configurarPinRemoto` ya comprobaba que el remoto fuera distinto del PIN
 * normal DE UNO MISMO, pero no que no chocara con el de otra persona. Era el
 * hueco simétrico del que cerró el Prompt 22: la misma colisión, entrando por
 * la otra puerta.
 */
describe('Un PIN remoto tampoco puede chocar con el de otra persona', () => {
  it('un PIN remoto igual al PIN NORMAL de otro usuario se rechaza', () => {
    usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1357' });

    expect(() => {
      autenticacion.configurarPinRemoto(idJimmy, '1357');
    }).toThrow(/ya está en uso/);
  });

  it('el rechazo NO nombra ni insinúa de quién es', () => {
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1357' });

    try {
      autenticacion.configurarPinRemoto(idJimmy, '1357');
      throw new Error('Se esperaba el rechazo por PIN repetido.');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeNegocio);
      const negocio = error as ErrorDeNegocio;

      for (const texto of [negocio.mensajeParaElUsuario, negocio.causaTecnica]) {
        expect(texto).not.toContain('Ana');
        expect(texto).not.toContain('Jimmy');
        expect(texto).not.toContain(ana.id);
        expect(texto).not.toContain(idJimmy);
      }
      // Es EXACTAMENTE el mismo mensaje que en el alta: una sola regla, un
      // solo texto.
      expect(negocio.mensajeParaElUsuario).toBe('Ese PIN ya está en uso. Elegí otro.');
    }
  });

  it('y el PIN remoto NO queda configurado: el rechazo no dejó nada', () => {
    usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1357' });
    expect(() => {
      autenticacion.configurarPinRemoto(idJimmy, '1357');
    }).toThrow(ErrorDeNegocio);

    expect(repos.usuarios.obtenerPorId(idJimmy)?.pinRemotoHash).toBeNull();
  });

  it('un PIN remoto igual al PIN REMOTO de otro administrador también se rechaza', () => {
    const rosa = usuarios.crear(idJimmy, { nombre: 'Rosa', rol: 'administrativo', pin: '4321' });
    autenticacion.configurarPinRemoto(rosa.id, '9753');

    expect(() => {
      autenticacion.configurarPinRemoto(idJimmy, '9753');
    }).toThrow(/ya está en uso/);
  });

  it('con un PIN libre sí se configura', () => {
    usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1357' });

    expect(() => {
      autenticacion.configurarPinRemoto(idJimmy, '9753');
    }).not.toThrow();
    expect(repos.usuarios.obtenerPorId(idJimmy)?.pinRemotoHash).not.toBeNull();
  });

  it('se puede REEMPLAZAR el propio PIN remoto por el mismo que ya tenía', () => {
    // Se excluye a uno mismo, igual que en las otras dos operaciones: no es una
    // colisión, es algo que no cambia nada.
    autenticacion.configurarPinRemoto(idJimmy, '9753');
    expect(() => {
      autenticacion.configurarPinRemoto(idJimmy, '9753');
    }).not.toThrow();
  });

  it('sigue sin poder ser igual al PIN NORMAL de uno mismo, con SU mensaje', () => {
    // La regla vieja no se perdió, y conserva su propia explicación: ahí lo que
    // se protege es no regalar el acceso a la sesión al dictarlo por teléfono.
    expect(() => {
      autenticacion.configurarPinRemoto(idJimmy, PIN_DE_JIMMY);
    }).toThrow(
      /DISTINTO de tu PIN normal/,
    );
  });

  it('el PIN de alguien DADO DE BAJA no reserva el número tampoco acá', () => {
    const ana = usuarios.crear(idJimmy, { nombre: 'Ana', rol: 'venta', pin: '1357' });
    usuarios.fijarActivo(idJimmy, ana.id, false);

    expect(() => {
      autenticacion.configurarPinRemoto(idJimmy, '1357');
    }).not.toThrow();
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

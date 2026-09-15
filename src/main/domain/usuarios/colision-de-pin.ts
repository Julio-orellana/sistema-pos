/**
 * Dos usuarios activos no pueden compartir un PIN.
 *
 * VIVE EN SU PROPIO MÓDULO por el día que la necesite otro servicio. Hoy la usa
 * el de gestión de usuarios, al crear a alguien y al cambiarle el PIN.
 *
 * **YA NO SE APLICA A LA AUTORIZACIÓN REMOTA** (migraciones 036 y 037). Existía
 * para el PIN remoto fijo porque un administrador ELEGÍA cuatro dígitos que
 * podían coincidir con los de otro. El código remoto ahora es TOTP: el secreto
 * es aleatorio de 160 bits, lo genera el sistema y nadie lo elige, así que la
 * colisión de elección no es un escenario real. El caso rarísimo de que dos
 * códigos de TOTP coincidan en el mismo momento lo resuelve la verificación
 * misma, que rechaza un código ambiguo (`autenticacion.ts`). Para el PIN NORMAL
 * esta regla sigue exactamente igual.
 *
 * DÓNDE ESTÁ EL DAÑO DE VERDAD, que no es donde parece. En el ingreso la
 * colisión es molesta pero acotada: primero se elige el nombre y después se
 * teclea, así que compartir PIN solo significa que una persona puede entrar
 * como otra si sabe que lo comparten. **El problema serio está en el diálogo de
 * autorización**, que prueba el PIN contra todos los administradores activos y
 * se queda con el primero que coincida (CLAUDE.md §4.9). Con dos PIN iguales,
 * `descuento_autorizado_por` y `diferencia_autorizada_por` terminan nombrando a
 * la persona equivocada, en silencio y sin forma de detectarlo después. En un
 * sistema cuyo valor es la auditoría, eso es peor que la suplantación.
 *
 * SE APLICA A LOS DOS ROLES aunque el riesgo esté concentrado en el
 * administrativo. Una sola regla general es más barata de mantener que dos
 * casos distintos, y un usuario de venta pasa a administrativo con una edición:
 * la excepción envejecería mal en cuanto alguien cambie de rol.
 *
 * SOLO CUENTAN LOS ACTIVOS. Alguien dado de baja no inicia sesión ni autoriza
 * nada, así que su PIN no puede provocar ninguna de las dos confusiones. Si
 * vuelve a habilitarse podría colisionar, pero reservar para siempre todos los
 * PIN históricos iría achicando el espacio disponible sin que nadie entienda
 * por qué.
 */

import { verificarPin } from '@shared/auth';
import { ErrorDeNegocio } from '@main/database/errores';
import type { Usuario } from '@main/database/repositories/entidades';
import type { RepositorioDeUsuarios } from '@main/database/repositories/usuarios';

/**
 * ¿Este PIN es el PIN NORMAL de esta persona?
 *
 * Hasta la migración 037 se miraba además el PIN remoto fijo. Ya no existe: la
 * autorización remota es TOTP, con un secreto que nadie elige.
 */
export function pinCoincideCon(pin: string, usuario: Usuario): boolean {
  try {
    return verificarPin(pin, usuario.pinHash);
  } catch {
    /*
      Un hash ilegible no se puede comparar, así que no se puede afirmar que
      haya colisión. Se lo trata como que no coincide en vez de tumbar la
      operación: una fila corrupta ya deja a ESA persona sin poder entrar —el
      ingreso falla igual—, y bloquear además toda alta o cambio de PIN
      convertiría un problema de una fila en un sistema que no deja trabajar.
    */
    return false;
  }
}

/**
 * Falla si algún OTRO usuario activo ya usa este PIN.
 *
 * `exceptoUsuarioId` deja fuera a la propia persona: volver a ponerle el PIN
 * que ya tenía no es una colisión, es una operación que no cambia nada, y
 * rechazarla con «ese PIN ya está en uso» sería desconcertante.
 *
 * SE COMPARA EL PIN EN CLARO CONTRA CADA HASH, uno por uno, porque dos hash
 * scrypt del mismo PIN son distintos: cada usuario tiene su propia sal, que es
 * justamente lo que impide deducir mirando la tabla quiénes lo comparten
 * (§4.7). Eso obliga a una verificación por usuario activo, y scrypt es lento a
 * propósito: con una decena de usuarios es cerca de un segundo. Es aceptable
 * acá —crear un usuario o cambiarle el PIN son acciones de administrador, no
 * algo que pase en el mostrador— y sería inaceptable en el ingreso.
 */
export function exigirPinNoUsado(
  usuarios: RepositorioDeUsuarios,
  pin: string,
  exceptoUsuarioId: string | null,
): void {
  const yaEstaEnUso = usuarios
    .listarActivos()
    .filter((otro) => otro.id !== exceptoUsuarioId)
    .some((otro) => pinCoincideCon(pin, otro));

  if (!yaEstaEnUso) {
    return;
  }

  /*
    EL MENSAJE NO DICE DE QUIÉN ES, ni lo insinúa, y la causa técnica tampoco
    lleva el id. Decirlo convertiría este control en una forma de averiguar el
    PIN de otra persona por eliminación: bastaría probar combinaciones y leer a
    quién nombra el rechazo.
  */
  throw new ErrorDeNegocio(
    'DATO_INVALIDO',
    'Ese PIN ya está en uso. Elegí otro.',
    'El PIN coincide con el de otro usuario activo.',
  );
}

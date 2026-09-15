/**
 * Qué hace cada tecla del teclado en pantalla, sin DOM y sin React.
 *
 * Existe separado del componente por la misma razón que `venta/ticket.ts`: la
 * regla que decide qué texto queda en el campo se prueba mejor como función
 * pura que pulsando botones. El componente solo dibuja las teclas y llama acá.
 *
 * TRES DISPOSICIONES, y no son cosméticas:
 *
 *   · `texto`   — letras, dígitos, eñe, vocales acentuadas y signos comunes.
 *                 Para nombres de productos y categorías, que en esta tienda
 *                 llevan tildes («Azúcar», «Frijol rojo»).
 *   · `decimal` — dígitos y UN punto. Para precios y cantidades: un segundo
 *                 punto no significa nada y dejarlo escribir solo mueve el
 *                 error al momento de guardar.
 *   · `entero`  — solo dígitos. Para el orden de una categoría.
 *
 * El texto SIEMPRE se agrega al final. Una caja táctil no tiene cursor que
 * mover con precisión, y editar en el medio de un nombre con el dedo es más
 * propenso a error que borrar y volver a escribir.
 */

export type DisposicionDeTeclado = 'texto' | 'decimal' | 'entero';

/** Una pulsación. */
export type Tecla =
  | { readonly tipo: 'caracter'; readonly caracter: string }
  | { readonly tipo: 'espacio' }
  | { readonly tipo: 'borrar' };

export interface OpcionesDeTecla {
  readonly disposicion: DisposicionDeTeclado;
  /** El mismo `maxLength` del campo. Sin él no hay tope. */
  readonly largoMaximo?: number | undefined;
}

/** Filas de la disposición de texto, de arriba hacia abajo. */
export const FILAS_DE_TEXTO: readonly (readonly string[])[] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '-'],
  // Las vocales con tilde tienen tecla propia en vez de una tecla de acento
  // muerta: una tecla que no escribe nada al tocarla se lee en una pantalla
  // táctil como un toque que no se registró.
  ['á', 'é', 'í', 'ó', 'ú', 'ü', '(', ')', '/', '%'],
];

/**
 * Filas de la capa de SÍMBOLOS de la disposición de texto.
 *
 * Existe por dos campos concretos que la capa de letras no alcanzaba: el
 * CORREO del usuario de la nube (sin `@` no hay correo que escribir) y su
 * CONTRASEÑA, que Supabase acepta con cualquier signo. Se entra y se sale con
 * la tecla «#@» / «abc»; las filas de dígitos se conservan arriba para no
 * obligar a cambiar de capa en medio de un correo como `caja1@tienda.gt`.
 */
export const FILAS_DE_SIMBOLOS: readonly (readonly string[])[] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['@', '_', '.', '-', '+', '=', '#', '$', '&', '*'],
  ['!', '?', '¿', '¡', ':', ';', '"', "'", ',', '/'],
  ['(', ')', '[', ']', '{', '}', '<', '>', '%', '\\'],
  ['|', '~', '^', '`', '°', '€', '£', '¬', '·', 'ç'],
];

/** Filas de las disposiciones numéricas. El punto solo existe en `decimal`. */
export const FILAS_NUMERICAS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

/** ¿Este carácter se puede escribir en esta disposición? */
export function caracterAdmitido(caracter: string, disposicion: DisposicionDeTeclado): boolean {
  if (disposicion === 'texto') {
    return caracter.length === 1;
  }
  if (/^[0-9]$/.test(caracter)) {
    return true;
  }
  return disposicion === 'decimal' && caracter === '.';
}

/**
 * El valor del campo después de una pulsación.
 *
 * Devuelve el MISMO valor cuando la tecla no corresponde —un segundo punto, un
 * carácter de más, una letra en un campo numérico—, nunca un error: el campo
 * simplemente no cambia, igual que un campo con `maxLength` en un teclado
 * físico.
 */
export function aplicarTecla(valor: string, tecla: Tecla, opciones: OpcionesDeTecla): string {
  if (tecla.tipo === 'borrar') {
    // `Array.from` y no `slice(0, -1)`: una tilde compuesta o un carácter
    // fuera del plano básico ocupan dos unidades de código, y cortar por la
    // mitad dejaría basura en el nombre del producto.
    return Array.from(valor).slice(0, -1).join('');
  }

  const agregado = tecla.tipo === 'espacio' ? ' ' : tecla.caracter;

  if (tecla.tipo === 'espacio') {
    if (opciones.disposicion !== 'texto') {
      return valor;
    }
    // Un espacio al principio o dos seguidos no son un nombre distinto: son
    // un error de tecleo que después hace fallar la búsqueda por nombre.
    if (valor.length === 0 || valor.endsWith(' ')) {
      return valor;
    }
  } else if (!caracterAdmitido(agregado, opciones.disposicion)) {
    return valor;
  }

  if (opciones.largoMaximo !== undefined && Array.from(valor).length >= opciones.largoMaximo) {
    return valor;
  }

  if (opciones.disposicion === 'decimal' && agregado === '.') {
    if (valor.includes('.')) {
      return valor;
    }
    // Tocar el punto sin haber escrito nada da «0.», que es lo que se espera
    // al querer escribir un precio de centavos: el mismo criterio del teclado
    // numérico del ticket.
    return valor === '' ? '0.' : `${valor}.`;
  }

  if (opciones.disposicion !== 'texto' && valor === '0' && agregado !== '.') {
    // «05» no es nada: un cero solo a la izquierda se reemplaza.
    return agregado;
  }

  return valor + agregado;
}

/** La letra como se escribe con Mayús activa. Los dígitos y signos no cambian. */
export function conMayuscula(caracter: string, mayusculas: boolean): string {
  return mayusculas ? caracter.toLocaleUpperCase('es') : caracter;
}

/**
 * La miniatura de un producto: su foto, o el marcador de "todavía sin foto".
 *
 * POR QUÉ ES UN COMPONENTE Y NO UN `<img>` SUELTO: un producto sin foto no es
 * un caso raro que se resuelva con un hueco vacío. Es el estado NORMAL de todo
 * producto recién dado de alta, y el que Jimmy va a ver la primera vez que
 * cargue su catálogo entero. Antes, un producto sin foto dibujaba un recuadro
 * oscuro vacío: no era un ícono roto, pero se leía como un agujero, como si
 * algo hubiera fallado al cargar. Ahora se ve intencional.
 *
 * QUÉ DIBUJA: las iniciales del producto sobre un color de fondo. Se eligieron
 * iniciales y no un ícono genérico único porque el ícono repetido no distingue
 * una fila de otra, y esta lista se recorre con el dedo buscando un producto
 * concreto: dos marcadores distintos ayudan a barrerla, uno igual en todas las
 * filas no aporta nada.
 *
 * EL COLOR ES DETERMINISTA Y SALE DE UNA PALETA CERRADA: el nombre elige uno
 * de ocho colores elegidos a mano, nunca compone un RGB propio. Determinista
 * porque si fuera al azar el marcador cambiaría en cada recarga y dejaría de
 * servir para reconocer nada; de paleta cerrada porque un color calculado
 * podría caer en una combinación ilegible, y la legibilidad no se apuesta.
 */

/** Cuántas letras lleva el marcador. Más de dos deja de leerse de un vistazo. */
const MAXIMO_DE_INICIALES = 2;

/**
 * PALETA FIJA del marcador. Ocho colores elegidos a mano, no calculados.
 *
 * ES UNA PALETA CERRADA A PROPÓSITO. La alternativa —convertir el hash
 * directamente en un RGB— dejaría la legibilidad librada a la suerte: bastaría
 * un nombre de producto desafortunado para producir un amarillo claro sobre el
 * que las iniciales blancas no se leen. Con una lista cerrada, el hash solo
 * elige ENTRE opciones ya aprobadas; nunca inventa un color.
 *
 * Todos son oscuros para que el texto blanco encima mantenga contraste alto,
 * y todos combinan con el tema oscuro de la aplicación.
 *
 * REGLA PARA QUIEN AGREGUE UN COLOR: tiene que dar al menos 4,5:1 de contraste
 * con el blanco. No hace falta calcularlo a mano —la prueba «cada color de la
 * paleta es legible con texto blanco» lo mide y falla si no llega—, pero sí
 * hace falta saber que ese es el criterio y no el gusto.
 */
export const PALETA_DE_MARCADORES = [
  '#1d4ed8',
  '#6d28d9',
  '#0f766e',
  '#3f6212',
  '#a16207',
  '#c2410c',
  '#b91c1c',
  '#a21caf',
] as const;

/** Alias interno, para que el resto del archivo se lea corto. */
const COLORES = PALETA_DE_MARCADORES;

/** Multiplicador del hash. */
const FACTOR_DE_HASH = 31;

/**
 * Módulo del hash: 2³¹ − 1, primo de Mersenne.
 *
 * El resto se toma contra ESTE número en cada vuelta, y recién al final contra
 * el tamaño de la paleta. Tomarlo directamente contra 8 —como estaba antes—
 * degeneraba el hash: 31 ≡ −1 (mod 8), así que se convertía en una suma
 * alternada y los nombres de una misma familia caían en el mismo color. Se
 * midió: «Maíz blanco», «Maíz amarillo» y «Maíz quebrado» compartían color, y
 * con el módulo primo los cuatro «Maíz» del catálogo quedan distintos.
 */
const MODULO_DEL_HASH = 2147483647;

/**
 * Iniciales que se muestran cuando el producto no tiene foto.
 *
 * Se descartan las palabras que no empiezan con letra o número, que es lo que
 * hace que «[Ejemplo] Maíz blanco» dé «MB» y no «[M»: el prefijo de los datos
 * de ejemplo no debe comerse la inicial verdadera.
 */
export function inicialesDe(nombre: string): string {
  const palabras = nombre
    .split(/\s+/)
    .filter((palabra) => palabra.length > 0 && /[\p{L}\p{N}]/u.test(palabra.charAt(0)));

  if (palabras.length > 0) {
    return palabras
      .slice(0, MAXIMO_DE_INICIALES)
      .map((palabra) => palabra.charAt(0))
      .join('')
      .toLocaleUpperCase('es');
  }

  // Nombres raros: se busca el primer carácter útil en cualquier posición.
  const suelto = /[\p{L}\p{N}]/u.exec(nombre)?.[0];
  return suelto === undefined ? '?' : suelto.toLocaleUpperCase('es');
}

/** Color de fondo del marcador, derivado del nombre. Siempre el mismo. */
export function colorDe(nombre: string): string {
  let acumulado = 0;
  for (const caracter of nombre) {
    acumulado = (acumulado * FACTOR_DE_HASH + (caracter.codePointAt(0) ?? 0)) % MODULO_DEL_HASH;
  }
  // El hash solo ELIGE dentro de la paleta; nunca compone un color.
  return COLORES[acumulado % COLORES.length] ?? COLORES[0];
}

export interface MiniaturaDeProductoProps {
  readonly nombre: string;
  /** URL de la foto, o `null` si el producto todavía no tiene. */
  readonly fotoUrl: string | null;
  /** `lista` es la miniatura de la tabla; `formulario`, la vista previa grande. */
  readonly tamano?: 'lista' | 'formulario';
}

export function MiniaturaDeProducto({
  nombre,
  fotoUrl,
  tamano = 'lista',
}: MiniaturaDeProductoProps): React.JSX.Element {
  const clase = tamano === 'lista' ? 'miniatura' : 'miniatura miniatura--grande';

  if (fotoUrl !== null) {
    return <img className={clase} src={fotoUrl} alt={`Foto de ${nombre}`} />;
  }

  return (
    <span
      className={`${clase} miniatura--sin-foto`}
      style={{ backgroundColor: colorDe(nombre) }}
      /*
        Antes esto era `aria-hidden`, o sea invisible para un lector de
        pantalla: quien no ve la lista no se enteraba de que al producto le
        falta la foto. Ahora lo dice.
      */
      role="img"
      aria-label={`${nombre}: todavía sin foto`}
      data-prueba="miniatura-sin-foto"
      title="Todavía sin foto"
    >
      <span aria-hidden="true">{inicialesDe(nombre)}</span>
    </span>
  );
}

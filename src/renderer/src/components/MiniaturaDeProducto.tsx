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
 * EL COLOR ES DETERMINISTA: sale del nombre, así que el mismo producto tiene
 * siempre el mismo color, en esta pantalla y en cualquier otra. Si fuera al
 * azar, el marcador cambiaría en cada recarga y dejaría de servir para
 * reconocer nada.
 */

/** Cuántas letras lleva el marcador. Más de dos deja de leerse de un vistazo. */
const MAXIMO_DE_INICIALES = 2;

/**
 * Colores del marcador.
 *
 * Elegidos oscuros a propósito: el texto va en blanco y sobre estos fondos
 * mantiene el contraste alto que exigen las reglas táctiles del proyecto, en
 * la pantalla del mostrador y con la luz que haya.
 */
const COLORES = [
  '#1d4ed8',
  '#6d28d9',
  '#0f766e',
  '#3f6212',
  '#a16207',
  '#c2410c',
  '#b91c1c',
  '#a21caf',
] as const;

/** Multiplicador del hash. Un primo pequeño reparte bien nombres parecidos. */
const FACTOR_DE_HASH = 31;

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
    acumulado = (acumulado * FACTOR_DE_HASH + (caracter.codePointAt(0) ?? 0)) % COLORES.length;
  }
  return COLORES[acumulado] ?? COLORES[0];
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

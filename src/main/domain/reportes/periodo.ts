/**
 * Qué significa «hoy», «ayer» o «este mes» para una tienda en Guatemala.
 *
 * ES UN MÓDULO PURO: entra un instante y un período elegido, salen dos cadenas
 * ISO en UTC. No toca la base, no lee el reloj por su cuenta —se le pasa— y por
 * eso se puede probar el cambio de día sin esperar a la medianoche.
 *
 * ## El problema que resuelve, y por qué no es un detalle
 *
 * `ventas.fecha` se guarda en **UTC**, que es lo correcto para guardar. Pero
 * quien pide el reporte está parado en el mostrador, y para esa persona «hoy»
 * es el día de Guatemala, no el de Greenwich. Guatemala es **UTC−6 todo el
 * año** —no usa horario de verano; medido con `Intl` en enero, julio y
 * septiembre— así que entre las 18:00 y la medianoche locales el día UTC ya
 * avanzó al siguiente.
 *
 * Comparar sin convertir tiene una consecuencia concreta y fea: **todas las
 * ventas hechas después de las 18:00 se le atribuirían al día siguiente**. En
 * una tienda que cierra a las 19:00, el reporte de «hoy» a media tarde estaría
 * bien y el de la noche mentiría, que es la peor forma de estar mal. Es el
 * mismo peligro que CLAUDE.md §4.13 ya anota para `date()` de SQLite al
 * comparar la vigencia de un precio especial; acá se resuelve de raíz en vez de
 * dejarlo anotado.
 *
 * ## Por qué las fronteras se calculan acá y no con `date()` de SQLite
 *
 * `date()` trabaja sobre las cadenas UTC y no sabe nada de Guatemala. Se podría
 * escribir `date(fecha, '-6 hours')`, pero eso mete una regla del negocio
 * dentro de una cadena SQL donde nadie la ve, y la repetiría en cada consulta.
 * Acá vive en un solo lugar, con sus pruebas.
 */

/**
 * Desfase de Guatemala respecto de UTC, en horas.
 *
 * Es una constante y no una consulta a la zona horaria del sistema **a
 * propósito**: el reporte tiene que dar lo mismo en la computadora de la tienda
 * que en la de Julio, y la máquina de desarrollo está en otra zona. Guatemala
 * no usa horario de verano, así que un número fijo es exacto. Si algún día lo
 * adoptara, este es el único lugar que habría que tocar.
 */
export const DESFASE_DE_GUATEMALA_EN_HORAS = -6;

/** Milisegundos que tiene una hora. */
const MILISEGUNDOS_POR_HORA = 3_600_000;

/** Milisegundos que tiene un día. */
const MILISEGUNDOS_POR_DIA = 86_400_000;

/** Cuántos días abarca «los últimos 7 días», contando el de hoy. */
const DIAS_DE_LA_SEMANA_CORRIDA = 7;

/** Dígitos con que se escribe un mes o un día: «09», no «9». */
const DIGITOS_DE_MES_Y_DIA = 2;

/** Dígitos de un año. */
const DIGITOS_DE_ANIO = 4;

/** Qué períodos se pueden pedir. */
export type ClaseDePeriodo = 'hoy' | 'ayer' | 'ultimos-7-dias' | 'este-mes' | 'personalizado';

/** Un período pedido. `desde`/`hasta` solo se usan en `personalizado`. */
export interface PeriodoPedido {
  readonly clase: ClaseDePeriodo;
  /** Día inicial en formato `AAAA-MM-DD`, hora de Guatemala. */
  readonly desde?: string | null | undefined;
  /** Día final INCLUSIVO en formato `AAAA-MM-DD`, hora de Guatemala. */
  readonly hasta?: string | null | undefined;
}

/** Un período ya resuelto a instantes concretos. */
export interface PeriodoResuelto {
  readonly clase: ClaseDePeriodo;
  /** Primer instante incluido, en ISO UTC. */
  readonly desdeIso: string;
  /** Último instante incluido, en ISO UTC. Es el `.999` del día final. */
  readonly hastaIso: string;
  /** El primer día del período, `AAAA-MM-DD` en hora de Guatemala. */
  readonly desdeDia: string;
  /** El último día del período, `AAAA-MM-DD` en hora de Guatemala. */
  readonly hastaDia: string;
  /** Cómo se lee el período en la pantalla. */
  readonly etiqueta: string;
}

/** Error de un período mal pedido. Lo traduce el servicio a `ErrorDeNegocio`. */
export class ErrorDePeriodo extends Error {
  public constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDePeriodo';
  }
}

/** Las tres partes de un día civil de Guatemala. */
interface DiaCivil {
  readonly anio: number;
  /** Mes de 1 a 12, no el 0 a 11 de JavaScript. */
  readonly mes: number;
  readonly dia: number;
}

/**
 * El día de Guatemala en el que cae un instante.
 *
 * Se corre el instante por el desfase y después se leen los campos **UTC** del
 * resultado. Leer los campos locales (`getFullYear`) daría el día de la máquina
 * que corre el reporte, que en desarrollo no es Guatemala.
 */
export function diaDeGuatemala(instante: number): DiaCivil {
  const corrido = new Date(instante + DESFASE_DE_GUATEMALA_EN_HORAS * MILISEGUNDOS_POR_HORA);
  return {
    anio: corrido.getUTCFullYear(),
    mes: corrido.getUTCMonth() + 1,
    dia: corrido.getUTCDate(),
  };
}

/** El día civil como `AAAA-MM-DD`. */
export function comoDia(dia: DiaCivil): string {
  const mes = String(dia.mes).padStart(DIGITOS_DE_MES_Y_DIA, '0');
  const numero = String(dia.dia).padStart(DIGITOS_DE_MES_Y_DIA, '0');
  return `${String(dia.anio).padStart(DIGITOS_DE_ANIO, '0')}-${mes}-${numero}`;
}

/** El instante UTC en que empieza un día de Guatemala. */
function inicioDelDia(dia: DiaCivil): number {
  const medianocheComoSiFueraUtc = Date.UTC(dia.anio, dia.mes - 1, dia.dia, 0, 0, 0, 0);
  // La medianoche de Guatemala ocurre SEIS HORAS DESPUÉS que la de UTC, así que
  // se le resta el desfase (que es negativo) para volver al instante real.
  return medianocheComoSiFueraUtc - DESFASE_DE_GUATEMALA_EN_HORAS * MILISEGUNDOS_POR_HORA;
}

/** Suma días a un día civil, cruzando meses y años sin trabajo propio. */
function masDias(dia: DiaCivil, cuantos: number): DiaCivil {
  const movido = new Date(Date.UTC(dia.anio, dia.mes - 1, dia.dia) + cuantos * MILISEGUNDOS_POR_DIA);
  return {
    anio: movido.getUTCFullYear(),
    mes: movido.getUTCMonth() + 1,
    dia: movido.getUTCDate(),
  };
}

/** Interpreta un `AAAA-MM-DD` escrito por una persona. */
function leerDia(texto: string, comoSeLlama: string): DiaCivil {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto.trim());
  if (partes === null) {
    throw new ErrorDePeriodo(`${comoSeLlama} tiene que ser una fecha con forma AAAA-MM-DD.`);
  }
  const anio = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);

  /*
    Se comprueba que la fecha EXISTA, no solo que tenga la forma: `2026-02-31`
    pasa la expresión regular y `Date.UTC` la convierte en el 3 de marzo sin
    avisar. Un reporte que corre sobre un rango distinto del que se pidió, en
    silencio, es peor que uno que se niega a correr.
  */
  const armada = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    armada.getUTCFullYear() !== anio ||
    armada.getUTCMonth() + 1 !== mes ||
    armada.getUTCDate() !== dia
  ) {
    throw new ErrorDePeriodo(`${comoSeLlama} no es una fecha que exista en el calendario.`);
  }
  return { anio, mes, dia };
}

/** Cómo se lee un día en la pantalla: «11/09/2026». */
function diaLegible(dia: DiaCivil): string {
  const dd = String(dia.dia).padStart(DIGITOS_DE_MES_Y_DIA, '0');
  const mm = String(dia.mes).padStart(DIGITOS_DE_MES_Y_DIA, '0');
  return `${dd}/${mm}/${String(dia.anio)}`;
}

/**
 * Resuelve un período pedido a un rango de instantes UTC.
 *
 * `hasta` es INCLUSIVO hasta el último milisegundo del día: una venta de las
 * 23:59 de Guatemala entra en el reporte de ese día. Con un límite exclusivo
 * habría que acordarse de sumar un día en cada consulta, y el día que alguien
 * se olvidara el reporte perdería las ventas del final de la jornada sin que
 * nadie lo notara.
 */
export function resolverPeriodo(pedido: PeriodoPedido, instante: number): PeriodoResuelto {
  const hoy = diaDeGuatemala(instante);

  const { primero, ultimo, etiqueta } = fronterasDe(pedido, hoy);

  const desdeIso = new Date(inicioDelDia(primero)).toISOString();
  // El último instante incluido: la medianoche del día SIGUIENTE menos 1 ms.
  const hastaIso = new Date(inicioDelDia(masDias(ultimo, 1)) - 1).toISOString();

  if (desdeIso > hastaIso) {
    throw new ErrorDePeriodo('La fecha de inicio no puede ser posterior a la de fin.');
  }

  return {
    clase: pedido.clase,
    desdeIso,
    hastaIso,
    desdeDia: comoDia(primero),
    hastaDia: comoDia(ultimo),
    etiqueta,
  };
}

/** Los dos días extremos de cada clase de período, y cómo se lee. */
function fronterasDe(
  pedido: PeriodoPedido,
  hoy: DiaCivil,
): { readonly primero: DiaCivil; readonly ultimo: DiaCivil; readonly etiqueta: string } {
  switch (pedido.clase) {
    case 'hoy':
      return { primero: hoy, ultimo: hoy, etiqueta: `Hoy · ${diaLegible(hoy)}` };

    case 'ayer': {
      const ayer = masDias(hoy, -1);
      return { primero: ayer, ultimo: ayer, etiqueta: `Ayer · ${diaLegible(ayer)}` };
    }

    case 'ultimos-7-dias': {
      /*
        SIETE DÍAS CONTANDO EL DE HOY, no los siete anteriores: por eso se
        retrocede 6 y no 7. Un reporte de «últimos 7 días» que no incluyera lo
        vendido hoy sería desconcertante para quien lo pide a media tarde.
      */
      const primero = masDias(hoy, -(DIAS_DE_LA_SEMANA_CORRIDA - 1));
      return {
        primero,
        ultimo: hoy,
        etiqueta: `Últimos 7 días · ${diaLegible(primero)} a ${diaLegible(hoy)}`,
      };
    }

    case 'este-mes': {
      const primero: DiaCivil = { anio: hoy.anio, mes: hoy.mes, dia: 1 };
      return {
        primero,
        // Hasta HOY, no hasta fin de mes: el futuro no tiene ventas y prometer
        // un rango que todavía no ocurrió confunde al leer la etiqueta.
        ultimo: hoy,
        etiqueta: `Este mes · ${diaLegible(primero)} a ${diaLegible(hoy)}`,
      };
    }

    case 'personalizado': {
      if (pedido.desde === null || pedido.desde === undefined || pedido.desde === '') {
        throw new ErrorDePeriodo('Elegí la fecha de inicio del rango.');
      }
      if (pedido.hasta === null || pedido.hasta === undefined || pedido.hasta === '') {
        throw new ErrorDePeriodo('Elegí la fecha de fin del rango.');
      }
      const primero = leerDia(pedido.desde, 'La fecha de inicio');
      const ultimo = leerDia(pedido.hasta, 'La fecha de fin');
      return {
        primero,
        ultimo,
        etiqueta: `${diaLegible(primero)} a ${diaLegible(ultimo)}`,
      };
    }
  }
}

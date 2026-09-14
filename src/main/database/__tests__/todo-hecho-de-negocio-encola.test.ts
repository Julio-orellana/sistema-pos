/**
 * TODO HECHO DE NEGOCIO PASA POR LA BANDEJA DE SALIDA. Sin excepciones no
 * escritas.
 *
 * ===========================================================================
 * POR QUÉ ESTA PRUEBA EXISTE, Y POR QUÉ LA QUE YA HABÍA NO ALCANZABA
 * ===========================================================================
 *
 * `trabajador.test.ts` ya exige que **solo tres archivos** nombren
 * `.transaction(`. Esa prueba protege de que alguien abra una transacción por
 * su cuenta y se saltee la señal que hace ceder al trabajador.
 *
 * **No protege de lo contrario, que es peor: no abrir ninguna.**
 * `crearPrimerAdministrador` escribía sus dos filas sueltas, sin transacción
 * y sin encolar, así que no nombraba `.transaction(` y aquella prueba lo
 * dejaba pasar. El defecto vivió desde el Prompt 3 y se descubrió recién en la
 * fase 3.b, **corriendo una venta real contra Postgres**: el primer lote de
 * toda instalación nueva moría con `23503` y la cola quedaba detenida para
 * siempre (CLAUDE.md §4.25).
 *
 * ===========================================================================
 * LA REGLA QUE SE COMPRUEBA, Y POR QUÉ ES ESTA
 * ===========================================================================
 *
 * > **Cada `auditoria.registrar(` de un servicio de dominio tiene que estar
 * > DENTRO de un `conBandejaDeSalida(`.**
 *
 * El asiento de auditoría es el marcador exacto de «acá pasó un hecho del
 * negocio»: §4.17 lo dice al revés —toda operación de negocio deja su
 * asiento— y `auditoria_log` es una de las doce tablas que se sincronizan. Así
 * que un asiento fuera del envoltorio es, por definición, un hecho de negocio
 * que no va a llegar a la nube.
 *
 * Es una comprobación TEXTUAL sobre el código fuente, igual que la de los
 * guards de IPC. No prueba que lo encolado sea lo correcto —para eso están las
 * pruebas de cada servicio— sino que **nadie se saltee el envoltorio**, que es
 * el error que ya se cometió dos veces: en los seis servicios de la fase 1.a y
 * en el primer administrador.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CARPETA_DE_DOMINIO = join(__dirname, '..', '..', 'domain');

/**
 * Operaciones que escriben un asiento y **NO** deben encolar, con su razón.
 *
 * Está vacía a propósito. Si alguna vez hace falta agregar una, la razón va
 * escrita al lado: una lista de excepciones sin motivos deja de significar
 * algo, que es lo mismo que se exige del inventario de CHECK con NULL (§5).
 */
const EXCEPCIONES_CON_MOTIVO: Readonly<Record<string, string>> = {};

/** Un asiento encontrado en el código, con dónde está. */
interface AsientoEnElCodigo {
  readonly archivo: string;
  readonly linea: number;
  readonly dentroDelEnvoltorio: boolean;
}

/**
 * Las DOS formas legítimas de abrir una operación de negocio, y por qué son
 * dos y no una.
 *
 * `conBandejaDeSalida` es el molde común: transacción más encolado, en una
 * línea. Lo usan los siete servicios que hacen una escritura y su asiento.
 *
 * `enTransaccionDeNegocio` + `encolarLote` es la forma abierta, y §4.17 la
 * declara correcta para dos casos: **la venta**, cuya transacción hace siete
 * pasos con reverificación de caja y comparar-y-cambiar de inventario, y **la
 * apertura y el cierre de caja**. Meterlas en el molde común las haría menos
 * legibles, no más seguras.
 *
 * Lo que NO es legítimo es la tercera forma: ninguna de las dos.
 */
const ENVOLTORIOS_VALIDOS = ['conBandejaDeSalida', 'enTransaccionDeNegocio'] as const;

/** Los rangos de texto que ocupa cada envoltorio válido del archivo. */
function rangosDelEnvoltorio(fuente: string): { desde: number; hasta: number }[] {
  const rangos: { desde: number; hasta: number }[] = [];
  const patron = new RegExp(`(?:${ENVOLTORIOS_VALIDOS.join('|')})\\s*\\(`, 'g');
  let coincidencia = patron.exec(fuente);

  while (coincidencia !== null) {
    // Se equilibran paréntesis desde el que abre la llamada hasta el que la
    // cierra. Es tosco y alcanza: el código del proyecto no mete paréntesis
    // dentro de cadenas en estas funciones, y si algún día lo hiciera, el
    // efecto sería un FALSO POSITIVO —la prueba fallaría de más—, que es el
    // lado correcto en el que equivocarse.
    let profundidad = 0;
    let i = coincidencia.index + coincidencia[0].length - 1;
    for (; i < fuente.length; i += 1) {
      if (fuente[i] === '(') {
        profundidad += 1;
      } else if (fuente[i] === ')') {
        profundidad -= 1;
        if (profundidad === 0) {
          break;
        }
      }
    }
    rangos.push({ desde: coincidencia.index, hasta: i });
    coincidencia = patron.exec(fuente);
  }
  return rangos;
}

/** Recorre `src/main/domain` y ubica cada asiento respecto del envoltorio. */
function asientosDelDominio(): AsientoEnElCodigo[] {
  const encontrados: AsientoEnElCodigo[] = [];

  const recorrer = (carpeta: string, prefijo: string): void => {
    for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = join(carpeta, entrada.name);
      const relativa = prefijo === '' ? entrada.name : `${prefijo}/${entrada.name}`;
      if (entrada.isDirectory()) {
        if (entrada.name !== '__tests__') {
          recorrer(ruta, relativa);
        }
        continue;
      }
      if (!entrada.name.endsWith('.ts')) {
        continue;
      }
      const fuente = readFileSync(ruta, 'utf8');
      const rangos = rangosDelEnvoltorio(fuente);
      const patron = /auditoria\.registrar\s*\(/g;
      let coincidencia = patron.exec(fuente);
      while (coincidencia !== null) {
        const posicion = coincidencia.index;
        encontrados.push({
          archivo: relativa,
          linea: fuente.slice(0, posicion).split('\n').length,
          dentroDelEnvoltorio: rangos.some((r) => posicion > r.desde && posicion < r.hasta),
        });
        coincidencia = patron.exec(fuente);
      }
    }
  };

  recorrer(CARPETA_DE_DOMINIO, '');
  return encontrados;
}

// ===========================================================================
describe('Ningún hecho de negocio se escribe fuera de la bandeja de salida', () => {
  const asientos = asientosDelDominio();

  it('hay asientos de auditoría que revisar: la prueba no está mirando al vacío', () => {
    // Sin esto, un cambio de nombre de método dejaría la lista en cero y la
    // prueba pasaría para siempre sin comprobar nada.
    const MINIMO_RAZONABLE = 15;
    expect(asientos.length).toBeGreaterThan(MINIMO_RAZONABLE);
  });

  it('TODOS están dentro de un conBandejaDeSalida, o en la lista de excepciones con su motivo', () => {
    const sueltos = asientos.filter(
      (a) => !a.dentroDelEnvoltorio && EXCEPCIONES_CON_MOTIVO[`${a.archivo}:${String(a.linea)}`] === undefined,
    );

    expect(
      sueltos.map((a) => `${a.archivo}:${String(a.linea)}`),
      'Estos asientos de auditoría NO se encolan: son hechos del negocio que ' +
        'nunca van a llegar a la nube. Ver CLAUDE.md §4.25.',
    ).toEqual([]);
  });

  it('la lista de excepciones no tiene entradas sin motivo escrito', () => {
    for (const [donde, motivo] of Object.entries(EXCEPCIONES_CON_MOTIVO)) {
      expect(motivo.length, `La excepción ${donde} no explica por qué`).toBeGreaterThan(20);
    }
  });

  it('el detector de envoltorios FUNCIONA: encuentra el que está y no inventa el que no', () => {
    // Control del propio detector. Sin esto, un `rangosDelEnvoltorio` roto
    // devolvería siempre «está dentro» y la prueba de arriba pasaría vacía.
    const conEnvoltorio = `conBandejaDeSalida(this.base, () => {\n  this.auditoria.registrar({});\n  return x;\n});`;
    const conElOtro = `enTransaccionDeNegocio(this.base, () => {\n  this.auditoria.registrar({});\n});`;
    expect(rangosDelEnvoltorio(conElOtro)).toHaveLength(1);
    const sinEnvoltorio = `this.auditoria.registrar({});`;

    const rangos = rangosDelEnvoltorio(conEnvoltorio);
    expect(rangos).toHaveLength(1);
    expect(conEnvoltorio.indexOf('auditoria.registrar')).toBeGreaterThan(rangos[0]?.desde ?? 0);
    expect(conEnvoltorio.indexOf('auditoria.registrar')).toBeLessThan(rangos[0]?.hasta ?? 0);
    expect(rangosDelEnvoltorio(sinEnvoltorio)).toEqual([]);
  });
});

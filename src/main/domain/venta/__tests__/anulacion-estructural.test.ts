/**
 * Pruebas ESTRUCTURALES de la anulación (docs/ANULACION-DE-VENTA.md §1.3, §3.3,
 * §6.3 y §10.1).
 *
 * No prueban lo que el código hace: prueban lo que el código NO PUEDE hacer sin
 * que alguien se entere. El riesgo que cubren no es el código de hoy, que ya
 * tiene sus pruebas de comportamiento, sino la consulta o el archivo que alguien
 * agregue el año que viene:
 *
 *   · que una consulta vuelva a decidir por `ventas.estado`, que dice
 *     'completada' también en las anuladas;
 *   · que un archivo escriba `'anulada'`, el camino que el diseño descartó;
 *   · que aparezca una tabla o una columna de vouchers (decisión 9: no la hay);
 *   · que el canal pierda su guard;
 *   · que algún código lea los asientos de la anulación para decidir algo: son
 *     fotografías para una persona, no una segunda fuente de verdad (§6.3).
 *
 * Cada detector tiene su CONTROL: un caso donde lo que busca SÍ está. Sin eso,
 * un detector roto que no encuentra nunca nada dejaría la prueba pasando en
 * falso.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..', '..', '..', '..', '..');
const SRC = join(RAIZ, 'src');

/** Todos los .ts y .tsx de producción bajo una carpeta: sin pruebas. */
function archivosDeProduccion(carpeta: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === '__tests__' || entrada.name === 'node_modules') {
        continue;
      }
      encontrados.push(...archivosDeProduccion(ruta));
    } else if (/\.(ts|tsx)$/.test(entrada.name) && !/\.(test|spec|nube)\.tsx?$/.test(entrada.name)) {
      encontrados.push(ruta);
    }
  }
  return encontrados;
}

const PRODUCCION = archivosDeProduccion(SRC).map((ruta) => ({
  ruta: relative(RAIZ, ruta),
  texto: readFileSync(ruta, 'utf8'),
}));

/** Las líneas de un texto que cumplen un patrón, con su número. */
function lineasQue(texto: string, patron: RegExp): string[] {
  return texto
    .split('\n')
    .map((linea, indice) => ({ linea, numero: indice + 1 }))
    .filter(({ linea }) => patron.test(linea))
    .map(({ linea, numero }) => `${String(numero)}: ${linea.trim()}`);
}

// ===========================================================================
describe('NINGUNA consulta decide por ventas.estado (§1.3)', () => {
  /*
    Una DECISIÓN sobre el estado de la venta tiene una de dos formas: en SQL,
    `estado = 'completada'` (o `<>`, `!=`, `IN ('…')`); en TypeScript,
    `.estado === 'completada'`. ESCRIBIR el estado al crear la venta
    (`estado: 'completada'`) no es una decisión y no se marca.
  */
  const DECIDE_EN_SQL = /\bestado\s*(=|<>|!=|IN\s*\()\s*'(completada|anulada)'/i;
  const DECIDE_EN_TS = /\.estado\s*(===|!==|==|!=)\s*'(completada|anulada)'/;

  function decisiones(texto: string): string[] {
    return [...lineasQue(texto, DECIDE_EN_SQL), ...lineasQue(texto, DECIDE_EN_TS)];
  }

  it('control: el detector encuentra las dos formas, y no marca la escritura ni el estado de la caja', () => {
    expect(decisiones("WHERE fecha >= ? AND estado = 'completada'")).toHaveLength(1);
    expect(decisiones("AND v.estado <> 'anulada'")).toHaveLength(1);
    expect(decisiones(".filter((venta) => venta.estado === 'completada')")).toHaveLength(1);
    expect(decisiones("estado: 'completada',")).toEqual([]);
    expect(decisiones("if (caja.estado !== 'abierta') {")).toEqual([]);
  });

  it('en todo el código de producción no queda ninguna', () => {
    const encontradas = PRODUCCION.flatMap(({ ruta, texto }) => decisiones(texto).map((linea) => `${ruta}:${linea}`));
    expect(encontradas).toEqual([]);
  });
});

// ===========================================================================
describe("NINGÚN archivo de producción escribe 'anulada' (§1.3)", () => {
  /*
    El único lugar donde el literal puede aparecer es el tipo `EstadoVenta`, que
    refleja el CHECK del esquema (`ventas.estado` admite 'anulada' desde la 001 y
    la columna no se toca: sería el rebuild de doce pasos). Declarar un tipo no
    escribe nada.
  */
  const PERMITIDO = { ruta: join('src', 'main', 'database', 'repositories', 'entidades.ts'), linea: /export type EstadoVenta = 'completada' \| 'anulada';/ };

  function apariciones(texto: string): string[] {
    return lineasQue(texto, /'anulada'/);
  }

  it("control: el detector encuentra el literal donde está", () => {
    expect(apariciones(`.prepare("UPDATE ventas SET estado = 'anulada' WHERE id = ?")`)).toHaveLength(1);
  });

  it('solo aparece en la declaración del tipo, y en ningún otro lado', () => {
    const encontradas = PRODUCCION.flatMap(({ ruta, texto }) =>
      apariciones(texto)
        .filter((linea) => !(ruta === PERMITIDO.ruta && PERMITIDO.linea.test(linea)))
        .map((linea) => `${ruta}:${linea}`),
    );
    expect(encontradas).toEqual([]);
  });

  it('y RepositorioDeVentas ya no tiene anular(): el camino descartado no queda a mano', () => {
    const repositorio = PRODUCCION.find(({ ruta }) => ruta.endsWith(join('repositories', 'ventas.ts')));
    expect(repositorio?.texto).not.toMatch(/public\s+anular\s*\(/);
  });
});

// ===========================================================================
describe('No hay tabla ni columna de vouchers en ninguna migración (§3.3, decisión 9)', () => {
  const CARPETAS = [
    join(SRC, 'main', 'database', 'migrations'),
    join(RAIZ, 'supabase', 'migrations'),
  ];
  const MIGRACIONES = CARPETAS.flatMap((carpeta) =>
    readdirSync(carpeta)
      .filter((nombre) => nombre.endsWith('.sql'))
      .map((nombre) => ({ nombre, texto: readFileSync(join(carpeta, nombre), 'utf8') })),
  );

  /** Sin comentarios: un comentario que menciona el voucher no crea nada. */
  function sinComentarios(sql: string): string {
    return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  }

  function definicionesDeVoucher(sql: string): string[] {
    const limpio = sinComentarios(sql);
    const tablas = limpio.match(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?[\w.]*voucher\w*/gi) ?? [];
    const columnasAgregadas = limpio.match(/ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?\w*voucher\w*/gi) ?? [];
    const columnasEnTabla = limpio.match(/^\s*\w*voucher\w*\s+(TEXT|INTEGER|NUMERIC|UUID|VARCHAR)/gim) ?? [];
    return [...tablas, ...columnasAgregadas, ...columnasEnTabla];
  }

  it('control: el detector encuentra una tabla, una columna agregada y una columna dentro de una tabla', () => {
    expect(definicionesDeVoucher('CREATE TABLE IF NOT EXISTS vouchers (id TEXT);')).toHaveLength(1);
    expect(definicionesDeVoucher('ALTER TABLE anulaciones_de_venta ADD COLUMN voucher_bancario TEXT;')).toHaveLength(1);
    expect(definicionesDeVoucher('CREATE TABLE x (\n  id TEXT,\n  voucher TEXT NOT NULL\n);')).toHaveLength(1);
    expect(definicionesDeVoucher('-- el número de voucher ya está en ventas.num_boleta')).toEqual([]);
  });

  it('en las migraciones locales y de la nube no hay ninguna', () => {
    expect(MIGRACIONES.length).toBeGreaterThan(30);
    const encontradas = MIGRACIONES.flatMap(({ nombre, texto }) => definicionesDeVoucher(texto).map((d) => `${nombre}: ${d}`));
    expect(encontradas).toEqual([]);
  });
});

// ===========================================================================
describe('El canal venta:anular tiene su guard de sesión', () => {
  const MANEJADORES = PRODUCCION.find(({ ruta }) => ruta.endsWith(join('ipc', 'register-handlers.ts')))?.texto ?? '';

  /** El bloque de `ipcMain.handle(` que registra un canal, hasta el cierre del handle. */
  function bloqueDelCanal(texto: string, canal: string): string {
    const inicio = texto.indexOf(`CANALES_IPC.${canal},`);
    if (inicio === -1) {
      return '';
    }
    const fin = texto.indexOf('\n  );', inicio);
    return texto.slice(inicio, fin === -1 ? undefined : fin);
  }

  it('control: el bloque del cierre de caja, que ya tiene guard, se encuentra', () => {
    expect(bloqueDelCanal(MANEJADORES, 'cerrarCaja')).toContain('requiereSesion(dependencias.sesion');
  });

  it('el manejador valida el payload con Zod y exige sesión antes de delegar', () => {
    const bloque = bloqueDelCanal(MANEJADORES, 'ventaAnular');
    expect(bloque).toContain('requiereSesion(dependencias.sesion');
    expect(bloque).toContain('esquemaPedidoDeAnulacion.parse(payload)');
    expect(bloque.indexOf('requiereSesion(')).toBeLessThan(bloque.indexOf('flujoDeAnulacion.pedir('));
  });
});

// ===========================================================================
describe('Ningún código LEE los asientos de la anulación (§6.3)', () => {
  const SERVICIO = PRODUCCION.find(({ ruta }) => ruta.endsWith(join('venta', 'servicio-de-anulacion.ts')));

  it('el servicio de anulación no llama a ninguna lectura del repositorio de auditoría: solo registra', () => {
    const texto = SERVICIO?.texto ?? '';
    const usos = texto.match(/this\.auditoria\.\w+/g) ?? [];
    expect(usos.length).toBeGreaterThan(0);
    expect([...new Set(usos)]).toEqual(['this.auditoria.registrar']);
  });

  it('control: una lectura de la bitácora se detectaría', () => {
    const conLectura = "this.auditoria.registrar({}); this.auditoria.listarPorEntidadYAccion('ventas', id, 'venta_anulada');";
    expect([...new Set(conLectura.match(/this\.auditoria\.\w+/g) ?? [])]).toContain('this.auditoria.listarPorEntidadYAccion');
  });

  it("ningún otro archivo de producción nombra la acción 'venta_anulada' ni la constante que la escribe", () => {
    const nombran = PRODUCCION.filter(
      ({ ruta, texto }) =>
        ruta !== SERVICIO?.ruta && (texto.includes("'venta_anulada'") || texto.includes('ACCIONES_DE_ANULACION')),
    ).map(({ ruta }) => ruta);
    expect(nombran).toEqual([]);
  });
});

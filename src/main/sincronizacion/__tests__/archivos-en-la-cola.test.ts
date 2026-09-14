/**
 * Los archivos en la cola: van últimos, y uno ausente NO detiene la nada.
 *
 * **Cola SQLite real, trabajador real, proveedor real.** Lo único de mentira es
 * el `fetch`. Es la diferencia entre «el subidor arma bien la petición» —que ya
 * prueba `subida-de-fotos.test.ts`— y «una foto que se borró del disco no deja
 * a la tienda sin respaldar sus ventas», que es lo que importa.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { VERSION_DEL_CONTRATO_DE_SINCRONIZACION } from '@shared/contrato-de-sincronizacion';
import { crearBaseMigrada } from '@main/database/__tests__/ayuda-base-de-datos';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import {
  conBandejaDeSalida,
  encolarFoto,
  observarLotesEncolados,
  type ArchivoParaSubir,
} from '@main/database/bandeja-de-salida';
import { reiniciarSenalDeTransaccion } from '@main/database/transaccion-en-curso';
import { generarHashDePin } from '@shared/auth';

import { SupabaseSyncProvider } from '../supabase-sync-provider';
import { SubidorDeFotos } from '../subida-de-fotos';
import { TrabajadorDeSincronizacion } from '../trabajador';
import type { EstadoDeNube, SesionDeNube } from '../sesion-de-nube';

const URL_DEL_PROYECTO = 'https://ztidrshifrblhfraiowg.supabase.co';

let base: Database;
let limpiar: () => void;
let repos: Repositorios;
/** Las URL a las que se llamó, en orden. */
let llamadas: string[];

function sesionConectada(): SesionDeNube {
  return {
    accessTokenVigente: (): string | null => 'token-de-mentira',
    estado: (): Partial<EstadoDeNube> => ({ conectada: true, revocada: false, ultimoMotivo: null }),
  } as unknown as SesionDeNube;
}

/** Contesta 200 a todo: a las RPC y a Storage. */
function fetchQueAcepta(): typeof fetch {
  return ((url: string, opciones: RequestInit): Promise<Response> => {
    llamadas.push(url);
    if (url.includes('/storage/v1/')) {
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ Key: 'fotos/x' })),
      } as Response);
    }
    const cuerpo = JSON.parse(opciones.body as string) as { lote: { tabla: string; id: string }[] };
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            funcion: url.split('/rpc/')[1],
            contrato: VERSION_DEL_CONTRATO_DE_SINCRONIZACION,
            filas: cuerpo.lote.map((c) => ({
              tabla: `public.${c.tabla}`,
              id: c.id,
              resultado: 'insertada',
              huella: 'abc',
              recibido_en: '2026-09-14T00:00:00+00:00',
            })),
          }),
        ),
    } as Response);
  }) as unknown as typeof fetch;
}

/** El trabajador completo, con el subidor de fotos y su lector inyectado. */
function crearTrabajador(
  archivosEnDisco: Readonly<Record<string, Buffer | null>>,
): TrabajadorDeSincronizacion {
  return new TrabajadorDeSincronizacion({
    cola: repos.syncCola,
    proveedor: new SupabaseSyncProvider({
      urlDelProyecto: URL_DEL_PROYECTO,
      llavePublicable: 'sb_publishable_de_mentira',
      sesion: sesionConectada(),
      buscar: fetchQueAcepta(),
      subidorDeFotos: new SubidorDeFotos({
        urlDelProyecto: URL_DEL_PROYECTO,
        llavePublicable: 'sb_publishable_de_mentira',
        accessToken: (): string | null => 'token-de-mentira',
        buscar: fetchQueAcepta(),
        leerArchivo: (ruta) => archivosEnDisco[ruta] ?? null,
      }),
    }),
    presupuesto: { pausaEntreLotesMs: 0 },
  });
}

const RUTA_DE_FOTO = 'fotos-de-productos/aaaaaaaa-0000-4000-8000-000000000001.jpg';

function fotoEnLaCola(ruta = RUTA_DE_FOTO): ArchivoParaSubir {
  const archivo: ArchivoParaSubir = {
    rutaLocal: ruta,
    objeto: ruta.split('/')[1] ?? ruta,
    tamano: 3,
    sha256: 'abc',
  };
  encolarFoto(base, archivo);
  return archivo;
}

/** Un usuario, que es el lote de negocio más barato de armar. */
function encolarUsuario(nombre: string): void {
  conBandejaDeSalida(base, () => {
    const creado = repos.usuarios.crear({
      nombre,
      rol: 'venta',
      pinHash: generarHashDePin('1234'),
    });
    return {
      resultado: undefined,
      entradas: [{ tabla: 'usuarios' as const, id: creado.id, operacion: 'insertar' as const }],
    };
  });
}

beforeEach(() => {
  reiniciarSenalDeTransaccion();
  observarLotesEncolados(null);
  llamadas = [];
  const prueba = crearBaseMigrada();
  base = prueba.base;
  limpiar = prueba.limpiar;
  repos = crearRepositorios(base);
});

afterEach(() => {
  observarLotesEncolados(null);
  reiniciarSenalDeTransaccion();
  limpiar();
});

// ===========================================================================
describe('LAS FILAS PRIMERO, LOS ARCHIVOS DESPUÉS (§2.5.1)', () => {
  it('con una foto encolada ANTES que un usuario, sube primero el usuario', async () => {
    /*
      «Las filas son el negocio, los archivos son el adorno». Con una foto por
      delante, una venta cobrada esperaría a que suba el catálogo; al revés, la
      foto espera lo que haga falta y no le cuesta nada a nadie.
    */
    fotoEnLaCola();
    encolarUsuario('Ana');

    await crearTrabajador({ [RUTA_DE_FOTO]: Buffer.from('jpg') }).ejecutarCiclo();

    const funciones = llamadas.map((u) => (u.includes('/storage/') ? 'storage' : 'rpc'));
    expect(funciones).toEqual(['rpc', 'storage']);
  });

  it('las dos cosas suben: la cola queda vacía', async () => {
    fotoEnLaCola();
    encolarUsuario('Ana');

    const resumen = await crearTrabajador({ [RUTA_DE_FOTO]: Buffer.from('jpg') }).ejecutarCiclo();

    expect(resumen.motivo).toBe('cola_vaciada');
    expect(repos.syncCola.contarPendientes()).toBe(0);
  });
});

// ===========================================================================
describe('UN foto_path HUÉRFANO NO DETIENE LA COLA (§2.5.4)', () => {
  it('la foto ausente se aparta y las OTRAS fotos suben igual', async () => {
    const AUSENTE = 'fotos-de-productos/bbbbbbbb-0000-4000-8000-000000000002.jpg';
    fotoEnLaCola(AUSENTE);
    fotoEnLaCola(RUTA_DE_FOTO);

    const resumen = await crearTrabajador({
      // La primera NO está en el disco; la segunda sí.
      [RUTA_DE_FOTO]: Buffer.from('jpg'),
    }).ejecutarCiclo();

    // El ciclo NO se detuvo, y la que sí estaba se subió.
    expect(resumen.motivo).toBe('cola_vaciada');
    expect(llamadas.filter((u) => u.includes('/storage/'))).toHaveLength(1);
  });

  it('el lote de la foto ausente NO queda bloqueante: es del disco, no del negocio', async () => {
    fotoEnLaCola();

    await crearTrabajador({}).ejecutarCiclo();

    const bloqueantes = base
      .prepare('SELECT count(*) AS n FROM sync_cola WHERE bloqueante = 1')
      .get() as { n: number };
    expect(bloqueantes.n).toBe(0);
  });

  it('se aparta UN DÍA, no unos segundos: nada de lo que pase en un minuto lo trae', async () => {
    fotoEnLaCola();
    const antes = Date.now();

    await crearTrabajador({}).ejecutarCiclo();

    const fila = base
      .prepare('SELECT proximo_intento_en FROM sync_cola LIMIT 1')
      .get() as { proximo_intento_en: string };
    const MEDIO_DIA_MS = 12 * 60 * 60 * 1000;
    expect(Date.parse(fila.proximo_intento_en) - antes).toBeGreaterThan(MEDIO_DIA_MS);
  });

  it('Y LAS VENTAS SIGUEN SUBIENDO: es lo que esta regla existe para proteger', async () => {
    fotoEnLaCola();
    encolarUsuario('Ana');
    encolarUsuario('Beto');

    const resumen = await crearTrabajador({}).ejecutarCiclo();

    expect(resumen.motivo).toBe('cola_vaciada');
    expect(llamadas.filter((u) => u.includes('/rpc/'))).toHaveLength(2);
    // Y no quedó ninguna fila de negocio pendiente.
    const pendientesDeNegocio = base
      .prepare(
        `SELECT count(*) AS n FROM sync_cola
          WHERE sincronizado_en IS NULL AND substr(entidad_tipo, 1, 8) <> 'archivo_'`,
      )
      .get() as { n: number };
    expect(pendientesDeNegocio.n).toBe(0);
  });

  it('el ciclo TERMINA: una foto ausente no deja al trabajador dando vueltas', async () => {
    // Sin el filtro de `siguienteLotePendiente`, el mismo lote volvería a salir
    // elegido en cada vuelta y esta prueba no terminaría nunca.
    fotoEnLaCola('fotos-de-productos/cccccccc-0000-4000-8000-000000000003.jpg');
    fotoEnLaCola(RUTA_DE_FOTO);

    const resumen = await crearTrabajador({}).ejecutarCiclo();

    expect(resumen.motivo).toBe('sin_pendientes');
  });

  it('NO se cuentan como subidas: la bitácora no puede decir que se respaldaron', async () => {
    /*
      La primera versión devolvía el lote apartado como si hubiera subido, y el
      resumen decía «cola_vaciada; 2 lotes» de dos fotos que no salieron a la
      red. Un renglón que miente sobre lo que pasó es peor que no tenerlo.
    */
    fotoEnLaCola('fotos-de-productos/dddddddd-0000-4000-8000-000000000004.jpg');
    fotoEnLaCola(RUTA_DE_FOTO);

    const resumen = await crearTrabajador({}).ejecutarCiclo();

    expect(resumen.lotesSubidos).toBe(0);
    expect(resumen.filasSubidas).toBe(0);
  });
});

// ===========================================================================
describe('LOS PDF DE RECIBOS NO SE SUBEN, y el código no lo intenta siquiera', () => {
  /*
    Decisión de §2.5.3, tomada: un PDF es dato derivado que la reimpresión
    regenera, y subirlos llenaría el gigabyte del plan gratuito en unos ocho
    meses. La nube lo respalda —la terminal no tiene NINGUNA política sobre el
    bucket `recibos` (migración 0026)— pero eso es la segunda capa. Esta prueba
    es la primera: que no haya código que lo intente.
  */
  const CARPETA_MAIN = join(__dirname, '..', '..');

  function fuentesDelProcesoPrincipal(): { ruta: string; texto: string }[] {
    const encontrados: { ruta: string; texto: string }[] = [];
    const recorrer = (carpeta: string, prefijo: string): void => {
      for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
        const ruta = join(carpeta, entrada.name);
        const relativa = prefijo === '' ? entrada.name : `${prefijo}/${entrada.name}`;
        if (entrada.isDirectory()) {
          if (entrada.name !== '__tests__') {
            recorrer(ruta, relativa);
          }
        } else if (entrada.name.endsWith('.ts')) {
          encontrados.push({ ruta: relativa, texto: readFileSync(ruta, 'utf8') });
        }
      }
    };
    recorrer(CARPETA_MAIN, '');
    return encontrados;
  }

  it('ningún archivo del proceso principal arma una ruta de subida a recibos', () => {
    const culpables = fuentesDelProcesoPrincipal()
      .filter((f) => /storage\/v1\/object\/[^$'`\s]*recibos/.test(f.texto))
      .map((f) => f.ruta);

    expect(
      culpables,
      'Los PDF de recibos NO se suben (§2.5.3). La terminal tampoco tiene ' +
        'política sobre ese bucket, así que esto fallaría contra la nube.',
    ).toEqual([]);
  });

  it('el subidor tiene UN bucket y es una constante, no un parámetro', () => {
    const fuente = readFileSync(join(CARPETA_MAIN, 'sincronizacion', 'subida-de-fotos.ts'), 'utf8');

    expect(fuente).toMatch(/const BUCKET_DE_FOTOS = 'fotos'/);
    // No se puede pedirle que suba a otro lado: no hay parámetro de bucket.
    expect(fuente).not.toMatch(/bucket:\s*string/);
  });

  it('el detector FUNCIONA: reconoce una ruta a recibos si la hubiera', () => {
    // Control del propio detector. Sin esto, un regex roto dejaría la prueba
    // de arriba pasando en verde para siempre.
    const patron = /storage\/v1\/object\/[^$'`\s]*recibos/;

    expect(patron.test("'/storage/v1/object/recibos/' + id")).toBe(true);
    expect(patron.test("'/storage/v1/object/fotos/' + id")).toBe(false);
  });

  it('no existe un entidad_tipo archivo_pdf que nadie produce', () => {
    const bandeja = readFileSync(
      join(CARPETA_MAIN, 'database', 'bandeja-de-salida.ts'),
      'utf8',
    );

    expect(bandeja).toMatch(/TIPO_DE_ENTRADA_DE_FOTO = 'archivo_foto'/);
    expect(bandeja).not.toMatch(/= 'archivo_pdf'/);
  });
});

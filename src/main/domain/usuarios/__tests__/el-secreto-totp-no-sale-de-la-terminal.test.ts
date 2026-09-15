/**
 * EL SECRETO DE TOTP NUNCA SALE DE ESTA TERMINAL, y se prueba, no se afirma.
 *
 * Es la regla no negociable de la migración 036: quien tenga el secreto calcula
 * todos los códigos futuros de esa persona. Mismo nivel de prueba que la
 * contraseña de la credencial de sincronización (§4.23): se lo persigue por
 * todas las superficies donde podría quedar, y cada búsqueda tiene su control.
 *
 * El recorrido ejercita todo lo que toca el secreto: inscribirse, un código de
 * confirmación equivocado, autorizar en las tres superficies, un código
 * repetido, un secreto que no se puede descifrar, y reinscribirse.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';

import { generarHashDePin } from '@shared/auth';
import { crearRepositorios, type Repositorios } from '@main/database/repositories';
import { crearBaseMigrada, type BaseDePrueba } from '@main/database/__tests__/ayuda-base-de-datos';

import { ServicioDeAutenticacion } from '../autenticacion';
import { decodificarBase32, SEGUNDOS_POR_PASO } from '../totp';
import { CifradoDePrueba, codigoDeLaApp } from './ayuda-totp';

const MS_POR_PASO = SEGUNDOS_POR_PASO * 1000;

let prueba: BaseDePrueba;
let base: Database;
let repos: Repositorios;
let servicio: ServicioDeAutenticacion;
let cifrado: CifradoDePrueba;
const bitacora: string[] = [];
let instante = Date.UTC(2026, 8, 15, 12, 0, 0);
/** Todos los secretos que se llegaron a generar, incluidos el descartado y el reemplazado. */
const secretos: string[] = [];

/** Las formas en que el secreto podría quedar escrito en bytes. */
function formasDelSecreto(secreto: string): Buffer[] {
  return [
    Buffer.from(secreto, 'utf8'),
    Buffer.from(secreto.toLowerCase(), 'utf8'),
    Buffer.from(secreto, 'utf16le'),
    decodificarBase32(secreto),
  ];
}

/** ¿Algún archivo de la carpeta de la base contiene alguna forma de algún secreto? Devuelve dónde. */
function hallazgosEnLaCarpeta(carpeta: string): string[] {
  const hallazgos: string[] = [];
  for (const nombre of readdirSync(carpeta)) {
    const bytes = readFileSync(join(carpeta, nombre));
    for (const secreto of secretos) {
      formasDelSecreto(secreto).forEach((forma, indice) => {
        if (bytes.includes(forma)) {
          hallazgos.push(`${nombre}: forma ${String(indice)}`);
        }
      });
    }
  }
  return hallazgos;
}

/** Busca una aguja en TODO el grafo de un objeto, por profundo que sea. */
function apareceEnAlgunLado(raiz: unknown, aguja: string): boolean {
  const vistos = new Set<unknown>();
  const pila: unknown[] = [raiz];
  while (pila.length > 0) {
    const actual = pila.pop();
    if (typeof actual === 'string') {
      if (actual.includes(aguja)) {
        return true;
      }
      continue;
    }
    if (actual === null || typeof actual !== 'object' || vistos.has(actual)) {
      continue;
    }
    vistos.add(actual);
    pila.push(...Object.values(actual as Record<string, unknown>));
  }
  return false;
}

beforeAll(() => {
  prueba = crearBaseMigrada();
  base = prueba.base;
  repos = crearRepositorios(base);
  cifrado = new CifradoDePrueba();
  servicio = new ServicioDeAutenticacion({
    base,
    usuarios: repos.usuarios,
    auditoria: repos.auditoria,
    bloqueosDeAutorizacion: repos.bloqueosDeAutorizacion,
    cifrado,
    log: { registrar: (origen, mensaje): void => { bitacora.push(`[${origen}] ${mensaje}`); } },
    ahora: (): number => instante,
  });
  const jimmy = repos.usuarios.crear({ nombre: 'Jimmy', rol: 'administrativo', pinHash: generarHashDePin('2468') }).id;

  // 1. Una inscripción con el código EQUIVOCADO: se descarta.
  const descartada = servicio.iniciarInscripcionRemota(jimmy, 'POS pruebas');
  secretos.push(descartada.secreto);
  expect(() => { servicio.confirmarInscripcionRemota(jimmy, '000000'); }).toThrow();

  // 2. La inscripción buena.
  const primera = servicio.iniciarInscripcionRemota(jimmy, 'POS pruebas');
  secretos.push(primera.secreto);
  servicio.confirmarInscripcionRemota(jimmy, codigoDeLaApp(primera.secreto, instante));

  // 3. Las tres superficies con el código dinámico, y un código repetido.
  for (const superficie of ['cierre_con_diferencia', 'descuento_excedente', 'salida_controlada'] as const) {
    instante += MS_POR_PASO;
    expect(servicio.autorizarComoAdministrador(codigoDeLaApp(primera.secreto, instante), superficie).autenticado).toBe(true);
  }
  expect(servicio.autorizarComoAdministrador(codigoDeLaApp(primera.secreto, instante), 'cierre_con_diferencia').codigo).toBe('CODIGO_YA_USADO');

  // 4. Un secreto que no se puede descifrar: deja una línea en la bitácora.
  cifrado.fallarAlDescifrar = true;
  instante += MS_POR_PASO;
  servicio.autorizarComoAdministrador(codigoDeLaApp(primera.secreto, instante), 'cierre_con_diferencia');
  cifrado.fallarAlDescifrar = false;

  // 5. Reinscribirse: el secreto nuevo reemplaza al anterior.
  instante += MS_POR_PASO;
  const segunda = servicio.iniciarInscripcionRemota(jimmy, 'POS pruebas');
  secretos.push(segunda.secreto);
  servicio.confirmarInscripcionRemota(jimmy, codigoDeLaApp(segunda.secreto, instante));
});

afterAll(() => {
  prueba.limpiar();
});

describe('EL SECRETO DE TOTP NO QUEDA EN NINGÚN LADO FUERA DE SU COLUMNA CIFRADA', () => {
  it('el recorrido de verdad dejó rastros donde buscar: asientos, cola, bitácora y el secreto guardado', () => {
    // Sin esto, las búsquedas de abajo podrían pasar porque no se escribió nada.
    expect(secretos).toHaveLength(3);
    expect((base.prepare('SELECT COUNT(*) AS n FROM sync_cola').get() as { n: number }).n).toBeGreaterThan(0);
    expect((base.prepare('SELECT COUNT(*) AS n FROM auditoria_log').get() as { n: number }).n).toBeGreaterThan(0);
    expect(bitacora.length).toBeGreaterThan(0);
    expect(repos.usuarios.listarPorRol('administrativo')[0]?.totpSecretoCifrado).not.toBeNull();
  });

  it('en claro, en NINGÚN archivo de la base: ni el .db ni el -wal ni el -shm, en texto, minúsculas, UTF-16 ni bytes crudos', () => {
    const carpeta = dirname(prueba.ruta);
    expect(readdirSync(carpeta).some((nombre) => nombre.endsWith('-wal'))).toBe(true);
    expect(hallazgosEnLaCarpeta(carpeta)).toEqual([]);

    // Y después de consolidar el WAL en el archivo principal, como al cerrar.
    base.pragma('wal_checkpoint(TRUNCATE)');
    expect(hallazgosEnLaCarpeta(carpeta)).toEqual([]);
  });

  it('control del buscador de archivos: ENCUENTRA el secreto si está', () => {
    const carpeta = dirname(prueba.ruta);
    const plantado = join(carpeta, 'control.txt');
    writeFileSync(plantado, `algo ${secretos[1] ?? ''} algo`);
    expect(hallazgosEnLaCarpeta(carpeta)).toContain('control.txt: forma 0');
    writeFileSync(plantado, decodificarBase32(secretos[1] ?? ''));
    expect(hallazgosEnLaCarpeta(carpeta)).toContain('control.txt: forma 3');
    writeFileSync(plantado, 'nada');
  });

  it('en NINGÚN payload de sync_cola, y ninguno lleva las columnas de TOTP', () => {
    const payloads = (base.prepare('SELECT payload FROM sync_cola').all() as { payload: string }[]).map((f) => f.payload);
    expect(payloads.some((p) => p.includes('"id"'))).toBe(true);
    for (const payload of payloads) {
      for (const secreto of secretos) {
        expect(payload).not.toContain(secreto);
      }
      expect(payload).not.toContain('totp_secreto_cifrado');
      expect(payload).not.toContain('totp_ultimo_paso');
    }
  });

  it('en NINGÚN asiento de auditoría', () => {
    const asientos = base.prepare('SELECT * FROM auditoria_log').all();
    for (const secreto of secretos) {
      expect(apareceEnAlgunLado(asientos, secreto)).toBe(false);
    }
  });

  it('en NINGUNA línea de la bitácora técnica', () => {
    const texto = bitacora.join('\n');
    expect(texto).toContain('No se pudo descifrar');
    for (const secreto of secretos) {
      expect(texto).not.toContain(secreto);
    }
  });

  it('en NINGÚN campo del servicio una vez confirmada o descartada la inscripción', () => {
    for (const secreto of secretos) {
      expect(apareceEnAlgunLado(servicio, secreto)).toBe(false);
    }
  });

  it('control del buscador de objetos: ENCUENTRA el secreto si está, a cualquier profundidad', () => {
    expect(apareceEnAlgunLado({ a: [{ b: { c: `x${secretos[2] ?? ''}x` } }] }, secretos[2] ?? '')).toBe(true);
  });

  it('el único lugar donde está es su columna, CIFRADO, y descifrado es el último secreto', () => {
    const fila = base.prepare('SELECT totp_secreto_cifrado FROM usuarios').get() as { totp_secreto_cifrado: Buffer };
    expect(cifrado.decryptString(fila.totp_secreto_cifrado)).toBe(secretos[2]);
  });
});

describe('Y del lado de la NUBE no existe dónde ponerlo', () => {
  const RAIZ = join(__dirname, '..', '..', '..', '..', '..');

  it('ninguna migración de Supabase nombra el TOTP', () => {
    const carpeta = join(RAIZ, 'supabase', 'migrations');
    const archivos = readdirSync(carpeta).filter((nombre) => nombre.endsWith('.sql'));
    expect(archivos.length).toBeGreaterThan(20);
    for (const nombre of archivos) {
      expect(readFileSync(join(carpeta, nombre), 'utf8').toLowerCase(), nombre).not.toContain('totp');
    }
  });

  it('la foto del esquema de la nube no tiene las columnas de TOTP', () => {
    const foto = readFileSync(join(RAIZ, 'supabase', 'esquema-nube.json'), 'utf8');
    expect(foto).toContain('"usuarios"');
    expect(foto).not.toContain('totp');
  });
});

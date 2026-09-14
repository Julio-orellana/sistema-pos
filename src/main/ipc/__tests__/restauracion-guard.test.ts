/**
 * Los canales de la restauración: SIN guard de sesión, y por qué eso es lo
 * correcto y no un descuido.
 *
 * Todos los demás módulos administrativos tienen una prueba que cuenta sus
 * `ipcMain.handle` y exige un `requiereRol` por canal. Acá se exige lo
 * contrario, y se fija por prueba para que nadie lo «corrija»: la restauración
 * corre sobre una instalación VACÍA, antes de que exista ningún usuario, así
 * que un guard de sesión la haría imposible. Quien autoriza es la nube —el
 * usuario con rol `restauracion`— y el estado de la base, que el servicio
 * comprueba en cada llamada.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Quita los comentarios: las cabeceras de estos archivos nombran `requiereRol`
 * y `sincronizar_*` justamente para explicar por qué NO se usan, y lo que se
 * comprueba acá es el CÓDIGO.
 */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FUENTE = sinComentarios(readFileSync(join(__dirname, '..', 'restauracion.ts'), 'utf8'));
const FUENTE_DEL_CLIENTE = sinComentarios(
  readFileSync(join(__dirname, '..', '..', 'restauracion', 'cliente-de-restauracion.ts'), 'utf8'),
);

const CANALES = [
  'restauracionEstado',
  'restauracionIniciar',
  'restauracionRetomar',
  'restauracionProgreso',
  'restauracionCancelar',
  'restauracionAceptarExcluida',
  'restauracionRevisarUsuario',
  'restauracionAsignarPin',
  'restauracionTerminar',
];

describe('Los nueve canales de la restauración', () => {
  it('hay exactamente NUEVE canales, y son los esperados por nombre', () => {
    expect((FUENTE.match(/ipcMain\.handle\(/g) ?? []).length).toBe(CANALES.length);
    for (const canal of CANALES) {
      expect(FUENTE).toContain(`CANALES_IPC.${canal}`);
    }
  });

  it('NINGUNO lleva guard de sesión ni de rol: no puede haber sesión en una instalación vacía', () => {
    expect(FUENTE).not.toContain('requiereRol');
    expect(FUENTE).not.toContain('requiereSesion');
  });

  it('cada canal delega en el servicio, que es quien hace cumplir el estado de la base', () => {
    const bloques = FUENTE.split(/(?=ipcMain\.handle\()/).filter((b) => b.startsWith('ipcMain.handle('));
    expect(bloques).toHaveLength(CANALES.length);
    for (const bloque of bloques) {
      expect(bloque).toMatch(/servicio\.\w+\(/);
    }
  });

  it('los cinco canales con payload lo validan con zod antes de usarlo', () => {
    expect(FUENTE).toContain('esquemaInicioDeRestauracion.parse(payload)');
    expect(FUENTE).toContain('esquemaRetomaDeRestauracion.parse(payload)');
    expect(FUENTE).toContain('esquemaFilaExcluida.parse(payload)');
    expect(FUENTE).toContain('esquemaRevisionDeUsuario.parse(payload)');
    expect(FUENTE).toContain('esquemaPinDeRestauracion.parse(payload)');
  });

  it('la contraseña y el PIN no se registran en ninguna bitácora desde acá', () => {
    expect(FUENTE).not.toMatch(/registrar\(.*contrasena/);
    expect(FUENTE).not.toMatch(/console\.(log|info|warn|error)\(/);
  });
});

describe('El cliente de restauración SOLO LEE: nunca llama a las funciones de escritura', () => {
  it('no nombra ninguna función sincronizar_*: esas son la puerta de escritura de la terminal', () => {
    expect(FUENTE_DEL_CLIENTE).not.toMatch(/sincronizar_/);
  });

  it('no usa PATCH, DELETE ni PUT contra la nube', () => {
    expect(FUENTE_DEL_CLIENTE).not.toMatch(/'PATCH'|'DELETE'|'PUT'/);
  });

  it('nunca toca el cifrado del sistema ni el archivo de credencial: la sesión es efímera', () => {
    // Se buscan USOS, no menciones: la cabecera del archivo nombra safeStorage
    // justamente para decir que no lo toca.
    expect(FUENTE_DEL_CLIENTE).not.toMatch(/from 'electron'/);
    expect(FUENTE_DEL_CLIENTE).not.toContain('AlmacenDeCredencial');
    expect(FUENTE_DEL_CLIENTE).not.toMatch(/writeFileSync|appendFileSync/);
  });

  it('pide los numéricos con ::text para que no pasen por un double', () => {
    expect(FUENTE_DEL_CLIENTE).toContain('::text');
  });
});

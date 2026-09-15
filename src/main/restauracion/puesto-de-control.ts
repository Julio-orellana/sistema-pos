/**
 * El puesto de control de una restauración: `<userData>/restauracion.json`.
 *
 * §6.6 del diseño: el progreso se guarda al terminar cada página, y retomar
 * significa seguir por la tabla y la página donde quedó. Como cada fila se
 * inserta con «no hacer nada si ya existe», repetir una página ya hecha no
 * duplica nada, así que el puesto de control puede quedar un paso atrás sin
 * consecuencias.
 *
 * Guarda TAMBIÉN lo que hace falta para retomar sin volver a preguntar —el
 * proyecto, el motivo, la fecha del robo— y lo que se decidió en el camino:
 * qué filas quedaron excluidas y qué usuarios ya se revisaron. **No guarda
 * ninguna credencial**: retomar exige volver a iniciar sesión, porque la
 * sesión de restauración es efímera (§6.2) y nunca toca el disco.
 *
 * Si el archivo existe al arrancar la aplicación, hay una restauración
 * incompleta, y la aplicación lo dice en vez de ofrecer el ingreso a una base
 * a medias.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

/** Nombre del archivo dentro de la carpeta de datos. */
export const ARCHIVO_DEL_PUESTO_DE_CONTROL = 'restauracion.json';

/** Sangría del JSON: el archivo se lee a mano cuando algo salió mal. */
const SANGRIA_DEL_JSON = 2;

/** Por qué se restaura. Solo fecha la revisión de anomalías; el reset de PIN es siempre (§6.1). */
export const MOTIVOS_DE_RESTAURACION = ['falla', 'robo'] as const;
export type MotivoDeRestauracion = (typeof MOTIVOS_DE_RESTAURACION)[number];

const esquemaDeTabla = z.object({
  /** El último `id` insertado, para pedir la página siguiente con `id > ultimoId`. */
  ultimoId: z.string().nullable(),
  /** Cuántas filas se escribieron localmente. */
  filas: z.number().int().nonnegative(),
  /** `true` cuando ya no quedan páginas. */
  lista: z.boolean(),
});

const esquemaDeAnomalia = z.object({
  tabla: z.string(),
  id: z.string(),
  recibidoEn: z.string(),
  /** Una línea legible: qué es la fila. */
  resumen: z.string(),
  /** `true` si NO se restauró (tabla de solo inserción, §6.5). */
  excluida: z.boolean(),
  /** `true` si el administrador pidió restaurarla igual. */
  aceptada: z.boolean(),
  /** Solo para `ventas` excluidas: lo que hace falta para cuadrar la suma por mes. */
  total: z.string().nullable(),
  fecha: z.string().nullable(),
});

export type AnomaliaRegistrada = z.infer<typeof esquemaDeAnomalia>;

export const esquemaDelPuestoDeControl = z.object({
  version: z.literal(1),
  /** URL del proyecto: retomar contra otro proyecto se niega. */
  proyecto: z.string(),
  /** Correo de quien restaura. No es un secreto y queda en la auditoría. */
  correo: z.string(),
  motivo: z.enum(MOTIVOS_DE_RESTAURACION),
  fechaDelRobo: z.string().nullable(),
  iniciadaEn: z.string(),
  tablas: z.record(z.string(), esquemaDeTabla),
  anomalias: z.array(esquemaDeAnomalia),
  /** Ids de los usuarios anómalos que ya se revisaron. */
  usuariosRevisados: z.array(z.string()),
  /** Fotos que la nube no tenía, por `foto_path`. */
  fotosFaltantes: z.array(z.string()),
  /** `true` cuando las tablas y las fotos ya están y queda la revisión. */
  transferenciaCompleta: z.boolean(),
});

export type PuestoDeControl = z.infer<typeof esquemaDelPuestoDeControl>;

/** Lee, escribe y borra el puesto de control. */
export class AlmacenDelPuestoDeControl {
  private readonly ruta: string;

  public constructor(private readonly carpetaDeDatos: string) {
    this.ruta = join(carpetaDeDatos, ARCHIVO_DEL_PUESTO_DE_CONTROL);
  }

  /** El puesto de control guardado, o `null` si no hay ninguno o no se entiende. */
  public leer(): PuestoDeControl | null {
    if (!existsSync(this.ruta)) {
      return null;
    }
    try {
      return esquemaDelPuestoDeControl.parse(JSON.parse(readFileSync(this.ruta, 'utf8')));
    } catch {
      // Un archivo ilegible se trata como «hay algo a medias»: quien lo lea
      // decide. Devolver null lo escondería.
      return null;
    }
  }

  /** `true` si hay archivo, aunque no se entienda. */
  public existe(): boolean {
    return existsSync(this.ruta);
  }

  /**
   * Escribe el puesto de control de forma atómica: primero a un archivo
   * temporal y después se renombra. Un corte de energía a mitad de la
   * escritura dejaría el anterior intacto, nunca uno a medias.
   */
  public guardar(puesto: PuestoDeControl): void {
    mkdirSync(this.carpetaDeDatos, { recursive: true });
    const temporal = `${this.ruta}.tmp`;
    writeFileSync(temporal, JSON.stringify(puesto, null, SANGRIA_DEL_JSON), 'utf8');
    renameSync(temporal, this.ruta);
  }

  public borrar(): void {
    rmSync(this.ruta, { force: true });
    rmSync(`${this.ruta}.tmp`, { force: true });
  }
}

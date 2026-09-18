/**
 * Qué hace Chromium con la tarjeta gráfica de esta máquina, dicho para leerlo.
 *
 * POR QUÉ EXISTE (§4.62). El equipo de la tienda tiene un gráfico Intel HD
 * Graphics 3000 (un i3 de segunda generación, 2011), y esta aplicación no tiene
 * cómo medir esa tarjeta desde otra máquina. Lo que sí puede hacer es dejar
 * escrito, en el equipo real, qué tarjeta vio Chromium, qué partes aceleró y
 * cuáles pasó a software. Con eso, la decisión sobre `--disable-gpu` deja de
 * ser una inferencia sobre esa tarjeta y pasa a ser una lectura de la tienda.
 *
 * Es una función PURA: recibe lo que devuelven `app.getGPUFeatureStatus()` y
 * `app.getGPUInfo('basic')` y arma el texto. Así se prueba sin Electron.
 */

/** Lo que devuelve `app.getGPUFeatureStatus()`: nombre de la función → estado. */
export type EstadoDeFuncionesGraficas = Readonly<Record<string, string>>;

/** La parte de `app.getGPUInfo('basic')` que se usa. */
export interface InformacionGraficaBasica {
  readonly gpuDevice?: readonly {
    readonly vendorId?: number;
    readonly deviceId?: number;
    readonly active?: boolean;
    readonly driverVersion?: string;
  }[];
}

/** Las funciones que importan para dibujar esta aplicación, en orden. */
const FUNCIONES_QUE_SE_INFORMAN: readonly (readonly [string, string])[] = [
  ['gpu_compositing', 'composición'],
  ['rasterization', 'rasterizado'],
  ['video_decode', 'video'],
];

/** Base en que se escriben los identificadores de hardware. */
const BASE_HEXADECIMAL = 16;

/** Cifras de un identificador de fabricante o de modelo: `8086`, `0116`. */
const CIFRAS_DE_UN_IDENTIFICADOR = 4;

/** Un número como identificador de hardware: `0x8086`. */
function hexadecimal(valor: number | undefined): string {
  return valor === undefined
    ? '?'
    : `0x${valor.toString(BASE_HEXADECIMAL).padStart(CIFRAS_DE_UN_IDENTIFICADOR, '0')}`;
}

/**
 * «GPU 0x8086:0x0116 (controlador 9.17.10.4459) · composición: enabled ·
 * rasterizado: disabled_software …». Si no hay datos lo dice, no inventa.
 */
export function describirAceleracionGrafica(
  estado: EstadoDeFuncionesGraficas,
  informacion: InformacionGraficaBasica | null,
): string {
  const dispositivos = informacion?.gpuDevice ?? [];
  const activo = dispositivos.find((dispositivo) => dispositivo.active === true) ?? dispositivos[0];
  const tarjeta =
    activo === undefined
      ? 'GPU no informada'
      : `GPU ${hexadecimal(activo.vendorId)}:${hexadecimal(activo.deviceId)}` +
        (activo.driverVersion !== undefined && activo.driverVersion !== ''
          ? ` (controlador ${activo.driverVersion})`
          : '');
  const funciones = FUNCIONES_QUE_SE_INFORMAN.map(
    ([clave, nombre]) => `${nombre}: ${estado[clave] ?? 'sin dato'}`,
  );
  return [tarjeta, ...funciones].join(' · ');
}

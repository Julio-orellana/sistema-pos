/**
 * Cómo se describe la aceleración gráfica para leerla en el diagnóstico y en
 * la bitácora técnica (§4.62). Los textos de entrada son los que devolvió
 * Chromium de verdad en esta máquina, con y sin `--disable-gpu`.
 */

import { describe, expect, it } from 'vitest';

import { describirAceleracionGrafica } from '../aceleracion-grafica';

/** Lo que devolvió `app.getGPUFeatureStatus()` con aceleración (macOS, 2026-09-17). */
const CON_ACELERACION = {
  gpu_compositing: 'enabled',
  rasterization: 'enabled',
  video_decode: 'enabled',
  webgl: 'enabled',
};

/** Lo mismo con `--disable-gpu`. */
const SIN_ACELERACION = {
  gpu_compositing: 'disabled_software',
  rasterization: 'disabled_software',
  video_decode: 'disabled_software',
  webgl: 'disabled_off',
};

describe('La aceleración gráfica, dicha para leerla en el diagnóstico', () => {
  it('nombra la tarjeta ACTIVA por fabricante y modelo, con su controlador, y lo que acelera', () => {
    const texto = describirAceleracionGrafica(CON_ACELERACION, {
      gpuDevice: [
        { vendorId: 0x10de, deviceId: 0x1234, active: false },
        { vendorId: 0x8086, deviceId: 0x0116, active: true, driverVersion: '9.17.10.4459' },
      ],
    });
    expect(texto).toBe(
      'GPU 0x8086:0x0116 (controlador 9.17.10.4459) · composición: enabled · rasterizado: enabled · video: enabled',
    );
  });

  it('con --disable-gpu Chromium no da la tarjeta: lo dice, y muestra que todo pasó a software', () => {
    // MEDIDO: con --disable-gpu, app.getGPUInfo('basic') rechaza con «GPU
    // access not allowed»; quien llama pasa `null`.
    expect(describirAceleracionGrafica(SIN_ACELERACION, null)).toBe(
      'GPU no informada · composición: disabled_software · rasterizado: disabled_software · video: disabled_software',
    );
  });

  it('una función que Chromium no informa dice «sin dato», no inventa un estado', () => {
    expect(describirAceleracionGrafica({}, { gpuDevice: [] })).toBe(
      'GPU no informada · composición: sin dato · rasterizado: sin dato · video: sin dato',
    );
  });

  it('si ninguna tarjeta está marcada como activa, usa la primera; sin controlador no lo menciona', () => {
    expect(
      describirAceleracionGrafica(CON_ACELERACION, { gpuDevice: [{ vendorId: 0x106b, deviceId: 0 }] }),
    ).toBe('GPU 0x106b:0x0000 · composición: enabled · rasterizado: enabled · video: enabled');
  });
});

# 001 — Tareas

> Sale de [`plan.md`](plan.md). Cada tarea dice qué criterio de aceptación de
> [`spec.md`](spec.md) cubre y con qué evidencia se cerró. La evidencia completa,
> con su salida cruda, está en CLAUDE.md §4.63.

| # | Tarea | Cubre | Estado |
|---|---|---|---|
| T0 | Tomar la «foto» del texto y del HTML del recibo con el código de antes (grilla de 24 modelos) | CA-9, CA-10 | **Hecho.** 24 modelos, sha256 `62e0382d…` |
| T1 | `plantilla-de-recibo.ts`: tipos `CopiaImpresa` y `DestinoDelTexto`, encabezados, `COPIAS_QUE_SE_IMPRIMEN`, la tabla `QUE_LLEVA_CADA_DESTINO`, `reciboComoTexto(modelo, destino)` con el destino obligatorio y `textosDeLasCopias(modelo)` | CA-2, CA-3, CA-4, CA-5, CA-15, CA-16 | **Hecho** |
| T2 | `escpos.ts`: `copiasComoEscPos(textos)` | CA-1 | **Hecho** |
| T3 | Contrato `ComprobanteImprimible.copiasEnTexto`, y los dos proveedores reales mandando un solo trabajo | CA-1 | **Hecho** |
| T4 | `servicio-de-recibos.ts`: las dos copias y el mensaje que las nombra | CA-1, CA-7, CA-8, CA-12, CA-13, CA-14 | **Hecho** |
| T5 | `ipc/recibos.ts`: la pantalla pide `'pantalla'` | CA-10 | **Hecho** |
| T6 | Actualizar `recibo.test.ts:300` y `:319` dejando constancia, y las demás llamadas con su destino | CA-17 | **Hecho.** Las dos conservan su bloque con lo que decían antes; cada una tiene al lado una prueba nueva que exige que el dato NO esté en la copia del cliente |
| T7 | Actualizar `anular-desde-el-historial.test.ts:719` (el porqué del voucher) | CA-17 | **Hecho.** Mismo comportamiento, otro porqué, con constancia |
| T8 | Pruebas nuevas de la plantilla sobre la grilla, con las dos copias literales del spec | CA-2 a CA-6, CA-15, CA-16 | **Hecho.** `copias-del-recibo.test.ts`, 158 pruebas |
| T9 | Pruebas nuevas del servicio con una impresora que anota | CA-1, CA-7, CA-8, CA-9, CA-11 a CA-14 | **Hecho.** 10 pruebas en `recibo.test.ts` |
| T10 | Prueba estructural: el destino literal, `'pantalla'` solo en `ipc/recibos.ts` y `copiasEnTexto` solo desde `textosDeLasCopias` | CA-16, CA-18 | **Hecho.** `copias-del-recibo-estructural.test.ts`, 7 pruebas con sus controles |
| T11 | Pruebas de ESC/POS y de los adaptadores con el contrato nuevo | CA-1 | **Hecho.** +4 en `escpos.test.ts`, +3 en `servicio-de-impresora.test.ts` |
| T12 | Comparación antes/después sobre la grilla: pantalla y PDF idénticos byte a byte | CA-9, CA-10 | **Hecho.** 48 de 48 salidas idénticas; mismo sha256 `62e0382d…` |
| T13 | Falsificaciones del plan §6.5, una por vez, con sha256 | Todas | **Hecho.** Siete mutaciones, las siete atrapadas; el árbol de trabajo quedó con la misma huella antes y después |
| T14 | `npm run verify` completo | Todas | **Hecho.** 117 archivos, 2766 pruebas, 0 errores de lint |
| T15 | Arnés `verify:pantallas:copias` en la aplicación real, a 1024×768, con el texto completo de las dos copias en su salida | CA-1, CA-3, CA-4, CA-7, CA-9, CA-10, CA-14 | **Hecho.** 18 de 18 en macOS. Las dos copias salieron renglón por renglón como las predijo la spec §4.3 |
| T16 | Documentación: CLAUDE.md (§4.14, §4.60, §4.63 nueva, §5, §6.2, §7, §8, §9, §10), `docs/ANULACION-DE-VENTA.md`, `docs/GUIA-IMPRESORA.md`, `docs/INTEGRACIONES.md`, comentarios de `ipc.ts`, `ipc/recibos.ts` y `PantallaDeRecibos.tsx` | CA-17 | **Hecho.** Lo que dejó de ser cierto quedó tachado o anotado, no borrado |
| T17 | Commits atómicos en la rama de trabajo | — | Ver el historial de git |
| T18 | Decisión 1 (2026-09-18): la tabla gana `autorizacionDeLaAnulacion`; el cliente no dice quién autorizó la anulación, con todos sus renglones de continuación | CA-3, CA-5, CA-19 | **Hecho.** La grilla la exige renglón por renglón; una prueba con un nombre largo tiene su control. Falsificado: tabla del cliente en `true` → 38 caen; plantilla que ignora el campo → 37; omitir solo el primer renglón → 1 |
| T19 | Decisión 2 (2026-09-18): la copia de la tienda siempre | CA-20 | **Sin cambio de código**, ya era así. Documentado en spec §9 |
| T20 | Traer `develop` a la rama y verificar el estado unido (verify y el arnés de la app real) | Todas | Ver CLAUDE.md §4.65 |

## Pendiente fuera de esta spec

- **Windows y la 3nStar RPT004**: que corte bien entre las dos copias (CLAUDE.md
  §6.2, punto 9).
- ~~**Pregunta 1 de la spec**~~: decidida el 2026-09-18 (sí se oculta). T18.
- ~~**Pregunta 2 de la spec**~~: decidida el 2026-09-18 (siempre). T19.

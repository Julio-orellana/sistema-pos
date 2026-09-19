# 003 — Tareas

> Salen de [`plan.md`](plan.md). Cada tarea dice qué criterio de aceptación de
> [`spec.md`](spec.md) cubre. La columna «Estado» se llena al cerrarla, con su
> evidencia. La salida cruda completa va en CLAUDE.md §4.70.
>
> **Aprobado por Julio el 2026-09-19.** La decisión de §1 del plan (sí hace
> falta migración, y la de la nube no obliga a actualizar la tienda el mismo
> día) quedó aprobada, con el contador de anulaciones remotas agregado (T14).
> **Ninguna migración se aplica en ninguna nube dentro de esta spec, tampoco en
> el descartable.**

| # | Tarea | Cubre | Estado |
|---|---|---|---|
| T0 | Spec, plan y tareas, antes de tocar el código | — | **Hecho** el 2026-09-19: aprobados por Julio el mismo día, con el contador agregado (T14). Van en un commit propio, anterior al código |
| T1 | `ACEPTA_PIN_REMOTO.anulacion_de_venta = true`, con la razón anterior conservada en el comentario de la entrada y en la cabecera de `autenticacion.ts` (la fila de la tabla y una sección nueva) | CA-1, CA-14, CA-16 | — |
| T2 | Migración local `040_anulacion_autorizacion_remota.sql` y su registro en `migrator.ts`. Prueba nueva de la 040: `'remoto'` entra, la restricción desaparece, el CHECK de la columna y el `NOT NULL` siguen, y las filas viejas quedan iguales | CA-5, CA-10 | — |
| T3 | Espejo `0040_anulacion_autorizacion_remota.sql`, **escrito y SIN aplicar**, con la prueba del espejo exacto | CA-12 | — |
| T4 | `ModalDeAnulacion.tsx`: `largos={LARGOS_DE_AUTORIZACION}`, el texto del paso, el botón y el comentario de cabecera con la historia. Prueba del modal en jsdom | CA-9, CA-16 | — |
| T5 | Pruebas nuevas del servicio y del flujo: código correcto en efectivo y con tarjeta, código equivocado, bloqueo, código repetido, caja cerrada antes del código y el DTO con la vía | CA-1 a CA-4, CA-6 a CA-8 | — |
| T6 | Adaptar con constancia las pruebas que cambian: `autenticacion.test.ts:900/906`, `servicio-de-anulacion.test.ts:958`, `anulacion-solo-presencial.test.ts` (los `describe` de la 038 migran hasta la 038; el acoplamiento queda) y `productos-precio-mayorista.test.ts:108-110` | CA-3, CA-11, CA-14 | — |
| T7 | Falsificaciones F1 a F5 del plan §4.3, una por vez, con el sha256 antes y después y restaurando desde una copia | CA-17 | — |
| T8 | `npm run verify` completo | CA-17 | — |
| T9 | La 040 sobre una **copia** de la base de trabajo real, con el sha256 del original antes y después y la salida cruda | CA-5 | — |
| T10 | Ensayo de la 0040 en un Postgres 17 **local**: el md5 del contrato antes y después, las restricciones, y la terminal real subiendo en los casos (a) a (d) del plan §5.2, con la duración del `ALTER TABLE` | CA-12, CA-13 | — |
| T11 | Arnés `verify:pantallas:anulacion` a **1024×768** con CDP, con el camino remoto (inscripción, código equivocado, código bueno, fila y asiento en `'remoto'`) y el presencial intacto. Falsificado en la app con F3 y F4 | CA-9, CA-15 | — |
| T12 | Documentación: CLAUDE.md (§4.70 nueva; §4.9, §4.45, §4.54, §4.58, §5 y §6.2), `docs/ANULACION-DE-VENTA.md`, el README de migraciones y el roadmap. La 038 y la 0038 **no se editan** | CA-16 | — |
| T13 | Mostrarle a Julio el SQL de la 040 y la 0040. **Ninguna nube se toca en esta spec** | — | — |
| T14 | El contador de anulaciones remotas en el resumen de ventas (plan §3.4): el repositorio, el servicio, el DTO y la pantalla fuera de la condición «hay ventas», con sus pruebas | CA-18 | — |
| T-opt | *(Solo si Julio la pide, plan §3.5)* Una prueba estructural que ate el largo de cada teclado de autorización con `ACEPTA_PIN_REMOTO` | — | — |

## Pendiente fuera de esta spec (cada paso con su aprobación)

- **La 0040 en `pos-pruebas-descartable`**, con aprobación (plan §6, paso 5).
  Opcionalmente, una anulación remota subida de verdad (pregunta 4).
- **La 0040 en `pos-jimmy-cano`**, con otra aprobación, aparte (paso 8). **Tiene
  que ir ANTES de instalar la versión nueva en la tienda**, pero no hace falta que
  sea el mismo día (plan §1.3 y §1.4).
- **Publicar la versión que trae la 040**, e instalarla en la tienda después de la
  0040.
- **Que Jimmy inscriba su app en la terminal de la tienda**, si todavía no lo hizo
  (pregunta 3).
- **Mostrar «a distancia» en el historial de recibos y en la copia de la
  tienda**, si Julio lo aprueba (pregunta 2).
- **Windows.**

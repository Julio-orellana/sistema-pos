# 002 — Tareas

> Sale de [`plan.md`](plan.md). Cada tarea dice qué criterio de aceptación de
> [`spec.md`](spec.md) cubre. La columna «Estado» se llena al cerrarla, con su
> evidencia; la salida cruda completa va en CLAUDE.md §4.66.

| # | Tarea | Cubre | Estado |
|---|---|---|---|
| T0 | Spec, plan y tareas, antes de tocar el código | — | **Hecho** el 2026-09-18, en un commit propio anterior al código (`a6b7563`) |
| T1 | `src/shared/precio-de-linea.ts`: `precioDeLinea` y `calificaParaMayorista`, con sus pruebas (los tres escenarios, empates, seguridad, lb, kg y unidades) | CA-1 a CA-11 | **Hecho** (`2c4b5d7`). `precio-de-linea.test.ts`, 21 pruebas |
| T2 | `src/shared/precio-mayorista.ts`: `revisarPrecioMayorista` (R1 a R4, textos únicos), con sus pruebas | CA-17, CA-21 | **Hecho** (`2c4b5d7`). `precio-mayorista.test.ts`, 20 pruebas |
| T3 | Migración local 039 y su registro; pruebas de cada restricción, de los datos viejos, de la cola y de la bajada de lista rechazada | CA-17, CA-18, CA-22, CA-24 | **Hecho** (`fd622c4`). `productos-precio-mayorista.test.ts`, 19 pruebas. `checks-con-null.test.ts` pasa sin excepciones nuevas |
| T4 | Espejo 0039 (escrito, SIN aplicar), foto `esquema-nube.json`, `CLASES_DE_COLUMNA`, batería de la nube y README de migraciones; prueba de que las dos reglas de tabla se llaman igual en los dos lados | CA-19 | **Hecho** (`fd622c4`; el README, con T21). **La 0039 no está aplicada en ningún proyecto**: leído con `list_migrations` el 2026-09-18 |
| T5 | Ajustar `anulacion-solo-presencial.test.ts:165` a «hasta la 038», con constancia | — | **Hecho** (`fd622c4`) |
| T6 | `errores.ts`: las cuatro restricciones nuevas con mensaje de negocio | CA-17 | **Hecho**. Las dos de tabla en `fd622c4`; **las dos de columna faltaban** y se agregaron en `5ba6ab2`, cuando se notó que el comentario de la 039 prometía las cuatro. Falsificadas una por vez (M11, M12) |
| T7 | Entidad `Producto.mayorista`, repositorio (leer, crear, actualizar) | CA-14 | **Hecho** (`3225bba`) |
| T8 | Servicio de productos: validación compartida, conservar al editar sin campos, R3 contra la lista nueva, asientos | CA-21, CA-24 | **Hecho** (`3225bba`) |
| T9 | IPC: payloads, `ProductoIpc`, `ProductoParaVender`, `VentaRegistrada` | CA-13, CA-20 | **Hecho** (`b307a9b`, `91d52dd`) |
| T10 | `ServicioDeVenta`: el selector en `resolverLinea`, el origen en el asiento, `lineasConPrecioMayorista` | CA-1 a CA-6, CA-10, CA-11, CA-14, CA-15, CA-23 | **Hecho** (`91d52dd`). `precio-mayorista-en-la-venta.test.ts`, 14 pruebas |
| T11 | `ticket.ts`: recálculo en `agregarAlTicket` y `fijarCantidad`; descripción del mayorista | CA-12 | **Hecho** (`91d52dd`) |
| T12 | `TicketDeVenta.tsx`: la marca según el origen, y su estilo | V3 | **Hecho** (`91d52dd`) |
| T13 | Formulario: casilla, campos, limpieza, validación en vivo | CA-20, CA-24 | **Hecho** (`b307a9b`) |
| T14 | Prueba pantalla contra servicio (grilla) | CA-13 | **Hecho** (`91d52dd`): 27 de 27, la tabla completa en CLAUDE.md §4.66 |
| T15 | Prueba del margen del reporte | CA-16 | **Hecho** (`91d52dd`): Q75.00, y Q95.00 en el caso mixto |
| T16 | La 039 sobre una copia de la base de trabajo real (sha256 del original antes y después) | CA-18 | **Hecho**, salida cruda en CLAUDE.md §4.66 |
| T17 | Ensayo de la 0039 en un Postgres 17 local | CA-19 | **Hecho**, y además la terminal real subiendo a ese Postgres con y sin la 0039 (§4.66) |
| T18 | Falsificaciones M1 a M10 del plan §7.3, una por vez, con sha256 | Todas | **Hecho**: M1 a M10 más M6b, M11 y M12; M4 y M4b también en la aplicación real |
| T19 | `npm run verify` completo | Todas | **Hecho** (ver CLAUDE.md §4.66 para la última corrida) |
| T20 | Arnés `verify:pantallas:mayorista` a 1024×768, con su falsificación | CA-12, CA-20, CA-24, CA-25 | **Hecho** (`3d3b31b`): 28 de 28 en macOS; falsificado en la app |
| T21 | Documentación: CLAUDE.md, constitución, README de migraciones | — | **Hecho** |
| T22 | Mostrarle a Julio el SQL de la 039 y la 0039. **Ninguna nube se toca sin su aprobación, proyecto por proyecto** | — | **Mostrado en el informe de cierre.** Ninguna nube se tocó: solo lecturas del catálogo |

| T23 | Las tres decisiones de Julio (2026-09-18): A se queda; Q0.00 no se permite (039, 0039, regla compartida, formulario, servicio); cambiar la unidad quita el mayorista en la misma edición, con su motivo en el asiento; el mensaje de la lista bajada | — | **Hecho** (`84c3a69`, `d367f88`, `5a7a8de`), con falsificaciones N1 a N8 y en la app real. CLAUDE.md §4.66 |
| T24 | Aplicar la 0039 en `pos-pruebas-descartable` | CA-19 | **Hecho** el 2026-09-18, versión `20260918190337`, md5 del registro igual al del archivo; mitad B sin diferencias |

## Pendiente fuera de esta spec

- ~~**La decisión 1** (spec §4.3): A o B, antes de aplicar la 0039.~~ **A**,
  confirmada por Julio el 2026-09-18.
- ~~Aplicar la 0039 en `pos-pruebas-descartable`, con aprobación~~ **hecho el
  2026-09-18**; en `pos-jimmy-cano`, solo con un pedido aparte. **Tiene que ir
  junto con la instalación de la versión que trae la 039**: una terminal con la
  039 contra una nube sin la 0039 detiene su cola (medido, CLAUDE.md §4.66).
- **Windows.**

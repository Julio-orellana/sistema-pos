# 002 — Tareas

> Sale de [`plan.md`](plan.md). Cada tarea dice qué criterio de aceptación de
> [`spec.md`](spec.md) cubre. La columna «Estado» se llena al cerrarla, con su
> evidencia; la salida cruda completa va en CLAUDE.md §4.66.

| # | Tarea | Cubre | Estado |
|---|---|---|---|
| T0 | Spec, plan y tareas, antes de tocar el código | — | **Hecho** el 2026-09-18, en un commit propio anterior al código |
| T1 | `src/shared/precio-de-linea.ts`: `precioDeLinea` y `calificaParaMayorista`, con sus pruebas (los tres escenarios, empates, seguridad, lb, kg y unidades) | CA-1 a CA-11 | Pendiente |
| T2 | `src/shared/precio-mayorista.ts`: `revisarPrecioMayorista` (R1 a R4, textos únicos), con sus pruebas | CA-17, CA-21 | Pendiente |
| T3 | Migración local 039 y su registro; pruebas de cada restricción, de los datos viejos, de la cola y de la bajada de lista rechazada | CA-17, CA-18, CA-22, CA-24 | Pendiente |
| T4 | Espejo 0039 (escrito, SIN aplicar), foto `esquema-nube.json`, `CLASES_DE_COLUMNA`, batería de la nube y README de migraciones; prueba de que las dos reglas de tabla se llaman igual en los dos lados | CA-19 | Pendiente |
| T5 | Ajustar `anulacion-solo-presencial.test.ts:165` a «hasta la 038», con constancia | — | Pendiente |
| T6 | `errores.ts`: las cuatro restricciones nuevas con mensaje de negocio | CA-17 | Pendiente |
| T7 | Entidad `Producto.mayorista`, repositorio (leer, crear, actualizar) | CA-14 | Pendiente |
| T8 | Servicio de productos: validación compartida, conservar al editar sin campos, R3 contra la lista nueva, asientos | CA-21, CA-24 | Pendiente |
| T9 | IPC: payloads, `ProductoIpc`, `ProductoParaVender`, `VentaRegistrada` | CA-13, CA-20 | Pendiente |
| T10 | `ServicioDeVenta`: el selector en `resolverLinea`, el origen en el asiento, `lineasConPrecioMayorista` | CA-1 a CA-6, CA-10, CA-11, CA-14, CA-15, CA-23 | Pendiente |
| T11 | `ticket.ts`: recálculo en `agregarAlTicket` y `fijarCantidad`; descripción del mayorista | CA-12 | Pendiente |
| T12 | `TicketDeVenta.tsx`: la marca según el origen, y su estilo | V3 | Pendiente |
| T13 | Formulario: casilla, campos, limpieza, validación en vivo | CA-20, CA-24 | Pendiente |
| T14 | Prueba pantalla contra servicio (grilla) | CA-13 | Pendiente |
| T15 | Prueba del margen del reporte | CA-16 | Pendiente |
| T16 | La 039 sobre una copia de la base de trabajo real (sha256 del original antes y después) | CA-18 | Pendiente |
| T17 | Ensayo de la 0039 en un Postgres 17 local | CA-19 | Pendiente |
| T18 | Falsificaciones M1 a M10 del plan §7.3, una por vez, con sha256 | Todas | Pendiente |
| T19 | `npm run verify` completo | Todas | Pendiente |
| T20 | Arnés `verify:pantallas:mayorista` a 1024×768, con su falsificación | CA-12, CA-20, CA-24, CA-25 | Pendiente |
| T21 | Documentación: CLAUDE.md, constitución, README de migraciones | — | Pendiente |
| T22 | Mostrarle a Julio el SQL de la 039 y la 0039. **Ninguna nube se toca sin su aprobación, proyecto por proyecto** | — | Pendiente |

## Pendiente fuera de esta spec

- **La decisión 1** (spec §4.3): A o B, antes de aplicar la 0039.
- **Aplicar la 0039** en `pos-pruebas-descartable`, con aprobación; en
  `pos-jimmy-cano`, solo con un pedido aparte.
- **Windows.**

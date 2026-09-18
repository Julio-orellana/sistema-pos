# Integraciones opcionales

Las dos integraciones externas del sistema —**impresora térmica** y
**sincronización con Supabase**— están detrás de una interfaz, con una
implementación **segura por defecto** y una implementación real que se activa
por **configuración**.

Principio que rige este documento:

> El dominio nunca importa el SDK de Supabase ni una librería de impresión.
> Habla únicamente con `ReceiptPrinterProvider` y `SyncProvider`. Activar lo
> real es un cambio de configuración, **no** un cambio al código de negocio.

Hay una regla de ESLint que hace fallar el lint si alguien importa
`@supabase/supabase-js` o `better-sqlite3` desde `src/shared` o `src/renderer`.

---

## 1. `ReceiptPrinterProvider` — impresión de comprobantes

**Archivo:** `src/shared/adapters/receipt-printer.ts`

### Contrato

```ts
interface ReceiptPrinterProvider {
  readonly nombre: string;
  imprimirComprobante(comprobante: ComprobanteImprimible): Promise<ResultadoImpresion>;
  consultarEstado(): Promise<EstadoImpresora>;
}
```

`ComprobanteImprimible` exige siempre `rutaPdf`: **sin PDF no se imprime**,
porque el PDF es el respaldo obligatorio de la operación.

`ComprobanteImprimible.copiasEnTexto` trae el texto de **cada copia física**,
en el orden en que salen. Todas viajan en **un solo trabajo** de impresión,
cada una con su propio corte de papel. Desde el 2026-09-18
(`spec/features/001-recibo-copia-tienda-cliente`) el recibo manda dos: la del
cliente y la de la tienda. Reemplaza a `contenidoTexto` y `copias: number`, que
solo sabían pedir N copias del mismo texto.

### Implementación por defecto: `NullPrinterProvider`

No imprime nada y responde:

```ts
{ ok: true, adaptador: 'NullPrinterProvider', omitidaPorDiseno: true, mensaje: '...' }
```

Esto **no es un stub incompleto**: es el comportamiento correcto mientras no
haya impresora. Devuelve `ok: true` con `omitidaPorDiseno: true` para que en la
auditoría quede claro que la ausencia de impresión fue una decisión de diseño y
no una falla. La venta se cierra igual, respaldada por su PDF.

`consultarEstado()` reporta `disponible: false`, para que la interfaz pueda
avisarle al cajero antes de cobrar.

### Implementación real (pendiente): `EscPosPrinterProvider`

- **Cuándo:** cuando Jimmy defina el modelo de impresora térmica
  (punto 9 de "Pendiente de confirmación" en `CLAUDE.md`).
- **Cómo se activa:** `POS_PRINTER_PROVIDER=escpos` en `.env`.
- **Qué NO cambia al activarla:** ni una línea del módulo de ventas ni del de
  comprobantes. El PDF se sigue generando siempre.
- **Requisito de diseño:** no debe lanzar excepciones. Un fallo de impresión se
  reporta como `{ ok: false }` con su mensaje; nunca puede tumbar una venta.

## 2. `SyncProvider` — sincronización con la nube

**Archivo:** `src/shared/adapters/sync-provider.ts`

### Contrato

```ts
interface SyncProvider {
  readonly nombre: string;
  empujarCambios(cambios: readonly CambioSincronizable[]): Promise<ResultadoEmpuje>;
  consultarEstado(): Promise<EstadoSincronizacion>;
}
```

`actualizadoEn` es una cadena ISO-8601 en UTC. Se usa cadena y no `Date` porque
el dato viaja por IPC y se guarda en SQLite, y una cadena ISO sobrevive ambos
viajes sin ambigüedad de zona horaria.

**Una llamada a `empujarCambios` es UN LOTE**, no una lista suelta de cambios:
las filas van en el orden en que hay que subirlas, padres antes que hijos, y ese
orden no es una sugerencia. Subir `venta_detalle` antes que `ventas` lo rechaza
la llave foránea de Postgres.

`ResultadoEmpuje` lleva además `estadoHttp` cuando hubo respuesta. **Es lo que
decide si un fallo se reintenta o detiene la cola**, y por eso viaja en el
contrato en vez de quedar enterrado en un texto de error: la clasificación de
`docs/SINCRONIZACION.md` §3.2 es por código, y no se puede adivinar leyendo un
mensaje.

### `traerCambios(desde)` YA NO EXISTE — decisión 10

La interfaz lo tuvo desde el Prompt 1 y **nunca lo llamó nadie**. Se retiró en
la Fase 1.b porque el diseño decidió que la sincronización continua es **solo
de subida** (`docs/SINCRONIZACION.md` §2.2): bajar cambios contra una base que
la terminal también escribe sería tener dos escritores, y resolver esos
conflictos es un problema que este sistema no necesita tener. Un método que
existe invita a usarse, y el día que alguien lo llamara estaría reintroduciendo
la bajada que el diseño descartó sin que nada fallara.

**La restauración desde la nube no se pierde por esto**: es otra operación —no
incremental, no en segundo plano, a pedido de un administrador y con
precondiciones propias— y va a tener su propia interfaz en la fase 4.b.

### Implementación por defecto: `SimulatedSyncProvider`

Registra en memoria los cambios que se le entregan y **no hace ninguna llamada
de red**. Todos sus resultados llevan `simulado: true`.

Esto responde a una decisión del proyecto: **Supabase está en plan gratuito
durante todo el desarrollo**, y el upgrade ocurre solo al final, antes de la
entrega. Con el adaptador simulado se puede desarrollar y probar la cola de
sincronización, los reintentos y el manejo de conflictos sin consumir cuota y
sin depender de que Supabase esté disponible.

Expone además dos métodos pensados para pruebas y diagnóstico:

- `obtenerCambiosEmpujados()` — permite verificar **qué** se habría enviado a
  Supabase, sin haberlo enviado. Esa es la diferencia entre un adaptador
  simulado útil y un stub vacío.
- `limpiar()` — vacía la bitácora entre casos de prueba.

### Quién lo usa: el trabajador de sincronización

Desde la Fase 1.b hay un **trabajador en el proceso principal**
(`src/main/sincronizacion/`) que lee `sync_cola`, arma los lotes y llama a
`empujarCambios`. Corre contra el adaptador simulado y ya aplica de verdad el
orden de los lotes, el backoff de §3.2, la detención de la cola ante un error
determinístico y el ceder ante una venta en curso. Ver CLAUDE.md §4.18.

### Implementación real (pendiente): `SupabaseSyncProvider`

- **Cuándo:** en la fase que agregue la red, las credenciales y las políticas
  de RLS. El trabajador ya está y no cambia: lo único que cambia es qué
  devuelve `crearSyncProvider`.
- **Cómo se activa:** `POS_SYNC_PROVIDER=supabase` más `SUPABASE_URL` y
  `SUPABASE_ANON_KEY` en `.env`.
- **Regla de uso durante el desarrollo:** la sincronización real se prueba de
  forma **deliberada y puntual**, en una sesión dedicada, nunca en cada ciclo
  de desarrollo.
- **Dónde vive:** en `src/main/`. El SDK de Supabase **nunca** entra a
  `src/shared` ni a `src/renderer`.

## 3. Fábrica y configuración

**Archivo:** `src/shared/adapters/index.ts`

Es el **único** lugar donde se decide qué implementación concreta se usa:

```ts
const configuracion = leerConfiguracionAdaptadoresDelEntorno(process.env);
const impresora     = crearReceiptPrinterProvider(configuracion);
const sincronizador = crearSyncProvider(configuracion);
```

### Variables de entorno

| Variable | Valores | Por defecto | Efecto |
|---|---|---|---|
| `POS_PRINTER_PROVIDER` | `nulo` \| `escpos` | `nulo` | Solo PDF, sin impresión física. |
| `POS_SYNC_PROVIDER` | `simulado` \| `supabase` | `simulado` | Sin red, sin consumo de cuota. |
| `SUPABASE_URL` | URL del proyecto | vacío | Solo se usa con `POS_SYNC_PROVIDER=supabase`. |
| `SUPABASE_ANON_KEY` | llave anónima | vacío | Nunca se sube al repositorio (`.env` está en `.gitignore`). |

### Comportamiento ante configuración inválida

- Un valor desconocido (`POS_SYNC_PROVIDER=firebase`) cae al adaptador seguro.
  **Nunca** se habilita algo por accidente.
- Pedir un adaptador aún no implementado (`escpos`, `supabase`) registra una
  advertencia y cae al seguro, en vez de reventar: quedarse sin poder cobrar
  por una impresora mal configurada sería peor que cobrar sin imprimir.

Esto está cubierto por pruebas en `src/shared/__tests__/adapters.test.ts`.

## 4. Cómo agregar una integración nueva

Si mañana aparece una tercera integración (por ejemplo, una báscula digital o
una pasarela de pago), el procedimiento es el mismo:

1. Declarar la interfaz en `src/shared/adapters/`, con tipos de dominio en
   español y sin importar el SDK del proveedor.
2. Escribir la implementación segura por defecto (la que permite trabajar sin el
   dispositivo o servicio) y probarla.
3. Agregar la variable de entorno y la rama correspondiente en la fábrica, con
   caída al adaptador seguro ante cualquier valor desconocido.
4. Escribir la implementación real en `src/main/`, nunca en `src/shared`.
5. Documentarla en este archivo y agregar la fila correspondiente a la tabla de
   decisiones de `CLAUDE.md`.

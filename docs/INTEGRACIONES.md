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

> **CORREGIDO EL 2026-09-18:** hoy ninguna pantalla llama a
> `consultarEstado()` del proveedor de impresión. Leído en el código: fuera de
> las pruebas, solo aparece donde se define. El estado que se ve en el
> diagnóstico técnico y en «Impresora de recibos» sale de
> `ServicioDeImpresora.estado()`, que lee `impresora.json` directamente. El
> aviso «antes de cobrar» no existe.

Desde el 2026-09-15 (CLAUDE.md §4.43), `NullPrinterProvider` ya no es lo que
la aplicación construye: es lo que usa `ImpresoraSegunElArchivo` cuando la
terminal no tiene impresora configurada. Ver abajo.

### Qué construye la aplicación: `ImpresoraSegunElArchivo`

**Archivo:** `src/main/adapters/impresora-configurada.ts`. Se construye en
`src/main/index.ts`, alrededor de la línea 607, y se le pasa a
`ServicioDeRecibos`.

**Vuelve a leer `<userData>/impresora.json` en CADA impresión.** Así, guardar
o quitar la impresora desde la pantalla vale para el próximo recibo sin
reiniciar. Según lo que diga el archivo, delega en uno de tres proveedores:

| Qué dice `impresora.json` | Proveedor | Qué hace |
|---|---|---|
| No existe, está vacío o no se puede leer | `NullPrinterProvider` | No imprime. El recibo queda solo en PDF. **No es un error**: es el estado normal de una terminal sin impresora |
| `{ "impresora": "<nombre>" }` | `ImpresoraPorColaDeWindows` | Imprime por la cola de Windows en RAW. Es el formato **actual** |
| `{ "dispositivo": "<ruta>" }` | `EscPosPrinterProvider` (`src/main/adapters/escpos-printer.ts`) | Escribe los bytes en esa ruta con `node:fs`. Se lee **solo por compatibilidad** con archivos anteriores al 2026-09-15 |

Un archivo roto se anota en `log-tecnico.log` y se trata como «sin impresora»:
el punto de venta arranca igual. Si el archivo trae los dos campos, gana
`impresora`.

`impresora.json` es configuración de ESTA terminal y no dato del negocio. Por
eso no vive en `configuracion_negocio`, que se espeja en la nube (CLAUDE.md
§4.14).

### Cómo se configura: la pantalla «Impresora de recibos»

Solo para el rol administrativo. Lista las impresoras que Windows ya tiene
instaladas (`webContents.getPrintersAsync()`), guarda la elegida, manda un
ticket de prueba y la quita. Después de un ticket de prueba que Windows
aceptó, la persona contesta cómo salió. «Salió con símbolos raros o sin
cortar» queda guardado como señal de que el modelo podría no entender los
comandos ESC/POS. Una térmica no contesta, así que ningún software puede
saberlo por su cuenta. Detalle en CLAUDE.md §4.43.

Guardar exige que el nombre esté en la lista del sistema en ese momento. La
pantalla ya no ofrece el formato viejo con `dispositivo`.

La instalación de la impresora en Windows (controlador oficial o
«Generic / Text Only») está en `docs/GUIA-IMPRESORA.md`.

### Cómo imprime: la cola de Windows en RAW, con PowerShell

**Archivo:** `src/main/adapters/cola-de-windows.ts` (`EnviadorPorPowerShell`).

- Los bytes ESC/POS salen de `reciboComoEscPos`
  (`src/main/domain/recibo/escpos.ts`). Se mandan por el spooler con
  `OpenPrinter → StartDocPrinter("RAW") → StartPagePrinter → WritePrinter`,
  declaradas con `Add-Type` sobre `winspool.drv`. Con el tipo de dato RAW, el
  controlador no toca los bytes.
- PowerShell recibe un script **constante** con `-EncodedCommand`. El nombre de
  la impresora y los bytes viajan solo en las variables de entorno
  `POS_IMPRESION_NOMBRE` y `POS_IMPRESION_DATOS`, y el script los lee con
  `$env:`. Ningún dato se arma como código, y no hay `Invoke-Expression`.
- Límite de 12 s por envío (`LIMITE_DE_POWERSHELL_MS`).
- Cada envío se clasifica en `no_encontrada`, `no_se_pudo_enviar`,
  `trabajo_con_error`, `entorno` o `enviado`.
- **Lo que la documentación de Microsoft dice sobre `-EncodedCommand`, la
  política `Restricted` y el modo `ConstrainedLanguage` NO se midió en
  Windows** (CLAUDE.md §4.43).

Fuera del instalador, `POS_IMPRESORAS_SIMULADAS=<carpeta>` reemplaza el
enviador por uno simulado, que escribe los bytes en archivos. Con la aplicación
empaquetada esa variable se ignora (`app.isPackaged`).

**Requisito de diseño, sin cambios:** ningún proveedor lanza excepciones. Un
fallo de impresión se reporta como `{ ok: false }` y queda en
`log-tecnico.log`. Nunca tumba una venta: el PDF se genera siempre.

### El modelo de la tienda: 3nStar RPT004

**Confirmado el 2026-09-17** (CLAUDE.md §4.43 y punto 9 de §6.2). Según su
ficha técnica, que aportó Julio, la Font A de 12×24 puntos da **48 caracteres
por línea**. Es el mismo valor de `COLUMNAS_80MM` en
`src/main/domain/recibo/plantilla-de-recibo.ts`.

**Pendiente, y solo se puede hacer con el RPT004 en la mano:** la prueba de
impresión física en Windows (acentos, eñe, corte) y un recibo real reimpreso
desde el historial para ver las 48 columnas. Hasta entonces, nada de esta
sección está probado contra el hardware.

### ~~Implementación real (pendiente): `EscPosPrinterProvider`~~ — SUPERADA

> **CORREGIDO EL 2026-09-18.** Esta subsección decía:
>
> - ~~**Cuándo:** cuando Jimmy defina el modelo de impresora térmica (punto 9
>   de "Pendiente de confirmación" en `CLAUDE.md`).~~
> - ~~**Cómo se activa:** `POS_PRINTER_PROVIDER=escpos` en `.env`.~~
> - **Qué NO cambia al activarla:** ni una línea del módulo de ventas ni del de
>   comprobantes. El PDF se sigue generando siempre. *(Sigue siendo cierto.)*
> - **Requisito de diseño:** no debe lanzar excepciones. *(Sigue siendo
>   cierto; ver arriba.)*
>
> **Qué era `POS_PRINTER_PROVIDER`.** Desde el Prompt 1, la impresora real
> se iba a elegir como la sincronización: una variable de entorno leída por la
> fábrica `crearReceiptPrinterProvider` (`src/shared/adapters/index.ts`). El
> valor `escpos` iba a construir el adaptador real cuando se conociera el
> modelo. **Nunca llegó a construirlo**: esa rama devuelve `NullPrinterProvider`
> con una advertencia.
>
> **Por qué dejó de ser el camino real.** El Prompt 23 (§4.14) decidió que la
> impresora de una terminal se configura en un archivo local, porque es estado
> de esa máquina y no del negocio. El proceso principal pasó a construir el
> proveedor según `impresora.json` y no según el entorno. Desde el 2026-09-15
> (§4.43), ese proveedor es `ImpresoraSegunElArchivo`. Una variable de entorno
> tampoco serviría en un `.exe` instalado: nadie la define en el mostrador
> (§4.38).
>
> **Hoy `POS_PRINTER_PROVIDER` NO TIENE NINGÚN EFECTO.** Se lee y no la usa
> nadie. Verificado en el código el 2026-09-18:
>
> 1. `leerConfiguracionAdaptadoresDelEntorno` la lee y la guarda en
>    `configuracion.impresion` (`src/shared/adapters/index.ts:111`).
> 2. El único que lee `configuracion.impresion` es `crearReceiptPrinterProvider`
>    (`index.ts:49`), y a esa fábrica solo la llaman las pruebas
>    (`src/shared/__tests__/adapters.test.ts`).
> 3. Los dos lugares del proceso principal que leen esa configuración —
>    `src/main/index.ts` (`crearSyncProvider`, para la sincronización) y el
>    diagnóstico de `src/main/ipc/register-handlers.ts`— se la pasan solo a
>    `crearSyncProvider`, que mira `sincronizacion` y nada más.
> 4. Aunque alguien llamara a la fábrica, las dos ramas devuelven
>    `NullPrinterProvider`.
>
> Ponerla en `escpos` no imprime nada, y ponerla en `nulo` no apaga una
> impresora configurada en `impresora.json`. **PENDIENTE para Julio:** decidir
> si se quitan la variable, `crearReceiptPrinterProvider`, el campo
> `impresion` y su entrada en `.env.example`. No se quitaron sin preguntar. Las
> secciones 3 de este documento y `docs/ARCHITECTURE.md` (línea 99) todavía la
> describen como si funcionara.

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

# Arquitectura

Documento de referencia de cómo está organizado el sistema y por qué. Si algo
en el código contradice este documento, uno de los dos está mal: resolverlo
antes de seguir construyendo encima.

---

## 1. Arquitectura en capas

El sistema tiene cinco capas. **Cada capa solo puede hablar con la de abajo.**
Saltarse una capa es el error que este diseño existe para prevenir.

```
┌───────────────────────────────────────────────────────────────┐
│ 1. UI React            src/renderer                           │
│    Pantallas de caja, inventario, reportes.                   │
│    No sabe qué es SQLite. No sabe qué es Supabase.            │
└──────────────────────────────┬────────────────────────────────┘
                               │  window.pos.*  (preload)
┌──────────────────────────────▼────────────────────────────────┐
│ 2. Frontera IPC        src/main/preload + src/main/ipc        │
│    Canales tipados. Valida TODO payload con Zod.              │
│    Único punto por donde entran y salen datos del renderer.   │
└──────────────────────────────┬────────────────────────────────┘
┌──────────────────────────────▼────────────────────────────────┐
│ 3. Servicios de aplicación   src/main/services  (aún no existe)│
│    Orquesta casos de uso: "registrar venta", "cerrar caja".   │
│    Abre transacciones, emite eventos, no contiene reglas.     │
└──────────────────────────────┬────────────────────────────────┘
┌──────────────────────────────▼────────────────────────────────┐
│ 4. Módulos de dominio        src/main/domain   (aún no existe)│
│    Las reglas del negocio. Sin SQL, sin Electron, sin red.    │
│    Se prueban con Vitest sin abrir la aplicación.             │
└──────────────────────────────┬────────────────────────────────┘
┌──────────────────────────────▼────────────────────────────────┐
│ 5. Infraestructura     SQLite (local)  ·  Supabase (nube)     │
│    Repositorios y adaptadores. Detalles reemplazables.        │
└───────────────────────────────────────────────────────────────┘
```

`src/shared` es transversal: lo usan las capas 1 a 4. Contiene el contrato IPC,
las interfaces de los adaptadores y `money.ts`. **No puede depender de Electron,
de better-sqlite3 ni del SDK de Supabase** — hay una regla de ESLint que lo
impide, porque ese código también se empaqueta dentro del renderer.

### Reglas de dependencia (verificadas por ESLint)

| Desde | Puede importar | Nunca puede importar |
|---|---|---|
| `src/renderer` | `src/shared` | `electron`, `better-sqlite3`, `node:*`, `@supabase/supabase-js`, `src/main` |
| `src/shared` | Decimal.js, Zod | `electron`, `better-sqlite3`, `@supabase/supabase-js` |
| `src/main` | todo | — |

## 2. Módulos de dominio

Ninguno está implementado todavía. Esta es la lista acordada y su
responsabilidad, una línea cada uno:

| Módulo | Responsabilidad |
|---|---|
| **caja** | Abre y cierra el turno, registra el fondo inicial, cuenta el efectivo esperado contra el contado y produce el corte. |
| **usuarios** | Identidad, roles (venta / administrativo), PIN de autorización y sesión activa en la caja. |
| **inventario** | Saldo acumulado por producto: ingresos de mercadería que lo suben, ventas que lo bajan, ajustes por merma. Sin lotes. |
| **ventas** | Arma la venta, calcula líneas y totales, cobra, genera el comprobante y descuenta inventario en una sola transacción. |
| **descuentos** | Límites por rol (porcentaje y monto fijo), evaluación de si un descuento excede el límite y flujo de autorización por PIN. |
| **comprobantes** | Genera el PDF de recibo, proforma y corte de caja, los numera y los archiva; entrega al adaptador de impresión. |
| **sincronización** | Encola los cambios locales, los empuja a la nube, trae los remotos y resuelve conflictos. |
| **auditoría** | Registro inmutable de hechos sensibles: autorizaciones de descuento, anulaciones, ingresos y ajustes de inventario, cortes de caja, cambios de configuración. |

## 3. Patrones de diseño y dónde se aplica cada uno

### 3.1 Repository — acceso a datos

Todo acceso a SQLite pasa por un repositorio. El dominio pide
`RepositorioDeProductos.obtenerPorId(idProducto)` y no sabe si detrás hay SQL,
un archivo o una prueba en memoria.

- **Dónde:** `src/main/database/repositories/` (se crea con el esquema real).
- **Ejemplo concreto:** al registrar una venta de maíz, el módulo de ventas le
  pide al `RepositorioDeProductos` el saldo del producto y le entrega el peso a
  descontar. El módulo de ventas nunca escribe un `UPDATE`.
- **Por qué:** permite probar la regla "no se puede vender más de lo que hay en
  inventario" con un repositorio falso en memoria, sin base de datos y en
  milisegundos.

### 3.2 Adapter / Strategy — impresora y sincronización

Dos integraciones externas están detrás de una interfaz, con una
implementación segura por defecto y otra real que se activa por configuración.

- **Dónde:** `src/shared/adapters/receipt-printer.ts` y
  `src/shared/adapters/sync-provider.ts`; la fábrica en
  `src/shared/adapters/index.ts`.
- **Ejemplo concreto (impresión):** el módulo de comprobantes siempre genera el
  PDF y luego llama a `ReceiptPrinterProvider.imprimirComprobante(...)`. Hoy eso
  llega a `NullPrinterProvider`, que no imprime y responde
  `omitidaPorDiseno: true`. Cuando Jimmy compre la impresora se escribe
  `EscPosPrinterProvider` y se cambia `POS_PRINTER_PROVIDER=escpos`. **Ni una
  línea del módulo de ventas cambia.**
- **Ejemplo concreto (nube):** durante todo el desarrollo `SyncProvider` es
  `SimulatedSyncProvider`, que registra en memoria lo que se habría enviado sin
  tocar la red. Así se prueba la cola de sincronización sin consumir la cuota
  gratuita de Supabase.
- **Detalle completo:** ver [INTEGRACIONES.md](./INTEGRACIONES.md).

### 3.3 DTO + validación — payloads de IPC

Cada canal IPC tiene un DTO declarado y un esquema Zod. El proceso principal
valida **antes** de tocar la base de datos.

- **Dónde:** `src/shared/types/ipc.ts` (contrato y esquemas),
  `src/main/ipc/register-handlers.ts` (validación y ejecución).
- **Ejemplo concreto:** `esquemaSolicitudDiagnostico` valida el payload del
  canal `diagnostico:base-de-datos`. Si llega un campo de tipo incorrecto, el
  manejador responde `{ ok: false, error: { codigo: 'PAYLOAD_INVALIDO', ... } }`
  en vez de lanzar una excepción que dejaría la pantalla congelada.
- **Por qué Zod y no solo tipos de TypeScript:** los tipos desaparecen al
  compilar. En tiempo de ejecución no validan nada. El renderer se trata como
  entrada no confiable por principio, aunque hoy lo escribamos nosotros.
- **Forma de respuesta:** toda respuesta viaja en el sobre `RespuestaIpc<T>`,
  que es `{ ok: true, datos }` o `{ ok: false, error }`. Nunca se lanzan
  excepciones a través del puente.

### 3.4 Observer / eventos internos

El proceso principal publica eventos de dominio; los interesados se suscriben.
Evita que el módulo de ventas tenga que conocer a todos los que reaccionan a
una venta.

- **Dónde:** `src/main/events/` (se crea con el módulo de ventas).
- **Ejemplo concreto:** al cerrar una venta se emite `VentaRegistrada`. Tres
  suscriptores independientes reaccionan:
  1. **inventario** descuenta la cantidad vendida del saldo del producto,
  2. **sincronización** encola el cambio para subirlo a la nube,
  3. **auditoría** escribe el asiento correspondiente.
- **Por qué:** agregar mañana un cuarto suscriptor (por ejemplo, actualizar un
  panel de ventas del día) no obliga a modificar el módulo de ventas.
- **Regla:** los eventos se emiten **después** de que la transacción de SQLite
  hizo commit. Un suscriptor no puede provocar que la venta se revierta.

### 3.5 RBAC — control de acceso por rol

Dos roles confirmados: **venta** y **administrativo**. El permiso se verifica en
el **proceso principal**, nunca solo en la interfaz.

- **Dónde:** `src/main/domain/usuarios/` y una comprobación en la frontera IPC.
- **Ejemplo concreto:** un usuario de rol *venta* intenta aplicar 25% de
  descuento cuando su límite es 10%. El módulo de descuentos lo rechaza. La
  interfaz ofrece entonces "solicitar autorización"; un administrador ingresa su
  PIN, el proceso principal lo valida, autoriza **esa venta puntual** y escribe
  en auditoría quién autorizó, cuánto y cuándo. El límite configurado **no
  cambia**.
- **Por qué en el proceso principal:** ocultar un botón en React no es un
  control de acceso. Un renderer comprometido o un error de estado dejarían
  pasar la operación.

## 4. Flujo completo de una venta (referencia futura)

Todavía no está implementado; queda escrito para que el diseño no se
reinterprete en cada sesión.

```
Cajero pesa 12.5 lb de maíz
  → UI React arma la línea y llama window.pos.ventas.registrar(dto)
  → preload reenvía por el canal "ventas:registrar"
  → main valida el DTO con Zod
  → servicio de aplicación abre una transacción SQLite
      → dominio.ventas calcula subtotal y total con money.ts (Decimal.js)
      → dominio.descuentos verifica el límite del rol; si excede, exige PIN
      → dominio.inventario descuenta la cantidad del saldo del producto
      → repositorios persisten venta, líneas y el contador de ventas
  → commit
  → se emite VentaRegistrada
      → comprobantes genera el PDF  (SIEMPRE)
      → ReceiptPrinterProvider intenta imprimir  (OPCIONAL)
      → sincronización encola el cambio
      → auditoría registra el hecho
  → main responde RespuestaIpc<VentaRegistrada>
  → la UI muestra el vuelto y el comprobante
```

## 5. Decisiones de infraestructura

- **Base de datos local:** un archivo SQLite en la carpeta `userData` del
  sistema operativo, con `journal_mode = WAL`, `synchronous = FULL` y
  `foreign_keys = ON`. Vive fuera de la carpeta de la aplicación para sobrevivir
  a actualizaciones y reinstalaciones.
- **Instancia única:** dos copias del POS sobre la misma base serían una fuente
  segura de descuadres en el corte de caja.
- **Aislamiento del renderer:** `contextIsolation: true`, `nodeIntegration:
  false`, política de seguridad de contenido que prohíbe scripts remotos y
  conexiones salientes desde la ventana, y bloqueo de navegación fuera de la
  aplicación.
- **Modo kiosko:** pantalla completa, sin marco, sin menú de aplicación, sin
  zoom (bloqueado en el proceso principal **y** en el DOM desde el preload) y
  sin menú de clic derecho. Las reglas de qué se bloquea viven como funciones
  puras en `src/shared/kiosk-input.ts`, separadas de la parte mecánica, para
  poder probarlas con Vitest en vez de revisarlas a ojo.
- **Salida controlada:** el atajo del administrador más su PIN son la única
  forma ordenada de cerrar. El PIN se verifica en el proceso principal
  (`src/main/security/admin-pin.ts`) y el flujo lo coordina
  `src/main/windows/controlled-exit.ts`. Ver la sección 4.1 de `CLAUDE.md`.

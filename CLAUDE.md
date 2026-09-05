# CLAUDE.md — Contexto persistente del proyecto

> **Para la sesión de Claude que lea esto:** este archivo es la memoria del
> proyecto. El usuario NO va a repetir el contexto en cada sesión. Leelo
> completo antes de escribir código, y actualizá la tabla de decisiones y la
> lista de pendientes al final de cada sesión de trabajo.

---

## 1. Qué estamos construyendo

Un **sistema de punto de venta (POS) de escritorio** para una tienda de
productos agrícolas en Guatemala. Se vende **a granel** (maíz, azúcar, frijol
— por peso, descontando de sacos abiertos) y **por unidad**, tanto **al detalle**
como **al por mayor**.

- **Cliente:** Jimmy Cano, dueño de la tienda.
- **Desarrollador responsable:** Julio Orellana.
- **Moneda:** quetzal guatemalteco (GTQ, símbolo `Q`), dos decimales.
- **Modo de uso:** una computadora en el mostrador, en modo kiosko, sin que el
  cajero pueda salirse de la aplicación.

## 2. Con quién estás trabajando (esto cambia cómo debés trabajar)

Julio **no es desarrollador de software**: es **auditor financiero y estudiante
de Derecho**. Verifica el trabajo **comparando resultado esperado contra
resultado real** —pruebas automatizadas con casos concretos, informes,
checklists—, no leyendo línea por línea el código.

Consecuencia práctica y no negociable:

- La **documentación** y las **pruebas automatizadas** no son un extra. Son el
  único mecanismo de confianza que existe en este proyecto.
- **Nunca** sacrifiques documentación, pruebas o tipado correcto por brevedad
  o por terminar más rápido.
- Los nombres de las pruebas deben poder leerse como una lista de verificación,
  **en español**, sin abrir el código de implementación.
- Cuando algo no se pueda verificar automáticamente, dejá un procedimiento
  manual escrito y explícito.

## 3. Stack tecnológico

| Capa | Tecnología | Versión declarada |
|---|---|---|
| Escritorio | Electron | ^44.2.0 |
| Build | electron-vite + Vite | ^5.0.0 / ^7.3.6 |
| Interfaz | React | ^19.2.8 |
| Lenguaje | TypeScript en modo estricto | ~5.9.3 |
| Base de datos local | SQLite vía better-sqlite3 | ^13.0.3 |
| Precisión numérica | Decimal.js | ^10.6.0 |
| Validación de payloads | Zod | ^4.5.4 |
| Pruebas | Vitest | ^5.0.0 |
| Lint | ESLint + typescript-eslint (reglas con información de tipos) | ^10.10.0 / ^8.69.0 |
| Nube | Supabase (Postgres + Storage), **plan gratuito durante todo el desarrollo** | — |
| Empaquetado | electron-builder | ^26.15.3 |

Node requerido: **>= 22**.

## 4. Decisiones ya tomadas (no volver a discutirlas)

1. **Es una app de escritorio, no una web.** Electron + React + Vite +
   TypeScript estricto. Nunca `any` implícito.
2. **Ventana en modo kiosko:** pantalla completa, sin menú, sin barra de
   título, sin zoom con Ctrl+rueda, sin menú de clic derecho.
   **Salida controlada:** el atajo `Ctrl + Shift + Alt + Q` (en macOS,
   `Ctrl + Shift + Option + Q`) le pide el PIN al administrador y, solo si el
   PIN es correcto, cierra la aplicación de forma ordenada. Es una salida de
   emergencia para el administrador: **no** se le muestra ni se le documenta al
   usuario de venta, y no existe ningún botón ni menú que la active. Ver la
   sección 4.1.
3. **SQLite solo desde el proceso principal.** El renderer **nunca** accede a
   la base de datos: todo pasa por canales IPC explícitos y tipados. Hay una
   regla de ESLint que hace fallar el lint si alguien lo intenta.
4. **Supabase en plan gratuito** durante todo el desarrollo; el upgrade a plan
   pagado ocurre solo al final, antes de la entrega. El desarrollo y las
   pruebas **no dependen** de que Supabase esté disponible y **no consumen su
   cuota**: el adaptador por defecto es simulado. La sincronización real se
   prueba de forma deliberada y puntual, no en cada ciclo.
5. **Dinero, peso e inventario con Decimal.js.** Cero aritmética nativa de
   punto flotante en cualquier cálculo financiero o de cantidad.
6. **Descuentos con autorización por PIN.** Un administrador configura, por
   rol, el porcentaje y el monto fijo máximo que un usuario de venta puede
   aplicar sin autorización. Si el vendedor intenta exceder ese límite el
   sistema lo bloquea, **pero** un administrador puede autorizar la excepción
   puntual ingresando su PIN en el momento, **sin tocar la configuración
   general**. Esa autorización queda en el log de auditoría.
7. **Inventario acumulado por producto, SIN lotes.** Cada producto tiene un
   único saldo, `inventario_disponible`, que sube con cada ingreso de
   mercadería y baja con cada venta. Cuando llegan 50 sacos y ya había 10, el
   inventario pasa a 60: no se distingue de qué saco sale cada venta.
   **El concepto de "lote" fue eliminado del diseño** (ver la fila
   correspondiente en el registro de decisiones).
8. **El PDF del comprobante siempre se genera**, haya o no impresora térmica.
   La impresión física es una capa opcional encima, nunca un requisito para
   cerrar una venta.
9. **Convención de idioma (sin excepciones):**
   - Carpetas, funciones y utilidades **técnicas genéricas** → inglés
     (`connection.ts`, `register-handlers.ts`, `main-window.ts`).
   - Entidades y campos del **dominio de negocio** → español (`producto`,
     `venta`, `inventario`, `descuento`, `caja`, `montoACadena`,
     `redondearPeso`).
   - Comentarios y JSDoc de lógica de negocio no trivial → **siempre español**.
   - Ante la duda sobre en qué categoría cae un nombre: **elegí español**.
     Nunca inventes un término técnico en inglés que nadie en el proyecto
     va a reconocer.
10. **Git con exactamente dos ramas:** `main` y `develop`. Todo el trabajo
    ocurre en `develop`. `main` **nunca** recibe commits directos: solo merges
    que Julio apruebe explícitamente después de revisar. **No se crean ramas
    por tarea.** Commits atómicos y bien descritos, con prefijo en inglés
    (Conventional Commits) y descripción en español.

### 4.1 Salida controlada del modo kiosko

Sin esta pieza, el modo kiosko no dejaba ninguna forma ordenada de cerrar la
aplicación y había que matar el proceso desde el Administrador de tareas, lo
que deja la base de datos sin consolidar y no registra nada en la auditoría.

- **Atajo:** `Ctrl + Shift + Alt + Q` (macOS: `Ctrl + Shift + Option + Q`).
  Vive en una sola constante, `ATAJO_SALIDA_CONTROLADA` en
  `src/shared/kiosk-input.ts`. Cambiarlo es editar esa constante.
- **Se identifica por la tecla FÍSICA** (`code === 'KeyQ'`), nunca por el
  carácter. En un teclado latinoamericano de Windows, AltGr equivale a Ctrl+Alt
  y produce caracteres distintos; comparando por carácter el atajo no
  funcionaría en la máquina de la tienda.
- **Se captura con `before-input-event`, no con `globalShortcut`**: un atajo
  global se registra en todo el sistema operativo y le robaría la combinación
  a cualquier otra aplicación abierta.
- **Requiere PIN de administrador.** El PIN se verifica en el proceso
  principal, nunca en la interfaz. Tres intentos fallidos bloquean el atajo 30
  segundos.
- **Qué cuenta como intento fallido:** un PIN **completo y bien formado pero
  equivocado** (por ejemplo, teclear `1234` cuando el PIN es `5678`) **sí**
  consume uno de los tres intentos. **No** consumen intento las entradas que
  ni siquiera son un PIN posible —vacías, de menos de cuatro dígitos, de más
  de doce caracteres o con algo que no sea un dígito— ni cancelar el diálogo,
  porque en esos casos no se llega a comparar nada. La distinción es
  deliberada: castigar un error de tecleo dejaría al administrador
  autobloqueado sin haber intentado adivinar nada. Mezclar entradas inválidas
  tampoco sirve para esquivar el limitador: no reinician el contador.
- **No se puede saltar el atajo:** el proceso principal solo acepta un PIN si
  hay una solicitud viva (menos de dos minutos desde la pulsación). Sin eso, la
  interfaz podría usarse para adivinar el PIN a fuerza de intentos.
- **Cierre ordenado** significa, en concreto: se quitan los canales IPC, se
  consolida el WAL de SQLite en el archivo principal
  (`wal_checkpoint(TRUNCATE)`) y recién entonces se cierra la conexión y la
  aplicación.
- **Origen del PIN, hoy:** variable de entorno `POS_PIN_ADMINISTRADOR`. En
  desarrollo, si no está configurada se usa `0000` con una advertencia en
  consola; en producción, sin PIN configurado la salida queda deshabilitada.
  Es **provisional**: cuando exista el módulo de usuarios, el PIN saldrá de la
  base de datos como hash y la auditoría podrá decir **quién** autorizó.

### 4.2 Signos: qué campo puede ser negativo y cuál no

Esta tabla es **normativa**. Está escrita con este nivel de detalle para que
ninguna sesión futura "corrija" por error un campo que se dejó abierto a
propósito.

| Campo | Regla | Por qué |
|---|---|---|
| `productos.inventario_disponible` | **>= 0** | Piso obligatorio. Es la barrera que impide vender más de lo que hay. |
| `productos.precio_base` | **>= 0** | Un producto no le paga al cliente por llevárselo. 0 se permite: muestras y regalos. |
| `productos.cantidad_predefinida_icono` | **> 0** | Estrictamente mayor. Un ícono que agrega cero unidades es un botón que no hace nada. |
| `precios_especiales.valor` | **>= 0** | Un descuento negativo sería un recargo encubierto que se saltaría el control de límites por rol. |
| `limites_descuento.descuento_max_porcentaje` | **>= 0** | 0 es significativo: "este rol no puede dar descuento". |
| `limites_descuento.descuento_max_monto_fijo` | **>= 0** | Igual que el porcentaje. |
| `venta_detalle.precio_unitario_snap` | **>= 0** | Es la foto de `precio_base` y hereda su regla. |
| `caja_sesiones.monto_inicial` | **>= 0** | El fondo con que se abre la caja no puede ser negativo. |
| `caja_sesiones.monto_real` | **>= 0** | El efectivo contado físicamente no puede ser negativo. |
| `ventas.subtotal` | **SIN PISO** | Reservado para devoluciones. |
| `ventas.descuento_valor` | **SIN PISO** | Reservado para devoluciones. |
| `ventas.total` | **SIN PISO** | Una devolución tendrá total negativo. |
| `venta_detalle.cantidad` | **SIN PISO** | Una devolución llevará cantidad negativa. |
| `venta_detalle.subtotal_exacto` | **SIN PISO** | Reservado para devoluciones. |
| `venta_detalle.subtotal_impreso` | **SIN PISO** | Reservado para devoluciones. |
| `caja_sesiones.monto_esperado` | **SIN PISO** | Con devoluciones, lo esperado podría ser negativo. |
| `caja_sesiones.diferencia` | **SIN PISO** | Un faltante de caja **es** negativo. |

Los campos marcados **SIN PISO** llevan un comentario explícito en ambos
esquemas diciéndolo, y hay pruebas que verifican que **aceptan** negativos.
Si alguna vez fallan, es porque alguien les agregó un piso por error.

**El módulo de devoluciones todavía no se diseña ni se implementa.** Los campos
abiertos son una preparación, no una funcionalidad.

### 4.3 Cómo debe descontarse el inventario (para el futuro módulo de ventas)

El piso `>= 0` solo protege de verdad si el descuento es **atómico**. Leer el
saldo en la aplicación, restar y escribir después deja una ventana entre la
lectura y la escritura en la que otra operación puede haber movido el saldo, y
el CHECK se evalúa sobre un valor ya calculado a partir de datos viejos.

**En Postgres** la forma correcta es la evidente, y hay que usarla:

```sql
UPDATE productos
   SET inventario_disponible = inventario_disponible - :cantidad
 WHERE id = :id;
```

**En SQLite NO se puede escribir así**, y conviene saber por qué antes de
intentarlo: `inventario_disponible` es TEXT, así que `columna - :cantidad`
obliga a SQLite a convertir ambos a REAL y hacer **aritmética de punto
flotante** —justo lo que money.ts existe para evitar—, y el resultado (por
ejemplo `58.5`) ni siquiera pasaría el CHECK de forma canónica, que exige tres
decimales.

La forma correcta en SQLite conserva la atomicidad sin romper la exactitud:

1. Todo ocurre dentro de **una sola transacción de escritura** (`BEGIN
   IMMEDIATE`), la misma que inserta la venta y su detalle.
2. El saldo nuevo se calcula en la aplicación **con Decimal.js**.
3. La escritura es un **comparar-y-cambiar**: solo actualiza si el saldo sigue
   siendo el que se leyó.

```sql
UPDATE productos
   SET inventario_disponible = :saldoNuevoCalculadoConDecimal,
       actualizado_en = :ahora
 WHERE id = :id
   AND inventario_disponible = :saldoQueSeLeyo;
```

Si `changes === 0`, alguien movió el saldo entremedio y la venta debe abortar o
reintentar. El CHECK con nombre sigue siendo la última red: si el saldo nuevo
fuera negativo, la base lo rechaza igual.

Ayuda además que la aplicación tenga **instancia única** y que better-sqlite3
sea síncrono: dentro del proceso no hay concurrencia real. La regla existe
igual, porque no queremos que la corrección dependa de eso.

#### Qué pasa cuando el comparar-y-cambiar falla

Falla cuando el `UPDATE` condicional afecta **cero filas**: el saldo ya no era
el que se había leído. La política es esta, y no se improvisa:

**CERO REINTENTOS AUTOMÁTICOS. La transacción se revierte entera y decide el
cajero.**

En concreto:

| Pregunta | Respuesta |
|---|---|
| ¿Reintenta solo? | **No.** Ninguna vez. |
| ¿Cuánto espera entre intentos? | No aplica: no hay intentos. |
| ¿Qué se revierte? | **Toda** la transacción: la venta, su detalle, el descuento de inventario y el contador de ventas. No queda nada a medias. |
| ¿Hay que rehacer la venta desde cero? | **No.** Se revierte la transacción de base, no el carrito de la pantalla. El cajero vuelve a pulsar Cobrar; no vuelve a capturar los productos. |
| ¿Qué ve el cajero? | `CONFLICTO_DE_INVENTARIO`: *"El inventario de {producto} cambió mientras se cobraba. No se registró la venta. Revisá la cantidad y volvé a cobrar."* El código y el mensaje ya existen en `errores.ts` (`errorDeConflictoDeInventario`). |
| ¿Queda registrado? | **Sí**, un asiento de auditoría. En esta arquitectura no debería ocurrir nunca, así que cada ocurrencia es evidencia de que algo hay que investigar. |

**Por qué cero reintentos, y no uno o tres con espera:**

1. **En esta arquitectura, un conflicto no debería poder ocurrir.** La
   aplicación tiene instancia única, better-sqlite3 es síncrono y el
   comparar-y-cambiar corre dentro de una transacción `BEGIN IMMEDIATE`, que
   toma el bloqueo de escritura antes de leer. No hay ventana. Si aun así
   falla, la premisa se rompió: hay un segundo escritor sobre el archivo, o el
   saldo se leyó fuera de la transacción, que es exactamente el error que este
   patrón existe para atrapar. **Reintentar taparía el defecto.**
2. **Un reintento silencioso podría cobrar algo distinto de lo que el cajero
   vio.** Al releer el saldo, la venta se recalcularía contra un inventario que
   nadie revisó, con un cliente esperando. Preferimos un mensaje claro.
3. **Un bucle de reintentos con esperas es peor experiencia que un aviso
   inmediato** en un mostrador: la caja parecería colgada.

**No confundir con `SQLITE_BUSY`, que es otra cosa.** Si el archivo está
bloqueado por otra conexión, eso **sí** se reintenta automáticamente, pero lo
hace el propio controlador: better-sqlite3 espera hasta su `timeout`, que por
omisión es de **5000 ms** (verificado en `node_modules/better-sqlite3/lib/database.js`).
Eso es contención de bloqueo, no un conflicto de datos, y no lo maneja nuestro
código. Si vence ese tiempo, la venta falla igual y el cajero reintenta.

**Cuándo revisar esta decisión:** si un conflicto de inventario llega a
ocurrir en la tienda, la respuesta NO es agregar reintentos, sino averiguar de
dónde salió el segundo escritor. Probablemente signifique que se abrió el punto
pendiente n.º 10 (¿más de una caja contra la misma base?), y ese escenario pide
un rediseño —descuento del lado del servidor en Postgres— y no un bucle.

### 4.4 Estado del proyecto en Supabase

El esquema espejo **ya está aplicado** contra el proyecto real.

| Dato | Valor |
|---|---|
| Proyecto | `pos-jimmy-cano` |
| Referencia | `zgsdaelmbxufgcsideep` |
| Región | us-east-2 |
| Postgres | 17 |
| Migraciones aplicadas | `20260905143642_esquema_inicial`<br>`20260905171724_fijar_search_path_auditoria_log_es_inmutable` |
| Aplicadas el | 2026-09-05 |
| Plan | gratuito |

Estado verificado contra el proyecto, no contra el script: **10 tablas**, 0 filas,
RLS activo en las 10 sin políticas (deniega todo), 21 índices propios, 11 llaves
foráneas, 37 restricciones CHECK y el trigger `auditoria_log_prohibir_cambios`.
`sync_cola` **no** existe allí, como corresponde.

La función `auditoria_log_es_inmutable` tiene `search_path = ''` y es
SECURITY INVOKER, no DEFINER. El linter de seguridad ya no reporta nada sobre
ella.

Pendiente en la nube, para el prompt del módulo de sincronización:

- Crear las **políticas de RLS**. Hoy no hay ninguna, así que la llave anónima
  no puede leer ni escribir nada. La sincronización usará una llave de
  servicio, que ignora RLS por diseño. Mientras tanto, los 10 avisos
  `rls_enabled_no_policy` de nivel INFO son el resultado buscado, no un
  problema.

**No tocar** la función `public.rls_auto_enable()` ni su disparador de eventos
`ensure_rls`: son preexistentes del proyecto y ajenos a este esquema. Tienen dos
advertencias de seguridad propias (`SECURITY DEFINER` ejecutable por los roles
`anon` y `authenticated` vía RPC) que le corresponde revisar a Julio.

## 5. Registro de decisiones técnicas

> Esta tabla es la **fuente de verdad** del proyecto: más confiable que
> cualquier resumen dado fuera del repositorio. Se agrega una fila en cada
> decisión nueva; no se borran filas, se marcan como revertidas.

| Decisión | Alternativas consideradas | Razón | Prompt / fecha |
|---|---|---|---|
| Electron para el escritorio | Tauri; aplicación web; .NET de escritorio | Decisión del cliente. Ecosistema conocido, funciona sin internet y empaqueta para Windows, que es lo que hay en el mostrador. | Prompt 1 — 2026-09-04 |
| electron-vite como herramienta de build | webpack; vite-plugin-electron; Electron Forge | Una sola configuración para los tres procesos (main, preload, renderer), recarga en caliente y externalización automática de módulos nativos. | Prompt 1 — 2026-09-04 |
| SQLite (better-sqlite3) para la persistencia local | IndexedDB; archivos JSON; Postgres local | La tienda debe seguir vendiendo sin internet. SQLite es transaccional, vive en un archivo respaldable y `better-sqlite3` es síncrono, lo que simplifica las transacciones de una venta. IndexedDB vive en el navegador y sería inaccesible para respaldos y auditoría. | Prompt 1 — 2026-09-04 |
| SQLite accesible **solo** desde el proceso principal | Acceso directo desde el renderer con `nodeIntegration: true` | Un renderer con acceso a Node es una superficie de ataque y hace imposible auditar por dónde entra y sale cada dato. Con IPC hay un único punto de control y validación. Reforzado con una regla de ESLint. | Prompt 1 — 2026-09-04 |
| Decimal.js para todo cálculo de dinero, peso y cantidad | `number` nativo; enteros de centavos con `bigint` | `0.1 + 0.2` en JavaScript da `0.30000000000000004`; en una venta a granel con varias pesadas y descuentos el error se acumula y el corte de caja no cuadra. Los enteros de centavos resolvían el dinero pero no el peso con tres decimales. | Prompt 1 — 2026-09-04 |
| Los montos viajan y se guardan como **cadena** | `number` en JSON y en SQLite; enteros | Una cadena atraviesa IPC, JSON y SQLite sin perder un solo dígito; un `number` no puede representar exactamente todos los decimales. | Prompt 1 — 2026-09-04 |
| Redondeo comercial HALF_UP | Redondeo bancario HALF_EVEN; truncar | `0.125 → 0.13` es lo que el cliente y el auditor esperan. El redondeo bancario da resultados que un cajero no puede explicarle a un comprador parado frente al mostrador. | Prompt 1 — 2026-09-04 |
| Prorrateo por residuo mayor (`repartirMonto`) | Redondear cada línea por separado | Redondear línea por línea deja centavos sueltos y el total impreso no coincide con la suma de las líneas. El residuo mayor garantiza que la suma sea exactamente el total y es un criterio explicable en auditoría. | Prompt 1 — 2026-09-04 |
| PIN de administrador para excepciones de descuento | Subir el límite global; bloqueo duro sin excepción | Subir el límite global deja al vendedor con más poder de forma permanente; el bloqueo duro paraliza la venta. El PIN autoriza **una** excepción, deja rastro en auditoría y no cambia la configuración. | Prompt 1 — 2026-09-04 |
| ~~Inventario a granel por lotes con peso inicial y restante~~ **REVERTIDA en el Prompt 5.** | Un único saldo de peso por producto | Se asumió que hacía falta trazar de qué saco salía cada venta. Ver la fila de reemplazo. | Prompt 1 — 2026-09-04 |
| ~~**No** implementar todavía ninguna regla de selección automática de lote~~ **SIN EFECTO desde el Prompt 5:** ya no hay lotes que seleccionar. | FIFO por antigüedad; selección manual; por vencimiento | El criterio nunca se confirmó porque la pregunta dejó de existir al eliminarse los lotes. | Prompt 1 — 2026-09-04 |
| **ELIMINACIÓN DEL CONCEPTO DE LOTE. Inventario acumulado: un único saldo por producto.** `productos.inventario_disponible` sube con cada ingreso de mercadería y baja con cada venta. | Mantener lotes por saco con peso inicial y restante; lotes solo para productos a granel | **No es un olvido: es una simplificación deliberada basada en cómo opera el negocio real.** Jimmy explicó que cuando llega mercadería nueva la suma directamente al inventario existente del mismo producto —tenía 10 sacos, llegan 50, el total es 60— sin distinguir de qué saco sale cada venta. Para su negocio no hay diferencia de costo, de vencimiento ni de trazabilidad entre sacos del mismo producto, así que los lotes habrían sido complejidad pura: una tabla, una regla de selección, un flujo de apertura y una pantalla, todo para modelar una distinción que el negocio no hace. Se elimina también la pregunta bloqueante sobre el criterio de consumo de lote, que queda sin objeto. | Prompt 5 — 2026-09-05 |
| El PDF del comprobante siempre se genera; la impresión física es un adaptador opcional | Exigir impresora térmica configurada para cerrar la venta | Si la impresora falla, la tienda tiene que poder seguir vendiendo. El PDF es el respaldo obligatorio; el papel es un extra. | Prompt 1 — 2026-09-04 |
| Adaptadores (`ReceiptPrinterProvider`, `SyncProvider`) con implementación segura por defecto | Integrar Supabase y ESC/POS directamente en el dominio | Permite desarrollar y probar todo sin impresora y sin consumir la cuota gratuita de Supabase. Activar lo real es cambiar configuración, no lógica de negocio. | Prompt 1 — 2026-09-04 |
| Zod para validar todo payload que cruza IPC | Confiar en los tipos de TypeScript | Los tipos de TypeScript desaparecen al compilar: en tiempo de ejecución no validan nada. El renderer se trata como entrada no confiable por principio. | Prompt 1 — 2026-09-04 |
| SQLite con `journal_mode = WAL` y `synchronous = FULL` | `synchronous = NORMAL` (más rápido) | En la tienda hay cortes de energía. Preferimos una escritura un poco más lenta a perder la última venta cobrada. | Prompt 1 — 2026-09-04 |
| Instancia única de la aplicación | Permitir varias ventanas | Dos copias del POS sobre la misma base de datos son una fuente segura de descuadres en el corte de caja. | Prompt 1 — 2026-09-04 |
| Idioma mixto: técnico en inglés, dominio en español | Todo en inglés; todo en español | El inglés es el estándar de la industria para lo genérico; el español es el vocabulario que el cliente y el auditor usan y hace la auditoría más rápida. | Prompt 1 — 2026-09-04 |
| Solo dos ramas: `main` y `develop` | git-flow con rama por tarea | Un solo desarrollador y un auditor. Las ramas por tarea agregan ceremonia sin agregar control. | Prompt 1 — 2026-09-04 |
| Verificación de arranque no interactiva (`npm run verify:arranque`) | Verificar abriendo la app y mirando la pantalla | Le da al auditor un informe comparable (resultado esperado vs. real) sin depender de que alguien mire la pantalla y opine. | Prompt 1 — 2026-09-04 |
| **Política de redondeo: REDONDEO ÚNICO AL FINAL.** Toda la cadena de cálculo se mantiene exacta y el redondeo ocurre una sola vez, al persistir, mostrar o imprimir. Nunca se redondea un resultado intermedio. | Redondear cada línea o cada paso intermedio; truncar en cada operación | Tres pesadas de 0.5 lb a Q0.67/lb valen Q0.335 cada una: redondeando al final el total es Q1.01, redondeando línea por línea da Q1.02 y se le cobra de más al cliente. La política está enunciada en el encabezado de `money.ts` y **verificada** por el grupo de pruebas "Política de redondeo del sistema", que falla si alguien agrega un redondeo intermedio. Única excepción controlada: `repartirMonto`, que debe redondear para prorratear, con la garantía verificable de que la suma de las partes es exactamente el total. | Prompt 2 — 2026-09-04 |
| **Comprobante impreso: "EL TOTAL MANDA".** El total se calcula exacto y se redondea una sola vez; los importes de línea que se imprimen se derivan de ese total para que sumen exactamente el total impreso, repartiendo la diferencia por residuo mayor. | Que las líneas manden y el total sea su suma; que la diferencia la absorba la última línea; que la absorba la línea de mayor monto | Con la política de redondeo único al final, la suma de las líneas impresas puede diferir del total impreso: tres líneas de 3.345, 10.275 y 3.175 dan un total correcto de Q16.80 pero suman Q16.81 redondeadas por separado, y un recibo así no se defiende en una auditoría. Que manden las líneas le cobraría de más al cliente. Concentrar el residuo en una sola línea la desvía varios centavos con muchas líneas: con diez pesadas de Q0.335, la última tendría que imprimir Q0.29 en vez de Q0.34. El residuo mayor garantiza que cada línea impresa sea el piso o el techo en centavos de su propio valor, nunca más de un centavo de diferencia. Implementado en `conciliarSubtotalesConTotal` y verificado por el grupo de pruebas "El comprobante impreso cuadra". | Prompt 3 — 2026-09-05 |
| **Regla de desempate del reparto de centavos: gana la línea que aparece PRIMERO.** Cuando dos o más líneas tienen exactamente el mismo residuo, el centavo se le da a la de posición menor en el comprobante; la que se queda sin él es la última de las empatadas. El criterio es la posición, nunca el monto de la línea ni el producto. Rige por igual en `conciliarSubtotalesConTotal` y en `repartirMonto`. | Dárselo a la línea de mayor monto; a la última; elegir al azar; dejarlo al orden que devuelva el `sort` del motor | Hacía falta una regla explícita porque el empate es el caso NORMAL, no el raro: tres pesadas iguales empatan siempre. El comparador desempata por índice y por eso nunca devuelve 0 para dos líneas distintas, lo que define un orden total y hace que el resultado **no dependa de si el `sort` de JavaScript es estable**. El reparto es determinista: la misma venta, en el mismo orden, coloca siempre el centavo en la misma línea, y por lo tanto el mismo recibo reimpreso sale idéntico. Cambiar el orden de captura sí mueve el centavo, pero nunca cambia el total. Verificado por el grupo de pruebas "Regla de desempate: quién se queda sin el centavo", que incluye 200 repeticiones de la misma venta y un caso de 50 líneas empatadas. | Prompt 4 — 2026-09-05 |
| **Claves primarias UUID generadas EN EL CLIENTE**, nunca AUTOINCREMENT. | Enteros autoincrementales; UUID generado por el servidor con `gen_random_uuid()` | La tienda vende sin internet y sincroniza después. Con autoincrementales, dos ventas creadas offline en máquinas distintas tendrían el mismo id y colisionarían al subir a Supabase. Que el servidor genere el id tampoco sirve: el registro nace en la máquina de la tienda y tendría dos identidades. | Prompt 5 — 2026-09-05 |
| **Dinero, peso y cantidad se guardan como TEXT en SQLite, jamás como REAL.** | REAL; INTEGER de centavos | SQLite REAL es punto flotante de 64 bits: exactamente lo que money.ts existe para evitar. Un total de Q16.80 puede volver de la base como 16.799999999999997 y descuadrar el corte de caja. Los centavos como entero resolvían el dinero pero no el peso de tres decimales. | Prompt 5 — 2026-09-05 |
| **El CHECK de las columnas decimales exige la FORMA CANÓNICA exacta, no solo `typeof = 'text'`.** Montos con exactamente 2 decimales, pesos y cantidades con 3, valores exactos con hasta 10. | Solo `typeof(col) = 'text'`; sin restricción, confiando en el código | Se comprobó empíricamente que `typeof` NO alcanza: una columna declarada TEXT tiene afinidad TEXT y SQLite convierte por su cuenta un número a texto antes de guardarlo, así que ligar `0.1 + 0.2` guardaba `'0.30000000000000004'` y el `typeof` pasaba igual. Con la forma canónica exacta, ese valor y cualquier float ligado por descuido se rechazan en la base. Verificado en la prueba "RECHAZA un float de JavaScript ligado directamente". | Prompt 5 — 2026-09-05 |
| **Un único módulo, `decimal-columns.ts`, es la única vía para leer y escribir columnas decimales.** | Que cada repositorio convierta por su cuenta | Con la conversión repartida, basta que un repositorio use `Number(fila.total)` para reintroducir el punto flotante en silencio. Centralizada, hay un solo lugar que auditar, y además rechaza ruidosamente cualquier valor que la base devuelva como número. | Prompt 5 — 2026-09-05 |
| **En Postgres los mismos campos son NUMERIC, no TEXT.** | Repetir el patrón TEXT del lado de la nube | NUMERIC de Postgres es un tipo decimal exacto nativo de precisión arbitraria: no tiene la limitación que obliga al TEXT en SQLite. Copiar el patrón sería arrastrar una solución sin el problema que la justificaba, y además impediría sumar y hacer reportes en SQL del lado del servidor. | Prompt 5 — 2026-09-05 |
| **`venta_detalle` guarda una FOTO del nombre, la unidad y el precio al momento de la venta**, no una referencia viva al producto. | Leer el nombre y el precio del producto al reimprimir el recibo | Un producto puede cambiar de precio, de nombre o desactivarse después de la venta. Con referencias vivas, reimprimir un recibo de hace tres meses mostraría el precio de hoy y el documento histórico cambiaría retroactivamente: exactamente lo que una auditoría no puede tolerar. | Prompt 5 — 2026-09-05 |
| **`venta_detalle` guarda `subtotal_exacto` y `subtotal_impreso` por separado.** | Guardar solo uno de los dos | Son dos cosas distintas: del exacto (sin redondear) se deriva el total real, y el impreso es el valor conciliado que salió en el papel. Guardando solo el impreso se pierde la trazabilidad del cálculo; guardando solo el exacto no se puede reproducir el recibo tal como se entregó. | Prompt 5 — 2026-09-05 |
| **Migraciones numeradas con checksum registrado.** El migrador se niega a arrancar si una migración ya aplicada cambió de contenido. | Migraciones sin control de integridad; recrear el esquema en cada arranque | Editar una migración ya aplicada deja la base de la tienda y el código en estados distintos sin que nadie se entere. El checksum convierte eso en un error ruidoso al arrancar. | Prompt 5 — 2026-09-05 |
| **La bitácora de auditoría es inmutable por trigger**, tanto en SQLite como en Postgres. | Confiar en que nadie la modifique; permitir correcciones | Un registro de auditoría que se puede editar no sirve como evidencia. La base rechaza cualquier UPDATE o DELETE sobre `auditoria_log`. | Prompt 5 — 2026-09-05 |
| **En Supabase se activa RLS en todas las tablas, sin políticas (denegar por omisión).** | Dejar las tablas sin RLS | Supabase publica automáticamente las tablas de `public` por su API. Sin RLS, cualquiera con la llave anónima —que viaja dentro de la aplicación instalada— podría leer y escribir las ventas de la tienda. Las políticas concretas llegan con el módulo de sincronización, en su propia migración. | Prompt 5 — 2026-09-05 |
| **Piso 0 explícito en `productos.inventario_disponible`.** Cualquier operación que lo dejaría por debajo de 0 falla en la base. | Validar solo en la aplicación; permitir negativos y corregir después | Validar solo en la aplicación deja la regla al alcance de cualquier error de programación. En la base, la venta que excede el stock es imposible, no improbable. La restricción lleva NOMBRE (`productos_inventario_no_negativo`) para poder traducir su error a un mensaje de negocio. | Prompt 6 — 2026-09-05 |
| **En SQLite el piso se escribe `NOT col GLOB '-*'`, NO `col >= 0`.** | La forma literal `CHECK (col >= 0)` | Comprobado empíricamente: en SQLite el orden entre tipos es NULL < numéricos < TEXT, así que CUALQUIER texto resulta mayor que 0 y `CHECK (inventario_disponible >= 0)` **acepta** el valor `'-5.000'`. Como la forma canónica garantiza que el signo, si existe, es el primer carácter, "no empieza con menos" es una prueba exacta y sin punto flotante. En Postgres sí se usa `>= 0`, porque NUMERIC compara como número. | Prompt 6 — 2026-09-05 |
| **Los campos transaccionales de `ventas` y `venta_detalle` quedan SIN piso, a propósito.** Ver la tabla completa en la sección 4.2. | Ponerles piso 0 "por prolijidad" | Se reservan para el futuro módulo de devoluciones, que necesitará cantidades y totales negativos. Llevan un comentario explícito en ambos esquemas y pruebas que verifican que **aceptan** negativos, para que ninguna sesión futura los "corrija". Los campos de precio y configuración sí tienen piso: un precio o un tope de descuento no cambia de signo por una devolución. | Prompt 6 — 2026-09-05 |
| **Un único punto traduce los errores de restricción a errores de negocio** (`errores.ts`), y toda escritura de repositorio pasa por `RepositorioBase.ejecutar()`. | Dejar pasar el error crudo de SQLite; traducir en cada pantalla | "CHECK constraint failed: productos_inventario_no_negativo" no se le puede mostrar a un cajero con un cliente enfrente, y traducir en cada pantalla garantiza que alguna se olvide. El error se convierte en `STOCK_INSUFICIENTE` con el mensaje "Stock insuficiente para completar la venta", conservando la causa técnica para la bitácora. Un error que NO se reconoce pasa sin envolver, para no esconder fallos de programación detrás de un texto tranquilizador. | Prompt 6 — 2026-09-05 |
| **El descuento de inventario debe ser atómico** (ver sección 4.3): en Postgres con `SET col = col - :cantidad`; en SQLite con comparar-y-cambiar dentro de una sola transacción de escritura, porque allí la resta en SQL sería de punto flotante. | Leer, restar en la aplicación y escribir después, en operaciones separadas | Entre la lectura y la escritura hay una ventana en la que otra operación puede mover el saldo, y entonces el CHECK se evalúa sobre datos viejos. | Prompt 6 — 2026-09-05 |
| **Ante un conflicto de inventario (el comparar-y-cambiar afecta 0 filas): CERO reintentos automáticos.** Se revierte toda la transacción, el carrito de la pantalla se conserva y el cajero vuelve a cobrar. Queda un asiento de auditoría. | Reintentar N veces con espera; reintentar una sola vez; recalcular en silencio contra el saldo nuevo | En esta arquitectura el conflicto no debería poder ocurrir: instancia única, better-sqlite3 síncrono y `BEGIN IMMEDIATE` toma el bloqueo antes de leer. Si ocurre, la premisa se rompió —hay un segundo escritor, o el saldo se leyó fuera de la transacción— y reintentar taparía el defecto. Además, un reintento silencioso podría cobrar contra un inventario que nadie revisó, con el cliente enfrente. No confundir con `SQLITE_BUSY`, que sí se reintenta, pero lo hace el controlador con su timeout de 5000 ms. Ver la sección 4.3. | Prompt 7 — 2026-09-05 |
| Salida controlada del kiosko con atajo + PIN de administrador | Dejar la app sin salida (matar el proceso); un botón de salir en la interfaz; salida sin PIN | Sin salida ordenada había que matar el proceso desde el Administrador de tareas, lo que deja el WAL de SQLite sin consolidar y no registra nada. Un botón visible sería una invitación para el cajero. El PIN convierte la salida en una acción de administrador auditable. | Prompt 2 — 2026-09-04 |
| El atajo se captura con `before-input-event` y no con `globalShortcut` | `globalShortcut` de Electron | `globalShortcut` registra la combinación en todo el sistema operativo y se la roba a cualquier otra aplicación abierta, incluida la del desarrollador. El atajo solo debe existir mientras el POS tiene el foco. | Prompt 2 — 2026-09-04 |
| Las combinaciones de teclas se identifican por tecla FÍSICA (`code`) y no por carácter (`key`) | Comparar `key === 'q'` | En el teclado latinoamericano de Windows, AltGr es Ctrl+Alt y cambia el carácter que produce cada tecla. Comparando por carácter, el atajo del administrador simplemente no funcionaría en la computadora de la tienda. | Prompt 2 — 2026-09-04 |
| PIN de administrador provisional desde variable de entorno, con respaldo solo en desarrollo | Dejarlo fijo en el código; no pedir PIN; esperar al módulo de usuarios para tener salida | Un PIN fijo en el código es específico del cliente y no puede versionarse (ver NEGOCIO_VS_NUCLEO.md). Sin respaldo en desarrollo, cada sesión terminaría matando el proceso. En producción, sin PIN configurado la salida queda deshabilitada en vez de aceptar uno adivinable. | Prompt 2 — 2026-09-04 |
| Limitador de intentos del PIN: 3 intentos y 30 segundos de bloqueo | Sin límite de intentos | Un PIN de cuatro dígitos sin límite se adivina por fuerza bruta en minutos, y hoy el PIN es lo único que separa a un cajero de cerrar el punto de venta. Un PIN con formato inválido no consume intentos, para que nadie se autobloquee por un error de tecleo. | Prompt 2 — 2026-09-04 |
| Solo se acepta un PIN si hay una solicitud de salida viva (2 minutos) | Aceptar el PIN en cualquier momento | Sin esa ventana, una interfaz comprometida podría usar el canal IPC como oráculo para adivinar el PIN sin que nadie toque el teclado. | Prompt 2 — 2026-09-04 |
| El cierre ordenado consolida el WAL con `wal_checkpoint(TRUNCATE)` | Cerrar la conexión sin consolidar | Con WAL, las escrituras recientes viven en un archivo `-wal` aparte. Cerrar sin consolidar deja la base correcta pero repartida en dos archivos, lo que complica los respaldos y la revisión del archivo por parte del auditor. | Prompt 2 — 2026-09-04 |

## 6. Pendiente de confirmación con el cliente / auditor

> Ningún punto de esta lista se resuelve "con el mejor criterio técnico". Se
> resuelve preguntando. Mientras no esté confirmado, dejá un `TODO` en el
> código señalando la dependencia y seguí con el resto.

### 6.1 CERRADO — Criterio de selección de lote

**Ya no aplica.** Era el punto bloqueante del proyecto: con varios lotes del
mismo producto, ¿cuál se consumía primero? La pregunta quedó sin objeto en el
Prompt 5, cuando Jimmy explicó que no maneja lotes: la mercadería nueva se suma
al inventario existente del mismo producto y no se distingue de qué saco sale
cada venta.

Se conserva anotado aquí, y no se borra, para que quede constancia de que se
cerró preguntándole al cliente y no asumiendo un criterio.

### 6.2 Otros puntos abiertos

| # | Pregunta | Por qué importa | Estado |
|---|---|---|---|
| 1 | ¿Qué unidades de medida usa Jimmy y con qué factores de conversión (libra, arroba, quintal, kilogramo)? | Define la lógica de conversión de `src/shared` y cómo se captura el peso en la caja. | Abierto |
| 2 | ¿La tienda emite factura fiscal (FEL/SAT) o solo recibo y proforma internos? | Cambia por completo el módulo de comprobantes y las obligaciones legales. | Abierto |
| 3 | ¿El precio de mayoreo se activa por cantidad comprada, por tipo de cliente, o ambos? | Define el modelo de precios del catálogo. | Abierto |
| 4 | ¿Hay ventas al crédito / cuentas por cobrar? | Agregaría un módulo completo de clientes y saldos. | Abierto |
| 5 | ¿El PIN de autorización es por usuario administrador o uno solo para la tienda? | Determina si el log de auditoría puede identificar **quién** autorizó. Hoy el PIN sale de `POS_PIN_ADMINISTRADOR` y el sistema sabe QUE alguien autorizó, pero no QUIÉN. Recomendación técnica: por usuario. | Abierto — implementación provisional en marcha |
| 6 | ¿Qué roles exactos existen además de "venta" y "administrativo"? | Define la matriz de permisos (RBAC). | Abierto |
| 7 | ¿Qué se hace con la merma (diferencia entre lo que entró al inventario y la suma de lo vendido)? ¿Se ajusta el saldo a mano y queda en auditoría? | Sin regla, el inventario nunca cuadrará contra la realidad física del bodegón. | Abierto |
| 8 | ~~¿El sistema debe impedir una venta que deje el inventario en negativo, o solo advertir?~~ | — | **RESUELTO (Prompt 6): la impide.** `inventario_disponible` tiene piso 0 en la base. Ver secciones 4.2 y 4.3. |
| 9 | Modelo y marca de la impresora térmica. | Necesario para escribir el adaptador ESC/POS real. | Abierto |
| 10 | ¿Habrá más de una caja o sucursal sincronizando contra la misma nube? | Define si la sincronización necesita resolución de conflictos o solo respaldo. | Abierto |
| 11 | ¿Cada cuánto y hacia dónde se respalda la base de datos local? | El archivo SQLite contiene todas las ventas; hoy no hay política de respaldo. | Abierto |
| 12 | Falta probar el atajo de salida en una máquina Windows real con teclado latinoamericano. | El atajo está verificado en macOS de extremo a extremo y cubierto por pruebas que simulan la entrada de Windows, pero nadie lo ha presionado todavía en la computadora del mostrador. | Abierto — pendiente de acceso a una máquina Windows |

## 7. Qué NO existe todavía (y no hay que inventar)

Al cierre del Prompt 5 hay andamiaje y **base de datos**, pero todavía no hay
negocio:

- No hay pantallas de negocio. `src/renderer/src/App.tsx` es una pantalla de
  verificación técnica y se reemplaza cuando lleguen los módulos reales.
- **El esquema de la base de datos SÍ existe** (11 tablas locales, su espejo en
  Postgres y la capa de repositorios), pero está vacío: no hay datos semilla,
  ni catálogo, ni usuarios.
- Los repositorios solo leen y escriben. No contienen ninguna regla de
  negocio: eso llega módulo por módulo en los prompts siguientes.
- No hay lógica de ventas, inventario, descuentos, caja, usuarios ni
  auditoría. La
  única excepción es el verificador de PIN de administrador
  (`src/main/security/admin-pin.ts`), que existe porque la salida controlada lo
  necesitaba; es provisional y lo reemplazará el módulo de usuarios.
- No hay log de auditoría: los puntos donde debería escribirse ya están
  marcados con `TODO(auditoria)` en el controlador de salida.
- No hay adaptador real de impresora ni de Supabase: solo los contratos y las
  implementaciones seguras por defecto.

## 8. Comandos

```bash
npm install          # instalar dependencias (recompila better-sqlite3 para Electron)
npm run dev          # abrir la aplicación en modo desarrollo
npm test             # correr las pruebas automatizadas
npm run lint         # revisar reglas de código y de arquitectura
npm run typecheck    # verificar tipos en los tres proyectos de TypeScript
npm run verify       # lint + typecheck + pruebas, todo junto
npm run verify:arranque  # arranca la app, imprime un informe de verificación y sale
```

## 9. Mapa del repositorio

```
src/main/       proceso principal de Electron: ventana, SQLite, IPC
  database/          conexión a SQLite (nadie más la abre)
    migrations/      migraciones .sql numeradas del esquema local
    repositories/    una clase por tabla; la única puerta hacia los datos
    decimal-columns.ts  única vía para leer/escribir dinero, peso y cantidad
    migrator.ts      aplica las migraciones y verifica sus checksums
  ipc/          manejadores IPC, con validación Zod de cada payload
  preload/      único puente hacia el renderer (expone window.pos)
  security/     verificación del PIN de administrador
  windows/      creación y bloqueos de la ventana kiosko
src/renderer/   interfaz React (sin acceso a Node, a SQLite ni a la red)
src/shared/     código compartido main <-> renderer
  adapters/     interfaces de integración + implementaciones seguras
  types/        contrato IPC y DTOs con Zod
  money.ts      aritmética exacta con Decimal.js
  __tests__/    pruebas automatizadas
supabase/       espejo del esquema en Postgres (migraciones para la nube)
docs/           arquitectura, guía de desarrollo, núcleo vs. negocio, integraciones
```

## 10. Antes de cerrar cualquier sesión de trabajo

1. `npm run verify` debe pasar (lint + tipos + pruebas).
2. Agregar las decisiones nuevas a la tabla de la sección 5.
3. Actualizar la sección 6 si se confirmó o se abrió algún punto.
4. Commits atómicos en `develop`, prefijo en inglés, descripción en español.
5. **Nunca** hacer commit directo a `main`.

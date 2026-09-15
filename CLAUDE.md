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

> ### PLATAFORMA OBJETIVO
>
> **Windows es la plataforma de producción real y el criterio de aceptación
> final para cualquier comportamiento específico de plataforma (atajos de
> teclado, ventana, impresión, touch). macOS es únicamente el entorno de
> desarrollo de quien construye este proyecto — que algo funcione en macOS es
> una señal útil durante el desarrollo, pero NUNCA sustituye la verificación en
> Windows. Cuando exista un conflicto o una decisión de diseño que favorezca a
> una plataforma sobre la otra, Windows gana siempre.**
>
> Consecuencias prácticas, para que el principio no quede en el papel:
>
> - Al reportar cualquier verificación de algo dependiente de plataforma, decir
>   **explícitamente en cuál se probó**. "Verificado en macOS" no es
>   "verificado".
> - Lo probado solo en macOS se anota como **pendiente de confirmar en
>   Windows**, no como terminado (ver el punto 12 de la sección 6.2).
> - Ante un conflicto de diseño, se elige lo que funcione en Windows aunque
>   empeore la experiencia de desarrollo en macOS.
> - Qué se puede y qué jamás se puede bloquear en cada sistema: sección 4.6.

1. **Es una app de escritorio, no una web.** Electron + React + Vite +
   TypeScript estricto. Nunca `any` implícito.
2. **Ventana en modo kiosko:** pantalla completa, sin menú, sin barra de
   título, sin zoom con Ctrl+rueda, sin menú de clic derecho. **Nunca se usa
   `kiosk: true` de Electron** y **nunca se tocan los mecanismos de escape del
   sistema operativo** (ver la sección 4.5, que es una regla de diseño, no un
   arreglo puntual).
   **Salida controlada:** el atajo `Ctrl + Shift + Alt + Q` (en macOS,
   `Ctrl + Shift + Option + Q`) le pide el PIN al administrador y, solo si el
   PIN es correcto, cierra la aplicación de forma ordenada. Hay **tres** vías
   de entrada —el atajo, la intercepción de `Cmd+Q`/`Alt+F4` y un botón
   discreto en la barra de estado— y las tres pasan por el mismo PIN y el mismo
   asiento de auditoría. Ver las secciones 4.1 y 4.5.
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
  segundos. **Desde el 2026-09-15 acepta también el código REMOTO** (desde §4.47, el de seis dígitos de la app de autenticación) de un
  administrador, por decisión explícita de Julio (§4.41); el asiento registra
  cuál se usó en `autorizadaVia`. El candado no cambió.
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
- **Origen del PIN: usuarios REALES.** Se verifica contra los usuarios con rol
  `administrativo` de la base, con su hash scrypt. **La variable
  `POS_PIN_ADMINISTRADOR` ya no existe** y no hay ningún PIN por defecto en el
  código. La auditoría registra el `usuario_id` real de quien autorizó.
- **Una sola función de verificación para las tres rutas.** El atajo, la
  intercepción del cierre del sistema y el botón de la interfaz llaman los tres
  a `ControladorDeSalidaControlada.solicitarPin(ventana, origen)` y, al
  confirmar, a `confirmarSalida(pin)`, que invoca una única vez
  `ServicioDeAutenticacion.autorizarComoAdministrador`. No hay tres
  implementaciones paralelas.
- **Un solo nombre de acción en la auditoría.** Las tres rutas escriben
  `salida_controlada_autorizada` (o `salida_controlada_rechazada`). Por dónde
  entró la solicitud es un DATO del asiento (`origen`:
  `atajo_de_teclado` | `cierre_del_sistema` | `boton_de_interfaz`), no una
  acción distinta: desde el punto de vista del negocio es el mismo hecho.

### 4.2 Signos: qué campo puede ser negativo y cuál no

Esta tabla es **normativa**. Está escrita con este nivel de detalle para que
ninguna sesión futura "corrija" por error un campo que se dejó abierto a
propósito.

| Campo | Regla | Por qué |
|---|---|---|
| `productos.inventario_disponible` | **>= 0** | Piso obligatorio. Es la barrera que impide vender más de lo que hay. |
| `productos.precio_base` | **>= 0** | Un producto no le paga al cliente por llevárselo. **0 se permite**; para qué le sirve un precio 0 a la tienda es una definición de negocio que Jimmy no confirmó, así que ni el mensaje ni esta tabla se la atribuyen. |
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

> **Nota sobre un comentario viejo del esquema.** Las migraciones `001` local y
> `0001` de Postgres todavía dicen «Se permite 0, para muestras y regalos» al
> lado de `precio_base`. Esa razón nunca la confirmó Jimmy y ya se retiró del
> mensaje que ve el usuario y de esta tabla. **No se corrige en la migración**
> porque una migración aplicada no se edita: el migrador guarda su checksum y
> se niega a arrancar si cambió, así que tocarla dejaría sin abrir toda base
> que ya la haya aplicado. Queda anotado acá para que nadie lea ese comentario
> como una definición del negocio.

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
| ¿Queda registrado? | **Sí**, el asiento `conflicto_de_inventario`, escrito **después de revertir**, en una transacción aparte y en su propio lote de la cola, que sube por `sincronizar_asiento`. En esta arquitectura no debería ocurrir nunca, así que cada ocurrencia es evidencia de que algo hay que investigar. **HASTA EL 2026-09-15 ESTA FILA DECÍA «SÍ» Y NO ESTABA IMPLEMENTADO**: el servicio lanzaba el error dentro de la transacción y nadie escribía nada después. Ver «El asiento del conflicto», más abajo. |

**Por qué cero reintentos, y no uno o tres con espera:**

1. **En esta arquitectura, un conflicto no debería poder ocurrir.** La
   aplicación tiene instancia única, better-sqlite3 es síncrono y el
   comparar-y-cambiar corre dentro de una transacción `BEGIN IMMEDIATE`, que
   toma el bloqueo de escritura antes de leer. No hay ventana. Si aun así
   falla, la premisa se rompió: hay un segundo escritor sobre el archivo, o el
   saldo se leyó fuera de la transacción, que es exactamente el error que este
   patrón existe para atrapar. **Reintentar taparía el defecto.**
   **(CORREGIDO EL 2026-09-15: el código NO abre `BEGIN IMMEDIATE`.**
   `enTransaccionDeNegocio` llama a `base.transaction(fn)()`, que corre `BEGIN`
   a secas —`node_modules/better-sqlite3/lib/methods/transaction.js`, línea
   42—, y en `src/main` no hay ningún `.immediate`. Qué cambia eso está medido
   en «Lo que el asiento NO cubre», más abajo. La razón de los cero reintentos
   sigue valiendo; lo que no es cierto es el mecanismo que se nombra acá.**)**
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
**(PRECISADO EL 2026-09-15, medido: con `BEGIN` a secas y WAL, si otra
conexión confirma una escritura DESPUÉS de que la venta leyó, la primera
escritura de la venta lanza `SQLITE_BUSY_SNAPSHOT` en el acto. Ese código no lo
espera el `timeout`: la ventana recibe «La operación no pudo completarse.» a los
2 ms.)**

**Cuándo revisar esta decisión:** si un conflicto de inventario llega a
ocurrir en la tienda, la respuesta NO es agregar reintentos, sino averiguar de
dónde salió el segundo escritor. Probablemente signifique que se abrió el punto
pendiente n.º 10 (¿más de una caja contra la misma base?), y ese escenario pide
un rediseño —descuento del lado del servidor en Postgres— y no un bucle.

#### El asiento del conflicto: prometido desde el Prompt 7, escrito desde el 2026-09-15

**La discrepancia.** La tabla de arriba decía «¿Queda registrado? Sí» y el
código no lo hacía. `ServicioDeVenta.registrar` lanzaba
`errorDeConflictoDeInventario` dentro de la transacción, en el paso 4
(inventario) y en el paso 6 (cantidad vendida). La transacción se revertía y
nadie escribía nada después. La encontró el diseño de la anulación
(`docs/ANULACION-DE-VENTA.md` §0.4). Antes de tocar nada se confirmó de dos
formas:

```
$ grep -rn "CONFLICTO_DE_INVENTARIO" src/main   (sin contar pruebas)
src/main/database/errores.ts:23:  | 'CONFLICTO_DE_INVENTARIO'
src/main/database/errores.ts:208:    'CONFLICTO_DE_INVENTARIO',

sonda con el código anterior (432723b), conflicto forzado en cada paso:
[sonda] descontarSiSigueIgual ANTES: auditoria_log por accion=[{"accion":"caja_abierta","n":1}]
[sonda] descontarSiSigueIgual: error.codigo=CONFLICTO_DE_INVENTARIO mensaje="El inventario de Maíz cambió mientras se cobraba. No se registró la venta. Revisá la cantidad y volvé a cobrar."
[sonda] descontarSiSigueIgual DESPUÉS: auditoria_log por accion=[{"accion":"caja_abierta","n":1}]
[sonda] descontarSiSigueIgual DESPUÉS: sync_cola por entidad_tipo=[{"entidad_tipo":"auditoria_log","n":1},{"entidad_tipo":"caja_sesiones","n":1}]
[sonda] registrarVentaDeProducto DESPUÉS: auditoria_log por accion=[{"accion":"caja_abierta","n":1}]
```

**Qué hace ahora.** El conflicto sale de la transacción envuelto en
`ConflictoAlVender`, que es interno del servicio. Con la transacción ya
revertida, `registrar` escribe el asiento con `conBandejaDeSalida` y relanza el
MISMO `ErrorDeNegocio` de siempre. *(Desde el 2026-09-15 esa escritura pasa por
la puerta compartida con la anulación; ver «Una sola forma», más abajo.)* El cajero ve exactamente lo mismo que antes:
código, mensaje y causa técnica. Hay pruebas con los textos literales y con el
sobre de IPC.

| Campo | Valor |
|---|---|
| `accion` | `conflicto_de_inventario`, la misma que usa la anulación; la operación va como dato |
| `usuario_id` | Quien vendía |
| `entidad_tipo` / `entidad_id` | `productos` / el producto que falló. **No `ventas`**: la venta nunca existió, y un id de venta revertida apuntaría a la nada |
| `fecha` | El instante de la venta intentada |
| `valor_nuevo` | ~~`{ operacion: 'venta', productoId, nombre, comparacion, saldoQueSeLeyo, cantidadVendidaQueSeLeyo, momento }`~~ **Desde el 2026-09-15, la forma única compartida con la anulación:** `{ operacion: 'venta', ventaId: null, productoId, nombre, comparacion, saldoQueSeLeyo, cantidadVendidaQueSeLeyo, causaTecnica }`. Ver «Una sola forma», abajo |
| En la cola | Una sola fila, `auditoria_log`, en su propio lote. Un lote de puros asientos va a `sincronizar_asiento` (0027); no hizo falta migración |

`comparacion` es `inventario_disponible` o `cantidad_vendida` y dice cuál de
los dos comparar-y-cambiar afectó cero filas. Van los dos valores leídos
siempre: con solo `saldoQueSeLeyo`, un conflicto del paso 6 quedaría con el
dato que no falló.

> ~~**LAS CLAVES NO COINCIDEN CON LAS DE LA ANULACIÓN, y hay que decidirlo.** La
> anulación (§4.45) escribe la misma acción con `saldoLeido`,
> `cantidadVendidaLeida`, `detalle`, `causaTecnica` y `ventaId`. Las dos
> operaciones se escribieron a la vez, sin verse. Ningún código lee estos
> asientos todavía, así que alinearlas no rompe nada; es el punto 23 de §6.2.~~
> **RESUELTO EL 2026-09-15**, con la decisión de Julio: una sola forma y una
> sola puerta. Ver la subsección siguiente.

#### Una sola forma para las dos operaciones, y una sola puerta (2026-09-15)

**Lo que había, leído del código de `develop` (`cd93ee2`) antes de tocarlo:**

| Dato | Venta (`servicio-de-venta.ts:556-571`) | Anulación (`servicio-de-anulacion.ts:678-696`) |
|---|---|---|
| qué comparación falló | `comparacion`: `inventario_disponible` / `cantidad_vendida` | `detalle`: `inventario` / `contadores` |
| saldo leído | `saldoQueSeLeyo` | `saldoLeido` |
| cantidad vendida leída | `cantidadVendidaQueSeLeyo` | `cantidadVendidaLeida` |
| venta | no estaba | `ventaId` |
| causa técnica | no estaba | `causaTecnica` |
| instante | `momento` (repetía la columna `fecha`) | no estaba |
| si el asiento no se podía escribir | el cajero recibía igual el conflicto | **el cajero recibía ese error en lugar del conflicto** (sin `try/catch`) |

Antes de cambiar nada se buscó si ya había asientos escritos, porque
`auditoria_log` es inmutable. En una copia de la base de trabajo real, en solo
lectura, con el sha256 del original igual antes y después (`03ac99ec…`):

```
asientos conflicto_de_inventario: []
en sync_cola: [{"n":0}]
ultima migracion: [{"nombre":"034_superficie_anulacion_de_venta"}]
```

La instalación de Jimmy (`v1.0.0-prueba.1`) no trae ninguna de las dos
operaciones; eso es razonamiento sobre versiones, no se consultó Supabase.

**La forma única**, decidida por Julio: los nombres de la venta y sin `momento`.

| Clave | Valor |
|---|---|
| `operacion` | `'venta'` o `'anulacion'` |
| `ventaId` | La venta que se intentaba anular; **`null` en la venta**, que nunca existió |
| `productoId`, `nombre` | El producto que falló |
| `comparacion` | `inventario_disponible` o `cantidad_vendida`: el NOMBRE DE LA COLUMNA, sin traducir. Las dos operaciones comparan las mismas dos columnas |
| `saldoQueSeLeyo`, `cantidadVendidaQueSeLeyo` | Los dos valores leídos, siempre |
| `causaTecnica` | La misma que lleva el error que recibe el cajero |

**Una sola puerta: `domain/venta/conflicto-de-inventario.ts`.**
`dejarConstanciaDelConflictoDeInventario` escribe en su propia transacción y
su propio lote, arma el valor con `valorDelConflictoDeInventario` y **no lanza
nunca**: si la base falla, lo deja en la bitácora técnica con origen `[venta]`
o `[anulacion]`. Los dos servicios la llaman. `ServicioDeAnulacionDeVenta`
recibe `log`, obligatorio, como la venta. La acción ya no está en
`ACCIONES_DE_VENTA` ni en `ACCIONES_DE_ANULACION`.

**La prueba estructural** (`conflicto-de-inventario-una-sola-puerta.test.ts`)
recorre el árbol sintáctico de `src/main` y `src/shared` y falla nombrando
archivo y línea si la cadena `conflicto_de_inventario`, también dentro de
plantillas o SQL, o la constante `ACCION_CONFLICTO_DE_INVENTARIO` aparece fuera
de la puerta. Tiene sus controles: un comentario no cuenta.

**Falsificado**, una mutación por vez y restaurando:

| Mutación | Qué cae |
|---|---|
| La prueba estructural contra `develop` original (`cd93ee2`) | `servicio-de-anulacion.ts:91 nombra la cadena 'conflicto_de_inventario'` y `servicio-de-venta.ts:89 …` (y las 3 que exigen que la puerta exista) |
| Agregar `conflictoDeInventario: 'conflicto_de_inventario'` a `ACCIONES_DE_ANULACION` | 1: `servicio-de-anulacion.ts:95 nombra la cadena 'conflicto_de_inventario'` |
| Volver la anulación a su escritura original (forma vieja, sin envolver) | 6, entre ellas «dejan asientos con EXACTAMENTE las mismas claves» y la de la falla del asiento con `→ sin espacio en disco (simulado por la prueba)`: ese error le llegaba al cajero |
| Una clave de más (`momento`) en la puerta | 5: las dos de la venta, las dos de la anulación y la de las mismas claves |

**Si el asiento no se puede escribir, el cajero recibe IGUAL el conflicto.** La
falla va a `log-tecnico.log` con origen `[venta]`. Por eso `ServicioDeVenta`
recibe `log`, obligatorio: opcional, un sitio que se olvidara de pasarlo dejaría
esa falla sin rastro. No se espera que pase (haría falta que la base falle justo
después de revertir), pero si pasa no puede cambiar lo que ve el cajero.

**Pruebas, y cómo se falsificaron.** Once en `servicio-de-venta.test.ts` y una
de punta a punta en `integracion-fase-3b.test.ts`, que usa el trabajador y el
proveedor reales y exige que se llame a `['sincronizar_asiento']`. El conflicto
se provoca con el UPDATE real: justo antes del comparar-y-cambiar se mueve el
saldo por la misma conexión, y la sentencia afecta cero filas. Contra el código
anterior fallaban 6 de las 11; pasaban las 5 que fijan lo que ya funcionaba.
Falsificaciones, restaurando el archivo y comprobando su sha256 cada vez:

| Mutación | Pruebas que caen |
|---|---|
| Quitar la escritura del asiento | 7, con `expected [] to have a length of 1 but got +0` y `expected [] to deeply equal [ 'sincronizar_asiento' ]` |
| Escribirlo DENTRO de la transacción, antes de lanzar | 6 (el `ROLLBACK` se lo lleva) |
| Relanzar el envoltorio en vez del error de negocio | 12, entre ellas 2 que ya existían |
| Dejar que la falla del asiento se escape | 1: `expected SqliteError: sin espacio en disco (simula…) to be an instance of ErrorDeNegocio` |

#### Lo que el asiento NO cubre (medido el 2026-09-15)

**El segundo escritor de verdad no llega a este asiento.** El asiento cubre el
comparar-y-cambiar que afecta cero filas: el saldo se movió por la misma
conexión, o se leyó fuera de la transacción. Una segunda conexión real no
produce cero filas. Como la venta abre `BEGIN` a secas y la base está en WAL,
la primera escritura lanza `SQLITE_BUSY_SNAPSHOT`, que no es un error de negocio.
Medido con el servicio real sobre una base migrada y una segunda conexión que
escribe entre la lectura y el UPDATE:

```
[sonda] journal_mode=[{"journal_mode":"wal"}]
[sonda] la OTRA conexión escribió y confirmó: changes=1; base.inTransaction=true
[sonda] +2ms respuesta a la ventana: {"ok":false,"error":{"codigo":"COBRO_FALLIDO","mensaje":"La operación no pudo completarse.","detalle":"database is locked"}}
[sonda] asientos conflicto_de_inventario={"n":0}; filas nuevas en sync_cola=0; saldo={"s":"47.000"}; ventas={"n":0}
```

Y con una sonda mínima (dos conexiones, sin la aplicación), `BEGIN` contra
`BEGIN IMMEDIATE`:

```
[default]   +0ms    A leyó dentro de la transacción: 50.000
[default]   +1ms    B escribió y confirmó (autocommit): changes=1
[default]   +1ms    A comparar-y-cambiar LANZÓ: SQLITE_BUSY_SNAPSHOT database is locked
[immediate] +0ms    A leyó dentro de la transacción: 50.000
[immediate] +1589ms B NO pudo escribir: SQLITE_BUSY database is locked
[immediate] +1590ms A comparar-y-cambiar: changes=1
```

**No se cambió.** Pasar `enTransaccionDeNegocio` a `.immediate()` afecta a las
ocho operaciones de negocio, no solo a la venta. Es una decisión aparte: punto 22
de §6.2. Esto se midió en macOS; Windows no.

### 4.4 Estado del proyecto en Supabase

El esquema espejo **ya está aplicado** contra el proyecto real.

| Dato | Valor |
|---|---|
| Proyecto | `pos-jimmy-cano` |
| Referencia | `zgsdaelmbxufgcsideep` |
| Región | us-east-2 |
| Postgres | 17 |
| Migraciones aplicadas | `20260905143642_esquema_inicial`<br>`20260905171724_fijar_search_path_auditoria_log_es_inmutable`<br>`20260907002143_denominaciones_y_desglose`<br>`20260907002154_pin_remoto`<br>`20260907002212_autorizacion_de_diferencia`<br>`20260907002231_autorizacion_solo_con_diferencia`<br>`20260908121557_categorias_activo`<br>`20260910040514_una_caja_por_sistema`<br>`20260910040526_caja_cerrada_por`<br>`20260911113517_boleta_solo_con_tarjeta`<br>`20260911113531_cantidad_vendida`<br>`20260911145855_configuracion_negocio`<br>`20260911182553_descuento_autorizado_via`<br>`0019_recibido_en`<br>`0020_quitar_estado_sincronizacion`<br>`0021_quitar_hashes_de_pin`<br>`0022_fijar_search_path_auditoria`<br>`0023_funciones_de_sincronizacion`<br>`0024_privilegios_de_tabla`<br>`0025_politicas_de_restauracion`<br>`0026_storage_de_archivos`<br>`0027_sincronizar_asiento`<br>`0028_limites_descuento_id_determinista`<br>`0029_restauracion_ventas_por_mes` |
| Aplicadas el | 2026-09-05 (las dos primeras), 2026-09-06 (las cuatro del corte de caja), 2026-09-08 (`categorias.activo`), 2026-09-09 (las dos de la caja única), 2026-09-11 (las dos del módulo de venta, la de `configuracion_negocio`, la de `descuento_autorizado_via` y las cuatro de la fase 2.a) **2026-09-12 (la `0023` y la `0024`)** y **2026-09-13 (la `0025` y la `0026`, con lo que la fase 2.c queda aplicada entera)** y **2026-09-14 (la `0027`, la `0028` y, después de la 030 local y en ese orden, la `0029`)** |
| Plan | gratuito |

Estado verificado contra el catálogo del proyecto, no contra el script, el
2026-09-11 **después de la fase 2.a**: **13 tablas**, **127 columnas**, RLS
activo en las 13 sin políticas (deniega todo), 49 índices, **50 restricciones
CHECK**, 15 llaves foráneas y **13 triggers**: el viejo
`auditoria_log_prohibir_cambios` más los doce de `recibido_en`. La número 13 es `configuracion_negocio`, que
además sumó sus seis restricciones CHECK propias a las 46 que ya había. Los índices y las llaves foráneas subieron
respecto de lo que decía antes esta sección (24 y 14): los agregaron las
migraciones `0010` y `0012` del corte de caja, y el número no se había
actualizado.
Todas las tablas están en 0 filas **salvo `denominaciones`, que tiene las 11 del
quetzal**, con los mismos UUID que el esquema local — cotejado en la nube con un
`FULL OUTER JOIN` contra la lista local, sin discrepancias.

Ni `sync_cola`, ni `bloqueos_de_autorizacion`, ni `usuarios.intentos_fallidos`
existen allí, como corresponde.

Los dos CHECK del corte de caja quedaron con `convalidated = true`, es decir que
Postgres verificó contra las filas existentes: `caja_sesiones_autorizacion_coherente`
(las dos columnas van juntas) y `caja_sesiones_autorizacion_solo_con_diferencia`
(van si y solo si hay descuadre).

La función `auditoria_log_es_inmutable` tiene `search_path = ''` y es
SECURITY INVOKER, no DEFINER. El linter de seguridad ya no reporta nada sobre
ella.

**LA `0031_productos_precio_compra` Y LA `0032_venta_detalle_costo_unitario_snap` ESTÁN APLICADAS EN `pos-pruebas-descartable` DESDE EL 2026-09-15 A LAS 05:09 UTC, Y NO EN `pos-jimmy-cano`** (§4.39, §4.40). Las aprobó Julio después de ver el SQL; el real espera a que se decida junto con el plan de entrega. **Consecuencia medida en el diseño, no en la tienda:** la instalación de Jimmy (`v1.0.0-prueba.1`, sin la 031 ni la 032) sube a ese proyecto, así que su próximo lote de productos o de venta va a ser rechazado por «le faltan columnas» y su cola se va a detener, visible, hasta que instale una versión con las dos migraciones locales, que reescriben los payloads pendientes; ahí «Reintentar ahora» sube todo. Evidencia en §4.40. Lo que sigue de este párrafo describe el estado ANTERIOR a ellas.

**NO QUEDA NINGUNA MIGRACIÓN PENDIENTE EN `pos-jimmy-cano`: la `0029`
(`restauracion_ventas_por_mes`, fase 4.b, §4.35) se aplicó el 2026-09-14**, con
la aprobación explícita de Julio, después de confirmar la 030 local sobre una
copia de la base de trabajo real y en ese orden, que fue el que él pidió. Es
puramente aditiva —una función `SECURITY INVOKER` de solo lectura y el contrato
que la enumera— y no sube la versión de contrato. Hasta ese momento, restaurar
contra el real se detenía en la precondición de deriva nombrando la función que
faltaba, sin bajar una fila. Evidencia leída del catálogo del real, no del
archivo, inmediatamente después de aplicarla:

| Qué se comprobó | Resultado |
|---|---|
| El registro en `schema_migrations` | `0029_restauracion_ventas_por_mes`, versión `20260914162556`, 24 migraciones en total; `md5` de lo registrado `1b6247a51bfcbac7f69d66aaf863076c`, igual al del archivo del repositorio (sin el salto de línea final) y al del registro del descartable |
| `restauracion_ventas_por_mes` | `prosecdef = false` (INVOKER), `proconfig = {search_path=""}`, `provolatile = s` (STABLE), devuelve `jsonb`, sin argumentos, con su `COMMENT` |
| Su ACL | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`: sin `anon` y sin la entrada de `PUBLIC` |
| `contrato_de_sincronizacion` | INVOKER, `search_path=""`, y su cuerpo nombra `'restauracion_ventas_por_mes'` en la lista `proname IN (...)` |
| `md5(pg_get_functiondef)` de las 16 funciones de `public` | **idéntico en los dos proyectos, función por función** (`restauracion_ventas_por_mes = d13ab547219556be322a7abe0970e731`, `contrato_de_sincronizacion = bfa753900a17ce9c364cd1726f560ddc`); la única que el descartable no tiene es `rls_auto_enable`, preexistente y ajena |
| La salida de `contrato_de_sincronizacion()` con los claims de `restauracion` | `md5 = 525d648ebbbf6a535bf6e46dfed3cc52` **en los dos proyectos**: 13 tablas, 15 funciones, versión de contrato `1` (no subió), y declara la nueva como `security_definer: false` con `search_path=""` |
| La función, con los claims de cada rol (`SET LOCAL ROLE` + `request.jwt.claims`) | `restauracion` → `[]` (cero ventas); `terminal` → `42501 Solo el rol de restauración puede sumar las ventas`; `anon` → `42501 permission denied for function restauracion_ventas_por_mes` |
| Filas de negocio antes y después | 0 en las once tablas; `denominaciones` 11; `configuracion_negocio` 1, con su `actualizado_en = 2026-09-11T14:58:55.89473+00:00` intacto |
| Linter de seguridad | sin ningún aviso nuevo por la 0029 (es INVOKER): sigue en 0 INFO `rls_enabled_no_policy`; los WARN son los de siempre —las seis funciones DEFINER de escritura y `rls_auto_enable`— más `auth_leaked_password_protection`, que es configuración de Auth ajena al esquema (se activa en el panel, si Julio quiere) |
| 13 políticas y 13 tablas con RLS | sin cambios |

Antes de ella, la `0023` y la `0024` se aplicaron el **2026-09-12**, la
`0025` y la `0026` el **2026-09-13**, y la `0027` y la `0028` el
**2026-09-14**, todas con la aprobación explícita de Julio y después de
haberse probado contra `pos-pruebas-descartable`. **Los dos proyectos tienen
hoy las mismas 24**, y los cuatro CHECK de `limites_descuento` tienen el mismo
`md5(pg_get_constraintdef)` en los dos (§4.29 y §4.32). La foto
`supabase/esquema-nube.json` declara las 15 funciones del contrato, que es lo
que las dos nubes declaran ahora.

De los dos pasos manuales que la fase 2.c necesitaba, **uno está hecho y
verificado, y el otro está hecho pero NO verificado desde acá**:

1. **`app_metadata.rol = 'restauracion'`: HECHO el 2026-09-13.** Julio creó su
   usuario en el panel (`julioes134@outlook.es`, confirmado) y la marca se puso
   por SQL sobre `auth.users`, **sumando** la clave sin borrar las que GoTrue ya
   había puesto. Verificado leyendo la fila y, sobre todo, ejercitando las
   políticas con los claims armados **desde el `app_metadata` real de la fila**:
   ve las 11 denominaciones y la única fila de `configuracion_negocio`, y 0 en
   las once tablas que están vacías. Ver §4.21.
2. **JWT de 900 s: HECHO y MEDIDO el 2026-09-13.** La configuración de Auth
   **no vive en la base** —se listaron las 23 tablas del esquema `auth` y no hay
   ninguna de configuración— y el conector tampoco la expone, así que la única
   forma de leerla es acuñar un token, lo que exige la contraseña. La midió
   Julio con el comando preparado en esta sesión y pegó la salida:

   ```
   expires_in       = 900 s
   exp - iat        = 900 s
   app_metadata.rol = restauracion
   is_anonymous     = false
   ```

   Es medición, no afirmación, aunque la ejecutó Julio y no esta sesión: el
   token lo acuñó el proyecto real y los cuatro valores salen de su carga útil.
   **Y cierra de paso el último eslabón** que estaba razonado y no medido: que
   GoTrue copie `raw_app_meta_data` al claim `app_metadata` del JWT. Las tres
   condiciones que las políticas exigen —rol, no anónimo y token vivo— están las
   tres confirmadas en un token real del proyecto real.

Evidencia de esa aplicación, leída del catálogo del real y no del archivo:

| Qué se comprobó | Resultado |
|---|---|
| Definiciones de función idénticas a las del proyecto de pruebas (`md5(pg_get_functiondef)`) | **13 de 13** |
| md5 del registro de la `0023` frente al archivo del repositorio | `a77ae68229c1fdc8245e139916e5b943`, igual |
| md5 del registro de la `0024` frente al archivo | `5286ab2a46775abc49030f6ec54e1c3c`, igual |
| Dueño de las 13 tablas y de las 5 funciones DEFINER (`relowner` / `proowner`) | `postgres` las dos; **dueños distintos: 1** |
| `has_table_privilege('authenticated', …, 'MAINTAIN')` en alguna de las 13 | `false` |
| Privilegios de tabla de `authenticated` / de `anon` | `SELECT` / ninguno |
| Huella del contrato contra `supabase/esquema-nube.json` y contra el proyecto de pruebas | `81b685b17f47750bb6c56812ae89c99e` en los tres |
| Filas de negocio antes y después | 0 en las ocho tablas; `denominaciones` con sus 11 |

Las últimas aplicadas en el real fueron las **cuatro de la fase 2.a de la sincronización**, el
2026-09-11: `0019_recibido_en`, `0020_quitar_estado_sincronizacion`,
`0021_quitar_hashes_de_pin` y `0022_fijar_search_path_auditoria`. Son las
primeras migraciones del proyecto que **solo existen del lado de la nube**, y
las primeras que **quitan** columnas. Ver §4.19.

Se aplicaron por una vía más estricta que de costumbre: **primero contra
`pos-pruebas-descartable`**, un proyecto creado ese día justamente para eso
(§9.5 del diseño), después el SQL completo a la vista, y recién con la
aprobación explícita de Julio contra el real.

Antes de ellas, la `0017_descuento_autorizado_via`, también el 2026-09-11, por
la vía de siempre.

- `ventas` pasó de 15 a **16 columnas**. `descuento_autorizado_via` quedó `text`
  nulable, sin `DEFAULT`, con su `COMMENT`, leído de `information_schema.columns`.
  Nulable es lo correcto: la mayoría de las ventas no lleva autorización.
- El CHECK `ventas_autorizacion_de_descuento_coherente` quedó con
  `convalidated = true`, leído de `pg_get_constraintdef`, y **con los `IS NOT
  NULL` adelante**, que es lo que lo hace morder en las dos direcciones.
  Convive con los cuatro CHECK que `ventas` ya tenía —`descuento_completo`,
  `autorizacion_requiere_descuento`, `boleta_solo_con_tarjeta` y los de valores
  enumerados—, los ocho validados.
- **La lógica de tres valores quedó medida EN EL POSTGRES REAL**, evaluando las
  dos formas del CHECK sobre los mismos seis casos sin escribir ninguna fila.
  Con «autorizante sin vía», la forma de la 0007 devuelve `NULL` —y un CHECK
  deja pasar el NULL— mientras que la forma aplicada devuelve `false`. Cierra la
  mitad de esa comprobación que hasta ahora solo estaba medida en SQLite.
- `idx_ventas_descuento_autorizado` quedó como índice parcial sobre
  `descuento_autorizado_por`, leído de `pg_indexes`.
- Las tablas siguen siendo **13**, con RLS activo y **cero políticas**. `ventas`,
  `venta_detalle` y `productos` siguen en 0 filas; `denominaciones`, con sus 11.

Antes de ella se aplicó `0016_configuracion_negocio`, el mismo día y por la
misma vía.

- Las **seis columnas** quedaron como manda el espejo, leídas de
  `information_schema.columns`: `id` TEXT `NOT NULL`, las cuatro del negocio
  TEXT **nulables** y `actualizado_en` TIMESTAMPTZ `NOT NULL`. Ninguna tiene
  `DEFAULT`, ni hace falta: la fila la siembra la propia migración.
- Las **seis restricciones**, leídas de `pg_get_constraintdef`, están las seis
  con `convalidated = true`: `configuracion_negocio_pkey` sobre `id`,
  `configuracion_negocio_id_check` con `CHECK ((id = 'unica'::text))` y los
  cuatro `IS NULL OR btrim(...) <> ''` que impiden la cadena vacía. La llave
  primaria más el CHECK de la constante son las dos mitades de «una sola fila».
- **RLS activo y CERO políticas**, leído de `pg_class.relrowsecurity` y
  `pg_policies`: la llave anónima no puede leer ni escribir. `relforcerowsecurity`
  va en `false`, igual que en las otras doce.
- **La fila única está sembrada y vacía**: una sola fila, `id = 'unica'`, los
  cuatro campos del negocio en `NULL` y `actualizado_en` con la hora de la
  aplicación. Es el estado correcto: los datos de Jimmy todavía no llegaron y el
  recibo imprime marcadores entre corchetes hasta que lleguen.
- El `COMMENT` de la tabla quedó puesto y se lee con `obj_description`.

El linter de seguridad pasó de 12 avisos `rls_enabled_no_policy` a **13**, que
es el resultado buscado y no un problema. Los dos `WARN` que reporta siguen
siendo los de `public.rls_auto_enable()`, preexistentes del proyecto y ajenos a
este esquema.

Antes de ella se aplicaron `0014_boleta_solo_con_tarjeta` y
`0015_cantidad_vendida`, el mismo día y por la misma vía.

- `ventas_boleta_solo_con_tarjeta` existe con `convalidated = true`, leído de
  `pg_get_constraintdef`, y convive con los dos CHECK del descuento que ya venían
  de la `0001`: `ventas_descuento_completo` y
  `ventas_autorizacion_requiere_descuento`. Los tres validados.
- `productos.cantidad_vendida` quedó `numeric(14,3) NOT NULL DEFAULT 0` con
  `CHECK (cantidad_vendida >= 0)` y su `COMMENT`, leído de
  `information_schema.columns` y `pg_constraint`.
- `ventas`, `venta_detalle` y `productos` siguen en 0 filas; `denominaciones`
  sigue con sus 11.

Antes de ellas se aplicaron `0010_una_caja_por_sistema` y
`0012_caja_cerrada_por`, el 2026-09-09: `idx_caja_sesiones_una_abierta` pasó a
`(estado) WHERE estado = 'abierta'` y `cerrada_por` quedó como `uuid` nulable
con `ON DELETE SET NULL` hacia `usuarios`, verificado contra `pg_indexes`,
`information_schema` y `pg_constraint`.

Las migraciones locales 002 (bloqueo por intentos), 003 (candado por superficie)
y 006, 011 y 013 (que solo amplían el CHECK de superficies de esa misma tabla),
más la 018 (que amplía `sync_cola`, la lista local de qué falta subir),
**no tienen espejo a propósito**: son estado operativo de una terminal, no datos
de negocio. Ver `supabase/migrations/README.md` y la fila correspondiente del
registro de decisiones.

#### Las dos migraciones eliminadas NO son el mismo caso

Hoy toman la misma decisión, pero por razones distintas y con horizontes
distintos. Confundirlas llevaría a la sesión futura a la conclusión equivocada.

| | `bloqueos_de_autorizacion` | `usuarios.intentos_fallidos` / `bloqueado_hasta` |
|---|---|---|
| Naturaleza | Estado **POR SUPERFICIE** | Estado **POR IDENTIDAD** |
| A quién pertenece | Al diálogo de salida **de una terminal concreta** | A **una persona**, no a una máquina |
| ¿Sincronizar algún día? | **NUNCA, bajo ningún diseño futuro** | **Sí, probablemente hará falta** |

**`bloqueos_de_autorizacion`: nunca se sincroniza.** No es una limitación
técnica que algún día se resuelva: es lo correcto por definición. El candado
protege *ese* diálogo en *esa* máquina. Sincronizarlo haría que un error de
tecleo en la caja A bloqueara la caja B, que es **exactamente la negación de
servicio entre terminales que la separación de candados (sección 4.8) existe
para evitar**. Si una sesión futura lo agrega al motor de sincronización, está
reintroduciendo el defecto.

**`usuarios.intentos_fallidos` / `bloqueado_hasta`: hoy no, pero es temporal.**
El estado pertenece a la persona, no a la terminal. Hoy no se sincroniza porque
la sincronización es diferida y no resolvería el problema de fondo: un bloqueo
que llega minutos tarde ya no protege de nada. **Eso es una limitación de la
arquitectura actual de una sola terminal, no un principio permanente.**

> **PENDIENTE PARA EL MÓDULO DE MULTI-SUCURSAL.** Cuando haya más de una caja,
> el bloqueo por intentos de un usuario va a necesitar **una fuente de verdad
> centralizada o sincronización en tiempo real** entre terminales. Sin eso, el
> presupuesto para adivinar el PIN de una persona **se multiplica por el número
> de cajas**: con tres terminales, tres intentos cada 30 segundos pasan a ser
> nueve, y el ataque se vuelve tres veces más rápido contra el mismo PIN de
> cuatro dígitos. No es un detalle de implementación: hay que resolverlo en el
> diseño del módulo, no después. Ver también el punto 10 de la sección 6.2.

Estado de la fase 2.c en la nube — **CERRADA el 2026-09-13, en los dos
proyectos y con los dos pasos manuales del panel hechos y medidos**:

- Las **políticas de RLS** y los **buckets de Storage**, migraciones `0025` y
  `0026`, **aplicadas en `pos-pruebas-descartable` y en `pos-jimmy-cano` el
  2026-09-13**, con la aprobación explícita de Julio. La sincronización NO usa
  una llave de servicio: usa un usuario de Auth con rol `terminal` (§1.2 del
  diseño), y la terminal **no tiene política directa sobre ninguna tabla**;
  escribe únicamente por las funciones de la `0023`. Lo único que las políticas
  conceden es `SELECT` al rol `restauracion`. Ver §4.21.
  - **Los 13 avisos INFO `rls_enabled_no_policy` desaparecieron**, que era la
    señal buscada. Medido en los dos: el de pruebas pasó de 13 INFO + 5 WARN a
    **0 INFO + 5 WARN**, y el real de 13 INFO + 7 WARN a **0 INFO + 7 WARN**.
  - **Los dos pasos del panel están hechos y medidos**, no dados por buenos:
    `app_metadata.rol = 'restauracion'` en el usuario de Julio (§4.21) y el JWT
    en 900 s (§4.22).
- **HECHO el 2026-09-12: la `0023` y la `0024` ya están aplicadas en el real.**
  La terminal no tiene privilegio de tabla para escribir nada (`anon` sin
  ninguno, `authenticated` solo con `SELECT`, `MAINTAIN` incluido en la
  revocación) y su único camino de escritura es `EXECUTE` sobre las cinco
  funciones DEFINER. El linter sumó, como estaba previsto y medido en el
  proyecto de pruebas, **cinco avisos WARN
  `authenticated_security_definer_function_executable`**, uno por función de
  escritura, y ninguno de `search_path`. **Son esperados y no se corrigen**:
  esas funciones son la única puerta de escritura de la terminal.
- **HECHO el 2026-09-13: la `0025` y la `0026` también están aplicadas en el
  real.** Las trece tablas tienen su política de lectura para `restauracion` y
  ninguna para la terminal; los dos buckets existen, privados. **El linter dejó
  de reportar los 13 avisos INFO `rls_enabled_no_policy`**, que era la señal
  buscada: pasó de 13 INFO + 7 WARN a **0 INFO + 7 WARN**, y los siete son los
  cinco de las funciones DEFINER más los dos preexistentes de `rls_auto_enable`.
- **Quedan DOS pasos manuales del panel, y ninguno es opcional**: marcar el
  usuario de Julio con `app_metadata.rol = 'restauracion'` y bajar el JWT a
  900 s. Sin el primero, las políticas de la `0025` no le sirven a nadie: hoy el
  real tiene cero usuarios de Auth. Ver §4.21 y §4.20.

**No tocar** la función `public.rls_auto_enable()` ni su disparador de eventos
`ensure_rls`: son preexistentes del proyecto y ajenos a este esquema. Tienen dos
advertencias de seguridad propias (`SECURITY DEFINER` ejecutable por los roles
`anon` y `authenticated` vía RPC) que le corresponde revisar a Julio.

### 4.5 REGLA DE DISEÑO DEL MODO KIOSKO (leer antes de tocar la ventana)

Esta sección existe porque el proyecto ya cometió este error una vez y encerró
a Julio fuera de su propia Mac. No es un arreglo puntual: es la regla.

#### La regla, en una frase

> El modo kiosko de esta aplicación puede suprimir **conveniencias de la propia
> aplicación**. Jamás puede tocar los **mecanismos de escape del sistema
> operativo**.

| Se PUEDE suprimir (app) | JAMÁS se toca (sistema operativo) |
|---|---|
| Barra de título y marco de la ventana | **Forzar Salida** (`Cmd+Option+Esc` en macOS) |
| Menú de la aplicación | **Cambio de aplicación** (`Cmd+Tab`) |
| Menú contextual del clic derecho | **Administrador de tareas** (`Ctrl+Shift+Esc` en Windows) |
| Zoom con Ctrl+rueda y con teclado | **`Ctrl+Alt+Supr`** en Windows |
| Recarga y herramientas de desarrollo | Apagar o cerrar sesión del sistema |

Esto es una terminal de punto de venta, no un kiosco público donde alguien deba
quedar físicamente encerrado sin salida. Si la aplicación se cuelga, el dueño
tiene que poder matarla desde el sistema operativo.

#### PROHIBIDO: `kiosk: true` de Electron

En macOS, `kiosk: true` no se limita a poner la ventana en pantalla completa:
le impone al sistema operativo un juego de **Presentation Options** que apaga
funciones del propio sistema. Medido sobre este proyecto con
`npm run diagnostico:kiosko-macos`:

```
kiosk: true   ->  currentSystemPresentationOptions = 506
                  hideDock, hideMenuBar, disableAppleMenu,
                  disableProcessSwitching     <- MATA Cmd+Tab
                  disableForceQuit            <- MATA Cmd+Option+Esc
                  disableSessionTermination, disableHideApplication

sin kiosk     ->  currentSystemPresentationOptions = 0
                  ...y la ventana sigue en pantalla completa igual.
```

La pantalla completa sin marco se consigue con `fullscreen: true` y
`frame: false`, que no tocan nada del sistema. **No agregar `kiosk` nunca**, ni
siquiera "solo en producción" ni "solo en Windows".

**Precisión sobre Windows, para no exagerar el alcance del arreglo:** la opción
era **una sola línea sin ramas por plataforma** (verificado en el historial:
`main-window.ts` nunca tuvo un `process.platform`), así que quitarla la quitó
para los dos sistemas. Pero el daño **no era simétrico**. macOS es el caso
excepcional porque ofrece `NSApplicationPresentationOptions`, una API con la que
una aplicación común puede apagar Forzar Salida y el cambio de aplicación.
Windows no tiene equivalente: `Ctrl+Alt+Supr` lo atiende winlogon y ninguna
aplicación lo intercepta, y `Ctrl+Shift+Esc` solo se puede deshabilitar por
directiva de grupo o registro, no con una opción de ventana. En Windows,
`kiosk: true` se traduce esencialmente a pantalla completa. Es decir: en Windows
el Administrador de tareas **nunca estuvo bloqueado**, y la regla vale igual
—porque impide que alguien la reintroduzca creyendo que es inocua—, pero no hay
que contarla como un bloqueo que se haya prevenido allí.

Esto es razonamiento sobre las APIs de cada sistema, no una medición: la sonda
de Presentation Options solo existe en macOS y no hay una máquina Windows para
comprobarlo. El detalle investigado, con fuentes, está en la sección 4.6.

Cómo volver a comprobarlo en cualquier momento:

```bash
npm run diagnostico:kiosko-macos
```

Abre una ventana con cada configuración y mide el estado real del sistema con
una sonda en Swift (`scripts/sonda-presentacion-macos.swift`). La mitad que usa
`kiosk` deshabilita Forzar Salida durante unos dos segundos y se cierra sola.

#### Ninguna vía cierra la aplicación sin PIN

El reverso de la regla: interceptar el cierre de la APLICACIÓN sí es legítimo, y
es obligatorio. **Cualquier atajo que macOS o Windows reconozcan como "salir"
debe redirigirse al mismo flujo de PIN**, nunca cerrar directo.

| Vía | Qué hace ahora |
|---|---|
| `Ctrl+Shift+Alt+Q` (atajo del administrador) | Pide PIN |
| **`Cmd+Q`** (macOS) | Interceptado en `app.on('before-quit')` → pide PIN |
| **`Alt+F4`** / botón de cerrar (Windows) | Interceptado en `ventana.on('close')` → pide PIN |
| Menú del Dock → Salir | Interceptado en `before-quit` → pide PIN |
| Botón de la barra de estado | Pide PIN (mismo canal, mismo diálogo) |
| `app.quit()` de terceros | Interceptado → pide PIN |

Antes de esto, `Cmd+Q` cerraba el punto de venta de inmediato: sin PIN, sin
registro de auditoría y sin consolidar la base de datos. Era una puerta trasera
al alcance de cualquier cajero.

**Escape deliberado:** si la ventana ya fue destruida o el renderer se cayó, el
cierre se permite sin PIN. No hay dónde mostrar el diálogo, y dejar el proceso
vivo sin interfaz obligaría a matarlo desde el sistema operativo.

**Al agregar una pantalla nueva no hay que hacer nada especial**: la
intercepción vive en el proceso principal, no en la interfaz, así que aplica a
todas las pantallas por igual. Lo que sí hay que respetar es no crear ningún
botón, menú o atajo que llame a `app.quit()` o cierre la ventana por su cuenta.

#### El botón de salida visible: dónde va y por qué

Hay **un solo** control visible que puede cerrar el sistema, en la barra de
estado (`src/renderer/src/components/BarraDeEstado.tsx`), **esquina inferior
izquierda**. Razones, para cuando se construya la pantalla de ventas real:

1. **La barra de estado es cromo de la aplicación**, no parte del flujo de
   venta: el cajero trabaja mirando el centro de la pantalla.
2. **Esquina izquierda**, lo más lejos posible del botón de cobrar, que por
   convención de punto de venta va abajo a la derecha. Reduce el toque
   accidental en una pantalla táctil.
3. **Presente en todas las pantallas**, no escondido en un menú: es una salida
   de emergencia y un administrador tiene que poder llegar sin navegar.
4. **Ícono discreto sin texto "Cerrar"**, con etiqueta accesible. No invita a
   que lo prueben.
5. **No cierra nada por su cuenta**: le pide al proceso principal que inicie la
   salida, que responde con el mismo diálogo que el atajo. Una sola vía
   auditable, no dos caminos paralelos.

La barrera real sigue siendo el PIN; la ubicación solo evita el accidente.

### 4.6 Qué se puede bloquear en cada plataforma, y qué jamás

Investigado en el Prompt 9 a raíz del incidente del modo kiosko. Es la
referencia para no volver a asumir que las dos plataformas se comportan igual.

| Mecanismo de escape | macOS | Windows |
|---|---|---|
| Forzar Salida (`Cmd+Option+Esc`) | **Una app SÍ puede apagarlo** con `NSApplicationPresentationOptions` (`disableForceQuit`). Es lo que hacía `kiosk: true`. **Prohibido en este proyecto.** | No aplica |
| Cambio de aplicación (`Cmd+Tab` / `Alt+Tab`) | **Una app SÍ puede apagarlo** (`disableProcessSwitching`). **Prohibido.** | Una app común no puede apagarlo de forma fiable. El modo kiosko de Electron **no lo apaga**. |
| `Ctrl+Alt+Supr` | No aplica | **Imposible para cualquier app de usuario.** Ver abajo. |
| `Ctrl+Shift+Esc` (Administrador de tareas) | No aplica | **No se puede bloquear de forma fiable** desde una app común. Solo con funciones administrativas del sistema, que este proyecto tiene prohibido usar. |

#### Ctrl+Alt+Supr: confirmado, ninguna aplicación puede interceptarlo

El entendimiento de Julio es **correcto**. Windows lo protege con la Secure
Attention Sequence: el subsistema Win32k abre canales exclusivos con los
dispositivos de entrada **antes** de que arranque cualquier aplicación, de modo
que ningún programa puede vigilar ni interceptar la combinación; el propio
núcleo detecta la secuencia y suspende los programas antes de iniciar el
procesamiento de inicio de sesión confiable. Ni siquiera un gancho de teclado
de bajo nivel (`WH_KEYBOARD_LL`) la ve. El diseño existe justamente para que un
programa no pueda falsificar la pantalla de inicio de sesión.

#### Ctrl+Shift+Esc: tampoco, y esto es lo que hay que vigilar

`WH_KEYBOARD_LL` puede tragarse muchas combinaciones del sistema, pero el
Administrador de tareas es de las que **no se bloquean de forma fiable** por esa
vía. Para un bloqueo real haría falta una función administrativa del sistema
operativo: directiva de grupo (*Remove Task Manager*), la clave de registro
`DisableTaskMgr`, o el modo kiosco soportado de Windows (*Assigned Access* /
*Shell Launcher*).

**REGLA: este proyecto tiene prohibido usar cualquiera de esas vías.** El
riesgo en Windows no es Electron —el modo kiosko de Electron ni siquiera apaga
las teclas del sistema, y hay reportes de que tampoco impide que el
Administrador de tareas se ponga delante—. El riesgo es que una sesión futura
intente "mejorar" el kiosko con una directiva de grupo o con Assigned Access y
deje al dueño de la tienda encerrado fuera de su propia computadora. Vale la
misma regla de la sección 4.5: se suprimen conveniencias de la aplicación,
nunca mecanismos de escape del sistema.

#### Fuentes

- [Secure attention key — Wikipedia](https://en.wikipedia.org/wiki/Secure_attention_key)
- [PWLX_USE_CTRL_ALT_DEL callback (winwlx.h) — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winwlx/nc-winwlx-pwlx_use_ctrl_alt_del)
- [Kiosk mode with multiple monitors — electron/electron#2272](https://github.com/electron/electron/issues/2272)
- [Kiosk mode con teclas deshabilitadas — electron/electron#7597](https://github.com/electron/electron/issues/7597)
- [Task Manager (Windows) — Wikipedia](https://en.wikipedia.org/wiki/Task_Manager_(Windows))

### 4.7 Usuarios, sesión y permisos

#### El PIN

- **Exactamente 4 dígitos.** La defensa no es el largo sino el bloqueo por
  intentos: tres fallos y 30 segundos de espera hacen inviable recorrer los
  10 000 valores posibles.
- **Se guarda con scrypt**, nunca en claro y nunca con SHA-256. Formato del
  campo `pin_hash`, documentado en `src/shared/auth.ts`:

  ```
  scrypt$1$16384$8$1$<sal-base64>$<clave-base64>
  └────┘ │ └───┘ │ │ └──────────┘ └────────────┘
  algo   │  N    r p     sal          clave
         └ versión del formato
  ```

- **Sal aleatoria distinta por usuario.** Dos personas con el mismo PIN tienen
  hashes distintos, así que nadie deduce mirando la tabla que lo comparten.
- **Comparación en tiempo constante** con `timingSafeEqual`.
- **`src/shared/auth.ts` NO puede importarse desde el renderer** (usa
  `node:crypto`). Hay una regla de ESLint y una exclusión en `tsconfig.web.json`
  que lo impiden. La interfaz manda el PIN por IPC; nunca verifica nada.
  Para el formato del PIN, el renderer usa `src/shared/pin.ts`, que es puro.

#### Bloqueo por intentos

Hay **dos candados separados**, uno por superficie de uso; el detalle y la
razón están en la sección 4.8. El del ingreso es **por usuario y persistido**:
`usuarios.intentos_fallidos` y `usuarios.bloqueado_hasta`. Se persiste a
propósito: si viviera en memoria, bastaría con reiniciar la aplicación para
reiniciar el contador y seguir adivinando.

- Solo cuenta como intento un PIN **con formato válido pero equivocado**.
- Al tercer fallo, bloqueo de 30 segundos. Un ingreso correcto reinicia todo.
- Un usuario bloqueado no entra **aunque acierte el PIN**.
- **Nunca se informan los intentos restantes**, solo cuánto falta para
  reintentar: los intentos restantes son información útil para quien adivina y
  para quien mira la pantalla de otro.

#### Primer arranque

Si la tabla `usuarios` está **completamente vacía**, la única pantalla
accesible es la de configuración inicial, que obliga a crear el primer
administrador con su nombre y un PIN elegido en ese momento. **No hay ningún
PIN por defecto en el código**, ni siquiera "temporal". El canal
`sesion:crear-primer-administrador` vuelve a comprobar que la instalación esté
vacía: sin esa condición sería una puerta para crearse un administrador desde
la interfaz en cualquier momento.

#### Gestión de usuarios: el hueco que el primer arranque dejaba abierto

**ESTE HUECO EXISTIÓ DESDE EL PROMPT 3 Y SE CERRÓ EN EL PROMPT 21.** Durante
todo ese tiempo el sistema sabía crear **un** usuario: el primer administrador,
en el primer arranque, y **solo mientras la tabla estuviera completamente
vacía**. Después de eso no había ninguna forma de agregar a nadie. El
requerimiento pedía desde el principio «usuario de venta y usuario
administrativo», así que la tienda no podía siquiera dar de alta a su cajero:
el sistema no estaba completo con un solo usuario creado el primer día.

Lo cierra `ServicioDeUsuarios`, con su pantalla en `PantallaDeUsuarios`. Cuatro
operaciones: crear, editar nombre y rol, cambiar el PIN y dar de baja o
reactivar.

**EL HASH NO SE REIMPLEMENTA.** Se usa `@shared/auth`, el mismo módulo scrypt
del primer arranque y del ingreso. Dos implementaciones de hash en el mismo
proyecto es la forma más segura de terminar con usuarios que no pueden entrar
porque su PIN se guardó con el otro formato.

**CAMBIAR EL PIN ES UNA ACCIÓN APARTE**, con su propio canal, su propio diálogo
y su propio nombre en la auditoría. No es un campo más del formulario de
edición: es información sensible, y mezclarlo invitaría a tocarlo sin querer al
corregir un acento en el nombre.

**NO SE PIDE EL PIN ANTERIOR**, y es deliberado: el caso que hay que resolver es
justamente el del cajero que lo olvidó. Exigir el viejo dejaría a esa persona
sin forma de volver a entrar, que es el problema que la operación existe para
arreglar. Quien la ejecuta ya es un administrador con sesión iniciada, y eso es
lo que la autoriza. **El PIN nuevo no se registra en la auditoría**, ni en claro
ni hasheado; lo que queda es el hecho: a quién se le cambió, quién lo cambió y
cuándo.

**NUNCA SE BORRA UN USUARIO**, igual que con productos y categorías. Se da de
baja: deja de aparecer en la pantalla de ingreso y no entra aunque acierte el
PIN, pero **sus ventas y sus asientos de auditoría quedan intactos**, porque son
el historial de la tienda y no le pertenecen a la cuenta. Reactivar además
**limpia el bloqueo por intentos**: volver a habilitar a alguien con el candado
todavía puesto lo dejaría afuera por una razón que ya nadie recuerda.

##### Tres invariantes que solo este servicio puede proteger

| Invariante | Por qué no puede vivir en otro lado |
|---|---|
| **Siempre queda un administrador activo** | El esquema no sabe contar administradores. Y si se pierde el último, la tienda se queda sin poder abrir caja, cargar catálogo ni gestionar usuarios, **sin vuelta atrás**: el primer arranque solo se ofrece con la tabla VACÍA, y dar de baja no la vacía. Se bloquea tanto la baja como quitarle el rol. |
| **Nadie se cambia a sí mismo el rol ni se da de baja** | Es un pie en el que dispararse sin uso legítimo: quien quiera irse lo da de baja otro administrador. Además dejaría la sesión viva con una identidad que ya no corresponde a lo que dice la base. Corregirse el PROPIO nombre sí se permite: no tiene ningún riesgo. |
| **Dos usuarios ACTIVOS no comparten PIN** | Ver abajo. La base no puede verlo: cada hash lleva su propia sal, así que dos PIN iguales se guardan distintos, que es justamente lo que impide deducirlos mirando la tabla. |

##### Por qué dos usuarios no pueden compartir PIN

**El daño no está donde parece.** En el ingreso la colisión es molesta pero
acotada: primero se elige el nombre y después se teclea, así que compartir PIN
solo significa que una persona puede entrar como otra si sabe que lo comparten.

**El problema serio está en el DIÁLOGO DE AUTORIZACIÓN**, que prueba el PIN
contra todos los administradores activos y se queda con el primero que coincida
(§4.9). Con dos PIN iguales, `descuento_autorizado_por` y
`diferencia_autorizada_por` terminan nombrando a la persona equivocada, en
silencio y sin forma de detectarlo después. En un sistema cuyo valor es la
auditoría, eso es peor que la suplantación. La §4.9 ya anticipaba el caso al
hablar de «una coincidencia improbable»; ahora, sencillamente, no puede ocurrir.

| Decisión | Por qué |
|---|---|
| **Una sola regla para los DOS roles** | El riesgo está concentrado en el administrativo, pero un usuario de venta pasa a administrativo con una edición: una excepción por rol envejecería mal en cuanto alguien cambie de rol, y es más barato mantener una regla general que dos casos. |
| **Solo cuentan los ACTIVOS** | Quien está de baja no inicia sesión ni autoriza nada, así que su PIN no provoca ninguna de las dos confusiones. Reservar para siempre todos los PIN históricos iría achicando el espacio disponible sin que nadie entienda por qué. |
| **Se compara el PIN en claro contra cada hash** | Dos hash scrypt del mismo PIN son distintos, porque cada usuario tiene su propia sal. Obliga a una verificación por usuario activo, y scrypt es lento a propósito: con una decena de usuarios, cerca de un segundo. Es aceptable al crear un usuario, que es una acción de administrador, y sería inaceptable en el ingreso. |
| **También se mira el PIN REMOTO de cada uno** | El diálogo de autorización prueba los dos, así que un PIN nuevo igual al remoto de alguien produce la misma atribución equivocada. |
| **Ponerle a alguien el PIN que ya tenía NO es colisión** | No cambia nada, y rechazarlo sería desconcertante. Se excluye a la propia persona de la comparación. |

> **EL MENSAJE NO DICE DE QUIÉN ES EL PIN, ni lo insinúa, y la causa técnica
> tampoco lleva el id.** Dice exactamente «Ese PIN ya está en uso. Elegí otro.»
> Nombrar a la persona convertiría este control en una forma de averiguar el PIN
> de otra por eliminación: bastaría probar combinaciones al crear usuarios y
> leer a quién nombra el rechazo. Hay una prueba que comprueba que ni el mensaje
> ni la causa técnica contienen ningún nombre ni ningún id.

**LA REGLA SE APLICA EN LAS TRES PUERTAS**, y es literalmente la misma función
en las tres: `exigirPinNoUsado`, en `src/main/domain/usuarios/colision-de-pin.ts`.

| Puerta | Qué comprueba |
|---|---|
| Crear un usuario | Que el PIN elegido no sea el de ningún otro usuario activo. |
| Cambiarle el PIN a alguien | Lo mismo, excluyendo a esa persona. |
| Configurar un PIN remoto | Lo mismo, excluyendo a esa persona, **además** de la regla vieja de que no sea igual a su propio PIN normal. |

**Vive en su propio módulo y no dentro de un servicio** porque la necesitan dos:
el de gestión de usuarios y el de autenticación. Escribirla dos veces sería
garantizar que un día se apliquen criterios distintos en cada puerta, y la
colisión entraría por la que quedó floja.

> **SUPERADO EL 2026-09-15 (§4.47):** el PIN remoto fijo ya no existe; la
> autorización remota es un código TOTP con un secreto que nadie elige. La fila
> «También se mira el PIN REMOTO», la puerta «Configurar un PIN remoto» y el
> párrafo siguiente describen el estado anterior. Para el PIN normal, la regla
> de colisión sigue exactamente igual.

Las dos comprobaciones del PIN remoto **no son la misma y las dos hacen falta**.
La vieja mira el PIN normal de uno mismo, y lo que protege es no regalar el
acceso a la propia sesión al dictar el código por teléfono; conserva su propio
mensaje, que explica eso. La nueva mira a todos los demás, y lo que protege es
la ATRIBUCIÓN en la auditoría.

La pantalla esconde esos botones y explica por qué en el `title`, pero eso es
comodidad: quien de verdad rechaza es el servicio, y una pantalla se salta
llamando al canal.

##### El guard de rol, también acá

Los cinco canales de `src/main/ipc/usuarios.ts` van envueltos en
`requiereRol(sesion, 'administrativo', …)`. Hay una prueba que **cuenta** los
`ipcMain.handle` del archivo y exige que haya tantos guards como canales: el
riesgo real no es que el guard esté mal escrito, es que alguien agregue un sexto
canal el año que viene y se olvide de envolverlo.

**El DTO que cruza a la ventana no lleva `pin_hash` ni `pin_remoto_hash`.** El
hash no le sirve de nada a la interfaz, y exponerlo pondría al alcance de un
renderer comprometido el material con el que atacar los PIN fuera de línea. Lo
que sí viaja es si el PIN remoto está configurado, que es un sí o un no.

#### Sesión

Vive **en memoria del proceso principal** (`SesionActual`) y **no se
persiste**. Esta es una terminal compartida: si la sesión sobreviviera al
reinicio, el primero que encienda la computadora por la mañana quedaría
actuando con la identidad de quien la apagó anoche, y la auditoría atribuiría
sus ventas a otra persona.

#### CÓMO USAR EL GUARD DE PERMISOS EN UN MÓDULO FUTURO

Se envuelve la operación del manejador IPC. **Nunca** se comprueba el rol a
mano dentro de la operación: así la comprobación es imposible de olvidar y de
escribir distinto en cada módulo.

```ts
import { requiereRol } from '@main/domain/usuarios/sesion';

ipcMain.handle(CANALES_IPC.cajaAbrir, async (_evento, payload) =>
  ejecutarConRespuesta('CAJA_APERTURA_FALLIDA', () =>
    requiereRol(dependencias.sesion, 'administrativo', () => {
      const datos = esquemaAperturaDeCaja.parse(payload);
      return servicioDeCaja.abrir(datos);
    }),
  ),
);
```

Si el usuario en sesión no cumple, lanza `ErrorDeNegocio` con código
`PERMISO_DENEGADO`, la operación **no se ejecuta**, y el mensaje llega a la
interfaz ya traducido. Nunca falla en silencio ni deja pasar la acción.
`requiereSesion(sesion, operacion)` es la variante que solo exige que haya
alguien autenticado, sin importar el rol.

### 4.8 Dos candados separados: ingreso y autorización

El sistema tiene **dos superficies distintas** donde alguien teclea un PIN, y
**cada una tiene su propio candado**. No comparten contador.

| | Ingreso a la aplicación | Diálogo de autorización |
|---|---|---|
| Dónde | Pantalla de ingreso | Salida controlada, cierre con diferencia y cierre de caja ajena |
| Ámbito del candado | **Por usuario** | **Por superficie** |
| Dónde se guarda | `usuarios.intentos_fallidos` / `bloqueado_hasta` | `bloqueos_de_autorizacion` |
| Código al bloquear | `USUARIO_BLOQUEADO` | `AUTORIZACION_BLOQUEADA` |
| Límite | 3 intentos, 30 s | 3 intentos, 30 s |

**Por qué están separados.** Al principio compartían el candado del usuario, y
la consecuencia se comprobó con una prueba: un cajero que tocara el botón de
salida y tecleara tres PIN al azar dejaba a **todos** los administradores sin
poder iniciar sesión, porque el fallo se le imputaba a cada uno de ellos. Eso
convertía una función de administrador en una **negación de servicio al alcance
de cualquier cajero**: repitiéndolo, nadie podía abrir la caja.

Separarlos duplica el presupuesto de fuerza bruta contra el mismo PIN (3
intentos por superficie cada 30 segundos en vez de 3 en total). No importa: a
ese ritmo recorrer los 10 000 PIN posibles lleva más de medio día en cualquiera
de los dos casos, así que el ataque en línea es inviable igual. Lo que sí
cambia es que un error de tecleo deja de poder paralizar la tienda.

**Por qué el candado del diálogo NO es por usuario.** Cuando aparece el diálogo
nadie eligió un usuario todavía: se teclean cuatro dígitos y el sistema prueba
contra los administradores activos. No hay a quién imputarle el intento. Por
eso un PIN equivocado cuenta **una vez**, no una por cada administrador contra
el que se comparó.

**Por qué se persiste** (tabla, no memoria): un candado en memoria se reinicia
matando el proceso desde el sistema operativo, algo que esta aplicación permite
a propósito (sección 4.5). Es el mismo argumento por el que el candado del
ingreso está en la base.

**Las dos direcciones son independientes**, y hay pruebas de ambas: bloquear el
diálogo no impide iniciar sesión, y bloquear a un usuario no bloquea el
diálogo. Una autorización correcta libera el candado del diálogo y **no** toca
el contador de ingreso del usuario.

**Los dos candados son LOCALES y no se sincronizan a la nube.** Son estado
operativo de una terminal, válido durante 30 segundos, no datos de negocio. Lo
que sí viaja es el hecho auditable: `usuario_bloqueado` y
`autorizacion_bloqueada` quedan en `auditoria_log`, que sí está espejada.

> **ESTA AFIRMACIÓN FUE FALSA HASTA EL 2026-09-13, y conviene que quede
> escrito.** Los dos asientos se escribían fuera de la bandeja de salida, así
> que **nunca se encolaban y nunca llegaban a la nube**. Lo encontró la prueba
> estructural de §4.26, que nació justamente de preguntar si algo vigilaba esto.
> Ya está corregido: el candado sigue sin viajar y el asiento ahora sí viaja,
> que es lo que este párrafo decía desde el principio.
Sincronizar el candado sería dañino con más de una terminal: el bloqueo de una
caja dejaría bloqueada la otra, que es la negación de servicio que esta
separación vino a eliminar.

**Al agregar una superficie nueva** hay que ampliar el `CHECK` de
`bloqueos_de_autorizacion` con una migración nueva. Es deliberado: así el
conjunto de superficies protegidas queda siempre a la vista y auditable. Y hay
que decidir explícitamente si acepta el PIN remoto, porque
`ACEPTA_PIN_REMOTO` es un `Record` de todas las superficies y el compilador no
deja agregar una sin contestar esa pregunta (§4.9).

> **DOS SUPERFICIES QUE ACEPTAN EL MISMO PIN NO COMPARTEN CANDADO.** Desde el
> 2026-09-11, `cierre_con_diferencia` y `descuento_excedente` aceptan las dos el
> PIN remoto, y aun así cada una lleva su propio contador. Si lo compartieran,
> un cajero que fallara tres veces al pedir un descuento dejaría a la tienda sin
> poder cerrar una caja descuadrada, que es exactamente la negación de servicio
> que esta separación vino a eliminar. Es un caso que antes no podía existir
> —solo una superficie aceptaba el remoto— y tiene sus propias pruebas.

### 4.9 Caja: dos modos de contar efectivo y autorización dual

#### Dos modos, nunca los dos a la vez

| Modo | Qué hace el cajero | Qué hace el sistema |
|---|---|---|
| **Simple** | Escribe el total | Lo guarda tal cual |
| **Detallado** | Cuenta piezas por denominación | **Suma** con Decimal.js y guarda el desglose |

En modo detallado **nunca se le pide además el total**. Si se le pidieran las
dos cosas, tarde o temprano no coincidirían y habría que decidir a cuál
creerle. El tipo `EfectivoDeclarado` es una unión discriminada, así que un
valor con los dos modos a la vez es **imposible de construir**, no algo que
haya que validar a mano.

El desglose se guarda en `caja_sesion_denominaciones` con `momento` `'apertura'`
o `'cierre'`. Un `UNIQUE (caja_sesion_id, denominacion_id, momento)` impide
contar dos veces la misma denominación y duplicar el arqueo sin que nadie lo
note.

#### UNA CAJA EN TODO EL SISTEMA, no una por persona

**Esto corrige un error de alcance del diseño original.** La restricción decía
"un usuario no puede tener dos turnos abiertos", lo que permitía que dos
personas distintas abrieran cada una su turno sobre **el mismo cajón físico de
dinero**. Jimmy tiene una sola caja y una sola pantalla: con dos turnos
simultáneos ninguno de los dos cortes significa nada, porque lo que entra por
uno sale contado en el otro.

La regla correcta es global: **como máximo una fila con `estado = 'abierta'` en
toda la tabla**, sin importar quién la abrió. La hacen cumplir dos capas: el
índice único parcial de la migración 010 —sobre la columna `estado` bajo
`WHERE estado = 'abierta'`, el modismo habitual para "una sola fila así"— y una
comprobación en el servicio, que existe para dar un mensaje legible en vez de
un error de restricción.

**El mensaje no dice de quién es la caja**: *"Ya hay una caja abierta en el
sistema"*, nunca *"ya tenés"*. La que está abierta puede ser de cualquiera, y
atribuírsela a quien intenta abrir lo mandaría a buscar un turno propio que no
existe.

#### Cerrar la caja que abrió otra persona

Como consecuencia de lo anterior, al turno de la mañana puede tocarle cerrarlo
el de la tarde. Eso no es libre:

| Quién cierra | Qué hace falta |
|---|---|
| La misma persona que abrió | Nada. Cierra directo. |
| Cualquier otra | El **PIN normal** de un administrador activo |

**UNA SOLA REGLA, SIN EXCEPCIONES POR ROL.** Hace falta autorización siempre
que quien cierra no sea quien abrió, **aunque quien cierra sea a su vez
administrador**: teclea su propio PIN y el cierre ajeno queda registrado igual.
La tentación de agregar "salvo que sea administrador" es exactamente la clase
de caso especial que ya costó una vuelta en este proyecto con la intercepción
de `Cmd+Q`: la excepción parece inofensiva y abre el hueco.

**No acepta el PIN remoto**, por la misma razón de alcance de siempre: ese PIN
se pidió para autorizar diferencias de caja por teléfono y nada más.

El candado de intentos usa la superficie `cierre_de_caja_ajena`, separada de
las otras dos y del ingreso. Las **seis combinaciones cruzadas** entre las
cuatro (tres superficies más el ingreso) están probadas en ambos sentidos.

**`caja_sesiones.cerrada_por`** guarda **quién cerró**, y va `NULL` cuando fue
la misma persona que abrió: así `WHERE cerrada_por IS NOT NULL` son exactamente
los cierres que necesitaron autorización, sin comparar dos columnas. Guarda a
quien cerró, **no a quien autorizó**: son dos personas distintas —el cajero
cierra, el administrador autoriza— y confundirlas haría que el corte pareciera
hecho por alguien que quizá ni estaba en la tienda. Quién autorizó queda en el
asiento de auditoría, junto con quién abrió y quién cerró.

Un mismo cierre puede necesitar **las dos autorizaciones**: cerrar una caja
ajena y encima encontrarla descuadrada. Son superficies distintas, con candados
distintos, y se piden en ese orden.

#### PIN normal y PIN remoto: por qué son dos

> **EL MECANISMO REMOTO CAMBIÓ EL 2026-09-15 (§4.47).** Ya no es un PIN fijo
> de cuatro dígitos en `pin_remoto_hash` (la migración 037 quitó la columna):
> es el código de seis dígitos de una app de autenticación, TOTP, con el secreto
> cifrado en `totp_secreto_cifrado`, que **nunca sube a la nube**. Lo que sigue
> vale para el PIN normal y para la tabla de superficies; lo que dice del PIN
> remoto fijo (hash, «no el mismo código en los dos», probar primero los
> normales) describe el estado anterior. Qué se tecleó lo decide ahora el LARGO.

| | PIN normal (`pin_hash`) | PIN remoto (`pin_remoto_hash`) |
|---|---|---|
| Sirve para | Iniciar sesión **y** autorizar estando presente | **Solo** autorizar a distancia |
| Se registra como | `presencial` | `remoto` |
| ¿Abre sesión? | Sí | **No** |

El PIN normal abre la sesión del administrador en la caja. **Dictarlo por
teléfono se lo entrega a quien escucha, para siempre y para todo.** Con un PIN
separado, lo que se cede al dictarlo es únicamente la capacidad de autorizar a
distancia; no sirve para entrar al sistema, y la auditoría distingue una
autorización remota de una presencial.

**El sistema determina solo cuál se usó**, según cuál hash coincidió: nunca se
le pregunta al cajero. Se prueban primero todos los PIN normales y después los
remotos, de modo que ante una coincidencia improbable gane la lectura
presencial, que es la más conservadora para la auditoría.

**Un administrador no puede poner el mismo código en los dos.** La regla vive
en `ServicioDeAutenticacion.configurarPinRemoto`, no en la pantalla: una
validación que vive en la interfaz se salta llamando al canal directamente.

**QUÉ SUPERFICIE ACEPTA EL PIN REMOTO ESTÁ EN UNA SOLA TABLA**,
`ACEPTA_PIN_REMOTO` en `src/main/domain/usuarios/autenticacion.ts`:

| Superficie | ¿PIN remoto? | Razón |
|---|---|---|
| `cierre_con_diferencia` | **Sí** | Es el caso para el que el PIN remoto se creó. |
| `descuento_excedente` | **Sí**, desde el 2026-09-11 | Decisión explícita de Julio. Ver §4.13. |
| `salida_controlada` | **Sí**, desde el 2026-09-15 — **ampliada por decisión explícita el 2026-09-15** | Hasta ese día **No**, con esta razón, que no estaba equivocada: el PIN remoto se pidió para una sola cosa, autorizar diferencias de caja por teléfono, y dárselo además a cerrar la aplicación lo ampliaba más allá de lo pedido. Julio decidió ampliarlo: Jimmy tiene que poder autorizar que se apague el punto de venta al final del día cuando no hay ningún administrador en la tienda. **Se evaluó separar el PIN remoto por superficie y se decidió NO hacerlo** (Julio, 2026-09-15): cambiar el PIN remoto desde «PIN de autorización remota» ya es el control real si cambia a quién se le dicta, y un PIN por superficie duplicaría ese mecanismo. Ver §4.41. |
| `cierre_de_caja_ajena` | **No** | Misma razón de alcance. Además, quien cierra una caja ajena está parado frente a ella. |
| `anulacion_de_venta` | **No**, desde que existe (2026-09-15) | El fraude que este PIN frena —cobrar en efectivo, anular y quedarse con el dinero— es el que un teléfono no puede verificar. Ver `docs/ANULACION-DE-VENTA.md` §4.2 y §4.45. |

**LA POLÍTICA VIVE EN LA TABLA, NO EN QUIEN LLAMA.** Antes era un parámetro
(`aceptaPinRemoto`) que cada uno de los cuatro lugares de autorización escribía
a mano junto al nombre de la superficie: dos datos que tienen que concordar
siempre, decididos en archivos distintos. Alcanzaba con copiar un bloque y
cambiar el nombre de la superficie sin tocar el booleano para que una superficie
empezara a aceptar un PIN que la documentación dice que no acepta, **sin que
nada fallara**. Ahora la política viaja con la superficie y quien llama no tiene
dónde contradecirla.

**El valor por omisión de una superficie nueva es NO aceptarlo**, y ampliarlo
sigue exigiendo una decisión explícita: que se haya concedido para el descuento
no es precedente para la próxima.

#### Autorización del cierre descuadrado

Si `diferencia == 0`, cierra directo. Si no, **no cierra**: primero calcula y
**muestra el monto exacto** —y si es faltante o sobrante— y recién después pide
el código. Quien autoriza, esté presente o al teléfono, tiene que ver qué está
aprobando.

El candado de intentos usa `superficie = 'cierre_con_diferencia'`, **separado**
del de `'salida_controlada'` y del de ingreso. Un error de tecleo al autorizar
un descuadre no bloquea el login de nadie ni la salida de la aplicación. Ver la
sección 4.8.

> **ANTES DE TOCAR LA MIGRACIÓN 008, LEER ESTO.** Su restricción
> `caja_sesiones_autorizacion_solo_con_diferencia` sostiene algo más de lo que
> dice su nombre: **es hoy lo único que tapa un hueco de la migración 007.**
> `caja_sesiones_autorizacion_coherente` está escrita como
> `(via IS NULL AND por IS NULL) OR (via IN (...) AND por IS NOT NULL)`, y esa
> forma **no rechaza un autorizante sin vía**, porque con `via` en NULL la
> segunda rama da NULL y un CHECK pasa cuando da NULL. La 008 sí exige
> `diferencia_autorizada_via IS NOT NULL` de forma explícita, y por eso la tabla
> no tiene hueco. **Si algún prompt futuro relaja esa restricción, hay que
> revisar primero si reabre este hueco.** El detalle completo está en
> `008_autorizacion_solo_con_diferencia.LEER-ANTES-DE-TOCAR.md`, al lado de la
> migración, y hay una prueba que fija su checksum y falla si alguien la edita.

**La regla la aplica la BASE, no solo el servicio** (migración 008,
`caja_sesiones_autorizacion_solo_con_diferencia`). El vínculo es en los dos
sentidos: si `diferencia` es `'0.00'` —o es nula, porque el turno sigue
abierto— las dos columnas de autorización tienen que ir vacías; si no lo es,
las dos tienen que ir llenas. Antes, la 007 solo las amarraba entre sí, y la
base aceptaba dos registros mentirosos: un cierre cuadrado con un autorizante
inventado, y un cierre descuadrado sin nadie que respondiera por él. Ese
segundo caso es exactamente el agujero que todo el flujo de PIN existe para
tapar, y lo tapaba solo el servicio: una consulta SQL a mano o un respaldo
restaurado a medias lo dejaban pasar.

El servicio decide si la caja cuadra comparando **el texto que va a guardar**
(`montoACadena(diferencia) === '0.00'`), no `Decimal.isZero()`. Son criterios
que hoy coinciden, pero comparar contra el valor guardado hace imposible que la
aplicación y la base discrepen sobre si hubo descuadre.

**Al actualizar una tienda, esta restricción revisa lo ya guardado.** Se midió
que SQLite se niega a agregarla si alguna fila existente la viola, y como cada
migración corre en una transacción, eso revierte la migración y la aplicación
no arranca. Si eso pasa, el mensaje no dice que el código esté mal: dice que en
esa base hay un cierre descuadrado sin autorizante. La consulta para
encontrarlo está en la cabecera de la migración 008. Hoy no puede haber
ninguno: la regla la aplicaba el servicio desde que existe el módulo de caja y
no hay ninguna tienda en producción.

### 4.10 `monto_esperado`: la fórmula, ya cerrada

**RESUELTO en el Prompt 19.** Hasta entonces `ServicioDeCaja.montoEsperadoDe`
devolvía el monto inicial, con un `TODO(ventas)`, porque no había ventas que
sumar. Ahora la fórmula es la definitiva:

```
monto_esperado = monto_inicial + Σ ventas EN EFECTIVO y COMPLETADAS
                                   de esta sesión de caja
```

Qué queda fuera, y por qué:

| Se excluye | Razón |
|---|---|
| **Las ventas con tarjeta** | Ese dinero nunca entró al cajón: entra por el banco, con su propia liquidación. Sumarlas haría que toda caja con ventas con tarjeta apareciera faltante por exactamente ese monto, y el cajero tendría que pedir una autorización de descuadre por un dinero que nadie perdió. |
| **Las ventas anuladas** | **Se excluyen por su fila en `anulaciones_de_venta`, no por `ventas.estado`** (§4.45). Hasta el 2026-09-15 nada las producía y el filtro era por `estado = 'completada'`. |
| **Las ventas de otros turnos** | Se filtra por `caja_sesion_id`, no por fecha: un turno es un turno, aunque cruce la medianoche. |

**Suma los TOTALES, no los subtotales**: el descuento discrecional ya está
aplicado en el total, que es lo que el cliente pagó y lo que entró al cajón.

**La suma se hace con Decimal.js, no con un `SUM()` de SQL.** `ventas.total` es
TEXT canónico y SQLite lo convertiría a punto flotante para sumarlo, que es
exactamente lo que descuadraría el corte. El filtro sí se hace en SQL, porque
`forma_pago` y `estado` son texto de verdad.

### 4.11 Catálogo: categorías, productos e inventario

#### Nada se borra: todo se desactiva

Ni una categoría ni un producto se eliminan jamás. `productos.categoria_id`
referencia a `categorias` con ON DELETE RESTRICT, y `venta_detalle` referencia
a `productos`: borrar rompería el historial de ventas, que es justo lo que una
auditoría necesita conservar. Las dos tablas tienen `activo`.

**Desactivar una CATEGORÍA solo la retira de las opciones al crear o editar un
producto.** No desactiva sus productos, no los mueve y no los saca de la venta.
Confundir las dos cosas retiraría mercadería del mostrador sin que nadie lo
haya pedido. Hay una prueba que lo verifica.

**Desactivar un PRODUCTO sí lo saca de la pantalla de venta**, pero conserva su
inventario y su historial. La pantalla pide confirmación explícita porque el
efecto es inmediato para el cajero.

La única excepción del proyecto a esta regla son los datos de ejemplo, que sí
se borran físicamente; el porqué está más abajo.

#### El ajuste de inventario es una acción propia, no un campo de "editar"

`ServicioDeProductos.ajustarInventario` es una operación aparte, con su propio
canal IPC, su propio botón visible y su propio nombre de acción en la auditoría
(`inventario_ajustado`, nunca `producto_editado`). `editar` **no puede** tocar
el saldo: el tipo `CambiosDeProducto` ni siquiera incluye el campo.

**SOLO SUMA.** Las mermas, pérdidas y correcciones a la baja son un módulo
futuro con sus propias reglas de autorización. Una cantidad que no sea
estrictamente positiva se rechaza en el servicio, con mensaje claro, mucho
antes de llegar al CHECK `productos_inventario_no_negativo`, que sigue siendo
la última red.

El asiento guarda el saldo anterior, el nuevo, lo agregado y el motivo en texto
libre.

#### `tipo_medida` SÍ se puede cambiar después de creado

No hay ninguna restricción que lo impida, y es deliberado: `venta_detalle`
guarda una foto del nombre, la unidad y el precio al momento de cada venta, así
que cambiar el tipo de medida hoy no altera un solo comprobante de ayer.
Prohibirlo obligaría a crear un producto nuevo por un error de carga y a
arrastrar un duplicado inútil en el catálogo para siempre.

#### Tres capas de validación, y ninguna sobra

| Capa | Qué aporta |
|---|---|
| Formulario (renderer) | Avisa mientras se escribe y deshabilita «Guardar». Evita llenar un formulario largo para descubrir el problema al final. |
| Servicio (dominio) | **Decide.** Rechaza con mensaje de negocio antes de tocar la base. Es la única capa que no se puede saltar llamando a otra cosa. |
| CHECK del esquema | Última red. Atrapa a un módulo futuro distraído, una consulta a mano o un respaldo restaurado a medias. |

La del formulario es comodidad; la del servicio es la regla; la de la base es
la garantía. Hay pruebas de las tres, y una de ellas comprueba explícitamente
que la incoherencia se rechaza **sin que se escriba nada en la base**, contando
las llamadas al repositorio.

#### Fotos de producto

- Se copian a `<userData>/fotos-de-productos/`, **nunca** a la carpeta de
  instalación: en Windows no es escribible de forma confiable y se reemplaza
  entera en cada actualización.
- El nombre de destino es un UUID nuevo, no el original: dos personas eligen
  `foto.jpg` y la segunda pisaría la del primer producto.
- En la base se guarda **solo la ruta relativa**. La absoluta cambia entre
  máquinas y rompería un respaldo restaurado en otra computadora.
- Se aceptan JPG y PNG, hasta 5 MB. **Se comprueba la firma binaria del
  archivo, no solo la extensión**: renombrar un archivo es gratis, y un
  ejecutable llamado `foto.png` pasaría cualquier comprobación de extensión.
- **SE REDIMENSIONA AL GUARDAR, desde la fase 3.c**: 800 px de lado mayor,
  calidad 80, conservando el formato. Este renglón decía «no se redimensiona ni
  se comprime; si hace falta, es una mejora futura» — **hizo falta**, y el
  número está en §2.5.3 del diseño: 200 fotos de teléfono sin comprimir son
  unos 600 MB, el 60 % del plan gratuito de una sola vez. Ver §4.33. El tope de
  5 MB sigue siendo el de ENTRADA, del archivo que se elige.
- La ventana ve las fotos por el esquema propio `pos-foto:`, servido por el
  proceso principal, y **no** por `file:`, que le daría acceso a cualquier ruta
  del disco. Antes de abrir el archivo se comprueba que la ruta caiga dentro de
  la carpeta de fotos.
- **Subirlas a Supabase Storage es trabajo del módulo de sincronización, y
  desde la fase 3.c ese módulo existe** (§4.33): la foto se encola en
  `sync_cola` con `entidad_tipo = 'archivo_foto'`, en su propio lote, dentro de
  la misma transacción que escribió el producto. `foto_path` **no cambia de
  significado**: sigue siendo la ruta en ESTE disco, y el objeto de Storage se
  deriva de ella sin ninguna columna nueva.

#### Un producto sin foto tiene su propio estado visual

No es un caso raro: es el estado NORMAL de todo producto recién dado de alta, y
lo que se ve en la lista entera la primera vez que se carga un catálogo. Se
dibuja con `MiniaturaDeProducto`: las **iniciales del producto sobre un color
derivado de su nombre**. Antes había un recuadro oscuro vacío, que no era un
ícono roto pero se leía como un agujero.

Tres decisiones dentro de eso:

- **Iniciales y no un ícono genérico único.** Un mismo ícono repetido en todas
  las filas no distingue nada, y esta lista se recorre buscando un producto
  concreto.
- **El color sale de una PALETA CERRADA de ocho colores elegidos a mano**
  (`PALETA_DE_MARCADORES`), no de un RGB calculado a partir del hash. El hash
  solo ELIGE entre opciones ya aprobadas. Un color compuesto dejaría la
  legibilidad librada a la suerte: bastaría un nombre desafortunado para
  producir un amarillo claro sobre el que las iniciales blancas no se leen.
  **La garantía no es el buen gusto sino una prueba**: mide el contraste WCAG
  de cada color con el texto blanco y falla por debajo de 4,5:1. Medido, el
  peor de los ocho da 4,92:1. Se comprobó que la prueba muerde agregando un
  amarillo claro a propósito: falla con «El color #fbbf24 da 1.67:1».
- **Es determinista**: el mismo producto tiene siempre el mismo color. Al azar
  cambiaría en cada recarga y no serviría para reconocer nada. El resto del
  hash se toma contra 2³¹−1 y solo al final contra el tamaño de la paleta;
  tomarlo contra 8 en cada vuelta degeneraba el hash —31 ≡ −1 (mod 8), o sea
  una suma alternada— y los «Maíz blanco», «Maíz amarillo» y «Maíz quebrado»
  del catálogo caían todos en el mismo color.
- **Se anuncia a un lector de pantalla** (`role="img"` con «todavía sin foto»).
  Antes era `aria-hidden`, o sea que quien no ve la lista no se enteraba de que
  faltaba la foto.

El prefijo `[Ejemplo] ` se ignora al calcular las iniciales: si no, todos los
productos de ejemplo mostrarían la misma letra.

El mismo componente se usa en la lista y en la vista previa del formulario, con
dos tamaños. Cualquier lugar futuro que muestre una miniatura debe usarlo
también, y no un `<img>` suelto: dos formas distintas de decir «sin foto» es
exactamente lo que esto vino a eliminar.

#### Los guiones de datos de ejemplo fallan RUIDOSAMENTE

Si el punto de venta ya está abierto, `seed:ejemplo` y `seed:limpiar` no pueden
trabajar: la aplicación es de instancia única. Antes salían **en silencio y con
código 0**, o sea que parecían haber funcionado sin haber tocado la base. Ahora
imprimen qué pasó y salen con código 1. Un guion que miente sobre lo que hizo
es peor que uno que falla.

Para la aplicación normal, en cambio, salir callado sigue siendo lo correcto:
la segunda copia le pasa el foco a la primera y no tiene nada que decirle al
cajero.

#### `npm run verify:pantallas`: lo que las pruebas no pueden ver

Vitest comprueba que el servicio devuelve el mensaje correcto y que el
envoltorio IPC lo deja pasar. Ninguna de las dos cosas dice si ese mensaje
**aparece de verdad en la ventana**, ni si quedó fuera de la vista. Los dos
defectos de esta clase que ya se encontraron —el mensaje genérico que tapaba al
específico, y el aviso puesto arriba de un formulario más alto que la
pantalla— se descubrieron a mano, y a mano no escalan.

`verify:pantallas` arranca el mismo `electron .` del desarrollo contra una
carpeta de datos TEMPORAL, crea el administrador, carga una categoría y recorre
la pantalla de productos con los mismos clics que haría una persona. Imprime un
informe y sale con código 1 si algo falla.

**Se comprobó que atrapa los dos defectos**: reintroduciendo cada uno a
propósito, la comprobación correspondiente falla —la del mensaje mostrando «La
operación no pudo completarse», la de ubicación midiendo el aviso en −103 px, o
sea por encima del borde de la pantalla— y el guion sale con código 1. Una
comprobación que nunca se vio fallar no prueba nada.

Usa `playwright-core` en su modo de Electron, que maneja el binario que el
proyecto ya tiene: **no descarga ningún navegador** y es devDependency, así que
no viaja en el instalador. Ver la fila correspondiente del registro de
decisiones.

#### El aviso de error va junto al botón, no en el encabezado

En el formulario de producto el mensaje de error se muestra **inmediatamente
arriba de «Crear producto»**, no en la cabecera de la tarjeta. Se descubrió
manejando la aplicación real: el formulario es más alto que la pantalla, así
que al pulsar el botón —que está abajo— un mensaje puesto arriba queda fuera de
la vista y parece que el botón no hizo nada. El aviso tiene que aparecer donde
está mirando quien lo pulsó.

Vale para cualquier formulario futuro que crezca más que la pantalla.

#### Datos de ejemplo: NO son una migración

`npm run seed:ejemplo` y `npm run seed:limpiar` siembran y quitan un catálogo
de mentira mientras Jimmy no entregue el suyo. **No pasan por el sistema de
migraciones**, y la distinción importa: una migración es historial permanente
del esquema, se aplica una vez y no se deshace. Estos datos tienen que poder
sembrarse, borrarse y volver a sembrarse tantas veces como haga falta.

Se reconocen por el prefijo `[Ejemplo] ` en el nombre. Se eligió un prefijo y
no una columna nueva porque una columna sería esquema permanente para un
problema temporal —habría que espejarla en Postgres y quitarla después—, y
porque el prefijo **se ve**: quien abra la pantalla sabe de un vistazo que ese
catálogo no es el de la tienda.

La limpieza sí borra físicamente. Es la única excepción a "nunca eliminar", y
la razón es que estos registros no tienen historial que proteger: dejarlos
desactivados seguiría ocupando los nombres por el UNIQUE de la tabla, y el
"Maíz blanco" real de Jimmy chocaría con el de mentira. Si algún producto de
ejemplo llegara a tener ventas, **no se borra nada** y se informa cuál.

### 4.12 Pantalla de venta: del ticket al cobro

#### Qué hace y qué NO hace todavía

Arma el ticket **en memoria** —agrega productos, corrige cantidades, quita
líneas y calcula el total— y lo manda a cobrar por el canal `venta:cobrar`.
**Todavía no imprime ni genera recibo, y no se puede anular una venta ya
registrada.**

Lo que la pantalla **no** hace es decidir cuánto se cobra: el precio de cada
línea, el descuento y el total los vuelve a calcular el proceso principal
contra el catálogo, dentro de la misma transacción que descuenta inventario. El
payload de cobro lleva **qué producto y cuánto**, nunca un precio; si los
precios viajaran desde la ventana, cualquiera podría cobrar un maíz a un
centavo llamando al canal directamente.

La lógica del ticket vive en `src/renderer/src/venta/ticket.ts`, en funciones
puras: así se prueba sin DOM y sin base de datos.

#### Acceso condicionado a la caja: tres estados

| Estado | Qué se ve |
|---|---|
| No hay caja abierta | No se dibuja la cuadrícula. Se explica y se ofrece abrir la caja. |
| La caja la abrió **otra persona** | Tampoco se vende. Se dice quién la abrió y se manda a cerrar ese turno. |
| La caja la abrió quien está en sesión | Se vende con normalidad. |

**NO SE PUEDE VENDER EN LA CAJA DE OTRO, ni con autorización de administrador.**
Es una regla nueva, distinta de la de cerrar una caja ajena, y la diferencia
tiene una razón: una venta se registra contra `caja_sesion_id`, así que vender
en el turno ajeno metería el dinero en el corte de una persona que no lo
recibió. **Cerrar** la caja de otro sí se autoriza con PIN porque es un acto
único y auditado, con su asiento; **vender** es continuo, y autorizar una vez
dejaría toda una tarde de ventas atribuidas a quien no estaba. La salida
correcta ya existe y la pantalla lleva a ella: cerrar ese turno —con el PIN del
administrador— y abrir el propio.

Cuando no se puede vender, el proceso principal **no manda el catálogo**. No es
solo ahorro: la pantalla no debe poder dibujar la cuadrícula «por si acaso».

#### El aviso de inventario es de INTERFAZ, no la fuente de verdad

Si la cantidad de una línea supera el inventario, aparece un aviso —«Solo hay 8
lb en el inventario registrado»— y **no pasa nada más**: la línea se sigue
editando y el ticket se sigue armando.

Es deliberado. El saldo con el que se compara es una **foto tomada al cargar la
pantalla**, y mientras el cajero arma el ticket ese número puede haber
cambiado. Bloquear con un dato viejo impediría vender mercadería que sí está en
la bodega. **La comprobación real es el piso `>= 0` de la base dentro de la
transacción atómica que registra la venta** (§4.3, §4.13). El comentario que lo
dice está en `excedeInventarioConocido`, junto al código.

#### El orden de la cuadrícula es determinista

`contador_ventas DESC, nombre ASC`. El desempate por nombre no es decorativo:
un catálogo recién cargado tiene todos los contadores en cero, y sin desempate
SQLite podría devolver las filas en cualquier orden; la cuadrícula se
reacomodaría entre recargas y el cajero que ya sabe dónde está el maíz tendría
que volver a buscarlo. Mismo criterio de «nunca dejar un orden ambiguo» del
reparto de centavos.

La insignia de «más vendido» **solo aparece en productos con ventas reales**,
así que en una instalación nueva no la lleva ninguno: poner el número igual
sería decorar la pantalla con un dato falso.

**ORDENA `contador_ventas`, QUE CUENTA VECES, y esto ya está decidido: no se
cambia.** Desde el Prompt 19 convive con `cantidad_vendida`, que acumula la
cantidad, pero esa columna es para **reportes futuros** y no para el orden de
los íconos. Contar transacciones es la única medida comparable entre productos:
las libras de maíz y las unidades de huevo no se suman en un mismo número, así
que ordenar por cantidad pondría el maíz por encima de todo lo que se vende por
unidad. Ver la fila correspondiente del registro de decisiones.

#### Qué se tomó del diseño importado y qué se ajustó

El diseño viene del proyecto de Claude Design **«Mockup POS agrícola táctil»**,
pantalla `01 · Venta`. Se adaptó, no se copió: el prototipo es HTML plano con
estilos en línea y componentes propios (`<image-slot>`, `<sc-if>`), y la
aplicación lo reconstruye con sus propios componentes React y su IPC tipado.

**Se tomó tal cual:** la estructura de tres columnas (categorías · cuadrícula ·
ticket), la paleta completa en `oklch`, las proporciones y radios, las tarjetas
con sombra sólida desplazada, la insignia ámbar de más vendido, el pie del
ticket con el total grande y el botón COBRAR, y los objetivos táctiles de 64 px
o más.

**Se ajustó, y por qué:**

| Del diseño | Qué se hizo | Por qué |
|---|---|---|
| Tipografías Archivo e IBM Plex Mono desde Google Fonts | Se nombran primero, con una pila del sistema detrás; **no se cargan de la red** | La política de seguridad de contenido prohíbe conexiones salientes desde el renderer, y **la tienda tiene que funcionar sin internet**. Empaquetar los archivos de fuente es posible —las dos son de licencia abierta— y sería un cambio de una línea. |
| Paleta clara en toda la aplicación | Acotada a la pantalla de venta | Las otras cinco pantallas siguen oscuras. Migrarlas es una decisión aparte, no algo que deba colarse en el prompt de la venta. |
| Anchos fijos: 244 px de categorías, 552 px de ticket | `clamp()` | El diseño está dibujado a 1920 px. En una pantalla menor los dos paneles fijos se comían la cuadrícula y la dejaban **en una sola columna**; se vio corriendo la aplicación. |
| Cliente, selector detalle/mayoreo, número de ticket | **No se implementaron** | Son módulos que no existen. Dibujarlos vacíos sería prometer funciones que no están. El descuento y la forma de pago **sí** llegaron en el Prompt 19, en el diálogo de cobro. |
| Nombre de la tienda, «CAJA 1», reloj | No se muestran | No hay de dónde sacarlos: no existe configuración de tienda ni de terminal. Inventarlos sería atribuirle datos a Jimmy. |

Además, corriendo la aplicación apareció un defecto que ninguna prueba veía: el
pie del ticket, con el botón de cobrar, quedaba **debajo de la barra de estado
fija** del kiosko. La pantalla de venta reserva ahora ese alto
(`--alto-barra-estado`). Vale para cualquier pantalla futura que use
`position: fixed`.

Y un segundo defecto de la misma clase, en el Prompt 19: el distintivo de precio
especial estaba dentro de la columna del nombre, donde compite por espacio con
el subtotal, y en el ticket angosto se partía en **cuatro renglones** —peor
todavía por ir en mayúsculas espaciadas—. Ahora ocupa su propia fila, a lo
ancho de la línea y en minúsculas. **Los distintivos y avisos de una línea del
ticket van en su propia fila**, no metidos en la columna del nombre.

#### El teclado táctil es el mismo, con dos modos

`TecladoNumerico` gana un modo `cantidad` junto al de `pin`. En modo PIN nada
cambió —enmascarado y de largo exacto, y las cuatro pantallas que ya lo usaban
no pasan ningún modo—; en modo cantidad **el número sí se muestra**, porque
ocultar una cantidad que el cliente está mirando pesar no protege nada e
impediría corregir un error de tecleo. El punto decimal solo existe donde
significa algo: tres decimales para el peso, ninguno para lo que se vende por
unidad.

### 4.13 El registro de la venta: la transacción del proyecto

`ServicioDeVenta.registrar` es la operación donde se juntan casi todas las
reglas del sistema. **Todo ocurre dentro de una sola transacción de SQLite**, en
este orden, y si cualquier paso falla no queda nada escrito:

| # | Paso | Por qué va donde va |
|---|---|---|
| 1 | **Se reverifica la caja** | Entre que se abrió la pantalla y este momento alguien pudo haber cerrado el turno. Va ANTES de tocar inventario para no descontar mercadería de una venta que igual va a rechazarse. |
| 2 | Se resuelve cada línea: producto activo, cantidad positiva, precio efectivo, saldo nuevo | Todas las validaciones antes de la primera escritura. |
| 3 | Subtotal exacto, descuento y **total con redondeo único** | La cadena entera se mantiene exacta y se redondea una sola vez. |
| 4 | **Se descuenta inventario**, línea por línea, con comparar-y-cambiar | Primera escritura. Si una línea falla, la transacción se revierte y ninguna otra queda tocada. |
| 5 | Cabecera en `ventas` y detalle en `venta_detalle`, con `repartirMonto` para `subtotal_impreso` | El reparto conserva `orden_linea`, que es el orden de captura. |
| 6 | `contador_ventas` y `cantidad_vendida` de cada producto | En la MISMA transacción: si corrieran aparte y esa fallara, el orden de los íconos dejaría de corresponder a lo vendido. |
| 7 | Asiento de auditoría de la venta, y otro más si hubo autorización de descuento | Son dos hechos distintos, con dos responsables distintos. |

El servicio recibe **la conexión** además de los repositorios, porque es quien
sabe qué va adentro de la transacción. Los repositorios nunca la abren.

**No hay un solo `try/catch` dentro de la transacción.** `transaction()` de
better-sqlite3 revierte con cualquier excepción y vuelve a lanzarla: ese es todo
el mecanismo de «todo o nada», y un `catch` mal puesto podría tragarse un fallo
a medio camino y dejar la venta escrita a medias.

**Cero reintentos automáticos** ante un conflicto de inventario: la política
está en §4.3 y el servicio la aplica tal cual, nombrando en el mensaje **qué
producto** falló.

#### El mismo producto dos veces en el ticket se rechaza con SU motivo

La pantalla junta las cantidades del mismo producto en una sola línea, pero el
canal IPC se trata como entrada no confiable. Dos líneas del mismo producto
leerían las dos el MISMO saldo y la segunda fallaría con
`CONFLICTO_DE_INVENTARIO`, que le diría al cajero algo falso: que el saldo
cambió mientras cobraba. Se rechaza antes, con `DATO_INVALIDO` y el motivo
verdadero.

#### Precio especial y descuento discrecional son DOS cosas distintas

Es la distinción que `src/main/domain/venta/precios.ts` existe para mantener:

| | Precio especial | Descuento discrecional |
|---|---|---|
| Sobre qué | Un **producto** | La **venta completa** |
| Quién decide | Un administrador, **de antemano**, con vigencia | Quien vende, **en el momento** |
| Dónde vive | `precios_especiales` | `ventas.descuento_tipo` / `descuento_valor` |
| ¿Pide autorización? | No: ya la tuvo al configurarse | Sí, si pasa el tope del rol |
| Se ve en pantalla | Línea marcada, precio de lista tachado | Renglón «Descuento» en el diálogo de cobro |

Un mismo ticket puede llevar los dos, y se aplican en ese orden: primero el
precio especial de cada línea, después el descuento sobre el total.

**Si hay varios precios especiales vigentes para un producto, gana el más
reciente por `vigente_desde` y NO se acumulan.** Dos promociones encimadas
darían un descuento que nadie configuró, y el cajero no tendría cómo explicarle
al cliente de dónde salió el precio.

**La vigencia se compara POR DÍA, no por instante.** Una promoción cuyo
`vigente_hasta` es hoy sigue valiendo todo el día: el último día de una promoción
es un día de promoción, y con comparación por instante el cliente pagaría de más
justo el día en que el cartel del mostrador todavía dice que está rebajado.

> **Cuidado con la zona horaria.** La comparación usa `date()` de SQLite sobre
> las cadenas ISO, que están en UTC. Guatemala es UTC−6, así que entre las 18:00
> y la medianoche locales el «hoy» de la base ya es el día siguiente. Para una
> promoción de varios días no cambia nada; para una de un solo día, su último
> día termina a las 18:00 de la tienda. Cuando exista una promoción real habrá
> que decidir si se corrige, y es una definición de negocio, no técnica.

#### El tope de descuento es POR ROL, y por TIPO

El porcentaje se compara contra `descuento_max_porcentaje` y el monto fijo
contra `descuento_max_monto_fijo`. **Son dos topes independientes y no se
convierten entre sí**: convertir uno en el otro exigiría conocer el total de la
venta y haría que el mismo porcentaje pasara o no según lo que llevara el
cliente.

**Sin fila configurada para el rol, el tope es CERO.** Es el valor seguro: un
olvido de configuración no debe convertirse en un permiso. La consecuencia
práctica es que en una instalación recién montada **cualquier descuento pide
PIN, incluso el que pide un administrador**, hasta que alguien configure los
límites.

**YA HAY PANTALLA PARA CONFIGURARLOS** desde el Prompt 25 (§4.16): un
administrador los cambia desde la aplicación y el cambio queda con su nombre y
su asiento de auditoría. El guion de desarrollo sigue existiendo para montar un
entorno nuevo de una sola vez, y sus valores siguen siendo de prueba y no una
definición del negocio (punto 15 de §6.2):

```bash
npm run seed:limites          # siembra el tope de los dos roles
npm run seed:limites:limpiar  # los quita, y los dos vuelven a cero
```

| Rol | Porcentaje | Monto fijo |
|---|---|---|
| `venta` | 10 % | Q20 |
| `administrativo` | 100 % | Q1 000 |

**LOS DOS ROLES PASAN POR EL MISMO MECANISMO.** No hay ninguna excepción por rol
en el código: un administrador no se salta la comprobación, simplemente tiene un
tope más alto. La diferencia entre los dos es un NÚMERO en una tabla, no una
rama en el servicio. Es la misma forma que tomó el cierre de caja ajena (§4.9) y
evita el caso especial «salvo que sea administrador», que en este proyecto ya
costó una vuelta con la intercepción de `Cmd+Q`.

**Por qué 100 % y no «ilimitado».** El esquema no tiene forma de decir
ilimitado: las dos columnas son decimales `NOT NULL` con piso cero, y la
ausencia de fila significa CERO, no infinito. Un tope sin límite habría que
escribirlo como un número mágico enorme, y un número mágico en una tabla de
configuración termina leyéndose dentro de un año como una decisión de negocio
que alguien tomó a propósito. **100 % sí es un techo honesto**: significa
«puede descontar la venta entera», y el total ya tiene piso en cero. En la
práctica un administrador nunca llega a autorizarse a sí mismo por la vía del
porcentaje. El Q1 000 del monto fijo sí es una cifra redonda y provisional, y
casi nunca es la que topa.

> **SALVEDAD QUE HAY QUE REVISAR, NO OLVIDAR.** Este tope **asume que el rol
> `administrativo` lo tiene el DUEÑO del negocio**, que hoy es el caso: la
> instalación de Jimmy tiene un solo usuario y es él. Si algún día ese rol se le
> asigna a un **empleado de confianza que no es el dueño**, un tope del 100 % le
> da la capacidad de regalar mercadería sin que nadie más se entere, y el número
> correcto pasa a ser otro. **Este número debe revisarse en ese momento.**
> Depende del **punto 6 de §6.2** —qué roles existen de verdad en la tienda—,
> que sigue abierto.

El guion imprime el tope de cada rol después de trabajar, justamente para que un
rol sin fila se lea como lo que es —tope cero— y no como «sin límite». Ver
`limites-de-ejemplo.ts`.

Si el descuento **no** excede el tope, **no se guarda autorizante aunque venga**.
Registrar una autorización que no hizo falta ensuciaría la auditoría con
permisos que nadie usó, y `WHERE descuento_autorizado_por IS NOT NULL` dejaría
de ser la lista de las excepciones reales.

#### La autorización del descuento: superficie propia, y desde el 2026-09-11 acepta el PIN remoto

Superficie `descuento_excedente` (migración 013, no espejada), con su propio
candado de intentos. **Acepta el PIN normal y el PIN remoto**, y el sistema
determina cuál coincidió.

> **ESTO CAMBIÓ, Y CAMBIÓ POR UNA DECISIÓN EXPLÍCITA DE JULIO DEL 2026-09-11,
> NO PORQUE LA REGLA ANTERIOR ESTUVIERA MAL.**
>
> La superficie nació en el Prompt 19 aceptando **solo** el PIN normal, con este
> argumento: ese PIN se pidió para autorizar diferencias de caja por teléfono, y
> un permiso creado para un caso que termina sirviendo para varios deja de ser
> un permiso acotado, así que **cada superficie nueva que lo acepte se pide y se
> decide aparte**. El código decía textualmente que ampliarlo exigía una
> decisión explícita.
>
> **Esa decisión se tomó.** El motivo del negocio es concreto: Jimmy no siempre
> está en la tienda, y un cliente parado en el mostrador no puede esperar a que
> vuelva para que le autoricen un descuento. Es decir: **el mecanismo funcionó
> como estaba diseñado.** El valor por omisión siguió siendo «no», la ampliación
> tuvo que pedirse, y se pidió.
>
> **EL PRINCIPIO DE ALCANCE MÍNIMO SIGUE VIGENTE Y NO SE AFLOJÓ.** Ninguna
> superficie futura hereda esto. `salida_controlada` y `cierre_de_caja_ajena`
> siguen sin aceptar el PIN remoto, cada una por su razón, y hay pruebas que lo
> comprueban en el mismo archivo que comprueba la ampliación. Que esta se haya
> concedido no es precedente para conceder la próxima sin pedirla.
>
> **Nota del 2026-09-15:** `salida_controlada` SÍ lo acepta desde ese día, por
> una SEGUNDA decisión explícita (§4.41). No la heredó de esta: se pidió aparte.
> `cierre_de_caja_ajena` y `saltar_lote_de_sincronizacion` siguen sin aceptarlo.

**La contrapartida, dicha en voz alta:** un descuento es dinero que sale de la
venta, y autorizarlo por teléfono es aprobarlo **sin ver el ticket**. Es un
riesgo real y se acepta a sabiendas. Lo que juega en contra de ese riesgo es que
el monto queda registrado con su autorizante, **su vía** y su asiento de
auditoría, y que la alternativa verdadera no era «autorizarlo mirando» sino «no
poder vender».

**Se muestra CUÁNTO se está por autorizar antes de pedir el código**: el
descuento pedido, el tope del rol y el exceso. Mismo criterio que el cierre de
caja descuadrado. El cobro se manda dos veces: la primera sin PIN, que devuelve
el rechazo con esos números, y la segunda con el PIN.

#### Forma de pago: la boleta va con tarjeta y solo con tarjeta

Regla en las tres capas: el diálogo avisa mientras se escribe, el servicio la
rechaza con un mensaje que la nombra, y la base la hace cumplir con
`ventas_boleta_solo_con_tarjeta` (migración 014). Sin ese número una venta con
tarjeta no se puede conciliar contra el estado de cuenta del banco.

**Volver a «efectivo» limpia la boleta escrita por error**, porque la base
rechaza una venta en efectivo con boleta y ese rechazo sería incomprensible
frente a un cliente.

**El descuento en la base ya estaba amarrado desde la migración 001** —no se
puede guardar un tipo sin valor, ni un valor sin tipo, ni un autorizante sin
descuento—, así que no hizo falta agregar ese CHECK. Se midió antes de escribir
nada. La 014 cierra el hueco que sí estaba abierto, que era la boleta.

#### Después de cobrar, la pantalla vuelve a cero

Ticket vacío, sin descuento, con la confirmación del total a la vista y **el
catálogo releído**, porque el inventario y el orden de los íconos acaban de
cambiar. Dejar el ticket cobrado a la vista invita a cobrarlo dos veces.

La confirmación muestra el total y **el id de la venta como referencia**. No hay
número correlativo todavía: ese vive en `recibos.numero_recibo` y llega con el
módulo de recibos. Inventar acá un número que después no coincida con el impreso
sería peor que no mostrar ninguno. Ver el punto 16 de §6.2.

#### `contador_ventas` cuenta VECES; `cantidad_vendida` cuenta CANTIDAD

Son dos columnas y dos preguntas distintas, y suben **en un solo `UPDATE`** para
que sea imposible mover una sin la otra.

| Columna | Qué mide | Para qué sirve |
|---|---|---|
| `contador_ventas` (INTEGER) | Cuántas VECES se vendió | Ordena los íconos de la cuadrícula |
| `cantidad_vendida` (TEXT canónico) | Cuánta mercadería salió | Conciliar contra inventario; base del módulo de mermas |

**Por qué dos y no una.** El pedido original era que `contador_ventas` subiera
por la cantidad vendida, pero es INTEGER y una venta a granel de 2.5 lb no cabe
en un entero sin mentir: truncarla pierde media libra en cada venta y
redondearla inventa media libra que nadie compró. Cambiarle el tipo a la columna
exigiría el rebuild de doce pasos de `productos`, que este proyecto ya descartó
una vez (ver la fila de la migración 008): `venta_detalle` y `precios_especiales`
la referencian, y el paso que apaga las llaves foráneas es ignorado dentro de una
transacción, que es donde corre cada migración. `ADD COLUMN` no tiene ninguno de
esos problemas.

**Y las dos medidas sirven para cosas distintas.** Las libras de maíz y las
unidades de huevo **no se pueden sumar en un mismo número**: ordenar la
cuadrícula por cantidad pondría el maíz —que sale de a cien libras— siempre por
encima de todo lo que se vende por unidad. Contar transacciones es la única
medida comparable entre productos.

### 4.14 Recibos: configuración del negocio, PDF e impresión térmica

#### `configuracion_negocio`: una sola fila, cuatro campos nulables

| Columna | Nulable | Marcador si falta |
|---|---|---|
| `nombre_comercial` | sí | `[Nombre del negocio]` |
| `direccion` | sí | `[Dirección]` |
| `telefono` | sí | `[Teléfono]` |
| `nit` | sí | `[NIT]` |

**FILA ÚNICA GARANTIZADA POR LA BASE.** `id` es la constante `'unica'` con un
CHECK, y como además es la llave primaria, la tabla no puede tener dos filas.
Esto **rompe a propósito la regla de UUID en el cliente**: esa regla existe
porque dos filas creadas sin internet en máquinas distintas colisionarían al
subir, y acá la colisión es justamente lo que se busca. La fila nace vacía en la
migración, para que la pantalla y el recibo lean siempre algo.

**LOS CUATRO SON NULABLES porque los datos reales de Jimmy todavía no llegaron**,
y hay que poder cargar el nombre sin saber el NIT. `NULL` es «sin configurar», y
el esquema impide la cadena vacía: si hubiera dos formas de estar vacío, el
recibo tendría que conocer las dos para decidir si pone el marcador.

**LOS MARCADORES VAN ENTRE CORCHETES Y SE VEN.** Un renglón en blanco, o peor un
nombre de ejemplo, harían que un recibo sin configurar pasara por uno
configurado. Entre corchetes, quien lo mire sabe que falta cargar el dato.

> **PENDIENTE PARA MULTI-SUCURSAL (§6.2, punto 10).** Con más de una sucursal,
> cada una tendría su propio nombre y dirección, y esta tabla necesitaría una
> fila por sucursal. Ese día hay que revisarla.

#### El recibo NO calcula nada

Lee `ventas`, `venta_detalle`, `recibos` y `configuracion_negocio`, y muestra.
Todo el cálculo ocurrió una sola vez, en la transacción que registró la venta
(§4.13). Si el recibo recalculara, bastaría que una regla cambiara el año que
viene para que reimprimir un comprobante viejo diera otro número.

**La única cifra derivada es la rebaja del descuento, y sale de `subtotal −
total`**, los dos guardados. NO se vuelve a aplicar el porcentaje: con otro modo
de redondeo daría un centavo distinto del que el cliente pagó.

#### EL PAPEL CUADRA: las líneas suman el TOTAL, no el subtotal

Esto **se corrigió manejando la aplicación real**, y vale anotarlo porque el
error es fácil de volver a cometer. `subtotal_impreso` es la parte que le toca a
cada línea **del total ya descontado** —es lo que garantiza «el total manda» del
§5—, así que las líneas **no** suman el subtotal. La primera versión del recibo
imprimía «Subtotal / Descuento / Total» encima de esas líneas y salía un papel
donde 14.80 + 5.32 no daba 21.75 y nadie podía cuadrarlo.

La forma correcta con estos datos: las líneas suman el TOTAL, y el descuento se
informa como dato de la venta, no como paso de una resta. El papel dice «Precios
e importes ya incluyen el descuento», el monto rebajado y quién lo autorizó. Hay
una prueba que suma las líneas y exige que den el total.

**Quién autorizó el descuento va EN EL PAPEL**, no solo en la auditoría: es la
única copia que se lleva el cliente, y un descuento sin responsable visible es
justo lo que el flujo de PIN existe para evitar.

#### CON DESCUENTO, el precio unitario impreso es el EFECTIVO

Es la segunda mitad del arreglo anterior, y cierra el renglón que todavía no
cuadraba. Las líneas ya sumaban el total, pero **cada renglón por separado
seguía sin multiplicar**: al lado de un importe ya descontado salía el precio de
LISTA, así que el papel decía «0.333 lb x 6.69» junto a «2.06» y el cliente no
podía verificar su propia compra de cabeza.

| Caso | Qué se imprime en la columna de precio |
|---|---|
| La venta **no** tiene descuento | `precio_unitario_snap` tal cual. Ahí `cantidad × precio` ya da el importe y no hay nada que calcular. |
| La venta **sí** tiene descuento | El precio EFECTIVO: `subtotal_impreso ÷ cantidad`, redondeado a dos decimales. |

**ES PURAMENTE DE PRESENTACIÓN.** `venta_detalle.precio_unitario_snap` no
cambia: sigue siendo la foto del precio al momento de vender, que es el dato del
negocio —lo que el producto costaba—. El precio efectivo no se guarda en ningún
lado y solo existe mientras se dibuja el papel. Vive en `precioParaImprimir`, en
`modelo-de-recibo.ts`, y hay una prueba que comprueba que la fila guardada
conserva el precio de lista.

**LA DERIVACIÓN VA EN UN SOLO SENTIDO Y NO SE PUEDE INVERTIR.** El precio
impreso sale del importe, nunca el importe del precio impreso. Al revés, las
líneas dejarían de sumar exactamente el total y se perdería «el total manda» del
§5, que es la regla más cara de este proyecto. Hay una prueba que vuelve a sumar
las líneas justamente para que cualquier inversión futura se caiga ahí.

> **EL MARGEN, DICHO EN VOZ ALTA.** Un unitario de dos decimales hace que
> `cantidad × precio impreso` pueda diferir del importe hasta en **medio centavo
> por unidad**: con 0.333 lb es invisible, con **100 lb de maíz llega a Q0.50** y
> ahí sí se ve. Es el costo inevitable de imprimir un precio redondeado, y aun
> así es mucho menos que la diferencia anterior —Q1.20 en una venta de Q20—. Dos
> pruebas fijan esa cota, una de ellas con 100 libras a propósito.

#### La aclaración «Precios e importes ya incluyen el descuento» SE CONSERVA

Con el precio efectivo, la aritmética del renglón ya se explica sola y la nota
dejó de ser necesaria para eso. **Se conserva igual**, y se le corrigió el texto
—antes decía solo «Los importes…»— porque ahora el precio también viene
descontado. Sigue haciendo falta por dos cosas que la multiplicación de la línea
no dice:

1. **Que el renglón «Descuento −1.63» es un DATO, no un paso de resta.** Está
   arriba del TOTAL pero ya está aplicado en él. Sin la nota, quien lea el papel
   va a intentar restarlo otra vez y le va a dar un número que no existe.
2. **Que el precio unitario que ve no es el precio de lista del producto.** Un
   cliente que sabe que el maíz está a Q6.69 y lee Q6.19 merece la explicación
   en el mismo papel, no una discusión en el mostrador.

Cuesta un renglón de papel. Quitarla ahorraría eso y abriría las dos confusiones.

#### El PDF sale de Chromium, no de una librería nueva

`webContents.printToPDF` sobre una ventana invisible y efímera. Electron ya
empaqueta Chromium: sumar `pdfkit` sería agregar una dependencia y un segundo
motor de maquetación para lo mismo. Y maquetar con HTML y CSS deja el recibo
ajustable por alguien que no sea programador.

El HTML se carga por `data:`, nunca escribiendo un archivo temporal: así no queda
un HTML con los datos de una venta dando vueltas en el disco. La ventana va sin
Node, sin preload y con aislamiento: el recibo es contenido, no código.

Los PDF viven en `<userData>/recibos/`, **nunca** en la carpeta de instalación,
por la misma razón que las fotos de producto (§4.11).

**Y `recibos.pdf_path` GUARDA LA RUTA RELATIVA, `recibos/<nombre>.pdf`, desde
la migración 030 (2026-09-14).** Hasta entonces guardaba la ruta ABSOLUTA de la
carpeta de recibos de la máquina que emitió —`join(carpeta, nombre)`—, y esa
ruta viajaba a la nube con cada recibo sin significar nada en ninguna otra
computadora: la restauración de la fase 4.b tuvo que re-enraizarla, y Julio
señaló que mientras el origen siguiera igual cada recibo nuevo iba a subir con
el mismo problema y cada restauración iba a tener que seguir compensándolo.
Ahora rige la misma regla que `foto_path` (§4.11): en la base solo la
relativa, y la absoluta se resuelve al usarla (`resolverRutaDePdf`, en
`domain/recibo/ruta-de-pdf.ts`, con la misma barrera contra salirse de la
carpeta que `resolverRutaDeFoto`). La 030 convierte las filas que ya existían
—y lo que esperaba en `sync_cola`— sin mover ningún archivo:
`<userData>/recibos/<nombre>` es donde ese PDF ya estaba. Las filas que ya
subieron a la nube con ruta absoluta quedan como están allá; la restauración
las convierte al bajarlas, como compatibilidad hacia atrás y nada más (§4.35).

**La 030 se vio correr sobre una COPIA de la base de trabajo real de esta
máquina (2026-09-14), no solo sobre bases de prueba.** Julio pidió confirmar
que «se aplica igual de limpia contra cualquier base con datos reales», y al
mirar esa base aparecieron dos cosas que había que decir: **no tenía la 030
aplicada** —nadie la abría desde el 12 de septiembre: estaba en la 018, con la
028 y la 029 también sin aplicar— y **tiene cero recibos**, así que sobre ella
la 030 no convierte nada. Para tener una fila real que convertir se emitió un
recibo de la única venta de esa base con el `ServicioDeRecibos` del commit
ANTERIOR (`09903de`, el que guardaba la ruta absoluta), desde una copia del
repositorio en ese commit, y recién entonces se abrió la copia con el migrador
actual. Salida cruda de los dos pasos:

```
[anterior] migraciones al abrir: aplicadasAhora=["028_limites_descuento_id_determinista","029_saltar_lote_de_sincronizacion"] … ultimaAplicada=029_saltar_lote_de_sincronizacion
[anterior] la venta REAL de la base: {"id":"7e46d49a-9344-4b09-abc2-4db9c4fa62a6","fecha":"2026-09-11T12:01:14.013Z","total":"190.00","estado":"completada","forma_pago":"efectivo"}
[anterior] fila de recibos: {"numero_recibo":1,"pdf_path":"/private/tmp/…/base-real/datos/recibos/recibo-000001-2026-09-14T16-22-49-821Z.pdf","impreso":0}
[anterior] sync_cola: [{"entidad_tipo":"recibos","operacion":"insertar","sincronizado_en":null,"pdf_en_payload":"/private/tmp/…/base-real/datos/recibos/recibo-000001-2026-09-14T16-22-49-821Z.pdf"}]
[actual]   migraciones al abrir: aplicadasAhora=["030_recibos_pdf_path_relativo"]; integrity_check: ok
[actual]   fila de recibos DESPUÉS de la 030: {"numero_recibo":1,"pdf_path":"recibos/recibo-000001-2026-09-14T16-22-49-821Z.pdf","impreso":0}
[actual]   sync_cola DESPUÉS de la 030: [{"entidad_tipo":"recibos","sincronizado_en":null,"pdf_en_payload":"recibos/recibo-000001-2026-09-14T16-22-49-821Z.pdf"}]
[actual]   resolverRutaDePdf(carpetaDeDatos, 'recibos/recibo-000001-….pdf') = /private/tmp/…/base-real/datos/recibos/recibo-000001-….pdf; ¿existe el PDF en esa ruta? true
[actual]   reimpresión: pdfGenerado=true rutaPdf=<esa misma ruta>; pdf_path tras reimprimir (no cambia): recibos/recibo-000001-….pdf
[actual]   el resto de la base, intacto: usuarios=2 productos=6 ventas=1 venta_detalle=2 auditoria_log=21 limites_descuento=2 (con sus ids fijos por rol)
```

La base de trabajo real se migró después con el mismo migrador de la
aplicación —`028`, `029` y `030` en una sola apertura, `integrity_check = ok`,
consolidada— con un respaldo de cómo estaba antes en el scratchpad de la
sesión. (`npm run verify:arranque` NO sirve para eso, y conviene saberlo:
arranca contra una base temporal propia, `pos-agricola-verificacion.db`, no
contra la de trabajo.) **Regla que queda:** toda migración local nueva se
corre además sobre una copia de una base con datos reales antes de darse por
hecha, y «ya está aplicada» se afirma leyendo `migraciones_aplicadas`, no por
suponerlo.

**UNA REIMPRESIÓN REGENERA EL PDF desde las filas de la venta y escribe encima
del mismo archivo.** `pdf_path` es una sola columna y tiene que apuntar siempre a
un PDF vigente. La contrapartida está aceptada y es la que se pidió: el archivo
refleja la configuración de HOY, de modo que un recibo emitido antes de cargar
los datos de la tienda deja de mostrar marcadores al reimprimirse.

##### DECIDIDO: los datos del negocio NO se congelan por venta

La pregunta es legítima y hay que dejar escrito por qué se decidió así, no solo
qué se decidió. **Una reimpresión refleja SIEMPRE los datos vigentes de
`configuracion_negocio`** —el comportamiento actual— y **no** se guarda un
snapshot al momento de cada venta como sí se hace con el nombre y el precio del
producto. **No se implementa el snapshot.**

**No son la misma clase de dato, y por eso no heredan la regla del producto.**
El nombre y el precio del producto se congelan porque son **términos de la
operación**: es lo que el cliente aceptó pagar, y cambiarlos retroactivamente
cambia lo que el documento dice que se acordó. El nombre, la dirección, el
teléfono y el NIT dicen **quién emitió el papel**, no qué se acordó en él.
Aplicarles la regla del producto sería copiarla sin el motivo que la justifica,
que es el mismo error que este proyecto ya evitó al no copiar el patrón TEXT de
SQLite a Postgres (§5).

**Hoy el argumento apunta con fuerza en contra del snapshot.** Los cuatro campos
están en `NULL` porque los datos de Jimmy todavía no llegaron, así que todo
recibo emitido antes de cargarlos sale con marcadores entre corchetes. Con
snapshot, esos recibos quedarían **con los marcadores congelados para siempre**,
y reimprimir una venta de la primera semana daría un papel peor de lo necesario.
Sin snapshot se reparan solos el día que se carguen los datos. Ese beneficio es
concreto y está disponible ahora; el del snapshot es hipotético.

**Y el dato cambia casi nunca.** El NIT de un contribuyente prácticamente no
cambia, la dirección cambia si la tienda se muda y el teléfono rara vez. La
ventana en la que un snapshot cambiaría algo es mínima.

> **CUÁNDO SÍ HABRÍA QUE REVISARLO, dicho en voz alta para no esconderlo.** Si
> el NIT o el nombre comercial cambiaran por una razón **legal** —cambio de
> contribuyente, cambio de razón social—, una reimpresión de una venta vieja
> mostraría como emisor a alguien que no la emitió, y **eso sí es un problema de
> auditoría**. Hoy la exposición está acotada porque el papel dice de frente
> «Proforma, no válido como factura fiscal» y no se sostiene como evidencia
> fiscal de quién emitió. **Esta decisión se revisa el día que se resuelva el
> punto 2 de §6.2** (si la tienda emite factura fiscal FEL/SAT) y el día que
> cambie el NIT o el nombre comercial. Nótese además que una vez cargados los
> datos reales, el argumento de los marcadores se agota y el balance se corre un
> poco hacia el snapshot: no es una decisión permanente, es la correcta hoy.

**Implementarlo después no está bloqueado por nada de lo que hay hoy**, y esa es
parte de la razón para no hacerlo ahora: serían cuatro columnas nulables en
`ventas` —o una tabla `ventas_negocio_snap`— llenadas dentro de la transacción
de la venta, y el recibo preferiría el snapshot con respaldo en la fila vigente
para las ventas anteriores. Ningún dato se pierde mientras tanto.

#### El recibo se emite DESPUÉS de la transacción, nunca adentro

Generar un PDF abre una ventana de Chromium e imprimir habla con un puerto: las
dos cosas son lentas y fallan por motivos ajenos a la venta. Meterlas en la
transacción mantendría abierta una escritura de SQLite esperando a un aparato, y
haría que una impresora sin papel revirtiera una venta ya cobrada.

**La consecuencia, dicha en voz alta:** si la aplicación se cae justo entre la
venta y el recibo, queda una venta sin recibo. Es recuperable y es infinitamente
preferible a perder la venta por un problema de papel.

#### ESC/POS: implementado contra el estándar, SIN confirmar contra el modelo real

> **PENDIENTE, ES LO PRÓXIMO QUE HACE FALTA DEL CLIENTE.** La impresora de Jimmy
> **llega el jueves**. Esto está escrito **contra el estándar ESC/POS más común,
> no contra su modelo**, y **no se probó contra hardware real**. Hay que
> confirmar compatibilidad exacta el día que llegue. Ver el punto 9 de §6.2.

Qué se hizo para que el riesgo sea el menor posible:

- **Solo comandos del núcleo del estándar**: inicializar, página de códigos,
  avanzar y corte parcial. Se evitaron a propósito los de código de barras,
  imagen y cajón de dinero, que es donde los fabricantes se apartan. Tampoco se
  usan negrita ni tamaño doble.
- **La conversión a bytes es una función pura** (`escpos.ts`) y está probada byte
  por byte. Lo que no se puede probar sin el aparato es que ESA impresora los
  entienda; el día que llegue, estas pruebas dicen exactamente qué se le manda.
- **Codificación CP850**, que es la que traen casi todas de fábrica y cubre el
  español. No se usa `latin1`: coincide con CP850 en los primeros 128 bytes y se
  separa justo en las vocales acentuadas. Un carácter sin lugar se sustituye
  antes que imprimir basura.
- **Sin dependencias nativas nuevas.** Los bytes se escriben en el dispositivo
  con `node:fs`. Una librería USB obligaría a recompilar otro módulo nativo para
  Electron y para Windows para hacer exactamente eso.

**Qué impresora usa esta terminal se configura en un ARCHIVO LOCAL**,
`<userData>/impresora.json`, y no en `configuracion_negocio`:

```json
{ "dispositivo": "\\.\USB001" }
```

> **CORREGIDO EL 2026-09-15: ESE EJEMPLO ES PROBABLEMENTE INCORRECTO Y NUNCA SE
> MIDIÓ EN HARDWARE REAL.** Lo encontró la investigación previa a construir la
> pantalla de impresora, y lo confirmaron además fuentes externas
> independientes. `USB001` es un **puerto de la cola de impresión** de Windows,
> no un dispositivo que se abra como archivo. Escribir bytes en `\\.\USB001` con
> `node:fs` probablemente nunca funcionó. Además, el controlador `usbprint.sys`
> se queda con las impresoras USB, así que una librería USB tampoco era la
> salida: exigiría reemplazar ese controlador y rompería la cola.
>
> **Desde el 2026-09-15 el archivo guarda el NOMBRE de la impresora instalada**
> (`{ "impresora": "POS-80" }`) y los bytes van por la cola de Windows en RAW.
> Hay pantalla para elegirla. El formato viejo se sigue leyendo, por
> compatibilidad hacia atrás, pero la pantalla ya no lo ofrece. Ver §4.43. Lo de
> abajo describe el estado ANTERIOR.

Es estado operativo de una máquina —dos cajas podrían tener la térmica en
puertos distintos— y esa tabla se espeja en la nube. Es el mismo criterio que ya
se aplicó a `bloqueos_de_autorizacion` (§4.4). **Sin archivo no hay impresora, y
eso NO es un error**: es el estado normal hoy. ~~No hay pantalla para configurarlo
porque configurar una impresora que nadie vio sería adivinar qué opciones
ofrecerle a Jimmy.~~ **Desde el 2026-09-15 sí hay pantalla** (§4.43): lista las
impresoras que Windows ya tiene instaladas, así que no adivina ninguna opción.

#### Un fallo de impresión es TÉCNICO, no un hecho del negocio

Va a `<userData>/log-tecnico.log`, **nunca** a `auditoria_log`. Esa tabla es
inmutable por trigger, se espeja en la nube y un auditor la lee como evidencia:
que una impresora no respondiera es un problema del aparato, y meterlo ahí
ensuciaría con ruido de hardware la única tabla que tiene que poder leerse
entera. Hay una prueba que lo verifica.

**La venta sobrevive a todo**: sin impresora, con impresora rota, e incluso si
falla el PDF. En los tres casos la venta queda `completada` y el recibo existe en
la base, así que se puede volver a emitir desde el historial.

#### El historial vive en su propia pantalla, y no exige ser administrador

Reimprimir lo pide un cliente que volvió al rato porque perdió su papel, no
alguien que está cobrando: meterlo dentro de la venta obligaría a abandonar un
ticket a medio armar. Y lo hace **cualquiera con sesión**, porque el cajero tiene
que poder resolverlo solo y el recibo no muestra nada que el cliente no haya
visto al comprar. **Configurar los datos del negocio sí exige rol
administrativo**: cambia un documento que se le entrega al cliente.

El recibo se muestra en pantalla **en texto plano y monoespaciado, exactamente el
mismo texto que va a la impresora**. No es una versión bonita de los mismos
datos: si la pantalla y el rollo se vieran distintos, cotejar uno contra otro
dejaría de ser inmediato.

### 4.15 Reportes: la regla del SUM(), y el segundo defecto que apareció con ella

#### LA REGLA, EN UNA FRASE

> **Ningún reporte agrega ni ordena en SQL sobre una columna decimal.** Se traen
> las filas con un `SELECT` normal y se suma y se ordena en la aplicación, con
> las funciones de `money.ts`.

Vale para TODO reporte, presente y futuro, y no solo para los tres de este
prompt. Filtrar en SQL sí: `fecha`, `estado`, `forma_pago` y `activo` son texto
y enteros de verdad, y compararlos en la base es exacto y barato. Lo que no se
puede es **sumar, promediar, ordenar o sacar un mínimo** de una columna que
guarda dinero, peso o cantidad.

#### Las dos trampas, MEDIDAS

No es una precaución teórica. Está medido contra el SQLite que el proyecto
empaqueta, y la medición vive en una prueba que corre con `npm test`, de modo
que si una versión futura cambiara de comportamiento el proyecto se entera en
desarrollo y no en el mostrador.

| Lo que se pidió | Lo que devuelve SQLite | Lo correcto |
|---|---|---|
| `SUM()` de diez montos de dos decimales | `13.459999999999999` y `typeof = 'real'` | `13.46` |
| `SUM()` de cinco `subtotal_exacto` | `18.494999999999997`, que redondea a **Q18.49** | **Q18.50** |
| `ORDER BY` sobre cantidades | `10.000 100.000 2.500 85.000 9.000` | `2.500 9.000 10.000 85.000 100.000` |
| `MIN()` sobre esas cantidades | `10.000` | `2.500` |

**La primera trampa era conocida** y es la razón de ser de `money.ts` desde el
Prompt 1: la columna es TEXT, SQLite la convierte a REAL para poder sumarla, y
el punto flotante vuelve a entrar. Con montos ya redondeados a centavos el
desvío es minúsculo; **con valores SIN redondear —`subtotal_exacto`, que tiene
hasta diez decimales— llega a cambiar el centavo del reporte, y en contra de la
tienda.** Ese caso concreto está en las pruebas, con sus cinco números.

**La segunda trampa apareció construyendo estos reportes y no estaba anotada en
ninguna parte.** SQLite compara TEXT byte a byte, así que `'10.000'` va antes
que `'2.500'` porque `'1' < '2'`. El reporte de inventario se ordena ascendente
justamente **para ver primero lo que menos queda**: ordenado en SQL habría
puesto diez libras antes que dos y media, o sea exactamente al revés de para lo
que sirve, **y sin ningún síntoma visible**, porque la lista se ve ordenada.
Por eso la regla dice «ni ordena», no solo «ni agrega».

Hay además una **segunda red que ya existía**: `decimal-columns.ts` es la única
vía para leer estas columnas y se niega ruidosamente si la base devuelve un
número en vez de texto. Un reporte escrito con `SUM()` no daría un número
silenciosamente malo: se caería al leerlo. Pero la red no alcanza para el
`ORDER BY`, que devuelve texto perfectamente legible en el orden equivocado.

**En Postgres esto no aplica de la misma forma** —`NUMERIC` es decimal exacto
nativo y suma bien— pero los reportes leen de SQLite local, no de la nube, así
que la regla rige igual. El día que haya reportes del lado del servidor, esa
será otra decisión con su propia fila.

#### Qué se puede pedir: los períodos

| Período | Qué abarca |
|---|---|
| Hoy | El día de Guatemala en curso |
| Ayer | El día anterior, completo |
| Últimos 7 días | Siete días **contando el de hoy**, no los siete anteriores |
| Este mes | Del día 1 **hasta hoy**, no hasta fin de mes |
| Rango personalizado | Dos días elegidos, los dos inclusive |

**«HOY» ES EL DÍA DE GUATEMALA, NO EL DE UTC, y esto es una corrección de raíz
de un peligro que §4.13 ya tenía anotado.** `ventas.fecha` se guarda en UTC, que
es lo correcto para guardar, pero Guatemala es **UTC−6 todo el año** —no usa
horario de verano; medido con `Intl` en enero, julio y septiembre—. Comparando
sin convertir, **todas las ventas hechas después de las 18:00 se le atribuirían
al día siguiente**: en una tienda que cierra a las 19:00, el reporte de «hoy»
estaría bien a media tarde y mentiría de noche, que es la peor forma de estar
mal. La conversión vive en un solo módulo puro, `reportes/periodo.ts`, con sus
pruebas; no se escribe `date(fecha, '-6 hours')` dentro de cada consulta, porque
eso metería una regla del negocio en una cadena SQL donde nadie la ve.

El extremo `hasta` es **inclusivo hasta el último milisegundo del día**: una
venta de las 23:59 entra en el reporte de ese día. Con un límite exclusivo habría
que acordarse de sumar un día en cada consulta, y el día que alguien se olvidara
el reporte perdería las ventas del final de la jornada sin que nadie lo notara.

Una fecha que **no existe** —`2026-02-31`— se rechaza en vez de correrse en
silencio al 3 de marzo, que es lo que haría `Date.UTC`. Un reporte que corre
sobre un rango distinto del que se pidió, sin avisar, es peor que uno que se
niega a correr.

#### Los tres reportes

**1. Resumen de ventas.** Total vendido, cuántas transacciones, el desglose entre
efectivo y tarjeta, y los descuentos aplicados.

> **EFECTIVO + TARJETA DA EXACTAMENTE EL TOTAL**, y hay pruebas que lo exigen en
> cinco escenarios distintos, incluido uno con veinte ventas de montos que en
> punto flotante no cerrarían. Cada venta aporta su total a uno solo de los dos
> montones y las tres sumas salen de los mismos valores guardados.

**LOS DESCUENTOS SON UNA REFERENCIA, NO UN SUMANDO.** `ventas.total` ya viene
con el descuento aplicado —lo aplicó la transacción de la venta, una sola vez, y
es lo que el cliente pagó—, así que restarlo otra vez lo contaría dos veces. El
renglón contesta otra pregunta: cuánto se dejó de cobrar. La pantalla lo separa
del resto y lo dice con todas las letras, por la misma razón por la que el
recibo aclara que sus importes ya vienen descontados (§4.14).

> **CUIDADO AL LEERLO:** se suma `ventas.descuento_valor`, que guarda **el valor
> configurado**, no los quetzales que rebajó. Un descuento del 7.5 % suma 7.50 a
> este renglón aunque haya rebajado Q1.35. Sumar porcentajes con quetzales en un
> mismo número es una mezcla que el dato mismo arrastra; se informa tal cual
> porque es lo que se pidió, y queda anotado acá para que nadie lo lea como
> dinero. Si hiciera falta la rebaja real en quetzales, se deriva de
> `subtotal − total` como hace el recibo, y es un cambio de una línea.

**2. Ventas por producto.** Cantidad vendida y monto generado por cada producto
**en el período**, ordenado por monto descendente.

> **NO SE REUSAN `contador_ventas` NI `cantidad_vendida`**, y esta es la
> distinción central del reporte. Esas dos columnas guardan exactamente estas
> dos medidas, pero de **toda la vida del producto**, y no se pueden acotar:
> nadie guardó su valor al empezar el período. Existen para ordenar la
> cuadrícula de la pantalla de venta (§4.12). Usarlas acá daría el acumulado
> histórico bajo una etiqueta que dice «este mes», que es la clase de error que
> no se ve mirando el número: se ve recién cuando alguien suma doce reportes
> mensuales y no dan el año. Comparten los datos de origen; no son la misma
> pregunta. Hay pruebas que comparan las dos lecturas sobre las mismas ventas.

Se agrupa por `producto_id` y se muestra el nombre **ACTUAL** del catálogo, no
el `producto_nombre_snap` del comprobante. Es al revés que el recibo, a
propósito: el recibo es un documento histórico y no puede cambiar, mientras que
quien lee un reporte está mirando el catálogo de hoy y busca el producto por el
nombre que hoy tiene. Agrupar por id y no por nombre hace que renombrar un
producto nunca lo parta en dos filas.

**3. Estado de inventario.** Los productos activos con su saldo, su unidad y su
categoría, ordenable por nombre o por cantidad ascendente.

**NO HAY UMBRAL DE «STOCK BAJO» NI ALERTAS**, y es deliberado: cuál es el mínimo
de cada producto es una definición de negocio que Jimmy no dio, y un umbral
inventado convertiría una suposición nuestra en un aviso que parece una regla de
la tienda. Es un módulo futuro con su propio prompt.

#### Los cinco canales exigen rol administrativo

Los tres reportes y los dos de topes. Los reportes dicen cuánto entró a la
tienda y qué hay en bodega: es información de dueño, no de mostrador, y un
cajero necesita vender y reimprimir. Hay una prueba que **cuenta** los
`ipcMain.handle` del archivo y exige que haya tantos guards como canales, igual
que en el módulo de usuarios.

**La pantalla no calcula NADA.** Ni una suma, ni un orden, ni un porcentaje:
todos los números llegan resueltos del proceso principal. Si la ventana sumara,
lo haría con aritmética de punto flotante —ahí no hay Decimal— y el reporte
diría un número distinto del que dice la base. Es la misma razón por la que la
pantalla de venta no decide cuánto se cobra (§4.12).

**Los instantes exactos del período NO cruzan hacia la ventana**: viajan los dos
días y una etiqueta legible. Mandar las cadenas ISO invitaría a que alguna
pantalla futura hiciera su propia aritmética de fechas en vez de pedirle el
período al proceso principal, que es donde vive la regla de la zona horaria.

### 4.16 Topes de descuento: ya se configuran desde la aplicación

`limites_descuento` existe desde el Prompt 6 y el servicio de venta la respeta
desde el Prompt 19, pero hasta el Prompt 25 **la única forma de llenarla era
`npm run seed:limites`**: un guion de desarrollo, con valores fijos en el
código, que se corre desde una terminal. En la práctica eso quería decir que
Jimmy no podía cambiar el tope de su cajero sin que alguien le tocara la
computadora. Ahora hay pantalla, solo con rol administrativo.

**EL GUION SIGUE EXISTIENDO Y YA NO ES LA ÚNICA PUERTA.** Sirve para montar un
entorno de desarrollo nuevo de una sola vez; los valores que siembra siguen
siendo de prueba y **no** una definición del negocio (punto 15 de §6.2).

#### `editado_por` ahora se llena de verdad

Las filas que sembró el guion quedaron con `editado_por = NULL` **a propósito**:
no había ninguna persona detrás, y poner un usuario inventado habría sido
atribuirle a alguien una decisión que no tomó. Cuando el cambio lo hace una
persona desde la pantalla, la columna guarda su `usuario_id` real **y además**
queda un asiento `limite_descuento_fijado` en `auditoria_log`. Los dos registros
contestan preguntas distintas, y por eso van los dos:

| Dónde | Qué contesta |
|---|---|
| `limites_descuento.editado_por` | **Quién lo dejó así**, hoy |
| `auditoria_log` | **Quién lo cambió, cuándo y desde qué valor** |

La primera vez que se configura un rol, el valor anterior del asiento va `null`
y no un cero: decir «antes era 0.00» sería afirmar que alguien lo había
configurado en cero, y no es lo mismo que no haberlo configurado nunca.

#### Qué se valida, y qué NO se valida a propósito

**Solo se exige que los dos valores no sean negativos**, que es lo que el
esquema exige. El rechazo llega con mensaje de negocio antes de tocar la base
—«El porcentaje máximo no puede ser negativo. Poné 0 si ese rol no debe dar
descuento.»— y el CHECK sigue siendo la última red. Un rechazo **no deja la fila
a medias**: hay una prueba que comprueba que el valor válido no se cuela cuando
el otro se rechaza.

> **UN PORCENTAJE MAYOR QUE 100 SE ACEPTA, y la pantalla avisa sin bloquear.**
> No autoriza nada más que 100 —`totalConDescuento` ya tiene piso en cero— así
> que no es peligroso, solo inútil; y rechazarlo sería inventar una regla de
> negocio que Jimmy no confirmó. Se avisa con el mismo criterio del aviso de
> inventario de §4.12: informar sin estorbar. Queda como el punto 17 de §6.2.

#### La confirmación, y el defecto que apareció manejando la aplicación

Guardar pide confirmación y **muestra el número que se está por dejar puesto**,
con el mismo criterio del cierre de caja descuadrado (§4.9): subir un tope le da
a un rol la capacidad de rebajar sin pedirle permiso a nadie.

**CORREGIDO:** la primera versión se quedaba en el paso de confirmación cuando
el servicio rechazaba el valor. Los campos seguían visibles y editables, pero el
botón «Guardar» no existe en ese estado —ahí el botón dice «Sí, guardar este
tope»—, así que quien corrigiera el número se quedaba mirando una confirmación
que seguía repitiendo el valor rechazado. Ahora un rechazo **vuelve al paso de
edición** y el aviso aparece junto al botón que lo produjo, que es la regla de
§4.11. Lo encontró `npm run verify:pantallas`, no una prueba de Vitest: es
exactamente la clase de defecto que esa comprobación existe para atrapar.

### 4.17 Bandeja de salida transaccional (Fase 1.a de la sincronización)

**El diseño de `docs/SINCRONIZACION.md` quedó APROBADO el 2026-09-11** y se
implementa **por fases**. Esta sección describe la primera, que es lo único que
existe en el código.

#### Las 17 decisiones de la sección 7 del diseño quedan adoptadas

Se adoptan **con la recomendación del documento**, salvo dos:

| Decisión | Qué se resolvió |
|---|---|
| **10** — `traerCambios(desde)` en `SyncProvider` | Se resuelve **retirando el método de la interfaz**. La sincronización continua es solo de subida; bajar cambios sería tener dos escritores. **Va en la fase 1.b, no acá**: hoy la interfaz sigue intacta. |
| **11** — presupuesto de rendimiento | Queda **ABIERTA hasta medir en hardware real** (fase 3). Ningún número de rendimiento del documento se da por bueno antes de eso, porque la máquina de la tienda es un i3. |

Las otras quince se aplican tal como están escritas. Las dos que esta fase ya
ejecuta son la **4** (`ventas.estado_sincronizacion` no viaja) y la **17** (los
hashes de PIN no viajan).

#### Qué existe y qué NO existe

**Existe:** la migración `018_sync_cola_lotes` y el módulo
`src/main/database/bandeja-de-salida.ts`, que escribe en `sync_cola` **dentro
de la misma transacción** de cada operación de negocio.

**NO existe, y no se empezó:** el trabajador de sincronización, el
`SyncProvider` real, las credenciales, la detección de conexión, las políticas
de RLS y las funciones de Postgres. **Nadie lee la cola todavía**, así que la
cola se llena y no pasa nada más. Es deliberado: mientras nada la lea, un error
acá no puede subir un dato equivocado a ningún lado.

#### La regla que justifica el módulo entero

> **La fila de la cola se escribe DENTRO de la misma transacción que el dato de
> negocio.** No después, no en otra transacción, no «en cuanto se pueda».

Sin eso serían posibles las dos cosas que el patrón existe para impedir: una
venta cobrada que nunca se va a subir, porque el proceso murió entre el
`COMMIT` de la venta y el `INSERT` de la cola; o una entrada de cola que apunta
a una venta que no existe, porque murió al revés. **En este proyecto eso no es
una hipótesis remota: matar el proceso desde el sistema operativo es una vía de
escape permitida a propósito** (§4.5).

#### EL PAYLOAD SE LEE DE LA BASE, no se reconstruye desde la entidad

`armarPayload` hace un `SELECT *` de la fila recién escrita y serializa lo que
SQLite devuelve. **No** toma el objeto de dominio y lo vuelve a convertir.

Reconstruirlo obligaría a acertar, en cada una de las trece tablas y columna
por columna, cuál de las conversiones canónicas corresponde —`montoACadena`,
`cantidadACadena` o `aColumnaExacta`—. Equivocarse en una sola mandaría a la
nube un `2.5` donde la base tiene `2.500`, o peor, un número de JavaScript
donde la base tiene una cadena exacta. **Leyendo de la base no hay conversión
que pueda equivocarse, porque no hay conversión.** Los booleanos viajan como
los guarda SQLite, `0` o `1`.

#### El orden dentro del lote es PADRES ANTES QUE HIJOS, y no es cosmético

Todas las filas de una operación comparten `lote_id`, y `orden_en_lote` dice en
qué orden se van a subir. Subir `venta_detalle` antes que `ventas` lo rechaza la
llave foránea de Postgres, y el lote quedaría detenido con un error que no dice
nada del problema real.

| Operación | Qué encola, en orden |
|---|---|
| Registrar una venta | `productos` (uno por línea, `actualizar`) → `ventas` → `venta_detalle` → `auditoria_log` (dos asientos si hubo descuento autorizado) |
| Emitir un recibo | `recibos`, **una sola fila, en su propio lote** |
| Abrir la caja | `caja_sesiones` → `caja_sesion_denominaciones` → `auditoria_log` |
| Cerrar la caja | `caja_sesiones` (`actualizar`) → `caja_sesion_denominaciones` del cierre → `auditoria_log` |
| Crear, editar, cambiar el PIN o dar de baja a un usuario | `usuarios` → `auditoria_log` |
| Categoría, producto, ajuste de inventario, tope de descuento, configuración del negocio | la fila → `auditoria_log` |

#### Qué NO viaja, y por qué

| Se excluye | Razón |
|---|---|
| `usuarios.pin_hash` y `pin_remoto_hash` | Decisión 17. Un PIN de cuatro dígitos tiene 10 000 valores: quien lea la tabla en la nube los saca todos. Y no hacen falta allá, porque toda restauración resetea los PIN. |
| `usuarios.intentos_fallidos` y `bloqueado_hasta` | Estado operativo de esta terminal (§4.4). |
| `ventas.estado_sincronizacion` | Decisión 4. En la nube diría siempre `'pendiente'`, que allá no significa nada. |
| `denominaciones` (la tabla entera) | Las once del quetzal ya viven en la nube con los mismos UUID desde la `0004`. Nunca cambian. |
| `sync_cola`, `bloqueos_de_autorizacion`, `migraciones_aplicadas` | Subir la lista de pendientes junto con los pendientes no tiene sentido. |
| **Los archivos**: la foto del producto y el PDF del recibo | **Es la fase 3.c.** Hoy viaja la RUTA como dato de la fila, y nadie va a poder resolverla desde la nube: es de este disco. |
| Los cambios posteriores de `recibos.impreso` y `pdf_path` | El recibo se encola **una vez, al emitirse**. Si se imprimió acá y dónde quedó el archivo en ESTE disco es estado de la terminal (§2.3 del diseño). Una reimpresión no encola nada. |

#### `operacion` es `'actualizar'`, NO `'update'`

El diseño decía que `configuracion_negocio` se encola con `operacion='update'`.
**Ese valor no existe**: el CHECK de `sync_cola`, desde la migración 001, acepta
`'insertar' | 'actualizar' | 'eliminar'`, en español como el resto del dominio.
Se usa `'actualizar'`, que es lo mismo con el nombre que la base acepta. No es
una decisión de diseño distinta, es el nombre correcto de la misma.

#### ESTA FASE AGREGÓ LA PRIMERA TRANSACCIÓN A SEIS SERVICIOS

**El prompt pedía «reutilizá el punto de transacción existente en cada
servicio». Ese punto no existía en casi ninguno.** Medido antes de tocar nada:
el único servicio que recibía la conexión y abría una transacción era
`ServicioDeVenta`. Los otros seis —caja, categorías, productos, usuarios,
límites de descuento, configuración del negocio— escribían **su fila de negocio
y su asiento de auditoría como sentencias sueltas**, sin transacción.

Se les agregó una. Sin ella el patrón de bandeja de salida no ofrece ninguna
garantía, que es su única razón de ser. Y de paso **cierra un hueco de
atomicidad preexistente que nadie había mirado**: hasta hoy, matar el proceso
entre las dos escrituras dejaba una caja abierta sin el arqueo con que se
abrió, o un usuario dado de baja sin el asiento que dice quién lo hizo.

El envoltorio común es `conBandejaDeSalida`, para que los seis tengan
exactamente la misma forma. `ServicioDeVenta` **no lo usa**, y es correcto: su
transacción hace siete pasos antes de llegar a la cola, con reverificación de
caja y comparar-y-cambiar de inventario, y meterla en ese molde la haría menos
legible. `ServicioDeRecibos` tampoco: su transacción cubre el número y la fila,
y **deja el PDF y la impresión afuera a propósito** (§4.14).

#### `precios_especiales` no se encola, porque nada la escribe

El diseño la lista entre las tablas que se sincronizan y el prompt pedía
encolar «crear/editar precio especial». **En producción no hay nada que cree un
precio especial**: no hay servicio, ni canal IPC, ni pantalla. La tabla se llena
solo desde las pruebas. La venta SÍ los lee y los aplica (§4.13), así que la
funcionalidad existe a medias: se pueden consumir precios especiales, no
crearlos.

No se inventó un servicio para poder encolar algo. `precios_especiales` está en
la lista de tablas sincronizables del módulo, lista para el día que exista la
pantalla, y **queda anotado como pendiente** (punto 18 de §6.2).

#### `PRAGMA synchronous` está en FULL, verificado — y cómo NO verificarlo

El diseño asume `FULL` para que la cola sobreviva un corte de energía. **Lo
está.** `configurarConexion` lo fija en `src/main/database/connection.ts` y hay
una prueba que lo comprueba leyéndolo de una base real.

> **CUIDADO CON CÓMO SE MIDE, porque la medición ingenua da la respuesta
> equivocada.** `synchronous` es un pragma **POR CONEXIÓN** y **no se guarda en
> el archivo**. Abrir el `.db` de la tienda con una conexión nueva devuelve
> siempre `1` (NORMAL), que es el valor por omisión de SQLite, **sin importar
> qué use la aplicación**. `journal_mode` sí se persiste; `synchronous` no. Lo
> único que responde la pregunta es leerlo de la conexión que la aplicación
> abre.

#### Las cinco columnas de la migración 018

`lote_id`, `orden_en_lote`, `intentos`, `proximo_intento_en` y `bloqueante`,
cada una con su CHECK con nombre. **Las tres últimas no las usa nadie todavía**:
son para el trabajador de la fase 1.b. Se agregaron ahora porque una migración
aplicada no se edita, y porque el índice que el trabajador va a consultar
—`(creado_en, orden_en_lote) WHERE sincronizado_en IS NULL`— reemplaza al de la
001, que ordenaba solo por `creado_en` y dejaba el orden dentro del lote a lo
que devolviera el motor.


### 4.18 El trabajador de sincronización (Fase 1.b)

La fase 1.a llenó la cola. **Esta es la que la lee.** Sigue sin haber red: el
trabajador corre contra `SimulatedSyncProvider`, y lo que se construyó de
verdad es toda la lógica que no depende de Supabase —orden, reintentos,
detención, atomicidad frente a la venta— para que el día que exista el
adaptador real lo único que cambie sea qué devuelve `crearSyncProvider`.

#### Qué existe y qué sigue sin existir

**Existe:** `src/main/sincronizacion/` con tres piezas y una señal.

| Pieza | Qué decide |
|---|---|
| `trabajador.ts` | **Qué** se sube y **qué se hace con la respuesta**. |
| `reintentos.ts` | De qué clase es un fallo y cuánto se espera. Funciones puras. |
| `planificador.ts` | **Cuándo** corre el trabajador. |
| `domain/venta/venta-en-curso.ts` | La señal con la que el trabajador sabe que tiene que apartarse. |

**NO existe, y no se empezó:** el `SyncProvider` real, las credenciales, la
detección de conexión (§5 del diseño), las políticas de RLS, las funciones de
Postgres, los archivos (fase 3.c), la pantalla de sincronización y la
restauración. El trabajador está entero; lo que le falta es a quién hablarle.

#### `traerCambios` se retiró de `SyncProvider` — decisión 10, ejecutada

La interfaz lo tuvo desde el Prompt 1 y **nunca lo llamó nadie**. El diseño
decidió que la sincronización continua es **solo de subida** (§2.2): bajar
cambios contra una base que la terminal también escribe sería tener dos
escritores. Un método que existe invita a usarse, y el día que alguien lo
llamara estaría reintroduciendo la bajada que el diseño descartó **sin que nada
fallara**. Hay una prueba que comprueba que el método ya no está **en el
objeto**, no solo en el tipo: los tipos desaparecen al compilar.

**La restauración no se pierde por esto.** Es otra operación —completa y no
incremental, a pedido de un administrador y no en segundo plano, con
precondiciones propias (§6.2 del diseño)— y va a tener su propia interfaz en la
fase 4.b.

#### Las cuatro reglas del trabajador

**1. NO SALTEA NINGÚN LOTE.** Orden estrictamente de llegada, `creado_en` y
después el orden de inserción como desempate. Romperlo rompe las llaves
foráneas de Postgres: una venta referencia a un producto que pudo haberse
creado esa misma mañana sin conexión.

**2. UN LOTE BLOQUEANTE DETIENE LA COLA ENTERA, y no se reintenta solo.**
Saltarlo dejaría un hueco **silencioso** en el respaldo. Una cola detenida y
visible es un problema que alguien va a ver; un hueco silencioso es un problema
que nadie va a ver hasta el día del robo. Se desbloquea a pedido de una persona
—`desbloquearLote`—, y la pantalla que va a pedirlo es de una fase posterior.

**3. CEDE ANTE LA VENTA.** Ver abajo.

**4. NUNCA BLOQUEA EL PROCESO.** Un lote por iteración, pausa real entre lotes y
presupuesto por ciclo.

#### Cómo se detecta una transacción en curso, y por qué ceder no es cortesía

**Una bandera en memoria**, como especifica §2.4 del diseño. Vive en
`src/main/database/transaccion-en-curso.ts`.

> **NACIÓ ESPECÍFICA DE LA VENTA Y ESTABA MAL. Se generalizó a las ocho
> operaciones.** El peligro no tiene nada que ver con vender: es consecuencia de
> que la aplicación tenga **una sola conexión**, así que aplica igual a abrir y
> cerrar la caja, crear o editar un usuario, el catálogo, el ajuste de
> inventario, los topes de descuento, los datos del negocio y el recibo.
> Proteger solo la venta dejaba las otras siete con el mismo agujero y la falsa
> sensación de que estaba cubierto.

**La señal NO se levanta a mano en cada servicio.** Va dentro de
`enTransaccionDeNegocio(base, operacion)`, que es **la única forma en que este
proyecto abre una transacción de negocio**: la usa `conBandejaDeSalida` —y por
ella los seis servicios que se volvieron transaccionales en la fase 1.a— y la
usan directamente `ServicioDeVenta` y los dos métodos de `ServicioDeCaja`. No se
puede abrir una transacción sin señalizarla porque no hay dos caminos: quien se
olvide del envoltorio no «olvida la señal», directamente no abre transacción.
**Hay una prueba que revisa el código fuente** y exige que solo tres archivos
nombren `.transaction(`: el propio envoltorio, el migrador y los guiones de
datos de ejemplo. El riesgo que cubre no es el código de hoy, es el servicio que
alguien agregue el año que viene.

La señal se baja en un `finally`: si no lo hiciera, una operación fallida
dejaría al trabajador cediendo para siempre y la cola no volvería a subir nada,
en silencio.

**No se usa `base.inTransaction`** aunque exista y diga exactamente eso: solo es
verdad mientras el hilo está dentro de la transacción, y para cuando el
trabajador pudiera leerlo desde un temporizador la transacción ya terminó.

> **EL PELIGRO REAL NO ES LA CONTENCIÓN DE BLOQUEOS: ES QUE EL TRABAJADOR SUBA
> ALGO QUE NUNCA EXISTIÓ.** Con una sola conexión síncrona, un ciclo lanzado
> dentro de una transacción abierta **lee las filas que esa transacción todavía
> no confirmó**. Si después se revierte, la nube se quedó con un cambio que en
> la tienda no ocurrió. **Está probado en tres servicios distintos, no
> razonado**: hay falsificaciones que apagan la señal a propósito, lanzan el
> ciclo desde dentro de una transacción que después falla, y comprueban las dos
> cosas —que la fila no existe en la base y que la nube la recibió igual— para
> una categoría, para **la apertura de caja** y para **el alta de un usuario**.
> Cada una tiene al lado su contraparte con la señal puesta, donde la nube no
> recibe nada.

#### UNA sola comprobación, y por qué antes había dos

El trabajador pregunta `hayTransaccionDeNegocioEnCurso()` **una vez, al
principio de cada vuelta del bucle**, antes de leer la cola. Es síncrona y va
antes del primer `await`: el cuerpo de una función `async` corre síncrono hasta
ahí, así que en la primera vuelta la pregunta se contesta en el mismo turno del
bucle de eventos en que quien llamó invocó el ciclo.

**Hubo una segunda comprobación idéntica al principio de `ejecutarCiclo` y se
quitó.** No era defensa en profundidad: era duplicación, y se midió. Quitando
cada una por separado, **las 74 pruebas pasaban en los dos casos**; solo fallan
quitando las dos. La del bucle cubre por completo lo que cubría la otra, porque
corre antes de CADA lote, incluido el primero. Dos comprobaciones que ninguna
prueba puede distinguir son dos lugares donde tocar cuando esto cambie y una
sola prueba que se cree que protege dos cosas.

**Y se dice en voz alta lo que la posición en el bucle agrega hoy: cero.** Con
un solo hilo y una sola conexión síncrona, una transacción de negocio empieza y
termina dentro de un bloque síncrono, y la continuación de un `await` no puede
colarse ahí; es decir, la señal solo puede estar levantada si el ciclo se lanzó
desde adentro, que es la primera vuelta. Se deja en el bucle porque cuesta leer
un booleano y porque es el lugar correcto el día que la premisa cambie —un
observador asíncrono, una segunda conexión, un hilo aparte—. Con una sola
comprobación, **quitarla hace fallar dos pruebas**, que era lo que antes no
pasaba con ninguna de las dos.

#### Clasificación de fallos: la diferencia entre esperar y detenerse

| Clase | Códigos | Qué se hace |
|---|---|---|
| **Transitorio** | sin respuesta (red caída), 5xx, 429, 408, 425 | Se suma un intento, se agenda el reintento y **el lote queda intacto**. Sin límite de veces: una desconexión de una semana no es un error, es una desconexión. |
| **Determinístico** | 400, 403, 409, 422 y el resto de los 4xx | `bloqueante = 1`, se guarda el error completo y **la cola se detiene ahí**. |
| **De credencial** | 401 | **La cola NO se toca**: no se suma intento, no se agenda nada y no se bloquea. El lote es válido; lo que falta es una credencial. |

**La ausencia de código HTTP se lee como transitorio**, y es el caso más común
de todos: no hubo respuesta porque no hubo red. Clasificarlo al revés detendría
la cola cada vez que se cae el internet de la tienda.

#### La escalera de espera es la del diseño, con ±20 % de variación

5 s, 30 s, 2 min, 10 min, 30 min y de ahí en adelante **cada hora**. Crece de
forma exponencial pero con techo: una exponencial pura llegaría a días, y una
tienda que estuvo una semana sin internet tiene que volver a subir dentro de la
hora siguiente a que vuelva la conexión.

**La variación es de ±20 %, no «full jitter».** Con full jitter el primer
reintento podría caer a los pocos milisegundos, o sea no esperar nada, que es lo
contrario de lo que un backoff existe para hacer.

`intentos` y `proximo_intento_en` **se persisten** en `sync_cola`. Si vivieran
en memoria, un cierre forzado —que este proyecto permite a propósito (§4.5)—
reiniciaría el backoff y la aplicación martillaría un servidor que ya dijo que
no puede.

#### Todo el estado vive en la base, ninguno en memoria

Es lo que hace que cortar el proceso a mitad de un lote no pierda ni duplique
nada. No hay contador de intentos en memoria, ni lote «en vuelo» recordado, ni
temporizador cuyo vencimiento se pierda: al arrancar, el trabajador lee la cola
y retoma exactamente donde estaba.

**La confirmación de un lote es idempotente por construcción**: el `UPDATE`
lleva `WHERE sincronizado_en IS NULL`, así que confirmar dos veces el mismo lote
no pisa la marca original ni toca nada. Confirmar dos veces no es hipotético: es
lo que pasa cuando la respuesta de la nube llega después de que la terminal la
dio por perdida. Del lado de la nube, el upsert por clave primaria hace el resto
(§3.1 del diseño).

#### El presupuesto por ciclo y la cadencia

| Límite | Valor | De dónde sale |
|---|---|---|
| Lotes por ciclo | 20 | §2.4 |
| Duración del ciclo | 30 s | §2.4 |
| Pausa entre lotes | 250 ms | §2.4 |
| Descanso tras agotarlo | 60 s | §2.4 |
| Filas por lote, de referencia | 50 | §2.4 |

> **UN LOTE DE NEGOCIO MÁS GRANDE QUE 50 FILAS SE SUBE ENTERO IGUAL.** Partirlo
> reintroduciría la ventana que la opción B de §4.3 eliminó: la nube podría
> quedar con una venta sin la mitad de sus líneas, indefinidamente, si la
> segunda llamada fallara. El número queda como referencia para el día que
> existan lotes de agrupación —los archivos de la fase 3.c— que sí se pueden
> partir. Hay una prueba con un lote de 60 filas.

**No hay intervalo fijo**, y esa es la decisión (§5.3): un ciclo corre **cuando
tiene sentido**. Con la cola vacía no se agenda nada, porque una máquina al día
no tiene por qué gastar un ciclo —ni un byte, cuando haya red— en preguntar si
podría subir algo que no tiene.

| Disparador | Espera | Estado |
|---|---|---|
| Al confirmar una transacción local | 2 s, agrupando las ráfagas | implementado |
| Al arrancar la aplicación | 30 s tras abrir la ventana | implementado |
| Respaldo mientras haya pendientes | 5 min como tope | implementado |
| Tras agotar el presupuesto | 60 s | implementado |
| Al despertar de suspensión | 15 s | **el método existe; nadie lo llama** |
| Al detectar conexión | — | **fase con red** |

Los dos últimos dependen de piezas que esta fase no construye, y se dicen así en
vez de simularlos: un disparador falso que parece funcionar es peor que uno que
falta y se ve que falta.

**Los 2 segundos tras el COMMIT son para no competir con el recibo**, que se
está generando en ese mismo momento (§4.14). Y **agrupan**: tres ventas seguidas
disparan un ciclo, no tres, porque cada aviso reinicia la cuenta.

**El aviso sale de un solo lugar**, `observarLotesEncolados` en la bandeja de
salida, que es el único código que escribe la cola. El observador corre **dentro
de la transacción**, así que lo único que puede hacer es agendar un
temporizador: si tocara la base, su escritura entraría en esa transacción. Si la
transacción se revierte, el ciclo agendado no encuentra nada y termina; el costo
es una consulta que devuelve cero filas, y el beneficio es que avisar desde el
único lugar que escribe hace imposible olvidarse de avisar.

**Al cerrar, la sincronización se DETIENE, no se apura.** Intentar vaciar la
cola antes de cerrar dejaría la salida controlada esperando a una red que puede
no estar, justo cuando alguien pidió cerrar el punto de venta. No hace falta:
la cola vive en SQLite y el trabajador retoma en el próximo arranque.

#### Cómo se probó que no bloquea la interfaz

**Con un latido, no con una afirmación.** Durante un ciclo de 20 lotes corre un
`setInterval` de 1 ms que anota la hora de cada latido, y la prueba mide el
**hueco más largo** entre dos latidos consecutivos. En el proceso principal de
Electron, el mismo hilo que corre el ciclo atiende el IPC de la ventana: si el
ciclo lo ocupara sin soltar, el latido se detendría y la caja quedaría
congelada.

Un ciclo sano da **2 ms** de hueco máximo, de forma reproducible; el umbral se
fijó en 15 ms. **Se comprobó que muerde**: reemplazando la pausa por una espera
ocupada de 20 ms —el bucle girando sin soltar— la prueba falla con
«expected 21 to be less than 15».

#### El cableado en la aplicación REAL, verificado con evidencia

No alcanzaba con que compilara. Se corrió `npm run dev` dos veces, esperando 50
segundos cada vez, contra la base de datos real de la máquina de desarrollo.

**Primer arranque** —la base pasó de la migración 015 a la 018 en ese mismo
momento, y `sync_cola` estaba vacía:

```
[sincronizacion] trabajador en marcha con SimulatedSyncProvider; primer ciclo
                 en 30 s. Pendientes en la cola: 0 filas en 0 lotes.
[sincronizacion] ciclo: sin_pendientes; 0 lotes, 0 filas, 1 ms
```

**Segundo arranque**, con una fila sembrada a mano en `sync_cola` para que
hubiera algo que subir —se borró después, y `sync_cola` quedó otra vez en cero:

```
[sincronizacion] trabajador en marcha con SimulatedSyncProvider; primer ciclo
                 en 30 s. Pendientes en la cola: 1 filas en 1 lotes.
[sincronizacion] ciclo: cola_vaciada; 1 lotes, 1 filas, 257 ms
```

**La prueba fuerte no es el renglón: es la fila de la base.** Después del
segundo arranque, `sincronizado_en` quedó escrito en la base real. Esa marca
**solo se escribe cuando `empujarCambios` devuelve `ok`**, así que es la
evidencia de que el `SimulatedSyncProvider` se llamó de verdad dentro del
proceso de Electron. Los 257 ms son la pausa de 250 ms entre lotes, visible.

**Todo ciclo queda en la bitácora TÉCNICA**, `log-tecnico.log`, nunca en
`auditoria_log`: que la nube esté al día o no es infraestructura, y ensuciar con
eso la única tabla que un auditor lee entera es el error que §4.14 ya rechazó
para los fallos de impresión.

> Sigue valiendo la regla de siempre: **esto se verificó en macOS, y macOS no es
> verificación.** Windows es la plataforma de producción.

### 4.19 Un proyecto de Supabase descartable, y las migraciones que solo existen en la nube (Fase 2.a)

**Qué se hizo el 2026-09-11.** Se creó `pos-pruebas-descartable` (referencia
`ztidrshifrblhfraiowg`, `us-east-2`, plan gratuito), se le aplicaron **desde los
mismos archivos** las migraciones del esquema, y recién después se escribieron y
probaron allí las cuatro de esta fase, antes de que Julio aprobara aplicarlas al
real. Es lo que §9.5 del diseño exige: nada que toque la nube se prueba por
primera vez en `pos-jimmy-cano`. Costó pausar `dembow-ay-lupita`, ajeno a este
trabajo, porque el plan gratuito permite dos proyectos activos.

| Migración | Qué hace | Por qué no tiene espejo local |
|---|---|---|
| `0019_recibido_en` | Columna `recibido_en TIMESTAMPTZ NOT NULL DEFAULT now()` y un trigger `BEFORE INSERT OR UPDATE` que la fija con el reloj del servidor, en **doce** tablas | Es la única fecha que el cliente no controla. En SQLite, toda fecha la controla el cliente. |
| `0020_quitar_estado_sincronizacion` | Quita `ventas.estado_sincronizacion` de Postgres | Es estado operativo de la terminal (decisión 4). En SQLite sigue. |
| `0021_quitar_hashes_de_pin` | Quita `usuarios.pin_hash` y `pin_remoto_hash` de Postgres | Decisión 17: la nube no los necesita, y son 10 000 valores posibles. En SQLite siguen: son el ingreso. |
| `0022_fijar_search_path_auditoria` | Le fija `search_path = ''` a `auditoria_log_es_inmutable` | El cambio estaba en el real desde el 2026-09-05 **sin archivo**; lo delató el proyecto de pruebas al comparar los dos catálogos. |

**`denominaciones` no lleva `recibido_en`, y fue una corrección de Julio**: la
terminal nunca la escribe —las once del quetzal viven en la nube desde la
`0004`—, así que una marca de recepción ahí sería una columna que nunca
significa nada. Doce tablas, no trece.

**Los huecos de numeración tienen DOS direcciones**, y el README de
`supabase/migrations` las distingue con sus dos tablas: locales sin espejo
(002, 003, 006, 011, 013, 018: estado operativo de la terminal) y de la nube
sin espejo (0019 a 0023). Un número usado en una dirección queda reservado en la
otra.

Evidencia leída del catálogo, no del archivo: la huella md5 de todas las
columnas con tipo y nulabilidad dio `d85af488732d5874cd87844d2039713d` **en los
dos proyectos** después de aplicarlas; 13 tablas, 127 columnas, 50 CHECK, 13
triggers, 0 políticas. Los tres `DROP COLUMN` pasaron sin `CASCADE` y con
`usuarios` en 0 filas.

### 4.20 Las funciones de sincronización de la nube (Fase 2.b)

**Construidas y probadas en `pos-pruebas-descartable`, y desde el 2026-09-12
aplicadas también en `pos-jimmy-cano`**, con la aprobación explícita de Julio.
El registro de `schema_migrations` de los DOS proyectos guarda byte a byte el
archivo del repositorio (mismo md5, sin el salto de línea final), y las trece
definiciones de función del real son idénticas a las del de pruebas, comparadas
con `md5(pg_get_functiondef(oid))`. Ver la tabla de evidencia en §4.4.

#### El riesgo 8.4 se midió, y cambió el diseño

El diseño asumía que `INSERT ... ON CONFLICT DO NOTHING` bajo RLS no exige
política de `SELECT`, y sobre eso apoyaba los upserts directos de la terminal.
**Se midió y es falso**: como `authenticated` con los claims de la terminal y
una política de solo `INSERT`, Postgres rechaza con `42501` («new row violates
row-level security policy») **aunque no haya conflicto**; con `INSERT` +
`SELECT` pasa; `DO UPDATE` exige además `UPDATE`. Medido en SQL directo con
`SET LOCAL ROLE authenticated` y `request.jwt.claims`, y confirmado por
PostgREST. Como pedía el prompt, se detuvo el trabajo y se avisó.

Darle `SELECT` a la terminal sobre `ventas`, `venta_detalle`, `recibos` y
`auditoria_log` es exactamente lo que §1.5 del diseño evita —con la credencial
robada se leería toda la auditoría—, así que Julio aprobó la salida que el
propio 8.4 preveía: **todo lote sube por una función `SECURITY DEFINER` con la
forma exacta de su operación, y la terminal no tiene política directa sobre
ninguna tabla.** Lo único que las políticas de 2.c van a conceder es `SELECT`
al rol `restauracion`.

#### Las seis funciones de la `0023`

| Función | Lote que recibe, en orden | Regla de conflicto, decidida POR TABLA |
|---|---|---|
| `sincronizar_usuario` | `usuarios` → `auditoria_log` | usuarios: actualizar; auditoría: **ignorar**. Rechaza cambiar `creado_en`, un rol inexistente y dejar cero administradores activos |
| `sincronizar_apertura_de_caja` | `caja_sesiones` (insertar, `abierta`) → desglose de apertura → `auditoria_log` | todas: ignorar. Una caja que ya existe con OTRA apertura se rechaza |
| `sincronizar_cierre_de_caja` | `caja_sesiones` (actualizar, `cerrada`) → desglose de cierre → `auditoria_log` | la única transición, `abierta → cerrada`. No cambia quién abrió, con cuánto ni cuándo; un cierre ya hecho con otros números se rechaza |
| `sincronizar_venta` | `productos`… → `ventas` → `venta_detalle`… → `auditoria_log`… | productos: actualizar; el resto: ignorar. **Es DEFINER**, no INVOKER como preveía §4.3 del diseño, por el 8.4 |
| `sincronizar_lote_simple` | UNA fila de `categorias`, `productos`, `precios_especiales`, `limites_descuento`, `configuracion_negocio` o `recibos` → `auditoria_log`… | actualizar para el catálogo, los topes y la configuración; ignorar para recibos y auditoría. **Lista cerrada**: cualquier otra tabla se rechaza por nombre |
| `contrato_de_sincronizacion` | — | Solo lectura, solo rol `restauracion`, y **`SECURITY INVOKER`**: lee `pg_catalog`, que no tiene RLS, así que no necesita pasar por encima de nada |

Las tres reglas de §9.1 del diseño se cumplen: **no calculan nada de negocio**,
**no enumeran columnas** (`jsonb_populate_record` sobre el tipo de la tabla,
leído al ejecutar) y **cada llamada lleva `version_de_contrato`**, que se
compara con `version_del_contrato_de_sincronizacion()` —hoy `1`; la constante
local vive en `src/shared/contrato-de-sincronizacion.ts`— y falla diciendo los
dos números.

#### El endurecimiento de §1.5.1, punto por punto, confirmado en el catálogo

| Punto | Cómo está, y cómo se comprobó |
|---|---|
| `SET search_path = ''` | En las trece funciones de la nube, ayudantes y triggers incluidos: `proconfig = {search_path=""}`. La prueba de deriva falla si alguna lo pierde. |
| `REVOKE` de `public` y `anon`; `GRANT` solo a `authenticated` | `proacl` de las cinco de escritura: `postgres`, `authenticated`, `service_role`; sin `anon` ni la entrada de `public`. Los cuatro ayudantes internos ni siquiera a `authenticated`: «permission denied for function escribir_fila» como terminal. |
| Chequeo de `app_metadata.rol` en la primera línea | Con `is_anonymous = false` además. Veinticuatro llamadas con credenciales equivocadas —anon, sin rol, restauracion, y un anónimo con rol terminal— dieron `42501`. |
| Nombres calificados por esquema | `public.x`, `auth.jwt()`, `pg_catalog.pg_attribute`. Las funciones incorporadas no se prefijan porque `pg_catalog` se busca siempre primero, aun con el camino vacío. |
| Nunca `EXECUTE` con texto del payload | Hay UN solo `EXECUTE`, en `escribir_fila`: su texto lleva el nombre de la tabla —un `regclass` elegido de una lista literal— y columnas leídas de `pg_attribute` citadas con `%I`; el payload viaja como parámetro `$1`. |
| Lista cerrada de tablas por función | Un `CASE` por nombre literal en cada función. `sincronizar_lote_simple` rechazó `ventas`, `usuarios` y `auditoria_log` como fila principal, con el nombre en el mensaje. |

**`auditoria_log` es siempre `DO NOTHING`, y se distingue POR TABLA, no con una
regla genérica.** `escribir_fila` no tiene valor por omisión: quien llama dice
`'actualizar'` o `'ignorar'` fila por fila. Se comprobó el porqué como control:
un `ON CONFLICT DO UPDATE` sobre un asiento existente, ejecutado como
`postgres`, dispara `auditoria_log_prohibir_cambios` y aborta.

#### Idempotencia reconciliada con los rechazos

Repetir el MISMO lote es un no-op que devuelve `sin_cambios` / `ya_existia`
**con la misma huella**; mandar OTRO lote con el mismo id se rechaza. «Mismo» se
decide comparando la fila tipada del payload con la guardada, sin `recibido_en`.
Cada función devuelve una constancia por fila —resultado, huella md5 y
`recibido_en`— para que la terminal y las pruebas afirmen sobre el estado sin
leer las tablas, que es lo que la terminal no puede hacer.

Dos reglas que salieron de medir, no de diseñar:

- **Las columnas `jsonb` reciben el texto JSON de SQLite ya parseado.**
  `jsonb_populate_record` copiaría la cadena tal cual —un jsonb que contiene un
  texto— y `auditoria_log.valor_nuevo` quedaría inservible. La regla es por
  TIPO de columna leído del catálogo, no por nombre.
- **Un payload que traiga `recibido_en` se rechaza con nombre.** La batería lo
  encontró: pasaba, y el trigger lo pisaba en silencio, que es lo que §9.1
  prohíbe.

#### `npm run verify:nube`: la única prueba de las funciones, y el seguro

Vitest no sabe nada de Postgres, RLS ni `auth.jwt()`. El guion
`scripts/verificacion-de-nube.cjs` habla con un proyecto real por PostgREST,
con los tres usuarios de Auth del proyecto de pruebas y sus JWT reales. Las
credenciales salen de `.env.nube-pruebas` (ignorado por git; plantilla en
`.env.nube-pruebas.ejemplo`); ninguna viaja en la aplicación.

| Modo | Qué hace |
|---|---|
| sin argumentos | Mitad B de la prueba de deriva: llama a `contrato_de_sincronizacion()` como `restauracion` y compara con `supabase/esquema-nube.json`. No escribe nada. |
| `--tomar-foto` | Escribe esa foto. Se corre a propósito cuando la nube cambió de verdad, y el archivo se revisa en el commit. |
| `--destructivo` | La batería: **136 comprobaciones** (67 de la fase 2.b más 69 de la 2.c). Vacía las tablas con la `service_role` del proyecto de pruebas, o salta ese paso con `--reinicio-hecho` si se vaciaron por SQL. |
| `--esperar-vencimiento` | Espera a que venza el JWT de la terminal y comprueba que PostgREST lo rechace. |

Códigos de salida: 0 bien, 1 alguna comprobación falló, 2 faltó algo para poder
verificar, 3 el seguro se negó.

**El seguro no es opcional.** `scripts/proyectos-de-prueba.cjs` tiene la lista
FIJA (`['ztidrshifrblhfraiowg']`) y la referencia del real escrita aparte para
negarla POR NOMBRE, antes de mirar la lista; compara además la URL con la
referencia; y se niega ante cualquier proyecto si la lista llegara a contener el
real. Diez pruebas de Vitest lo ejercitan cargando el mismo archivo que usa el
guion, y una comprueba que el guion lo llame antes de crear el cliente de red.
**Se probó que muerde** corriendo el guion real con la referencia de
`pos-jimmy-cano`, con la URL del real y con una referencia ajena: código 3 las
tres veces, sin una sola petición.

Resultado de esta fase contra el proyecto de pruebas: **67 de 67** una vez
puesto el JWT en 900 s; antes de eso fallaba una, «el JWT dura 900 s», a
propósito. Con la fase 2.c la batería creció a **136** (§4.21). Lo que la
batería probó, y que ninguna prueba local puede probar: las puertas cerradas (401 con la
llave publicable sola; 403 para sin rol, para restauracion y para la terminal
fuera de su función); el invariante de administradores; la transición única de
la caja; el rechazo de un cierre con otros números; la atomicidad de la venta
(un `CHECK` que falla en `ventas` deja la nube sin la venta: el recibo posterior
no la encuentra, `409`); que la terminal no lee, ni actualiza, ni borra ninguna
tabla directamente, aunque acabe de escribir en ella; y `recibido_en` con el
reloj del servidor. Antes, la misma batería se corrió en SQL directo —91
mediciones con `SET LOCAL ROLE authenticated` y los claims de cada rol— y las 91
dieron lo esperado, incluido que un lote rechazado no deja ni un asiento.

**Lo que NO se ejercitó:** el reinicio con `service_role` por PostgREST. No hay
`service_role` del proyecto de pruebas en esta máquina —Julio la pone a mano si
quiere que el guion vacíe por su cuenta— y las corridas se hicieron vaciando por
SQL y con `--reinicio-hecho`. Ese código está escrito y no visto correr.
`auditoria_log` no se puede vaciar por PostgREST ni con `service_role`: es
inmutable por trigger; se trunca por SQL.

#### La prueba de deriva, en sus dos mitades

- **Mitad A, `deriva-de-esquema.test.ts`, en cada `npm test`, sin red**: compara
  el esquema de SQLite —aplicando todas las migraciones— con la foto. Las
  exclusiones salen de UNA sola fuente, `COLUMNAS_EXCLUIDAS` de la bandeja de
  salida, más `recibido_en` del lado de la nube. Cubre las cinco funciones de
  escritura (DEFINER, `search_path`, firma), el contrato (INVOKER), los cuatro
  ayudantes, la versión de contrato y las listas cerradas. 54 pruebas.
- **Mitad B, `verify:nube`, con red**: lo que la nube declara contra la foto.

**Se comprobó que muerden** con una foto manipulada —sin `ventas.total`, con
`ventas.propina`, `sincronizar_venta` como INVOKER y contrato 2—: la mitad A cae
en tres pruebas nombrando cada cosa, y la mitad B imprime las cuatro
diferencias y sale con código 1.

#### Pendiente, y por qué

- **JWT de 15 minutos: CERRADO EN LOS DOS PROYECTOS, y medido en los dos.** No
  se puede cambiar desde el conector —llega solo a la base— ni desde el código:
  es configuración de Auth. Se cambia en el panel, Project Settings → JWT Keys →
  Legacy JWT Secret → «Access token expiry time», a `900`. **Hecho en
  `pos-pruebas-descartable` el 2026-09-12** y **en `pos-jimmy-cano` el
  2026-09-13**, este último medido por Julio acuñando un token real del proyecto
  real: `expires_in = 900`, `exp - iat = 900` (§4.4).
  - **Y se comprobó que el token de verdad DEJA de servir**, no solo que dice
    durar 900 s, corriendo `--esperar-vencimiento` contra el proyecto de
    pruebas. Es la mitad que faltaba: `expires_in` es lo que el emisor promete,
    y esto es lo que el verificador hace.
  - **POSTGREST TOLERA ~30 SEGUNDOS DE RELOJ DESPUÉS DE `exp`, Y ESO HIZO
    FALLAR LA SONDA LA PRIMERA VEZ.** Ver el detalle en §4.22. El fallo era del
    guion, no de la nube.
- **Revocar los privilegios de tabla a `anon` y `authenticated`**, migración
  `0024`. **Escrita y medida en `pos-pruebas-descartable`, y aplicada también en
  `pos-jimmy-cano` el 2026-09-12** (evidencia en §4.4). Leído del catálogo
  de los DOS proyectos: Supabase concede por omisión a los dos roles TODOS los
  privilegios de tabla —en Postgres 17 son OCHO: `SELECT, INSERT, UPDATE,
  DELETE, TRUNCATE, REFERENCES, TRIGGER` y `MAINTAIN`—, y lo mismo a toda tabla
  nueva. Hoy los frena RLS con cero políticas, y la batería lo midió; pero es
  una sola capa, y `TRUNCATE` ni siquiera pasa por RLS. La `0024` deja a `anon`
  sin ningún privilegio y a `authenticated` con `SELECT` y nada más, que la
  restauración necesita porque terminal y restauración son el MISMO rol de
  Postgres. Las funciones DEFINER corren como `postgres` y no dependen de esos
  privilegios. La tabla vigente de políticas está en §2.3 del diseño.
  - **`MAINTAIN` (Postgres 17) fue el detalle que casi se escapa.** La primera
    versión enumeraba seis privilegios en el `REVOKE` y dejaba `MAINTAIN`
    puesto: no aparece en `information_schema.role_table_grants`, sí en
    `pg_class.relacl` (la letra `m`). Se vio leyendo `relacl` tras aplicarla. La
    versión definitiva escribe `REVOKE ALL` y vuelve a conceder solo `SELECT`,
    así que cualquier privilegio que Postgres agregue mañana queda revocado sin
    tocar el archivo.
  - **Lo que la `0024` NO cubre:** `pg_default_acl` tiene además un juego de
    privilegios por omisión del rol de plataforma `supabase_admin`, del que
    `postgres` no es miembro y no puede alterar. No afecta a este esquema —sus
    trece tablas y toda migración del repositorio corren como `postgres`—, pero
    una tabla creada por otra vía llegaría con esos privilegios y habría que
    revocárselos a mano.
  - **Medido, antes y después de la `0024`, con el criterio de que nada de
    función cambie:** el arnés SQL de 91 mediciones dio 90 de 93 filas idénticas
    —las dos únicas que cambian son los marcadores de estado de privilegios y la
    sonda 152, que pasa de «viola RLS» a «permission denied», mismo `42501`—, y
    la batería PostgREST da 67/67. Sus únicas sondas que cambiaron son las tres
    de acceso directo (403 para la terminal, 401 para la llave publicable, las
    dos «permission denied»); las 64 de función, idénticas.
- **Aplicar la `0023` a `pos-jimmy-cano`** y escribir las políticas de
  `restauracion`: fase 2.c.
- **El enrutador de lotes** —qué función llama el `SyncProvider` real para cada
  lote— es de la fase 3. Un detalle para ese día: un lote que empieza por
  `productos` puede ser una venta o un lote simple; se distingue por si trae una
  fila de `ventas`, no por la primera tabla.

### 4.21 Las políticas y los archivos (Fase 2.c)

**Escritas y probadas en `pos-pruebas-descartable`, y aplicadas también en
`pos-jimmy-cano` el 2026-09-13**, con la aprobación explícita de Julio y por la
vía de siempre: SQL a la vista primero.

> **LO QUE FALTA NO ES UNA MIGRACIÓN: ES UN PASO MANUAL, Y SIN ÉL ESTO NO SIRVE
> DE NADA.** Las trece políticas conceden lectura a quien traiga
> `app_metadata.rol = 'restauracion'` en su JWT, y **hoy `pos-jimmy-cano` tiene
> CERO usuarios de Auth**. Medido en el real, simulando los claims sobre
> `denominaciones`, que tiene sus 11 filas:
>
> | Quién consulta | Qué ve |
> |---|---|
> | Un autenticado sin rol | 0 de 11 |
> | Un autenticado con rol `terminal` | 0 de 11 |
> | Un autenticado con rol `restauracion` pero anónimo | 0 de 11 |
> | Un autenticado con `app_metadata.rol = 'restauracion'` | **11 de 11** |
> | La llave publicable sola | `42501 permission denied` |
>
> Es decir: la política funciona, y **no le sirve a nadie hasta que el usuario
> exista y tenga ese claim**, que se pone desde el panel (§1.7, punto 4).

##### El usuario de restauración del real: cómo se marcó, y qué se comprobó

**Hecho el 2026-09-13.** Julio creó `julioes134@outlook.es` desde el panel, con
su contraseña y ya confirmado; la marca de rol se puso por SQL, porque la API de
administración habría exigido la `service_role` del proyecto REAL, que por regla
del proyecto nunca está en manos de esta sesión.

```sql
UPDATE auth.users
   SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('rol', 'restauracion'),
       updated_at = now()
 WHERE email = 'julioes134@outlook.es';
```

**El `||` no es un detalle de estilo.** GoTrue pone `provider` y `providers` en
`app_metadata` al registrar al usuario, y las usa. Un `SET raw_app_meta_data =
'{"rol":"restauracion"}'` las habría borrado. Antes de la actualización la fila
tenía `{"provider":"email","providers":["email"]}`; después quedó con las tres
claves. **Y el valor va sin tilde**: las políticas comparan contra el literal
`'restauracion'`, así que `restauración` habría devuelto cero filas sin ningún
error visible.

**La comprobación fuerte no es que el texto guardado se parezca al esperado.**
Se tomó el `app_metadata` REAL de la fila, se armaron los claims con él y se
recorrieron las trece tablas bajo las políticas: 11 en `denominaciones`, 1 en
`configuracion_negocio` y 0 en las once que están vacías en producción.

> **EL ÚLTIMO ESLABÓN, CERRADO.** Lo anterior prueba que lo guardado alcanza
> para que la política deje pasar. Lo que faltaba era que **GoTrue copiara
> `raw_app_meta_data` al claim `app_metadata` del JWT que acuña**, y eso exige
> iniciar sesión con la contraseña, que esta sesión no maneja. Lo corrió Julio
> el 2026-09-13 con el comando preparado acá, contra el proyecto real, y el
> token trajo `app_metadata.rol = restauracion` e `is_anonymous = false`. La
> cadena entera está medida de punta a punta: fila, claim y política.

| Migración | Qué crea |
|---|---|
| `0025_politicas_de_restauracion` | Una política `FOR SELECT` para el rol `restauracion`, sobre cada una de las 13 tablas. **Nada más.** |
| `0026_storage_de_archivos` | Los buckets privados `fotos` y `recibos`, y tres políticas sobre `storage.objects`. |

#### Para la terminal no hay ninguna política, y eso NO es un olvido

La tabla vigente de §2.3 del diseño dice «nadie» para la terminal en las trece
columnas de escritura y de lectura. La versión anterior de esa tabla —la que le
dejaba `INSERT`/`UPDATE`/`SELECT` directos al catálogo, **decisión 14**— quedó
**superada por la medición del riesgo 8.4** en la fase 2.b, y el propio §7 del
diseño marca esa decisión como superada. Los dos motivos están medidos:

1. `INSERT ... ON CONFLICT DO NOTHING` bajo RLS **exige política de `SELECT`
   aunque no haya conflicto**. Todo lote de catálogo lleva su asiento de
   `auditoria_log`, así que un camino directo obligaría a darle a la terminal
   `SELECT` sobre la auditoría entera: lo que §1.5 existe para impedir.
2. Desde la `0023`, el catálogo ya se escribe por `sincronizar_lote_simple`,
   que escribe la fila y su asiento en una sola transacción. Conceder además
   `UPDATE` directo crearía un SEGUNDO camino de escritura para las mismas
   tablas, sin auditoría y sin la lista cerrada.

#### Después de la `0024`, una política solo puede decidir QUIÉN LEE

`authenticated` tiene un único privilegio de tabla, `SELECT`. Un `INSERT`,
`UPDATE`, `DELETE` o `TRUNCATE` de cualquier usuario autenticado muere antes de
llegar a RLS, con «permission denied for table». `anon` no tiene ninguno. Por
eso la `0025` no escribe políticas de escritura: serían reglas para un camino
ya cerrado, y darían la falsa impresión de que ese camino existe.

**La condición es una sola, y hay una comprobación que lo exige.** Las trece
políticas se crean con el texto idéntico —rol en `app_metadata`, envuelto en
`select` como pide §1.2, y `is_anonymous` con `coalesce(..., false)`, la misma
forma exacta que usan las cinco funciones de la `0023`—, y
`SELECT count(DISTINCT qual) FROM pg_policies WHERE schemaname='public'` tiene
que dar **1**.

#### Storage: dos buckets privados, y un permiso que a propósito no está

| | `fotos` | `recibos` |
|---|---|---|
| Público | **No** | **No** |
| Límite de tamaño | 5 MB, de §4.11 | sin límite propio |
| Tipos | `image/jpeg`, `image/png`, de §4.11 | `application/pdf` |
| La terminal | **Sube, y nada más** | **nada** |
| La restauración | Lee | Lee |
| La llave publicable | **nada, y con dos capas** | **nada, y con dos capas** |
| Borrar | nadie | nadie |

**La terminal no tiene permiso sobre `recibos`, y es deliberado.** §2.5.3 del
diseño recomienda **no subir los PDF**: son dato derivado que la reimpresión
regenera desde las filas, y subirlos llena el gigabyte del plan gratuito en
unos ocho meses. Esa decisión es de Jimmy y de Julio y **todavía no está
tomada**, así que rige el valor por omisión del proyecto: el permiso que no se
pidió, no se concede. El bucket se crea igual para fijar la convención de rutas.

**Que la terminal no lea las fotos que sube es la forma correcta**, no una
limitación: §2.5.2 dice que una foto en una ruta es inmutable —una foto nueva
recibe un UUID nuevo— y que se sube SIN `x-upsert`. Medido contra la nube: una
segunda subida a la misma ruta contesta `KeyAlreadyExists`, que el diseño lee
como éxito de un reintento, y con `x-upsert` la rechaza RLS porque no hay
`UPDATE`.

> **UN BUCKET NO SE BORRA POR SQL.** El trigger `protect_buckets_delete` lo
> rechaza con «Direct deletion from storage tables is not allowed». Crearlo por
> SQL sí funciona, así que la `0026` se aplica fácil y no se deshace por la
> misma vía.

##### En `storage.objects` NO se puede revocar nada, y por eso hay una política restrictiva

`anon` y `authenticated` conservan ahí los ocho privilegios de tabla por
omisión: la `0024` revocó los del esquema `public` y no llega hasta Storage.
**Se intentó revocárselos a `anon` y no se puede.** Medido, las tres vías:

| Intento | Resultado |
|---|---|
| `REVOKE ALL ON storage.objects FROM anon` | **No lanza error Y NO HACE NADA**: el privilegio sigue |
| `... GRANTED BY supabase_storage_admin` | `ERROR: grantor must be current user` |
| `SET ROLE supabase_storage_admin` y revocar | `ERROR: permission denied to set role` |

La razón está en el `relacl` de la tabla: `anon=arwdDxtm/supabase_storage_admin`.
**Quien concedió es `supabase_storage_admin`, y un `REVOKE` solo quita lo que
concedió quien lo ejecuta.** `postgres` no es miembro de ese rol.

**Lo peligroso de esto es el primer renglón**, no los otros dos: un `REVOKE`
que no revoca **no falla**. Si se hubiera dejado en la migración, cualquiera
que la leyera creería que `anon` se quedó sin privilegios, y sería falso. Por
eso no quedó en el archivo.

Lo que sí está en nuestra mano es una **política RESTRICTIVA** `TO anon`, que
da la misma defensa en profundidad: una restrictiva no concede nada, se combina
con Y contra las permisivas, así que ninguna permisiva futura la pasa por
encima. **Falsificada en tres estados**, y el control es lo que la prueba:

| Estado | Restrictiva | Permisiva abierta para `anon` | `anon` sube |
|---|---|---|---|
| A | sí | no | 403, viola RLS |
| B | sí | **sí** | **403, viola RLS** |
| C | **no** | sí | **200: subió el archivo** |

A `authenticated` no se le toca nada, y no es una omisión: es el rol de Postgres
con el que corre la terminal, y sin `INSERT` no podría subir por más que la
política se lo permita. Quién puede qué lo decide la política, no el privilegio.

Lo que ni el `REVOKE` ni la restrictiva cubrirían: **un bucket marcado como
público**, porque Storage sirve esos objetos por una ruta que no pasa por RLS.
Los dos nacen privados, y esa es la defensa.

#### Cómo se probó, y qué se falsificó

La batería pasó de 67 a **136 comprobaciones**, todas contra el proyecto de
pruebas con los JWT reales de los tres usuarios. Las 69 nuevas son:

- **52 de tablas**: por cada una de las 13 y cada una de las cuatro
  credenciales —restauración, terminal, usuario sin rol y la llave publicable
  sola—, cuatro peticiones reales (leer, insertar, actualizar, borrar), que se
  informan como una comprobación porque la afirmación es una. El `UPDATE` y el
  `DELETE` llevan filtro por un id inexistente: aunque un permiso estuviera mal
  puesto, no habría nada que romper.
- **2 de contraste**: que la restauración vea filas en las tablas que la
  terminal acaba de escribir mientras la terminal ve cero en las trece, y que
  las 11 denominaciones del quetzal las vea una y no la otra.
- **15 de Storage**, con una subida real de un PNG de 70 bytes.

**Se falsificó, y la primera versión NO mordía.** Al borrar
`restauracion_lee_ventas`, la comprobación «la restauración lee ventas» seguía
pasando: sin política, un `SELECT` no falla, devuelve 200 con la lista vacía, y
la comprobación solo miraba el estado. Se corrigió para exigir filas, y con la
corrección borrar esa única política hace fallar **exactamente una**
comprobación, que nombra la tabla y muestra `leer 200 []`. Se falsificaron
además dos cosas más: conceder a la terminal una política de lectura sobre
`usuarios` hace fallar dos comprobaciones, y borrar `terminal_sube_fotos` hace
fallar cuatro de Storage.

**El linter pasó de 13 INFO + 5 WARN a 0 INFO + 5 WARN**: las políticas hacen
desaparecer los trece avisos `rls_enabled_no_policy`, que era su razón de ser.

#### Lo que falta, dicho en voz alta

- **Nada offline guarda las políticas.** `npm test` no toca la nube y la mitad
  B de la prueba de deriva compara el CONTRATO, que solo declara columnas y
  funciones. Si alguien borrara una política desde el panel, solo lo vería la
  batería destructiva. Hacer que `contrato_de_sincronizacion()` declare también
  las políticas cerraría el hueco, y es una migración nueva más una foto nueva.
- ~~El usuario de restauración del real hay que marcarlo con
  `app_metadata.rol = 'restauracion'`~~ **HECHO el 2026-09-13**, y medido de
  punta a punta: la fila, el claim del JWT y las trece políticas. Ver el bloque
  de arriba.
- **La foto de prueba queda en el bucket del proyecto de pruebas** después de
  cada corrida: con estas credenciales Storage no deja borrarla. Son 70 bytes
  por corrida en un proyecto descartable.

### 4.22 El vencimiento del JWT, y la tolerancia de reloj que hizo fallar la sonda

Cierra el último punto abierto de la fase 2: que el token de 900 s **de verdad
deje de servir**, no solo que su carga útil diga `expires_in = 900`. Son dos
cosas distintas —lo que el emisor promete y lo que el verificador hace— y hasta
el 2026-09-13 solo estaba medida la primera.

#### Lo que se midió, y en qué orden

`npm run verify:nube -- --esperar-vencimiento` acuña un token de la terminal,
comprueba que PostgREST lo acepte recién emitido, espera a pasar el `exp` y
comprueba que lo rechace con `401 PGRST303 «JWT expired»`. **Para no esperar 15
minutos por corrida, Julio bajó el JWT de `pos-pruebas-descartable` a 300 s
mientras duraron estas mediciones.** Por eso las corridas de abajo reportan
`expires_in = 300` y fallan la comprobación «el token se emitió para 900 s»:
ese fallo es correcto y esperado mientras el valor esté bajado.

> **HAY QUE DEVOLVER `pos-pruebas-descartable` A 900 s EN EL PANEL.** Esta
> sesión no puede: es configuración de Auth. Mientras siga en 300, la batería
> completa debería dar **135 de 136** —la que sobra es esa misma—, y si una
> sesión futura ve ese 135/136 lo primero que tiene que mirar es el valor del
> panel, no el guion. **El 135 es inferencia, no medición**: la batería
> destructiva completa no se volvió a correr con el valor bajado; lo medido es
> que esa comprobación falla, en la corrida de `--esperar-vencimiento` de acá
> arriba.

**La primera corrida FALLÓ, y la conclusión evidente era la equivocada.** Con el
margen de 10 s que tenía el guion, el token vencido **seguía siendo aceptado**:
llegaba un `403` por rol en vez del `401` por vencimiento. Leída al pie de la
letra, esa corrida decía que la nube no hace cumplir el vencimiento, que es una
falla grave y **es falsa**.

Se descartaron las hipótesis una por una, y ninguna se dio por buena sin
medirla:

| Hipótesis | Cómo se descartó |
|---|---|
| PostgREST cachea el token que ya usó | Prueba A/B con tokens acuñados a la vez: uno usado antes de vencer y otros **nunca tocados**. Los rechaza a todos igual, con el mismo `401 PGRST303`. Sin diferencia: no hay caché |
| El vencimiento no se hace cumplir | Descartada por lo mismo, y GoTrue también los rechaza (`403 bad_jwt`) |
| El reloj de esta máquina está desfasado | Medido contra la cabecera `Date` del propio servidor. **Ver la corrección de abajo: el 1.9 s que decía este renglón NO se pudo reproducir.** |

Quedaba una sola explicación posible —una **tolerancia de reloj** después del
`exp`— y se midió en vez de suponerla.

##### CORREGIDO EL 2026-09-13: tres afirmaciones de la primera versión no se sostenían

Julio pidió ver la salida cruda en vez del resumen, y al releerla aparecieron
tres cosas mal. **Se dejan escritas porque el error estaba en cómo se reportó la
medición, no en la medición**, y esa distinción es la que hay que poder
auditar.

| Lo que decía esta sección | Qué pasa de verdad |
|---|---|
| «la Mac va **1.9 s** atrasada» | **No se pudo reproducir.** Medido de nuevo contra la cabecera `Date`, en tres intentos: **−0.21 s, +0.50 s y +0.75 s**, o sea desfase ≈ 0 dentro del ruido de ±0.5 s que impone la resolución de un segundo de esa cabecera. De dónde salió el 1.9 no consta. |
| «entre 27.9 s y 32.9 s de reloj del servidor» | **Se cae con lo anterior**: esa conversión era el bracket local corrido por el 1.9 s. Sin ese número, no hay conversión que hacer: local y servidor coinciden. |
| «dejó de servir entre los **25 s y los 30 s**» | Eran **el contador nominal del bucle**, no los instantes medidos. Los reales de esa corrida son **+26.0 s aceptado y +31.0 s rechazado**. |

Y una cuarta, menor pero del mismo tipo: el renglón `exp +12.9s -> HTTP 504` se
imprimió como «todavía aceptado», y **un 504 no es un veredicto**: es la
petición que no llegó a contestarse. No cambia la conclusión —hay 403 a +15.9,
+21.0 y +26.0 que sí la sostienen— pero la etiqueta era falsa.

##### La medición buena, con timestamp de cada intento

Se rehízo el experimento entero registrando la hora absoluta de **cada**
petición, tres tokens acuñados en el mismo segundo (`iat` idéntico) y un sondeo
cada 2 s en vez de cada 5:

```
2026-09-13T22:28:10.650Z  exp+25.7s  A (sondeo repetido)     HTTP 403  aceptado
2026-09-13T22:28:12.872Z  exp+27.9s  A (sondeo repetido)     HTTP 403  aceptado
2026-09-13T22:28:15.104Z  exp+30.1s  A (sondeo repetido)     HTTP 403  aceptado
2026-09-13T22:28:17.296Z  exp+32.3s  A (sondeo repetido)     HTTP 401  RECHAZADO  PGRST303 JWT expired
2026-09-13T22:28:17.481Z  exp+32.5s  B (PRIMER Y ÚNICO USO)  HTTP 401  RECHAZADO  PGRST303 JWT expired
2026-09-13T22:28:45.017Z  exp+60.0s  C (PRIMER USO, exp+60)  HTTP 401  RECHAZADO  PGRST303 JWT expired
```

**El límite quedó acotado entre exp+30.1 s y exp+32.3 s**, una ventana de 2.2
segundos, con el reloj local coincidiendo con el del servidor. Y **B y C, que
nunca se habían presentado antes**, se rechazan igual que A: la hipótesis de la
caché queda descartada con tokens vírgenes, no solo con uno reusado.

##### De dónde sale exactamente el «30 s», dicho sin adornos

**No está medido que la tolerancia sea 30 s.** Lo medido es una **COTA**, en dos
corridas independientes:

| Corrida | Último aceptado | Primer rechazado |
|---|---|---|
| 1, cada 5 s | exp+26.0 s | exp+31.0 s |
| 2, cada 2 s | exp+30.1 s | exp+32.3 s |

O sea: **un token vencido no sobrevive más allá de ~32 s del `exp`.** Los 30 s
son el número redondo que cae dentro de esa cota y el valor por omisión habitual
de esta clase de tolerancia; es una **inferencia razonable**, no una medición.

Lo que sí queda demostrado, que es lo que importaba, es que **la ventana está
acotada**: no hay ningún estado en que un token vencido siga sirviendo
indefinidamente.

Por eso la constante del código **dejó de llamarse
`TOLERANCIA_DE_RELOJ_MEDIDA_S`**: ese nombre afirmaba más que la evidencia.
Ahora es `DESFASE_QUE_MERECE_AVISO_S`, que es lo único para lo que se usa.

`MARGEN_DE_VENCIMIENTO_MS` pasó de 10 s a **90 s**, casi tres veces la cota
medida, con la medición escrita al lado en el código. Con el margen corregido la
sonda pasa, corrida entera contra el proyecto de pruebas:

```
Vencimiento del JWT de la terminal en ztidrshifrblhfraiowg
  FALLA el token se emitió para 900 s
        expires_in = 300
   ok   recién emitido, PostgREST acepta el token (contesta 403 por el rol, no 401)
   ·    esperando 389 s hasta pasado exp = 2026-09-13T21:13:19.000Z…
   ok   vencido, el MISMO token es rechazado con 401 (JWT expired)

3 comprobaciones, 1 fallidas.
  - el token se emitió para 900 s
```

**La que falla es la del valor bajado a propósito, y las dos de sustancia
pasan.** Antes del arreglo fallaban dos, y la segunda era falsa.

> **LA LECCIÓN, QUE VALE MÁS QUE EL NÚMERO.** Una comprobación que falla no
> prueba que el sistema esté mal: prueba que la comprobación y el sistema no
> coinciden. Acá el defecto estaba **en la prueba**, y darla por buena habría
> hecho perseguir un fallo de seguridad inexistente en la nube. Es la contracara
> exacta de la regla de este proyecto sobre falsificar: así como una prueba que
> nunca se vio fallar no prueba nada, **una prueba que falla tampoco prueba nada
> hasta saber POR QUÉ falla.**

#### Lo que esto NO cubre

- **`pos-jimmy-cano` no se sondeó así.** El guion no puede correr contra el
  real: el seguro lo rechaza por nombre (§4.20). De la vida del token del real
  hay medición de su carga útil —`expires_in = 900`, `exp - iat = 900`, §4.4— y
  no de su rechazo pasado el `exp`. Los dos proyectos corren la misma versión
  de PostgREST y GoTrue, así que la tolerancia debería ser la misma, **pero eso
  es razonamiento, no medición**, y así queda dicho.
- **La tolerancia es de la plataforma y puede cambiar sin avisar.** Si un día
  esta comprobación vuelve a fallar, lo primero que hay que medir es la
  tolerancia otra vez, no concluir que la nube dejó de validar.

### 4.23 La credencial de la terminal (Fase 3.a, COMPLETA)

**Construida el 2026-09-13.** Es la primera vez que la aplicación tiene código
para hablar con Supabase de verdad, aunque **todavía no habla**: sin
`POS_NUBE_URL` no se construye nada y la pantalla lo dice. El `SyncProvider`
real —el que subiría lotes— sigue sin existir; esto es solo la credencial.

> **LA FASE 3.a ESTÁ COMPLETA desde el 2026-09-13.** Se construyó en dos
> tandas: primero la credencial y la renovación, y después —cuando Julio la
> destrabó— la lógica de credencial revocada, que tiene su propio bloque más
> abajo.

#### Las cuatro piezas, y por qué son cuatro y no una

| Archivo | Qué decide | Se prueba |
|---|---|---|
| `vida-del-token.ts` | Cuándo renovar, cuánto esperar tras un fallo, si el reloj está mal | **Puro**: sin red, sin reloj, sin Electron |
| `credencial.ts` | Dónde y cómo se guarda el token de refresco | Con un cifrado inyectado |
| `auth-de-nube.ts` | Las dos peticiones HTTP a GoTrue | Se inyecta un doble |
| `sesion-de-nube.ts` | La coreografía de las tres anteriores | Con los tres dobles |

Están separadas para que la lógica —que es donde están los errores caros— se
pueda probar sin red y sin Electron. Es el mismo criterio que separó
`reintentos.ts` del trabajador en la fase 1.b.

#### LA VIDA DEL TOKEN SE MIDE CON EL RELOJ DEL SERVIDOR, NUNCA CON EL LOCAL

Es la decisión central del módulo y la que más pruebas tiene.

**Nunca se calcula `exp - Date.now()`**, que es la forma evidente y la
equivocada: mezcla un instante del servidor con uno de esta máquina, y §1.6 del
diseño advierte que un equipo de escritorio se desfasa minutos u horas. Las dos
direcciones rompen, y rompen distinto:

- Reloj **adelantado** una hora → la resta da negativo → la aplicación
  renovaría en bucle cerrado contra Auth, consumiendo cuota sin que nada falle
  visiblemente.
- Reloj **atrasado** una hora → da hora y media → renovaría mucho después de
  que el token ya murió.

La vida sale de **`exp - iat`**, dos instantes del MISMO reloj, así que la
resta es exacta aunque la máquina crea que es 1998. La espera se le pasa a un
`setTimeout`, que es relativo y tampoco mira el reloj de pared.

**Falsificado:** reemplazando el cálculo por `exp - Date.now()`, **caen 8
pruebas**, incluidas las cuatro del bloque «EL RELOJ LOCAL NO ENTRA EN EL
CÁLCULO» (reloj en hora, una hora adelantado, una hora atrasado y en 1998).

El desfase **sí se calcula**, pero solo para anotarlo en la bitácora técnica
cuando pasa la tolerancia medida de 30 s (§4.22). Es diagnóstico del riesgo
8.5, no una entrada del cálculo: si entrara, un reloj mal puesto dejaría de ser
un dato molesto y pasaría a poder romper la renovación.

#### Se renueva al 75 % de la vida, y ese colchón es un presupuesto

Con los 900 s medidos: renovar a los **675 s** deja **225 s** antes del
vencimiento. No es un margen decorativo: es lo que permite reintentar si la red
está caída justo en ese momento. La escalera de reintentos —5 s, 15 s, 45 s y
techo de 1 minuto— entra **seis veces** en esos 225 s, y hay una prueba que lo
cuenta en vez de afirmarlo.

**La fracción NO está atada a 900.** Con un token de 300 s renueva a los 225 s,
y con los 3600 s de antes renovaría a los 2700. Hay pruebas de los tres, más
una que recorre toda vida de 10 s a 2 horas exigiendo que la renovación caiga
siempre antes del `exp`.

> **LA ESCALERA DE RENOVACIÓN NO ES LA DE `reintentos.ts`, Y NO SE PUEDE
> REUSAR.** Aquella sube hasta **una hora** entre intentos, que es correcto
> para la cola de subida —un lote que no subió hoy sube mañana— y sería
> absurdo acá: un peldaño de 30 minutos significa **no intentar ni una vez**
> dentro del colchón antes del vencimiento. La forma de la escalera la impone
> la vida del token, no la paciencia de quien espera.

#### LA CONTRASEÑA NO SE GUARDA, Y ESTÁ PROBADO, NO AFIRMADO

Entra por el canal IPC, se le pasa a Auth y sale del alcance. **Seis
comprobaciones la persiguen** por todas las superficies donde podría quedar:

| Dónde se busca | Cómo |
|---|---|
| El archivo de credencial | En UTF-8, en latin1 y como secuencia de bytes |
| **Todos** los archivos de la carpeta de datos | Recorriendo el directorio entero |
| La bitácora técnica | Sobre el texto acumulado |
| Cualquier campo del objeto de sesión | Recorriendo el grafo completo, a cualquier profundidad |
| El estado que viaja a la pantalla | El mismo recorrido |
| El módulo de IPC | Una prueba sobre el código fuente |

**Y hay un control del propio buscador**: una comprobación que le da un objeto
donde la contraseña SÍ está y exige que la encuentre. Sin ese control, las
otras cinco pasarían igual con un buscador roto.

**Falsificado con los dos errores realistas**: guardarla en un campo del objeto
y registrarla en la bitácora. Cada uno lo atrapa su prueba —«no queda colgada
en NINGÚN campo» y «no aparece en la bitácora técnica»— y ninguna otra, que es
la señal de que cada una cubre su superficie.

La pantalla además **limpia el campo también cuando el intento FALLA**: si
quedara escrita, un error de tecleo dejaría la contraseña de la terminal a la
vista en el mostrador.

#### El archivo: solo el token de refresco, y nunca en claro

`<userData>/sincronizacion.credencial` guarda **el token de refresco cifrado y
nada más**. Ni el access token —vive 900 s, guardarlo solo agregaría una copia
de algo que caduca—, ni el correo, que se lee de los claims del token cuando
hace falta. Un dato que no se guarda es un dato que no se filtra.

**Si `safeStorage.isEncryptionAvailable()` da `false`, la clase LANZA y no
escribe nada.** No hay respaldo en texto plano y no lo va a haber: un archivo
en claro sería exactamente lo que este módulo existe para impedir, y escribirlo
«por esta vez» lo haría en silencio.

**Falsificado**: agregando ese respaldo en texto plano caen **7 pruebas**,
entre ellas «EL TOKEN NO QUEDA EN TEXTO PLANO», «NO deja ningún archivo detrás»
y «pasa SIEMPRE por el cifrado del sistema».

##### Y el cifrado REAL se midió, no se supuso

Las pruebas de Vitest usan un cifrado inyectado, así que prueban el contrato
del almacén y **no** que el llavero o DPAPI cifren de verdad. Ese hueco lo
cierra una sonda que corre dentro de Electron:

```bash
npm run diagnostico:credencial
```

Resultado en la máquina de desarrollo, el 2026-09-13:

```
Plataforma            : darwin
Cifrado disponible    : sí
Bytes en el archivo   : 67      (para un token de 49 caracteres)
Token legible en él   : no
Descifra igual        : sí
Permisos del archivo  : 600
```

**Falsificada**: escribiendo el token en claro, la sonda dice «SÍ — GRAVE» y
sale con código 1. Y esa falsificación destapó de paso un defecto de la propia
sonda: `decryptString` **lanza** con bytes que no son suyos, y sin envoltorio
el proceso quedaba vivo sin ventana y sin imprimir nada, o sea **colgado en vez
de reportando**. Se arregló con un `descifrarSinRomper` y una última red
alrededor de todo, por la misma regla de §4.11: un guion que se cuelga es peor
que uno que falla.

> **ESTO SE MIDIÓ EN macOS, Y macOS NO ES VERIFICACIÓN.** El respaldo de
> `safeStorage` en macOS es el llavero y en Windows es DPAPI: son dos
> mecanismos distintos y que uno funcione no dice nada del otro. **Hay que
> correr `npm run diagnostico:credencial` en Windows**, y hasta entonces esta
> mitad queda como pendiente de confirmar (punto 12 de §6.2).

Vale además la advertencia de §1.4 del diseño, que no cambia: DPAPI cifra con
material de la cuenta de Windows, así que **protege contra quien se lleve el
disco, no contra quien encienda la máquina y entre como ese usuario**. Una
terminal en kiosko probablemente inicie sesión sola. La credencial **es
extraíble**, y el trabajo de verdad es acotar lo que puede hacer (§1.5), no
esconderla mejor.

#### PROBADO CONTRA SUPABASE REAL: login, cifrado y reinicio

**El 2026-09-13, contra `pos-pruebas-descartable`** —nunca contra el real—, con
el usuario `terminal-pruebas@pos-pruebas.invalid` que ya existía ahí. Es lo que
faltaba: hasta entonces el camino feliz estaba probado solo con dobles.

**1. El login real funciona.** Manejando la aplicación de verdad, con la carpeta
de datos persistente:

```
ANTES DE CONECTAR   credencial=No  sesion=No
AVISO               Terminal conectada como terminal-pruebas@pos-pruebas.invalid,
                    con rol terminal. El token dura 300 segundos y se renueva sola.
CONTRASEÑA EN PANTALLA TRAS CONECTAR = ""
credencial guardada : Sí          rol del token      : terminal
sesion activa       : Sí          duracion del token : 300 s (5 min)
```

Los 300 s son los del panel: **el proyecto de pruebas sigue bajado y no volvió a
900** (§4.22). La pantalla los lee del token, no de una constante.

**2. El archivo del disco, leído con el `safeStorage` REAL** —no con el doble de
las pruebas—, y buscando adentro tanto el token como la contraseña:

```json
{ "bytes": 19, "modo": "600", "primeros12BytesEnLatin1": "v10¸¿F+ì;5",
  "pareceTextoPlano": false, "descifraConSafeStorageReal": true,
  "largoDelTokenDescifrado": 12, "tokenApareceEnElArchivo": false,
  "contrasenaApareceEnElArchivo": false }
```

19 bytes = los 3 del prefijo `v10` de OSCrypt más un bloque AES de 16, que es lo
que ocupa un token de refresco de 12 caracteres. Ni el token ni la contraseña
aparecen en el archivo.

##### ADVERTENCIA PARA EL EMPAQUETADO: la credencial está atada al NOMBRE DE LA APLICACIÓN

> **SI EL NOMBRE DEL PRODUCTO CAMBIA ENTRE VERSIONES, TODA CREDENCIAL YA
> GUARDADA DEJA DE SER LEGIBLE, Y HAY QUE RECONECTAR CADA TERMINAL A MANO.**
> Leer esto antes de tocar `name` o `productName` en `package.json`, o la
> configuración de `electron-builder`.

**Cómo se descubrió, que es lo que le da peso.** El primer intento de leer el
archivo de credencial de la aplicación falló con «Error while decrypting the
ciphertext provided to safeStorage.decryptString». No era un defecto del
código: el lector corría como «Electron» y la aplicación había cifrado como
«pos-agricola». Repitiendo la lectura con **la misma identidad** —un
`package.json` con el mismo `name`— descifra sin problema. Medido las dos
veces, no razonado.

La causa es que `safeStorage` no cifra con una llave del archivo: la deriva de
una entrada del llavero (macOS) o de DPAPI (Windows) **cuyo nombre sale del
nombre del producto**. Cambiar ese nombre es, a efectos prácticos, cambiar la
llave.

**Tiene un lado bueno que no estaba previsto:** otro programa del mismo usuario,
corriendo como otra aplicación, **no puede leer la credencial** aunque tenga el
archivo delante. Es una capa de protección más de la que §1.4 del diseño
prometía.

**Y un lado caro, que es el que hay que vigilar.** Estos tres cambios, todos
plausibles, rompen la credencial de todas las terminales instaladas:

| Cambio | Por qué rompe |
|---|---|
| Renombrar `name` o agregar/cambiar `productName` en `package.json` | Es de donde sale la identidad hoy |
| Cambiar el nombre del producto en `electron-builder` para el instalador | El paquete final puede tener otro nombre que el del desarrollo |
| Firmar la aplicación con otra identidad, o pasar de sin firmar a firmada | En macOS la ACL del llavero se ata a la firma |

**Qué hacer si pasa:** no hay recuperación automática ni la va a haber —la
llave vieja no existe más—. Hay que **reconectar cada terminal** desde
«Conectar con la nube» con la contraseña de su usuario. Con una sola caja es un
minuto; el día que haya varias, hay que planificarlo antes de publicar la
versión, no después.

##### QUÉ HACE LA APLICACIÓN CUANDO NO PUEDE DESCIFRAR: comportamiento esperado, con pruebas

**Está construido y probado, no es solo una intención.** El comportamiento
esperado, y lo que efectivamente hace hoy:

| Se espera que… | Está |
|---|---|
| **NO se cuelgue ni falle en silencio** | `arrancar()` no lanza; hay prueba |
| **No se invente una sesión**: queda desconectada y sin access token | prueba |
| **No llame a la red** con un token que no pudo leer | prueba |
| **Diga el motivo**, con las palabras «no se pudo descifrar» | prueba |
| Lo deje también en la **bitácora técnica**, no solo en la pantalla | prueba |
| Diga que **SÍ hay un archivo**, para que no parezca una instalación nueva | prueba |
| **NO lo confunda con una revocación** | prueba |
| **Ofrezca reconectar**, y que reconectar lo arregle reemplazando el archivo | prueba |

La distinción del anteúltimo renglón importa y por eso tiene prueba propia: una
credencial ilegible y una credencial **revocada** son dos problemas distintos
con dos arreglos distintos. En la ilegible, la credencial de la nube podría
estar perfecta y el que no la puede leer es este programa; confundirlas mandaría
a revocar en el panel sin ninguna necesidad.

> **LO QUE FALTA, DICHO EN VOZ ALTA:** la pantalla muestra el motivo y ofrece
> reconectar, pero **no distingue visualmente** «no se pudo descifrar» de
> cualquier otro motivo: sale en el mismo renglón de detalle. Con una sola
> terminal alcanza; el día del cambio de nombre convendría un aviso propio que
> diga «esta versión no puede leer la credencial de la versión anterior».

**3. El reinicio relee la credencial, sin teclear nada.** Segundo arranque con
la misma carpeta de datos:

```
credencial guardada : Sí     usuario            : terminal-pruebas@pos-pruebas.invalid
sesion activa       : Sí     rol del token      : terminal
```

**Y el token de refresco ROTÓ de verdad**: antes del reinicio empezaba con
`dx32…` y después con `ruyr…`, los dos de 12 caracteres. Eso confirma contra
Supabase real lo que las pruebas solo podían simular: la renovación consume el
token viejo, recibe uno nuevo y **lo persiste**. Si no lo persistiera, el
segundo reinicio dejaría la terminal fuera.

#### CORREGIDO: sin proyecto configurado, la pantalla ofrecía un botón inútil

**Lo encontró `verify:pantallas` manejando la aplicación real, no una prueba de
Vitest.** Es la cuarta vez que esa comprobación atrapa un defecto de esta clase.

Cuando falta `POS_NUBE_URL`, el proceso principal **no registra** los dos
canales de nube. Y ahí aparece una asimetría que el resto de la API no tiene:
`ipcRenderer.invoke` sobre un canal **sin manejador RECHAZA la promesa**, en
vez de devolver un `RespuestaIpc` con `ok: false` como hacen todos los canales
registrados. La primera versión de la pantalla esperaba lo segundo, así que el
rechazo quedaba sin atrapar, la bandera de «no configurada» nunca se ponía, y
**la pantalla seguía ofreciendo el botón «Conectar», que en esa copia no podía
funcionar**.

Se arregló con un `try/catch` alrededor de la consulta de estado —y otro
alrededor de conectar, que si no dejaría la pantalla en «Conectando…» para
siempre—. **Falsificado**: quitando el `try/catch` y volviendo a correr la
comprobación, fallan exactamente las dos que la cubren.

Quedó fijado en `verify:pantallas`, que ahora hace **36** comprobaciones.

#### Se rechaza la credencial equivocada ANTES de guardarla

Si el token que devuelve Auth no trae `app_metadata.rol = 'terminal'`, o la
sesión es anónima, **se rechaza y no se guarda nada**. No es una barrera de
seguridad —la barrera es RLS— sino un aviso temprano: si el administrador
teclea por error su propia cuenta de restauración, la terminal quedaría con una
credencial que no puede escribir ni una fila, y el síntoma aparecería mucho
después como lotes rechazados con `42501`. Es mejor decírselo mientras tiene el
teclado en la mano, y el mensaje nombra el rol que trajo.

#### El token de refresco ROTA, y por eso se guarda antes que nada

Los tokens de refresco de Supabase son de un solo uso: cada renovación devuelve
uno nuevo y quema el anterior. **Si una renovación sale bien y no se persiste
el token nuevo, la sesión queda perdida** y hay que volver a teclear la
contraseña. Por eso lo PRIMERO que hace `aplicarSesion` es escribir la
credencial —antes del estado en memoria, antes de agendar, antes de registrar—,
y hay una prueba que comprueba que la segunda renovación usa el token rotado y
no el original.

La otra mitad la cubre GoTrue: §1.6 documenta que reutilizar el token padre
dentro del mismo linaje devuelve el activo, así que una respuesta perdida en la
red no termina la sesión.

#### Un corte de red no es un fallo duro

`arrancar()` **no lanza nunca**: que no haya internet al encender la
computadora de la tienda es normal, y no puede impedir que el punto de venta
abra. Si falla, agenda el reintento y la cola sigue llenándose, que es lo que
el trabajador ya hace desde la fase 1.b. La credencial **no se borra** ante un
fallo de red: un corte no es una revocación.

#### La credencial REVOCADA (segunda mitad, construida el 2026-09-13)

Julio la destrabó después de ver la salida cruda del experimento. Es el estado
«sin credencial» de §1.6 del diseño.

##### LA SEÑAL NO ES 401, Y ESO SE MIDIÓ ANTES DE ESCRIBIR NADA

El pedido decía que la señal de revocación era «el refresco devuelve 401».
**Se midió contra `pos-pruebas-descartable` y es falso**: GoTrue contesta
**400**, no 401.

```
refresco INVENTADO      HTTP 400  {"code":400,"error_code":"validation_failed",
                                   "msg":"Refresh token is not valid"}
contraseña EQUIVOCADA   HTTP 400  {"code":400,"error_code":"invalid_credentials"}
usuario INEXISTENTE     HTTP 400  {"code":400,"error_code":"invalid_credentials"}
```

Construir la detección sobre el 401 habría dado **un control que no dispara
nunca**: la aplicación habría reintentado en bucle para siempre una credencial
muerta, exactamente el defecto que esta mitad venía a cerrar, y sin que nada
fallara a la vista.

**El 401 sí existe, pero es otra cosa**: es lo que devuelve **PostgREST** ante
un access token vencido, y eso pasa cada 900 s de forma perfectamente normal.
Confundir los dos habría hecho que la terminal se declarara revocada en cada
renovación. Son dos servidores distintos contestando dos preguntas distintas.

**Por eso la regla se escribe al revés**: `clasificarFalloDeRenovacion` enumera
lo que SÍ es transitorio —sin respuesta, 5xx, 408, 425, 429— y **todo lo demás
se lee como credencial muerta**. Es conservador en la dirección correcta: ante
un código que nadie previó, la aplicación prefiere avisar de más y que una
persona mire, antes que girar en falso.

**Falsificado**: reemplazando el clasificador por «solo 401», caen **12
comprobaciones**.

##### Qué hace cuando la credencial está muerta

| Decisión | Por qué |
|---|---|
| **Deja de entregar el access token**, aunque no haya vencido | Ver abajo: renuncia a propósito a una ventana medida |
| **No reintenta**: no agenda ningún temporizador | El servidor no dijo «ahora no», dijo «esta credencial no». Reintentar cada minuto consume cuota y esconde el problema detrás de un contador que sube |
| **No borra el archivo** de credencial | Borrar es irreversible. Si el 400 viniera de un problema de plataforma, habría destruido una credencial que servía. Al reconectar se reemplaza sola |
| **La cola sigue llenándose** | La bandeja de salida escribe en `sync_cola` dentro de la transacción de negocio (§4.17) y no sabe si hay credencial. Se detiene la subida, no la venta |
| **Se sale reconectando**, y eso limpia el estado | Es el único camino, y el correcto: si el servidor volvió a dar tokens, la credencial sirve |
| **Al ARRANCAR vuelve a preguntar** | El estado vive en memoria, no en el disco: un arranque nuevo re-verifica contra el servidor en vez de creerle a una decisión vieja. Cuesta una petición y evita que un 400 de plataforma deje la terminal muerta para siempre |

##### AQUÍ ENTRA LA COTA MEDIDA, Y ES UNA RENUNCIA DELIBERADA

Cuando el refresco es rechazado, **el access token que ya se tiene puede seguir
funcionando**: hasta su `exp` más la cota medida de §4.22 —hasta 15 minutos y
medio con los 900 s del real—. La aplicación **renuncia a esa ventana**:
`accessTokenVigente()` devuelve `null` en cuanto se declara revocada.

El motivo es que la revocación existe para el escenario de §1.5, la terminal
robada. Seguir escribiendo con una credencial que el dueño acaba de anular sería
actuar contra esa decisión, y lo único que se gana son unos minutos de subida
que **igual no se pierden**: la cola vive en SQLite y sube entera al
reaprovisionar.

La cota además se **muestra**: el estado expone `exposicionHasta`, calculada
como `exp + COTA_DE_TOLERANCIA_MEDIDA_S`, y la pantalla la dice —«un token ya
emitido pudo seguir siendo aceptado hasta las HH:MM:SS»—. Es el dato que hace
falta para revisar qué pudo pasar entre la revocación y ese instante. La
constante se redondea **hacia arriba** a 33 s a propósito: para estimar
exposición, quedarse corto es el error caro.

##### El aviso que ve una persona

No es un renglón de detalle: es un bloque propio, en rojo, con **la fecha desde
la que está así**, **cuántas filas se están acumulando** en la cola —para que se
vea que nada se pierde— y **qué hacer**, que es crear una contraseña nueva en el
panel y volver a conectar. Dice explícitamente que no hay nada que arreglar en
la caja, porque el cajero no puede hacer nada al respecto y no tiene que creer
que sí.

##### Lo que sigue sin estar

- **No se pudo provocar una revocación REAL.** Para borrar o banear un usuario
  hace falta la `service_role` del proyecto de pruebas, que no está en esta
  máquina (§4.20), y cambiarle la contraseña al usuario de terminal rompería
  `.env.nube-pruebas` y la batería. Lo que sí se midió es **el código que
  devuelve GoTrue ante un token de refresco que no sirve**, que es el mismo
  camino que recorre una sesión borrada. El resto está probado con dobles.
- **Un usuario BANEADO podría devolver 403 en vez de 400.** No se pudo medir,
  por lo mismo. La clasificación ya lo cubre —403 cae del lado de credencial
  muerta— pero eso es razonamiento, no medición.
- **La reutilización del token padre tiene una ventana de gracia larga**:
  medido, el token anterior seguía sirviendo a los 15 s de haber rotado. Es lo
  que §1.6 del diseño anticipa y lo que hace que una respuesta perdida en la
  red no termine la sesión. No se midió cuánto dura.

Tampoco existe **desconectar**: volver a conectar reemplaza la credencial, que
cubre el caso real —cambió la contraseña del usuario de terminal—, pero no hay
forma de dejar la terminal sin credencial desde la pantalla. No se pidió y no
se inventó.

### 4.24 El proveedor real y la detección de conexión (Fase 3.b)

**Construida el 2026-09-13.** Es quien **usa por primera vez** la credencial de
la fase 3.a para escribir en la nube. Con esto la aplicación ya puede subir,
aunque en la máquina de desarrollo siga sin hacerlo: sin `POS_NUBE_URL` la
fábrica cae al simulado y avisa.

> **TRES COSAS DEL PEDIDO YA EXISTÍAN, y no se rehicieron:** la constante
> `VERSION_DEL_CONTRATO_DE_SINCRONIZACION` (desde la fase 2.b), la mitad B de
> la prueba de deriva (`npm run verify:nube`, también 2.b) y su modo
> `--tomar-foto`. Sobre «regenerar la foto si coinciden»: es un no-op y **hay
> una decisión de §5 que deliberadamente no lo hace**, para que la foto solo
> cambie por un commit que alguien lea.

#### EL ENRUTADOR NO MIRA LA PRIMERA TABLA, y ahí estaba la trampa

CLAUDE.md §4.20 lo dejó anotado para este día, y era exacto: **una venta y un
lote simple de catálogo empiezan los dos por `productos`**. Enrutar por
`orden_en_lote = 0` —la forma evidente— mandaría toda venta a
`sincronizar_lote_simple`, que la rechazaría por nombre y **detendría la cola
por la razón equivocada**.

Se enruta por **presencia** de una tabla decisiva, no por posición:

| Trae… | Va a |
|---|---|
| una fila de `ventas` | `sincronizar_venta` |
| una fila de `usuarios` | `sincronizar_usuario` |
| `caja_sesiones` con `estado = 'abierta'` | `sincronizar_apertura_de_caja` |
| `caja_sesiones` con `estado = 'cerrada'` | `sincronizar_cierre_de_caja` |
| lo demás | `sincronizar_lote_simple` |

**La apertura y el cierre son el par peligroso**: reciben lotes con exactamente
las MISMAS tablas y lo único que los distingue es el `estado`. Tienen pruebas
propias que exigen que uno nunca termine llamando a la función del otro.

**Ante un lote incoherente no se adivina**: uno que mezcle `ventas` y
`usuarios` no lo aceptaría ninguna función, así que se rechaza acá —sin salir a
la red— con el motivo verdadero, y el lote queda bloqueante.

**Falsificado**: enrutando por la primera tabla caen **6 comprobaciones**, las
tres de venta entre ellas.

#### DOS CORRECCIONES AL DISEÑO DE §5, LAS DOS MEDIDAS

**1. §5.2 pide `HEAD /auth/v1/health`, y con HEAD el detector NO FUNCIONA.**
Medido contra `pos-pruebas-descartable`:

```
HEAD /auth/v1/health  ->  HTTP 405 Method Not Allowed   (allow: GET)
GET  /auth/v1/health  ->  HTTP 200, 107 bytes, content-type: application/json
                          sb-project-ref: ztidrshifrblhfraiowg
                          {"version":"v2.196.0","name":"GoTrue",…}
```

Un detector con `HEAD` reportaría «sin internet» **siempre**, con la red
perfecta. Se usa `GET`, que además es lo único coherente con la otra mitad de
esa misma fila del diseño —«solo un 200 con el cuerpo esperado»—, porque **un
HEAD no tiene cuerpo**.

**2. Se comprueba algo mejor que el tipo de contenido: la cabecera
`sb-project-ref`.** Un portal cautivo puede devolver 200 con
`application/json` si se lo propone; lo que no puede es firmar la respuesta con
la referencia de ESTE proyecto. Se exigen las tres cosas: 200, la referencia
correcta y el cuerpo de GoTrue.

Las tres capas de §5.2 quedan como el diseño quería: al sistema operativo
**solo se le cree el `false`**, la capa 2 cuesta 107 bytes medidos, y la capa 3
es el intento que ya se iba a hacer. Con la cola vacía **no se comprueba nada**.
Un día entero sin internet son 288 comprobaciones: **menos de 31 KB**.

#### El latido diario NO pega al health, y por eso no lo detecta la conexión

§5.3 lo dice y es fácil de pasar por alto: **el health de Auth no cuenta como
actividad de base**, y el latido existe para que el proyecto gratuito no se
pause (riesgo 8.3), no para detectar conexión. Así que consulta PostgREST:
`GET /rest/v1/configuracion_negocio?select=id&limit=1`.

Medido como terminal: devuelve **200 con `[]`**, porque la terminal no tiene
política de lectura sobre ninguna tabla (§4.21) —**y aun así la consulta llegó
a Postgres**, que es lo único que hace falta. Una lista vacía acá es el
resultado correcto, no un fallo.

> El pedido proponía usar `contrato_de_sincronizacion()` para el latido. **No
> sirve**: esa función exige el rol `restauracion` en su primera línea y la
> terminal tiene el rol `terminal`, así que le contestaría `403` siempre. Un
> latido que siempre falla no es un latido.

#### Sin credencial no es un error de red, y la cola no se toca

`accessTokenVigente()` devuelve `null` en los tres casos —nunca se conectó, no
se pudo descifrar, la nube la rechazó— y el proveedor **ni arma el payload**.
Lo reporta con `estadoHttp: 401`, que `reintentos.ts` clasifica como clase
**credencial**, y ahí el trabajador ya sabía qué hacer desde la fase 1.b: no
suma intento, no agenda reintento y **no bloquea**. Probado de punta a punta
con la cola SQLite real: el lote sigue pendiente, con `intentos = 0`, y sube
entero en cuanto vuelve la credencial.

#### Cómo se probó, y qué queda sin probar

**89 comprobaciones nuevas, todas sin red.** El `fetch` se inyecta y las
pruebas afirman sobre la URL exacta, las cabeceras y el cuerpo. La prueba de
integración usa **base SQLite real, servicios reales y trabajador real**: cobra
una venta de verdad y comprueba que llamó a `sincronizar_venta` y que las filas
quedaron con `sincronizado_en`.

Las dos mitades de la prueba de deriva **se volvieron a falsificar con los
cinco casos de §9.3**, y las cinco muerden nombrando la diferencia:

| Deriva reintroducida | Qué dijo |
|---|---|
| Quitar `ventas.total` de la foto | mitad B: «ventas.total está en la nube y no en la foto», código 1 |
| Agregar `ventas.propina` a la foto | «ventas.propina está en la foto y no en la nube» |
| Subir el contrato de la foto a 2 | «la nube declara el contrato 1 y la foto dice 2» |
| Quitarle `search_path` a `sincronizar_venta` | «la función sincronizar_venta cambió: la foto dice … y la nube …» |
| Ponerla como INVOKER | lo mismo, con `security_definer` |
| La misma foto sin `ventas.total`, **sin red** | mitad A: cae la prueba de `ventas`, nombrando la tabla |

> **LO QUE NO SE PROBÓ: nada de esto habló nunca con Supabase de verdad.** El
> proveedor está probado contra un `fetch` de mentira que devuelve lo que las
> funciones de la `0023` **deberían** devolver, escrito leyendo la migración.
> Si la respuesta real difiere en algo que las pruebas no previeron, se vería
> recién al correrlo contra la nube. Lo que sí se midió de verdad es el health,
> el latido y los códigos de GoTrue.

### 4.25 La venta real contra la nube, y el defecto que destapó

**Corrida el 2026-09-13 contra `pos-pruebas-descartable`**, con el caso
combinado de §4.13: una línea con **precio especial vigente** y un **descuento
del 25 % que excede el tope del rol**, con su autorización presencial. Cuatro
lotes, en el orden que las llaves foráneas de Postgres exigen, ejercitando
cuatro de las cinco funciones.

> El pedido la llamaba «el caso del Prompt #7». El Prompt 7 fue el de **cero
> reintentos ante conflicto de inventario**; el caso combinado es del
> **Prompt 19** (§4.13). Se corrió el combinado, que es lo que importaba.

#### DEFECTO ENCONTRADO: el primer administrador NO se sincronizaba, y eso mataba la cola entera

**Lo destapó la primera corrida, y es el hallazgo más importante de la fase.**

```
sincronizar_lote_simple -> HTTP 409
{"code":"23503",
 "details":"Key (usuario_id)=(d4021171-…) is not present in table \"usuarios\".",
 "message":"insert or update on table \"auditoria_log\" violates foreign key
            constraint \"auditoria_log_usuario_id_fkey\""}
```

**La causa:** `ServicioDeAutenticacion.crearPrimerAdministrador` escribía
`usuarios` y `auditoria_log` **sueltas, sin transacción y sin encolar**. Era el
único camino de escritura del proyecto que no pasaba por
`conBandejaDeSalida` —se le había escapado a la fase 1.a, que agregó la
transacción a los otros seis servicios—.

**La consecuencia, que no es menor:** `auditoria_log.usuario_id` tiene llave
foránea hacia `usuarios`, y **todo** asiento de la tienda lleva el id de quien
hizo la operación. Con el primer administrador sin subir, **el primer lote que
se intentara subir en una instalación nueva moría con `23503` y la cola quedaba
detenida para siempre**. No es un caso raro: es *todas* las instalaciones.

**Arreglado**: ahora encola sus dos filas en un solo lote, con el usuario
primero y su asiento después. `DependenciasDeAutenticacion` gana `base`, y se
hizo **obligatoria a propósito**: opcional habría dejado el hueco abierto en
silencio en cualquier sitio que se olvidara de pasarla.

**Con prueba propia que lo fija**, y que dice en su nombre por qué existe: «EL
PRIMER ADMINISTRADOR SE ENCOLA: sin esto no se sincroniza nada, nunca». Exige
las dos filas, en un solo lote y en orden.

> **ESTO SOLO PODÍA APARECER CORRIENDO CONTRA POSTGRES DE VERDAD.** Las 89
> pruebas de la fase 3.b usan un `fetch` de mentira, y ninguna podía saber que
> `auditoria_log` tiene esa llave foránea: la restricción vive en la nube. Es
> exactamente lo que Julio pidió al no conformarse con el doble.

#### La comparación fila por fila

Tras el arreglo, la venta subió entera. **Local contra nube, leído del catálogo
de los dos lados:**

| Campo | SQLite local | Postgres | |
|---|---|---|---|
| `ventas.subtotal` | `4.17` | `4.17` | igual |
| `ventas.descuento_tipo` | `porcentaje` | `porcentaje` | igual |
| `ventas.descuento_valor` | `25.00` | `25.00` | igual |
| `ventas.total` | `3.12` | `3.12` | igual |
| `ventas.descuento_autorizado_via` | `presencial` | `presencial` | igual |
| `ventas.forma_pago` | `efectivo` | `efectivo` | igual |
| `venta_detalle.orden_linea` | `0` | `0` | igual |
| `venta_detalle.cantidad` | `3.500` | `3.500` | igual |
| `venta_detalle.precio_unitario_snap` | `1.19` | `1.19` | igual |
| `venta_detalle.subtotal_impreso` | `3.12` | `3.12` | igual |
| `venta_detalle.subtotal_exacto` | `4.165` | **`4.165000`** | **mismo número, otro texto** |
| `productos.cantidad_vendida` | `3.500` | `3.500` | igual |
| `productos.contador_ventas` | `1` | `1` | igual |
| `productos.inventario_disponible` | `96.500` | `96.500` | igual |

Y la constancia que devolvió `sincronizar_venta`, fila por fila:

```
public.productos      insertada   recibido_en=2026-09-13T23:33:59.986686+00:00
public.ventas         insertada   recibido_en=2026-09-13T23:33:59.986686+00:00
public.venta_detalle  insertada   recibido_en=…
public.auditoria_log  insertada   recibido_en=…   (la venta)
public.auditoria_log  insertada   recibido_en=…   (la autorización del descuento)
```

Los **dos** asientos de auditoría están, que es lo que §4.13 exige: la venta y
la autorización del descuento son dos hechos distintos con dos responsables
distintos. Y el `recibido_en` es idéntico en las cinco filas: **una sola
transacción del lado de la nube**.

> **UNA DIFERENCIA DE REPRESENTACIÓN QUE HAY QUE TENER PRESENTE PARA LA
> RESTAURACIÓN (fase 4.b).** `subtotal_exacto` sale de SQLite como `4.165` y
> Postgres lo devuelve como `4.165000`: **el mismo número**, pero
> `NUMERIC(20,10)` rellena hasta su escala declarada. No afecta a la subida
> —el valor viaja y se guarda bien— pero una restauración que copie el texto
> tal cual le estaría dando a SQLite una forma distinta de la que escribió. El
> CHECK local admite hasta diez decimales, así que probablemente pase; **queda
> anotado como algo a comprobar el día de la restauración, no a suponer.**

#### Lo que la corrida confirmó de paso, sin buscarlo

- **La cola se detiene de verdad ante un error determinístico de Postgres.** Se
  vio dos veces con errores reales, no simulados: el `23503` de arriba y un
  `23505` sobre `idx_caja_sesiones_una_abierta` al repetir la corrida —el
  invariante de «una sola caja abierta en todo el sistema» (§4.9) funcionando
  **en la nube**—. En los dos casos: lote bloqueante, nada detrás se subió.
- **El precio especial se aplicó**: 1 de 1 líneas, y `precio_unitario_snap`
  quedó en `1.19` en vez de los `6.69` de lista.
- **El CHECK `ventas_autorizacion_de_descuento_coherente` muerde.** Un error de
  tecleo al armar la prueba —`autorizadaPor` en vez de `autorizadoPor`— lo hizo
  saltar en SQLite antes de llegar a ninguna red.

#### Los disparadores de cambio de estado, ya conectados

`olvidarLaEspera()` dejó de ser una pieza suelta. Sin esto, tras una hora sin
internet la terminal esperaría hasta 5 minutos para enterarse de que la red
volvió, aunque el sistema operativo ya lo supiera.

| Disparador | Qué hace | Por qué |
|---|---|---|
| `powerMonitor.on('resume')` | olvida la espera y llama a `alDespertar()` | Los **15 s de §5.4** los pone `alDespertar()`, que existía desde la fase 1.b esperando este día: en Windows el adaptador de red tarda unos segundos en levantar y comprobar en el instante cero da un falso «sin internet» |
| `powerMonitor.on('on-ac')` | lo mismo | No dice nada de la red por sí solo, pero acompaña a que alguien volvió y encendió cosas |
| `net.isOnline()` de `false` a `true` | lo mismo | **Electron no emite ningún evento para esto**: el módulo `net` no es un EventEmitter. Se sondea cada 30 s, que es una lectura en memoria sin red ni costo, y **solo se actúa en la transición hacia arriba** |

Los tres se desconectan en el cierre ordenado, junto con el latido.

### 4.26 La prueba que impide que un hecho de negocio se escape (y los cinco que ya se habían escapado)

**Nace de una pregunta de Julio del 2026-09-13**, después de que
`crearPrimerAdministrador` se escapara igual que los seis servicios de la fase
1.a: *¿hay alguna prueba estructural que verifique que TODO camino de escritura
pase por el envoltorio?* **No la había.**

`trabajador.test.ts` ya exigía que **solo tres archivos** nombren
`.transaction(`. Esa prueba protege de que alguien abra una transacción por su
cuenta y se saltee la señal que hace ceder al trabajador. **No protege de lo
contrario, que es peor: no abrir ninguna.** El primer administrador no nombraba
`.transaction(` justamente porque no abría transacción, así que pasaba limpio.

#### La regla que ahora se comprueba

> **Cada `auditoria.registrar(` de `src/main/domain` tiene que estar dentro de
> un `conBandejaDeSalida(` o de un `enTransaccionDeNegocio(`.**

El asiento de auditoría es el marcador exacto de «acá pasó un hecho del
negocio»: §4.17 lo dice al revés —toda operación de negocio deja su asiento— y
`auditoria_log` es una de las doce tablas que se sincronizan. **Un asiento
fuera del envoltorio es, por definición, un hecho de negocio que nunca va a
llegar a la nube.**

Se aceptan **dos** envoltorios y no uno, porque §4.17 ya había decidido que
`ServicioDeVenta` y los dos métodos de `ServicioDeCaja` usan
`enTransaccionDeNegocio` + `encolarLote` directo: su transacción hace siete
pasos y meterla en el molde común la haría menos legible. **La primera versión
de la prueba solo aceptaba `conBandejaDeSalida` y marcó esos cuatro como
falsos positivos**; se corrigió después de comprobar que sí encolan.

La lista de excepciones está **vacía**, y una entrada sin motivo escrito hace
fallar otra comprobación. Hay además un control del propio detector —le da un
caso con envoltorio y otro sin— porque un detector roto que dijera siempre
«está dentro» dejaría la prueba pasando en falso.

**Falsificada**: quitándole el envoltorio a uno de los cinco, falla nombrando
`usuarios/autenticacion.ts:567`.

#### LOS CINCO QUE ENCONTRÓ, Y POR QUÉ IMPORTAN

Todos en `autenticacion.ts`, el mismo archivo del primer administrador:

| Operación | Qué no llegaba a la nube |
|---|---|
| `registrarFalloDeAutorizacion` | el asiento `autorizacion_bloqueada` |
| `configurarPinRemoto` | el asiento `pin_remoto_configurado` y la fila de `usuarios` |
| `registrarSalida` | `salida_controlada_autorizada` / `_rechazada` |
| `registrarIngresoCorrecto` | `ingreso_correcto` |
| `registrarIngresoFallido` | `ingreso_fallido` / `usuario_bloqueado` |

> **DOS DE ESTOS CONTRADECÍAN LO QUE §4.8 AFIRMA.** Esa sección dice, con todas
> las letras, que el candado no viaja pero «el hecho auditable sí: 
> `usuario_bloqueado` y `autorizacion_bloqueada` quedan en `auditoria_log`, que
> sí está espejada». **No estaba espejada.** Era una afirmación falsa en la
> documentación, sostenida desde que se escribió.

**Los cinco quedaron arreglados**, y en cada uno se distingue lo que viaja de
lo que no: el contador de intentos y el candado por superficie **se quedan
acá** —son estado operativo de esta terminal (§4.4, §4.8) y ni siquiera existen
en Postgres—, y lo que se encola es el asiento. En `configurarPinRemoto` se
encola además la fila de `usuarios`, cuyo hash de PIN remoto **no viaja** porque
`COLUMNAS_EXCLUIDAS` lo saca del payload (decisión 17).

### 4.27 Los disparadores de red, ejercitados de verdad

**El 2026-09-13, apagando y prendiendo el WiFi de la máquina de desarrollo.**
No era suficiente que compilara: hasta esta corrida los tres disparadores eran
«construidos y no vistos correr», que es la clase de afirmación que este
proyecto no acepta.

La aplicación REAL corriendo, con su carpeta de datos temporal y el proyecto de
pruebas configurado:

```
23:57:26Z  WiFi -> off
23:58:07Z  WiFi -> on
23:58:36Z  APP: [sincronizacion] el sistema operativo volvió a ver una red:
                se recomprueba la conexión sin esperar la escalera.
23:58:51Z  APP: [sincronizacion] ciclo: sin_pendientes; 0 lotes, 0 filas, 0 ms
```

**Los dos números del diseño se leen en los timestamps**, y eso es lo que hace
que la evidencia valga:

- **29 segundos** entre prender el WiFi y el aviso: es el sondeo de 30 s, que
  existe porque **Electron no emite ningún evento** para `net.isOnline()`.
- **15 segundos** entre el aviso y el ciclo: son los de §5.4 que pone
  `alDespertar()`, el tiempo que Windows tarda en levantar el adaptador. Los
  escribió la fase 1.b esperando este día.

El WiFi se devolvió a su estado en un `finally` y en un manejador de señales, y
se comprobó después: `Wi-Fi Power (en0): On`, y un `200` del health.

> **SE EJERCITÓ UNO DE LOS TRES.** `resume` y `on-ac` de `powerMonitor` siguen
> sin provocarse: exigen suspender la máquina de verdad o desenchufarla, y no
> se hizo. Comparten el mismo `olvidarYReintentar` que el sondeo, así que lo
> que quedó sin ver es el cableado del evento, no lo que hace.

### 4.28 Estado del proyecto de pruebas, al 2026-09-13

- **Reiniciado**: las once tablas de negocio en **0**, `denominaciones` con sus
  **11**. Se truncó por SQL, que es la única vía para `auditoria_log` (su
  trigger de inmutabilidad aborta cualquier DELETE).
- **El JWT ya está en 900 s**, medido acuñando un token: `expires_in = 900`,
  `exp - iat = 900`. Estuvo en 300 desde el experimento de la tolerancia.
- **La batería completa da 136 de 136**, corrida con `--reinicio-hecho` sobre
  el proyecto recién vaciado. Eso confirma de paso lo que hasta ahora era una
  inferencia: con el JWT en 300 daba 135/136, y la que fallaba era esa.
- Queda en el bucket **una foto de prueba de 70 bytes** por corrida: con estas
  credenciales Storage no deja borrarla, y es un proyecto descartable.

### 4.29 El asiento suelto: la puerta que faltaba en la nube (migración 0027)

**El arreglo de §4.26 estaba incompleto, y lo destapó subirlo a Postgres de
verdad.** Julio insistió en no conformarse con que las 1442 pruebas locales
pasaran: *«este asiento específico es el que se creía sincronizado durante no
sabemos cuánto tiempo sin estarlo; merece verse llegar a la nube con sus
propios ojos»*. Tenía razón.

#### Lo que pasó al subirlo

Los cinco asientos que §4.26 puso a encolar producen lotes de **un solo
`auditoria_log`, sin fila principal de negocio**. Y las cinco funciones de la
`0023` exigen una: `sincronizar_lote_simple` mira la primera fila contra su
lista cerrada, donde `auditoria_log` no está.

```
sincronizar_usuario     -> HTTP 200
sincronizar_lote_simple -> HTTP 400
  {"code":"P0001","message":"FORMA: la tabla auditoria_log no se sincroniza
                             como lote simple"}
ciclo: cola_detenida; pendientes: 3
```

> **EL ARREGLO ANTERIOR ERA PEOR QUE EL DEFECTO.** Antes, esos asientos no
> subían **en silencio**. Después de §4.26, el primer **ingreso fallido** de un
> cajero —tres PIN mal tecleados— habría **detenido toda la sincronización de
> la tienda**. Un defecto silencioso se convirtió en uno que para la caja.

#### La migración `0027`, y por qué una función nueva

`sincronizar_asiento(lote, version_de_contrato)`: misma forma que las cinco,
mismo endurecimiento de §1.5.1, y una **lista cerrada de un solo elemento**.

**No se amplió `sincronizar_lote_simple`**, que habría sido una línea. Su
`CASE` de la fila principal es justamente lo que obliga a que la fila de
negocio vaya primera y el asiento detrás; admitiendo `auditoria_log` ahí, un
lote de catálogo con el asiento delante pasaría en vez de rechazarse, y se
perdería la comprobación de orden que §2.4 sostiene.

**La versión de contrato NO sube.** La `0027` *agrega* una puerta y no cambia
ninguna existente, así que una terminal vieja sigue funcionando igual contra
esta nube. Subirla obligaría a actualizar todas las terminales para nada.

#### UNA SEGUNDA COSA QUE SOLO SE VIO MIDIENDO

Tras crear la función, **la prueba de deriva seguía en verde y la foto seguía
diciendo «13 funciones»**. `contrato_de_sincronizacion()` enumera por nombre,
con un `proname IN (...)` literal: una función nueva es **invisible** para ella.

Es decir: había una función `SECURITY DEFINER` nueva en la nube **que nada
vigilaba**. La `0027` reemplaza también el contrato para que la conozca. Ahora
la foto declara **14 funciones** y la mitad A exige que
`sincronizar_asiento` exista, sea DEFINER y tenga `search_path` vacío.

> **PARA LA PRÓXIMA FUNCIÓN, QUE VA A PASAR:** agregarla al `proname IN (...)`
> de `contrato_de_sincronizacion` es parte de crearla, no un paso opcional. Sin
> eso queda fuera del contrato y la prueba de deriva no la ve.

#### El asiento, leído en la nube

Con la `0027` aplicada, el mismo caso sube entero: `sincronizar_usuario` y
**tres** `sincronizar_asiento`, cola vaciada. Leído de `auditoria_log` en
Postgres:

| accion | valor_nuevo | recibido_en |
|---|---|---|
| `primer_administrador_creado` | `{"rol":"administrativo","nombre":"Jimmy …"}` | 00:10:19.145 |
| `ingreso_fallido` | `{"bloqueadoHasta":null,"intentosFallidos":1}` | 00:10:19.625 |
| `ingreso_fallido` | `{"bloqueadoHasta":null,"intentosFallidos":2}` | 00:10:20.064 |
| **`usuario_bloqueado`** | `{"bloqueadoHasta":"2026-09-14T00:10:48.771Z","intentosFallidos":3}` | 00:10:20.358 |

**Es la primera vez en la vida del proyecto que un `usuario_bloqueado` llega a
la nube**, y §4.8 lo prometía desde que se escribió.

#### Estado de la 0027: APLICADA EN LOS DOS PROYECTOS el 2026-09-14

Julio la aprobó y pidió aplicarla **de inmediato**, sin esperar a que hiciera
falta, con un criterio que vale como regla general: *es exactamente el tipo de
migración que no cuesta nada aplicar temprano y sí cuesta olvidar antes de
conectar la terminal real*. Es puramente aditiva —agrega una puerta, no cambia
ninguna, la versión de contrato no sube— así que aplicarla contra un proyecto
que todavía no la usa no tiene efecto observable, y no aplicarla convertiría el
primer ingreso fallido de la tienda en una cola detenida.

Evidencia leída del catálogo del real, no del archivo:

| Qué se comprobó | Antes | Después |
|---|---|---|
| Funciones en `public` | 14 | **15** |
| Existe `sincronizar_asiento` | no | **sí**, `SECURITY DEFINER`, `search_path=""` |
| ACL de la función | — | `postgres`, `authenticated`, `service_role`; **sin `anon`** |
| `contrato_de_sincronizacion` la enumera | `false` | **`true`** |
| Funciones que declara el contrato | 13 | **14** |
| Versión del contrato | 1 | **1** (no sube, a propósito) |
| Filas de negocio en las 8 tablas | 0 | **0** |

**La comprobación fuerte no es el texto de la migración sino la huella de los
OBJETOS**, igual que con la `0023` (§4.4): la huella de las 14 funciones del
contrato da **`1b0bcbf6c033cb163c4bc396dbe52e37` en los DOS proyectos**, y la
salida de `contrato_de_sincronizacion()`, invocada con los claims de
`restauracion` en cada uno, da **`92d5b3e7374cdcf36aaa9f185acadf67` en los dos**.

El linter del real sumó **un** aviso `authenticated_security_definer_function_executable`
—`sincronizar_asiento`, esperado y no se corrige— y sigue en **0 INFO
`rls_enabled_no_policy`**.

##### CORREGIDO AL APLICARLA: el `0027b` del proyecto de pruebas había derivado

Al cotejar los md5 entre los dos proyectos **no coincidían**, que es exactamente
para lo que esa comprobación existe. La causa: el `0027b_contrato_conoce_el_asiento`
que se aplicó al descartable el día anterior **reescribió
`contrato_de_sincronizacion` a mano en vez de copiar el cuerpo de la `0023`**, y
en el camino cambió dos cosas: `pg_get_function_arguments` por
`pg_get_function_identity_arguments`, y `p.proconfig` por
`coalesce(p.proconfig, ARRAY[]::text[])`.

**El real recibió la versión correcta** —el registro de su `0023` es byte a byte
el archivo del repositorio (`a77ae68229c1fdc8245e139916e5b943`) y usa
`identity_arguments`, igual que la `0027` que se le aplicó—, así que lo que se
corrigió fue el **descartable**, reemplazando sus dos funciones por las del
archivo. Ahora los md5 coinciden.

> **Y UNA SUPOSICIÓN MÍA QUE LA MEDICIÓN DESMINTIÓ.** Di por sentado que
> `pg_get_function_arguments` e `identity_arguments` devuelven cosas distintas
> —una con nombres de parámetro y la otra solo con tipos— y por lo tanto que el
> contrato declaraba cosas distintas en cada proyecto. **Medido sobre las
> funciones de este esquema, devuelven exactamente lo mismo**: `iguales = true`
> en las tres que se probaron. Se separan solo con parámetros `OUT`/`VARIADIC` o
> con valores por omisión, y acá no hay ninguno. La divergencia era de TEXTO y
> no de comportamiento, y por eso la foto seguía cuadrando; corregirla igual es
> lo correcto, porque un `coalesce` de más sí cambiaría la salida el día que una
> función perdiera su `search_path`.

- Batería completa tras todo esto, sobre el proyecto vaciado: **136 de 136**.

### 4.30 Pendiente explícito: `resume` y `on-ac` sin ejercitar

De los tres disparadores de §4.27, **solo se ejercitó el sondeo de
`net.isOnline()`**, apagando y prendiendo el WiFi (evidencia con timestamps
allá). Los otros dos siguen **construidos y no vistos correr**:

| Disparador | Cómo se provocaría | Estado |
|---|---|---|
| `powerMonitor.on('resume')` | suspender la máquina de verdad y despertarla | **sin ejercitar** |
| `powerMonitor.on('on-ac')` | desenchufar y volver a enchufar | **sin ejercitar** |

Los dos comparten el mismo `olvidarYReintentar` que el sondeo, que sí se vio
funcionar de punta a punta. **Lo que quedó sin comprobar es que Electron emita
esos dos eventos en esta aplicación**, no lo que hacen cuando llegan. Decisión
de Julio: no forzarlo ahora y anotarlo.

Y sigue valiendo lo de siempre: esto se midió en macOS, y **Windows es la
plataforma de producción**. `powerMonitor` es justamente donde las dos difieren
más.

### 4.31 Las 23 puertas de encolado, subidas todas — y el `23505` que apareció

Julio pidió subir **al menos uno** de los cuatro asientos que quedaban
pendientes, preferentemente `autorizacion_bloqueada`, y que se confirmara que no
había «una sexta variante del mismo problema» de la `0027`. En vez de subir uno
solo se ejercitaron **los veintitrés sitios de `src/main/domain` que encolan**,
con base SQLite real, servicios reales, trabajador real y proveedor real contra
`pos-pruebas-descartable`. Subir uno habría contestado la primera mitad de la
pregunta y no la segunda.

#### Las 29 formas de lote que la aplicación puede producir, y adónde van

| Forma del lote | Función | Cuántos |
|---|---|---|
| `usuarios` + `auditoria_log` | `sincronizar_usuario` | 7 |
| `auditoria_log` **suelto** | `sincronizar_asiento` | 7 |
| `categorias`/`productos`/`limites_descuento`/`configuracion_negocio` + asiento, y `recibos` solo | `sincronizar_lote_simple` | 12 |
| `caja_sesiones`(abierta) + desglose + asiento | `sincronizar_apertura_de_caja` | 1 |
| `productos` + `ventas` + `venta_detalle` + asiento | `sincronizar_venta` | 1 |
| `caja_sesiones`(cerrada) + asiento | `sincronizar_cierre_de_caja` | 1 |

**Las 29 enrutan, ninguna quedó sin puerta.** Los cuatro asientos que faltaban
llegaron a la nube y se leyeron en Postgres:

| accion | usuario_id | entidad_tipo |
|---|---|---|
| `ingreso_correcto` | el de Ana | `usuarios` |
| `pin_remoto_configurado` | el de Jimmy | `usuarios` |
| **`autorizacion_bloqueada`** | **NULL** | **`autorizacion`** |
| `salida_controlada_autorizada` | el de Jimmy | `aplicacion` |
| `salida_controlada_rechazada` | **NULL** | `aplicacion` |

`autorizacion_bloqueada` es el caso interesante y por eso era el que Julio
quería ver: es **el único asiento del sistema que viaja sin `usuario_id`**
—cuando aparece el diálogo de autorización nadie eligió todavía un usuario, así
que no hay a quién imputarle el intento (§4.8)— y su `entidad_tipo` es
`autorizacion`, que ninguna otra operación usa. Pasa porque
`auditoria_log.usuario_id` es nulable y `entidad_tipo` solo exige texto no
vacío; **eso se leyó del esquema antes de subir, no se supuso**.

#### NO hay sexta variante del problema de la 0027 — pero apareció OTRO defecto

Hay que separar las dos cosas, porque tienen la misma consecuencia y causas
distintas:

- **Del problema de la `0027` —un lote cuya FORMA ninguna función acepta— no
  quedó ninguno.** Las 29 formas enrutan y las 29 fueron aceptadas.
- **Apareció un defecto distinto, con la misma consecuencia: la cola se
  detiene.** Medido:

```
sincronizar_lote_simple  HTTP 409
{"code":"23505","details":"Key (rol)=(venta) already exists.",
 "message":"duplicate key value violates unique constraint
            \"limites_descuento_rol_key\""}
ciclo: cola_detenida; pendientes: 16; bloqueantes: 2
```

**La causa.** `escribir_fila` escribe con
`INSERT … ON CONFLICT (id) DO UPDATE`: el destino del conflicto es **la llave
primaria**. Un choque contra cualquier OTRA restricción única no lo absorbe el
upsert, sale como `23505` crudo, `reintentos.ts` lo clasifica —correctamente—
como determinístico, y la cola se detiene.

**No es un caso aislado: son nueve restricciones.** Leídas del catálogo de la
nube, las únicas que NO son la llave primaria, sobre tablas que la terminal
escribe:

| Tabla | Restricción única |
|---|---|
| `usuarios` | `(nombre)` |
| `categorias` | `(nombre)` |
| `productos` | `(nombre)` |
| `limites_descuento` | `(rol)` ← la que mordió |
| `recibos` | `(numero_recibo)` |
| `recibos` | `(venta_id)` |
| `venta_detalle` | `(venta_id, orden_linea)` |
| `caja_sesion_denominaciones` | `(caja_sesion_id, denominacion_id, momento)` |
| `caja_sesiones` | índice parcial `(estado) WHERE estado='abierta'` ← esta ya mordió en §4.25 |

**Qué acota el riesgo hoy, dicho con precisión.** Las nueve existen también en
SQLite, y en este proyecto **nada se borra**, así que dentro de UNA terminal con
UNA base que nunca se recrea, una clave natural queda atada a un UUID para
siempre: toda resubida choca contra `(id)` y el upsert la absorbe. Por eso la
tienda de Jimmy, hoy, con una sola caja, no lo puede provocar.

**Cuándo SÍ ocurre.** El arnés lo provocó al correr dos veces contra la misma
nube, o sea con una base local nueva subiendo a una nube que ya tenía los datos.
Eso no es artificial: **es exactamente la forma de una reinstalación**, y
también la de una restauración (fase 4.b) y la de una segunda terminal —donde
`recibos.numero_recibo`, que es un correlativo por terminal, choca garantizado—.
Que esos tres escenarios lo disparen es **inferencia a partir del mecanismo
medido**, no una medición de cada uno.

> **UNA DE LAS NUEVE YA ESTÁ CERRADA: `limites_descuento`, con la migración
> `028`/`0028` del 2026-09-14 (§4.32).** Las otras ocho siguen abiertas y son
> decisión de diseño: quedan en el punto 19 de §6.2.

#### El arnés no quedó en el repositorio

Ejercita los 23 sitios, junta las formas, enruta cada una y las sube de verdad;
para eso necesita credenciales y red, y `npm test` no puede depender de la nube.
Se corrió, se leyó y se borró. Lo que sí queda fijado en el repositorio es la
prueba estructural de §4.26 —que ningún asiento se escriba fuera del
envoltorio— y las 25 del enrutador.

> **Y UN ERROR MÍO, DEL MISMO TIPO QUE YA COSTÓ UNA VUELTA.** La primera corrida
> del arnés subió las 29 formas con HTTP 200 y falló en la ÚLTIMA línea, la de
> diagnóstico, porque escribí `ultimo_error` donde la columna se llama `error`.
> El fondo estaba bien y lo roto era mi guion, igual que el
> `--config /dev/null` de una vuelta anterior. Se corrigió y se repitió entera.


### 4.32 El id de un tope de descuento es FIJO por rol (migraciones 028 / 0028)

Cierra **la primera de las nueve** restricciones únicas de §4.31, la única donde
la clave natural **es** la identidad de la fila.

#### Los dos valores, que ahora son parte del esquema

| rol | id |
|---|---|
| `venta` | `0c2ebde1-fe5f-4d8b-a7c4-d137888109ca` |
| `administrativo` | `a6385986-bf18-4bb2-841d-cf154702cc1f` |

Viven en tres lugares que tienen que decir lo mismo: la migración local `028`,
su espejo `0028`, y `ID_DE_LIMITE_POR_ROL` en
`src/main/database/repositories/limites-descuento.ts`. **Cambiarlos rompería la
correspondencia con lo ya subido**, así que no se tocan.

#### Por qué UUID fijos y no `id = rol`

`id = 'venta'` sería más legible y **no se puede sin reconstruir la tabla**: en
SQLite el CHECK exige `length(id) = 36` y en Postgres la columna es `UUID`.
Cambiar el tipo obligaría al rebuild de doce pasos que este proyecto ya descartó
en las migraciones 008 y 015.

El precedente correcto ya existía: **`denominaciones`**, cuyos UUID son fijos en
la migración desde el Prompt 13, por la misma razón —una tabla cuyo contenido es
el mismo en toda instalación no puede sortear sus ids—. `limites_descuento` es
ese caso exacto: como mucho dos filas, siempre las mismas dos.

Rompe a propósito la regla de «UUID generados en el cliente», y es la excepción
correcta: esa regla existe para que dos filas creadas sin internet en máquinas
distintas **no** colisionen al subir, y acá **la colisión es justamente lo que
se busca**. Es el mismo argumento del `id = 'unica'` de `configuracion_negocio`.

#### La prueba que importa: dos bases distintas, contra la nube de verdad

No alcanza con que el repositorio devuelva el id correcto. Se corrieron **dos
instalaciones independientes** —cada una con su SQLite nuevo y su propio primer
administrador— subiendo el tope del rol `venta` a `pos-pruebas-descartable`:

```
INSTALACIÓN A: id del tope = 0c2ebde1-fe5f-4d8b-a7c4-d137888109ca
   ciclo: cola_vaciada; pendientes: 0
INSTALACIÓN B: id del tope = 0c2ebde1-fe5f-4d8b-a7c4-d137888109ca
   ciclo: cola_vaciada; pendientes: 0

   sincronizar_usuario      HTTP 200
   sincronizar_lote_simple  HTTP 200
   sincronizar_usuario      HTTP 200
   sincronizar_lote_simple  HTTP 200
```

**Antes de este arreglo, la segunda daba `HTTP 409` con `23505` y
`cola_detenida`** (§4.31). En la nube quedó **una** fila, con el id fijo y con
los valores de B: el upsert por `(id)` la actualizó, que es exactamente lo que
tiene que pasar.

#### La base lo hace cumplir, y se falsificó en las dos nubes

`limites_descuento_id_fijo_por_rol`, `convalidated = true` en los dos proyectos,
y los **cuatro** CHECK de la tabla con `md5(pg_get_constraintdef)` idéntico en
ambos. Falsificado contra el REAL, sin dejar ninguna fila escrita: un id
sorteado se rechaza, y cruzar los dos ids también.

Trece pruebas locales lo fijan, en `limite-con-id-fijo.test.ts`, incluida la que
recorre el camino de migración —una base con la fila ya sembrada con id
sorteado— y la que comprueba que **lo que estaba esperando en `sync_cola` se
mueve con ella, id y payload**. Sin eso, la propia migración habría dejado un
lote pendiente apuntando a una llave primaria que ya no existe, provocando el
`23505` que vino a cerrar. **Falsificadas**: volviendo a `nuevoId()` caen 7 de
las 13, y las 6 que sobreviven son justo las de la base y la migración, que no
dependen del repositorio.

> **EL GUION DE LA BATERÍA YA HABÍA TROPEZADO CON ESTE DEFECTO Y LO TAPÓ.**
> `verificacion-de-nube.cjs` usaba un id fijo **inventado ahí**, con este
> comentario: «`limites_descuento.rol` es UNIQUE y esa tabla no se vacía entre
> corridas, así que un id nuevo por corrida chocaría contra la fila de la
> corrida anterior». **El diagnóstico era exacto**, y nadie lo conectó con que
> la aplicación sorteaba ese mismo id, así que el mismo choque le esperaba a
> cualquier reinstalación. El arreglo estaba en la prueba y no en el producto, y
> por eso el defecto sobrevivió. Ahora el guion usa el id del esquema.

#### Lo que esta migración NO resuelve

Las otras ocho restricciones únicas de §4.31 siguen igual, y **no son el mismo
problema**: `usuarios.nombre`, `categorias.nombre` y `productos.nombre` no son
la identidad de la fila —dos instalaciones pueden tener legítimamente un «Maíz
blanco» distinto— y ahí la respuesta es que la restauración de la fase 4.b traiga
los UUID de la nube en vez de generarlos; `recibos.numero_recibo` es un
correlativo POR terminal y se resuelve en el diseño del multi-sucursal. Siguen en
el punto 19 de §6.2.


### 4.33 Los archivos: fotos que se reducen y se suben (Fase 3.c)

Cierra lo último que quedaba de la sincronización continua. Hasta acá la foto de
un producto vivía **solo** en el disco de la tienda; ahora se reduce al
guardarla y sube a Storage por la misma cola que todo lo demás.

#### 1. Se reduce AL GUARDAR, con los códecs que Electron ya trae

800 px de lado mayor, calidad 80, **conservando el formato**. Lo hace
`nativeImage`, con el mismo criterio por el que el PDF sale de Chromium y no de
`pdfkit` (§5): agregar `sharp` sumaría un módulo NATIVO que habría que
recompilar para Electron y para Windows, y `jimp` sumaría megabytes de
JavaScript para lo que el proceso principal ya sabe hacer.

**Medido con `npm run diagnostico:imagen`**, que corre dentro de Electron:

```
Leído de la fuente    : lado mayor 800 px, calidad JPEG 80
Origen                : 3000 x 2000 px, 8409437 bytes (8.02 MB)
Resultado             : 800 x 533 px, 110917 bytes (0.11 MB)
Lado mayor <= 800 px  : sí     Conserva la proporción: sí
Reducción             : 98.7 %
```

Los 110 KB confirman la estimación de §2.5.3, que había supuesto 150 KB por
foto. **Falsificada**: con el redimensionado apagado la sonda imprime
«NO — GRAVE» y sale con **código 1**; con él puesto, código 0.

> **LA SONDA LEE LAS CONSTANTES DE LA FUENTE, no las copia.** Un 800 copiado
> acá sería un segundo lugar que puede derivar, y el día que alguien cambiara
> el de la aplicación **la sonda seguiría midiendo contra el viejo y seguiría
> dando verde**, que es la peor forma de fallar que tiene una comprobación.

**Nunca agranda**: una foto de 300 px se copia tal cual. Estirarla no agrega
información, pesa más y se ve peor.

**El formato no se cambia**, y es deliberado: convertir los PNG a JPEG bajaría
más el peso y **pierde la transparencia y cambia la extensión** que la fila ya
guardó. Cuál de las dos cosas le conviene a la tienda es una definición que
Jimmy no dio, y este proyecto no las inventa.

Las fotos que ya existían las arregla `npm run fotos:reducir`, un guion de una
sola vez. **No es una migración** —no toca el esquema, y reducir 200 imágenes
con Chromium dentro de una transacción abierta es lo que §4.14 ya rechaza para
el PDF—. Además **encola**, y eso no es un agregado gratuito: sin él, un
catálogo cargado antes de esta fase **no se subiría nunca**, porque solo se
encola una foto al crearla o al cambiarla. Correrlo dos veces no duplica nada.

#### 2. La foto viaja por `sync_cola`, como cualquier fila

`entidad_tipo = 'archivo_foto'`, en **su propio lote**, dentro de la misma
transacción que escribió el producto. El `entidad_tipo` no tiene lista cerrada
en el esquema, así que **no hizo falta migración**.

**NO EXISTE `archivo_pdf`, y no es un olvido**: §2.5.1 preveía los dos tipos y
§2.5.3 decidió después que los PDF no se suben. Declarar un tipo que nadie
produce sería el «disparador falso que parece funcionar» que §4.18 rechaza. Hay
una prueba que comprueba que no existe.

**El objeto de Storage se DERIVA de la ruta local** y no hay columna nueva
(§2.5.1): `fotos-de-productos/<uuid>.jpg` sube al bucket `fotos` como
`<uuid>.jpg`. Una columna «ruta en la nube» sería un segundo lugar donde la
misma información puede discrepar.

#### 3. LAS FILAS PRIMERO, LOS ARCHIVOS DESPUÉS

`siguienteLotePendiente` devuelve **todos** los lotes de negocio antes que
cualquier archivo. §2.5.1: «las filas son el negocio, los archivos son el
adorno». Con una foto por delante, una venta cobrada esperaría a que suba el
catálogo.

**No rompe la regla 1 del trabajador** —«no saltea ningún lote»—, que existe por
las llaves foráneas de Postgres: **un archivo no tiene ninguna**. Storage no
referencia nada y nada lo referencia.

**Entre archivos SÍ se saltea al que está esperando**, y con las filas de
negocio nunca. Ahí el orden ES la integridad referencial; entre fotos no hay
orden que preservar, cada una es independiente. Es además lo que impide que una
foto ausente deje al trabajador en un bucle.

#### 4. Una subida cortada: se retoma entera, y no duplica

No hay TUS ni trozos (§2.5.2): un archivo más chico que un trozo se sube entero
o no se sube, y desde que la foto pesa 110 KB eso vale todavía más que cuando
se escribió el diseño. Lo que garantiza que no se duplique **no es el cliente
sino Storage**: sin `x-upsert`, contesta «ya existe», y como el contenido de esa
ruta es inmutable, eso se lee como ÉXITO.

**Medido subiendo la misma foto dos veces contra `pos-pruebas-descartable`:**

```
1.ª  STORAGE fotos/31e5c420-….png   HTTP 200  {"Key":"fotos/31e5c420-….png","Id":"493fad0c-…"}
2.ª  STORAGE fotos/31e5c420-….png   HTTP 400  {"statusCode":"409","error":"Duplicate",
                                               "message":"The resource already exists",
                                               "code":"KeyAlreadyExists"}
     ciclo: cola_vaciada; pendientes: 0
```

> **EL DETALLE QUE HABÍA QUE ATENDER: el estado es 400 y el 409 viene ADENTRO
> del cuerpo, como texto.** Clasificar por el código a secas mandaría un ÉXITO
> —los bytes ya están allá— directo a detener la cola. Por eso se mira el
> cuerpo. **Falsificado**: quitando esa lectura caen 2 comprobaciones.

Y la foto está de verdad: la restauración la baja con **HTTP 200, 70 bytes,
sha256 idéntico al subido**.

#### 5. Los PDF de recibos NO se suben, en tres capas

Decisión de §2.5.3, tomada: un PDF es dato derivado que la reimpresión regenera,
y subirlos llenaría el gigabyte del plan gratuito en unos **ocho meses**.

| Capa | Qué impide |
|---|---|
| El módulo | `BUCKET_DE_FOTOS` es una constante y **no hay parámetro de bucket**: no se puede pedirle que suba a otro lado |
| Una prueba estructural | Ningún archivo del proceso principal arma una ruta `storage/v1/object/…recibos`, y hay un control del propio detector |
| La nube | La terminal **no tiene ninguna política** sobre ese bucket (migración 0026) |

**Medido con la credencial de terminal contra el proyecto de pruebas:**

```
POST /storage/v1/object/recibos/<uuid>.pdf
  -> HTTP 400 {"statusCode":"403","error":"Unauthorized",
               "message":"new row violates row-level security policy",
               "code":"AccessDenied"}
```

#### 6. Un `foto_path` huérfano no detiene nada (§2.5.4)

La fila dice que hay foto y el archivo se borró. El subidor **no sale a la red**
—no hay nada que mandar— y devuelve la señal `archivoAusente`. El trabajador la
aparta **un día**, la deja **no bloqueante**, y **sigue con el lote siguiente**.

> **`archivoAusente` es un campo aparte y NO un código HTTP inventado.** La
> clasificación de este proyecto va por código y nunca por el texto del error,
> justamente para no adivinar; pero acá **no hubo petición**, así que no hay
> código que mirar. Meterle un 404 de mentira haría que se leyera como una
> respuesta de la nube, que es lo contrario de lo que pasó.

La espera es de un día y no la escalera de reintentos: aquella existe para una
nube que ahora no puede y en un rato sí, y acá lo que falta es un archivo en el
disco. Nada de lo que pase en el próximo minuto lo va a traer.

##### UN DEFECTO DE MI PRIMERA VERSIÓN, QUE ENCONTRÓ UNA PRUEBA

La primera versión devolvía el lote apartado como si hubiera subido, así que el
resumen decía **«cola_vaciada; 2 lotes»** de dos fotos que nunca salieron a la
red. La bitácora habría reportado como respaldado algo que no lo estaba. Se
corrigió con un contador aparte, y ahora un ciclo con fotos apartadas lo dice:
«N archivo(s) sin subir: no están en el disco». Tiene prueba propia.

#### Dos separaciones del diseño, con su razón

| §2.5.2 pedía | Qué se hizo | Por qué |
|---|---|---|
| El SHA-256 en un `worker_thread` | Se calcula en línea | La premisa era «leer 5 MB en un i3 son cientos de milisegundos», y **esta misma fase la eliminó**: la foto ya se guardó reducida, así que se leen unas decenas de KB. Un hilo aparte sería infraestructura para un problema que la reducción borró |
| La URL directa `<ref>.storage.supabase.co` | `<url del proyecto>/storage/v1/…` | Es la forma que la batería de la fase 2.c **ya tenía medida y funcionando**. La otra no se probó nunca, y cambiar a un host no verificado para ganar nada medible es la clase de decisión que este proyecto no toma |

#### Lo que NO se verificó

- **La reducción se midió en macOS.** `nativeImage` usa los códecs de Chromium,
  que Electron empaqueta iguales en los dos sistemas, pero **Windows es la
  plataforma de producción** y eso es razonamiento, no medición. Se suma al
  punto 12 de §6.2, junto a `diagnostico:credencial`.
- **La subida real se hizo con un PNG de 70 bytes**, no con una foto reducida de
  110 KB: lo que se comprobó es que la política acepta la petición y que los
  bytes llegan idénticos, no el comportamiento con un archivo grande.
- **No se ejercitó un corte de red REAL a mitad de subida.** Lo que se midió es
  el reintento contra un objeto que ya existía, que es el desenlace de ese
  corte; el corte en sí está probado con un `fetch` que lanza.
- **`npm run fotos:reducir` no se corrió contra un catálogo real con fotos**:
  la base de desarrollo no tiene ninguna. Su camino está probado con Vitest.


### 4.34 La pantalla de sincronización, y los dos avisos que la acompañan (Fase 4.a)

Cierra el `docs/SINCRONIZACION.md` §3.3: los tres niveles de visibilidad de la
sincronización, del menos al más intrusivo.

#### 1. Barra de estado: siempre visible, sin guard de rol

`sincronizacion:resumen` es el único canal de sincronización que NO exige
`requiereRol`, y no es un descuido: la barra de estado está montada **siempre**
—incluso antes de iniciar sesión, en la pantalla de ingreso— y no lleva ningún
dato sensible: ni correo, ni el texto del error, ni nada de la credencial.
Solo un estado ya calculado y un número.

Los seis estados posibles, y su color, viven en un módulo **puro**
(`resumen-de-sincronizacion.ts`), separado del servicio, con el mismo criterio
que `vida-del-token.ts` y `reintentos.ts`: la lógica que decide algo se prueba
sin SQLite y sin reloj real.

| Estado | Color | Cuándo |
|---|---|---|
| `sin_credencial` | rojo | No hay credencial guardada, o la nube la rechazó |
| `detenida` | rojo | Un lote quedó bloqueante con un error determinístico |
| `pendientes_viejos` | ámbar | Hay pendientes y el más viejo pasa el umbral de 24 h (decisión 8, **provisional**) |
| `sin_conexion` | neutral | Hay credencial válida, pero no hay token vigente ahora mismo y hay pendientes |
| `pendientes` | neutral | Pendientes recientes, nada raro |
| `al_dia` | neutral | Sin pendientes |

**La prioridad importa, y está probada**: sin credencial gana sobre detenida
—es la causa de fondo, no el síntoma—, detenida gana sobre pendientes viejos, y
pendientes viejos gana sobre sin conexión.

> **EL TEXTO NO DICE «sin conexión desde HH:MM», aunque esa es la redacción
> literal del diseño.** Esta aplicación no tiene ningún reloj que registre el
> instante exacto en que se perdió la conexión —el detector de la fase 3.b solo
> guarda el ÚLTIMO veredicto, no cuándo cambió—, y escribir una hora ahí sería
> inventar una precisión que no se midió. Se dice cuántos pendientes hay, que
> sí es un dato real. Hay una prueba que barre los seis estados y exige que
> ninguno contenga algo con forma de hora.

> **En desarrollo sin `POS_NUBE_URL` nunca se ve `sin_credencial` ni
> `sin_conexion`**: esos dos estados solo aplican cuando hay un proyecto de
> nube configurado de verdad. Sin él, la barra dice `al_dia` o `pendientes`
> según haya algo en la cola, que es lo único honesto que se puede afirmar.

#### 2. El aviso al iniciar sesión, solo administrativo

En el menú de `PantallaDeSesion`, para rol administrativo, cuando el estado es
`pendientes_viejos`, `detenida` o `sin_credencial` **y además hay pendientes de
verdad** (`pendientes > 0`). Un install recién conectado, sin ninguna venta
todavía, no tiene nada que avisar aunque no tenga credencial: mostrar un aviso
rojo en una instalación nueva sería alarmar sin motivo.

#### 3. La pantalla de sincronización, completa

Nueva, solo administrativo (`sincronizacion:detalle`). Muestra:

- **Pendientes por tabla**, con nombres legibles (`ventas`, no `entidad_tipo`).
- **Último éxito**: `MAX(sincronizado_en)` leído de `sync_cola`, no guardado en
  memoria. Mismo criterio de siempre —todo el estado vive en la base— así que
  sobrevive a un cierre forzado.
- **El lote bloqueante, con su error TAL CUAL lo devolvió la función de
  Postgres**, sin resumir ni traducir: quien va a decidir si reintentar o
  saltar tiene que ver exactamente lo que Postgres dijo.
- **Archivos apartados** (§2.5.4, fase 3.c), si los hay.
- Tres acciones: **reintentar ahora**, **saltar este lote** y (ya existente)
  **conectar con la nube**.

##### «Reintentar ahora»

`desbloquearLote(loteId)` + un ciclo inmediato del trabajador
(`planificador.ejecutarAhora()`). No verifica que el lote siga existiendo ni
bloqueado: son operaciones seguras de pedir de más.

> **CÓMO SE LE PASA EL PLANIFICADOR AL SERVICIO, cuando todavía no existe.**
> `ServicioDeSincronizacion` se construye ANTES que
> `planificadorDeSincronizacion` en el arranque (§4.18: el trabajador se crea
> después de la ventana, para no competir con el arranque en un i3). La
> dependencia `ejecutarCicloAhora` es una FUNCIÓN que lee la variable al
> momento de llamarla, no ahora: `() => planificadorDeSincronizacion?.ejecutarAhora() ?? Promise.resolve(null)`.
> El orden de construcción deja de importar.

##### «Saltar este lote»: decisión 9, con PIN aunque ya haya sesión administrativa

Es la acción más sensible de esta fase: deja un hueco **deliberado y
permanente** en el respaldo de la nube. Por eso:

- **Nueva superficie de autorización**, `saltar_lote_de_sincronizacion`
  (migración local `029`, sin espejo en Postgres: `bloqueos_de_autorizacion` es
  estado operativo de una terminal, igual que las otras cuatro). **No acepta el
  PIN remoto**, por el mismo alcance mínimo que `salida_controlada` y
  `cierre_de_caja_ajena` —acá el argumento es más fuerte todavía: el hueco es
  permanente, así que quien autoriza tiene que estar viendo la pantalla—.
  *(Desde el 2026-09-15 `salida_controlada` sí acepta el remoto, por decisión
  explícita, §4.41; esta superficie sigue sin aceptarlo y la ampliación no se
  hereda.)*
- **Se pide el PIN aunque el canal YA exija `requiereRol('administrativo')`.**
  No es una comprobación de permisos redundante: es la firma deliberada que el
  diseño pide textualmente («tiene que quedar firmada»), el mismo criterio con
  que `cierre_con_diferencia` y `cierre_de_caja_ajena` vuelven a pedir PIN
  dentro de una sesión ya administrativa.
- **Muestra el error ANTES de pedir el PIN** (mismo criterio del cierre de caja
  descuadrado, §4.9): la confirmación repite las tablas y el error del lote.
- **Quien queda como autorizante es a quien coincidió el PIN**
  (`permiso.usuario.id`), no necesariamente la sesión activa —igual que
  `descuento_excedente`—.
- **Queda en `auditoria_log`** con el lote, las tablas que traía y quién
  autorizó. Ese asiento en sí es un hecho de negocio y **se encola** como
  cualquier otro, para llegar a la nube por `sincronizar_asiento` (la función
  de la 0027).
- **La marca local en `sync_cola` NO se limpia a `NULL`** como en un éxito
  genuino: `marcarLoteSaltado` reemplaza `error` por una nota
  («SALTADO A MANO el `<fecha>`: …») para que quien mire la fila en el disco
  —sin pasar por la auditoría— no la confunda con una subida real.

> **`ServicioDeSincronizacion` es la PRIMERA escritura de auditoría fuera de
> `src/main/domain`.** Vive en `src/main/sincronizacion` porque necesita el
> repositorio de la cola, no porque el hecho que audita sea menos de negocio.
> La prueba estructural de §4.26 (`todo-hecho-de-negocio-encola.test.ts`) se
> amplió para escanear también esa carpeta: es exactamente la clase de caso
> que existe para atrapar, un servicio nuevo que se olvida del envoltorio.
> **Falsificado**: quitándole `conBandejaDeSalida`, la prueba lo nombra por
> archivo y línea.

#### Verificado contra la aplicación REAL, con un lote bloqueante DE VERDAD

No alcanzaba con Vitest para la acción más sensible de la fase. `verify:pantallas`
abre una conexión SQLite APARTE contra el archivo temporal de la corrida —el
mismo que usa la aplicación, en modo WAL— e inserta un lote `bloqueante = 1`
con un error con forma de Postgres real (`23505 duplicate key…`), sin pasar por
ninguna función de negocio: es la forma más directa de simular «un lote quedó
detenido», sin depender de que la nube de verdad rechace algo en una corrida
que no tiene `POS_NUBE_URL`.

Con eso, se ejercitaron de punta a punta, contra la ventana real:

- El error se **muestra tal cual**, con `23505` y `duplicate key` legibles.
- **«Reintentar ahora»** hace desaparecer el lote bloqueado de la pantalla.
- **«Saltar»** muestra el error ANTES de pedir el PIN.
- Un **PIN equivocado** dice «PIN incorrecto.» y el lote sigue bloqueante: no
  se pierde nada por un PIN mal tecleado.
- El **PIN correcto** salta el lote, que desaparece de «detenido».
- **El asiento quedó en `auditoria_log` de verdad**, leído con una tercera
  conexión de solo lectura: `entidad_id` es el lote y `usuario_id` no es nulo.

> **UN DEFECTO PROPIO DEL ARNÉS, ENCONTRADO Y CORREGIDO ANTES DE CERRAR.** La
> primera versión de estas comprobaciones usaba `waitForTimeout(1000)` después
> de cada clic, y «reintentar ahora» falló la primera vez: el lote seguía
> apareciendo como bloqueante. La causa no era el código de la aplicación sino
> el arnés: el `onClick` de React dispara la acción con `void`
> (`fire-and-forget`, porque un manejador de evento no se puede awaitear), así
> que `click()` de Playwright resuelve en cuanto el clic se despachó, **no**
> cuando la operación asincrónica termina. Se corrigió esperando la
> CONSECUENCIA visible —`waitFor({ state: 'detached' })` sobre el aviso de lote
> bloqueante— en vez de un tiempo fijo a ciegas. Es la misma clase de lección
> que ya dejaron los defectos anteriores de esta comprobación (§4.11): medir la
> consecuencia, no suponer cuánto tarda.

`verify:pantallas` pasó de 39 a **46 comprobaciones**, corrido tres veces
seguidas sin inestabilidad.

#### Lo que NO se verificó

- **El umbral de 24 horas es un número provisional**, tal como el propio
  diseño lo dice (decisión 8). No se ejercitó contra la aplicación real —haría
  falta un pendiente de más de un día, y `verify:pantallas` corre en minutos—;
  está probado en el módulo puro, con el borde exacto (23h59m59s vs. 24h).
- **El aviso al iniciar sesión (nivel 2) no se ejercitó con `verify:pantallas`.**
  Se probó con Vitest sobre el componente, pero no manejando la aplicación real
  con un pendiente viejo de verdad.
- **La superficie `saltar_lote_de_sincronizacion` no aceptó nunca un PIN
  remoto en esta verificación**: no acepta ninguno, así que no había nada que
  probar ahí más allá de que el candado exista (que sí está en la prueba de
  `autenticacion.test.ts`).

### 4.35 La restauración desde la nube (Fase 4.b)

Cierra la sección 6 del diseño: la operación inversa de todo el módulo, y la
segunda de las dos superficies que el diseño marca como las más delicadas. El
costo de un error acá no es un fallo ruidoso: es una base reconstruida que se
ve completa y está sutilmente mal. Por eso cada regla de abajo tiene prueba
local, y las que solo la nube puede probar se probaron contra
`pos-pruebas-descartable` con `npm run verify:restauracion`.

Vive en `src/main/restauracion/` —cliente, conversión de tipos, orden,
puesto de control y servicio— con nueve canales IPC en `ipc/restauracion.ts`
y la pantalla `PantallaDeRestauracion`, que se ofrece desde la configuración
inicial («Restaurar desde la nube») y que manda sola cuando hay una
restauración a medias. El detalle de cada decisión, junto al texto del diseño
que la motivó, está en `docs/SINCRONIZACION.md` §6.7 y §6.8.

#### Las reglas, y dónde está cada prueba

| Regla | Cómo se cumple | Prueba |
|---|---|---|
| **Ningún id se regenera, nunca** | `INSERT … ON CONFLICT(id) DO NOTHING` con el id de la nube. Es lo que evita que la terminal restaurada choque contra las ocho restricciones únicas del punto 19 de §6.2 al volver a subir. | Ids comparados tabla por tabla contra la terminal de origen (local) y contra la nube (real) |
| **Solo sobre una base vacía** | Las once tablas de negocio en cero y sin puesto de control; se niega nombrando las tablas con filas, **antes de iniciar sesión**. No hay «fusionar» ni «sobrescribir». | local y real |
| **Nada antes de las precondiciones** | Sesión con rol `restauracion` (otro rol se rechaza sin guardar nada), nube alcanzable (capa 2 de §5), **contrato vivo igual al esquema local** con las reglas de la mitad A, las 11 denominaciones idénticas, y el orden compatible con las llaves foráneas de ESTA base. | Deriva falsificada con los casos de §9.3, local y real: se detiene nombrando `ventas.total`, con la base vacía y sin puesto de control |
| **Solo lectura, solo SELECT** | Nunca por las funciones `sincronizar_*`; una prueba estructural comprueba que el cliente no las nombra ni usa PATCH/PUT/DELETE. | `restauracion-guard.test.ts` |
| **Orden = grafo de llaves foráneas del catálogo** | Las quince llaves se leyeron de `pg_constraint` de Postgres el 2026-09-14 y están copiadas en la prueba; el esquema local declara exactamente las mismas, y el servicio comprueba el orden contra `PRAGMA foreign_key_list` antes de escribir. `auditoria_log` al final, y sin asumir que cada asiento venga acompañado. | `orden-de-restauracion.test.ts` |
| **Los numéricos se piden con `::text` y se NORMALIZAN, nunca se redondean** | PostgREST devolvería `NUMERIC` como `double`. Con `::text` llega `"4.165000"` para `subtotal_exacto` (`numeric(18,6)`), y la conversión lo deja en `4.165`, que es byte a byte lo que SQLite guardó. Más decimales de los que la columna admite → se rechaza. | `conversion-de-tipos.test.ts`, incluida la inserción real en un SQLite migrado; y el texto crudo `"4.165000"` leído de la nube |
| **Las fechas pasan de `+00:00` a `Z` sin perder precisión** | `toISOString`, que es lo que escribió la terminal, hasta tres decimales; con MÁS de tres —solo los escribe SQL en la nube, como el `now()` con que la 0016 sembró `configuracion_negocio.actualizado_en`— se conservan enteros, porque el CHECK local los admite y truncar sería perder. **Corregido el 2026-09-14**: la primera versión los rechazaba, y `verify:pantallas:restauracion` mostró que eso dejaba la restauración sin poder correr contra una fila que ninguna terminal hubiera guardado, que es exactamente la del proyecto real hoy (`2026-09-11 14:58:55.89473+00`, con Jimmy todavía sin cargar sus datos). | `conversion-de-tipos.test.ts`, y el arnés por la ventana |
| **La tabla de clases de columna es explícita y coincide con la nube** | `CLASES_DE_COLUMNA` se coteja columna por columna contra la foto `esquema-nube.json`: cada tipo de Postgres tiene su clase y no hay columnas de más ni de menos. | `conversion-de-tipos.test.ts` |
| **Todo usuario queda SIN PIN** | `HASH_SIN_PIN` en `pin_hash`, `NULL` en el remoto, sin intentos ni bloqueo. `verificarPin` lo rechaza siempre sin lanzar; ningún hash real puede coincidir con él. Ver §6.7 del diseño. | `pin-sin-asignar.test.ts` (los 10 000 PIN), y el servicio |
| **No termina sin PIN nuevo para cada activo, sin revisar cada usuario anómalo, ni sin un administrador activo** | `impedimentosParaTerminar()` los nombra; `terminar()` se niega con ellos. | `servicio-de-restauracion.test.ts` |
| **`pdf_path` llega tal cual: es RELATIVA desde la migración 030** | Desde el 2026-09-14 `ServicioDeRecibos` guarda `recibos/<nombre>.pdf`, relativa a la carpeta de datos, como `foto_path` (§4.14); la restauración la escribe sin tocarla y el arnés real la compara byte a byte. Las filas subidas ANTES con la ruta absoluta de la terminal vieja se convierten a esa forma al bajarlas: compatibilidad hacia atrás, no comportamiento esperado. La reimpresión regenera el PDF en la carpeta de esta máquina: probado con el archivo ausente. | `servicio-de-restauracion.test.ts`, `ruta-de-pdf.test.ts`, `recibos-pdf-path-relativo.test.ts`, y el arnés real |
| **Las fotos bajan de Storage a su ruta local; las que faltan se listan** | Objeto derivado de `foto_path` (§2.5.1), escrito solo dentro de la carpeta de fotos (`resolverRutaDeFoto`). | sha256 idéntico al subido, local y real |
| **Verificación: conteos y suma por mes al centavo** | `nube = local + excluidas`, tabla por tabla; y `SUM(total)` por mes en Postgres (`restauracion_ventas_por_mes`, migración 0029) contra `sumarLista` de Decimal. Si no cuadra, no se termina. | local y real |
| **Anomalías por `recibido_en`** | En las doce tablas que la tienen, contra la fecha del robo; nunca por `creado_en` ni `actualizado_en`. Regla de exclusión en §6.8 del diseño. | local (seis filas en cinco tablas) y real (diez filas en cinco tablas) |
| **Retomable y cancelable** | Puesto de control por página; cancelar deja la base en la última página completa; retomar exige iniciar sesión otra vez y se niega contra otro proyecto. | Cancelada tras la página 4 (local) y 5 (real) y retomada: mismos ids que la nube, sin duplicados |
| **Lo decidido se encola, lo restaurado no** | Los asientos de PIN asignado, usuario revisado, fila restaurada a mano y restauración completada van por `conBandejaDeSalida`; la prueba estructural de §4.26 escanea también `src/main/restauracion`. | `servicio-de-restauracion.test.ts`: tres asientos y dos `usuarios` en la cola, ninguna fila restaurada |
| **La sesión es efímera** | Vive en memoria, se renueva sola al 75 % de `exp - iat`, y `cerrarSesion()` revoca **solo la suya** (`scope=local`). Nunca toca `safeStorage`. | `restauracion-guard.test.ts` y los `204` del `logout` |

#### Verificado contra la nube REAL: `npm run verify:restauracion`

Tres corridas el 2026-09-14 contra `pos-pruebas-descartable`, con las once
tablas vaciadas por SQL antes de cada una. La tercera dio **13 de 13**, con
**200 peticiones HTTP** anotadas con hora, método, ruta y código. Lo que hace
el arnés: llena una terminal de origen con los SERVICIOS reales (el catálogo
de `terminal-de-origen.ts`: una cajera bloqueada por intentos con sus asientos
sueltos, un producto con foto, uno cuya foto se borró del disco antes de subir
y uno sin foto, la venta combinada de §4.13, una con tarjeta, el tope con id
fijo, una caja cerrada con diferencia autorizada y arqueo por denominaciones),
la sube con `SesionDeNube`, `SupabaseSyncProvider` y `TrabajadorDeSincronizacion`,
anota la hora, sube una segunda tanda «posterior al robo», y restaura en una
base nueva con `ClienteDeRestauracionHttp`.

Salida cruda de la corrida 3 (05:44Z), la que pasó entera:

```
--- SUBIDA 1 --- ciclo 1: cola_vaciada; 19 lotes, 41 filas; pendientes en la cola: 1
                 (la pendiente es la foto APARTADA: archivo_ausente, se vuelve a buscar mañana)
--- SUBIDA 2 --- ciclo 1: cola_vaciada; 4 lotes, 10 filas
GET /rest/v1/usuarios?select=id&limit=1                       -> HTTP 206   (count=exact)
POST /rest/v1/rpc/contrato_de_sincronizacion                  -> HTTP 200
GET /rest/v1/venta_detalle?select=…,subtotal_exacto::text,…   -> HTTP 200
PostgREST devolvió subtotal_exacto = "4.165000" (tipo string), cantidad = "3.500",
  creado_en = "2026-09-14T05:44:04.278+00:00", recibido_en = "2026-09-14T05:44:06.676452+00:00"
usuarios 2 · categorias 1 · configuracion_negocio 1 · productos 3 · limites_descuento 1
caja_sesiones 3 · caja_sesion_denominaciones 2 · ventas 2 · venta_detalle 3 · recibos 2
auditoria_log 17 filas restauradas; fotos: 2 productos con foto, 1 sin archivo en la nube
ventas 2026-09: nube Q47.93 = local Q39.68 + excluidas Q8.25 -> coincide
auditoria_log: nube 21 = local 17 + excluidas 4 -> coincide
foto del maíz: sha256 subido 497790…e1581 = bajado 497790…e1581
GET /storage/v1/object/fotos/<la que se borró>.png            -> HTTP 400 (not_found) -> listada
POST /auth/v1/logout?scope=local                              -> HTTP 204
cancelada tras 5 páginas; filas locales: usuarios=2, categorias=1, configuracion_negocio=1, productos=0, …
```

Las diez anomalías de la corrida real, por `recibido_en` posterior a la
fecha del robo: `usuarios` (Ana editada), `productos` (el frijol, cuyo
inventario bajó la venta posterior), dos `caja_sesiones` (la cerrada después y
la abierta después) —las cuatro **restauradas y listadas**—, y `ventas`,
`venta_detalle` y cuatro `auditoria_log` **excluidas**. Aceptar la venta la
restauró con su línea y su recibo, y la verificación siguió cuadrando.

#### Tres cosas que SOLO la nube real mostró

Ninguna la podía ver una prueba con dobles, porque un doble contesta lo que
uno cree que contesta la nube:

1. **PostgREST contesta `206 Partial Content`, no `200`, a un conteo con
   `Prefer: count=exact` y `limit=1`.** La primera corrida se detuvo en la
   primera tabla: mi cliente tomaba el 206 por rechazo. Corregido y escrito
   en el cliente con la medición.
2. **El `logout` de GoTrue es GLOBAL por omisión**: revoca todas las
   sesiones del usuario. En la segunda corrida, otro cierre del arnés con el
   mismo usuario dejó a la sesión de la restauración contestando `403` al
   cerrarse, aunque su access token seguía sirviendo. Corregido con
   `?scope=local`, que es además lo correcto: el usuario de restauración es el
   del dueño, y cerrar la restauración no debe cerrarle nada más.
3. **`precios_especiales` no llegó a la nube**, y no es un defecto de la
   restauración: en producción nada la escribe (punto 18 de §6.2), y la
   terminal de origen la siembra por el repositorio, que no encola. La venta
   sí usó el precio especial, y eso viaja en `precio_unitario_snap`. El arnés
   la excluye de la comparación contra el origen y lo dice; la comparación de
   ids contra la nube, que es la que manda, pasa.

#### Lo que el diseño no cerraba, y se decidió a la vista

Está en §6.8 del diseño, punto por punto. Lo más importante: **«sin
restaurar» solo para las tablas que la nube SOLO INSERTA**. Aplicado a todas,
§6.5 rompería las llaves foráneas de lo legítimo, porque una fila anterior al
robo y MODIFICADA después tiene `recibido_en` posterior y otras filas la
referencian. Las cinco de solo inserción se excluyen y se listan, con
«restaurar igual» por fila; las siete que también se actualizan se restauran
y se listan, y `usuarios` exige revisión uno por uno. **Es una interpretación,
no lo que §6.5 dice literalmente, y se señala para que Julio la confirme o la
cambie.**

#### Lo que NO se verificó

- ~~Nada de esto se corrió contra `pos-jimmy-cano`~~ **HECHO el 2026-09-14: la
  `0029` está en el real (§4.4) y la restauración se corrió entera contra él,
  11 de 11**, con `npm run ensayo:restauracion -- --entorno=.env.nube-real` y
  con Julio tecleando su contraseña en la ventana. Ver el bloque de abajo. Lo
  que el real no puede ejercitar hoy es una restauración CON DATOS: está en
  cero filas de negocio, así que lo que se probó es el camino entero —
  precondiciones, las doce tablas, la suma por mes, la revisión y el cierre de
  sesión— sobre una nube vacía.
- ~~La pantalla no se manejó con `verify:pantallas` más allá del caso «sin
  configurar»~~ **HECHO el 2026-09-14 con `npm run verify:pantallas:restauracion`**,
  la contraparte con red de `verify:pantallas`: 44 comprobaciones clicando la
  ventana real, del formulario al ingreso con el PIN nuevo. Ver el bloque de
  abajo, con lo que apareció al hacerlo.
- ~~Una restauración más larga que la vida de un token (900 s) no se
  ejercitó~~ **HECHO el 2026-09-14 con `npm run verify:restauracion:renovacion`**:
  una restauración real de 1010 s contra la nube, con UNA renovación a mitad
  de la transferencia y el control de que el token viejo ya no servía. Ver
  abajo.
- ~~Retomar después de MATAR el proceso no se ejercitó~~ **HECHO el
  2026-09-14, en el mismo arnés**: `SIGKILL` al proceso principal de Electron
  con dos tablas listas y diez por bajar, arranque NUEVO sobre la misma
  carpeta, retoma por la ventana. Ver abajo.
- **Windows**, como siempre: todo se midió en macOS.

#### Después del informe: lo que Julio pidió ver, y lo que apareció al verlo

Julio pidió tres cosas antes de dar por cerrada la fase: el camino feliz
entero por la ventana, incluida la pantalla de «hay usuarios sin PIN»
bloqueando el cierre; matar el proceso de Electron de verdad a mitad de una
restauración y retomar en un arranque limpio; y confirmar qué pasa cuando la
sesión supera los 900 s del access token. Las dos primeras las contesta
`npm run verify:pantallas:restauracion` (`scripts/verificacion-de-restauracion-en-pantalla.cjs`);
la tercera, `npm run verify:restauracion:renovacion`
(`renovacion-de-sesion.nube.ts`). Y de paso pidió corregir el origen del
`pdf_path` absoluto en vez de compensarlo al restaurar (§4.14, migración 030).

**El arnés por la ventana, en dos instalaciones con carpetas temporales
distintas contra la misma nube.** La FASE A es la terminal de ORIGEN creada
con clics: primer administrador, «Conectar con la nube» con la credencial de
terminal, categoría, producto, una cajera, caja abierta, una venta cobrada
con su recibo; espera a que el trabajador de la aplicación suba la cola y
guarda los ids de la base A. La FASE B es la RESTAURACIÓN, también con clics,
en una instalación nueva. Quinta corrida, 2026-09-14, **44 de 44**:

```
12:14:22.638Z A: cola vacía a los 5567 ms
  OK  A: el trabajador de la app de origen arrancó con SupabaseSyncProvider, no con el simulado
  OK  A: el recibo emitido por la aplicación REAL guarda pdf_path RELATIVA (recibos/<nombre>.pdf)
  OK  la nube tiene, tabla por tabla, exactamente las filas que la terminal de origen subió
12:14:26.753Z B: puesto de control al matar: transferenciaCompleta=false; listas=[usuarios, categorias]; a medias=[]
  OK  B: el proceso se mató A MITAD de la transferencia de tablas
  OK  B: después del SIGKILL, restauracion.json sigue en el disco
12:14:26.757Z B: filas en la base B tras el SIGKILL: usuarios=2 categorias=1 configuracion_negocio=1 productos=0 … auditoria_log=0
  OK  B: la base quedó consistente con el puesto de control: cada tabla LISTA tiene todas sus filas, cada tabla no empezada ninguna
  OK  B: el arranque limpio abre DIRECTO en la restauración incompleta: ni configuración inicial ni ingreso
  OK  B: tras el arranque limpio el botón ofrece RETOMAR, no iniciar de cero
  OK  B: la retoma llega a la revisión
  OK  B: la verificación CUADRA en pantalla: conteos nube = acá y ventas por mes al centavo, sin ninguna ✗
  OK  B: los dos usuarios de la terminal de origen aparecen, y los dos SIN PIN
  OK  B: «Terminar» con usuarios sin PIN se NIEGA, y el aviso nombra a los dos usuarios
  OK  B: con UN PIN asignado, terminar sigue negándose y ya solo nombra a quien falta
  OK  B: con los dos PIN asignados, «Terminar» llega al resumen final
  OK  B: [las doce tablas]: los ids de la base restaurada son EXACTAMENTE los de la terminal de origen
  OK  B: recibos.pdf_path llega IDÉNTICA byte a byte a la del origen, relativa, sin re-enraizar nada
  OK  B: el PIN VIEJO de la terminal de origen NO entra; el PIN NUEVO asignado en la restauración SÍ entra
  OK  B: la terminal restaurada sigue auditando: el PIN viejo dejó un ingreso_fallido y el nuevo un ingreso_correcto
12:14:34.177Z B: sync_cola de la restaurada: auditoria_log=5, usuarios=2
```

El `SIGKILL` cae dentro de una ventana de unos 300 ms —el arnés sondea
`restauracion.json` cada 15 ms y mata en cuanto ve dos tablas listas—, y las
tres corridas que llegaron hasta ahí lo atraparon en el mismo punto. Es
matar el proceso principal de verdad, no cancelar desde la aplicación: la
base B quedó con las dos tablas completas y las diez restantes en cero, que
es exactamente lo que el puesto de control decía, y el arranque limpio no
ofreció ni la configuración inicial ni el ingreso.

**Cuatro cosas aparecieron al hacerlo, y ninguna la había visto el servicio:**

1. **Un defecto REAL, y el proyecto real lo tiene hoy.** La tercera corrida se
   detuvo tres veces en el mismo punto: `configuracion_negocio.actualizado_en:
   «2026-09-14T12:05:15.313623+00:00» tiene 6 decimales de segundo y el
   formato local guarda 3: normalizar sería truncar`. Esa fila la sembró la
   migración 0016 con `now()` de Postgres —microsegundos— y ninguna terminal
   la había guardado después, así que conservaba ese valor. Es exactamente la
   situación de `pos-jimmy-cano`, leído el mismo día: `2026-09-11
   14:58:55.89473+00`, con Jimmy todavía sin cargar sus datos. Los arneses
   anteriores no lo vieron porque su terminal de origen SÍ guardaba los datos
   del negocio, y eso pisaba la fila con una fecha de tres decimales. **La
   regla cambió**: los decimales de más se conservan enteros, porque el CHECK
   local los admite (`LIKE '____-__-__T__:__:__%Z'`) y truncar sería perder
   (`conversion-de-tipos.ts`, con su prueba sobre el valor del real y una
   actualización real en SQLite).
2. **Una cola «vacía» no prueba nada sola.** La primera corrida pasaba
   `POS_NUBE_URL` y nada más: «Conectar con la nube» conectó de verdad, la
   cola se marcó como subida en 3,5 s… y la nube seguía vacía. La bitácora
   técnica lo decía en su segunda línea: `trabajador en marcha con
   SimulatedSyncProvider`. El proveedor real lo elige `POS_SYNC_PROVIDER=supabase`
   (la fábrica de `src/shared/adapters/index.ts`, que sin esa variable cae al
   simulado a propósito). El arnés ahora lee la bitácora y exige
   `SupabaseSyncProvider`. Queda dicho: **con `POS_NUBE_URL` puesta y
   `POS_SYNC_PROVIDER` ausente, la pantalla de nube dice «conectada» y la de
   sincronización va a decir «al día» sin que nada haya viajado**. Es el
   comportamiento de desarrollo de siempre, y la pantalla no lo distingue.
3. **La nube contestó dos `504 Gateway Timeout` reales durante la subida de
   la segunda corrida**, y el trabajador de la aplicación los trató como
   transitorios, tal como §4.18 dice: `sincronizar_usuario rechazó el lote
   (HTTP 504)` → `intento 1 falló; se reintenta a partir de …` → cola vacía
   a los 26,8 s en vez de 5. Es la escalera de reintentos funcionando en la
   aplicación real contra un fallo real, no simulado.
4. **Un fallo transitorio a MITAD de la restauración la deja «detenida», no
   la reintenta.** El cliente de restauración no tiene escalera de
   reintentos: un `504` en una página termina en fase `fallida` con el
   motivo, y la persona vuelve a pulsar «Retomar», que sigue por la página
   donde quedó. El arnés hace lo mismo, hasta tres veces, anotando cada
   motivo; en las corridas 4 y 5 no hizo falta. **Es una decisión FINAL,
   confirmada por Julio el 2026-09-14** al leer este informe (hasta entonces
   estaba anotada como abierta): un 5xx a mitad de una restauración la deja
   detenida y visible, con su motivo, sin reintento automático. La subida sí
   reintenta sola porque corre sin nadie delante. Ver la fila de §5.

**La renovación del token, medida en una restauración real de 17 minutos.**
`npm run verify:restauracion:renovacion` (`renovacion-de-sesion.nube.ts`,
solo con `POS_NUBE_RENOVACION=1`) siembra y sube la terminal de origen, y
restaura con el cliente y el servicio REALES envueltos en un retraso de 75 s
antes de cada página —el retraso es del arnés, no de la aplicación: es una
tienda con un año de ventas y una conexión lenta sin sembrar un año de
ventas—, calculado del token que se acuña ese día (`exp − iat`, renovación
al 75 %). Corrida del 2026-09-14, **5 de 5**, con la HUELLA (ocho caracteres
del sha256, nunca el token) de cada petición:

```
12:19:09Z token de sonda: exp - iat = 900 s; se renueva a los 675 s; retraso por página = 75 s × 13 páginas
12:19:09Z primer token de la restauración: huella 799ea309, iat=1789388349, exp=1789389249
12:21:41Z restauracion: usuarios: 2 filas restauradas
   …      categorias, configuracion_negocio, productos, precios_especiales, limites_descuento
12:29:15Z restauracion: caja_sesiones: 2 filas restauradas
12:30:30Z [auth] POST /auth/v1/token?grant_type=refresh_token -> HTTP 200
12:30:31Z RENOVACIÓN observada (HTTP 200) en fase tablas, con listas: usuarios, categorias,
          configuracion_negocio, productos, precios_especiales, limites_descuento, caja_sesiones
12:30:53Z restauracion: caja_sesion_denominaciones: 2 filas restauradas
   …      ventas, venta_detalle, recibos
12:35:56Z restauracion: auditoria_log: 17 filas restauradas
12:35:59Z restauración en fase revision tras 1010 s
          lecturas antes de renovar: 17 (huellas: 799ea309); después: 24 (huellas: 68ecfd25)
12:35:59Z primer token a mano, 110 s después de su exp: HTTP 401 {"code":"PGRST303","message":"JWT expired"}
12:35:59Z el cliente, en el mismo instante: usuarios en la nube = 2
```

O sea: **se renueva sola, y no se corta.** La renovación cayó exactamente
donde `tokenVigente()` la agenda —675 s después de la primera lectura, con
siete tablas listas y cinco por bajar—, todas las páginas posteriores
viajaron con el segundo token, la restauración llegó a la revisión con la
verificación cuadrando a los 1010 s (más que la vida entera del primer
token), y el CONTROL dice lo que le habría pasado a una restauración que no
renovara: el primer token, presentado a mano 110 s después de su `exp`,
contesta `401 PGRST303 JWT expired`. Durante esa misma corrida la nube
contestó otros dos `504` seguidos en una página; el reintento que los
absorbió es del arnés (`conReintentoAnte5xx`, para no tirar una corrida de
diecisiete minutos), no de la aplicación, que los deja en «detenida» (punto 4
de arriba). Con `verify:restauracion` a secas el archivo se salta entero.

Y una precisión sobre el propio arnés: la cuarta corrida marcó una falla
que no era de la aplicación. Comparaba `auditoria_log` DESPUÉS de iniciar
sesión, y el ingreso con el PIN viejo y el nuevo escribió dos asientos
legítimos (`ingreso_fallido`, `ingreso_correcto`) que además se encolaron,
como manda §4.26. Se corrigió el orden de la comparación y esos dos asientos
pasaron a comprobarse a propósito: una terminal restaurada sigue auditando.

#### El ensayo de restauración por la ventana (`ensayo:restauracion`), y la bitácora por petición

Nace del pedido de Julio del 2026-09-14: «una restauración de PRUEBA completa
contra `pos-jimmy-cano` usando una base local de descarte (no la que vas a usar
para producción) para confirmar que la fila de `configuracion_negocio` con sus
microsegundos reales pasa sin problema esta vez». Ninguno de los dos arneses
existentes sirve para eso: `verify:restauracion` y `verify:pantallas:restauracion`
SIEMBRAN una terminal de origen y la SUBEN, y el seguro de
`proyectos-de-prueba.cjs` les niega el real por nombre, que es correcto y no se
toca. La restauración en sí es solo lectura, así que lo que hacía falta era un
guion que no sembrara nada:

- `scripts/ensayo-de-restauracion.cjs` abre la aplicación REAL con
  `--user-data-dir` en una carpeta temporal nueva, la lleva a «Restaurar desde
  la nube» y **espera a que una persona teclee el correo y la contraseña en la
  ventana**: el guion no los conoce, no los pide y no los lee. Solo contra un
  proyecto que el seguro admita (el descartable) llena el formulario por su
  cuenta, con las variables de `.env.nube-pruebas`; contra cualquier otro
  proyecto esas variables se ignoran aunque estén.
- Sigue la transferencia tabla por tabla, anota la verificación, pulsa
  «Terminar» —que se tiene que NEGAR, porque ningún usuario restaurado tiene
  PIN y el guion no asigna ninguno—, deja la restauración «para después» (lo
  que revoca la sesión con `logout?scope=local`), lee la base restaurada con
  una conexión aparte y vuelca la bitácora técnica. La carpeta no se borra: es
  la evidencia.
- **No escribe nada en la nube.** Lo único que la nube registra es la sesión
  de Auth que la persona abre y que se cierra al final; la terminal nunca se
  conecta con su credencial, así que la cola local no sube nada (corre con
  `POS_SYNC_PROVIDER=supabase` y sin credencial: el trabajador no hace nada).
- El proyecto se elige con `--entorno=<archivo>`. `.env.nube-real` (ignorado
  por git) trae SOLO la URL y la llave publicable del real, sin contraseñas.

**La evidencia cruda ahora la escribe la propia aplicación.** Hasta acá, la
línea por petición —hora, método, ruta, código— la anotaban los arneses con su
propio `fetch`; desde el 2026-09-14 el cliente de restauración registra cada
petición en `log-tecnico.log` (`cliente-de-restauracion.ts`,
`rutaParaLaBitacora`: sin la lista `select=` ni el `order=`, que son largos y
siempre iguales por tabla, y nunca el token, que viaja en la cabecera). Una
restauración en la tienda deja así el mismo rastro que una corrida de
verificación. Tiene sus pruebas (`cliente-de-restauracion.test.ts`), incluida
la de que ni la contraseña ni los dos tokens aparecen en la bitácora.

**Ensayo contra `pos-pruebas-descartable`, 2026-09-14, 9 de 9**, en el mismo
estado en que está hoy el real —cero filas de negocio y la fila única de
`configuracion_negocio` sembrada por SQL con microsegundos—, con el formulario
llenado por el guion (proyecto de pruebas):

```
16:33:16.360Z ENSAYO DE RESTAURACIÓN contra el proyecto ztidrshifrblhfraiowg …; carpeta de datos NUEVA y descartable: …/pos-ensayo-restauracion-RH4M5s
  OK    la pantalla ofrece iniciar: proyecto configurado, instalación vacía
  OK    la restauración arrancó (alguien inició sesión en la ventana)
  OK    la transferencia llegó a la revisión (si la nube falló a mitad, retomar sigue desde donde quedó)
16:33:27.605Z verificación en pantalla: Verificación · cuadra … datos del negocio: nube 1 · acá 1 ✓ … (las doce con ✓) … Ventas por mes, al centavo: sin ventas
  OK    la verificación CUADRA en pantalla: conteos nube = acá, y ventas por mes al centavo, sin ninguna ✗
16:33:28.641Z al pulsar «Terminar»: Todavía no se puede dar por terminada: no queda ningún administrador activo: reactivá uno, o la terminal no se va a poder administrar.
  OK    «Terminar» se NIEGA con el motivo (sin PIN asignado o sin administrador activo): un ensayo nunca termina una restauración
  OK    al dejarla para después, la pantalla vuelve al formulario ofreciendo RETOMAR (lo bajado queda guardado)
    log-tecnico: 16:33:16.944Z [sincronizacion] trabajador en marcha con SupabaseSyncProvider; primer ciclo en 30 s. Pendientes en la cola: 0 filas en 0 lotes.
    log-tecnico: 16:33:18.289Z [restauracion] sesión de restauración iniciada como restauracion-pruebas@pos-pruebas.invalid
    log-tecnico: 16:33:19.551Z [restauracion] POST /rest/v1/rpc/contrato_de_sincronizacion -> HTTP 200
    log-tecnico: 16:33:19.903Z [restauracion] GET /rest/v1/denominaciones?limit=1000 -> HTTP 200
    log-tecnico: 16:33:19.907Z [restauracion] precondiciones cumplidas: nube alcanzable, contrato igual al esquema local, denominaciones idénticas
    log-tecnico: 16:33:20.134Z [restauracion] GET /rest/v1/usuarios?limit=1 -> HTTP 200
    log-tecnico: 16:33:20.262Z [restauracion] GET /rest/v1/usuarios?limit=1000 -> HTTP 200
    log-tecnico: 16:33:20.265Z [restauracion] usuarios: 0 filas restauradas
    … (las otras once tablas, con el mismo par de peticiones y su línea de «N filas restauradas» cada una)
    log-tecnico: 16:33:20.906Z [restauracion] configuracion_negocio: 1 filas restauradas
    log-tecnico: 16:33:23.532Z [restauracion] fotos: 0 productos con foto, 0 sin archivo en la nube
    … (el conteo de verificación de las doce, `?limit=1 -> HTTP 200` cada una)
    log-tecnico: 16:33:26.452Z [restauracion] POST /rest/v1/rpc/restauracion_ventas_por_mes -> HTTP 200
    log-tecnico: 16:33:26.454Z [restauracion] transferencia completa; verificación OK; queda la revisión
    log-tecnico: 16:33:28.805Z [restauracion] sesión de restauración cerrada (HTTP 204)
16:33:31.707Z configuracion_negocio en la base del ensayo: {"id":"unica","nombre_comercial":null,…,"actualizado_en":"2026-09-14T12:36:42.760579Z"}
  OK    configuracion_negocio.actualizado_en llegó con TODOS sus decimales y en la forma local (Z)
  OK    las 11 denominaciones del quetzal están (las siembra la migración; la restauración solo las coteja)
  OK    en la base, todo usuario restaurado tiene el centinela «sin PIN» y ningún PIN remoto
  OK    la sesión de la nube se cerró al dejar la restauración (logout con scope=local, en la bitácora)
```

Dos cosas que este ensayo dice de una nube SIN usuarios, y que valen tal cual
para el real de hoy: la restauración llega a la revisión con la verificación
cuadrando —la fila con microsegundos pasa—, y **no se puede terminar**, porque
«no queda ningún administrador activo». Es lo correcto: restaurar una nube
vacía no deja una terminal administrable. «Dejarla para después» cierra la
sesión y conserva el puesto de control, así que esa carpeta ofrece retomar la
próxima vez que se abra; en un ensayo se descarta la carpeta y listo.

#### LA RESTAURACIÓN CONTRA `pos-jimmy-cano`, CORRIDA DE VERDAD: 11 de 11

**2026-09-14, 17:07 UTC.** Es la primera vez en la vida del proyecto que la
aplicación real baja el contenido del proyecto REAL. La corrió Julio: el guion
abrió la ventana y esperó, él tecleó su correo y su contraseña —esta sesión no
los maneja— y el resto lo hizo el guion. Salida cruda:

```
17:07:35.894Z [restauracion] sesión de restauración iniciada como julioes134@outlook.es
17:07:37.025Z [restauracion] POST /rest/v1/rpc/contrato_de_sincronizacion -> HTTP 200
17:07:37.274Z [restauracion] GET /rest/v1/denominaciones?limit=1000 -> HTTP 200
17:07:37.276Z [restauracion] precondiciones cumplidas: nube alcanzable, contrato igual al esquema local, denominaciones idénticas
17:07:37.567Z [restauracion] usuarios: 0 filas restauradas
   …          (las doce tablas, cada una con su conteo y su página)
17:07:40.906Z [restauracion] configuracion_negocio: 1 filas restauradas
17:07:40.726Z [restauracion] fotos: 0 productos con foto, 0 sin archivo en la nube
17:07:42.619Z [restauracion] POST /rest/v1/rpc/restauracion_ventas_por_mes -> HTTP 200
17:07:42.622Z [restauracion] transferencia completa; verificación OK; queda la revisión
17:07:43.658Z verificación en pantalla: Verificación · cuadra — usuarios: nube 0 · acá 0 ✓ · … · asientos de auditoría: nube 0 · acá 0 ✓
17:07:44.712Z al pulsar «Terminar»: Todavía no se puede dar por terminada: no queda ningún administrador activo…
17:07:44.941Z [restauracion] sesión de restauración cerrada (HTTP 204)
17:07:47.785Z configuracion_negocio en la base del ensayo: {"id":"unica",…,"actualizado_en":"2026-09-11T14:58:55.89473Z"}
  OK  configuracion_negocio.actualizado_en llegó con TODOS sus decimales y en la forma local (Z)
  OK  las 11 denominaciones del quetzal están …
  OK  en la base, todo usuario restaurado tiene el centinela «sin PIN» y ningún PIN remoto
  OK  la sesión de la nube se cerró al dejar la restauración (logout con scope=local, en la bitácora)
  11 comprobaciones, 0 fallidas
```

**La fila de los microsegundos pasó, y es la que motivó todo esto:** la nube
tiene `2026-09-11 14:58:55.89473+00` y la base restaurada quedó con
`2026-09-11T14:58:55.89473Z`, los cinco decimales enteros. Es la misma fila que
hizo fallar tres veces la tercera corrida del arnés por la ventana antes de
corregir la regla. La `0029` se ejercitó de verdad (`restauracion_ventas_por_mes
-> HTTP 200`), y la precondición de deriva pasó contra el contrato vivo del
real, que es lo que hasta ayer no podía pasar.

El puesto de control quedó con `"proyecto": "https://zgsdaelmbxufgcsideep.supabase.co"`
y `"correo": "julioes134@outlook.es"`. Nada se escribió en la nube: las 26
peticiones son `GET`, dos `POST` a funciones de solo lectura y el `logout`.

##### EL PRIMER INTENTO FALLÓ, Y LA CAUSA VALE MÁS QUE EL SÍNTOMA

A las 17:00:03 la pantalla dijo «Supabase rechazó ese correo y esa contraseña».
La credencial que se tecleó era la del **proyecto de pruebas**
(`restauracion-pruebas@pos-pruebas.invalid`), la misma con la que el guion
completa el ensayo del descartable. **Son dos proyectos de Supabase con dos
tablas de usuarios distintas**: `pos-jimmy-cano` tiene un solo usuario de Auth,
`julioes134@outlook.es`, leído de `auth.users`. Medido contra el real, con la
misma llave y la misma petición que hace la aplicación:

```
POST …/auth/v1/token?grant_type=password  {"email":"restauracion-pruebas@pos-pruebas.invalid",…}
-> HTTP 400 {"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}
```

Se descartaron primero las dos hipótesis más baratas, y las dos estaban bien:
la ventana apuntaba al real (leído del entorno del proceso de Electron:
`POS_NUBE_URL=https://zgsdaelmbxufgcsideep.supabase.co`), y el formulario **sí**
recorta el correo (`correo.trim()` en las dos ramas). La contraseña NO se
recorta, y eso es deliberado: recortarla cambiaría en silencio una credencial
que puede llevar espacios a propósito.

> **LO QUE FALTA, Y ES UN HUECO REAL: el fallo de Auth no queda en ninguna
> bitácora.** El registro por petición de este mismo día cubre PostgREST y
> Storage, que pasan por `pedir()`; las llamadas a Auth van por
> `ClienteDeAuthHttp`, que no recibe ningún registrador, y la causa técnica
> viaja al renderer dentro de la respuesta IPC sin pasar por
> `log-tecnico.log`. O sea que el `error_code` exacto de Supabase hoy se pierde,
> y hubo que reproducirlo por fuera con `curl` para verlo. **Propuesto y NO
> hecho, a la espera de que Julio lo decida:** registrar el fallo de Auth con su
> código y su `error_code`, y que la pantalla de restauración diga a qué
> proyecto se va a conectar, porque hoy no lo muestra y es exactamente la
> confusión que invita.

##### `--carpeta`: retomar un ensayo interrumpido, y tres defectos que apareció al construirlo

La primera corrida contra el real se interrumpió —Julio cerró la ventana antes
de teclear la contraseña— y pidió relanzarla **sobre la misma carpeta**, para
que la pantalla ofreciera «Retomar» en vez de empezar de cero. El guion solo
sabía crear carpetas nuevas, así que ahora acepta `--carpeta=<ruta>`. Y al
mirar esa carpeta, la premisa resultó ser otra: **no tenía `restauracion.json`**
—la bitácora no tiene una sola línea `[restauracion]`, o sea que la
restauración nunca llegó a arrancar— así que no había progreso que retomar.

**Y esa carpeta, además, ya no servía para restaurar**, por una razón que vale
más que el caso: la bitácora muestra dos asientos
`salida_controlada_rechazada` con `detalle: SIN_ADMINISTRADORES`, del botón de
la barra de estado, a las 16:42:28 y 16:42:33. Es el kiosko funcionando como
manda §4.1 —la salida controlada exige el PIN de un administrador— y en una
instalación recién creada **no hay ninguno**, así que la aplicación no se puede
cerrar desde adentro. Cada intento deja su asiento, y `auditoria_log` es una de
las once tablas que la restauración exige vacías (§6.2 del diseño), así que:

> **UNA INSTALACIÓN NUEVA EN LA QUE ALGUIEN PULSÓ EL BOTÓN DE SALIR YA NO PUEDE
> RESTAURAR.** La pantalla dice «Esta instalación ya tiene datos» y deshabilita
> el botón, sin que nadie haya cargado nada: el único dato es el asiento del
> intento de salida rechazado. Se sale borrando la carpeta de datos. **Es una
> consecuencia no prevista de dos reglas correctas** —todo hecho se audita, y
> se restaura solo sobre una base vacía— y **la decisión es de Julio**: dejarlo
> así, o que `baseVacia()` no cuente los asientos anteriores al primer usuario.
> Queda como el punto 20 de §6.2.

Por eso `--carpeta` no se limita a apuntar: **comprueba y se niega**. Con
puesto de control dice cuántas tablas están listas y que la pantalla va a
ofrecer «Retomar»; sin puesto de control y con la base ya escrita, sale con
código 2 antes de abrir ninguna ventana. Falsificado contra la carpeta real de
esa corrida:

```
carpeta de datos REUSADA (--carpeta): …/pos-ensayo-restauracion-g0OGvd
NO tiene puesto de control (restauracion.json): en esa carpeta la restauración nunca llegó a arrancar
filas en su base: usuarios=0 categorias=0 configuracion_negocio=1 … auditoria_log=2
Esa carpeta no sirve para restaurar: su base ya tiene filas (auditoria_log) y no hay puesto de control.
exit=2
```

Y el camino contrario, sobre la carpeta del ensayo que SÍ había restaurado
—`--carpeta` contra el descartable, **9 de 9**—, que es lo que va a pasar el día
que una corrida se corte a mitad de la transferencia:

```
tiene puesto de control: 12 tabla(s) ya listas, proyecto https://ztidrshifrblhfraiowg.supabase.co, la empezó restauracion-pruebas@…
  OK  la aplicación abrió DIRECTO en la restauración incompleta, y el botón ofrece RETOMAR
  OK  la transferencia llegó a la revisión …
  OK  la verificación CUADRA en pantalla …
    log-tecnico: 16:58:13.891Z [restauracion] sesión de restauración iniciada como restauracion-pruebas@pos-pruebas.invalid
    log-tecnico: 16:58:19.729Z [restauracion] sesión de restauración cerrada (HTTP 204)
```

**Los tres defectos eran del guion, no del producto**, y los tres los encontró
correrlo:

1. **Esperaba SIEMPRE la configuración inicial.** Con puesto de control la
   aplicación arranca DIRECTO en la restauración (§8: «si existe
   `restauracion.json`, la aplicación arranca en la pantalla de restauración»),
   así que la primera corrida con `--carpeta` se quedó 25 s mirando una
   pantalla que no iba a llegar. Ahora admite las dos entradas y comprueba, en
   la retoma, que la entrada haya sido directa y que el botón diga «Retomar».
2. **Contaba los botones antes de que la pantalla supiera su estado.** Mientras
   la consulta IPC viaja, la pantalla dibuja «Consultando…» con el mismo
   `pantalla-de-restauracion` y sin ningún botón: la corrida siguiente falló
   con «0 avisos, 0 botones» sobre una instalación perfectamente sana. Se
   espera la consecuencia visible —el botón, o el aviso de «sin configurar»—,
   que es la misma lección del `waitForTimeout` fijo de §4.34.
3. **Al cerrarse la ventana informaba un error interno ilegible**
   («Cannot read properties of undefined (reading '_object')», de Playwright) y
   además marcaba como FALLA que no se hubiera cerrado una sesión de nube que
   nunca se abrió. Ahora el cierre se detecta y se dice con esas palabras, y la
   comprobación del `logout` solo corre si hubo sesión. El aviso en pantalla
   explica además cómo cortar el ensayo: Ctrl+C, porque desde la aplicación no
   se puede.

### 4.36 La poda, el reloj, y el cierre del módulo (Fase 4.c)

La última fase. Cierra los dos riesgos de §8 que quedaban con una propuesta y
sin diseño —el reloj y el crecimiento de la cola— y suma las dos mejoras que
el ensayo contra el proyecto real había dejado señaladas el mismo día.

#### 1. La poda de `sync_cola` (riesgo 8.6): 30 días, en el trabajador

Cada fila de negocio deja una fila en la cola, para siempre, con su payload al
lado: unas **150 000 al año** según §8.6, y nada las borraba.

**Es de las poquísimas operaciones del proyecto que BORRA de verdad**, en un
sistema cuya regla es que nada se borra (§4.11), así que la justificación tiene
que ser precisa y no un «total, no sirve»:

> `sync_cola` **no es historial del negocio: es una lista de tareas.** El hecho
> —la venta, el asiento, el recibo— vive en SU tabla y no se toca, y la nube ya
> tiene su copia, confirmada por la marca `sincronizado_en`, que solo se
> escribe cuando la función de Postgres respondió que sí. Lo que se borra es la
> anotación de que eso faltaba subir, cuya razón de existir se agotó el día que
> se subió. Dicho al revés, que es como conviene comprobarlo: **si esta tabla
> se borrara entera, no se perdería ni un dato del negocio**; lo que se
> perdería es poder contestar «¿esta venta llegó a la nube, y cuándo?» sin ir a
> mirar la nube.

**Por qué treinta días.** El número tiene que cubrir la pregunta más tardía que
alguien le hace a esta tabla, y esa pregunta es de auditoría y llega con el
cierre del mes: «esta venta de fin de mes, ¿subió?». Treinta días cubren un
ciclo mensual entero más la revisión que viene justo después. Y lo que NO tiene
que cubrir, dicho para que nadie lo agrande por las dudas: una tienda mucho
tiempo sin internet (lo que no subió no se borra nunca), la escalera de
reintentos (techo de una hora) ni un lote detenido (es un pendiente). Con la
estimación de §8.6, treinta días dejan la cola en el orden de **12 000 filas**
en vez de crecer sin fin. **Es un número elegido, no medido**, vive en una
constante y no hay ninguna otra regla que dependa de él.

**Qué NO borra, que es lo que hace que borrar se justifique:**

| No se toca | Por qué |
|---|---|
| Lo **pendiente** (`sincronizado_en IS NULL`) | Es justo lo que la cola existe para no perder, por viejo que sea |
| Un lote **bloqueante** | Es un pendiente con otro nombre |
| Un **archivo apartado** por no estar en el disco (§2.5.4) | Ídem: sigue pendiente |
| Un lote **SALTADO A MANO** | **La justificación de arriba no lo cubre.** Un lote saltado es una tarea que una persona decidió NO cumplir, un hueco deliberado en el respaldo (decisión 9), y esa nota es su única marca en el disco. El registro completo vive en `auditoria_log`, pero borrar la marca local dejaría la fila indistinguible de una subida real, que es exactamente lo que `marcarLoteSaltado` evita |

Para que ese último caso no dependa de dos textos escritos por separado, el
prefijo `SALTADO A MANO` pasó a ser una constante del repositorio
(`PREFIJO_DE_LOTE_SALTADO`), que usan el que la escribe y la poda que la
respeta.

**Cuándo corre.** §8.6 dejaba sin decidir «si se hace en arranque o en un ciclo
del trabajador»; la respuesta es **las dos cosas, y sale gratis**: corre al
principio de un ciclo del trabajador y como mucho una vez cada 24 h, y como el
planificador agenda un ciclo 30 s después de abrir la ventana (§4.18), la
primera poda de cada arranque ocurre ahí. El contador vive en memoria a
propósito: persistirlo sería una columna nueva para ahorrar un `DELETE` por
arranque que ya es barato, y en la tienda la aplicación se apaga todas las
noches. **Cede ante una transacción de negocio**, como todo lo que el trabajador
hace; si le toca en medio de una venta, le toca en el próximo ciclo. Y **no
lanza nunca**: es mantenimiento, y que falle no puede impedir que la cola suba.

**Medido, sobre una base SQLite real** (`poda-de-la-cola.test.ts`, 18 pruebas):

```
[poda] 49950 de 50000 filas borradas en 61 ms (macOS, no es la máquina de la tienda)
```

Las 50 filas que sobreviven son las pendientes que la prueba sembró a
propósito, una de cada mil. **No se agregó ningún índice** para esto: es un
recorrido de una tabla que la propia poda mantiene chica, una vez por día, y un
índice sobre `sincronizado_en` encarecería cada inserción para acelerar eso.

**Y se vio correr en la APLICACIÓN REAL, no solo en Vitest.** Con un guion de
una sola vez —que no quedó en el repositorio, como el arnés de §4.31— se abrió
`electron .` sobre una carpeta temporal, se sembraron tres filas con los tres
estados que importan, y se relanzó para que llegara el primer ciclo del
trabajador:

```
sembradas: [{"id":…0001,"subida":1,"error":null},
            {"id":…0002,"subida":0,"error":null},
            {"id":…0003,"subida":1,"error":"SALTADO A MANO el 2025-01-01: categorias"}]
log: 17:39:36.980Z [sincronizacion] poda de sync_cola: 1 fila(s) ya subidas hace más de 30 días
     (antes de 2026-08-15T17:39:36.978Z). Lo pendiente y lo saltado a mano no se tocan.
log: 17:39:37.235Z [sincronizacion] ciclo: cola_vaciada; 1 lotes, 1 filas, 257 ms
quedaron:  [{"id":…0002,"error":null},
            {"id":…0003,"error":"SALTADO A MANO el 2025-01-01: categorias"}]
```

Borró la vieja ya subida, y dejó la pendiente y la saltada. La pendiente que
quedó la subió después el trabajador en el mismo ciclo, que es lo que tenía que
pasar: la poda corre ANTES y no le saca lotes de la mano.

#### 2. El reloj de esta máquina contra el de Supabase (riesgo 8.5)

§8.5 lo dejó propuesto y sin diseñar: «podría compararlo contra la cabecera
`Date` de las respuestas de Supabase y avisar si el desfase pasa de un minuto».

**La resta ingenua no sirve, y por eso esto no es una resta.**
`Date.now() - Date.parse(cabecera)` mide dos cosas mezcladas —el desfase real y
el viaje de ida y vuelta— y no hay forma de separarlas después; encima, la
cabecera `Date` tiene resolución de **un segundo**, así que la hora real del
servidor está en algún punto de ese segundo y no en su borde. Se mide entonces
como se mide la hora contra un servidor de tiempo, en chico:

- se anota el reloj local **antes de enviar** y **después de recibir**;
- se compara el **punto medio** de esos dos contra el **centro** del segundo
  que declara el servidor;
- se calcula una **incertidumbre explícita**: la mitad del viaje más medio
  segundo de resolución;
- y se avisa solo cuando el desfase pasa el minuto **descontada esa
  incertidumbre**.

Con eso, **una conexión lenta no puede inventar un aviso**: lo único que hace
es agrandar la duda. Hay pruebas de las dos direcciones, incluida la que
importa: un viaje de 20 s con 61 s de desfase NO avisa, y el MISMO desfase con
una conexión normal SÍ.

**Lo miden los cuatro caminos que hablan con Supabase** —el proveedor de
sincronización, Auth, el detector de conexión y el cliente de restauración—
con un observador **compartido**: así el aviso sale una vez por hora y no una
por camino. El detector es el que más veces mide, porque con la cola con
pendientes pega al health cada pocos minutos.

**No corrige el reloj, y no debe**: cambiar la hora del sistema es una acción
administrativa que §4.6 prohíbe. Avisa, en la bitácora técnica:

```
AVISO: el reloj de esta máquina va 300 s ADELANTADO (±1 s) respecto del servidor de
Supabase. Con más de un minuto de diferencia, la fecha de las ventas y el corte del
día del reporte dejan de ser confiables. Revisá la hora del sistema; la aplicación
no la cambia.
```

> **ESTE UMBRAL NO ES EL DE §4.22, y no se mezclan.** El de allá
> (`DESFASE_QUE_MERECE_AVISO_S`, 30 s) mide el `iat` del JWT contra el reloj
> local, una vez por sesión, y su número sale de la cota MEDIDA de tolerancia
> de PostgREST. El de acá son los 60 s que pide el texto de §8.5, medidos en
> cada respuesta. Son dos diagnósticos del mismo hecho por dos fuentes;
> confundir sus números sería afirmar que uno está medido cuando lo que está
> medido es el otro.

**Un defecto que encontró su propia prueba:** la primera versión del observador
podía LANZAR si la bitácora fallaba —el `try` no envolvía al registrador—, y
como `observar` se llama en el camino de cada petición, eso habría convertido
un disco lleno en una subida caída. Un diagnóstico no puede tirar abajo lo que
observa. Corregido, con la prueba que lo dice en su nombre.

#### 3. El rechazo de Auth, con su código, en la bitácora

Lo señaló el ensayo contra `pos-jimmy-cano` el mismo día (§4.35): un ingreso
rechazado solo mostraba «Supabase rechazó ese correo y esa contraseña», y el
`error_code` exacto no quedaba en ningún lado —`ClienteDeAuthHttp` no recibía
ningún registrador, y la causa técnica viaja al renderer dentro de la respuesta
IPC sin pasar por `log-tecnico.log`—, así que hubo que reproducirlo por fuera
con `curl`. Ahora queda escrito la primera vez:

```
Auth rechazó el ingreso de restauracion@pruebas.invalid: HTTP 400 invalid_credentials «Invalid login credentials»
Auth rechazó la renovación de la sesión: HTTP 400 validation_failed «Refresh token is not valid»
Auth no contestó a el ingreso de …: No se pudo hablar con Supabase Auth: fetch failed
```

Se registra el **código estable** (`error_code`) y no solo el mensaje, porque el
mensaje es texto para una persona y puede cambiar de redacción. «No contestó» y
«contestó que no» quedan distinguidos, porque se diagnostican distinto. Un
ingreso que sale bien **no escribe nada**. Y la contraseña no aparece por
ningún camino: hay prueba de los tres casos —incluido el feo, un servidor que
devuelve lo que se le mandó— con su control del buscador.

#### 4. La pantalla de restauración dice a qué proyecto se conecta

También del ensayo del mismo día: se tecleó la credencial del proyecto de
PRUEBAS contra el proyecto REAL, y la pantalla no daba ninguna pista de contra
cuál estaba por conectarse. Cada proyecto de Supabase tiene su propia tabla de
usuarios, así que la credencial de uno nunca sirve en el otro **y el rechazo se
lee como «la contraseña está mal»**. Ahora, antes de que nadie escriba nada:

> Se va a restaurar desde el proyecto **zgsdaelmbxufgcsideep** de Supabase. Usá
> la contraseña del usuario de restauración **de ese proyecto**.
> `https://zgsdaelmbxufgcsideep.supabase.co`

Se muestra la REFERENCIA del proyecto —lo que el panel usa como nombre— con la
URL entera al lado. El dato ya viajaba en el progreso (`proyecto`); lo que
faltaba era mostrarlo. `ensayo:restauracion` lo comprueba.

#### Los diez riesgos de §8, uno por uno

| Riesgo | Estado |
|---|---|
| 8.1 Ventana entre el robo y la revocación | **ABIERTO, y ningún software lo cierra.** Se acotó lo que se podía: la ventana después de revocar, la renuncia al token vigente y la visibilidad de la sincronización. Enterarse del robo no es problema de software |
| 8.2 Hashes de PIN en la nube | **CERRADO.** La `0021` los quitó de Postgres y no se mandan; toda restauración resetea los PIN, así que allá no tenían función |
| 8.3 El proyecto gratuito se pausa solo | **ABIERTO a propósito: es de negocio.** El latido diario lo evita con la terminal encendida; el resto lo cierra el plan Pro, que decide Julio |
| 8.4 `ON CONFLICT` bajo RLS | **CERRADO midiendo**, y cambió el diseño (§4.20) |
| 8.5 El reloj de la máquina | **CERRADO acá** |
| 8.6 `sync_cola` crece sin límite | **CERRADO acá** |
| 8.7 Dependencia nueva en el proceso principal | **CERRADO evitándola:** no se agregó `supabase-js`; todo habla con tres endpoints REST por `net.fetch` y el refresco está escrito y probado acá |
| 8.8 Lo que el hardware no midió | **ABIERTO, y no se puede cerrar sin la máquina.** Ver abajo |
| 8.9 Las funciones `SECURITY DEFINER` | **CERRADO en lo medible:** las seis endurecidas punto por punto y verificadas contra el descartable. Lo que queda es operativo: que nadie las «arregle» dentro de un año |
| 8.10 Restaurar sobre una terminal con datos | **ABIERTO a propósito: es de negocio.** La respuesta correcta es un respaldo local, punto 11 de §6.2 |

#### Riesgo 8.8: qué falta medir en la máquina de la tienda

**Todo número de rendimiento de este módulo es una estimación sobre hardware
que nadie midió.** Se midieron en un MacBook, con la conexión de una casa; la
tienda tiene un i3 de 2011. Ninguno es falso, todos son de otra máquina. La
lista concreta, para el día que exista el equipo:

| Qué medir | Número de hoy | Dónde salió |
|---|---|---|
| La poda sobre una cola de 50 000 filas | **61 ms** | `poda-de-la-cola.test.ts`, macOS |
| El hueco máximo del bucle de eventos durante un ciclo de 20 lotes | **2 ms** (umbral 15) | §4.18, macOS |
| Una página de 1 000 filas al restaurar | **2 s, estimado y nunca medido** | §2.4 del diseño |
| Reducir una foto de teléfono a 800 px | **8.02 MB → 110 KB**, tiempo sin medir | §4.33, macOS |
| Subir un lote de venta entero | ~1 s contra el descartable | §4.25, conexión de casa |
| Una restauración completa | 13 páginas en ~25 s con la nube vacía | §4.35, conexión de casa |
| El arranque del trabajador y su primer ciclo | 30 s por diseño, no por medición | §4.18 |

Y lo que hay que **correr** en Windows, que es lo mismo del punto 12 de §6.2:
`npm run diagnostico:credencial` (allá el respaldo es DPAPI y no el llavero),
`npm run diagnostico:imagen`, `npm run verify:pantallas`, y el atajo de salida
con teclado latinoamericano.

#### Lo que esta fase NO verificó

- **Nada de esto se corrió contra la nube de verdad.** La poda no habla con la
  red; el reloj sí, pero su medición se probó con respuestas construidas, no
  con las de Supabase. Lo que sí se sabe de las respuestas reales es que traen
  la cabecera `Date`: está en cada línea de las corridas de §4.35. **Que el
  aviso dispare contra un reloj de verdad mal puesto no se ejercitó**, porque
  habría que cambiarle la hora a esta máquina.
- **La poda nunca corrió sobre una cola de la tienda**, que no existe: corrió
  sobre 50 000 filas sembradas.
- **Windows**, como siempre.

### 4.37 El empaquetado de producción para Windows (v1.0.0)

La primera vez que el proyecto entero se compila como instalador real. **No
está probado en Windows**: lo que sigue separa con cuidado lo que se verificó
inspeccionando el paquete en macOS de lo que solo puede confirmarse cuando el
`.exe` corra en la máquina de Jimmy.

#### El nombre, que es una decisión irreversible

**`POS Jimmy Cano`**, y no se elige por gusto: de `productName` salen tres
cosas que quedan atadas a los datos de la tienda.

| De ahí sale | Qué pasa si cambia después |
|---|---|
| `%APPDATA%\POS Jimmy Cano\` | La base con TODAS las ventas, los PDF, las fotos y la bitácora quedan huérfanas: la aplicación nueva abre una carpeta vacía |
| La llave de `safeStorage` (DPAPI en Windows) | **Toda credencial de nube guardada queda ilegible**, medido en §4.23: un lector con otra identidad no la descifra ni con el archivo delante |
| El `.exe`, el acceso directo y el menú de inicio | Lo que Jimmy ve y busca |

Se descartó «POS Agricola», que era el valor anterior y nunca llegó a un
instalador: sin tilde se lee como un error de tecleo y con tilde mete un
carácter no ASCII en una ruta de Windows sin ganar nada.

**El `appId` NO cambió** (`gt.posagricola.desktop`): es un identificador, no un
nombre visible, y de él salen la clave de desinstalación del registro y la
agrupación en la barra de tareas. Cambiarlo haría que una versión nueva se
instalara AL LADO de la vieja en vez de actualizarla.

**Los nombres exactos, verificados sobre el paquete armado:**

| Qué | Nombre |
|---|---|
| Instalador | `POS-Jimmy-Cano-Setup-1.0.0.exe` |
| Ejecutable instalado | `POS Jimmy Cano.exe` |
| `app.getName()` dentro del paquete | `POS Jimmy Cano` |
| Carpeta de datos en Windows | `%APPDATA%\POS Jimmy Cano\` |

`app.getName()` sale del `package.json` que viaja DENTRO del asar, no de
`electron-builder.yml`. El `package.json` del repositorio **no tiene**
`productName` a propósito y el nombre se inyecta con `extraMetadata`: así la
aplicación de desarrollo sigue llamándose `pos-agricola` y **no comparte
carpeta de datos ni credencial con la instalada**, que es lo correcto. Leído
del asar del paquete final: `{"name":"pos-agricola","productName":"POS Jimmy
Cano","version":"1.0.0"}`.

#### El módulo nativo: NO hace falta una máquina Windows, y está medido

`better-sqlite3` es la única dependencia nativa del proyecto. Desde la versión
13 trae **binarios precompilados de todas las plataformas dentro del propio
paquete de npm** (`prebuilds/`), elegidos en tiempo de ejecución por
`process.platform` y `process.arch` (`lib/binding.js`), y hechos con N-API, así
que **no hay un ABI por versión de Electron que perseguir**. Medido en esta
máquina:

```
node_modules/better-sqlite3/prebuilds/win32-x64.node: PE32+ executable (DLL) (GUI) x86-64, for MS Windows
node_modules/better-sqlite3/build/Release/  ->  no existe ningún .node compilado localmente
```

O sea que la aplicación en macOS ya corre con un prebuild y nunca compiló nada.
Por eso `npmRebuild: false`: no hay nada que recompilar, y dejarlo en `true`
haría que el empaquetado intentara compilar C++ para Windows desde macOS, que
es lo único de todo esto que sí necesitaría una máquina Windows.

**Verificado sobre el paquete final**, que es lo que contesta la pregunta:

```
release/1.0.0/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/
  win32-x64.node: PE32+ executable (DLL) (GUI) x86-64, for MS Windows
release/1.0.0/win-unpacked/POS Jimmy Cano.exe: PE32+ executable (GUI) x86-64, for MS Windows
```

**Cross-compilar no hace falta, y eso no es una suposición: es que no hay nada
que compilar.** Lo que sigue sin estar medido es que ese `.node` CARGUE en
Windows, que es distinto de que sea el archivo correcto.

> **Y sobraban 14 MB.** El primer paquete llevó los OCHO prebuilds —macOS,
> Linux, Windows ARM— de los que solo `win32-x64` sirve: 16 MB para usar 1.9.
> Se excluyen bajo `win:`, y el paquete de macOS conserva el suyo.

#### Lo que el empaquetado destapó, y es lo más importante de esta fase

> **EL PRIMER INSTALADOR LLEVABA `.env.nube-pruebas` Y `.env.nube-real`
> ADENTRO**, o sea las contraseñas de los tres usuarios de Supabase del
> proyecto de pruebas, dentro del `.exe` que se le manda a Jimmy. También
> `src/` entero con sus 93 archivos de prueba, `docs/`, `scripts/`,
> `supabase/` y los `tsconfig`.

La causa son dos comportamientos de electron-builder que hay que medir y no
deducir. **La primera versión de esta sección los explicó mal, y se corrige
acá con lo que las mediciones sostienen:**

1. **`win.files` REEMPLAZA a `files`, no lo completa.** Con las exclusiones
   solo arriba y un `win.files` que sacaba unos prebuilds, el paquete de
   Windows seguía llevando los `.env`. Por eso la lista vive completa bajo
   `win:`, duplicada.
2. **Lo que restringe de verdad son los patrones POSITIVOS, pero solo dentro
   de la lista que está en efecto.** Medido en cuatro empaquetados:

   | `files` (raíz) | `win.files` | Entradas en el asar | `.env` |
   |---|---|---|---|
   | 3 positivos, sin exclusiones | (ninguno) | 1262 | 4 |
   | 3 positivos + 15 exclusiones | solo 3 exclusiones de prebuilds | 1259 | 4 |
   | 3 positivos + 15 exclusiones | **3 positivos** + las exclusiones | 925 | 0 |
   | 3 positivos + 15 exclusiones | **3 positivos** + 3 de prebuilds | **729** | **0** |

   La última fila es la que corrige lo que esta sección decía antes: con los
   tres positivos dentro de `win.files` y **ninguna** exclusión de `.env`, de
   `src/` ni de pruebas, el paquete sale igual de limpio. O sea que **el
   arreglo no fueron las exclusiones: fue mover los positivos a `win.files`.**
   Las exclusiones quedan igual, como segunda capa y porque dejan la intención
   escrita, pero decir que eran ellas las que protegían habría sido atribuirle
   el mérito a lo que no lo hizo.

Antes y después, contando el asar:

| | Archivos en el asar | `.env` | Raíz |
|---|---|---|---|
| Primer paquete | 1262 | **4** | `dist`, `dist-electron`, `package.json`, `node_modules`, `.env*`, `CLAUDE.md`, `docs`, `scripts`, `src`, `supabase`, `tsconfig*`, … |
| Paquete final | **925** | **0** | `dist`, `dist-electron`, `package.json`, `node_modules` |

#### `verify:paquete`: la salvaguarda, y corre sola

Comprobar esto a mano no escala: el día que alguien agregue una carpeta o
toque un patrón, nada avisa. `scripts/verificacion-de-paquete.cjs` lista el
asar y falla si encuentra algo que no debería viajar, con **el nombre exacto
de cada archivo**, que es lo que hace falta para corregir el patrón sin
adivinar.

**No es un `npm run` que alguien tenga que acordarse de correr: es el
`afterPack` de electron-builder.** Ese enganche ocurre cuando la aplicación ya
está empaquetada pero ANTES de que el destino NSIS arme el instalador, así que
lanzar ahí hace dos cosas a la vez: aborta el empaquetado y **el `.exe` nunca
llega a existir**. Y si en `release/` hubiera quedado un instalador de una
corrida anterior, se borra: lo peor sería que alguien tomara por bueno el
`.exe` viejo de una carpeta donde la corrida nueva acaba de fallar. Igual
existe `npm run verify:paquete` para auditar un paquete ya armado.

Las seis reglas, cada una con el motivo escrito en el propio guion: `.env` en
cualquier lado; `src/` del proyecto; `docs/`, `scripts/` y `supabase/`;
carpetas de prueba; archivos `.test` y `.spec`; y cualquier paquete de
`node_modules` que no esté en el **cierre transitivo** de `dependencies` —no
alcanza con la lista directa: `better-sqlite3` necesita `node-addon-api` y
`react-dom` necesita `scheduler`, y los dos tienen que poder viajar—.

**Se vio fallar, que es lo que le da valor.** Reintroduciendo un patrón que
deja entrar lo prohibido, el empaquetado se detuvo con código 1:

```
EL PAQUETE TIENE 4 ARCHIVO(S) QUE NO DEBERÍAN VIAJAR:
  FALLA credenciales (.env) — 1 archivo(s)
        por qué: un archivo .env puede traer contraseñas de verdad …
        · /.env.nube-pruebas
  FALLA código fuente sin compilar (src/) — 3 archivo(s)
        · /src
        · /src/main
        · /src/main/index.ts
Se borraron los instaladores viejos de …/release/1.0.0: POS-Jimmy-Cano-Setup-1.0.0.exe, …blockmap
=== ¿quedó el .exe? ===  NO HAY NINGÚN .exe
```

**Dos de las seis reglas no se pudieron falsificar así**, y conviene decir por
qué: la de los archivos de prueba y la de las dependencias no son alcanzables
desde `electron-builder.yml`, porque electron-builder decide por su cuenta qué
entra de `node_modules` y un patrón no basta para meter ahí lo que uno quiera.
La falsificación de esas dos vive en
`src/main/__tests__/verificacion-de-paquete.test.ts`, **21 pruebas** que cargan
el guion de verdad —no una copia, igual que la del seguro de §4.20— y le pasan
rutas a mano: que marque `playwright-core`, `vitest`, `electron-builder` y un
paquete con ámbito; que NO marque `node_modules/zod/src`, que no es el `src/`
del proyecto; y un control de que un paquete sano no dispara nada, sin el cual
una regla rota que marcara todo también «pasaría».

> **Y la prueba encontró dos errores míos** al escribirla: un caso de control
> usaba un paquete inventado —que la regla de dependencias marcaba con razón, y
> medía otra cosa— y otro esperaba un solo hallazgo donde había dos ciertos,
> porque `@playwright/test` cae por dos reglas a la vez. Los dos eran de la
> prueba, no de las reglas.

#### El modo kiosko no depende de estar en desarrollo

Auditado sobre el proceso principal entero. **Hay UNA sola bandera de entorno
en la ventana**, `enDesarrollo = process.env.ELECTRON_RENDERER_URL !== undefined`
—esa variable la pone el servidor de desarrollo de electron-vite y en el
paquete no existe—, y controla exactamente dos cosas, **las dos hacia el lado
MÁS estricto en producción**:

| Qué controla | En desarrollo | En el `.exe` |
|---|---|---|
| `webPreferences.devTools` | habilitadas | **deshabilitadas** |
| El bloqueo de los atajos de recarga y de herramientas | no se bloquean | **se bloquean** |

**Todo lo demás no tiene ninguna rama por entorno**, y se leyó uno por uno:
pantalla completa, `frame: false`, sin barra de menú, `contextIsolation`,
`nodeIntegration: false`, el bloqueo del zoom y del menú contextual, el atajo
`Ctrl+Shift+Alt+Q`, la intercepción de `Alt+F4` y del cierre del sistema, y el
botón de la barra de estado. `controlled-exit.ts` no nombra `process.env` ni
`isPackaged` en ninguna línea. El único `app.isPackaged` del proyecto está en
un informe de diagnóstico y no decide nada.

**Sigue sin estar probado en Windows**, que es otra cosa: lo verificado es que
ninguna protección se apoya en una variable de desarrollo.

#### El instalador

| Dato | Valor |
|---|---|
| Ruta | `release/1.0.0/POS-Jimmy-Cano-Setup-1.0.0.exe` |
| Tamaño | **110 MB** (115 841 244 bytes) |
| Instalación descomprimida | 400 MB |
| Tipo | `PE32 executable (GUI) Intel 80386, Nullsoft Installer self-extracting archive` |
| Destino | Windows x64, NSIS con asistente |
| Firma | **ninguna**, a propósito |

El asistente deja elegir la carpeta, instala para todos los usuarios de la
máquina (`perMachine`, una elevación al instalar) y crea acceso directo en el
escritorio y en el menú de inicio. *(Desde §4.48 el del escritorio es
opcional, con una casilla, y antes aparece la pantalla de licencia.)* `deleteAppDataOnUninstall: false`:
desinstalar **no borra la base de datos de la tienda**.

**Sin firmar, a propósito**: Windows va a mostrar «Windows protegió tu PC» la
primera vez, que se saltea con «Más información» → «Ejecutar de todas formas» y
no impide instalar. No hay ningún certificado configurado ni variable `CSC_` en
el entorno, comprobado.

#### El ícono

`npm run icono` lo genera con el Chromium que Electron ya trae —el mismo
criterio por el que el recibo se maqueta en HTML (§5)— y escribe
`build/icon.png` (512 px) y `build/icon.ico` con los seis tamaños que Windows
usa (16, 32, 48, 64, 128, 256). El `.ico` se arma a mano, con su cabecera de
seis bytes y una entrada de dieciséis por imagen, para no sumar una dependencia
por cuarenta líneas: la misma decisión que §4.33 tomó con `nativeImage` en vez
de `sharp`. Es un saco de grano abierto sobre el verde de la pantalla de venta,
sin texto: un ícono de 16 px con letras es una mancha.

#### Lo que NO se verificó, y solo se puede verificar en Windows

- **Que el instalador instale.** Nada de esto se ejecutó: se inspeccionó el
  paquete, no se corrió. Que el asistente abra, que pida elevación, que cree
  los accesos directos y que el `.exe` arranque son cinco cosas por confirmar.
- **Que `better-sqlite3` CARGUE.** El archivo correcto está en el lugar
  correcto; que Windows lo cargue y que la base abra es otra cosa.
- **Que el modo kiosko se comporte igual**: el atajo con teclado
  latinoamericano, `Alt+F4`, y que el Administrador de tareas siga disponible
  (§4.6).
- **`npm run diagnostico:credencial` en el `.exe`**, que es donde DPAPI entra
  en juego por primera vez (§4.23), y `npm run diagnostico:imagen`.
- **Que la advertencia de Windows sea la esperada** y no un bloqueo.
- **El rendimiento en el i3**, que es el riesgo 8.8 entero (§4.36).
- **Que la aplicación instalada no tenga nube configurada**, que es lo previsto
  para esta entrega: sin `POS_NUBE_URL` las pantallas de nube y de restauración
  van a decir «sin configurar», y eso es correcto hasta que se decida cómo
  viaja esa configuración al instalador.

### 4.38 La nube incrustada al compilar: el instalador se conecta solo

§4.37 dejó una pregunta abierta: **cómo llega la configuración de la nube a la
terminal de Jimmy.** Hasta acá viajaba en variables de entorno, que sirven en
una máquina de desarrollo y no en un `.exe` instalado —nadie va a definir
variables de entorno en la computadora del mostrador, y el acceso directo que
crea el instalador tampoco puede—. Medido sobre el primer instalador: no traía
ninguna URL ni llave adentro y arrancaba sin nube.

**Ahora los tres valores se incrustan al compilar.** Salen de
`.env.empaquetado` —ignorado por git, con su plantilla versionada al lado— y
`electron.vite.config.ts` los reemplaza por un literal en el bundle del proceso
principal.

#### El entorno gana, y lo incrustado es el respaldo

No es caprichoso. Los arneses de verificación lanzan la aplicación con sus
propias variables para apuntarla a donde ellos necesitan; si lo incrustado
ganara, el arnés diría «descartable» y la aplicación estaría hablando con otro
proyecto **en silencio**, que es la confusión de §4.37 otra vez y ahora con la
nube de por medio. Y es **todo o nada**: si el entorno define la URL, los tres
valores salen del entorno, porque media configuración de cada lado sería una
tercera que nadie escribió —y encima apuntaría a un proyecto con la llave de
otro—.

Vive en `src/main/configuracion-de-nube.ts`, con 14 pruebas. **No alcanzaba con
un `define` sobre `process.env.POS_NUBE_URL`**: el selector de proveedor no se
lee así, sino como `entorno.POS_SYNC_PROVIDER` sobre un objeto que se pasa
entero a `leerConfiguracionAdaptadoresDelEntorno`, así que un `define` sobre esa
expresión no lo habría alcanzado y el instalador habría quedado apuntando a un
proyecto **pero arrancando con el proveedor SIMULADO**: diciendo «al día» sin
que nada viajara, que es exactamente la trampa medida en §4.35.

#### Qué se incrusta, y qué no se va a incrustar nunca

Se incrusta **a qué proyecto** conectarse. Los tres valores son públicos: la
URL identifica el proyecto y la llave publicable, sola, no puede nada porque
RLS está activo sin políticas para `anon` (§1.2 del diseño).

> **NO se incrusta ninguna credencial de terminal, y no se va a incrustar.** El
> correo y la contraseña del usuario de sincronización se teclean UNA vez en
> «Conectar con la nube»; lo único que queda en el disco es el token de refresco
> cifrado con `safeStorage` (§4.23). Una contraseña dentro del `.exe` la tendría
> cualquiera que lo abra: es la misma clase de defecto que `verify:paquete`
> existe para atrapar. **Incrustar el proyecto NO es iniciar sesión sola**: la
> primera conexión la hace una persona, y a partir de ahí la terminal se
> reconecta sola en cada arranque.

#### Verificado corriendo la aplicación, sin una sola variable de entorno

Lo que importaba no era que compilara sino que la aplicación se conectara sola.
Se lanzó la aplicación compilada con el entorno **limpio de toda `POS_*`** y una
carpeta de datos nueva:

```
variables POS_* en el entorno del proceso: 0
[sincronizacion] proyecto de nube ztidrshifrblhfraiowg (incrustado al compilar); el trabajador va a usar SupabaseSyncProvider
[sincronizacion] No hay ninguna credencial guardada. Conectá la terminal desde la pantalla «Conectar con la nube».
[sincronizacion] trabajador en marcha con SupabaseSyncProvider; primer ciclo en 30 s. Pendientes en la cola: 0 filas en 0 lotes.
--- pantalla de restauración ---
  avisos de «sin configurar»: 0
  dice: Se va a restaurar desde el proyecto ztidrshifrblhfraiowg de Supabase…
```

`SupabaseSyncProvider` y no el simulado, que es la diferencia entre subir de
verdad y decir que se subió.

#### `verify:paquete` ahora dice a qué proyecto apunta el instalador

Leído del bundle, en cada empaquetado y también a mano. No es una regla que
pueda fallar —apuntar al real es exactamente lo que se quiere el día de la
puesta en marcha— pero **tiene que estar a la vista**, y cuando sea el real lo
dice con todas las letras y recuerda que `auditoria_log` es inmutable:

```
  APUNTA A: ztidrshifrblhfraiowg (proyecto de pruebas)
```

#### Por qué este instalador apunta al DESCARTABLE

Julio pidió primero apuntarlo al real y aceptó el reparo: cada venta de prueba
subiría filas de verdad a `pos-jimmy-cano`, y `auditoria_log` es inmutable por
trigger, así que esas filas solo saldrían con un `TRUNCATE` por SQL sobre el
proyecto de producción. Es la regla de §9.5 del diseño —nada toca el real
primero— y para eso existe el descartable.

**El usuario de terminal del proyecto REAL ya está creado** (Julio, 2026-09-14),
y quedó bien: `terminal-1@pos-jimmy-cano.invalid`, confirmado, con
`raw_app_meta_data = {"rol":"terminal","provider":"email","providers":["email"]}`
—o sea con el `||` que suma la clave sin borrar las de GoTrue, y `terminal` sin
tilde—. Cuando se pase a producción, es cambiar la URL y la llave de
`.env.empaquetado` por las del real y volver a compilar; el usuario ya espera.

#### La plantilla no estaba versionada, y el `.gitignore` la tapaba

Encontrado al revisar el trabajo: `.env.empaquetado.ejemplo` existía en el
disco pero **git no la estaba versionando**. La línea `.env.*` del
`.gitignore` la alcanzaba, y las dos excepciones que había —`!.env.example` y
`!.env.nube-pruebas.ejemplo`— estaban escritas una por una, así que la
plantilla nueva no entraba. Quedaba lo peor de los dos mundos: un archivo que
el proyecto necesita para explicar cómo apuntar el instalador, invisible para
cualquiera que clonara el repositorio.

Se agregó la tercera excepción, `!.env.empaquetado.ejemplo`. El
`.env.empaquetado` REAL —el que tiene la URL y la llave— sigue ignorado, y la
plantilla va con los dos campos vacíos:

```
POS_NUBE_URL=
POS_NUBE_LLAVE_PUBLICABLE=
POS_SYNC_PROVIDER=supabase
```

#### Vuelto a verificar de punta a punta, y no dado por bueno

Las cinco comprobaciones sobre el paquete que se entrega, con su salida cruda:

```
[empaquetado] se INCRUSTA el proyecto de nube ztidrshifrblhfraiowg
              (https://ztidrshifrblhfraiowg.supabase.co); proveedor: SupabaseSyncProvider

dentro del asar (dist-electron/main/index.js):
  var define_NUBE_INCRUSTADA_default = { url: "https://ztidrshifrblhfraiowg.supabase.co", …
  referencias de Supabase en el bundle: ztidrshifrblhfraiowg   (una sola: no quedó ninguna del real)

la aplicación compilada, carpeta de datos NUEVA, 0 variables POS_* en el entorno:
  [sincronizacion] proyecto de nube ztidrshifrblhfraiowg (incrustado al compilar); …
  [sincronizacion] trabajador en marcha con SupabaseSyncProvider; primer ciclo en 30 s
  SimulatedSyncProvider: no

verify:paquete -> 0
  APUNTA A: ztidrshifrblhfraiowg (proyecto de pruebas)
  729 entradas, 0 hallazgos
```

Que solo aparezca **una** referencia en el bundle importa tanto como que
aparezca la correcta: si hubiera quedado también la del real, el instalador
tendría dos y nadie sabría a cuál se conecta.

#### Lo que sigue sin verificarse

- **Que el `.exe` instalado en Windows se conecte de verdad.** Lo medido es la
  aplicación compilada corriendo en macOS. El binario es el mismo, pero eso es
  razonamiento.
- **Que la terminal SUBA una venta desde el instalador.** Hace falta teclear la
  credencial de terminal en la ventana, y eso todavía no se hizo desde un
  paquete: lo que se probó fue el arranque y a dónde apunta.
- **Que dos instaladores compilados para proyectos distintos no se confundan.**
  Hoy se distinguen solo por lo que dicen la bitácora y la pantalla; el nombre
  del archivo es el mismo. Si alguna vez conviven los dos, conviene que el
  nombre lo diga.

### 4.39 Lo que Jimmy encontró en el equipo real (2026-09-14)

Jimmy probó el sistema en la máquina de la tienda y encontró cinco cosas. Esta
sección las cierra, en el orden del pedido. **Todo se verificó en macOS**,
manejando la aplicación real con `npm run verify:pantallas:caja` (29 de 29) y
`npm run verify:pantallas` (48 de 48). Windows sigue pendiente, como siempre.

#### 1. El teclado en pantalla faltaba en dos lugares

Era una regresión, no una función nueva: la caja es táctil y el teclado
numérico ya existía para el PIN y el ticket.

| Dónde faltaba | Qué se hizo |
|---|---|
| Efectivo, modo «Escribir el total» | El `<input>` se reemplazó por `TecladoNumerico` en modo cantidad, con dos decimales. Su ✓ confirma igual que el botón de la pantalla. |
| Efectivo, modo por denominación | Tocar la cantidad de una denominación abre el teclado numérico para escribir las piezas de una vez. El «+» y el «−» siguen. |
| Formularios de productos y categorías | **Teclado alfanumérico nuevo**, `TecladoEnPantalla`: uno solo para toda la aplicación, anclado abajo. Cada campo que lo usa es un `CampoDeTexto`. También lo usan el buscador de productos y el modal de ajuste de inventario. |

`TecladoNumerico` ganó `admiteCero`: al contar efectivo, cero piezas de Q200 es
un conteo válido; en el ticket, cero libras sigue sin confirmarse.

El teclado alfanumérico tiene tres disposiciones —texto, decimal y entero— y
qué texto queda después de cada tecla lo decide `teclado/teclas.ts`, puro y con
sus pruebas. Las vocales con tilde y la eñe tienen tecla propia. El campo lleva
`inputMode="none"` para que Windows no abra además su propio teclado.

**Un defecto que encontró `verify:pantallas`, y se midió la causa.** La primera
versión cerraba el teclado al tocar fuera usando `pointerdown`. Eso quitaba el
espacio reservado al pie antes de que llegara el clic, el botón «Guardar» se
movía debajo del dedo y la categoría no se guardaba. Con `click` pasa. Se
comprobó volviendo a `pointerdown`: el recorrido vuelve a fallar en el mismo
punto.

#### 2. El efectivo teórico en vivo

La pantalla de caja abierta muestra las ventas en efectivo del turno y el
**efectivo teórico ahora**. Sale de `ServicioDeCaja.resumenDelTurno`, que usa
el MISMO `montoEsperadoDe` del cierre: el teórico del turno y el esperado del
cierre no pueden decir dos números distintos. La pantalla vuelve a pedir el
estado cada 10 s. Medido: una venta insertada en la base con la pantalla abierta
apareció a los 10.0 s, sin navegar.

> **UNA TENSIÓN QUE HAY QUE DECIDIR, dicha en voz alta.** Mostrar el teórico
> MIENTRAS se cuenta le dice al cajero qué número tiene que escribir. Un cajero
> que teclea el teórico a la primera nunca dispara el sello de la sección 4,
> aunque en el cajón falte dinero. El control habitual es el **conteo a
> ciegas**: contar sin ver el esperado. Se construyó tal como se pidió; la
> decisión de ocultarlo en el paso de conteo, o de mostrarlo solo al rol
> administrativo, es de Julio y queda como el punto 21 de §6.2.
>
> **RESUELTO EL MISMO DÍA (§4.40), y este bloque queda como constancia de lo
> que se construyó primero.** Julio decidió las dos cosas: el teórico solo
> viaja a un rol administrativo, y el paso donde se teclea el conteo no lo
> muestra a nadie.

#### 3. La confirmación del cierre

Un cierre exitoso termina en «Caja cerrada con éxito» con el efectivo inicial,
el teórico y el final, y el faltante o sobrante si lo hubo. Recién al aceptarla
la pantalla vuelve a «Abrir caja».

#### 4. EL HUECO DEL RECUENTO, cerrado

**El defecto.** Si al cerrar el sistema mostraba una diferencia, el cajero podía
volver atrás y probar otro número hasta que cuadrara, sin rastro del primero.

**La regla nueva, que parece de dos casos y es uno solo:**

> **Un turno con algún conteo sellado solo se cierra con autorización.**

Un conteo se SELLA en el momento en que se confirma y da diferencia: queda un
asiento `conteo_de_cierre_sellado` en `auditoria_log` con el esperado, el
contado y la diferencia. Antes de confirmar, el cajero es libre y nada se
registra: la pantalla no le manda nada al proceso principal mientras escribe.
Después del sello, o el conteo final es uno sellado —y ese ya tenía diferencia—,
o es otro distinto, y cambiar el resultado después de ver un problema es lo que
hay que autorizar. No hay tercer caso.

| Pregunta | Respuesta |
|---|---|
| ¿Qué PIN? | El de `cierre_con_diferencia`: normal o remoto, con el mismo candado de intentos. Medido: un PIN equivocado sumó 1 intento en esa superficie. |
| ¿Y si el número final cuadra? | Igual pide PIN (`REQUIERE_AUTORIZACION_DE_RECONTEO`). |
| ¿Dónde queda quién autorizó? | En `reconteo_de_cierre_autorizado`, con todos los conteos sellados y el final. **No en `caja_sesiones`**: si cuadra, el CHECK de la 008 exige esas columnas vacías. |
| ¿Sobrevive a reiniciar? | Sí. Los sellos se leen de `auditoria_log`, que es inmutable. Hay prueba con un servicio nuevo sobre la misma base. |
| ¿Confirmar dos veces el mismo número duplica el sello? | No: se sella una vez por par esperado/contado. |
| ¿Viaja a la nube? | Sí, los dos asientos se encolan y suben por `sincronizar_asiento`. |
| ¿Qué ve quien autoriza? | El primer conteo con su diferencia y el conteo de ahora. La pantalla de caja avisa del sello aunque se salga y se vuelva. |

> **CORREGIDO EL 2026-09-15: la fila «¿Dónde queda quién autorizó?» no se
> cumple en un caso, medido.** Si el esperado cambia entre el sello y el conteo
> final —por ejemplo, un sobrante y después una venta en efectivo por el mismo
> monto— y se confirma el mismo número, el cierre exige el PIN y cierra. Pero el
> asiento de reconteo solo se escribe si cambió el número contado
> (`huboReconteo`), así que el id de quien autorizó no queda en ningún asiento
> ni en `caja_sesiones`. Salida cruda y propuesta en
> `docs/ANULACION-DE-VENTA.md` §0.7. ~~**Sin arreglar todavía.**~~
>
> **ARREGLADO EL 2026-09-15 (Prompt 68).** El asiento
> `reconteo_de_cierre_autorizado` se escribe SIEMPRE que un cierre con conteos
> sellados CUADRA, además del caso que ya funcionaba (cambió lo contado y el
> final sigue con diferencia). Llegar a cerrar ahí exigió el PIN, sea por lo que
> sea. Cerrar con el mismo número sellado que SIGUE con diferencia no escribe
> reconteo, igual que antes: el autorizante está en `caja_sesiones`.
>
> | | Antes | Desde el arreglo |
> |---|---|---|
> | Condición del asiento | `huboReconteo` (cambió lo contado) | `huboReconteo` **o** (hay sellos **y** el cierre cuadra) |
> | Datos nuevos del asiento de reconteo | — | `cambioElConteo`, `cambioElEsperado` |
> | Dato nuevo de `caja_cerrada` | — | `cambioElEsperado` (junto a `huboReconteo`) |
> | Mensaje del servicio | «Corregir un conteo…» en los dos casos | «cambió lo contado» / «Lo contado no cambió: lo que cambió es lo que el sistema espera, que era Qx y ahora es Qy» / «cambiaron las dos cosas» |
> | Diálogo de reconteo | título fijo «El conteo cambió…» | título neutro, el motivo del servicio y los dos esperados (solo lo ve un administrativo, §4.40.3) |
> | Historial de cajas | «Recuento corregido: contó Q520, cerró con Q520» | «Cambió el esperado: contó Q520.00, teórico de Q500.00 a Q520.00» |
>
> Salida cruda de la app real (`verify:pantallas:caja`, macOS), escenario
> sobrante Q520 contra Q500 y venta de Q20 en el medio:
>
> ```
> auditoria_log: caja_cerrada | nuevo={…,"autorizadaPor":null,"autorizadaVia":null,"conteosSellados":1,"huboReconteo":false,"cambioElEsperado":true}
> auditoria_log: reconteo_de_cierre_autorizado | anterior={"conteosSellados":[{…,"montoEsperado":"500.00","montoReal":"520.00","diferencia":"20.00",…}]} | nuevo={"montoEsperado":"520.00","montoReal":"520.00","diferencia":"0.00","modo":"simple","autorizadaPor":"ad16213a-…","autorizadaVia":"presencial","cambioElConteo":false,"cambioElEsperado":true}
> ```
>
> Falsificado volviendo a condicionar el asiento solo a `huboReconteo`. En
> Vitest caen las 2 pruebas del esperado (sube y baja); en la app real cae
> «QUIÉN AUTORIZÓ QUEDA ESCRITO…» con `real: NO HAY ASIENTO DE RECONTEO`.
> Las regresiones del caso que ya funcionaba siguen pasando.
>
> **Lo que los cierres ANTERIORES al arreglo no tienen**: si alguno cayó en
> este caso, su autorizante no está escrito en ninguna parte y no se puede
> reconstruir. Se reconoce en la bitácora por `caja_cerrada` con
> `huboReconteo: false`, `conteosSellados > 0` y `diferencia "0.00"`.
>
> **BUSCADO EL 2026-09-15, en solo lectura: CERO cierres afectados.**
>
> | Base | Cierres | Con el campo `conteosSellados` | Con el patrón | Por qué no puede haber |
> |---|---|---|---|---|
> | `pos-pruebas-descartable` (`ztidrshifrblhfraiowg`), solo `SELECT` | 3 (del 2026-09-15, 01:45 a 02:00 UTC), los tres con diferencia `0.00` y sin autorizante | 0 | **0** | Los subió la instalación de Jimmy, `v1.0.0-prueba.1`, que no tiene sellos: `conteo_de_cierre_sellado` no aparece en ese tag. 0 asientos de sello y 0 de reconteo en el proyecto. |
> | Base de trabajo de esta Mac (`~/Library/Application Support/pos-agricola/pos-agricola.db`), consultada sobre una copia; sha256 del original igual antes y después | 1 (del 2026-09-08) | 0 | **0** | Anterior a los sellos (`0959a18`, 2026-09-14). |
>
> El filtro se probó contra cinco casos armados, en Postgres y en JavaScript:
> marca el defecto y no marca el reconteo que ya funcionaba, el cierre sin
> sellos, el sello que sigue con diferencia ni un asiento anterior a los sellos.
> `pos-jimmy-cano` no se consultó. Según §4.4 tenía 0 filas de negocio al
> 2026-09-14; eso no se volvió a medir.

Salida cruda del escenario de Jimmy en la aplicación real (teórico Q527.50,
cuenta Q500, corrige a Q527.50):

```
auditoria_log: conteo_de_cierre_sellado | nuevo={"montoEsperado":"527.50","montoReal":"500.00","diferencia":"-27.50","modo":"simple"}
bloqueos_de_autorizacion tras el PIN equivocado: [{"superficie":"cierre_con_diferencia","intentos_fallidos":1}]
auditoria_log: caja_cerrada | nuevo={…,"montoReal":"527.50","diferencia":"0.00",…,"autorizadaPor":null,"conteosSellados":1,"huboReconteo":true}
auditoria_log: reconteo_de_cierre_autorizado | anterior={"conteosSellados":[{…,"montoReal":"500.00","diferencia":"-27.50"}]} | nuevo={"montoReal":"527.50","diferencia":"0.00","autorizadaPor":"853bc6e6-…","autorizadaVia":"presencial"}
caja_sesiones: {"estado":"cerrada","monto_esperado":"527.50","monto_real":"527.50","diferencia":"0.00","diferencia_autorizada_por":null}
```

Falsificado: quitando la rama que exige autorización tras un sello, caen 4 de
las 13 pruebas nuevas, incluida la del escenario de Jimmy.

#### 5. El precio de compra y el margen (migraciones 031 / 0031)

`productos.precio_compra`, nulable, editable desde el formulario de producto
(que ya exige rol administrativo). **`NULL` es «sin costo cargado», nunca
cero**: un campo vacío se guarda como `NULL`, y editar sin mandar el costo lo
conserva.

El reporte de ventas por producto muestra, por fila, `margen = cobrado −
precio_compra × cantidad`, sumado con Decimal y redondeado una sola vez. Sin
costo, el margen dice **«sin dato»**. El margen del período suma solo lo que
tiene costo, y dice cuántos productos quedaron fuera y cuánto vendieron.

> **El margen usa el costo VIGENTE, no el del día de la venta.** `venta_detalle`
> guarda el precio, no el costo. Si el costo cambia en el período, las ventas
> viejas se calculan con el nuevo. Está dicho en la pantalla. Congelar el costo
> por venta sería una columna más en `venta_detalle` y su espejo.
>
> **SUPERADO EL MISMO DÍA (§4.40): esa columna existe,
> `venta_detalle.costo_unitario_snap`, y el margen usa la foto de cada línea.**
> El párrafo de arriba describe la primera versión, que nunca llegó a Jimmy.

**LA 0031 NO ESTÁ APLICADA EN NINGÚN PROYECTO, y es a propósito.** Las funciones
de la nube exigen EXACTAMENTE las columnas de la tabla, así que una terminal y
una nube con distinta versión detienen la cola en el primer lote de productos,
y toda venta lleva uno. La instalación de Jimmy está subiendo al proyecto de
pruebas desde anoche (leído del catálogo: 1 producto, 4 ventas, 29 asientos,
último a las 02:01 UTC), y aplicar la 0031 ahí le detendría la cola.

Lo que sí se midió contra Postgres, en `pos-pruebas-descartable`, dentro de un
bloque que termina en excepción para revertirlo entero:

```
A  nube SIN 0031, payload CON precio_compra -> P0001 CONTRATO: el payload de public.productos trae columnas que la tabla no tiene: precio_compra
B  nube CON 0031, payload CON precio_compra -> insertada, insertada; precio_compra guardado en Postgres = 4.50
C  nube CON 0031, payload SIN precio_compra -> P0001 CONTRATO: al payload de public.productos le faltan columnas que la tabla sí tiene: precio_compra
después: columna precio_compra = 0, productos de ensayo = 0, productos = 1, asientos = 29
```

**Las dos direcciones se recuperan sin perder nada.** La 031 local además le
agrega `precio_compra: null` a los payloads de productos que esperaban en la
cola, así que al quedar las dos partes iguales «Reintentar ahora» sube todo. La
0031 se aplica en el mismo momento en que se instala la versión que trae la 031.
`supabase/esquema-nube.json` ya declara la columna, así que `npm run verify:nube`
contra cualquiera de los dos proyectos va a reportar esa diferencia hasta
aplicarla; la batería destructiva también la exige.

#### Una corrección de la sesión anterior: la compilación incrustaba la nube siempre

Desde §4.38, con `.env.empaquetado` presente, TODA compilación quedaba apuntando
al proyecto de pruebas, incluida la de `verify:pantallas`, que verifica las
pantallas «sin configurar». `POS_COMPILAR_SIN_NUBE=1` compila sin nube, y lo usan
`verify:pantallas` y `verify:pantallas:caja`. El empaquetado no cambió. **`npm
run dev` y `npm run build` a secas siguen incrustando el proyecto de pruebas**
mientras exista el archivo.

### 4.40 El teórico se oculta al contar, y el costo es una foto de la venta (2026-09-14)

Dos correcciones de Julio sobre §4.39, el mismo día.

#### 1. Quién ve el efectivo teórico

**La razón, en sus palabras:** si quien cuenta puede ver el número que el
sistema espera, pierde sentido contar físicamente —podría copiar el número en
vez de verificar el cajón—, que es exactamente el propósito del conteo.

| Dónde | Administrativo | Venta |
|---|---|---|
| Resumen de la caja abierta (consulta durante el día) | **Sí** | No |
| `window.pos.caja.estado()` llamado desde la consola | **Sí** | `null` |
| `window.pos.venta.estado()` | `null` | `null` |
| **Paso donde se teclea el conteo del cierre** | **No** | No |
| Confirmación «Caja cerrada con éxito» | Sí | Sí |

**La regla del rol la aplica el proceso principal**, en
`src/main/ipc/turno-para-la-ventana.ts`: para quien no es administrativo el
teórico, las ventas en efectivo y su cantidad viajan en `null`, y **ni se
calculan**. Esconderlo en la pantalla no alcanzaba: el canal se llama desde la
consola. Las ventas en efectivo se ocultan JUNTO con el teórico porque inicial
más ventas ES el teórico. El estado de la venta no lo manda a ningún rol.

**La regla del conteo la aplica la pantalla**, porque el administrativo sí lo
recibe: cerrar la caja pasó a ser **dos pasos**. «Caja abierta» (resumen, con
el teórico si viajó) y, tras «Contar para cerrar», «Cerrar caja» (el conteo).
El paso de conteo no lee el campo: la fila no existe en el árbol, no está
escondida con CSS. «Volver a contar» desde un diálogo de autorización vuelve al
paso de conteo, no al resumen.

**El conteo sellado viaja sin el esperado ni la diferencia** mientras se
cuenta: solo cuándo se confirmó y cuánto se contó, que lo escribió la propia
persona. El pedido de PIN de una caja ajena, que ocurre antes de contar, manda
`montoEsperado: null`.

> **UNA INTERPRETACIÓN, dicha para que Julio la confirme.** Después de
> CONFIRMAR un conteo, los diálogos de diferencia y de reconteo siguen
> mostrando «Debería haber» y la diferencia, a cualquier rol. Se dejó así
> porque en ese momento el conteo ya quedó sellado en `auditoria_log` (§4.39):
> cualquier corrección posterior exige PIN aunque cuadre, y quien autoriza
> tiene que ver qué aprueba (§4.9). La consecuencia a saber: un cajero puede
> descubrir el teórico confirmando un número cualquiera, pero ese número queda
> registrado y corregirlo necesita a un administrador. Si Julio prefiere que
> esos diálogos no muestren el esperado al rol venta, el cambio es acotado.

**Verificado en la aplicación real** (`npm run verify:pantallas:caja`, 37
comprobaciones, macOS). El escenario pedido, salida cruda:

```
window.pos.caja.estado() con la sesión del ADMINISTRATIVO: {…,"ventasEnEfectivo":"27.50","cantidadDeVentasEnEfectivo":2,"montoTeorico":"527.50",…}
texto visible de la pantalla de conteo del administrativo: "Cerrar caja\n\nContá el efectivo que hay en el cajón. El monto que el sistema espera se muestra después de confirmar el conteo.\n\nLa abrió\nVos\nDesde\n…\nContar billetes y monedas\nEscribir el total\n…\nTotal contado\nQ0.00\nCerrar turno\nVolver\nNube: al día\nJimmy de verificación · administrativo\nv1.0.0"
OK  EL ADMINISTRATIVO, EN LA PANTALLA DE CONTEO: ni la fila del teórico ni la de ventas, y ni «527.50» ni «teórico» en todo el texto visible
window.pos.caja.estado() con la sesión de la CAJERA: {…,"ventasEnEfectivo":null,"cantidadDeVentasEnEfectivo":null,"montoTeorico":null,"primerConteoSellado":null}
texto visible del resumen de caja de la CAJERA: "Caja abierta\nLa abrió\nVos\nDesde\n…\nMonto inicial\nQ200.00\nContar para cerrar\nVolver\nNube: al día\nCajera de verificación · venta\nv1.0.0"
OK  LA CONFIRMACIÓN SÍ le muestra el teórico a la cajera, una vez registrado el conteo
```

Falsificado: dejando ver el teórico a cualquier sesión caen 3 de las 11 pruebas
de `turno-para-la-ventana.test.ts`; dibujándolo en el paso de conteo caen 4 de
las 21 de `pantalla-de-caja.test.ts`.

#### 2. El costo de cada venta es una foto (migraciones 032 / 0032)

`venta_detalle.costo_unitario_snap`, nulable. Se llena con
`productos.precio_compra` **dentro de la transacción de la venta**, en el mismo
paso que `precio_unitario_snap` (§4.13). El margen del reporte por producto usa
esa foto línea por línea: `subtotal_impreso − costo_unitario_snap × cantidad`,
exacto, redondeado una vez por producto. **Una línea con la foto en `NULL` no
entra en el margen ni cuenta como cero**: se cuenta aparte, por fila («1 línea
sin dato de costo») y en el total del período, con lo que se cobró en ellas.

Son `NULL` las ventas anteriores a la 032 —la migración no rellena con el costo
de hoy, que sería inventar el del pasado— y las de productos que no tenían
costo al venderse.

Verificado en la aplicación real: se vendieron 2 maíz con costo 3.00, se cambió
el costo a 5.00 desde la pantalla, y el margen siguió en Q2.50 (con el costo de
hoy habría dado −Q1.50):

```
productos.precio_compra del maíz tras editarlo: 5.00
venta_detalle en la base: [{"producto_nombre_snap":"Frijol negro","cantidad":"1.000","subtotal_impreso":"9.00","costo_unitario_snap":null},{"producto_nombre_snap":"Maíz blanco","cantidad":"2.000","subtotal_impreso":"8.50","costo_unitario_snap":"3.00"}]
filas del reporte por producto: ["Frijol negro1 unidad · 1 ventaQ9.00Margen: sin dato (1 línea sin dato de costo)","Maíz blanco2 unidad · 1 ventaQ8.50Margen: Q2.50"]
```

**Esa corrida encontró un defecto propio**: la primera versión solo decía
cuántas líneas faltaban cuando el producto tenía ALGUNA con costo, así que la
fila del frijol decía «sin dato» sin decir de cuántas líneas. Ahora lo dice
siempre.

Falsificado en Vitest: leyendo el costo del catálogo en vez de la foto caen 4
pruebas; guardando la foto siempre en `NULL` caen 9.

**La 0032 NO está aplicada en ningún proyecto y NO se probó contra Postgres.**
Tiene el mismo problema de forma de payload que la 0031 (§4.39): mientras una
terminal con la 032 y la nube difieran, la cola se detiene en el primer lote de
venta. Se aplica con la aprobación de Julio y en el mismo momento que se instala
la versión que la trae; la 032 local ya agrega la clave a los payloads que
esperaban en la cola.

#### 3. Los diálogos de autorización tampoco le muestran el esperado a la cajera

Julio cerró la interpretación que §4.40.1 dejaba abierta: después de confirmar
un conteo, los diálogos de diferencia y de reconteo **no muestran el esperado al
rol venta**. Un administrativo lo sigue viendo: es quien autoriza.

Lo hace el proceso principal, con `resultadoDeCierreParaLaVentana`, que filtra
TODO lo que devuelve el canal de cierre mientras la caja no se cerró. A quien no
es administrativo le llega:

| Campo | Qué llega | Por qué |
|---|---|---|
| `montoEsperado` | `null` | Es el dato que se oculta |
| `diferencia` | `null` | Con lo contado, la diferencia ES el esperado |
| `mensaje` | «Este cierre tiene una diferencia registrada. Un administrador tiene que autorizarlo.» | El del servicio dice «un FALTANTE de Q…» |
| `codigo` | `REQUIERE_AUTORIZACION_DE_RECONTEO` se presenta como `REQUIERE_AUTORIZACION` | El servicio devuelve «reconteo» SOLO cuando el conteo nuevo cuadra: distinguirlos le diría a la cajera que acertó |
| `primerConteo` | fecha y lo contado, sin esperado ni diferencia | Lo contado lo escribió ella |

El PIN que se pide es el mismo en los dos códigos, así que unificarlos no cambia
el flujo. La caja YA cerrada viaja entera a cualquier rol. El mensaje se eligió
para ser VERDAD en los dos casos que se presentan igual: «este conteo tiene una
diferencia» sería falso en un reconteo que cuadra, y la primera versión lo decía;
se vio en la salida cruda de la app real y se corrigió.

Verificado en la aplicación real (`verify:pantallas:caja`, 40 de 40, macOS):

```
texto visible del diálogo de diferencia de la CAJERA: "Cerrar caja\nEl conteo necesita autorización\nSe contó\nQ200.00\n\nEste cierre tiene una diferencia registrada. Un administrador tiene que autorizarlo.\n…"
window.pos.caja.cerrar(Q200.00) con la sesión de la CAJERA: {"ok":true,"datos":{"cerrada":false,"codigo":"REQUIERE_AUTORIZACION","mensaje":"Este cierre tiene una diferencia registrada. Un administrador tiene que autorizarlo.","diferencia":null,"montoEsperado":null,"montoReal":"200.00",…}}
auditoria_log, sellos: […,"{\"montoEsperado\":\"204.25\",\"montoReal\":\"200.00\",\"diferencia\":\"-4.25\",\"modo\":\"simple\"}"]
window.pos.caja.cerrar(Q204.25) con la sesión de la CAJERA: {"ok":true,"datos":{"cerrada":false,"codigo":"REQUIERE_AUTORIZACION",…,"diferencia":null,"montoEsperado":null,"montoReal":"204.25",…,"primerConteo":{"fecha":"…","montoReal":"200.00","montoEsperado":null,"diferencia":null},…}}
OK  AL ACERTAR EL ESPERADO, la cajera ve el MISMO diálogo que con diferencia: nada dice que ahora cuadra
```

La bitácora SÍ guarda el esperado: lo
que se oculta es la ventana, no el registro.

Falsificado: si el filtro deja pasar todo caen 5 pruebas; si el manejador
devuelve sin filtrar caen las 2 estructurales.

> **UNA CONSECUENCIA QUE HAY QUE DECIDIR.** El filtro mira a quien tiene la
> SESIÓN, no a quien teclea el PIN. Si la cajera cierra y un administrador se
> acerca a autorizar en esa misma pantalla, o lo autoriza por teléfono con el
> PIN remoto, **aprueba sin ver el monto**: §4.9 pedía que quien autoriza viera
> qué aprueba. Lo ve recién en la confirmación, ya cerrado, y queda en la
> bitácora. Las salidas son dejarlo así, o mostrar el monto después de que el
> PIN correcto se teclea y antes de cerrar (un paso más). Es de Julio.
>
> **RESUELTO EL MISMO DÍA (§4.40.5)**: Julio eligió la segunda salida.

#### 5. El PIN primero, el monto después, la confirmación al final

Cierra la consecuencia de §4.40.3. Es el mismo patrón de «esto es lo que estás
autorizando» del descuento excedente y del cierre con diferencia, con el orden
invertido: allá se ve el monto y después se pide el PIN; acá el PIN prueba que
quien mira es un administrador, y recién entonces se ve el monto, porque el
monto es justamente lo que no puede verse antes.

**Un PIN correcto (normal o remoto) NO cierra la caja.** El flujo vive en
`src/main/ipc/cierre-de-caja.ts` (`FlujoDeCierreDeCaja`), fuera del manejador
IPC, para poder probarlo contra SQLite real:

| Paso | Qué hace | Qué devuelve |
|---|---|---|
| PIN correcto | Guarda una AUTORIZACIÓN PENDIENTE. La caja sigue abierta | `AUTORIZACION_VALIDADA`, con esperado, diferencia y quién autorizó, a cualquier rol |
| «Sí, cerrar la caja» | Consume la autorización y cierra, con el autorizante y la vía del PIN validado | El cierre |
| «Cancelar» | Descarta la autorización EN EL PROCESO PRINCIPAL (`caja:cancelar-autorizacion-de-cierre`) | Vuelve al diálogo del PIN |
| PIN incorrecto | Nada: ni autorización ni monto | El rechazo, filtrado como siempre |

**La autorización vive en el proceso principal, no en la ventana.** Si cancelar
solo cerrara el cuadro, seguiría viva dos minutos y cualquiera con la sesión
podría cerrar desde la consola con un permiso que el administrador retiró.

Deja de valer si cambia el turno, quien tiene la sesión, el conteo exacto o el
esperado y la diferencia que se mostraron (una venta en el medio). Vale dos
minutos, como la solicitud de salida controlada, y un solo uso: se consume al
intentar confirmar, salga bien o mal. Un intento nuevo la descarta.

Verificado en la aplicación real (`verify:pantallas:caja`, 44 de 44, macOS):

```
OK  EL PIN CORRECTO NO CIERRA: revela lo autorizado (esperado Q527.50, sin diferencia) y la caja SIGUE ABIERTA en la base
OK  UN PIN INCORRECTO NUNCA MUESTRA NINGÚN MONTO: sigue el diálogo, sin revelación, sin 204.25 ni «Debería haber»
revelación en la sesión de la CAJERA tras el PIN del administrador: {"esperado":"Q204.25","quien":"Jimmy de verificación autorizó en persona. Revisá el monto y confirmá el cierre.","estado":"abierta"}
tras CANCELAR, window.pos.caja.confirmarCierreAutorizado(Q204.25) desde la consola: {"ok":true,"datos":{"cerrada":false,"codigo":"AUTORIZACION_NO_VIGENTE","mensaje":"No hay ninguna autorización para confirmar. Tecleá el PIN de un administrador.","diferencia":null,"montoEsperado":null,…}}
OK  CANCELAR no cierra y retira la autorización: confirmar desde la consola después no cierra nada
```

**Un defecto que encontró la prueba nueva**: la primera versión del filtro de
§4.40.3 le quitaba los montos a la cajera también en `AUTORIZACION_VALIDADA`,
así que el PIN correcto no revelaba nada. Falló «con el PIN normal… el esperado»
y se corrigió: ese código viaja entero.

Falsificado: si el PIN correcto cierra directo caen 10 de las 15 pruebas del
flujo; si cancelar no retira la autorización cae la suya.

> **Lo que se asume, dicho en voz alta:** al revelarse, el monto queda en la
> pantalla de la cajera. Si el administrador cancela, ella ya lo vio. Cualquier
> conteo nuevo sigue sellado y exige PIN, así que queda registrado.


#### 4. La 0031 y la 0032 en `pos-pruebas-descartable`, con evidencia del catálogo

Aplicadas el 2026-09-15 con la aprobación de Julio, primero la local verificada
y después el espejo. **`pos-jimmy-cano` no se tocó.**

Local, sobre una copia fresca de la base de trabajo:

```
2026-09-15T05:08:27.160Z aplicadasAhora: ["031_productos_precio_compra","032_venta_detalle_costo_unitario_snap"]
integrity_check: [{"integrity_check":"ok"}]
productos.precio_compra: [{"name":"precio_compra","type":"TEXT","notnull":0}]
venta_detalle.costo_unitario_snap: [{"name":"costo_unitario_snap","type":"TEXT","notnull":0}]
filas: [{"productos":6,"productos_con_costo":0,"venta_detalle":2,"lineas_con_snap":0,"auditoria":23}]
```

Nube, leído antes (05:08:03 UTC): 24 migraciones, columnas en 0 y 0, última
recepción 02:01:51 UTC, 0 sesiones activas. Después, de `information_schema`,
`pg_constraint` y `schema_migrations`:

| Qué | `productos.precio_compra` | `venta_detalle.costo_unitario_snap` |
|---|---|---|
| Tipo | `numeric(14,2)` | `numeric(14,2)` |
| Nulable / default | `YES` / `null` | `YES` / `null` |
| CHECK | `((precio_compra IS NULL) OR (precio_compra >= (0)::numeric))`, `convalidated=true` | `((costo_unitario_snap IS NULL) OR (costo_unitario_snap >= (0)::numeric))`, `convalidated=true` |
| COMMENT | el del archivo | el del archivo |
| Filas con valor | 0 de 1 | 0 de 4 |
| md5 del registro = md5 del archivo | `4047297d084524c39c8870dade62b1e0` | `110a8b1f31d11e440f8625c5c05b9de6` |
| Versión registrada | `20260915050916` | (siguiente) |

Después: 26 migraciones; usuarios 2, productos 1, ventas 4, venta_detalle 4,
caja_sesiones 3, auditoria 29, igual que antes. `npm run verify:nube`: «lo que
la nube declara coincide con supabase/esquema-nube.json», 0 diferencias. El
linter: los mismos 7 avisos de antes, ninguno nuevo.


### 4.41 La salida controlada acepta el PIN remoto (2026-09-15)

**Decisión explícita de Julio**, la segunda ampliación del PIN remoto después
del descuento excedente (§4.13): Jimmy tiene que poder autorizar el cierre de
la aplicación cuando no está en la tienda, por ejemplo para apagar la
computadora al final del día si no hay ningún administrador presente.

**Qué cambió, y qué no:**

| | Antes | Desde el 2026-09-15 |
|---|---|---|
| `ACEPTA_PIN_REMOTO.salida_controlada` | `false` | `true` |
| Verificación | `autorizarComoAdministrador`, la única del sistema | La misma, sin lógica nueva |
| Asiento `salida_controlada_autorizada` | `{ origen, detalle }` | `{ origen, detalle, autorizadaVia }` (`presencial` o `remoto`; `null` en un rechazo) |
| Candado de la superficie | 3 intentos, 30 s, propio | **Sin cambios** |
| Texto del diálogo | «Ingresá el PIN de administrador…» | «Ingresá el PIN de un administrador, en persona o dictado por teléfono…» |

La vía se guarda con la misma clave que usa el asiento del cierre de caja,
`autorizadaVia`. La salida no tiene fila en ninguna tabla de negocio, así que el
asiento es el único lugar.

**Verificado en la aplicación real** (`verify:pantallas:caja`, al final del
recorrido, macOS): el administrador se configura el PIN remoto, cierra su
sesión, se pide la salida desde el botón de la barra de estado en la pantalla de
ingreso y se teclea el remoto.

```
texto del diálogo de salida: "Salida de administradorIngresá el PIN de un administrador, en persona o dictado por teléfono, para cerrar el punto de venta de forma ordenada.CancelarCerrar aplicación"
el proceso de Electron terminó con 0 a los 171 ms
auditoria_log de la salida: [{"accion":"salida_controlada_autorizada","usuario_id":"33a5e906-…","valor_nuevo":"{\"origen\":\"boton_de_interfaz\",\"detalle\":\"PIN correcto\",\"autorizadaVia\":\"remoto\"}"}]
```

**Pruebas:** el PIN normal sigue cerrando como `presencial`; el remoto cierra
como `remoto` por las tres rutas; un rechazo lleva `autorizadaVia: null`; y los
candados siguen independientes: bloquear la salida no bloquea la diferencia, el
descuento ni la caja ajena, y bloquear cualquiera de las otras no bloquea la
salida, que sigue aceptando el remoto. Las combinaciones entre las tres que
aceptan el remoto pasaron de 2 a 6.

Falsificado: con la tabla de vuelta en `false` caen 7 pruebas; sin registrar la
vía caen 3.

**La guardia del alcance funcionó.** Al cambiar la tabla falló, sin que nadie
la buscara, una prueba del módulo de venta escrita el 2026-09-11 para vigilar
que la ampliación del descuento no se extendiera: «salida_controlada no debe
aceptar el PIN remoto». Se actualizó a mano, con la decisión nueva en un
comentario, y ahora vigila `cierre_de_caja_ajena` y
`saltar_lote_de_sincronizacion`. Es exactamente lo que tenía que pasar: una
ampliación no puede entrar sin tocar la prueba que la prohíbe.

> **Lo que queda fuera, dicho en voz alta:**
> - ~~**El diálogo de salida no tiene teclado en pantalla**: es un campo que se
>   escribe con teclado físico. No es nuevo ni de este cambio, pero con el PIN
>   dictado por teléfono en una pantalla táctil conviene revisarlo.~~
>   **RESUELTO EL 2026-09-15 (§4.46)**: se encontró probando la app, y la
>   auditoría que siguió encontró 21 campos más en la misma situación.
> - **Quien recibe el PIN remoto dictado puede, hasta que se cambie, cerrar la
>   aplicación** además de autorizar diferencias y descuentos. Es ordenado y
>   auditado; si deja de haber confianza en quien lo escuchó, se cambia el PIN
>   remoto desde «PIN de autorización remota».
>
>   **DECIDIDO (Julio, 2026-09-15): se evaluó separar el PIN remoto por
>   superficie y NO se hace.** Cambiar el PIN remoto ya es el control real si
>   cambia a quién se le dicta, y un PIN por superficie duplicaría ese mecanismo.
>   Ver la fila correspondiente de §5.
> - En Windows no se probó, como siempre.


### 4.42 Jimmy no pudo cerrar la caja que abrió otro: un defecto real, no un texto (2026-09-15)

**El reporte.** Jimmy no encontró forma de cerrar una caja abierta por otro
usuario. Antes de tocar código se diagnosticó con la app real.

**NO era una instalación de un solo usuario.** Leído de
`pos-pruebas-descartable` (`ztidrshifrblhfraiowg`), que es donde sube esa
instalación: hay dos usuarios, Jimmy (`administrativo`) y julio (`venta`).
Jimmy inició sesión a las 01:49:10 UTC con la caja de julio abierta desde las
01:47:15. Esa caja la cerró julio mismo a las 01:52:10, después de volver a
entrar. No hay ningún `caja_cerrada` de Jimmy sobre una caja de julio. Esa
instalación corría `v1.0.0-prueba.1` (`f71cd01`).

**La causa, medida en la app real de `v1.0.0-prueba.1`** (un worktree del tag,
compilado, con el mismo escenario: julio abre, sale, entra Jimmy):

```
botón confirmar-caja: «Cerrar turno (requiere autorización)» disabled=true      (antes de contar)
después de escribir Q100, confirmar-caja: «…» disabled=false
main stderr: Error occurred in handler for 'caja:cerrar': Error: An object could not be cloned.
window.pos.caja.cerrar(Q100) SIN PIN, llamado desde la consola -> SIN RESPUESTA DEL CANAL en 5000 ms
2.5 s después: confirmar-caja «…» disabled=true; mensaje-de-caja=(ninguno); dialogo=0
```

1. Cuando la caja es de otra persona y todavía no hay PIN,
   `ServicioDeCaja.intentarCerrar` devuelve un aviso que trae la `sesion` de
   dominio adentro.
2. El manejador de `caja:cerrar` de esa versión la devolvía con
   `{ ...aviso, … }`.
3. Los montos de la sesión son objetos Decimal, y **decimal.js les pone
   `constructor` como propiedad propia** (`x.constructor = Decimal`, línea 4301
   de `node_modules/decimal.js/decimal.js`). Es una función, y el puente IPC no
   clona funciones.
4. **Medido con Electron 44: la llamada no se rechaza, queda pendiente para
   siempre.** La pantalla tampoco atrapaba nada, así que el botón quedó
   deshabilitado sin ningún mensaje y el diálogo del PIN nunca apareció.

Solo pasaba en el cierre de una caja AJENA. La caja propia no toca esa rama.

**Por qué no lo vio nadie.** Las pruebas de Vitest llaman al flujo directo, sin
cruzar el puente IPC, y ningún recorrido de la app real cerraba una caja ajena.

**En el código actual ya no estaba, y fue sin querer.** El commit `0959a18`
(2026-09-14 22:28, después del tag) armó la respuesta campo por campo
«sin la sesión de dominio» por otra razón. Con eso el defecto desapareció sin
que nadie supiera que existía. Medido con el mismo escenario sobre el código
actual: el diálogo aparece, el PIN cierra, y `caja_sesiones` queda
`cerrada`, `abrio=julio`, `cerro=Jimmy`.

**Lo que se hizo ahora, para que no vuelva ni vuelva a ser silencioso:**

| Qué | Dónde | Falsificado |
|---|---|---|
| Toda respuesta del cierre (caja ajena y propia, en todos sus pasos) pasa por `structuredClone` | `cierre-de-caja.test.ts`, con un control de que un Decimal suelto no se clona | Metiendo `sesion` en la respuesta: caen 2 pruebas con `DataCloneError: function Decimal` |
| Las llamadas de la pantalla de caja pasan por `llamarAlProcesoPrincipal`: un rechazo **o 15 s sin respuesta** se convierten en un mensaje y el botón vuelve a estar disponible | `llamar-al-proceso-principal.ts` y `pantalla-de-caja.test.ts` | Quitando el `catch` caen 2 pruebas. **En la app real**, con la `sesion` metida a propósito: el mensaje aparece a unos 15 s del clic, el botón queda habilitado y la caja sigue `abierta` |
| El aviso dice «Esta caja la abrió **julio**. Vas a necesitar el PIN de un administrador para cerrarla», y en qué orden: primero se cuenta, el PIN se pide al tocar «Cerrar turno», y si quien mira es administrador sirve el suyo | `PantallaDeCaja.tsx` | Visto en la app real, en el resumen y en el paso de contar |
| El escenario completo quedó en `verify:pantallas:caja`: la cajera abre, el administrador ve el aviso, el botón abre el diálogo en menos de 10 s, el PIN cierra y la base dice quién cerró | `scripts/verificacion-de-caja-y-teclado.cjs` | Esta sección del arnés no se falsificó aparte. El mismo recorrido se falsificó con el guion de diagnóstico |

**El catch solo no alcanzaba, y se descubrió falsificando.** La primera
versión envolvía las llamadas en `try/catch`. En la app real no cambió nada,
porque la llamada no se rechaza. Por eso existe el límite de 15 s.

**La pantalla de venta NO nombra el PIN, a propósito.** Se probó cambiar su
texto a «con el PIN de un administrador» y lo frenó una prueba existente. Esa
pantalla no debe sugerir que un PIN desbloquea vender en el turno ajeno (§4.12).
Se dejó como estaba.

#### La misma protección, extendida a los 56 canales

Julio pidió no quedarse en el canal de cierre: el defecto es de patrón —un
servicio que devuelve un objeto de dominio y un manejador que lo pasa tal
cual—, así que podía estar en otro canal. Se agregaron dos cosas.

**1. `todo-canal-responde-algo-serializable.test.ts` llama a TODOS los
manejadores.** Registra `registrarManejadoresIpc` completo con los servicios
reales sobre SQLite, con Electron simulado solo para capturar los manejadores,
y llama cada canal como la ventana: una tienda sembrada con
`sembrarTerminalDeOrigen`, una restauración contra `NubeDeMentira` y una
instalación vacía. Exige cuatro cosas: que cada canal registrado se haya
llamado, que cada uno haya dado al menos una respuesta `ok` (para clonar datos
y no solo errores), que ninguna respuesta falle `structuredClone` y que ninguna
llegue rescatada por el envoltorio. **Un canal nuevo sin su llamada hace fallar
la prueba.** Salida cruda de la corrida, resumida:

```
[canal] caja:cerrar       propia, con diferencia=ok · PIN correcto: revela=ok · PIN otra vez=ok · confirmar=ok · AJENA sin PIN=ok · AJENA con PIN=ok
[canal] venta:cobrar      efectivo sin descuento=ok · descuento sin PIN=ok · descuento con PIN=ok
[canal] restauracion:terminar   sin PIN (se niega)=DATO_INVALIDO · terminar=ok
[canal] 56 canales registrados, 56 llamados, 78 llamadas
```

**Resultado: hoy ningún otro canal tiene el defecto.** Los 56 devuelven
respuestas clonables.

Falsificado antes de agregar la protección, en dos módulos: con la `sesion`
metida en la respuesta del cierre y un Decimal metido en el reporte por
producto, la prueba falla nombrando canal, paso y ruta:

```
"reportes:ventas-por-producto [este mes]: function Decimal(v) { — respuesta.datos.falsificado.constructor es una función (Decimal)",
"caja:cerrar [AJENA sin PIN]: function Decimal(v) { — respuesta.datos.sesion.montoInicial.constructor es una función (Decimal)",
```

**2. `ejecutarConRespuesta` comprueba que el resultado se pueda clonar.** Es el
envoltorio único de los 56 canales. Si el resultado no se puede clonar,
devuelve `RESPUESTA_NO_SERIALIZABLE` con la ruta del valor en el detalle, y lo
escribe en la consola del proceso principal. Así la llamada nunca queda
pendiente, en ninguna pantalla. El mensaje no promete que no pasó nada: la
operación corrió y pudo haber escrito. Con el defecto reintroducido en la app
real (macOS):

```
main stderr: [ipc] CIERRE_DE_CAJA_FALLIDO: la respuesta no se puede mandar a la ventana: datos.sesion.montoInicial.constructor es una función (Decimal)
window.pos.caja.cerrar(Q100) SIN PIN -> {"ok":false,"error":{"codigo":"RESPUESTA_NO_SERIALIZABLE",…,"detalle":"datos.sesion.montoInicial.constructor es una función (Decimal)"}}
2.5 s después: confirmar-caja disabled=false; mensaje-de-caja=La operación se ejecutó, pero su resultado no se pudo mostrar. …
```

Antes, esa misma llamada no respondía en 5 s. Con el envoltorio activo la
prueba de los canales sigue delatando el defecto: la última comprobación falla
con `"caja:cerrar [confirmar]: datos.sesion.montoInicial.constructor es una
función (Decimal)"`. Clonar cada respuesta cuesta una copia en memoria; las
respuestas más grandes son listas del catálogo y reportes, y no se midió en el
i3.

> **LA INSTALACIÓN DE JIMMY SIGUE CON EL DEFECTO.** Mientras corra
> `v1.0.0-prueba.1`, una caja ajena no se puede cerrar desde la pantalla; solo
> la cierra quien la abrió. Se arregla instalando una versión posterior. En
> Windows no se probó, como siempre.

### 4.43 La impresora se elige en una pantalla y se imprime por la cola de Windows (2026-09-15)

**Qué se pidió.** Una pantalla solo para administradores que liste las
impresoras, guarde la elegida, la pruebe y la quite. Y que, cuando la prueba
falla, distinga «no se pudo conectar» de «se conectó pero no entendió los
comandos».

**Tres decisiones de Julio, previas al código:** imprimir por la cola de
Windows en RAW con PowerShell (no con un módulo nativo); confirmar a mano cómo
salió el ticket de prueba; y corregir el ejemplo `\\.\USB001` de §4.14.

#### Por qué la cola de Windows, y por qué PowerShell

La vía documentada por Microsoft para mandar bytes crudos a una impresora es la
del spooler: `OpenPrinter → StartDocPrinter` con tipo de dato `"RAW"` →
`StartPagePrinter → WritePrinter → EndPagePrinter → EndDocPrinter`. Con `RAW`
el controlador no toca los bytes, así que llegan nuestros comandos ESC/POS
(página de códigos, corte). Por eso en Windows la impresora tiene que estar
**instalada** (con el controlador «Generic / Text Only» si el fabricante no
trae uno): la guía para la tienda está en `docs/GUIA-IMPRESORA.md`.

Un módulo nativo obligaría a compilar para Electron y para Windows, que §4.37
evitó. PowerShell 5.1 viene con Windows 10 y 11, y `Add-Type` declara las
funciones de `winspool.drv`. El script vive en `cola-de-windows.ts`.

#### `-Command` contra `-File`: qué dice la documentación (NO medido en Windows)

Julio pidió confirmarlo explícitamente y no asumirlo. Lo que sigue sale de la
documentación de Microsoft. **No se midió en ninguna máquina Windows.**

| Pregunta | Qué dice la documentación | Consecuencia acá |
|---|---|---|
| ¿Cuál es la política por omisión en un Windows de escritorio? | `Restricted`: permite comandos individuales pero no scripts, e impide correr todo archivo de script (`.ps1`, `.psm1`, `.ps1xml`, perfiles). | Con `-File enviar.ps1` el envío **se bloquearía** en una instalación de fábrica. |
| ¿`-Command` está alcanzado por esa política? | No: `-Command` ejecuta texto como si se tecleara, y la política gobierna la carga de archivos de script. | El envío corre con `-Command`. **Es la diferencia real entre las dos**, y es la que decidió la vía. |
| ¿`-ExecutionPolicy Bypass` lo arregla todo? | Fija la política solo para ese proceso, y **no le gana a una política puesta por directiva de grupo**. Además, la política «no es un límite de seguridad». | Se pasa `Bypass` solo para la consulta optativa del trabajo (`Get-PrintJob`/`Get-Printer`), cuyo módulo carga archivos de formato. Si una directiva lo impide, esa consulta devuelve `null` y el envío no cambia. |
| ¿Hay algo que bloquee aunque se use `-Command`? | Sí: el **modo de lenguaje restringido** (`ConstrainedLanguage`), que imponen AppLocker o WDAC, no deja que `Add-Type` cargue C# ni llame a la API de Win32. | Ahí el envío falla con clase `entorno` y el mensaje nombra el modo restringido. **No se puede resolver desde la aplicación**: es configuración de la computadora. |
| ¿Cómo se evita que las comillas rompan la línea? | `-EncodedCommand` recibe el comando en base64 (UTF-16LE), para comandos con comillas complicadas. | **Se usa `-EncodedCommand` con el script constante.** Cada argumento queda en letras, dígitos, `+`, `/` e `=`, así que Windows no tiene nada que escapar. Ver «El nombre de la impresora nunca es código», abajo. |
| ¿Los argumentos que siguen a `-Command` llegan como valores? | No: se unen en un solo texto y se interpretan como código. | Por eso el nombre **no** va como argumento. `-File` sí pasa los argumentos como valores, pero corre un archivo de script, que es lo que la política alcanza. |

Fuentes: [about_Execution_Policies](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_execution_policies),
[about_PowerShell_exe](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_powershell_exe),
[about_Language_Modes](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_language_modes),
[Send raw data to a printer by using the Win32 API](https://learn.microsoft.com/troubleshoot/windows/win32/win32-raw-data-to-printer),
[WritePrinter](https://learn.microsoft.com/windows/win32/printdocs/writeprinter).

#### El nombre de la impresora nunca es código (corregido el 2026-09-15)

La primera versión usaba `-Command` con un texto fijo que decodificaba el script
de una variable de entorno y lo corría con `Invoke-Expression`. **El nombre ya
no se armaba dentro del código**: iba en `POS_IMPRESION_NOMBRE` y el script lo
leía con `$env:`. Pero `Invoke-Expression` convierte texto en código al
ejecutar, y Julio pidió quitarlo. Es el mismo principio de las funciones
SECURITY DEFINER de la sincronización: el dato nunca se arma como texto de
código.

| | Antes | Desde el 2026-09-15 |
|---|---|---|
| Cómo llega el script | Variable de entorno + `Invoke-Expression` | **Argumento de `-EncodedCommand`**, constante calculada al cargar el módulo |
| Texto convertido en código al ejecutar | Sí, el script propio | **Ninguno** |
| Cómo llega el nombre | `$env:POS_IMPRESION_NOMBRE` | Igual: variable de entorno, leída como valor |
| Caracteres en la línea de comandos | Sin comillas dobles | Solo `[-A-Za-z0-9+/=]` |

**La prueba** (`cola-de-windows.test.ts`) pasa diez nombres hostiles —comillas
simples y dobles, backticks, punto y coma, `$(…)`, `&`, `|`, saltos de línea y
un here-string— y exige para cada uno cuatro cosas. Los argumentos tienen que
ser idénticos a los de un nombre común. Cada argumento tiene que ser del
alfabeto base64. El script decodificado tiene que ser la constante byte a byte,
sin el nombre. Y el nombre tiene que llegar intacto en su variable. Además exige
que el script no tenga `Invoke-Expression`, `iex`, `ScriptBlock::Create` ni
`Invoke-Command`, y que `$nombre` solo se use como argumento de tres llamadas.

**Falsificado:** con el nombre interpolado en `-Command` caen 11 pruebas; con
`Invoke-Expression` sobre el nombre dentro del script caen 2.

> **Lo que esta prueba NO puede decir:** qué hace PowerShell con el texto. En
> esta Mac no hay PowerShell. Lo probado es que el nombre nunca llega al texto
> que se ejecuta. Que PowerShell no vuelve a interpretar el valor de `$env:` es
> documentación, no medición. **Riesgo inferido, no medido:** algunos antivirus
> miran con sospecha `-EncodedCommand`, porque lo usa también el malware. Si
> Defender lo bloqueara en la tienda, el síntoma sería la clase `entorno` con el
> mensaje de PowerShell en el detalle.

#### Lo que la computadora puede saber, y lo que no

Una térmica ESC/POS **no contesta nada**. La computadora solo sabe si Windows
aceptó el trabajo. Por eso cada envío se clasifica en cinco clases, cada una con
su título y el detalle técnico al lado (etapa, código Win32, bytes, estado del
trabajo, modo de lenguaje):

| Clase | Cuándo | Qué ve la persona |
|---|---|---|
| `no_encontrada` | `OpenPrinter` falla con 1801 | «No se encontró la impresora» |
| `no_se_pudo_enviar` | falla abrir, empezar, escribir o terminar, o se escribieron menos bytes | «No se pudo conectar con la impresora» |
| `trabajo_con_error` | Windows aceptó, pero el trabajo o la impresora dicen `Offline`, `PaperOut`, `Error`… | «La impresora recibió el ticket pero reporta un problema» |
| `entorno` | PowerShell no arrancó, no terminó en 12 s, no devolvió JSON, o está restringido | «Esta computadora no pudo ejecutar el envío» |
| `enviado` | todo lo anterior salió bien | «Ticket de prueba enviado» y **tres preguntas** |

**«Se conectó pero rechazó el comando» no lo puede detectar ningún software.**
Solo lo detecta quien tiene el papel en la mano. Por eso, con `enviado`, la
pantalla pregunta: «Sí, salió bien», «Salió con símbolos raros o sin cortar» o
«No salió nada». La segunda queda en `impresora.json` como `envio: enviado` +
`confirmacion: ilegible`, y en la bitácora técnica como «SEÑAL: el modelo podría
no ser compatible con los comandos ESC/POS usados». Es un problema distinto de
no poder conectarse, y tiene otro arreglo.

#### El archivo y el proveedor

```json
{ "impresora": "POS-80", "ultimaPrueba": { "impresora": "POS-80", "fecha": "…", "envio": "enviado", "confirmacion": "ilegible" } }
```

- Se escribe a un temporal y se renombra. Un archivo roto se lee como «sin
  impresora» y se anota: el punto de venta arranca igual.
- Quitar la impresora borra el archivo si no hay prueba que conservar. Si la
  hay, deja solo la prueba.
- `ImpresoraSegunElArchivo` vuelve a leer el archivo **en cada recibo**, así
  que guardar o quitar vale para el próximo recibo sin reiniciar.
- Guardar exige que el nombre esté en la lista del sistema **en ese momento**.
- El diagnóstico dice «Sin impresora configurada — los recibos solo se generan
  en PDF» o «Impresora configurada: X». Nunca el nombre de una clase.
- La lista sale de `webContents.getPrintersAsync()`. En macOS eso es CUPS (en
  esta Mac aparece `EPSON_L3560_Series`), y en Windows es la lista de impresoras
  instaladas (**no medido**).

**Impresoras simuladas.** Con `POS_IMPRESORAS_SIMULADAS=<carpeta>` la aplicación
lista dos impresoras falsas, y la que «recibe» escribe los bytes en un archivo.
`index.ts` solo mira esa variable con `app.isPackaged === false`, y una prueba
exige que la lea en un solo lugar y con esa condición.

#### Verificado, y dónde

| Qué | Cómo | Resultado |
|---|---|---|
| El envío, la clasificación, `-EncodedCommand` sin `-Command` ni `-File`, los nombres hostiles, el límite de tiempo | `cola-de-windows.test.ts`, con un proceso de mentira | 36 de 36 |
| Lista sin hardware, persistencia tras reiniciar, prueba sin impresora, confirmación, `structuredClone`, quitar sin romper los recibos (con `ServicioDeRecibos` real) | `servicio-de-impresora.test.ts` | 35 de 35 |
| Los seis canales con guard y esquema | `impresora-guard.test.ts` | 8 de 8 |
| Los seis canales clonables con servicios reales | `todo-canal-responde-algo-serializable.test.ts` | 62 canales, 86 llamadas, todas `ok` |
| La pantalla | `pantalla-de-impresora.test.ts` | 10 de 10 |
| La aplicación real, macOS | `npm run verify:pantallas:impresora` | 14 de 14 |

**Falsificado**, una mutación a la vez: quitar sin borrar la impresora (caen 3),
confirmar sin guardar la respuesta (caen 2), guardar sin exigir que esté
instalada (cae 1), PowerShell con `-File enviar.ps1` (cae 1), y probar sin
elegir en silencio (cae 1).

Salida cruda de la aplicación real (2026-09-15, macOS):

```
OK    SIN IMPRESORA el estado lo dice con palabras, sin nombres de clases
mensaje al probar sin elegir: "Primero elegí una impresora de la lista. Sin impresora elegida no hay adónde mandar el ticket de prueba."
resultado de la desconectada: clase=trabajo_con_error titulo="La impresora recibió el ticket pero reporta un problema"
bytes del ticket de prueba (282): primeros 8 = 1b401b7402504f53; últimos 8 = 0a1b64031d564200
log-tecnico: [impresion] Ticket de prueba a Termica-simulada: la persona contestó «ilegible». SEÑAL: el modelo podría no ser compatible con los comandos ESC/POS usados.
impresora.json tras guardar: {"impresora": "Termica-simulada", "ultimaPrueba": {…, "envio": "enviado", "confirmacion": "ilegible"}}
OK    TRAS REINICIAR la aplicación la impresora sigue configurada y marcada en la lista
venta con impresora: {"numeroRecibo":1,…,"pdfGenerado":true,"impreso":true,"mensajeDeImpresion":"Recibo enviado a la impresora."}
venta sin impresora: {"numeroRecibo":2,…,"pdfGenerado":true,"impreso":false,"mensajeDeImpresion":"No hay impresora configurada. El recibo quedó en PDF."}
14 comprobaciones, 0 fallidas.
```

#### Lo que NO se verificó, y ningún entorno de desarrollo puede verificar

- **Que el ticket salga legible en la impresora de Jimmy.** Es la pregunta que
  ninguna prueba contesta. La contesta la persona con los tres botones.
- **Que el script de PowerShell corra en Windows.** Todo lo de `-Command`,
  `Restricted`, `ConstrainedLanguage` y `Add-Type` es documentación, no
  medición. En esta Mac el enviador real ni siquiera arranca: devuelve
  `entorno` con «solo funciona en Windows».
- **Cuánto tarda PowerShell en el i3.** El límite de 12 s y la espera de 1,5 s
  para leer el trabajo son estimaciones.
- **Que `getPrintersAsync()` liste en Windows lo mismo que el Panel de
  control.**
- **Que 1801 sea el código real** de un nombre inexistente en esa máquina.
- **Qué pasa con una impresora compartida en red** (`\\equipo\impresora`). No
  se probó.

### 4.44 El historial de cajas (2026-09-15)

**Qué se pidió.** Una pantalla solo para administradores con TODAS las sesiones
de caja, abiertas y cerradas, de la apertura más reciente a la más vieja, con
filtros por rango de fechas y por quien abrió. Cada fila dice quién abrió,
cuándo y con cuánto. Si se cerró, dice quién cerró, el teórico, el real y la
diferencia, quién la autorizó y por qué vía, y si hubo un recuento sellado
corregido. Tocar una fila abre el detalle con todo expandido y el desglose por
denominación de la apertura y del cierre.

#### El historial NO calcula nada del corte

Lee lo que el cierre guardó y lo presenta. Si recalculara el teórico o la
diferencia, una regla nueva cambiaría un corte viejo. Es el mismo criterio del
recibo (§4.14).

**De dónde sale cada dato**, porque no todo vive en la misma tabla:

| Dato | Fuente |
|---|---|
| Quién abrió, cuándo, inicial, teórico, real, diferencia, estado | `caja_sesiones` |
| Quién cerró, si fue otra persona | `caja_sesiones.cerrada_por` (`NULL` = cerró quien abrió, §4.9) |
| Quién autorizó la diferencia y la vía | `caja_sesiones.diferencia_autorizada_por` / `_via` |
| Quién autorizó cerrar la caja ajena | asiento `caja_cerrada`, campo `cierreAjenoAutorizadoPor` |
| Los conteos sellados | asientos `conteo_de_cierre_sellado` |
| La corrección de un conteo sellado: primer conteo, final, quién autorizó y vía | asiento `reconteo_de_cierre_autorizado` |
| El desglose por denominación | `caja_sesion_denominaciones`, con el valor de `denominaciones` |

**La corrección NO puede salir de `caja_sesiones`.** Si el conteo corregido
cuadra, el CHECK de la migración 008 exige las columnas de autorización vacías,
así que el único lugar donde queda quién la autorizó es el asiento (§4.39).

- **El desglose se multiplica con Decimal**, y los subtotales se suman en la
  aplicación, nunca en SQL (§4.15).
- En modo simple no hay filas de desglose, y el detalle dice «Se contó
  escribiendo el total».
- **Un asiento que no se puede leer no se esconde.** La fila lleva un aviso,
  por ejemplo «Hay una corrección de conteo autorizada en la bitácora que no se
  pudo leer.».
- Un usuario que no existe se muestra como «(usuario desconocido)». Este
  historial existe para auditar, y un hueco silencioso es lo peor que puede
  mostrar.

#### Los filtros

- **Las fechas filtran por el día de APERTURA, en hora de Guatemala.** Usan el
  mismo `resolverPeriodo` de los reportes (§4.15). Una caja abierta el 12/09 a
  las 23:30 de Guatemala (13/09 05:30 UTC) es del 12. Hay prueba de ese borde.
- **El filtro de persona es por quien abrió**, no por quien cerró. Hay prueba
  de que el cierre ajeno de Jimmy no aparece al filtrar por Jimmy.
- Las opciones del selector son las personas que abrieron alguna caja.
- Filtrar y ordenar se hace en SQL sobre texto ISO y UUID, que es exacto. Ninguna
  columna decimal se ordena ni se agrega en SQL.
- Una sola fecha, una fecha inexistente o un rango al revés se rechazan con
  `DATO_INVALIDO` y un mensaje claro.

#### Los dos canales exigen rol administrativo

`cajas:historial` y `cajas:detalle` van envueltos en
`requiereRol(sesion, 'administrativo', …)` con esquema Zod. Una prueba cuenta dos
`ipcMain.handle` y dos guards. El botón «Historial de cajas» solo se dibuja para
el rol administrativo, pero lo que rechaza es el canal.

Los dos están en `todo-canal-responde-algo-serializable.test.ts`: 64 canales
registrados, 64 llamados, 89 llamadas.

#### Verificado en la aplicación real (macOS)

`npm run verify:pantallas:historial-de-cajas`, 17 de 17. Las cinco sesiones se
arman por los canales reales de la ventana, con PIN de verdad y sin tocar la
base:

| Caso | Qué pasó |
|---|---|
| A | Ana abre Q500, cuenta Q480 y Jimmy autoriza con el PIN remoto |
| B | Ana abre y cierra por denominación (2 × Q200 + 1 × Q100), exacto |
| C | Rosa abre Q300 y Jimmy la cierra con su PIN (caja ajena) |
| D | Ana abre Q500, cuenta Q480, corrige a Q500 y Jimmy autoriza |
| E | Rosa abre Q200, cuenta Q150 y la deja abierta |

Salida cruda:

```
armado A PIN remoto: {"codigo":"AUTORIZACION_VALIDADA","cerrada":false}
armado C ajena con PIN: {"codigo":"CIERRE_CORRECTO","cerrada":true}
armado D corregir a 500: {"codigo":"REQUIERE_AUTORIZACION","cerrada":false}
asientos de caja: [{"accion":"caja_abierta","n":5},{"accion":"caja_cerrada","n":4},{"accion":"conteo_de_cierre_sellado","n":3},{"accion":"reconteo_de_cierre_autorizado","n":1}]
window.pos.historialDeCajas.listar() con la sesión de ROSA (venta): {"ok":false,"error":{"codigo":"PERMISO_DENEGADO",…}}
fila 2: [cerrada] Abrió Ana · … · inicial Q500.00 Cerró Ana · … · teórico Q500.00 · real Q500.00 · cuadra RECUENTO CORREGIDO: CONTÓ Q480.00, CERRÓ CON Q500.00 · AUTORIZÓ JIMMY, EN PERSONA Ver detalle
fila 3: [cerrada] Abrió Rosa · … · inicial Q300.00 Cerró Jimmy (otra persona) · … · cuadra CERRADA POR OTRA PERSONA Ver detalle
fila 5: [cerrada] Abrió Ana · … · real Q480.00 · faltante de Q20.00 Diferencia autorizada por Jimmy, por teléfono (PIN remoto) Ver detalle
filtro Rosa: [E, C]
filtro 2026-09-15 a 2026-09-15: 5 filas; período: Aperturas del 15/09/2026 a 15/09/2026
17 comprobaciones, 0 fallidas.
```

**Falsificado en la app real.** Con `requiereRol` quitado del canal de lista,
falla «ROSA (VENTA)… PERMISO_DENEGADO» con `ok=true` y el guion sale con código
1.

**Falsificado en Vitest**, una mutación a la vez:

| Mutación | Pruebas que caen |
|---|---|
| Orden ascendente en SQL | 3 |
| Sin filtro de persona | 3 |
| Días en UTC | 3 |
| `cerradaPor` siempre quien abrió | 1 |
| Reconteo en `null` | 2 |
| Aviso silenciado | 1 |
| Pantalla sin la etiqueta de recuento | 1 |
| Filtro de persona que no se manda | 1 |
| Guard quitado | 3 |

**Un defecto del arnés, no del producto:** la primera corrida dio 3 fallas
porque las etiquetas van en mayúsculas por CSS e `innerText` las devuelve así.
Ahora se compara sin distinguir mayúsculas.

#### Lo que NO se verificó

- **Windows**, como siempre.
- **El borde de día de Guatemala en la app real.** Las cinco sesiones del arnés
  son de hoy. El filtro de otro día se ejercitó con «ayer» (cero filas); el borde
  de las 18:00 está probado solo en Vitest sobre SQLite real.
- **El rendimiento con un año de cajas.** La lista trae todas las sesiones sin
  paginar y lee los asientos de caja en una sola consulta. No se midió en el i3.
- **La presentación.** No se pidió pulido: el detalle usa listas de definición
  sin estilo propio.

### 4.45 La anulación de una venta: el núcleo local (2026-09-15)

**Diseño aprobado entero:** `docs/ANULACION-DE-VENTA.md`. Este prompt construyó
solo el núcleo local, que se usa de punta a punta por el canal
`venta:anular`.

| Qué | Estado |
|---|---|
| Migración 033: `anulaciones_de_venta` y sus dos disparadores (§1.1) | **Hecho** |
| Migración 034: superficie `anulacion_de_venta` (§4.1) | **Hecho** |
| Servicio: los ocho pasos de §2.2, la unidad (§2.3) y el voucher (§3.3) antes del PIN | **Hecho** |
| PIN: superficie propia, sin remoto, con `autorizarComoAdministrador` tal como estaba | **Hecho** |
| Efectivo esperado y reportes: la anulada se excluye por su fila (§3.1, §1.3) | **Hecho** |
| Los cuatro asientos de §6.1, con el contenido de §6.2 | **Hecho** |
| Canal `venta:anular`, en la prueba de clonado de todos los canales (§4.42) | **Hecho** |
| Sincronización a la nube (§7): la `0033`, la `0035`, el enrutador, el contrato | **No**. Prompt aparte |
| Restauración (§8), el recibo marcado (§5), el reporte de cobros con tarjeta (§3.5), la pantalla | **No**. Prompts aparte |

> **UNA VERSIÓN CON ESTE NÚCLEO NO SE INSTALA EN UNA TERMINAL CONECTADA A LA
> NUBE.** El lote de la anulación se encola dentro de la transacción (§2.2,
> paso 8), pero su puerta en la nube no existe todavía. El enrutador lo mandaría
> a `sincronizar_lote_simple`, que lo rechaza por nombre, y la cola se detendría
> (§7.5 del diseño). Sin pantalla nadie anula por accidente, pero el canal se
> puede llamar desde la consola. `deriva-de-esquema.test.ts` anota la tabla en
> `TABLAS_QUE_VIAJAN_SIN_PUERTA_TODAVIA`, y falla el día que llegue su espejo
> hasta que se la saque.

#### La regla, y lo que cambió en consultas que ya existían

**Una venta está anulada si y solo si existe su fila en `anulaciones_de_venta`.**
`ventas.estado` queda en `'completada'` también en las anuladas.

- Las cuatro consultas de §0.3 del diseño filtran con un solo fragmento,
  `VENTA_SIN_ANULACION` (`repositories/ventas.ts`). Dos se renombraron para no
  mentir: `listarCompletadasEnRango` pasó a `listarNoAnuladasEnRango`, y su par
  de `venta_detalle` también.
- `RepositorioDeVentas.anular()` **se eliminó**: era el camino descartado.
- Sus tres usos en pruebas insertan ahora la fila de anulación.

**El comentario de la migración 015 dice que `cantidad_vendida` «nunca baja».**
Desde hoy baja al anular (§2.4 del diseño), con `anularVentaDeProducto`, que es
el espejo de `registrarVentaDeProducto`. El comentario no se corrige porque una
migración aplicada no se edita (§4.2): esta nota es la aclaración.

#### Los dos pasos del canal

Es el patrón del descuento excedente: **un solo canal que se llama dos veces**,
como dice §4.3 del diseño. No son dos canales.

1. **Con `pin` en `null`.** Valida en este orden:
   1. la venta existe;
   2. su caja está abierta;
   3. no tiene anulación;
   4. el voucher coincide, si fue con tarjeta;
   5. ninguna unidad cambió;
   6. los contadores alcanzan;
   7. el motivo es válido.

   Si algo falla, contesta `ok: false` con el código, y no se pide el PIN. Si
   no, contesta `REQUIERE_AUTORIZACION` con la vista previa.
2. **Con el PIN.** Primero **vuelve a validar todo**: una caja cerrada mientras
   tanto no consume un intento del candado. Después pide el PIN, y con el PIN
   aceptado corre la transacción, que valida otra vez adentro.

La coreografía vive en `FlujoDeAnulacionDeVenta` (`ipc/anulacion-de-venta.ts`)
y se prueba contra SQLite real, igual que `FlujoDeCierreDeCaja`.

| Código nuevo (`errores.ts`) | Cuándo |
|---|---|
| `VENTA_YA_ANULADA` | Segunda anulación. También traduce el UNIQUE de la 033 |
| `CAJA_DE_LA_VENTA_CERRADA` | La caja de la venta ya se cerró |
| `VOUCHER_NO_COINCIDE` | «El voucher no coincide con el de la venta original.» |
| `UNIDAD_CAMBIADA` | Cambió `tipo_medida` o `unidad_peso` desde la venta |
| `CONTADORES_INCONSISTENTES` | `cantidad_vendida` quedaría negativa o `contador_ventas` bajaría de cero |
| `ANULACION_INMUTABLE` | Traduce los disparadores de la 033. Va ANTES que `AUDITORIA_INMUTABLE` |

`CONFLICTO_DE_INVENTARIO` se reusa con otro texto: «…cambió mientras se
anulaba. La venta no se anuló.»

#### Cuatro interpretaciones del diseño, dichas para que Julio las confirme

1. **Cada rechazo de autorización deja `anulacion_de_venta_rechazada` con su
   código**: `PIN_INCORRECTO`, pero también el tercer intento
   (`AUTORIZACION_BLOQUEADA`) o un PIN mal formado. §6.1 dice «cada PIN bien
   formado pero equivocado» y cita a la salida controlada como modelo, y la
   salida registra todo rechazo. Se hizo como la salida. El PIN no va en el
   asiento.
2. **La validación de contadores también corre antes del PIN**, no solo en la
   transacción. §4.3 no la nombra entre las previas; pedir un PIN para después
   rechazar por datos inconsistentes no tenía sentido.
3. **`contador_ventas` baja por la cantidad de líneas del producto** (`veces`), no
   por un 1 fijo. Hoy es 1 siempre, porque la venta rechaza el mismo producto
   dos veces; el esquema no lo impide.
4. **El motivo se guarda recortado** de espacios en los extremos.

#### Evidencia

**Vitest** (`npm run verify`): 90 archivos y 2155 pruebas, código de salida 0. Se
sumaron 53 pruebas de servicio y flujo (`servicio-de-anulacion.test.ts`) y 12
estructurales (`anulacion-estructural.test.ts`), cada detector con su control.

**En la app real, por `window.pos.venta.anular`** (macOS; sonda temporal que no
quedó en el repositorio):

```
typeof window.pos.venta.anular en la ventana: function
productos antes: [{"inventario_disponible":"97.000","contador_ventas":2,"cantidad_vendida":"3.000"}]
[efectivo, sin PIN] -> {"ok":true,"datos":{"anulada":false,"codigo":"REQUIERE_AUTORIZACION",…,"avisoDeDevolucion":"Hay que devolverle Q8.50 al cliente."},…}
[efectivo, PIN equivocado] -> {"ok":true,"datos":{"anulada":false,"codigo":"PIN_INCORRECTO",…}}   candado: [{"intentos_fallidos":1}]
[efectivo, PIN de Jimmy] -> {"ok":true,"datos":{"anulada":true,"codigo":"ANULACION_CORRECTA",…,"saldoAnterior":"97.000","saldoNuevo":"99.000"}]}}}
[efectivo, otra vez] -> {"ok":false,"error":{"codigo":"VENTA_YA_ANULADA","mensaje":"Esa venta ya estaba anulada.",…}}
[tarjeta, voucher equivocado con el PIN correcto] -> {"ok":false,"error":{"codigo":"VOUCHER_NO_COINCIDE","mensaje":"El voucher no coincide con el de la venta original.",…}}   candado: [{"intentos_fallidos":0}]
[tarjeta, voucher correcto, PIN de Jimmy] -> {"ok":true,"datos":{"anulada":true,…,"efectivoQueDejaDeContar":"0.00",…}}
productos después: [{"inventario_disponible":"100.000","contador_ventas":0,"cantidad_vendida":"0.000"}]
ventas: [{…,"forma_pago":"efectivo","total":"8.50","estado":"completada"},{…,"forma_pago":"tarjeta","num_boleta":"004512","total":"4.25","estado":"completada"}]
caja.estado() con la sesión de Ana: {…,"ventasEnEfectivo":null,"cantidadDeVentasEnEfectivo":null,"montoTeorico":null,…}
sync_cola: lote 1bc4ed03 #0 anulaciones_de_venta insertar · #1 productos actualizar · #2 auditoria_log insertar
errores en la consola de la ventana: []
```

**La 033 y la 034 sobre una copia de la base de trabajo real** (la regla de
§4.14). La copia es de las 09:28 hora local del 2026-09-15, con sha256
`6b702bff…45653`, cuando la base estaba todavía en la 030. Se abrió con el
migrador de la aplicación:

```
migraciones al abrir: {"aplicadasAhora":["031_productos_precio_compra","032_venta_detalle_costo_unitario_snap","033_anulaciones_de_venta","034_superficie_anulacion_de_venta"],…,"ultimaAplicada":"034_superficie_anulacion_de_venta"}
integrity_check: [{"integrity_check":"ok"}]
foreign_key_check: []
anulaciones_de_venta: [{"filas":0}] · disparadores: anulaciones_de_venta_prohibir_delete, anulaciones_de_venta_prohibir_update, auditoria_log_prohibir_delete, auditoria_log_prohibir_update
CHECK de bloqueos incluye anulacion_de_venta: [{"incluye":1}]
el resto de la base: {"usuarios":2,"productos":6,"ventas":1,"venta_detalle":2,"cajas":2,"auditoria_log":23,"limites":2,"sync_cola":2}
la venta real: {"id":"7e46d49a-…","total":"190.00","estado":"completada","anulaciones":0}
```

> **LA BASE DE TRABAJO REAL YA TIENE LA 033 Y LA 034, y no se aplicaron desde
> esta sesión.** A las 15:43:32 UTC del 2026-09-15 (09:43 hora local) alguien
> abrió la aplicación con esa carpeta de datos. Los checksums registrados de la
> 033 y la 034 son idénticos a los archivos de este repositorio
> (`e22b38ed…` y `f4e801b5…`), cuando todavía no estaban en commits. Ninguna de
> las tres copias de `.claude/worktrees/` tiene esas migraciones. El migrador
> aplicó en ese arranque la 031, la 032, la 033 y la 034. La bitácora técnica
> muestra el proyecto de pruebas incrustado y **ninguna credencial guardada**:
> no subió nada. Después hubo dos ingresos fallidos, dos correctos y una salida
> controlada, espaciados como los de una persona. **Consecuencia, leída del
> migrador:** una versión anterior abre esa base igual, porque `aplicarMigraciones`
> no se niega ante migraciones registradas que no conoce: las ignora. La tabla
> nueva queda vacía y sin uso.

**Falsificado**, una mutación por vez; se revirtió con `git checkout` y
`git status` quedó limpio después de cada una:

| Mutación | Qué cae |
|---|---|
| Volver al saldo del asiento de la venta en vez de sumar (planeada) | 3: queda 100 en vez de 147, el asiento de §6.2, y la estructural de §6.3 |
| No bajar los contadores (planeada) | 2 |
| Dejar el filtro por `estado` (planeada) | 6: el esperado, el reporte, la estructural y el cierre de caja |
| Aceptar el PIN remoto (planeada) | 2 |
| Encolar la fila de `ventas` (planeada) | 1: la forma del lote |
| Comparar el voucher contra cualquier venta con tarjeta (planeada) | 1 |
| Quitar la validación de unidad | 2 |
| Mirar el PIN antes de validar | 10 |
| Que el servicio lea la bitácora | 1: la estructural de §6.3 |
| No dejar el asiento del conflicto | 2 |
| Un disparador que no impide editar | 1 |

La séptima falsificación planeada, «que el reporte lea `ventas.estado`», es
del reporte de §3.5, que no se construyó en este prompt.

#### Lo que NO se verificó

- **Windows**, como siempre.
- **Nada contra la nube.** El lote se encola y nadie lo sube a una puerta que
  exista.
- **Un conflicto real del comparar-y-cambiar.** Con una sola conexión síncrona no
  puede pasar; se forzó envolviendo el método del repositorio.
- **La cantidad de líneas de un mismo producto mayor que 1.** La venta no lo
  permite y no se sembró a mano.

### 4.46 Todo campo donde se escribe pasa por el teclado en pantalla (2026-09-15)

**El hallazgo.** Probando la app, el diálogo «Salida de administrador» pedía el
PIN sin abrir ningún teclado en pantalla. En la tienda no hay teclado físico
garantizado: ese diálogo era inutilizable.

#### La causa raíz, confirmada con el historial

1. `ModalDeSalida.tsx` nació el 2026-09-04 (`2866a0e`) con un
   `<input type="password">` nativo. `TecladoNumerico` llegó el 2026-09-06
   (`4276e83`) y el alfanumérico el 2026-09-14 (`0959a18`).
2. El diálogo se tocó dos veces después (`999ef96` y `04d1f46`, PIN remoto) y
   nadie migró el campo.
3. §4.39 arregló los campos que Jimmy nombró (caja, productos, categorías) y
   no recorrió el resto. §4.41 anotó «el diálogo de salida no tiene teclado» y
   quedó en nota.
4. **Aunque se hubiera migrado, no habría andado:** `<ModalDeSalida />` estaba
   montado FUERA de `<ProveedorDeTeclado>`, y fuera del proveedor un
   `CampoDeTexto` se degrada en silencio a un campo común.
5. **Nada fallaba al agregar un `<input>` suelto.** Esa es la causa de fondo.

#### La auditoría: 22 campos sin teclado, en 19 sitios del código

Salida del detector estructural corrido contra el código anterior (`432723b`):

| # | Sitio | Campo |
|---|---|---|
| 1 | `ModalDeSalida.tsx:94` | PIN de salida (password) |
| 2 | `PantallaDeConfiguracionInicial.tsx:88` | nombre del primer administrador |
| 3 | `CuadriculaDeProductos.tsx:123` | buscador de la pantalla de venta (search) |
| 4–5 | `DialogoDeCobro.tsx:369, 426` | valor del descuento, número de boleta |
| 6–7 | `PantallaDeUsuarios.tsx:192, 228` | nombre, PIN del alta (password) |
| 8–9 | `PantallaDeLimites.tsx:205, 220` | porcentaje, monto fijo |
| 10–13 | `PantallaDeNegocio.tsx:143` (un `map`) | nombre comercial, dirección, teléfono, NIT |
| 14–15 | `PantallaDeNube.tsx:275, 289` | correo (email), contraseña (password) |
| 16–17 | `PantallaDeRestauracion.tsx:276, 289` | correo (email), contraseña (password) |
| 18 | `PantallaDeRestauracion.tsx:331` | fecha del robo (datetime-local) |
| 19–20 | `PantallaDeReportes.tsx:175, 186` | desde, hasta (date) |
| 21–22 | `PantallaDeHistorialDeCajas.tsx:173, 184` | desde, hasta (date) |

Ya tenían teclado: todos los PIN con `TecladoNumerico` (ingreso, configuración
inicial, caja ajena, diferencia, descuento excedente, cambiar PIN, PIN remoto,
saltar lote, PIN de restauración), conteo de caja, cantidad del ticket, y los
`CampoDeTexto` de productos, categorías y ajuste de inventario. Fuera de
alcance porque no reciben texto: `<select>`, radio y checkbox. ~~El diálogo de
anulación de venta no existe (solo su diseño).~~ *(Corregido al mergear con
develop: la anulación tiene núcleo y canal desde el mismo día, §4.45, pero
todavía no tiene pantalla, así que no tiene campos que auditar.)*

#### El arreglo: estructural

| Qué | Dónde |
|---|---|
| **Única puerta para pedir texto** | `components/TecladoEnPantalla.tsx`: `CampoDeTexto` y `CampoDeFecha`. Un PIN que se confirma solo sigue con `TecladoNumerico`. |
| **Prueba estructural** | `src/main/__tests__/todo-campo-usa-el-teclado.test.ts`. Recorre el árbol sintáctico (compilador de TypeScript) de todo `src/renderer/src` y falla nombrando archivo y línea ante un `<input>` que no sea radio/checkbox con tipo literal, un `<textarea>`, un `contentEditable` o un `createElement('input')`. Exige además que en `App.tsx` el `ProveedorDeTeclado` sea el ÚNICO hijo de `<main>`. Lista de excepciones vacía, con motivo obligatorio. |
| **El diálogo de salida** | `TecladoNumerico` en modo PIN, sin ningún campo nativo. Un teclado físico sigue sirviendo (dígitos, ←, Enter, Escape). Al abrirse cierra el teclado alfanumérico si había un formulario a medio escribir: ese teclado va por encima de todo modal y taparía las teclas del PIN. **No se tocó nada del proceso principal**: `git diff 432723b -- src/main src/shared src/preload` sale vacío. |
| **Correo y contraseña** | Capa de símbolos («#@» / «abc», `FILAS_DE_SIMBOLOS`): la capa de letras no tenía `@`. `oculto` hace el campo `password` y la vista del teclado muestra puntos. `mayusculaInicial={false}` para correo, contraseña, boleta y buscador. |
| **Fechas** | `CampoDeFecha` conserva el control nativo y llama a `showPicker()` al tocar cualquier parte del campo. Antes Chromium solo abría el calendario tocando el iconito. `inputMode="none"`. |

**La razón de las fechas, para que se pueda discutir:** elegir un día en un
calendario es mejor en pantalla táctil que escribir `2026-09-15`. Lo que falta
verificar es que el calendario se use bien con el dedo en Windows (ver abajo).
Si no, la alternativa es un `CampoDeTexto` con disposición de fecha.

#### Dos defectos que encontró la app real y ninguna prueba veía

1. **EL TOQUE QUE ABRE EL TECLADO LO CERRABA** (existía desde §4.39, en todo
   `CampoDeTexto` de la franja baja de la pantalla). El `mousedown` abre el
   teclado, que queda debajo del dedo. El `mouseup` cae en el teclado, y el
   navegador manda el `click` al ancestro común (`<main>`), que el cierre por
   «tocar fuera» leía como un toque fuera. Registrado en la app real, ventana
   de 1024×720:

   ```
   mousedown→restauracion-correo scrollY=0 · focus→restauracion-correo scrollY=0 ·
   mouseup→teclado-en-pantalla scrollY=0 · click→MAIN scrollY=0
   ```

   Arreglo: el proveedor escucha SIEMPRE el comienzo del gesto
   (`pointerdown`/`mousedown`), y si empezó sobre un campo o sobre el teclado,
   su `click` no cierra. Prueba puntual en `teclado-en-pantalla.test.ts`;
   falsificada quitando esa condición, cae exactamente esa prueba.
   **Por qué no lo vio `verify:pantallas:caja`:** sus campos quedaban arriba
   en la ventana de 1100×900 que pide. Salir de la pantalla completa en macOS
   ignoró ese `setSize` y dejó 1024×720.
2. **Con pantalla baja, el diálogo de cobro quedaba con los botones bajo el
   teclado, sin forma de desplazarlos.** `.capa-modal--arriba` ahora se
   desplaza y deja espacio al pie. Medido: `scrollTop 0→56`, el botón pasa de
   `y=395.5` (tapado, el teclado empieza en `394.5`) a `y=339.5`.

#### Verificado en la app real (macOS): `npm run verify:pantallas:teclado`, 36 de 36

Toca los 22 campos uno por uno con los dedos del arnés, escribe con las teclas
en pantalla y lee el campo. Recorre los caminos de salida y el candado. La
nube apunta a `http://127.0.0.1:9`, un puerto local cerrado: no se tocó ningún
proyecto de Supabase. Extracto crudo:

```
#16 Restauración · correo: teclado=abierto disposición=texto type=text inputmode=none valor="caja@pos" vista="caja@pos"
#17 Restauración · contraseña: teclado=abierto disposición=texto type=password inputmode=none valor="•••••••" vista="•••••••"
#18 Restauración · fecha del robo: type=datetime-local inputmode=none showPicker llamadas=1 errores=[]
#7 Usuarios · PIN del alta: teclado=abierto disposición=entero type=password inputmode=none valor="••••" vista="••••"
C1 · atajo Ctrl+Shift+Alt+Q (sendInputEvent): diálogo=visible campos nativos=0 teclas del PIN=1 log «origen: atajo_de_teclado» antes=0 después=1 proceso vivo=true
B · el diálogo de salida CIERRA el teclado alfanumérico del formulario
SONDA [con el diálogo de salida abierto] con el proceso 28174 al frente (POS = 28174): {"valorCrudo":0,"banderasActivas":[],"bloqueaForceQuit":false,"bloqueaCmdTab":false}
AppleScript Ctrl+Shift+Option+Q: codigo=0 salida="enviada" → diálogo=visible, origen atajo_de_teclado 1→2, proceso vivo=true
AppleScript Cmd+Q: codigo=0 salida="enviada" → diálogo=1 solicitudes cierre_del_sistema 0→1 proceso vivo=true
C2 · app.quit(): diálogo=visible campos nativos=0 origen cierre_del_sistema 1→2 proceso vivo=true
C3 · ventana.close(): diálogo=visible campos nativos=0 origen cierre_del_sistema 2→3 proceso vivo=true
C4 · botón de la barra de estado: diálogo=visible origen boton_de_interfaz 0→1 proceso vivo=true
intento 1 con 1111: mensaje="PIN incorrecto." bloqueos_de_autorizacion=[{"intentos_fallidos":1,"bloqueado_hasta":null}]
intento 2 con 2222: mensaje="PIN incorrecto." bloqueos_de_autorizacion=[{"intentos_fallidos":2,"bloqueado_hasta":null}]
intento 3 con 3333: mensaje="Demasiados intentos. Autorización bloqueada 30 segundos." bloqueos_de_autorizacion=[{"intentos_fallidos":0,"bloqueado_hasta":"2026-09-15T16:24:34.647Z"}]
PIN CORRECTO durante el bloqueo: mensaje="Autorización bloqueada temporalmente. Volvé a intentar en 30 segundos." proceso vivo=true
PIN correcto pasado el bloqueo: el proceso terminó con 0 a los 101 ms
auditoria_log: salida_controlada_autorizada | usuario cd9a5abd-… | {"origen":"boton_de_interfaz","detalle":"PIN correcto","autorizadaVia":"presencial"}
```

**Un dato que no se había medido antes:** con `Menu.setApplicationMenu(null)`,
un Cmd+Q REAL de macOS sí llega a `before-quit` (`cierre_del_sistema 0→1`).
Hasta hoy eso estaba razonado, no medido.

#### Pruebas de Vitest nuevas, y falsificaciones

| Archivo | Pruebas | Falsificación |
|---|---|---|
| `todo-campo-usa-el-teclado.test.ts` | 12 | Contra `432723b`: marca los 19 sitios y `ModalDeSalida` fuera del proveedor. Con un `<input type="text">` agregado a `PantallaDeImpresora.tsx`: falla nombrando `components/PantallaDeImpresora.tsx:217`. Con `ModalDeSalida` sacado del proveedor: falla con `["ModalDeSalida","ProveedorDeTeclado"]`. |
| `modal-de-salida.test.ts` | 14 | Con el diálogo de `432723b` caen 11. Sobreviven las 3 que no dependen del campo. |
| `teclado-en-pantalla.test.ts` | +12 (22) | Sin la condición del gesto cae «EL TOQUE QUE LO ABRE NO LO CIERRA». |
| `teclas.test.ts` | +3 | — |

#### Lo que NO se verificó

- **Windows**, como siempre. En particular: que el calendario de Chromium se
  use cómodo con el dedo, que `inputMode="none"` impida el teclado táctil de
  Windows, y el atajo con teclado latinoamericano.
- **Que el calendario se VEA.** El popup de fecha no es parte del DOM:
  Playwright no lo puede capturar. Lo medido es que `showPicker()` se llamó
  una vez y no lanzó.
- **Alt+F4 y el Administrador de tareas.** En macOS se ejercitó la misma
  puerta (`ventana.close()`) y la sonda de Presentation Options.
- **`ensayo:restauracion` y `verify:pantallas:restauracion`** no se volvieron a
  correr: hablan con el proyecto de pruebas de Supabase. Sus `fill()` siguen
  siendo válidos sobre `CampoDeTexto`.

### 4.47 El PIN remoto fijo se reemplaza por un código TOTP (2026-09-15)

**Qué se pidió.** Que la autorización a distancia deje de ser un PIN fijo de
cuatro dígitos y pase a ser el código de seis dígitos que muestra una app de
autenticación (Google Authenticator, Microsoft Authenticator). Cambia cada 30
segundos. Las tres superficies que aceptaban el remoto lo siguen aceptando:
`cierre_con_diferencia`, `descuento_excedente` y `salida_controlada`. El
candado, `autorizadaVia` y la tabla `ACEPTA_PIN_REMOTO` no cambiaron.

> **LA REGLA NO NEGOCIABLE, en palabras de Julio:** «El secreto compartido de
> TOTP NUNCA sube a la nube, bajo ninguna circunstancia». Un hash de PIN es de
> una sola vía; el secreto de TOTP no: quien lo tenga calcula todos los códigos
> futuros de esa persona. Por eso la columna nunca se sincroniza, nunca aparece
> en un payload de `sync_cola` y ninguna migración de la nube la incluye.

#### Las piezas

| Pieza | Qué hace |
|---|---|
| `domain/usuarios/totp.ts` | HMAC-SHA1, truncación dinámica de RFC 4226, Base32 de RFC 4648, la ventana de ±1 paso y la URI `otpauth://`. Sin dependencias: `node:crypto`. |
| Migración `036_totp_de_autorizacion_remota` | `usuarios.totp_secreto_cifrado` (BLOB, el CHECK rechaza texto y bytes vacíos) y `usuarios.totp_ultimo_paso` (entero ≥ 0). **Solo local.** |
| Migración `037_quitar_pin_remoto_hash` | `DROP COLUMN pin_remoto_hash`. **Los PIN remotos fijos no se conservan**, por decisión de Julio. |
| `COLUMNAS_EXCLUIDAS.usuarios` | Suma `totp_secreto_cifrado` y `totp_ultimo_paso`. |
| `ServicioDeAutenticacion` | Recibe `cifrado` (el `safeStorage` real, igual que la credencial de §4.23). Inscripción en tres métodos: iniciar, confirmar y cancelar. |
| `domain/usuarios/qr.ts` | La matriz del QR con `qrcode-generator`. |
| Tres canales IPC | `sesion:autorizacion-remota-iniciar`, `-confirmar` y `-cancelar`. Solo rol administrativo, y el usuario sale de la sesión. Reemplazan a `sesion:configurar-pin-remoto`. |
| `PantallaDeAutorizacionRemota` | El QR dibujado con rectángulos SVG, el secreto en grupos de cuatro y un teclado de seis dígitos. Reemplaza a `PantallaDePinRemoto`. |
| `TecladoNumerico` | Nueva prop `largos`. Los diálogos que aceptan remoto pasan `[4, 6]`; la inscripción pasa `[6]`. |

**La librería de QR es `qrcode-generator` 2.0.4 (MIT), y no es nativa.**
Comprobado sobre el paquete instalado:

- su `package.json` no declara `dependencies` ni `gypfile`;
- su único script es `test`;
- no trae ningún `.node`, `binding.gyp` ni `prebuilds/`.

Es JavaScript puro y viaja en el asar sin recompilar nada (§4.37).

#### Cómo se decide qué se tecleó

**El largo lo dice.** Cuatro dígitos son el PIN normal (`presencial`). Seis
dígitos son el código de la app (`remoto`), y solo en una superficie que acepta
remoto. En una que no lo acepta, seis dígitos son `FORMATO_INVALIDO` y no
consumen intento. Un mismo número ya no puede ser las dos cosas, así que la
regla vieja de «probar primero los normales» dejó de hacer falta.

#### La inscripción

1. **Iniciar** genera 160 bits aleatorios y los guarda en memoria, 10 minutos.
   No escribe nada. Si `safeStorage` no está disponible, no muestra ningún
   secreto (`CIFRADO_NO_DISPONIBLE`): un secreto que no se puede guardar no se
   muestra.
2. **Confirmar** exige el código de la app:
   - si coincide, guarda el secreto cifrado, consume ese paso, escribe el
     asiento `autorizacion_remota_inscrita` (`{mecanismo, reemplazoUnaAnterior}`)
     y encola `usuarios` más el asiento;
   - si es un código bien formado que no coincide, **descarta la inscripción
     entera sin dejar rastro**: ni columna, ni asiento, ni cola, ni candado;
   - si está mal formado, no descarta nada.
3. **Reinscribirse** reemplaza el secreto sin conocer el anterior, y el código
   viejo deja de servir.

#### Tres decisiones técnicas tomadas acá, dichas para que Julio las revise

| Decisión | Por qué | Consecuencia a saber |
|---|---|---|
| **Un código sirve UNA vez** (`totp_ultimo_paso`, comparar-y-cambiar) | RFC 6238 §5.2. Sin esto, quien escucha el código dictado lo puede reusar durante unos 90 segundos. | Dos autorizaciones seguidas por teléfono: la segunda espera al código siguiente (hasta 30 s). El código de la confirmación tampoco sirve para autorizar. |
| **Un código que coincide con DOS administradores se rechaza** (`CODIGO_AMBIGUO`), sin consumir intento ni paso | Atribuirlo a uno sería la atribución equivocada de §4.7. Con secretos aleatorios pasa aproximadamente una vez cada millón de códigos. | Se pide el código siguiente. |
| **Un código de inscripción equivocado descarta el secreto** | Es la letra del pedido: «si no, se descarta y se puede reintentar». | La cuenta que la persona ya agregó al teléfono queda con un secreto inútil, y hay que borrarla. El mensaje lo dice. La alternativa era conservar el secreto para reintentar. |

#### Qué quedó de la colisión de PIN

`colision-de-pin.ts` ahora compara solo el PIN normal. El secreto de TOTP no
lo elige una persona, así que no hay «colisión de elección» que impedir.
**Para el PIN normal la regla no cambió.** Las pruebas de §4.7 que miraban el
remoto se reemplazaron por dos:

- crear un usuario después de una inscripción no descifra ningún secreto;
- el código del módulo no nombra nada de la autorización remota.

#### Verificado en Vitest

Resultado: 2306 pruebas en `npm run verify`.

- **Vector de RFC 6238** de punta a punta: con el secreto del apéndice B y
  `T = 59 s`, el servicio autoriza `287082` como `remoto`. Control: `94287082`
  da `FORMATO_INVALIDO` y `287083` da `PIN_INCORRECTO`.
- **±30 s** aceptado en las dos direcciones; **±60 s** rechazado y contado
  como intento. Una prueba de control comprueba que los cinco códigos son
  distintos.
- **La inscripción:**
  - exige el código;
  - con un código equivocado, la huella de `usuarios`, `auditoria_log`,
    `sync_cola` y los candados queda idéntica;
  - vence a los 10 minutos;
  - un usuario de venta o dado de baja no se inscribe;
  - no se confirma la inscripción de otro.
- **Las tres superficies** con el código dinámico, en el recorrido de
  `ACEPTA_PIN_REMOTO` y en las pruebas de caja, venta, cierre y salida
  controlada. Esas pruebas pasaron del hash fijo a un secreto sembrado con
  `CifradoDePrueba`.
- **`el-secreto-totp-no-sale-de-la-terminal.test.ts`**, al mismo nivel que la
  contraseña de §4.23. Recorre inscripción descartada, inscripción buena, las
  tres superficies, un código repetido, un secreto que no descifra y la
  reinscripción. Después busca los tres secretos generados:
  - en todos los archivos de la base (`.db`, `-wal` y `-shm`, antes y después
    del checkpoint), en UTF-8, minúsculas, UTF-16 y como bytes crudos
    decodificados;
  - en todo payload de `sync_cola`;
  - en todo asiento;
  - en la bitácora técnica;
  - en el grafo del servicio.

  Hay control del buscador de archivos y del de objetos. También comprueba que
  ninguna migración de `supabase/` ni la foto `esquema-nube.json` nombran TOTP.
- **`CifradoDePrueba` NO es la identidad**: es AES-256-GCM con una llave en
  memoria. Con un doble identidad, la búsqueda en el archivo pasaría en falso.

**Falsificado**, una mutación a la vez, con el archivo restaurado y comparado
byte a byte después de cada una:

| Mutación | Qué cayó |
|---|---|
| Ventana de ±2 pasos | 5 pruebas: ±60 s en `totp.test.ts` y en el servicio, y el vector (el paso −1 revienta, ver abajo) |
| No consumir el paso | 3: código repetido, código anterior y código de la confirmación |
| Quitar `totp_secreto_cifrado` de `COLUMNAS_EXCLUIDAS` | 3: la búsqueda en `sync_cola`, la lista de exclusiones y el asiento encolado |
| Guardar aunque el código de inscripción no coincida | 2: «no deja rastro» y «reintentar» |
| Guardar el secreto en claro | 16 |
| Anotar el secreto descifrado en la bitácora | 1: «en ninguna línea de la bitácora» |
| Poner el secreto en el asiento | 3: archivos, `sync_cola` y asientos |
| No limpiar la inscripción pendiente | 1: «en ningún campo del servicio» |
| Tomar la primera coincidencia en vez de rechazar la ambigua | 1 |
| Dejar inscribirse a un usuario de venta | 1 |
| Teclado sin `largos` | 5: teclado y pantalla |

**La primera versión de la mutación de bitácora NO mordía, y no era un
defecto del código.** Anotaba `totpSecretoCifrado.toString('utf8')`, o sea el
texto cifrado, que no es el secreto. Se rehízo anotando el secreto descifrado,
y esa sí cae. **La mutación de colisión solo la atrapa la prueba sobre el
código fuente**: el PIN remoto ya no existe como columna, así que no hay
comportamiento que reintroducir.

**Un defecto que destapó la falsificación.** Con el reloj en los primeros 30 s
de 1970, el paso −1 hacía reventar `writeBigUInt64BE`. Ahora se salta, con
prueba propia. Esa prueba falla quitando el arreglo.

#### Verificado en la aplicación real (macOS, `npm run verify:pantallas:caja`, 57 de 57)

El arnés calcula el código con su propio TOTP (`scripts/totp-de-arnes.cjs`),
escrito aparte del de la aplicación. Contra los vectores del RFC da `287082` y
`081804`. El QR se lee con CoreImage (`scripts/sonda-qr-macos.swift`), un lector
ajeno a la librería que lo genera. Salida cruda (el secreto se oculta también
en la salida del arnés):

```
base tras el código equivocado: {"usuario":{"tipo":"null","totp_ultimo_paso":null},"cola":53,"asientos":27,"inscritas":0} (antes: cola 53, asientos 27)
OK    UN CÓDIGO EQUIVOCADO NO DEJA RASTRO: sin secreto, sin asiento, sin cola, y el QR se esconde
QR leído por CoreImage (lector ajeno a la librería): otpauth://totp/pos-agricola:Jimmy%20de%20verificaci%C3%B3n?secret=<oculto>&issuer=pos-agricola&algorithm=SHA1&digits=6&period=30
OK    EL QR SE LEE con un lector ajeno y codifica la URI otpauth:// con EXACTAMENTE el secreto que se muestra en texto
columna guardada: tipo=blob; 51 bytes; primeros 3 en latin1="v10"; totp_ultimo_paso=59649942; ¿el secreto aparece en los bytes? false; ¿safeStorage real lo descifra al mismo secreto? true
OK    NINGÚN payload de sync_cola lleva el secreto ni las columnas de TOTP
archivos revisados bajo la carpeta de datos: 49 (pos-agricola.db, pos-agricola.db-shm, pos-agricola.db-wal entre ellos)
OK    EL SECRETO NO ESTÁ EN CLARO en ningún archivo de la carpeta de datos (texto, UTF-16 ni minúsculas)
esperando 14947 ms al siguiente paso de 30 s: el código de la inscripción ya se usó
auditoria_log de la salida: [{"accion":"salida_controlada_autorizada","usuario_id":"9846b7d1-…","valor_nuevo":"{\"origen\":\"boton_de_interfaz\",\"detalle\":\"PIN correcto\",\"autorizadaVia\":\"remoto\"}"}]
OK    la bitácora técnica no tiene el secreto
OK    LA SALIDA CONTROLADA CON EL CÓDIGO DE LA APP cierra la aplicación, y el asiento dice «remoto» con el administrador real
```

`v10` es el prefijo de OSCrypt, el mismo que midió §4.23. **Falsificado en la
app real**, guardando el secreto en claro: fallan con su nombre «EL CÓDIGO
CORRECTO GUARDA EL SECRETO CIFRADO» (`contiene: true; descifra igual: false`) y
«NO ESTÁ EN CLARO» (`real: pos-agricola.db-wal`), y el guion sale con código 1.

Los otros arneses también pasan con el código dinámico:

| Arnés | Resultado | Qué ejercita |
|---|---|---|
| `verify:pantallas:historial-de-cajas` | 17 de 17 | caso A por el canal remoto: `AUTORIZACION_VALIDADA`, luego `CIERRE_CORRECTO` |
| `verify:pantallas` | 48 de 48 | un descuento excedente autorizado con el código |
| `verify:pantallas:teclado` | 36 de 36 | — |

`ensayo:restauracion` solo cambió el nombre de una columna en su consulta, y
**no se corrió**: habla con la nube.

#### 036 y 037 sobre una COPIA de la base de trabajo real

La base de trabajo no se tocó: su sha256 es igual antes y después. Su
administrador **tenía un PIN remoto fijo**, así que la 037 tuvo algo real que
quitar. Salida cruda:

```
ANTES columnas usuarios: ["id","nombre","rol","pin_hash","activo","creado_en","actualizado_en","intentos_fallidos","bloqueado_hasta","pin_remoto_hash"]
ANTES usuarios: [{"nombre":"jimmy","rol":"administrativo",…,"tenia_remoto":1,"actualizado_en":"2026-09-15T18:06:10.238Z"},{"nombre":"Caja","rol":"venta",…,"tenia_remoto":0,…}]
ANTES conteos: [{"u":2,"v":4,"vd":10,"a":51,"sc":58,"cs":4,"p":6}]
aplicadasAhora: ["036_totp_de_autorizacion_remota","037_quitar_pin_remoto_hash"] ultima: 037_quitar_pin_remoto_hash
integrity_check: [{"integrity_check":"ok"}] foreign_key_check: []
DESPUÉS columnas usuarios: ["id","nombre","rol","pin_hash","activo","creado_en","actualizado_en","intentos_fallidos","bloqueado_hasta","totp_secreto_cifrado","totp_ultimo_paso"]
DESPUÉS usuarios: [{"nombre":"jimmy",…,"totp_secreto_cifrado":null,"totp_ultimo_paso":null,"actualizado_en":"2026-09-15T18:06:10.238Z"},…]
DESPUÉS conteos: [{"u":2,"v":4,"vd":10,"a":51,"sc":58,"cs":4,"p":6}]
payloads de usuarios en sync_cola idénticos: true filas: 2
algún payload nombra pin_remoto_hash o totp: false
```

**No hay payload que reescribir.** `pin_remoto_hash` ya se excluía desde la
fase 1.a, y hay prueba de eso con un payload como lo encolaba la versión
anterior.

**Del lado de la nube no hay nada que aplicar**: `pin_remoto_hash` no existe en
Postgres desde la `0021`. El `0036` y el `0037` quedan reservados.

#### Lo que NO se verificó

- **Windows**, como siempre, y en particular **`safeStorage` con DPAPI**. Lo
  medido es el llavero de macOS.
- **Que un teléfono real escanee el QR.** Lo medido es que un lector de QR
  ajeno lo lee y codifica la URI correcta.
- **Que Google o Microsoft Authenticator muestren el mismo número.** Lo medido
  es que el código coincide con los vectores del RFC y con un TOTP escrito
  aparte.
- **El reloj de la tienda.** Un desfase de más de 30 s rechaza los códigos. El
  aviso de reloj desfasado (§4.36) solo va a la bitácora técnica y solo mide
  cuando hay nube configurada.
- ~~**El emisor**: en el instalador el QR dice «POS Jimmy Cano», que es
  `app.getName()`, pero eso **no se midió en un instalador**. En desarrollo
  dice «pos-agricola».~~ **CORREGIDO EL 2026-09-15:** el emisor es la constante
  `EMISOR_DEL_CODIGO_REMOTO = 'Vixo POS'`, la marca comercial que indicó Julio,
  igual en desarrollo y en el instalador. Ver «El emisor es la marca», abajo.

#### El emisor es la marca, «Vixo POS» (corregido el mismo día)

**Qué cambió.** El emisor del `otpauth://` es el texto que la app de
autenticación muestra encima del código. Antes era `app.getName()`: en
desarrollo «pos-agricola», el nombre interno del repositorio, y en el instalador
«POS Jimmy Cano» (esto último no medido). Julio pidió la marca comercial del
software. Ahora es la constante `EMISOR_DEL_CODIGO_REMOTO` en `totp.ts`, y el
canal `iniciarAutorizacionRemota` la usa.

**Una premisa del pedido que no se pudo confirmar.** El pedido decía que la
marca «ya está establecida» en la licencia del instalador y en el metadato de
publicador. Buscado el 2026-09-15: «Vixo» no aparece en ningún archivo del
repositorio ni en el historial de ninguna rama (`git log --all -S`). No hay
archivo de licencia en la raíz. El publicador dice `"author": "Julio Orellana"`
(`package.json`) y `copyright: Copyright (c) 2026 Julio Orellana`
(`electron-builder.yml`). Por eso esta constante es, hoy, **el único lugar del
repositorio que nombra la marca**. Si la marca se establece en otros lugares,
conviene que lean esta misma constante o que una prueba compare los textos.
**ACTUALIZADO EL MISMO DÍA (§4.48):** el instalador ya lleva la marca como
publicador y en la licencia, y `instalador-marca-y-licencia.test.ts` exige que
el publicador sea igual a esta constante.

**Qué NO cambia.** El emisor no entra en el cálculo del código. Los secretos
guardados siguen valiendo. Las cuentas ya agregadas a un teléfono conservan el
nombre con que se escanearon; para ver «Vixo POS» hay que volver a inscribirse.

**Verificado en la app real** (`verify:pantallas:caja`, 57 de 57, macOS). El QR
se leyó con CoreImage:

```
QR leído por CoreImage (lector ajeno a la librería): otpauth://totp/Vixo%20POS:Jimmy%20de%20verificaci%C3%B3n?secret=<oculto>&issuer=Vixo%20POS&algorithm=SHA1&digits=6&period=30
OK    EL QR SE LEE con un lector ajeno y codifica la URI otpauth:// con EXACTAMENTE el secreto que se muestra en texto
57 comprobaciones, 0 fallidas.
```

El espacio viaja como `%20` en la etiqueta y en `issuer`, como pide el formato
de Google Authenticator.

**Falsificado**: con el canal de vuelta en `app.getName()` cae «iniciar usa la
marca comercial como emisor» (`autorizacion-remota-guard.test.ts`).

**No verificado:** que Google o Microsoft Authenticator muestren «Vixo POS» en
un teléfono real.

### 4.48 El instalador lleva la marca «Vixo POS» y la licencia (2026-09-15)

**Qué se pidió.** Que el instalador de Windows muestre la licencia de uso, que
«Vixo POS» figure como publicador, que el acceso directo del escritorio sea
opcional y, si se podía sin riesgo, que el título del asistente diga «Vixo
POS». **`productName` («POS Jimmy Cano») no se tocó**: de él salen la carpeta
de datos y la llave de `safeStorage` (§4.23, §4.37).

Se había diseñado en una conversación y nunca se implementó: `git grep -in vixo
HEAD` no daba nada fuera de CLAUDE.md y de la constante del emisor TOTP (§4.47).

#### Cómo lo hace electron-builder, leído en la versión instalada (26.15.3)

No se decidió de memoria. Se leyeron `node_modules/app-builder-lib/out` y
`templates/nsis`:

| Pregunta | Qué dice el código | Consecuencia |
|---|---|---|
| ¿Cómo es la pantalla de licencia? | Con un `.txt` en `nsis.license`, `nsisLicense.js` inserta `!insertmacro MUI_PAGE_LICENSE` **sin** `MUI_LICENSEPAGE_CHECKBOX` | Es la página clásica: el texto y el botón **«Acepto»**. No hay casilla. Sin pulsarlo no se avanza; la otra salida es «Cancelar» |
| ¿Qué dice el botón? | `SpanishInternational.nlf` del NSIS 3.0.4.1 en caché: `^AgreeBtn` = `&Acepto`; `MUI_INNERTEXT_LICENSE_BOTTOM` = «Si acepta todas las condiciones del acuerdo, seleccione Acepto para continuar…» | Coincide con «Al hacer clic en "Acepto"» del texto |
| ¿Qué idioma usa? | Sin `installerLanguages`, `LangConfigurator` carga TODOS y NSIS elige el de Windows | En un Windows en inglés diría «I Agree». Se fijó `installerLanguages: [es_ES]` |
| ¿La licencia nombrada lleva BOM? | `convertFileToUtf8WithBOMSync` se aplica solo a las localizadas (`license_xx`) | Se escribió el BOM en el archivo. **Sin BOM también salió bien** (falsificado abajo): no está medido que haga falta |
| ¿Hay casilla para el acceso directo? | No. `createDesktopShortcut` es `true`/`false`/`"always"`, sin página | Página propia con `customPageAfterChangeDir` (`assistedInstaller.nsh`) |
| ¿Por qué no `createDesktopShortcut: false`? | Con `false` se define `DO_NOT_CREATE_DESKTOP_SHORTCUT`, y `uninstaller.nsh` deja de borrar el acceso directo | Queda en `true`; `customInstall`, que corre DESPUÉS de `addDesktopLink`, lo quita si la persona desmarcó |
| ¿De dónde sale el publicador? | `appInfo.companyName` = `metadata.author.name`; va a `CompanyName` del `.exe` (`winPackager.js`), del instalador (`computeVersionKey`) y a `Publisher` del registro (`installer.nsh`) | `extraMetadata.author: {name: Vixo POS}`, solo en el paquete |
| ¿`author` cambia algo de identidad? | La carpeta de instalación sale de `productFilename`; la clave de desinstalación, del GUID de `appId`; `app.getName()`, de `productName` | No. Una versión con este cambio actualiza la instalación anterior |
| ¿Cómo se cambia el título? | `common.nsh` fija `Name "${PRODUCT_NAME}"` y `BrandingText`, pero no `Caption`; el empaquetado corre con `-WX` | `Caption` en el script propio, dentro de `!ifndef BUILD_UNINSTALLER` |

#### Los archivos

| Archivo | Qué es |
|---|---|
| `build/licencia.txt` | El texto aprobado, en UTF-8 con BOM y CRLF. 1901 bytes |
| `build/instalador.nsh` | `Caption "Instalación de Vixo POS"`, la página con la casilla y `customInstall` |
| `electron-builder.yml` | `copyright`, `extraMetadata.author`, `nsis.license`, `nsis.include`, `installerLanguages`, `language: '3082'` |
| `src/main/__tests__/instalador-marca-y-licencia.test.ts` | 17 pruebas (la 17.ª, desde la corrección de abajo) |

**Las pantallas del asistente, en orden** (leído de `assistedInstaller.nsh` con
esta configuración): (1) **Acuerdo de licencia**, con «Acepto»; (2)
**Carpeta de destino**; (3) **Acceso directo**, con la casilla «Crear un
acceso directo en el escritorio», marcada; (4) instalación; (5) fin, con la
casilla de abrir el programa. No hay página de bienvenida ni de modo de
instalación (`perMachine`). En silencioso (`/S`) no hay páginas y el acceso
directo se crea, como antes.

**Lo que sigue diciendo «POS Jimmy Cano»**, porque sale de `productName`,
`shortcutName` o `uninstallDisplayName`:

- los accesos directos del escritorio y del menú Inicio;
- el ejecutable;
- «Programas y características»;
- el texto al pie del asistente (`BrandingText`, «POS Jimmy Cano 1.0.0»);
- los textos de las páginas: por ejemplo, «Por favor revise el acuerdo de
  licencia antes de instalar POS Jimmy Cano» (`$(^NameDA)`);
- la ventana del desinstalador: «Desinstalación de POS Jimmy Cano».

Solo la barra de título del instalador dice «Instalación de Vixo POS».

#### Verificado inspeccionando el paquete armado (macOS)

Se armó en el scratchpad (`-c.directories.output=`) para no pisar
`release/1.0.0`. Empaquetado con `-WX`: salida 0. Las lecturas se hicieron con
`@electron/asar`, `resedit` (el mismo que usa electron-builder para escribir
las propiedades) y un lector propio del header NSIS (zlib, no sólido). El
«ANTES» es el instalador de `release/1.0.0` (2026-09-14):

```
DESPUÉS package.json DENTRO del asar: {"name":"pos-agricola","productName":"POS Jimmy Cano","author":{"name":"Vixo POS"},"version":"1.0.0"}
DESPUÉS POS Jimmy Cano.exe [lang=1033]: {"CompanyName":"Vixo POS","FileDescription":"POS Jimmy Cano","InternalName":"POS Jimmy Cano","LegalCopyright":"Copyright (c) 2026 Julio Orellana (Vixo POS)","ProductName":"POS Jimmy Cano",…}
DESPUÉS POS-Jimmy-Cano-Setup-1.0.0.exe [lang=3082]: {"CompanyName":"Vixo POS",…,"LegalCopyright":"Copyright (c) 2026 Julio Orellana (Vixo POS)","ProductName":"POS Jimmy Cano",…}
ANTES   package.json DENTRO del asar: {"name":"pos-agricola","productName":"POS Jimmy Cano","author":"Julio Orellana","version":"1.0.0"}
ANTES   POS Jimmy Cano.exe [lang=1033]: {"CompanyName":"Julio Orellana",…,"LegalCopyright":"Copyright (c) 2026 Julio Orellana","ProductName":"POS Jimmy Cano",…}

header del instalador (UTF-16LE), cadenas encontradas:
"Publisher"  "Vixo POS"
"Instalación de Vixo POS"
"&Acepto"
"Acuerdo de licencia"
"Si acepta todas las condiciones del acuerdo, seleccione Acepto para continuar. Debe aceptar el acuerdo para instalar <1>胑."
"Crear un acceso directo en el escritorio"
"<2>ᤐ\\POS Jimmy Cano.lnk"
desinstalador incluido: "Desinstalación de <1>肂"   (sin «Vixo POS»: la guarda funcionó)
control, instalador 1.0.0: «CONTRATO DE LICENCIA…», «Instalación de Vixo POS», «Crear un acceso directo…», «Vixo POS» -> NO APARECE

licencia dentro del header:
prefijo del bloque: 0x0011
caracteres extraídos: 1875 | esperados (archivo sin BOM): 1875
IDÉNTICO al archivo, carácter por carácter: True
sha256 del texto extraído (LF): 8c6bf039d701e96bc141c4b01beab29c798753d6d736d2b306b00043add1daff
menciona penalidad/multa/indemnización? False
```

`0x0011` se interpreta como `SF_TEXT | SF_UNICODE` de RichEdit. Es inferencia
por los valores de esas constantes, no está documentado en NSIS.

`verify:paquete` (como `afterPack` y a mano): 751 entradas, 0 hallazgos, salida
0, «APUNTA A: ztidrshifrblhfraiowg (proyecto de pruebas)».

**Revisión adicional, fuera de lo que mira `verify:paquete`.** Esa revisión
lee el asar, no `app.asar.unpacked`. En el `app-64.7z` del instalador, la
búsqueda de `.env`, `/src/` y `nube-pruebas|nube-real` encontró 25 rutas. Todas
son `resources/app.asar.unpacked/node_modules/better-sqlite3/src/…`: los
fuentes C++ públicos de la librería (npm), que viajan porque `asarUnpack`
desempaqueta el módulo entero. No hay credenciales ni código del proyecto. La
lista es **idéntica** en el instalador 1.0.0 (`diff` vacío): no la introdujo
este cambio.

#### Falsificado

| Mutación | Qué cayó |
|---|---|
| `productName` arriba → «Vixo POS» | «productName sigue siendo «POS Jimmy Cano»…» (`expected 'Vixo POS' to be 'POS Jimmy Cano'`) |
| `extraMetadata.productName` → «Vixo POS» | la misma |
| `author` del paquete → «Vixo POS S.A.» | «el publicador del paquete es la misma marca que el emisor del código remoto» |
| Agregar una penalidad a la licencia | la huella y «NO lleva la cláusula de penalidad» |
| Un espacio de más en la licencia | la huella |
| Licencia sin BOM | «UTF-8 con BOM y con CRLF» |
| Redefinir `Name` en el `.nsh` | «no redefine Name ni ningún identificador…» |
| Quitar siempre el acceso directo | «se quita SOLO si la persona desmarcó la casilla» |
| Quitar `installerLanguages` | «…el instalador solo carga el español…» |

La primera corrida de la mutación de `productName` **no se aplicó**: el
reemplazo no encontró el texto porque ahora hay un comentario en el medio.
Pasaron 16 de 16 sobre un archivo sin cambios. Se repitió comprobando que el
archivo cambió, y cayó.

**La razón del BOM NO se sostuvo midiendo.** Armado sin BOM, el texto llegó al
header igual, con sus tildes (`'Implementación: POS Jimmy Cano\nVersión:
1.1.0'`). El BOM se deja porque es la forma que electron-builder usa para sus
propias licencias, así no depende de la detección del `makensis` de la máquina
que arme. El comentario de `electron-builder.yml` lo dice así.

#### Dos correcciones del mismo día, pedidas por Julio

| Qué | Antes | Después |
|---|---|---|
| Frase de la licencia | «se le entrega a el/la LICENCIATARIO/A» | «se le entrega al/a la LICENCIATARIO/A». Nada más del texto cambió: 4 bytes distintos, mismo largo (1901 bytes), BOM y 39 CRLF intactos |
| Huella del texto (sin BOM, LF) | `8c6bf039…1daff` | `bd9897f4…bbaa7` |
| `package.json` y `package-lock.json` | 1.0.0 | **1.1.0**, la versión del próximo release, que es la que nombra la licencia |

La salida cruda de §4.48 de arriba (los 1875 caracteres idénticos y la huella
`8c6bf039…`) es del instalador armado **antes** de la corrección. El
instalador no se volvió a armar con el texto corregido: eso lo hace el prompt de
los builds de release.

Con el texto cambiado cayó exactamente la prueba de la huella
(`expected 'bd9897f4c73cd8ad39e0ce69effb8cc8a5e10…' to be '8c6bf039d701e96bc141c4b01beab29c79875…'`)
antes de actualizarla. Se agregó además «la versión que dice la licencia es la
del package.json». Falsificada con `package.json` en 1.1.1, cayó con
`expected '1.1.0' to be '1.1.1'`.

#### Lo que NO se verificó, y solo se ve instalando en Windows

- **Que la página de licencia se vea bien**: el control RichEdit, los CRLF, las
  tildes en pantalla y el desplazamiento. Lo medido es que el texto viaja
  idéntico dentro del instalador.
- **Que «Acepto» sea obligatorio en la práctica.** Es el comportamiento de
  `MUI_PAGE_LICENSE` y no se ejecutó.
- **La página de la casilla**: su diseño con nsDialogs, que desmarcada quite
  el acceso directo y que volver atrás conserve la elección.
- **Que «Programas y características» muestre «Vixo POS» como editor** y las
  propiedades del `.exe` en el Explorador. Lo medido son los recursos y la
  cadena `Publisher` del script.
- **Actualizar sobre la instalación 1.0.0 de Jimmy**: que no quede duplicada y
  que la carpeta de datos y la credencial sigan legibles. Por lo leído debería
  pasar (misma `appId`, mismo `productName`), pero no se midió.
- **Windows SmartScreen** con el publicador nuevo: el instalador sigue sin
  firmar, así que Windows no muestra «Vixo POS» como editor verificado.

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
| **El PIN se guarda con scrypt, no con SHA-256 ni en claro.** Formato: `scrypt$<versión>$<N>$<r>$<p>$<sal-base64>$<clave-base64>` en el campo `pin_hash`. | SHA-256 simple; bcrypt o argon2 con dependencia externa; columnas separadas para sal y hash; JSON | Un PIN de cuatro dígitos tiene 10 000 valores: con SHA-256 se recorren todos en una fracción de segundo, así que quien se lleve el archivo .db saca todos los PIN de la tienda al abrirlo. scrypt está diseñado para ser lento y exigir memoria, y viene en `node:crypto` sin agregar dependencias. El formato de una sola cadena mantiene la sal pegada a su hash (imposible cruzarlas entre usuarios), lleva los parámetros adentro (endurecer el costo mañana no obliga a migrar datos) y lleva algoritmo y versión adelante (cambiar de algoritmo es reconocer el prefijo). | Prompt 10 — 2026-09-06 |
| **Sal aleatoria distinta por usuario, dentro del mismo campo `pin_hash`.** | Una sal global; sin sal | Con sal por usuario, dos personas con el mismo PIN tienen hashes distintos: nadie deduce mirando la tabla que lo comparten, y las tablas precalculadas no sirven. | Prompt 10 — 2026-09-06 |
| **El bloqueo por intentos es POR USUARIO y se persiste en la base** (`intentos_fallidos`, `bloqueado_hasta`), no en memoria. | Contador en memoria, como el provisional de la salida controlada | Un contador en memoria se reinicia cerrando y volviendo a abrir la aplicación, que es justo lo que haría alguien adivinando un PIN. En la base sobrevive al reinicio. | Prompt 10 — 2026-09-06 |
| **RESUELTO: las tres rutas de salida controlada verifican contra usuarios reales, con UNA sola función.** Se elimina `POS_PIN_ADMINISTRADOR` y su valor de desarrollo. | Mantener el PIN de entorno; una verificación por ruta | El PIN de entorno no sabía QUIÉN autorizaba, y tres implementaciones paralelas se desincronizan. Ahora el atajo, la intercepción de `Cmd+Q`/`Alt+F4` y el botón llaman los tres a `solicitarPin(ventana, origen)` y a `confirmarSalida(pin)`, que invoca una única vez `autorizarComoAdministrador`. La auditoría registra el `usuario_id` real y **un solo nombre de acción** para las tres, con el origen como dato del asiento. | Prompt 10 — 2026-09-06 |
| **La sesión vive en memoria y no se persiste.** | Recordar la sesión entre arranques | Es una terminal compartida: si la sesión sobreviviera al reinicio, el primero que encienda la máquina por la mañana actuaría con la identidad de quien la apagó anoche y la auditoría le atribuiría sus ventas a otra persona. | Prompt 10 — 2026-09-06 |
| **Los permisos se comprueban con un guard que envuelve la operación** (`requiereRol`), nunca con un `if` dentro de cada manejador. | Comprobar el rol a mano en cada canal | Envuelto, es imposible olvidarlo o escribirlo distinto en cada módulo, y la operación protegida no llega a ejecutarse. Suelto, basta que un módulo futuro se distraiga. | Prompt 10 — 2026-09-06 |
| **Dos modos de capturar efectivo, mutuamente excluyentes por construcción.** En modo detallado el sistema suma; nunca se pide además el total. | Pedir siempre el total; pedir el total y el desglose y compararlos | Si se piden las dos cosas, tarde o temprano no coinciden y hay que decidir a cuál creerle, con un cliente esperando. El tipo es una unión discriminada, así que un valor con los dos modos a la vez no se puede ni construir: no es una validación que se pueda olvidar. | Prompt 13 — 2026-09-06 |
| **PIN de autorización remota separado del PIN normal**, en la columna `pin_remoto_hash`. **Su alcance fue AMPLIADO por decisión explícita dos veces: a `descuento_excedente` el 2026-09-11 y a `salida_controlada` el 2026-09-15 — ver las filas de cada ampliación. NO revertida: la separación de los dos PIN sigue igual.** | Un solo PIN para todo; una contraseña aparte más larga | El PIN normal abre la sesión del administrador. Dictarlo por teléfono se lo entrega a quien escucha, para siempre y para todo. Con uno separado, lo que se cede al dictarlo es solo la capacidad de autorizar a distancia: no sirve para entrar, y la auditoría distingue `remoto` de `presencial`. El sistema deduce cuál se usó según cuál hash coincidió, sin preguntarle al cajero. Se rechaza configurarlo igual al PIN normal, porque eso anularía toda la separación. **Solo vale en el cierre con diferencia, no en la salida controlada**, y la razón es de alcance, no física: el PIN remoto se pidió para autorizar diferencias de caja y nada más, así que dárselo a otra acción sería ampliarlo más allá de lo pedido. Cada superficie nueva se decide aparte. | Prompt 13 — 2026-09-06; alcance corregido en Prompt 14 — 2026-09-06 |
| **El candado por superficie se reutiliza, no se duplica**, para `cierre_con_diferencia`. | Un limitador nuevo para el cierre; compartir el de la salida controlada | El mecanismo ya era genérico salvo por el tipo de la superficie; se amplió el `CHECK` y el tipo, y se le pasa la superficie por parámetro. Cada superficie mantiene su propio contador, así que un error al autorizar un descuadre no bloquea la salida de la aplicación ni el login de nadie. | Prompt 13 — 2026-09-06 |
| ~~**`monto_esperado` es hoy el monto inicial, con un TODO explícito.**~~ **RESUELTA en el Prompt 19:** ver la fila de la fórmula definitiva. | Inventar una suma de ventas parcial para que "quede completo" | Todavía no existe el módulo de ventas. Una lógica de ventas a medias, escrita para rellenar un hueco, quedaría enterrada y nadie la encontraría al construir el módulo real. Queda marcado en el código y en la sección 4.10, y hay una prueba que documenta el comportamiento actual para que cambiarlo obligue a tocar ambos. | Prompt 13 — 2026-09-06 |
| **El ajuste de inventario es una ACCIÓN PROPIA, no un campo de «editar producto».** Canal IPC propio, botón propio y nombre de acción propio en la auditoría (`inventario_ajustado`). El tipo `CambiosDeProducto` ni siquiera incluye el saldo. | Un campo más en el formulario de edición; un campo editable en la lista | Recibir mercadería y corregir el catálogo son **hechos distintos del negocio**. Si compartieran operación, cambiar el inventario quedaría registrado como «producto editado» y no se podría auditar cuánta mercadería entró sin abrir y leer el contenido de cada asiento; peor, se podría mover el saldo «de paso» al corregir un precio, sin que quedara constancia de que entró nada. Separadas, el asiento guarda saldo anterior, saldo nuevo, cantidad agregada y motivo. La operación **solo suma**: las mermas y pérdidas son un módulo futuro con sus propias reglas de autorización, y dejar que esta aceptara negativos convertiría la recepción de mercadería en una vía para bajar inventario sin controles. | Prompt 15 — 2026-09-07 |
| **NO se restringe cambiar `tipo_medida` después de creado un producto.** | Bloquear el cambio y obligar a crear un producto nuevo; permitirlo solo si el producto nunca se vendió | El motivo por el que se bloquearía —«corrompe las ventas pasadas»— **no aplica en este esquema**: `venta_detalle` guarda una foto del nombre, la unidad y el precio al momento de cada venta, así que un cambio de hoy no altera un solo comprobante de ayer. Sin ese riesgo, prohibirlo solo tendría costos: un error de carga —marcar «por unidad» algo que se vende por libra— obligaría a crear un producto nuevo y a arrastrar un duplicado inútil en el catálogo para siempre. La coherencia entre `tipo_medida` y `unidad_peso` sí se sigue exigiendo en cada cambio, en las tres capas. | Prompt 15 — 2026-09-07 |
| **`categorias` recibe `activo`; ninguna categoría ni producto se borra jamás.** | Borrar la categoría cuando ya no se usa; dejar `categorias` sin baja lógica | Sin `activo` no había forma de retirar una categoría de las opciones sin borrarla, y borrarla es imposible en cuanto tenga un producto: `productos.categoria_id` la referencia con ON DELETE RESTRICT. Desactivar resuelve el caso real sin tocar nada más. Se acota a propósito qué significa: **solo** deja de ofrecerse al crear o editar un producto; no desactiva sus productos, no los mueve y no los saca de la venta, porque eso retiraría mercadería del mostrador sin que nadie lo pidiera. | Prompt 15 — 2026-09-07 |
| **La foto de producto se valida por su FIRMA BINARIA, no solo por la extensión**, y se copia a `userData` con nombre UUID; en la base va la ruta relativa. | Confiar en la extensión y en el filtro del diálogo nativo; guardar la ruta absoluta; conservar el nombre original | Renombrar un archivo es gratis: un ejecutable llamado `foto.png` pasa cualquier comprobación de extensión, y el filtro del diálogo nativo se puede esquivar escribiendo el nombre a mano. Los primeros bytes sí dicen qué es el archivo de verdad. La ruta absoluta rompería un respaldo restaurado en otra computadora, y conservar el nombre original haría que dos fotos llamadas `foto.jpg` se pisaran entre productos. La ventana las ve por el esquema propio `pos-foto:` y no por `file:`, que le daría acceso a todo el disco. | Prompt 15 — 2026-09-07 |
| **Los datos de ejemplo NO pasan por el sistema de migraciones**, se marcan con el prefijo `[Ejemplo] ` en el nombre y su limpieza SÍ borra físicamente. | Sembrarlos en una migración; marcarlos con una columna `es_de_ejemplo`; darlos de baja lógica al limpiar | Una migración es historial permanente: se aplica una vez y no se deshace, así que un catálogo inventado quedaría en la base de la tienda para siempre y quitarlo exigiría otra migración. Una columna sería esquema permanente para un problema temporal —habría que espejarla en Postgres y quitarla después—, mientras que el prefijo **se ve** en pantalla y avisa solo. Y la baja lógica no serviría: el nombre seguiría ocupado por el UNIQUE y el «Maíz blanco» real de Jimmy chocaría con el de mentira. Es la única excepción a «nunca borrar», y se sostiene porque estos registros no tienen historial que proteger; si alguno llegara a tener ventas, no se borra nada. | Prompt 15 — 2026-09-07 |
| **Un `ErrorDeNegocio` cruza el puente IPC con SU código y SU mensaje**, no envuelto en un genérico. | Devolver siempre «La operación no pudo completarse» y dejar el detalle en la bitácora | Los mensajes de negocio están escritos para que los lea una persona frente a la pantalla —«El precio no puede ser negativo»— y esconderlos detrás de un genérico deja a quien carga el catálogo sin saber qué corregir. Era además lo que §4.7 ya decía que pasaba («el mensaje llega a la interfaz ya traducido») y no era cierto. Cualquier otro error sí se generaliza: un fallo inesperado no debe filtrar detalles internos a la ventana. El envoltorio vive en un solo lugar, `src/main/ipc/respuesta.ts`, para que ningún módulo tenga su propia variante. | Prompt 15 — 2026-09-07 |
| **`playwright-core` como devDependency, en modo Electron, para `npm run verify:pantallas`.** | No verificar la interfaz automáticamente y confiar en pruebas manuales; usar el paquete `playwright` completo; escribir un arnés propio sobre el protocolo de depuración de Chrome | Hay defectos que ninguna prueba de Vitest puede ver: si el mensaje correcto LLEGA a la ventana y si quedó dentro de la parte visible. Los dos que se encontraron eran de esa clase y aparecieron a mano. Se eligió `playwright-core` y no `playwright` porque el primero **no tiene guiones de instalación ni dependencias** y por lo tanto no descarga navegadores —medido: tras instalarlo y usarlo no existe ninguna carpeta `ms-playwright`—, y su modo `_electron` maneja el binario de Electron que el proyecto ya tiene. **No viaja en el instalador de Jimmy**, comprobado empaquetando: `electron-builder` reescribe el `package.json` que va dentro del asar dejando solo `dependencies`, y una búsqueda de «playwright» en los 935 archivos del paquete y en todo el `.app` no devuelve nada. | Prompt 16 — 2026-09-08 |
| **Los mensajes al usuario no inventan razones de negocio.** «El precio no puede ser negativo», no «…Se permite 0, para muestras y regalos». | Explicar en el mensaje para qué sirve cada regla | Que un precio 0 se acepte es una decisión técnica del esquema; PARA QUÉ le sirve a la tienda es una definición de negocio que Jimmy no confirmó. Un mensaje que se la atribuya convierte una suposición nuestra en algo que parece decidido por él, y eso es exactamente lo que este proyecto no puede hacer: el resto de la documentación distingue con cuidado lo confirmado de lo supuesto. La regla vale para todo texto que vea una persona. | Prompt 16 — 2026-09-08 |
| **`configuracion_negocio` es una tabla de FILA ÚNICA con `id = 'unica'`, y rompe a propósito la regla de UUID en el cliente.** Sus cuatro campos son nulables. | Un UUID como el resto de las tablas; guardar los datos en un archivo de configuración; exigir los cuatro campos | La regla de UUID existe porque dos filas creadas sin internet en máquinas distintas colisionarían al subir, y acá la colisión es justamente lo que se busca: la configuración del negocio es UNA, y si dos terminales la editan tienen que estar hablando de la misma fila. Un archivo no serviría porque esto SÍ es dato de negocio —sale impreso en un documento que se le entrega al cliente— y por lo tanto se espeja en Postgres. Y los cuatro son nulables porque los datos reales de Jimmy todavía no llegaron: obligar a llenarlos impediría cargar lo que sí se sabe. `NULL` es «sin configurar» y el esquema prohíbe la cadena vacía, para que no haya dos formas de estar vacío. Queda anotado que con multi-sucursal esta tabla necesitaría una fila por sucursal (§6.2, punto 10). | Prompt 23 — 2026-09-11 |
| **Lo que falta configurar sale en el recibo como un marcador ENTRE CORCHETES, nunca en blanco ni con un valor de ejemplo.** | Dejar el renglón vacío; poner un nombre de ejemplo; impedir vender hasta configurar | Un renglón en blanco o un nombre inventado harían que un recibo sin configurar pasara por uno configurado, y el comprobante es lo único que se lleva el cliente. Entre corchetes, quien lo mire sabe de inmediato que falta cargar el dato. Impedir vender era la otra opción y es peor: dejaría la tienda sin poder cobrar por un dato administrativo que se puede cargar después. Es la misma regla que ya rige para los mensajes: no se inventan datos que parezcan confirmados por Jimmy. | Prompt 23 — 2026-09-11 |
| **El recibo NO recalcula nada: muestra lo guardado. La única cifra derivada es la rebaja, y sale de `subtotal − total`.** | Recalcular el subtotal de cada línea; reaplicar el porcentaje de descuento sobre el subtotal | Todo el cálculo ocurrió una vez, en la transacción de la venta. Si el recibo recalculara, bastaría que una regla cambiara el año que viene para que reimprimir un comprobante viejo diera otro número, y un documento histórico que cambia retroactivamente es lo que una auditoría no tolera. La rebaja se deriva de una resta entre dos valores guardados en vez de reaplicar el porcentaje porque con otro modo de redondeo el porcentaje daría un centavo distinto del que el cliente pagó; la resta no puede discrepar con lo cobrado. | Prompt 23 — 2026-09-11 |
| **CORREGIDO: el recibo no imprime «Subtotal / Descuento / Total». Las líneas suman el TOTAL y el descuento se informa.** | Dejar el bloque de resta como estaba; mostrar en cada línea su importe antes del descuento | Se descubrió manejando la aplicación real. `subtotal_impreso` es la parte que le toca a cada línea **del total ya descontado** —eso es lo que garantiza «el total manda» del §5—, así que las líneas NO suman el subtotal: el papel decía «Subtotal 21.75» encima de importes que sumaban 20.12 y no había forma de cuadrarlo. Mostrar en cada línea el importe previo al descuento tampoco servía: obligaría a recalcular, y las líneas dejarían de sumar lo que el cliente paga. La salida correcta con estos datos es que las líneas sumen el TOTAL y el descuento se informe como dato de la venta, con su monto y su autorizante, bajo la aclaración «Los importes ya incluyen el descuento». Hay una prueba que suma las líneas y exige que den el total. **El renglón individual todavía no multiplicaba; eso lo cierra la fila siguiente, del Prompt 24, que además le corrigió el texto a la aclaración.** | Prompt 23 — 2026-09-11 |
| **CON DESCUENTO, la columna de precio unitario del recibo imprime el precio EFECTIVO (`subtotal_impreso ÷ cantidad`), no `precio_unitario_snap`. Es presentación: no cambia nada de lo que se guarda.** Sin descuento se sigue imprimiendo el precio de lista tal cual. | Dejar el precio de lista y confiar en la aclaración; imprimir el importe previo al descuento en cada línea; guardar el precio efectivo en `venta_detalle` | Completa la corrección del Prompt 23. Las líneas ya sumaban el total, pero **cada renglón por separado seguía sin multiplicar**: al lado de un importe ya descontado salía el precio de lista, y el papel decía «0.333 lb x 6.69» junto a «2.06». Un recibo que el cliente no puede verificar de cabeza obliga a creerle al sistema, que es lo contrario de lo que un comprobante existe para hacer. Imprimir el importe previo al descuento en cada línea era la otra salida y ya estaba descartada: obligaría a recalcular y las líneas dejarían de sumar lo que el cliente paga. **Guardarlo tampoco**: `precio_unitario_snap` es la foto de lo que el producto COSTABA, un dato del negocio, y pisarlo con un número de presentación destruiría la trazabilidad del cálculo a cambio de nada. Sin descuento no se calcula nada, porque ahí `cantidad × precio` ya da el importe. **La derivación va en un solo sentido:** el precio sale del importe, nunca al revés, o se perdería «el total manda». El costo aceptado es un margen de **medio centavo por unidad** —Q0.50 en 100 libras—, inevitable al imprimir un unitario de dos decimales y mucho menor que la diferencia anterior; dos pruebas lo fijan como cota, una con 100 libras a propósito. | Prompt 24 — 2026-09-11 |
| **La aclaración del recibo SE CONSERVA, con el texto corregido a «Precios e importes ya incluyen el descuento».** | Quitarla ahora que la aritmética se explica sola; dejarle el texto viejo | Con el precio efectivo, el renglón ya multiplica y la nota dejó de ser necesaria PARA ESO. Sigue haciendo falta por dos cosas que la multiplicación no dice: que el renglón «Descuento −1.63» es un **dato ya aplicado** y no un paso de resta sobre el TOTAL que está debajo —sin la nota, quien lea el papel lo resta otra vez y obtiene un número que no existe—, y que el precio unitario que ve **no es el precio de lista** del producto, cosa que un cliente que conoce el precio del maíz va a notar. Cuesta un renglón de papel y cierra las dos confusiones. El texto se corrigió porque ahora el precio también viene descontado, y decir solo «los importes» habría quedado incompleto justo respecto de lo que cambió. | Prompt 24 — 2026-09-11 |
| **Una reimpresión refleja SIEMPRE los datos vigentes de `configuracion_negocio`; NO se guarda un snapshot por venta.** Decidido explícitamente, no por omisión. | Congelar los cuatro campos en `ventas` al momento de vender, igual que el nombre y el precio del producto | **No son la misma clase de dato.** El nombre y el precio del producto se congelan porque son **términos de la operación** —lo que el cliente aceptó pagar—, y cambiarlos retroactivamente cambia lo acordado. El nombre, la dirección, el teléfono y el NIT dicen **quién emitió el papel**, no qué se acordó en él: heredarles la regla del producto sería copiarla sin el motivo que la justifica. Hoy el argumento apunta con fuerza en contra del snapshot: los cuatro campos están en `NULL` porque los datos de Jimmy no llegaron, así que con snapshot **los marcadores entre corchetes quedarían congelados para siempre** en todo recibo emitido antes de cargarlos, mientras que sin snapshot se reparan solos ese día. Y el dato cambia casi nunca: el NIT prácticamente no cambia y la dirección solo si la tienda se muda. **La contrapartida se dice en voz alta:** si el NIT o la razón social cambiaran por una razón legal, una reimpresión mostraría como emisor a quien no emitió, y eso sí sería un problema de auditoría; hoy está acotado porque el papel dice de frente que es proforma y no vale como factura fiscal. **Se revisa cuando se resuelva el punto 2 de §6.2** (si la tienda emite FEL/SAT) o si cambia el NIT o el nombre comercial. No se implementa ahora también porque nada lo bloquea después: serían cuatro columnas nulables llenadas en la transacción de la venta, con el recibo prefiriendo el snapshot y respaldándose en la fila vigente para las ventas viejas. | Prompt 24 — 2026-09-11 |
| **PRINCIPIO GENERAL DEL PROYECTO: ningún reporte agrega ni ordena en SQL sobre una columna decimal.** Se traen las filas con `SELECT` y se suma y se ordena en la aplicación, con `money.ts`. Vale para todo reporte presente y futuro, no solo para los de este prompt. | Usar `SUM()`/`AVG()` y `ORDER BY` de SQL, que es lo evidente y lo que escribiría cualquiera; guardar además una columna numérica paralela para poder agregar | **Son dos trampas y las dos están medidas contra el SQLite que el proyecto empaqueta.** (1) `SUM()` sobre una columna TEXT canónica la convierte a REAL —`typeof` lo confirma— y devuelve punto flotante: diez montos que suman Q13.46 exactos dan `13.459999999999999`. Con montos ya redondeados el desvío es minúsculo, pero **con valores sin redondear cambia el centavo**: cinco `subtotal_exacto` cuya suma exacta es 18.495 → **Q18.50** dan por SQL 18.494999999999997 → **Q18.49**, un centavo en contra de la tienda. Es el mismo punto flotante que `money.ts` existe para eliminar, ahora escondido dentro de un reporte que nadie audita línea por línea como sí se audita una venta. (2) **`ORDER BY` compara TEXT byte a byte**, así que `'10.000'` va antes que `'2.500'`; el reporte de inventario se ordena ascendente para ver primero lo que menos queda, y en SQL habría puesto diez libras antes que dos y media, **al revés de para lo que sirve y sin ningún síntoma visible**. `MIN()` tiene el mismo defecto. La segunda trampa no estaba anotada en ninguna parte y apareció construyendo estos reportes. Filtrar en SQL SÍ se hace: `fecha`, `estado`, `forma_pago` y `activo` son texto y enteros de verdad. `decimal-columns.ts` es una segunda red —rechaza leer un número de una columna decimal— pero no cubre el `ORDER BY`, que devuelve texto legible en el orden equivocado. En Postgres no aplica, porque `NUMERIC` es decimal exacto nativo; los reportes leen de SQLite local, así que la regla rige igual. Hay una prueba que mide las dos trampas y otra que revisa el código fuente de los repositorios y del servicio buscando agregados y ordenamientos sobre las diez columnas decimales. | Prompt 25 — 2026-09-11 |
| **«Hoy» es el día de GUATEMALA, no el de UTC, y la conversión vive en un módulo puro con pruebas.** | Comparar las cadenas ISO tal cual; escribir `date(fecha, '-6 hours')` dentro de cada consulta; leer la zona horaria del sistema operativo | `ventas.fecha` se guarda en UTC, que es lo correcto para guardar, pero Guatemala es UTC−6 **todo el año** (no usa horario de verano; medido con `Intl` en enero, julio y septiembre). Sin convertir, **todas las ventas hechas después de las 18:00 se le atribuirían al día siguiente**: en una tienda que cierra a las 19:00, el reporte de «hoy» estaría bien a media tarde y mentiría de noche, que es la peor forma de estar mal. Es el mismo peligro que §4.13 ya anotaba para la vigencia de un precio especial, resuelto de raíz en vez de quedar anotado. No se mete en la cadena SQL porque eso escondería una regla del negocio donde nadie la ve y la repetiría en cada consulta. **No se lee la zona del sistema** porque el reporte tiene que dar lo mismo en la computadora de la tienda que en la de Julio, que está en otra zona: es una constante, y si Guatemala adoptara horario de verano hay un solo lugar que tocar. El extremo `hasta` es inclusivo hasta el último milisegundo del día, para que una venta de las 23:59 entre en el reporte de ese día sin que nadie tenga que acordarse de sumar un día. Una fecha que no existe se rechaza en vez de correrse en silencio al mes siguiente, que es lo que haría `Date.UTC`. | Prompt 25 — 2026-09-11 |
| **El reporte por producto NO reusa `contador_ventas` ni `cantidad_vendida`: recorre `venta_detalle` del período.** | Leer los acumuladores del catálogo, que guardan exactamente esas dos medidas; guardar una foto de los acumuladores al inicio de cada período | Las dos columnas guardan las mismas dos medidas pero de **toda la vida del producto**, y **no se pueden acotar**: nadie guardó su valor al empezar el período. Existen para ordenar la cuadrícula de la pantalla de venta (§4.12) y ese destino no cambia. Usarlas en un reporte daría el acumulado histórico bajo una etiqueta que dice «este mes», que es la clase de error que no se ve mirando el número: se ve recién cuando alguien suma doce reportes mensuales y no dan el año. Guardar una foto periódica sería inventar un mecanismo nuevo para un dato que ya está entero en `venta_detalle`, donde cada línea tiene su venta y su fecha. Comparten los datos de origen; no son la misma pregunta. Se agrupa por `producto_id` y se muestra el nombre ACTUAL del catálogo —al revés que el recibo, que es un documento histórico y usa el snapshot— porque quien lee un reporte mira el catálogo de hoy; agrupar por id hace que renombrar nunca parta un producto en dos filas. | Prompt 25 — 2026-09-11 |
| **Los descuentos del resumen se INFORMAN, no se restan del total vendido.** | Restarlos del total; no mostrarlos | `ventas.total` ya viene con el descuento aplicado: lo aplicó la transacción de la venta, una sola vez, y es lo que el cliente pagó. Restarlo otra vez lo contaría dos veces y daría un número que nunca existió. El renglón contesta otra pregunta —cuánto se dejó de cobrar— y por eso la pantalla lo separa y lo aclara, con el mismo criterio con que el recibo aclara que sus importes ya vienen descontados (§4.14). **Queda anotada una salvedad de lectura:** se suma `descuento_valor`, que guarda el valor CONFIGURADO y no los quetzales rebajados, así que un 7.5 % suma 7.50 aunque haya rebajado Q1.35. Se informa tal cual porque es lo que se pidió; si hiciera falta la rebaja real en quetzales se deriva de `subtotal − total`, como hace el recibo. | Prompt 25 — 2026-09-11 |
| **Los topes de descuento se configuran desde una pantalla, y el guion `seed:limites` deja de ser la única puerta.** Al guardar se llena `editado_por` con el usuario real y queda un asiento en `auditoria_log`. | Dejar solo el guion; llenar `editado_por` también en el guion, con un usuario cualquiera | El guion es de desarrollo, con valores fijos en el código y corrido desde una terminal: mientras fuera la única puerta, Jimmy no podía cambiar el tope de su cajero sin que alguien le tocara la computadora, y eso deja incompleto un mecanismo —el tope por rol— que el sistema ya aplicaba en cada venta. Las filas sembradas por el guion siguen con `editado_por = NULL` **a propósito**: no hay ninguna persona detrás, y ponerle un usuario inventado sería atribuirle a alguien una decisión que no tomó. Se guardan los DOS registros porque contestan preguntas distintas: la columna dice quién lo dejó así hoy, la bitácora dice quién lo cambió, cuándo y desde qué valor. La primera vez el valor anterior del asiento va `null` y no cero, porque «antes era 0.00» afirmaría que alguien lo configuró en cero y no es lo mismo que no haberlo configurado. El guion sobrevive para montar entornos de desarrollo nuevos. | Prompt 25 — 2026-09-11 |
| **Un porcentaje de tope mayor que 100 se ACEPTA; la pantalla avisa sin bloquear.** | Rechazarlo con un error; aceptarlo en silencio | Rechazarlo sería inventar una regla de negocio que Jimmy no confirmó, y este proyecto no atribuye definiciones al cliente (ver la fila de los mensajes que no inventan razones). Tampoco es peligroso: `totalConDescuento` tiene piso en cero, así que 150 % no autoriza nada que 100 % no autorice ya. Pero sí es un valor inútil y un tecleo plausible —confundir el campo del porcentaje con el de quetzales—, así que callarlo tampoco sirve. Avisar sin bloquear es la misma salida que ya se eligió para el aviso de inventario de la pantalla de venta (§4.12): informar sin estorbar. Queda abierto como el punto 17 de §6.2 para que lo decida Jimmy. | Prompt 25 — 2026-09-11 |
| **CORREGIDO: un rechazo en la pantalla de topes vuelve al paso de edición, no se queda en la confirmación.** | Quedarse en la confirmación mostrando el error ahí | Lo encontró `npm run verify:pantallas` manejando la aplicación real, no una prueba de Vitest. Quedándose en la confirmación, los campos seguían visibles y editables pero **el botón «Guardar» no existe en ese estado** —ahí el botón dice «Sí, guardar este tope»—, así que quien corrigiera el número se quedaba mirando una confirmación que seguía repitiendo el valor rechazado. Volver a la edición deja el aviso junto al botón que lo produjo, que es la regla de §4.11, y pone el foco donde está el problema. Es la tercera vez que esta comprobación atrapa un defecto que ninguna prueba de Vitest podía ver. **La cuarta llegó en la fase 3.a** (§4.23). | Prompt 25 — 2026-09-11 |
| **CORREGIDO: toda clase que le cambie el fondo a un `<button>` tiene que fijar también su `color`.** | Dejar que herede el color de la regla base de `button` | Encontrado mirando la pantalla real de reportes. La regla base de `button` usa `color: #052e16`, un verde casi negro pensado para leerse **sobre el fondo de acento**. `.opcion` cambiaba el fondo a oscuro pero no el color, así que el selector de período salió con texto verde oscuro sobre fondo oscuro: prácticamente invisible. Nunca se había notado porque hasta ahora `.opcion` solo se usaba sobre `<label>`, que hereda el color del cuerpo. Es el mismo tipo de defecto que ninguna prueba de Vitest puede ver, igual que el aviso que quedaba fuera de la pantalla (§4.11). La opción activa además se distingue por COLOR y no solo por el peso de la letra: el grosor de la tipografía es una diferencia difícil de ver de reojo en un mostrador. | Prompt 25 — 2026-09-11 |
| **La pantalla de topes distingue TRES estados, no dos: sin configurar, sembrado por el guion, y editado por una persona.** | Dos estados, deduciendo todo de `editado_por === null` | «Sin fila» y «fila sembrada por el guion» comparten `editado_por = NULL` y no significan lo mismo. La primera versión le decía «sembrado por el guion de desarrollo» a un rol que nunca se había configurado, o sea afirmaba que alguien corrió algo que nadie corrió: exactamente la clase de dato inventado que este proyecto no se permite. Por eso el DTO lleva `configurado` como un campo aparte y no se deduce del autor. Se vio mirando la pantalla real. | Prompt 25 — 2026-09-11 |
| **`cantidadLegible` se mueve de `modelo-de-recibo.ts` a `@shared/money`, compartida por el recibo y los reportes.** | Dejar la del recibo donde estaba y escribir otra para el reporte | El reporte por producto mostraba «2.000 u» donde el recibo ya mostraba «2», y se vio manejando la aplicación real. Dos implementaciones de «cómo se escribe una cantidad» terminan mostrando el mismo número de dos formas distintas en el mismo sistema, que es el argumento por el que `colision-de-pin.ts` también vive en su propio módulo. Es SOLO presentación: lo que se guarda y lo que se compara sigue siendo la forma canónica de tres decimales. | Prompt 25 — 2026-09-11 |
| **El PDF sale de `printToPDF` de Chromium, no de una librería de PDF.** | `pdfkit`, `jsPDF` u otra librería; generar el recibo como imagen | Electron ya empaqueta Chromium: sumar una librería sería agregar una dependencia y un segundo motor de maquetación para hacer lo mismo. Y maquetar con HTML y CSS deja el recibo legible y ajustable por alguien que no sea programador, mientras que una librería de PDF lo convierte en coordenadas. El HTML se carga por `data:` y no escribiendo un archivo temporal, para que no quede un HTML con los datos de una venta dando vueltas en el disco. La ventana va invisible, sin Node y sin preload: el recibo es contenido, no código. | Prompt 23 — 2026-09-11 |
| **El recibo se emite DESPUÉS de la transacción de la venta, nunca adentro.** | Emitirlo dentro de la misma transacción, para que venta y recibo sean atómicos | Generar un PDF abre una ventana de Chromium e imprimir habla con un puerto: las dos cosas son lentas y fallan por motivos ajenos a la venta. Adentro, mantendrían abierta una escritura de SQLite esperando a un aparato, y una impresora sin papel revertiría una venta ya cobrada. La consecuencia se asume y se dice en voz alta: si la aplicación se cae entre la venta y el recibo, queda una venta sin recibo, que es recuperable desde el historial e infinitamente preferible a perder la venta. | Prompt 23 — 2026-09-11 |
| **ESC/POS implementado contra el estándar más común, con la conversión a bytes como función PURA y sin dependencias nativas nuevas.** | Una librería `escpos`/`node-usb`; esperar a tener la impresora para escribir el adaptador; imprimir con el controlador del sistema | El modelo real de Jimmy llega el jueves y no está confirmado, así que se usaron solo los comandos del núcleo del estándar —inicializar, página de códigos, avanzar, corte parcial— y se evitaron los de código de barras, imagen y cajón de dinero, que es donde los fabricantes se apartan. Una librería USB obligaría a recompilar otro módulo nativo para Electron y para Windows para hacer exactamente lo que hace `node:fs`: escribir bytes en un descriptor. Dejar la parte con sustancia como función pura permite probarla byte por byte sin el aparato, y el día que llegue esas pruebas dicen exactamente qué se le está mandando. **Lo que NO está verificado es que ESA impresora los entienda.** | Prompt 23 — 2026-09-11 |
| **Qué impresora usa la terminal se configura en un archivo LOCAL, no en `configuracion_negocio`.** | Guardarlo en la tabla del negocio; una variable de entorno; una pantalla de configuración | Es estado operativo de una máquina: dos cajas podrían tener la térmica en puertos distintos, y el puerto de la caja A no significa nada en la caja B. `configuracion_negocio` se espeja en la nube, así que meterlo ahí repetiría el error que el proyecto ya evitó con `bloqueos_de_autorizacion`. No hay pantalla todavía porque configurar una impresora que nadie vio sería adivinar qué opciones ofrecerle a Jimmy; se decide cuando llegue el modelo real. Sin archivo no hay impresora, y **eso no es un error**: es el estado normal hoy, y la venta sigue su curso con el PDF como respaldo. | Prompt 23 — 2026-09-11 |
| **Un fallo de impresión va a una bitácora TÉCNICA en archivo, nunca a `auditoria_log`.** | Registrarlo en `auditoria_log` como cualquier otro evento; no registrarlo | `auditoria_log` guarda hechos del negocio, es inmutable por trigger, se espeja en la nube y un auditor la lee como evidencia. Que una impresora no respondiera es un problema del aparato: meterlo ahí ensuciaría con ruido de hardware la única tabla que tiene que poder leerse entera. No registrarlo tampoco sirve, porque entonces nadie podría diagnosticar por qué la tienda dejó de imprimir. Un archivo de texto en la carpeta de datos se abre con cualquier cosa, se borra sin consecuencias y no viaja a la nube. | Prompt 23 — 2026-09-11 |
| **El historial de recibos exige solo SESIÓN; configurar los datos del negocio exige rol ADMINISTRATIVO.** | Pedir rol administrativo para las dos cosas; no pedir nada para ninguna | Reimprimir lo pide un cliente que volvió al rato porque perdió su papel: exigir un administrador paralizaría el mostrador, y el recibo no muestra nada que ese cliente no haya visto ya al comprar. Cambiar el NIT o el nombre del negocio es otra cosa: cambia un documento que se le entrega al cliente, y por eso queda además en la auditoría. | Prompt 23 — 2026-09-11 |
| **Gestión de usuarios completa: crear, editar, cambiar PIN y dar de baja, en cualquier momento.** Cierra un hueco de alcance abierto desde el Prompt 3. | Dejar solo el primer arranque; permitir crear usuarios desde una pantalla sin rol; borrar usuarios en vez de darlos de baja | Hasta acá el sistema sabía crear UN usuario —el primer administrador, y solo con la tabla vacía—, así que la tienda no podía dar de alta a su propio cajero. El requerimiento pedía «usuario de venta y usuario administrativo» desde el principio: el sistema no estaba completo con un solo usuario creado el primer día. Se reutiliza `@shared/auth` para el hash y no se escribe uno nuevo, porque dos implementaciones en el mismo proyecto terminan en usuarios que no pueden entrar. **Nunca se borra**, igual que con productos y categorías: un usuario de baja conserva sus ventas y sus asientos de auditoría, que son el historial de la tienda y no le pertenecen a la cuenta. | Prompt 21 — 2026-09-11 |
| **Cambiar el PIN es una acción APARTE de editar, y NO pide el PIN anterior.** | Un campo más en el formulario de edición; exigir el PIN viejo antes de cambiarlo | Mezclarlo con el nombre invitaría a tocarlo sin querer al corregir un acento, y además es un hecho distinto para la auditoría, con su propia acción. Y no se pide el anterior porque el caso que hay que resolver es el del cajero que lo OLVIDÓ: exigir el viejo lo dejaría sin forma de volver a entrar, que es justamente el problema que esta operación existe para arreglar. Quien la ejecuta ya es un administrador con sesión iniciada, y eso es lo que la autoriza. El PIN nuevo no se registra en la auditoría ni en claro ni hasheado: lo que queda es a quién se le cambió, quién lo cambió y cuándo. | Prompt 21 — 2026-09-11 |
| **Dos usuarios ACTIVOS no pueden tener el mismo PIN, y el rechazo no dice de quién es.** Se comprueba al crear un usuario y al cambiarle el PIN, para los dos roles. | No validarlo, como hasta el Prompt 21; validarlo solo para el rol administrativo; nombrar en el mensaje a la persona con la que choca | El daño no está donde parece. En el ingreso la colisión es acotada, porque primero se elige el nombre. **El problema serio está en el diálogo de autorización**, que prueba el PIN contra todos los administradores activos y se queda con el primero que coincida: con dos PIN iguales, `descuento_autorizado_por` y `diferencia_autorizada_por` nombran a la persona equivocada, en silencio y sin forma de detectarlo después. La §4.9 ya lo anticipaba al hablar de «una coincidencia improbable». Se aplica a los DOS roles aunque el riesgo esté concentrado en el administrativo: un usuario de venta pasa a administrativo con una edición, así que la excepción envejecería mal, y una regla general es más barata que dos casos. Solo cuentan los activos, porque quien está de baja no inicia sesión ni autoriza nada. Se compara el PIN en claro contra cada hash —dos hash scrypt del mismo PIN son distintos, cada uno con su sal— y eso cuesta una verificación por usuario activo: cerca de un segundo con una decena, aceptable en una acción de administrador e inaceptable en el ingreso. **El mensaje no nombra a nadie**, ni siquiera en la causa técnica: hacerlo convertiría el control en una forma de averiguar el PIN ajeno por eliminación. La regla se aplica en las TRES puertas —alta, cambio de PIN y configuración del PIN remoto— con una sola función compartida, `colision-de-pin.ts`: escribirla por servicio sería garantizar que un día los criterios se separen y la colisión entre por la puerta que quedó floja. En el PIN remoto convive con la comprobación vieja, que mira el PIN normal de uno mismo y protege otra cosa: no regalar el acceso a la propia sesión al dictar el código por teléfono. | Prompt 22 — 2026-09-11 |
| **Siempre tiene que quedar un administrador activo, y nadie se cambia a sí mismo el rol ni se da de baja.** | Confiar en que nadie lo haga; avisar en la pantalla y dejar pasar la operación | Perder al último administrador deja la tienda sin poder abrir caja, cargar catálogo ni gestionar usuarios, y **no hay vuelta atrás**: el primer arranque solo se ofrece con la tabla VACÍA, y dar de baja no la vacía. Es un invariante que ninguna otra capa puede proteger, porque el esquema no sabe contar administradores y la pantalla se salta llamando al canal. Lo mismo vale para quitarle el rol, no solo para darlo de baja. La regla de «ni a uno mismo» evita además dejar la sesión viva con una identidad que ya no corresponde a la base; corregirse el PROPIO nombre sí se permite, porque no tiene riesgo. | Prompt 21 — 2026-09-11 |
| **El orden de la cuadrícula de venta lo decide `contador_ventas` (VECES vendido), y `cantidad_vendida` queda para reportes.** Cerrado sin consultar a Jimmy. | Ordenar por `cantidad_vendida`; ofrecer las dos y dejar elegir en configuración | Contar transacciones es la **única medida comparable entre productos**: las libras de maíz y las unidades de huevo no se pueden sumar en un mismo número, así que ordenar por cantidad pondría el maíz —que sale de a cien libras— por encima de todo lo que se vende por unidad, y la cuadrícula dejaría de reflejar lo que el cajero busca. La pregunta había quedado abierta como punto 14 de §6.2; Julio la cerró en el Prompt 20 sin necesidad de consultarla, porque no es una preferencia del negocio sino una consecuencia de que las unidades no sean conmensurables. `cantidad_vendida` sigue existiendo y sigue subiendo con cada venta: su destino son los reportes y el futuro módulo de mermas, no el orden de los íconos. | Prompt 20 — 2026-09-10 |
| **El tope de descuento se siembra con un guion aparte, `seed:limites`, y NO con una migración ni junto al catálogo de ejemplo.** | Sembrarlo en una migración; incluirlo en `seed:ejemplo`; poner un valor por omisión en el código cuando falta la fila | Una migración es historial permanente del esquema, y un tope de descuento es **configuración** que un administrador cambia cuando quiere: sembrarlo ahí dejaría el valor de un guion de desarrollo metido para siempre en la base de la tienda. Meterlo en `seed:ejemplo` juntaría dos cosas distintas —mercadería inventada y configuración— y haría que limpiar el catálogo le quitara el tope a alguien de paso. Y un valor por omisión en el código sería lo peor de todo: convertiría un olvido de configuración en un permiso, que es exactamente lo que el tope cero evita. El guion imprime el tope de cada rol al terminar, para que un rol sin fila se lea como «tope cero» y no como «sin límite». **No reemplaza la pantalla de configuración**, que sigue pendiente. | Prompt 20 — 2026-09-10 |
| **El rol `administrativo` NO se salta el mecanismo de descuento: tiene un tope más alto.** Se siembra en 100 % y Q1 000; el de `venta` queda en 10 % y Q20. | Una excepción por rol en el servicio, para que un administrador nunca pase por la comprobación; dejarlo sin fila, o sea tope cero; sembrarle un tope «ilimitado» | Una excepción en el código es el patrón «salvo que sea administrador» que §4.9 ya rechazó para el cierre de caja ajena, y que en este proyecto costó una vuelta con la intercepción de `Cmd+Q`: parece inofensiva y abre el hueco. Con un tope alto se obtiene el mismo resultado práctico —un administrador no se autoriza a sí mismo en el uso normal— y la regla sigue siendo una sola, legible en una tabla en vez de en una rama del servicio. Dejarlo en cero era peor ergonomía de la que parecía: no bastaba con que topara en los descuentos grandes, topaba en TODOS, incluido uno de Q1. Y «ilimitado» no se puede expresar: las dos columnas son decimales `NOT NULL` con piso cero y la ausencia de fila significa CERO, no infinito, así que habría que escribir un número mágico enorme que dentro de un año se leería como una decisión deliberada del negocio. **100 % sí es un techo honesto** —significa «puede descontar la venta entera», y el total ya tiene piso en cero—, de modo que por la vía del porcentaje el PIN nunca aparece; el Q1 000 del monto fijo es una cifra redonda y provisional que casi nunca es la que topa. **SALVEDAD: este número asume que el rol `administrativo` lo tiene el DUEÑO**, que hoy es el caso. Si se le asigna a un empleado de confianza que no es Jimmy, el 100 % le daría la capacidad de regalar mercadería sin que nadie más se entere y **hay que revisarlo**. Depende del punto 6 de §6.2, que sigue abierto. | Prompt 21 — 2026-09-11 |
| **Precio especial (por PRODUCTO, preconfigurado) y descuento discrecional (por VENTA, en el momento) son dos cosas distintas y no se mezclan.** Un ticket puede llevar los dos, en ese orden. | Un solo mecanismo de descuento que sirviera para las dos cosas; aplicar el precio especial como un descuento más sobre el total | Se decide en momentos distintos, por personas distintas y con controles distintos: el precio especial lo deja puesto un administrador de antemano y ya tuvo su autorización al configurarse; el descuento lo decide quien vende con el cliente enfrente y por eso tiene tope por rol y PIN. Fundirlos obligaría a elegir un solo control para los dos casos: o el administrador tendría que autorizar cada venta de un producto en promoción, o el vendedor podría rebajar la venta entera sin tope. Además se guardan en lugares distintos —`precios_especiales` contra `ventas`— y un auditor necesita poder separarlos: una promoción de temporada y un favor a un cliente no son el mismo hecho. Si hay varios precios especiales vigentes gana el más reciente y **no se acumulan**, porque dos promociones encimadas darían un precio que nadie configuró. | Prompt 19 — 2026-09-10 |
| **La vigencia de un precio especial se compara POR DÍA, no por instante.** Una promoción cuyo `vigente_hasta` es hoy vale todo el día. | Comparar el instante completo, como hacía `listarVigentes` | El último día de una promoción es un día de promoción. Con comparación por instante, una promoción que vence «hoy» deja de aplicarse a las 00:00 y el cliente paga de más justo el día en que el cartel del mostrador todavía dice que está rebajado. Queda anotada la salvedad de zona horaria: `date()` trabaja sobre cadenas UTC y Guatemala es UTC−6, así que el «hoy» de la base se adelanta a las 18:00 locales. Para una promoción de varios días es indiferente; para una de un solo día habrá que decidirlo cuando exista una real, y es definición de negocio. | Prompt 19 — 2026-09-10 |
| **`descuento_excedente` es una superficie de candado propia y NO acepta el PIN remoto** (migración 013, no espejada). **AMPLIADA en el Prompt 26 — ver la fila siguiente. NO revertida: la mitad de la superficie propia sigue vigente tal cual.** | Reusar `cierre_con_diferencia`; aceptar el PIN remoto para poder autorizar por teléfono | La razón es de alcance, la misma de siempre: el PIN remoto se pidió para autorizar diferencias de caja por teléfono y nada más, y dárselo a otra acción sería ampliarlo más allá de lo pedido. Acá el argumento es incluso más fuerte que en la salida controlada: **un descuento es dinero que sale de la venta**, y autorizarlo a distancia sin ver el ticket es aprobar a ciegas; quien autoriza tiene que estar mirando la pantalla donde se le muestra el tope, el pedido y el exceso. No se reusa la superficie de la diferencia porque son candados independientes por diseño (§4.8) y fallar al autorizar un descuento no debe bloquear un corte de caja. | Prompt 19 — 2026-09-10 |
| **AMPLIACIÓN DECIDIDA, NO CORRECCIÓN: `descuento_excedente` acepta también el PIN remoto.** La superficie propia y su candado independiente siguen exactamente igual; lo único que cambia es qué PIN acepta. | Dejarla como estaba y que el cliente espere a que Jimmy vuelva a la tienda; ampliar de paso las otras dos superficies «por coherencia» | **LA FILA DE ARRIBA NO ESTABA EQUIVOCADA.** Decía que ampliar el alcance del PIN remoto exigía una decisión explícita, y el código lo repetía en un comentario. **Julio tomó esa decisión el 2026-09-11**, con un motivo de negocio concreto: Jimmy no siempre está en la tienda y un cliente parado en el mostrador no puede esperar a que vuelva. Es el mecanismo previsto funcionando —el valor por omisión fue «no», la ampliación tuvo que pedirse, y se pidió— y por eso se anota como ampliación y no como reversión. **EL PRINCIPIO DE ALCANCE MÍNIMO POR OMISIÓN SIGUE VIGENTE PARA CUALQUIER AMPLIACIÓN FUTURA NO SOLICITADA**, y se acotó a propósito: `salida_controlada` y `cierre_de_caja_ajena` siguen sin aceptarlo, con pruebas que lo comprueban en el mismo archivo que comprueba la ampliación, para que ninguna sesión futura lea esto como permiso para conceder la próxima sin pedirla. La contrapartida se asume a sabiendas: autorizar por teléfono es aprobar un descuento sin ver el ticket, y lo que juega en contra es que queda registrado con autorizante, vía y asiento de auditoría, y que la alternativa real no era «autorizarlo mirando» sino «no poder vender». | Prompt 26 — 2026-09-11 |
| **AMPLIACIÓN DECIDIDA, NO CORRECCIÓN, POR SEGUNDA VEZ: `salida_controlada` acepta también el PIN remoto.** Su candado sigue exactamente igual; lo único que cambia es qué PIN acepta, y el asiento registra la vía en `autorizadaVia`. | Dejarla como estaba y que la computadora quede encendida si no hay un administrador; ampliar de paso `cierre_de_caja_ajena` y `saltar_lote_de_sincronizacion` «por coherencia» | **LA FILA QUE DECÍA QUE NO LO ACEPTABA NO ESTABA EQUIVOCADA.** El PIN remoto se pidió para autorizar diferencias por teléfono, y dárselo a cerrar la aplicación lo ampliaba más allá de lo pedido; el valor por omisión era «no» y ampliarlo exigía una decisión explícita. **Julio la tomó el 2026-09-15**, con un motivo concreto: Jimmy tiene que poder autorizar que se apague el punto de venta al final del día cuando no hay ningún administrador en la tienda. Es la segunda vez que el mecanismo funciona como se diseñó —la primera fue el descuento— y no una excepción por conveniencia. **EL PRINCIPIO DE ALCANCE MÍNIMO SIGUE VIGENTE**: `cierre_de_caja_ajena` y `saltar_lote_de_sincronizacion` siguen sin aceptarlo, con pruebas en el mismo archivo. Se reutilizó la verificación dual existente cambiando UNA entrada de `ACEPTA_PIN_REMOTO`, sin lógica nueva. La contrapartida: quien recibe el PIN remoto dictado puede, hasta que se cambie, también cerrar la aplicación; cerrar es ordenado y queda auditado con su vía. §4.41. | Prompt 61 — 2026-09-15 |
| **NO se separa el PIN remoto por superficie. Un solo PIN remoto por administrador sigue autorizando la diferencia, el descuento y la salida.** Evaluado y descartado a propósito. | Un PIN remoto distinto para cada superficie que lo acepta, para que dictar uno no conceda los otros | Julio lo decidió el 2026-09-15, después de leer la contrapartida de la fila anterior. **El control real ya existe**: si cambia a quién se le dicta el PIN remoto, o deja de haber confianza en quien lo escuchó, el administrador lo cambia en cualquier momento desde «PIN de autorización remota», y el anterior deja de servir para todo a la vez. Un PIN por superficie duplicaría ese mecanismo sin agregar un control distinto: habría que dictar, recordar y cambiar tres códigos en vez de uno. **Si alguien lo reconsidera, esto ya se pensó**: lo que cambiaría la respuesta es que las superficies pasen a tener responsables distintos, no la cantidad de superficies. §4.41. | Prompt 62 — 2026-09-15 |
| **Toda llamada de la pantalla de caja al proceso principal tiene límite: un rechazo o 15 s sin respuesta se muestran como mensaje. Y toda respuesta del cierre se prueba con `structuredClone`.** | Solo el `try/catch`; confiar en que el manejador ya no manda objetos de dominio | En `v1.0.0-prueba.1` el cierre de una caja ajena mandaba la `sesion` con montos Decimal; decimal.js les pone `constructor` como propiedad propia y el puente IPC no clona funciones. **Medido con Electron 44: la llamada queda pendiente para siempre, no se rechaza.** Por eso el `catch` solo no cambió nada en la app real. Quince segundos quedan muy por encima de la operación más lenta (verificar un PIN con scrypt). Ya se había arreglado sin saberlo en `0959a18`; la prueba de clonado es lo que impide que vuelva. §4.42. | Prompt 63 — 2026-09-15 |
| **Una prueba llama a los 56 canales IPC con servicios reales y exige que cada respuesta se pueda clonar; y el envoltorio único convierte un resultado no clonable en `RESPUESTA_NO_SERIALIZABLE`.** | Probar solo el canal de cierre; una comprobación de tipos; revisar los manejadores a ojo | Pedido de Julio: el defecto de §4.42 es de patrón. Los tipos no lo ven: un spread mete propiedades de más sin que TypeScript se queje. La prueba exige que cada canal registrado se llame y dé al menos un `ok`, así que un canal nuevo no puede escaparse. El envoltorio es la red en producción: sin él, Electron 44 deja la llamada pendiente para siempre. Hoy no se encontró ningún otro canal con el defecto. §4.42. | Prompt 64 — 2026-09-15 |
| **Qué superficie acepta el PIN remoto pasa a ser una TABLA (`ACEPTA_PIN_REMOTO`), no un argumento de quien llama.** | Dejar el parámetro `aceptaPinRemoto` en cada llamada; un `if` por superficie dentro del servicio | La verificación dual —probar los PIN normales, después los remotos, y reportar cuál coincidió— **nunca estuvo duplicada**: vive en `autorizarComoAdministrador` desde el Prompt 13. Lo que sí estaba repetido era la POLÍTICA: los cuatro lugares que autorizan escribían `{ aceptaPinRemoto: true/false }` a mano al lado del nombre de la superficie. Dos datos que tienen que concordar siempre, decididos en archivos distintos, es una discrepancia esperando a ocurrir: alcanzaba con copiar un bloque y cambiar el nombre de la superficie sin tocar el booleano para que una superficie empezara a aceptar un PIN que la documentación dice que no acepta, **sin que nada fallara**. Con la tabla, quien llama no tiene dónde contradecir la política, y `Record<SuperficieDeAutorizacion, boolean>` obliga a decidir explícitamente qué acepta cada superficie nueva. Al hacer el cambio, el compilador marcó los cuatro llamados, que es exactamente la señal que se buscaba. **Cada superficie conserva su propio candado**: compartir qué PIN aceptan no es compartir contador, y hay pruebas nuevas del par `cierre_con_diferencia` ↔ `descuento_excedente`, un caso que antes no podía existir porque solo una superficie aceptaba el remoto. | Prompt 26 — 2026-09-11 |
| **`ventas.descuento_autorizado_via` registra CÓMO se autorizó un descuento, y va siempre con el autorizante** (migración 017 y su espejo 0017). El asiento de auditoría también lleva la vía. | Deducir la vía de otro dato; no registrarla y quedarse solo con quién autorizó | Mientras la superficie aceptaba un solo PIN, la respuesta era siempre «presencial» y la columna habría sido ruido. Desde que acepta los dos, **«Jimmy autorizó Q40» dejó de ser una sola cosa**: autorizarlo frente al mostrador viendo el ticket y autorizarlo por teléfono sin verlo son dos hechos distintos, y es exactamente lo que un auditor va a querer separar. No se puede deducir de ningún otro dato guardado. La columna de la venta guarda el ESTADO final y el asiento guarda el HECHO, igual que con el cierre de caja. El par autorizante/vía se hace inseparable en las **tres** capas: un solo objeto en el tipo (`AutorizacionDeDescuento`, imposible construir uno sin el otro), el servicio descarta las dos mitades juntas cuando el descuento no excedía, y el CHECK de la base rechaza la fila. | Prompt 26 — 2026-09-11 |
| **El CHECK de coherencia NO copia la forma de la migración 007: los `IS NOT NULL` van ADELANTE.** | Copiar literalmente `(via IS NULL AND por IS NULL) OR (via IN (...) AND por IS NOT NULL)`, que es la forma que ya estaba en el proyecto | **Se midió antes de escribir la migración, y la forma de la 007 NO rechaza un autorizante sin vía.** El motivo es la lógica de tres valores de SQL: con `via` en NULL, `via IN ('presencial','remoto')` no da FALSO sino NULL, la segunda rama entera da NULL, y **un CHECK pasa cuando su expresión da NULL**; solo falla cuando da FALSO. Así que `por` lleno con `via` vacía entraba sin protestar, justo la mitad que el comentario de la 007 decía proteger. En `caja_sesiones` el hueco está tapado por otra vía —el CHECK de la migración 008 exige `diferencia_autorizada_via IS NOT NULL` de forma explícita— así que **no hay ningún dato mal guardado hoy**, pero la forma de la 007 por sí sola es más débil de lo que aparenta. Acá no hay una segunda restricción que salve, así que se escribe con los `IS NOT NULL` adelante, que cortocircuitan a FALSO. Verificado con las ocho combinaciones, incluidos los dos UPDATE que romperían el par. | Prompt 26 — 2026-09-11 |
| **DEPENDENCIA EXPLÍCITA, ANOTADA PARA QUE NO SE PIERDA: la integridad de `caja_sesiones` frente al hueco de la 007 depende hoy de que la 008 siga exigiendo `diferencia_autorizada_via IS NOT NULL`. Si algún prompt futuro relaja esa restricción, revisar primero si reabre este hueco.** Se decidió **no** reparar la 007 con una migración nueva. | Reparar la 007 con una migración nueva que agregue la coherencia bien escrita; editar el `.sql` de la 007 para corregirla en el lugar | Salió de la auditoría del Prompt 27, que recorrió **las 52 restricciones CHECK de Postgres y las 121 de SQLite** evaluándolas sobre grillas con NULL: `caja_sesiones_autorizacion_coherente` es **la única** con la forma vulnerable en todo el esquema. **No hay ningún dato mal guardado y la tabla no tiene hueco**, porque `caja_sesiones_autorizacion_solo_con_diferencia` de la 008 exige las dos columnas de forma explícita y frena las cinco combinaciones donde la 007 se rinde; comprobado con `INSERT` reales contra la tabla completa, no solo evaluando expresiones. Se decidió no reparar porque una migración nueva agregaría una restricción que hoy no cambia ningún comportamiento, y en SQLite la vieja no se puede quitar sin recrear la tabla: quedarían las dos conviviendo, la débil y la fuerte, que es más confuso que el problema. **Lo que sí es cierto y hay que saberlo es que la cobertura es ACCIDENTAL**: la 008 no se escribió para tapar a la 007, y el día que alguien la relaje —por ejemplo para permitir autorizar un cierre cuadrado— el hueco se reabre sin que nada lo anuncie. Por eso la advertencia no vive solo acá: hay un archivo `008_autorizacion_solo_con_diferencia.LEER-ANTES-DE-TOCAR.md` **al lado de la migración**, y una prueba que fija su checksum y falla con el motivo escrito si alguien la edita. | Prompt 27 — 2026-09-11 |
| **La advertencia de la 008 NO se pudo poner dentro de su propio `.sql`, y eso es una consecuencia del diseño, no un descuido.** | Agregar el comentario al archivo de la migración, que es donde más se vería | La 008 **ya está aplicada**, incluida la base de trabajo de Julio, que además tiene ventas reales adentro. El migrador guarda el checksum SHA-256 del contenido completo, comentarios incluidos, así que cambiarle un solo carácter hace que la aplicación **se niegue a abrir** toda base que ya la tenga. Es el mismo callejón que §4.2 documenta para el comentario engañoso de la migración 001, que quedó sin corregir por la misma razón. La salida fueron dos lugares que sí se pueden tocar y que además llegan antes: un archivo hermano `.LEER-ANTES-DE-TOCAR.md`, inerte para el migrador —que importa cada `.sql` por nombre y no recorre el directorio—, y **una prueba que fija el checksum de la 008**. La prueba es la que de verdad frena: un comentario se lee por encima, un `npm test` en rojo con el motivo escrito no. Se comprobó que muerde agregando un comentario a propósito. | Prompt 27 — 2026-09-11 |
| **AUDITORÍA PERMANENTE: ningún CHECK del esquema puede dar NULL, y hay una prueba que lo recorre entero.** | Confiar en que quien escriba una migración se acuerde de la regla; revisar a mano cada vez | Un CHECK de SQL **rechaza solo cuando su expresión da FALSO**: con NULL deja pasar la fila. Y cualquier comparación con NULL —`col IN (...)`, `col = 'x'`, `col > otra`— da NULL. La regla para escribirlos bien es poner los `IS NOT NULL` **adelante**, que cortocircuitan a FALSO. Acordarse de eso en cada migración futura es exactamente la clase de cosa que se olvida, así que la prueba recorre los 121 CHECK del esquema local, los evalúa sobre grillas que incluyen NULL y falla si aparece uno nuevo con esta forma. El inventario de las conocidas exige un motivo escrito por entrada, y una segunda prueba obliga a sacarlas si se reparan: un inventario que conserva entradas viejas deja de significar algo. Se comprobó que muerde agregando una restricción vulnerable a propósito. | Prompt 27 — 2026-09-11 |
| **El diálogo de descuento pide «el código de autorización», sin preguntar cuál de los dos PIN es.** | Que el cajero elija «normal» o «remoto» antes de teclear | Es el mismo texto que el cierre de caja descuadrado, que resolvió esto en el Prompt 13. **El cajero no puede saber cuál le dictaron**: le pasan cuatro dígitos por teléfono y los teclea. Pedirle que lo declare sería pedirle un dato que no tiene, y abriría la puerta a que la auditoría registre una vía equivocada por un error de quien atiende el mostrador. Lo determina el proceso principal, según cuál hash coincidió, probando primero todos los PIN normales para que ante una coincidencia improbable gane la lectura presencial, que es la más conservadora. | Prompt 26 — 2026-09-11 |
| **`monto_esperado = monto_inicial + Σ ventas en efectivo COMPLETADAS de la sesión`.** Cierra el `TODO(ventas)` que estaba abierto desde el Prompt 13. | Sumar todas las ventas del turno; sumar por fecha en vez de por `caja_sesion_id`; sumar los subtotales | Las ventas con tarjeta nunca entran al cajón: ese dinero llega por el banco. Sumarlas haría que toda caja con ventas con tarjeta apareciera faltante por exactamente ese monto, y el cajero tendría que pedir una autorización de descuadre por un dinero que nadie perdió. Se filtra por `caja_sesion_id` y no por fecha porque un turno es un turno aunque cruce la medianoche. Se suman los TOTALES y no los subtotales porque el descuento ya está aplicado en el total, que es lo que el cliente pagó. La suma se hace con Decimal.js y no con `SUM()` de SQL: `ventas.total` es TEXT canónico y SQLite lo convertiría a punto flotante, que es justo lo que descuadraría el corte. | Prompt 19 — 2026-09-10 |
| **El cálculo del descuento vive en `@shared/descuento`, compartido por las dos capas.** | Que el renderer calcule su propia versión para mostrar y el proceso principal la suya para guardar | Las dos capas necesitan el mismo número: la pantalla para mostrarle al cajero cuánto rebaja antes de cobrar, y el proceso principal para calcular el total que se guarda. Dos implementaciones discrepan tarde o temprano, y el síntoma sería el peor posible: el cliente paga un total distinto del que vio en pantalla. Lo que NO se comparte es la autorización —el tope por rol y el PIN—, que vive solo en el proceso principal, porque una validación que viviera en la ventana se saltaría llamando al canal directamente. | Prompt 19 — 2026-09-10 |
| **`productos.cantidad_vendida` es una COLUMNA NUEVA (migración 015), no un cambio de `contador_ventas`.** Una cuenta veces, la otra cantidad, y las dos suben en el mismo `UPDATE`. | Hacer que `contador_ventas` subiera por la cantidad, como pedía el prompt; cambiarle el tipo a TEXT canónico; guardar la cantidad en milésimas dentro del mismo entero | `contador_ventas` es INTEGER y una venta a granel de 2.5 lb no cabe en un entero sin mentir: truncarla pierde media libra por venta, redondearla inventa media libra que nadie compró, y guardar milésimas dentro de una columna llamada «contador» engañaría a cualquiera que la lea. Cambiarle el tipo exigiría el rebuild de doce pasos de `productos` —que este proyecto ya descartó por el mismo motivo que en la migración 008: `venta_detalle` y `precios_especiales` la referencian y `PRAGMA foreign_keys=OFF` es ignorado dentro de una transacción—, mientras que `ADD COLUMN` no tiene ninguno de esos problemas. Y hay una razón de fondo: **las libras de maíz y las unidades de huevo no se pueden sumar en un mismo número**, así que ordenar la cuadrícula por cantidad pondría el maíz siempre arriba. Contar transacciones es la única medida comparable entre productos. Cuál de las dos debe ordenar la cuadrícula queda como definición de negocio abierta (§6.2, punto 14). | Prompt 19 — 2026-09-10 |
| **La boleta va con tarjeta y solo con tarjeta, y lo hace cumplir la base** (migración 014 y su espejo 0014). | Dejarlo solo en el servicio; agregar además un CHECK de coherencia del descuento | Sin número de boleta una venta con tarjeta no se puede conciliar contra el estado de cuenta del banco, y una venta en efectivo con boleta es un dato inventado que ensucia esa misma conciliación. Se midió antes de escribir la migración qué aceptaba y qué rechazaba la tabla: el descuento **ya estaba amarrado desde la migración 001** —no se puede guardar tipo sin valor, ni valor sin tipo, ni autorizante sin descuento—, así que volver a agregarlo solo habría ensuciado el esquema con una restricción redundante. El hueco real era la boleta, y es el que se cerró. | Prompt 19 — 2026-09-10 |
| **El mismo producto repetido en dos líneas del payload se rechaza con `DATO_INVALIDO`, no con `CONFLICTO_DE_INVENTARIO`.** | Dejar que fallara solo, por el comparar-y-cambiar | La pantalla junta las cantidades del mismo producto en una sola línea, pero el canal IPC se trata como entrada no confiable. Dos líneas del mismo producto leen las dos el MISMO saldo, y la segunda haría fallar el comparar-y-cambiar: el cajero vería «el inventario cambió mientras se cobraba», que es **falso**. Un mensaje que miente sobre la causa manda a investigar el lugar equivocado. | Prompt 19 — 2026-09-10 |
| **No se puede vender en la caja de otra persona, ni con autorización.** | Permitirlo con el PIN de un administrador, como el cierre de caja ajena | Una venta se registra contra `caja_sesion_id`, así que vender en el turno ajeno metería el dinero en el corte de alguien que no lo recibió y le aparecería un sobrante que no cometió. **Cerrar** la caja de otro sí se autoriza porque es un acto único y auditado; **vender** es continuo, y autorizar una vez dejaría toda una tarde atribuida a quien no estaba. La salida correcta ya existe y la pantalla lleva a ella: cerrar ese turno y abrir el propio. | Prompt 19 — 2026-09-10 |
| **CORREGIDO: la caja es UNA EN TODO EL SISTEMA, no una por usuario.** El índice único parcial pasa de `(usuario_id) WHERE estado='abierta'` a `(estado) WHERE estado='abierta'` (migración 010 y su espejo 0010). | Dejar la restricción por usuario; no restringir y confiar en que nadie abra dos; restringir por terminal | El alcance original estaba mal, no corto: permitía que **dos personas distintas abrieran cada una su turno sobre el mismo cajón físico de dinero**, y con dos turnos simultáneos ninguno de los dos cortes significa nada, porque lo que entra por uno sale contado en el otro. Jimmy tiene una sola caja y una sola pantalla. Se indexa la propia columna `estado` porque dentro de la condición su valor es siempre el mismo, así que la unicidad sobre ella permite una sola fila. El mensaje de `CAJA_YA_ABIERTA` deja de decir «ya tenés» y pasa a «ya hay»: la caja abierta puede ser de cualquiera, y atribuírsela a quien intenta abrir lo manda a buscar un turno propio que no existe. | Prompt 17 — 2026-09-08 |
| **Cerrar una caja que abrió otra persona exige el PIN normal de un administrador, SIN excepción por rol.** Superficie de candado propia, `cierre_de_caja_ajena` (migración 011, no espejada). | Dejar cerrar a cualquiera; permitírselo libre a quien tenga rol administrativo; reusar la superficie `cierre_con_diferencia` | Si la caja es una sola, al turno de la tarde le toca cerrar el de la mañana, y ese cierre mueve dinero que el que cierra no contó al abrir. Se exige autorización **siempre** que quien cierra no sea quien abrió, incluso si quien cierra es administrador: la excepción «salvo que sea administrador» es la misma clase de caso especial que ya costó una vuelta con la intercepción de `Cmd+Q`, parece inofensiva y abre el hueco; además, con ella el cierre ajeno de un administrador no quedaría registrado como tal. No se reusa la superficie de la diferencia porque un mismo cierre puede necesitar las dos autorizaciones y compartir candado haría que fallar una bloqueara la otra; y porque el PIN remoto vale para la diferencia y **no** para esto. | Prompt 17 — 2026-09-08 |
| **`caja_sesiones.cerrada_por` guarda a QUIEN CERRÓ, no a quien autorizó, y va NULL cuando cerró quien abrió** (migración 012 y su espejo 0012). | Guardar al administrador que autorizó; repetir siempre el `usuario_id` de quien cerró; no guardar nada y deducirlo de la auditoría | Son tres personas posibles y distintas: quien abrió, quien cerró y quien autorizó. Guardar al autorizante haría que el corte pareciera hecho por un administrador que quizá ni estaba en la tienda. Dejarlo NULL cuando coincide con quien abrió hace que `WHERE cerrada_por IS NOT NULL` sean exactamente los cierres que necesitaron autorización, sin comparar dos columnas. Quién autorizó sí queda, en el asiento de auditoría del cierre, junto con los otros dos. | Prompt 17 — 2026-09-08 |
| **NO se puede vender en la caja de otra persona, y a diferencia de cerrarla, NINGÚN PIN lo desbloquea.** | Dejar vender en la caja ajena sin más; pedir el PIN de un administrador una vez, como para cerrarla; pedirlo en cada venta | Una venta se registra contra `caja_sesion_id`: vendiendo en el turno ajeno, el dinero entra al corte de alguien que no lo recibió. La asimetría con el cierre es deliberada y es lo que hace consistente el conjunto: **cerrar** es un acto único y supervisado, con su asiento y su autorizante, así que un PIN alcanza para dejarlo trazado; **vender** es continuo, y una autorización única dejaría toda una tarde de ventas atribuidas a quien no estaba, mientras que pedir el PIN en cada venta es inviable con un cliente enfrente. No es un callejón sin salida: cerrar el turno ajeno ya tiene su flujo autorizado, y la pantalla lleva ahí. | Prompt 18 — 2026-09-09 |
| **El aviso de inventario de la pantalla de venta es de INTERFAZ y no bloquea.** La fuente de verdad sigue siendo el piso `>= 0` de la base dentro de la transacción de la venta. | Impedir agregar más de lo disponible; no avisar nada | El saldo que la pantalla compara es una foto tomada al cargarla, y puede haber cambiado mientras el cajero arma el ticket: bloquear con un dato viejo impediría vender mercadería que sí está en la bodega, con el cliente enfrente. No avisar nada, en cambio, dejaría que el descuadre se descubriera recién al cobrar. Avisar sin bloquear es la única de las tres que no miente ni estorba. Queda dicho en un comentario junto al código y en §4.12, para que el módulo de registro de venta no dé por hecho que esta comprobación ya protege algo. | Prompt 18 — 2026-09-09 |
| **El diseño importado de Claude Design se ADAPTA a los patrones del proyecto, no se copia**, y su paleta queda acotada a la pantalla de venta. | Pegar el HTML del prototipo dentro de la aplicación; migrar toda la interfaz a la paleta clara de una vez | El prototipo es HTML plano con estilos en línea y componentes propios (`<image-slot>`, `<sc-if>`) que dependen del runtime del lienzo de diseño: dentro de Electron no tendría IPC tipado, ni los componentes ya construidos, ni las reglas de arquitectura. Se extrajo la dirección visual —estructura, paleta `oklch`, proporciones, jerarquía— y se reconstruyó con React. Tres puntos del diseño chocaron con reglas técnicas y ganó la regla, documentado en §4.12: las fuentes de Google no se cargan porque el renderer no sale a la red y la tienda funciona sin internet; los anchos fijos de 1920 px pasan a `clamp()` porque en pantallas menores dejaban la cuadrícula en una sola columna; y lo que corresponde a módulos inexistentes —cliente, mayoreo, descuentos, formas de pago— no se dibuja, para no prometer funciones que no están. | Prompt 18 — 2026-09-09 |
| **La coherencia entre `diferencia` y sus columnas de autorización la aplica la base, no solo el servicio** (migración 008 y su espejo 0008). | Dejarla solo en `ServicioDeCaja`; un trigger; recrear la tabla con el procedimiento de doce pasos | Un cierre descuadrado sin autorizante es el agujero que todo el flujo de PIN existe para tapar, y hasta ahora lo tapaba solo la aplicación: una consulta SQL a mano o un respaldo restaurado a medias lo dejaban pasar. Se usa `ALTER TABLE ... ADD CONSTRAINT ... CHECK`, que **no está en la gramática documentada de SQLite** pero que en la versión empaquetada (3.53.4) se midió que se aplica de verdad, en INSERT y en UPDATE, sobrevive a reabrir el archivo y no crea columna fantasma. Se descartó recrear `caja_sesiones`: guarda dato de negocio, `ventas` la referencia, y el paso que apaga las llaves foráneas es ignorado dentro de una transacción, que es donde corre cada migración. El riesgo de usar gramática no documentada lo cubre una prueba que reconstruye la base desde cero: si una versión futura de SQLite deja de aceptarla, `npm test` se cae en desarrollo y no en el mostrador. En Postgres es un `ADD CONSTRAINT` normal, contra el número `0` en vez de la cadena `'0.00'`, porque allí la columna es NUMERIC. | Prompt 14 — 2026-09-06 |
| **Los UUID de las denominaciones son fijos en la migración**, no generados en el cliente. | Sortearlos por instalación, como el resto de los id | Es la excepción correcta a la regla de UUID en el cliente: las denominaciones del quetzal son las mismas en toda instalación. Si cada terminal sorteara los suyos, el mismo billete de Q20 tendría identidades distintas y la sincronización los duplicaría. | Prompt 13 — 2026-09-06 |
| **El estado de bloqueo NO se espeja en Supabase.** Ni la tabla `bloqueos_de_autorizacion` ni las columnas `usuarios.intentos_fallidos` / `bloqueado_hasta`. La nube lleva datos de negocio; el estado operativo de una terminal se queda en SQLite. | Espejar todo el esquema por simetría, que fue el reflejo inicial | Un candado deja de significar nada 30 segundos después de escribirse: con sincronización diferida llegaría vencido. Nadie lo consultaría desde la nube, y el hecho auditable sí viaja, porque `usuario_bloqueado` y `autorizacion_bloqueada` quedan en `auditoria_log`, que sí está espejada. Con más de una terminal, sincronizarlo sería activamente dañino: el bloqueo de una caja dejaría bloqueada la otra. Y unas columnas que existieran en Postgres sin sincronizarse nunca mostrarían `0` para todos y harían creer al auditor que nadie falló jamás un ingreso. Mismo criterio que ya se había aplicado a `sync_cola`. Ver `supabase/migrations/README.md`. | Prompt 12 — 2026-09-06 |
| **El diálogo de autorización tiene su PROPIO candado, separado del candado de ingreso.** Por superficie (`bloqueos_de_autorizacion`), no por usuario. | Compartir `usuarios.intentos_fallidos` entre ambas superficies (lo que hacía la primera versión); un candado por usuario también en el diálogo | Compartido, un cajero que tocara el botón de salida y tecleara tres PIN al azar dejaba a **todos** los administradores sin poder iniciar sesión: una negación de servicio al alcance de cualquiera, comprobada con una prueba. Separarlos duplica el presupuesto de fuerza bruta (3+3 intentos cada 30 s en vez de 3), pero recorrer los 10 000 PIN sigue llevando más de medio día en ambos casos, así que no cambia nada práctico; lo que cambia es que un error de tecleo deja de paralizar la tienda. El candado del diálogo no es por usuario porque allí nadie eligió usuario: el intento es de la superficie, y un PIN equivocado cuenta **una vez** y no una por administrador. | Prompt 11 — 2026-09-06 |
| **Nunca se informan los intentos restantes, solo el tiempo para reintentar.** | Mostrar "te quedan 2 intentos" | Los intentos restantes son información útil para quien está adivinando, y para quien mira por encima del hombro la pantalla de otro. El tiempo de espera no ayuda a adivinar. | Prompt 10 — 2026-09-06 |
| **PLATAFORMA OBJETIVO: Windows manda.** Es la plataforma de producción y el criterio de aceptación final para todo lo dependiente de plataforma. macOS es solo el entorno de desarrollo. Ante un conflicto, gana Windows. | Tratar las dos plataformas como equivalentes; optimizar para macOS porque es donde se desarrolla | La tienda de Jimmy corre Windows; macOS es la máquina de Julio. Que algo funcione en macOS es una señal útil, nunca una verificación. El incidente del modo kiosko mostró el costo de no tener esto escrito: se dio por bueno un comportamiento medido en macOS sin distinguir qué parte aplicaba a Windows. | Prompt 9 — 2026-09-06 |
| **Prohibido bloquear el Administrador de tareas de Windows por cualquier vía administrativa** (directiva de grupo, `DisableTaskMgr`, Assigned Access, Shell Launcher). | Usar el modo kiosco soportado de Windows para un bloqueo "de verdad" | En Windows, una aplicación común no puede bloquear `Ctrl+Alt+Supr` (Secure Attention Sequence, protegida por el núcleo) ni `Ctrl+Shift+Esc` de forma fiable, así que el riesgo no viene de Electron. Viene de que alguien intente "mejorar" el kiosko con una función administrativa y deje al dueño encerrado fuera de su computadora. Ver la sección 4.6. | Prompt 9 — 2026-09-06 |
| **PROHIBIDO `kiosk: true` de Electron.** La pantalla completa se consigue con `fullscreen` + `frame: false`. | Usar `kiosk: true`; usarlo solo en producción; usarlo solo en Windows | En macOS, `kiosk: true` le impone al sistema operativo Presentation Options que apagan **Forzar Salida** (`disableForceQuit`) y **Cmd+Tab** (`disableProcessSwitching`). Medido: con kiosk, `currentSystemPresentationOptions = 506`; sin kiosk, `0`, y la ventana sigue igual de completa. Esto es una terminal de punto de venta, no un kiosco público: si la app se cuelga, el dueño tiene que poder matarla desde el sistema. Reproducible con `npm run diagnostico:kiosko-macos`. Ver la sección 4.5. | Prompt 8 — 2026-09-06 |
| **Todo atajo estándar de "salir" del sistema operativo se intercepta y se redirige al flujo con PIN**: `Cmd+Q`, `Alt+F4`, el botón de cerrar, el menú del Dock y cualquier `app.quit()` ajeno. | Dejar pasar `Cmd+Q`; bloquearlo sin ofrecer alternativa | `Cmd+Q` cerraba el punto de venta de inmediato, sin PIN, sin auditoría y sin consolidar la base de datos: una puerta trasera al alcance de cualquier cajero, y además una vía por la que se perdía el cierre ordenado. La intercepción vive en el proceso principal (`before-quit` y `close`), no en la interfaz, así que aplica a toda pantalla futura sin trabajo adicional. | Prompt 8 — 2026-09-06 |
| **Un único control visible de salida, en la barra de estado, esquina inferior izquierda**, que dispara el mismo flujo de PIN que el atajo. | Sin botón, solo atajo; un botón en la pantalla de ventas; un botón que cierre directo | Sin botón, un administrador que no conozca el atajo queda sin salida. En la pantalla de ventas, cualquier cajero lo vería y lo tocaría. La esquina izquierda lo aleja del botón de cobrar, que por convención va abajo a la derecha. El botón no cierra nada: le pide al proceso principal que inicie la salida, de modo que haya una sola vía auditable. | Prompt 8 — 2026-09-06 |
| Salida controlada del kiosko con atajo + PIN de administrador | Dejar la app sin salida (matar el proceso); un botón de salir en la interfaz; salida sin PIN | Sin salida ordenada había que matar el proceso desde el Administrador de tareas, lo que deja el WAL de SQLite sin consolidar y no registra nada. Un botón visible sería una invitación para el cajero. El PIN convierte la salida en una acción de administrador auditable. | Prompt 2 — 2026-09-04 |
| El atajo se captura con `before-input-event` y no con `globalShortcut` | `globalShortcut` de Electron | `globalShortcut` registra la combinación en todo el sistema operativo y se la roba a cualquier otra aplicación abierta, incluida la del desarrollador. El atajo solo debe existir mientras el POS tiene el foco. | Prompt 2 — 2026-09-04 |
| Las combinaciones de teclas se identifican por tecla FÍSICA (`code`) y no por carácter (`key`) | Comparar `key === 'q'` | En el teclado latinoamericano de Windows, AltGr es Ctrl+Alt y cambia el carácter que produce cada tecla. Comparando por carácter, el atajo del administrador simplemente no funcionaría en la computadora de la tienda. | Prompt 2 — 2026-09-04 |
| PIN de administrador provisional desde variable de entorno, con respaldo solo en desarrollo | Dejarlo fijo en el código; no pedir PIN; esperar al módulo de usuarios para tener salida | Un PIN fijo en el código es específico del cliente y no puede versionarse (ver NEGOCIO_VS_NUCLEO.md). Sin respaldo en desarrollo, cada sesión terminaría matando el proceso. En producción, sin PIN configurado la salida queda deshabilitada en vez de aceptar uno adivinable. | Prompt 2 — 2026-09-04 |
| Limitador de intentos del PIN: 3 intentos y 30 segundos de bloqueo | Sin límite de intentos | Un PIN de cuatro dígitos sin límite se adivina por fuerza bruta en minutos, y hoy el PIN es lo único que separa a un cajero de cerrar el punto de venta. Un PIN con formato inválido no consume intentos, para que nadie se autobloquee por un error de tecleo. | Prompt 2 — 2026-09-04 |
| Solo se acepta un PIN si hay una solicitud de salida viva (2 minutos) | Aceptar el PIN en cualquier momento | Sin esa ventana, una interfaz comprometida podría usar el canal IPC como oráculo para adivinar el PIN sin que nadie toque el teclado. | Prompt 2 — 2026-09-04 |
| El cierre ordenado consolida el WAL con `wal_checkpoint(TRUNCATE)` | Cerrar la conexión sin consolidar | Con WAL, las escrituras recientes viven en un archivo `-wal` aparte. Cerrar sin consolidar deja la base correcta pero repartida en dos archivos, lo que complica los respaldos y la revisión del archivo por parte del auditor. | Prompt 2 — 2026-09-04 |
| **El diseño de `docs/SINCRONIZACION.md` queda APROBADO y se implementa POR FASES. Las 17 decisiones de su sección 7 se adoptan con la recomendación del documento, salvo la 10 y la 11.** | Implementarlo todo de una vez; dejarlo en diseño hasta tener respuesta a las 17 | El documento es grande y toca la nube, la seguridad y el dinero: implementarlo entero en un prompt haría imposible verificar qué anda y qué no, que es el único mecanismo de confianza de este proyecto. Por fases, cada pedazo se prueba solo. **La 10 se resuelve retirando `traerCambios` de `SyncProvider`** —la sincronización continua es solo de subida, y bajar cambios sería tener dos escritores—, pero eso es la fase 1.b y hoy la interfaz sigue intacta. **La 11 queda ABIERTA hasta medir en hardware real**: la máquina de la tienda es un i3 y ningún número de rendimiento escrito sin medirlo ahí se da por bueno. | Prompt 29 — 2026-09-11 |
| **Bandeja de salida transaccional: la fila de `sync_cola` se escribe DENTRO de la misma transacción que el dato de negocio, con un `lote_id` compartido y `orden_en_lote` de padres a hijos.** | Encolar después del `COMMIT`; encolar desde un disparador de SQLite; recorrer las tablas buscando lo no sincronizado | Encolar después abre exactamente los dos huecos que este patrón existe para cerrar: una venta cobrada que nunca se va a subir, si el proceso muere entre el `COMMIT` y el `INSERT` de la cola, o una entrada de cola que apunta a una venta que no existe, si muere al revés. En este proyecto no es una hipótesis remota: **matar el proceso desde el sistema operativo es una vía de escape permitida a propósito** (§4.5). Un disparador habría metido la lógica de qué se sincroniza dentro del esquema, donde no se puede probar con Vitest ni leer junto al servicio que la provoca. Y recorrer tablas buscando cambios exige una marca de «sincronizado» por tabla —trece columnas nuevas espejadas en Postgres— y no sabe agrupar una venta con su detalle. El orden padres→hijos no es cosmético: al revés lo rechaza la llave foránea de Postgres y el lote queda detenido con un error que no habla del problema real. | Prompt 29 — 2026-09-11 |
| **El payload se lee de la base con `SELECT *` de la fila recién escrita, NO se reconstruye desde la entidad de dominio.** Los decimales viajan como la cadena canónica exacta y los booleanos como `0`/`1`. | Serializar el objeto de dominio; convertir cada campo con la función canónica que le toque | Reconstruirlo obligaría a acertar, en cada una de las trece tablas y columna por columna, cuál de las tres conversiones canónicas corresponde —`montoACadena`, `cantidadACadena` o `aColumnaExacta`—, y equivocarse en una sola mandaría a la nube un `2.5` donde la base tiene `2.500`, o un número de JavaScript donde la base tiene una cadena exacta. Leyendo de la base **no hay conversión que pueda equivocarse, porque no hay conversión**: el payload es byte a byte lo que quedó guardado. Es el mismo criterio por el que `decimal-columns.ts` es la única vía para leer y escribir columnas decimales, llevado un paso más lejos. | Prompt 29 — 2026-09-11 |
| **La Fase 1.a le agregó su PRIMERA transacción a SEIS servicios que no tenían ninguna.** Caja, categorías, productos, usuarios, límites de descuento y configuración del negocio. | Encolar sin transacción en esos seis; envolver solo la venta, que ya la tenía | El prompt pedía «reutilizá el punto de transacción existente en cada servicio» y **ese punto no existía**: medido antes de tocar nada, el único servicio que recibía la conexión y abría una transacción era `ServicioDeVenta`; los otros seis escribían su fila de negocio y su asiento de auditoría como sentencias sueltas. Sin transacción, la bandeja de salida no ofrece ninguna garantía, que es su única razón de ser. Agregarla **cerró además un hueco de atomicidad preexistente que nadie había mirado**: hasta hoy, matar el proceso entre las dos escrituras dejaba una caja abierta sin el arqueo con que se abrió, o un usuario dado de baja sin el asiento que dice quién lo hizo. El envoltorio es uno solo, `conBandejaDeSalida`, para que los seis tengan la misma forma; la venta y los recibos no lo usan, y se explica por qué en §4.17. | Prompt 29 — 2026-09-11 |
| **`configuracion_negocio` se encola con `operacion = 'actualizar'`, no `'update'` como decía el prompt.** | Escribir `'update'` y ampliar el CHECK para aceptarlo | No es una decisión de diseño distinta: es el nombre correcto de la misma. El CHECK de `sync_cola` acepta `'insertar'`, `'actualizar'` y `'eliminar'` desde la migración 001, en español como todo el vocabulario de dominio del proyecto. Ampliar el CHECK para meter un cuarto valor en inglés que significa lo mismo que uno que ya existe habría dejado dos formas de decir lo mismo en la misma columna. | Prompt 29 — 2026-09-11 |
| **`precios_especiales` NO se encola en esta fase, porque en producción nada la escribe.** | Inventar un servicio de precios especiales para poder encolar algo; encolar desde las pruebas | El diseño la lista entre las tablas sincronizables y el prompt pedía encolar «crear/editar precio especial», pero **no hay servicio, ni canal IPC, ni pantalla** que cree uno: la tabla se llena solo desde las pruebas. La venta sí los lee y los aplica, así que la funcionalidad existe a medias. Inventar el servicio para cumplir la letra del prompt habría sido construir un módulo que nadie pidió, con sus reglas de vigencia y autorización decididas por cuenta propia. La tabla queda declarada como sincronizable, lista para el día que exista la pantalla, y el hueco queda anotado como pendiente. | Prompt 29 — 2026-09-11 |
| **DECISIÓN 10 EJECUTADA: `traerCambios(desde)` se retira de la interfaz `SyncProvider`.** La restauración tendrá la suya propia en la fase 4.b. | Dejarlo por si algún día hace falta; renombrarlo a `traerTodoParaRestaurar` y reusarlo | El método existía desde el Prompt 1 y **nunca lo llamó nadie**: era una bajada incremental prevista cuando todavía no se había decidido la dirección de la sincronización. El diseño la decidió —solo subida (§2.2)—, porque bajar cambios contra una base que la terminal también escribe sería tener dos escritores, y resolver esos conflictos es un problema que este sistema no necesita tener. **Dejarlo no era gratis:** un método que existe invita a usarse, y el día que alguien lo llamara estaría reintroduciendo la bajada descartada sin que nada fallara. Renombrarlo tampoco servía: la restauración no es incremental, no corre en segundo plano y tiene precondiciones propias (§6.2 del diseño); meterla en la misma interfaz sería confundir dos operaciones distintas por parecerse en la dirección. Hay una prueba que comprueba que el método ya no está **en el objeto**, no solo en el tipo, porque los tipos desaparecen al compilar. | Prompt 30 — 2026-09-11 |
| **Un lote determinístico DETIENE la cola entera y no se reintenta solo; uno transitorio espera la escalera de §3.2 y no deja pasar a nadie por delante.** | Saltar el lote roto y seguir con los siguientes; reintentar el determinístico con backoff, como cualquier otro fallo | Saltarlo dejaría un hueco **silencioso** en el respaldo: parecería completo y no lo estaría, y con las llaves foráneas es probable que las siguientes también fallaran o, peor, que subieran referenciando algo que no llegó. Una cola detenida y **visible** es un problema que alguien va a ver; un hueco silencioso es un problema que nadie va a ver hasta el día del robo. Es el mismo criterio de «cero reintentos automáticos» del conflicto de inventario (§4.3): no tapar el defecto, mostrarlo. Y reintentar en bucle algo que la nube ya dijo que es inválido es ruido que además consume la cuota del plan gratuito. **El transitorio tampoco deja pasar al de atrás**, por la misma razón del orden: el lote que falló es el más viejo, y adelantar al siguiente sería saltearlo. Hay pruebas de las dos mitades, incluida una que deja pasar un año de reloj y comprueba que el lote bloqueante sigue sin reintentarse. | Prompt 30 — 2026-09-11 |
| **La clasificación de fallos viaja por CÓDIGO HTTP, no por el texto del error**, y por eso `ResultadoEmpuje` gana `estadoHttp`. La ausencia de código se lee como transitorio. | Clasificar leyendo el mensaje de error; que el adaptador devuelva ya clasificado el fallo | Un texto de error no se puede clasificar sin adivinar, y adivinar mal en una dirección detiene la cola por una caída de internet, y en la otra la deja reintentando en bucle algo inválido. El código lo dice sin ambigüedad y es lo que §3.2 usa. **La ausencia de código es el caso más común de todos** —no hubo respuesta porque no hubo red— y por eso su lectura por omisión es «transitorio»: leerlo al revés detendría la cola cada vez que se cae el internet de la tienda, que es justamente el escenario para el que la cola existe. No se le delega la clasificación al adaptador porque es una política del negocio —qué se considera recuperable— y no un detalle de transporte: dos adaptadores podrían clasificar distinto y la cola se comportaría distinto según con quién hablara. | Prompt 30 — 2026-09-11 |
| **El trabajador cede ante una venta en curso, detectada con una bandera en memoria que el servicio de venta levanta y baja.** No con `base.inTransaction` ni con un bloqueo de SQLite. | Leer `base.inTransaction`; confiar en que better-sqlite3 serialice; una segunda conexión para el trabajador | `base.inTransaction` dice exactamente lo que hace falta saber, pero **solo es verdad mientras el hilo está dentro de la transacción**: para cuando el trabajador lo leyera desde un temporizador, la transacción ya terminó. Y el peligro no es la contención de bloqueos: **la aplicación tiene UNA sola conexión**, así que un ciclo lanzado dentro de una transacción abierta lee las filas que esa transacción todavía no confirmó, y si después se revierte la nube se queda con un cambio que en la tienda no ocurrió. **Está probado por falsificación**, no razonado: una prueba apaga la señal a propósito, lanza el ciclo desde dentro de una transacción que después falla, y comprueba que la fila no existe en la base y que la nube la recibió igual. Una segunda conexión cambiaría el problema por otro peor —dos escritores sobre el mismo archivo, que es lo que la instancia única del proyecto evita desde el Prompt 1—. La bandera se baja en un `finally`: si no lo hiciera, una venta fallida dejaría al trabajador cediendo para siempre y la cola no volvería a subir nada, en silencio. | Prompt 30 — 2026-09-11 |
| **«No bloquea la interfaz» se PRUEBA con un latido que mide el hueco más largo del bucle de eventos, no se afirma.** | Confiar en que `async` alcanza; medir solo la duración total del ciclo | La duración total no dice nada: un ciclo de tres segundos que suelta el bucle cada 200 ms es inofensivo, y uno de un segundo que no lo suelta congela la caja. Lo que importa es el hueco MÁS LARGO entre dos oportunidades de atender el IPC de la ventana, porque en el proceso principal de Electron es el mismo hilo. Un `setInterval` de 1 ms durante un ciclo de 20 lotes mide justamente eso. **Un ciclo sano da 2 ms de forma reproducible y el umbral quedó en 15**; se comprobó que la prueba muerde reemplazando la pausa por una espera ocupada de 20 ms. | Prompt 30 — 2026-09-11 |
| **La sincronización corre CUANDO TIENE SENTIDO, sin intervalo fijo, y al cerrar la aplicación se DETIENE en vez de apurarse.** | Un `setInterval` cada N minutos; vaciar la cola antes de cerrar | Con la cola vacía no se agenda nada: una máquina al día no tiene por qué gastar un ciclo —ni un byte, cuando haya red— en preguntar si podría subir algo que no tiene, y menos en un i3 de 2011. Los disparadores son los de §2.4, y los 2 segundos tras el COMMIT existen para **no competir con el recibo**, que se está generando en ese mismo instante (§4.14); además agrupan, así que una ráfaga de ventas dispara un ciclo y no cinco. **Vaciar la cola al cerrar sería un error**: dejaría la salida controlada esperando a una red que puede no estar, justo cuando alguien pidió cerrar el punto de venta, y no hace falta porque la cola vive en SQLite y el trabajador retoma exacto donde quedó. El aviso de «hay algo que subir» sale de un solo lugar, la bandeja de salida, que es el único código que escribe la cola; corre dentro de la transacción y por eso lo único que puede hacer es agendar un temporizador. | Prompt 30 — 2026-09-11 |
| **CORREGIDO: la señal de «hay una transacción abierta» es de TODA operación de negocio, no solo de la venta, y se levanta dentro del ÚNICO envoltorio que abre transacciones.** | Dejarla solo en la venta, como nació en la fase 1.b; levantarla a mano en cada uno de los ocho servicios | **Nació específica de la venta y estaba mal.** El peligro no tiene nada que ver con vender: es consecuencia de que la aplicación tenga **una sola conexión**, así que un ciclo del trabajador lanzado dentro de cualquier transacción abierta lee filas sin confirmar, y si esa transacción se revierte la nube se queda con un cambio que en la tienda nunca ocurrió. Proteger solo la venta dejaba las otras siete operaciones con el mismo agujero **y la falsa sensación de que estaba cubierto**, que es peor que no tener nada. Levantarla a mano en cada servicio sería garantizar que el noveno se olvide: por eso va dentro de `enTransaccionDeNegocio`, y quien no use el envoltorio no «olvida la señal», directamente no abre transacción. Hay una prueba que revisa el código fuente y exige que solo el envoltorio, el migrador y los guiones de ejemplo nombren `.transaction(`; el riesgo que cubre no es el código de hoy sino el servicio que alguien agregue el año que viene. La generalización está **probada por falsificación en tres servicios distintos** —categoría, apertura de caja y alta de usuario—, cada una con su contraparte con la señal puesta. | Prompt 31 — 2026-09-11 |
| **Se quitó la segunda comprobación de «hay transacción abierta»: eran duplicación, no defensa en profundidad, y se midió.** Queda una sola, al principio de cada vuelta del bucle. | Dejar las dos «por si acaso»; dejar solo la de entrada | **Se midió quitando cada una por separado y las 74 pruebas pasaban en los dos casos**: ninguna estaba fijada por una prueba, y el conjunto solo demostraba «existe al menos una de las dos». La del bucle cubre por completo lo que cubría la de entrada, porque corre antes de CADA lote incluido el primero, así que la de entrada era el subconjunto. Dos comprobaciones que ninguna prueba puede distinguir son dos lugares donde tocar cuando esto cambie y una sola prueba que se cree que protege dos cosas. **Y se dice en voz alta que la posición en el bucle no agrega nada hoy**: con un solo hilo y una conexión síncrona, la continuación de un `await` no puede colarse dentro de un bloque síncrono, así que la señal solo puede estar levantada si el ciclo se lanzó desde adentro. Se deja en el bucle porque cuesta leer un booleano y porque es el lugar correcto el día que la premisa cambie. Con una sola, quitarla **hace fallar dos pruebas**, que es lo que antes no pasaba con ninguna. | Prompt 31 — 2026-09-11 |
| **Todo ciclo de sincronización queda anotado en la bitácora TÉCNICA, no solo los que fallan.** | Anotar solo los fallos; no anotar nada; anotarlo en `auditoria_log` | Sin un renglón por ciclo no hay forma de saber si el trabajador está corriendo: fue exactamente lo que faltó para poder afirmar que el cableado funcionaba en la aplicación real, y por eso se agregó. El volumen es bajo porque los ciclos corren cuando tiene sentido y no cada N minutos. Va a `log-tecnico.log` y **nunca a `auditoria_log`**: que la nube esté al día o no es infraestructura, y ensuciar con eso la única tabla que un auditor lee entera es el error que §4.14 ya rechazó para los fallos de impresión. | Prompt 31 — 2026-09-11 |
| **Todo lo que toca la nube se prueba primero en un proyecto de Supabase SEPARADO y descartable, `pos-pruebas-descartable`, montado desde los mismos archivos de migración.** | Probar contra `pos-jimmy-cano` «con cuidado»; una rama de Supabase; no probar las funciones contra Postgres real | Probar funciones y políticas exige insertar, ver qué rechazan y borrar, y en el real rige «nunca se borra». Un proyecto aparte con el MISMO esquema —no hay un esquema «de pruebas», hay un esquema y dos proyectos— hace posible lo que el real prohíbe. Costó pausar `dembow-ay-lupita`, ajeno a este trabajo, porque el plan gratuito permite dos proyectos activos. Es descartable por diseño: si se pausa solo o se pierde, se recrea en minutos desde las migraciones. Detectó de paso que el cambio de la `0022` estaba en el real sin archivo. | Prompt 32 — 2026-09-11 |
| **Los huecos de numeración de las migraciones tienen DOS direcciones, y el README las lista por separado.** Las `0019` a `0023` son las primeras que solo existen del lado de la nube. | Renumerar; una sola tabla de huecos; reservar números «por si acaso» | Hasta la fase 2.a todo hueco era «local sin espejo»: estado operativo de la terminal. Con `recibido_en` apareció lo contrario: algo que la nube tiene que tener y la terminal no puede tener. Sin distinguir las dos direcciones, una sesión futura leería un hueco como «falta escribir el espejo» y lo escribiría. Cada archivo de la dirección 2 lleva en la tabla la razón concreta de por qué no hay migración local, y el número usado en una dirección queda reservado en la otra. | Prompt 32 — 2026-09-11 |
| **`recibido_en` va en doce tablas, no en trece: `denominaciones` queda afuera.** Corrección de Julio. | Ponerla en las trece «por simetría» | La terminal nunca escribe `denominaciones`: las once del quetzal viven en la nube desde la `0004` con UUID fijos. Una marca de recepción en una tabla que nadie recibe es una columna que nunca significa nada, y la restauración (§6.5 del diseño) la leería como si algo hubiera llegado. En el README quedó la razón, no solo el cambio. | Prompt 32 — 2026-09-11 |
| **RIESGO 8.4 MEDIDO: `INSERT ... ON CONFLICT DO NOTHING` bajo RLS SÍ exige política de `SELECT`, aunque no haya conflicto. Consecuencia: TODO lote sube por una función `SECURITY DEFINER`, y la terminal no tiene política directa sobre ninguna tabla.** | Darle `SELECT` a la terminal sobre `ventas`, `venta_detalle`, `recibos` y `auditoria_log`; insertar sin `ON CONFLICT` y tratar el duplicado como error; una `service_role` en la terminal | Medido como `authenticated` con los claims de la terminal, en SQL directo y por PostgREST: `42501` con solo `INSERT`; pasa con `INSERT` + `SELECT`. Conceder `SELECT` es exactamente lo que §1.5 del diseño evita: con la credencial robada se leerían las ventas y toda la auditoría. Tratar el duplicado como error rompe la idempotencia de §3.1, que es lo que hace seguro reintentar. Una `service_role` en la terminal es la credencial que ignora RLS entera. La función DEFINER pasa por encima de RLS con la forma exacta de cada operación, y las políticas de 2.c quedan reducidas a `SELECT` para `restauracion`. Se detuvo el trabajo y se avisó antes de decidir, como pedía el prompt. | Prompt 33 — 2026-09-11 |
| **`sincronizar_venta` es `SECURITY DEFINER` (no INVOKER, como preveía §4.3 del diseño) y nace `sincronizar_lote_simple` para el catálogo, los topes, la configuración y los recibos, con LISTA CERRADA de tablas y regla de conflicto POR TABLA.** | Una función genérica `sincronizar_lote(jsonb)` que acepte cualquier tabla con una sola regla de upsert; una función por tabla | Como INVOKER, el `DO NOTHING` de `ventas` exigiría `SELECT` (8.4). Una función genérica sería una puerta a cualquier tabla —incluida `usuarios`— con la credencial de la terminal, y una sola regla de upsert es imposible: `auditoria_log` exige `DO NOTHING` porque su trigger `BEFORE UPDATE` abortaría un `DO UPDATE` aunque los valores fueran idénticos, comprobado como control. `escribir_fila` no tiene valor por omisión: cada función dice `actualizar` o `ignorar` fila por fila. Una función por tabla multiplicaría la superficie DEFINER sin ganar nada. | Prompt 33 — 2026-09-11 |
| **Las funciones no enumeran columnas y exigen el payload EXACTO: `jsonb_populate_record` sobre el tipo de la tabla; `exigir_claves_conocidas` rechaza con nombre una columna de más o de menos; `recibido_en` no puede venir; y las columnas `jsonb` reciben el texto JSON de SQLite ya parseado.** | Listar las columnas en cada función; aceptar claves sobrantes en silencio; dejar que el trigger pise `recibido_en` | Enumerar columnas es lo que la sección 9 del diseño quiere evitar: cada columna nueva exigiría tocar la función. Pero `jsonb_populate_record` ignora en silencio una clave que la tabla no tiene, y el silencio es lo prohibido: por eso el payload tiene que ser exactamente las columnas. Las dos últimas reglas salieron de MEDIR, no de diseñar: `auditoria_log.valor_nuevo` llegaba como cadena y quedaba como un jsonb que contiene un texto —la regla es por tipo de columna leído del catálogo—, y un payload con `recibido_en` pasaba y el trigger lo pisaba sin ruido; la batería lo encontró y ahora se rechaza. | Prompt 33 — 2026-09-11 |
| **Repetir el MISMO lote es un no-op con constancia (`sin_cambios` / `ya_existia`, misma huella); mandar OTRO lote con el mismo id se rechaza.** Cada función devuelve por fila resultado, huella md5 y `recibido_en`. | Rechazar todo lote cuyo id ya exista (§1.5.1 al pie de la letra); aceptar cualquier reescritura (upsert puro) | §1.5.1 decía «rechazar una caja que ya exista» y §3.1 decía «repetir un lote da el mismo estado»: leídas literalmente se contradicen, porque una respuesta 2xx perdida obliga a repetir. «Mismo» se decide comparando la fila TIPADA del payload con la guardada, sin `recibido_en`, así que un reintento pasa y una reescritura de un cierre hecho no. La constancia existe porque la terminal no puede leer las tablas: es la única forma de afirmar sobre el estado sin `SELECT`. | Prompt 33 — 2026-09-11 |
| **`contrato_de_sincronizacion` es `SECURITY INVOKER`, no DEFINER como decía el diseño.** | DEFINER, como las de escritura | Solo lee `pg_catalog`, que no tiene RLS ni filtro por privilegio: no necesita pasar por encima de nada. Una función DEFINER menos es un aviso menos del linter y una superficie menos que cuidar. Sigue exigiendo el rol `restauracion` en la primera línea, y así se midió: 403 para la terminal y para el usuario sin rol. | Prompt 33 — 2026-09-11 |
| **La prueba de deriva vive en dos mitades con una FOTO en el repositorio (`supabase/esquema-nube.json`), y la foto se toma A PROPÓSITO con `--tomar-foto`: el guion no la regenera solo.** | Una sola prueba con red en `npm test`; regenerar la foto en cada corrida, como sugería §9.2 del diseño | `npm test` no puede depender de la nube (§4, punto 4). Regenerar la foto cuando coincide es un no-op, y regenerarla cuando NO coincide taparía «alguien tocó la nube desde el panel»: la foto cambia solo por un commit que alguien lee. Las exclusiones de la mitad A salen de `COLUMNAS_EXCLUIDAS`, la misma lista que arma los payloads, para que no haya dos listas que puedan derivar. Cubre las cinco funciones, el contrato, los ayudantes y la versión, y se comprobó que muerde con una foto manipulada. | Prompt 33 — 2026-09-11 |
| **El seguro del modo destructivo de `verify:nube`: lista FIJA en `scripts/proyectos-de-prueba.cjs`, la referencia de `pos-jimmy-cano` prohibida POR NOMBRE antes de mirar la lista, la URL cotejada con la referencia, y negativa total si la lista llegara a contener el real.** | Una variable de entorno o un argumento `--proyecto`; solo la lista, sin nombrar al real | Equivocarse de proyecto tiene que ser imposible, no improbable (§9.5). Una variable de entorno se pisa y un argumento se tipea. Nombrar al real aparte hace que ni agregarlo a la lista lo habilite: la lista envenenada se rechaza entera. La URL se coteja porque sin eso alguien podría declarar la referencia de prueba y apuntar al real. Vive en su propio módulo para que las diez pruebas de Vitest ejerciten la misma función que usa el guion, y una comprueba que el guion la llame antes de crear el cliente de red. Se probó que muerde con el guion real: código 3, sin peticiones. | Prompt 33 — 2026-09-11 |
| **Las funciones se prueban ÚNICAMENTE con red, contra el proyecto de pruebas, con `npm run verify:nube -- --destructivo`; y se dice lo que no se ejercitó: el reinicio con `service_role`.** | Simular Postgres en Vitest; probar contra el real «con cuidado» | Vitest corre contra SQLite y no sabe nada de RLS, `auth.jwt()` ni triggers: cualquier simulación probaría la simulación. La batería son 67 comprobaciones por PostgREST con los JWT reales de los tres usuarios; antes, 91 mediciones en SQL directo. La `service_role` del proyecto de pruebas no está en esta máquina —la pone Julio si quiere que el guion vacíe por su cuenta—, así que el reinicio se hizo por SQL y con `--reinicio-hecho`, y ese código queda escrito y no visto correr. `auditoria_log` no se puede vaciar por PostgREST ni con `service_role`: es inmutable; se trunca por SQL. | Prompt 33 — 2026-09-11 |
| **El JWT de 15 minutos (decisión 2 del diseño) NO se pudo aplicar desde acá: es configuración de Auth, fuera del alcance del conector y del código. Queda pendiente en el panel, y la batería lo mide y FALLA mientras siga en 3600.** | Darlo por hecho; quitar la comprobación para que la batería pase en verde | Una batería en verde con un JWT de una hora diría que la nube está como pide el diseño, y no lo está. La comprobación falla a propósito hasta que se cambie en Project Settings → JWT Keys → Legacy JWT Secret → «Access token expiry time» —primero en el de pruebas, después en el real—, y `--esperar-vencimiento` comprueba que un token efectivamente venza. **CERRADO: el de pruebas el 2026-09-12 y el real el 2026-09-13, los dos medidos acuñando un token; y `--esperar-vencimiento` ya se corrió y pasa, después de corregir el margen del guion (§4.22).** | Prompt 33 — 2026-09-11 |
| **La `0024` revoca los privilegios de tabla con `REVOKE ALL` + `GRANT SELECT`, no con una lista de privilegios; se aplicó y midió en `pos-pruebas-descartable` sin cambiar ningún comportamiento de función.** | Enumerar los privilegios a revocar; revocar también `SELECT`; escribir la migración directo contra el real | Supabase concede a `anon` y `authenticated` los OCHO privilegios de tabla de Postgres 17. La primera versión de la `0024` enumeraba seis y **se le escapó `MAINTAIN`**, nuevo en PG17, que no aparece en `information_schema.role_table_grants` y sí en `pg_class.relacl` (la letra `m`); se vio leyendo `relacl` tras aplicarla. `REVOKE ALL` seguido de `GRANT SELECT` no puede dejar un privilegio afuera y sobrevive a que Postgres agregue otro mañana. `SELECT` se conserva para `authenticated` porque terminal y restauración son el MISMO rol de Postgres —el rol es un claim del JWT— y quién lee lo decide RLS. El criterio de aplicación fue que la misma batería, antes y después, diera lo mismo en TODAS las funciones: medido, 90/93 filas del arnés SQL byte a byte iguales (cambian solo los dos marcadores de privilegios y la sonda 152, de «viola RLS» a «permission denied», mismo `42501`) y 67/67 en PostgREST, con las tres sondas de acceso directo pasando de RLS a «permission denied». Queda anotado lo que NO cubre: el `pg_default_acl` del rol de plataforma `supabase_admin`, que `postgres` no puede alterar. Aplicada solo en el proyecto de pruebas; en `pos-jimmy-cano` va en la fase 2.c. | Prompt 34 — 2026-09-12 |
| **La `0023` y la `0024` se aplicaron a `pos-jimmy-cano` el 2026-09-12, y lo que prueba que se aplicó lo correcto NO es el texto de la migración sino la huella de los OBJETOS: las 13 definiciones de función del real comparadas una a una con las del proyecto de pruebas.** | Confiar en que el texto enviado al conector era el del archivo; comparar solo el md5 del registro de `schema_migrations`; pedirle a Julio que las pegara a mano en el editor SQL del panel | Aplicar una migración de 43 KB por el conector obliga a que el texto pase entero por la sesión, y una diferencia de un byte produciría en producción funciones parecidas pero distintas. El md5 del registro detecta eso, pero mide **la entrada**; lo que importa es **el efecto**. Por eso la verificación fuerte es `md5(pg_get_functiondef(oid))` de las trece funciones contra las del proyecto de pruebas: dio **13 de 13**, y el md5 de los dos registros coincidió además con el de los archivos (`a77ae682…` y `5286ab2a…`). Se sumó una tercera comprobación independiente del mecanismo: la huella canónica del contrato que declara cada nube, que dio `81b685b17f47750bb6c56812ae89c99e` en el real, en el de pruebas y en `supabase/esquema-nube.json`. La aplicación se hizo con el real en 0 filas de negocio, y se comprobó que siguiera en 0 después. **La batería destructiva NO se corrió contra el real, y no puede correrse**: el seguro la rechaza por nombre, el real no tiene usuarios de Auth, y escribiría asientos en `auditoria_log`, que es inmutable por trigger y solo se vacía con TRUNCATE. En su lugar se corrieron 40 sondas que no escriben nada. | Prompt 35 — 2026-09-12 |
| **La fase 2.c crea UNA sola clase de política: `SELECT` para `restauracion`, sobre las 13 tablas. Para la terminal, ninguna política sobre ninguna tabla, y el catálogo NO recupera el `UPDATE` directo de la decisión 14.** | Implementar la tabla ORIGINAL de §2.3, que le daba al catálogo `INSERT`/`UPDATE`/`SELECT` directos; escribir además políticas de escritura para las otras tablas | El prompt pedía «el catálogo conserva UPDATE directo (decisión 14)», y **esa es la versión superada** del documento: §2.3 lleva desde la fase 2.b un encabezado que dice «SUPERADA EN LA FASE 2.b, POR LA MEDICIÓN DEL RIESGO 8.4», y el propio §7 marca la decisión 14 como «SUPERADA por la medición de 8.4: sí van por función». Implementarla al pie de la letra habría **roto lo que ya funciona**: todo lote de catálogo lleva su asiento de `auditoria_log`, y el `ON CONFLICT DO NOTHING` de ese asiento exige `SELECT` sobre la auditoría entera —medido—, que es justo lo que §1.5 evita; y además crearía un segundo camino de escritura para tablas que `sincronizar_lote_simple` ya escribe con su auditoría y su lista cerrada. **Políticas de escritura tampoco se escriben**, y no por olvido: después de la `0024`, `authenticated` solo tiene `SELECT`, así que una escritura muere en el privilegio antes de llegar a RLS; una política ahí sería una regla para un camino cerrado. Las trece se crean con la condición IDÉNTICA y hay una comprobación que exige `count(DISTINCT qual) = 1`. | Prompt 36 — 2026-09-13 |
| **Storage: dos buckets PRIVADOS; la terminal solo SUBE fotos; nadie borra; y el bucket `recibos` se crea sin ningún permiso para la terminal.** | Buckets públicos, que es lo cómodo; darle a la terminal también lectura de sus fotos; conceder ya la subida de PDF | Un bucket público sirve sus objetos a cualquiera que consiga la URL, sin pasar por RLS, y un recibo lleva lo que compró una persona con su total. Que la terminal no lea las fotos que sube no es una limitación sino la forma correcta: §2.5.2 dice que una foto en una ruta es inmutable y que se sube sin `x-upsert`; medido contra la nube, la segunda subida a la misma ruta contesta `KeyAlreadyExists` —que el diseño lee como éxito de un reintento— y con `x-upsert` la rechaza RLS. Sobre `recibos` no se concede nada porque **§2.5.3 recomienda no subir los PDF** (son dato derivado y llenan el gigabyte del plan gratuito en unos ocho meses) y la decisión todavía no está tomada: rige el valor por omisión del proyecto, el permiso que no se pidió no se concede. Queda anotado que en `storage.objects` la única capa es RLS —la `0024` solo cubrió `public`— y que un bucket **no se borra por SQL**: lo impide el trigger `protect_buckets_delete`. | Prompt 36 — 2026-09-13 |
| **CORREGIDO durante la falsificación: «la restauración lee X» no mordía, porque sin política un SELECT no falla, devuelve 200 con la lista vacía.** Ahora exige ver filas. | Dejar la comprobación mirando solo el código HTTP | Se borró `restauracion_lee_ventas` a propósito para ver si la batería lo notaba, **y no lo notó**: la comprobación afirmaba «lee» cuando lo único que había verificado es que la consulta no diera error. Es exactamente la clase de prueba que este proyecto considera peor que no tener prueba, porque da confianza sin darla. Corregida, exige `datos.length > 0` en las doce tablas que la batería deja con filas —`precios_especiales` queda vacía porque en producción nada la escribe (§4.17)— y borrar esa única política hace fallar exactamente una comprobación, que nombra la tabla y muestra `leer 200 []`. | Prompt 36 — 2026-09-13 |
| **En `storage.objects` NO se puede revocar el privilegio de `anon`, y en vez de dejar un `REVOKE` que no revoca se puso una política RESTRICTIVA.** | Dejar el `REVOKE ALL ON storage.objects FROM anon` en la migración, que es lo que se pidió y lo que «parece» aplicarse; revocar también a `authenticated`; no poner nada | El `REVOKE` **no lanza error y no hace nada**: el `relacl` muestra `anon=arwdDxtm/supabase_storage_admin`, y un `REVOKE` solo quita lo que concedió quien lo ejecuta. `postgres` no es miembro de `supabase_storage_admin`, `GRANTED BY` da «grantor must be current user» y `SET ROLE` da «permission denied to set role». **Dejarlo habría sido lo peor de las tres opciones**: una migración que aparenta cerrar una puerta y no la cierra es exactamente el guion que sale en silencio y miente sobre lo que hizo, la clase de cosa que este proyecto ya prohibió en §4.11. La política restrictiva da la misma defensa en profundidad y sí está en nuestra mano: no concede nada, se combina con Y contra las permisivas, y ninguna permisiva futura la pasa por encima. **Falsificada con un control**: con la restrictiva puesta, `anon` no sube ni con una permisiva abierta encima; quitándola, con la misma permisiva, sube y lista los objetos. A `authenticated` no se le toca porque la terminal NECESITA `INSERT`; medido, su subida funciona idéntica antes y después. | Prompt 37 — 2026-09-13 |
| **«Privado» es un ESTADO del bucket que se cambia desde el panel, no una garantía que la migración sostenga; queda documentado y no se agrega ningún mecanismo.** | Agregar un disparador o una comprobación periódica que vuelva a poner `public = false`; no decir nada | `public` es una columna de la fila del bucket y el panel la cambia con un interruptor, sin pasar por ninguna migración de la carpeta y sin pasar por RLS. Si alguien marca `fotos` o `recibos` como público, Storage sirve esos objetos por una ruta que **no evalúa ninguna de las cuatro políticas de la `0026`**, y la migración seguiría figurando como aplicada: ni la restrictiva de `anon` ni la ausencia de permisos de la terminal se enterarían. No se agrega mecanismo porque no hace falta hoy y porque un vigilante automático sería otra pieza que mantener; lo que sí hace falta es que esté **dicho**, para que el día que un archivo aparezca donde no debería, lo primero que se mire sea si el bucket sigue privado. | Prompt 38 — 2026-09-13 |
| **La `0025` y la `0026` aplicadas en `pos-jimmy-cano`, y con ellas la fase 2.c queda completa del lado del SQL. Lo que falta son dos pasos del panel, y se documentan como no opcionales.** | Darla por cerrada al aplicar las migraciones; dejar los pasos del panel como una nota al pie | Las trece políticas conceden lectura a quien traiga `app_metadata.rol = 'restauracion'`, y el real tiene **cero usuarios de Auth**: aplicadas y todo, hoy no le sirven a nadie. Se midió en el real, con los claims simulados sobre `denominaciones`: sin rol 0 de 11, con rol terminal 0 de 11, con rol restauración pero anónimo 0 de 11, con el claim correcto **11 de 11**, y la llave publicable `42501`. Es decir, la política discrimina bien y **el paso manual es la mitad que falta del mecanismo**, no un trámite. El otro paso es el JWT de 900 s. El linter confirmó lo previsto: los 13 avisos INFO `rls_enabled_no_policy` desaparecieron. | Prompt 38 — 2026-09-13 |
| **`MARGEN_DE_VENCIMIENTO_MS` pasa de 10 s a 90 s, porque se midió una COTA: un token vencido no sobrevive más allá de ~32 s del `exp`. El fallo de la sonda era del guion, no de la nube.** *(Enunciado corregido el 2026-09-13: la versión original de esta fila decía «se MIDIÓ que tolera ~30 s», y los 30 son una inferencia dentro de la cota, no una medición. Ver §4.22.)* | Dar por buena la primera corrida y reportar que la nube no hace cumplir el vencimiento; subir el margen a un número cómodo sin medir la tolerancia; quitar la comprobación | La sonda falló diciendo que un token vencido seguía siendo aceptado, y **leída al pie de la letra acusaba a la nube de una falla de seguridad que no tiene**. Se descartaron las hipótesis midiendo, no razonando: el reloj de esta máquina resultó ir **1.9 s ATRASADO** respecto del servidor, o sea al revés de lo que haría falta para explicarlo; y una prueba A/B con dos tokens —uno usado antes de vencer y otro **nunca tocado**— dio `401 PGRST303` en los dos a los 60 s del `exp`, así que tampoco hay caché y el vencimiento **sí** se hace cumplir. Quedaba una tolerancia de reloj entre 10 s y 60 s, y se midió con un token nunca usado presentado cada 5 s: **dejó de servir entre los 25 s y los 30 s de esta máquina**, o sea entre 27.9 s y 32.9 s del servidor, compatible con los 30 s exactos que es el valor habitual. El margen queda en 90 s —tres veces la tolerancia medida— con la medición escrita al lado en el código; el costo es minuto y medio en un guion que ya espera el vencimiento entero. **La lección es la contracara de la regla de falsificar:** así como una prueba que nunca se vio fallar no prueba nada, una prueba que falla tampoco prueba nada hasta saber POR QUÉ falla. Ver §4.22. | Prompt 39 — 2026-09-13 |
| **La vida del access token se mide con `exp - iat` (reloj del SERVIDOR) y NUNCA con `exp - Date.now()`.** La renovación se agenda al 75 % de esa vida, con un `setTimeout` relativo. | La forma evidente, `exp - Date.now()`, que es lo que escribiría cualquiera; usar `expires_in` de la respuesta; renovar tarde y confiar en la tolerancia de 30 s de PostgREST | `exp - Date.now()` mezcla un instante del servidor con uno de ESTA máquina, y §1.6 del diseño advierte que un equipo de escritorio se desfasa minutos u horas. **Las dos direcciones rompen, y rompen distinto**: con el reloj adelantado una hora la resta da negativo y la aplicación renovaría **en bucle cerrado** contra Auth —un fallo que no se ve, porque la aplicación parece funcionar mientras consume la cuota—; con el reloj atrasado una hora renovaría mucho después de que el token murió. `exp - iat` son dos instantes del MISMO reloj, así que la resta es exacta aunque la máquina crea que es 1998, y un `setTimeout` es relativo y tampoco mira el reloj de pared. `expires_in` también sería inmune al desfase pero depende de que el campo venga y de cuánto tardó la respuesta; `exp - iat` no depende de ninguna de las dos cosas. Y **no se renueva tarde apostando a la tolerancia medida de 30 s**, porque es comportamiento de la plataforma y puede cambiar sin avisar. El desfase SÍ se calcula, pero solo para anotarlo en la bitácora cuando pasa esa tolerancia: es diagnóstico del riesgo 8.5, no una entrada del cálculo. **Falsificado**: reemplazando el cálculo por la forma ingenua caen 8 pruebas, las cuatro del bloque del reloj entre ellas. Ver §4.23. | Prompt 40 — 2026-09-13 |
| **La escalera de reintentos de la RENOVACIÓN es propia (5 s, 15 s, 45 s, techo de 1 min) y NO se reusa la de `reintentos.ts`.** | Reusar `ESCALERA_DE_ESPERA_MS`, que ya existe y ya está probada | La de la cola sube hasta **una hora** entre intentos, y es lo correcto allá: un lote que no subió hoy sube mañana y no se pierde nada. Acá el access token muere a los 900 s, así que un peldaño de 30 minutos significaría **no intentar ni una sola vez** dentro del colchón que queda antes del vencimiento. **La forma de la escalera la impone la vida del token, no la paciencia de quien espera.** Los peldaños elegidos entran seis veces en los 225 s de colchón que deja renovar al 75 %, y hay una prueba que los cuenta en vez de afirmarlo. El techo de 1 minuto vale también para después del `exp`: el access token ya no sirve pero **el de refresco sigue vivo**, así que se sigue intentando hasta que vuelva la red. | Prompt 40 — 2026-09-13 |
| **El archivo de credencial guarda EL TOKEN DE REFRESCO Y NADA MÁS, siempre cifrado, y si no hay cifrado disponible la aplicación se NIEGA a guardar.** | Guardar también el correo y el access token, que serían cómodos para la pantalla; caer a texto plano cuando `safeStorage` no está disponible | La contraseña se descarta al instante (§1.3), así que lo que queda en el disco es una sesión y no una contraseña: quien lo lea consigue actuar como la terminal, pero no consigue lo que además serviría para volver a entrar después de revocarla. El access token vive 900 s —guardarlo solo agregaría una copia de algo que caduca antes de que a nadie le sirva— y el correo se lee de los claims cuando hace falta: **un dato que no se guarda es un dato que no se filtra.** Y el respaldo en texto plano no existe porque sería exactamente lo que este módulo existe para impedir, hecho **en silencio**: la misma regla por la que los guiones de datos de ejemplo dejaron de salir callados (§4.11). **Falsificado**: agregando ese respaldo caen 7 pruebas. | Prompt 40 — 2026-09-13 |
| **«La contraseña no se guarda» se PRUEBA en seis superficies, con un control del propio buscador; y que el cifrado real cifre se mide con una sonda dentro de Electron.** | Afirmarlo en un comentario; probarlo solo sobre el archivo de credencial; dar por bueno que `safeStorage` cifra porque lo dice la documentación | Julio lo pidió explícitamente —«probalo, no lo afirmes»— y una sola comprobación no alcanza: la contraseña podría quedar en el archivo, en otro archivo de la carpeta, en la bitácora, en un campo del objeto, en el estado que viaja a la ventana o en el módulo de IPC. Se busca en las seis, y **hay una comprobación que le da al buscador un objeto donde la contraseña SÍ está**: sin ese control, las otras cinco pasarían igual con un buscador roto. **Falsificado con los dos errores realistas** —guardarla en un campo y registrarla en la bitácora—, y cada uno lo atrapa su prueba y ninguna otra. Aparte, las pruebas de Vitest usan un cifrado inyectado y **no pueden** probar que el llavero o DPAPI cifren: ese hueco lo cierra `npm run diagnostico:credencial`, que corre dentro de Electron y midió 67 bytes ilegibles para un token de 49 caracteres. Falsificarla destapó un defecto de la sonda misma —`decryptString` lanza y el proceso quedaba **colgado en vez de reportando**—, que se arregló. **Medido en macOS: falta correrla en Windows**, donde el respaldo es DPAPI y es otro mecanismo. | Prompt 40 — 2026-09-13 |
| **Se construye la primera mitad de la fase 3.a y se deja el TODO de la credencial REVOCADA, aunque el motivo del bloqueo ya no valía.** | Construir también la segunda mitad, ya que el experimento que la bloqueaba había terminado; construir la primera y no decir nada | El pedido decía que la segunda mitad esperaba a «un experimento en curso» sobre si PostgREST cachea la validación de un token vencido. **Ese experimento ya había terminado en la sesión anterior** y su resultado fue concluyente: PostgREST sí rechaza los vencidos, no hay caché —probado con un token nunca usado— y la tolerancia es de ~30 s (§4.22). Se reportó la premisa falsa **antes** de escribir código, como manda el proyecto, y aun así **no se amplió el alcance por cuenta propia**: la instrucción de no construirla era explícita y destrabarla es decisión de Julio. Lo que sí se hizo fue escribir los tres resultados medidos **dentro del TODO**, para que quien la construya no los vuelva a medir. Y se anotó una precisión que el razonamiento del bloqueo no tenía: **la señal de revocación no es que la API rechace el access token, sino que el REFRESCO devuelva 401** —el access token sigue valiendo hasta su `exp` aunque el usuario ya no exista (§1.6)—, así que el resultado del experimento no cambiaba el diseño de esa mitad tanto como suponía el pedido; lo que fijó fue la cota de la ventana tras revocar. | Prompt 40 — 2026-09-13 |
| **CORREGIDO: `ipcRenderer.invoke` sobre un canal NO REGISTRADO rechaza la promesa, no devuelve `ok: false`. Toda pantalla que llame a un canal opcional tiene que atrapar eso.** | Suponer que la API siempre devuelve el sobre `RespuestaIpc`, como hacen los canales registrados; registrar los canales de nube siempre y que fallen adentro | Los dos canales de nube son los primeros del proyecto que **pueden no existir**: sin `POS_NUBE_URL` no hay sesión de nube que construir y no se registran. El sobre `RespuestaIpc` cubre los errores que ocurren DENTRO de un manejador; que no haya manejador es otra cosa, y Electron la señala rechazando. La pantalla esperaba el sobre, el rechazo quedaba sin atrapar y **seguía ofreciendo un botón «Conectar» que no podía funcionar**. Registrarlos siempre era la otra salida y es peor: haría falta una sesión de nube de mentira para que el manejador tuviera a quién preguntarle, o sea un objeto que finge estar configurado. **Lo encontró `verify:pantallas`, cuarta vez que atrapa un defecto que ninguna prueba de Vitest puede ver**, y quedó fijado ahí con dos comprobaciones; falsificado quitando el `try/catch`. | Prompt 40 — 2026-09-13 |
| **CORREGIDO: se reportó como MEDIDO lo que era una inferencia, y un desfase de reloj que no se pudo reproducir.** Lo medido es una cota (~32 s), no una tolerancia de 30 s exactos; y el reloj local NO va 1.9 s atrasado, va ≈0. | Dejar el resumen como estaba, que ya sonaba convincente; borrar las afirmaciones viejas sin decir que estuvieron | Julio pidió ver **la salida cruda** del experimento en vez del resumen, y al releerla aparecieron tres cosas mal: (1) el desfase de 1.9 s **no se reproduce** —tres mediciones nuevas contra la cabecera `Date` del servidor dieron −0.21 s, +0.50 s y +0.75 s—, (2) la conversión «27.9–32.9 s de reloj del servidor» se apoyaba en ese 1.9 s y por lo tanto se cae, y (3) el bracket «25–30 s» eran **el contador nominal del bucle**, no los instantes medidos, que fueron +26.0 y +31.0. Más una cuarta menor: un `HTTP 504` se etiquetó «todavía aceptado», y un 504 no es un veredicto. **El error estaba en cómo se reportó la medición, no en la medición**: la conclusión —la ventana está acotada— se sostiene, y se rehizo el experimento con timestamp de cada intento y sondeo cada 2 s para acotarla mejor (último aceptado exp+30.1 s, primer rechazado exp+32.3 s, y dos tokens **nunca usados** rechazados igual). Las afirmaciones viejas **no se borran**: quedan en una tabla de «qué decía / qué pasa de verdad», porque un documento que corrige en silencio no se puede auditar. Y la constante `TOLERANCIA_DE_RELOJ_MEDIDA_S` se renombró a `DESFASE_QUE_MERECE_AVISO_S`, porque el nombre afirmaba más que la evidencia. | Prompt 41 — 2026-09-13 |
| **La señal de credencial REVOCADA no es el 401: GoTrue devuelve 400. La clasificación enumera lo TRANSITORIO y lee todo lo demás como credencial muerta.** | Detectar por 401, que es lo que decía el pedido y lo que parece evidente; enumerar los códigos «malos» en vez de los «buenos» | **Medido antes de escribir la detección**, contra `pos-pruebas-descartable`: un token de refresco que no sirve devuelve `HTTP 400 {"error_code":"validation_failed","msg":"Refresh token is not valid"}`, y una contraseña equivocada o un usuario inexistente devuelven 400 también. **Detectar por 401 habría sido un control que no dispara nunca**, y la aplicación habría reintentado en bucle para siempre una credencial muerta, que es el defecto exacto que esta mitad venía a cerrar. El 401 sí existe pero es de **otro servidor y otra pregunta**: es PostgREST rechazando un access token vencido, cosa que pasa cada 900 s de forma normal, y confundirlos habría hecho que la terminal se declarara revocada en cada renovación. La regla se escribe al revés —transitorio es sin respuesta, 5xx, 408, 425 y 429; todo lo demás es credencial muerta— porque ante un código que nadie previó conviene avisar de más y que una persona mire, antes que girar en falso. **Falsificado**: con «solo 401» caen 12 comprobaciones. | Prompt 42 — 2026-09-13 |
| **Revocada = sin credencial: la aplicación RENUNCIA a la ventana en que su access token todavía serviría, no reintenta, y NO borra el archivo.** | Seguir subiendo con el token vigente hasta que venza, ya que funciona; reintentar el refresco con backoff; borrar la credencial muerta para dejar el estado limpio | Al detectarse la revocación, el access token en memoria **puede seguir siendo aceptado** hasta su `exp` más la cota medida de §4.22 —hasta 15 min y medio con los 900 s del real—. Se renuncia a esa ventana porque la revocación existe para el escenario de la terminal robada (§1.5): seguir escribiendo con una credencial que el dueño acaba de anular es actuar contra esa decisión, y lo único que se gana son minutos de subida **que igual no se pierden**, porque la cola vive en SQLite y sube entera al reaprovisionar. No se reintenta porque el servidor no dijo «ahora no» sino «esta credencial no», y un contador que sube esconde el problema en vez de mostrarlo: es el mismo criterio con que la cola trata un fallo determinístico (§4.18). Y **no se borra el archivo** porque borrar es irreversible: si ese 400 viniera de un problema de plataforma, se habría destruido una credencial que servía; marcarla muerta en memoria no cuesta nada y reconectar la reemplaza sola. El estado de revocada vive en memoria a propósito, así que **cada arranque vuelve a preguntarle al servidor** en vez de creerle a una decisión vieja. | Prompt 42 — 2026-09-13 |
| **ADVERTENCIA DE EMPAQUETADO: la credencial cifrada está atada al NOMBRE DE LA APLICACIÓN. Si cambia, hay que reconectar cada terminal a mano.** | Darlo por sabido; intentar una migración automática de la credencial entre nombres | Se descubrió midiendo, no leyendo: el primer intento de leer el archivo desde un lector que corría como «Electron» falló con «Error while decrypting the ciphertext», y con la misma identidad —`name: pos-agricola`— descifra sin problema. `safeStorage` deriva la llave de una entrada del llavero o de DPAPI **cuyo nombre sale del nombre del producto**, así que renombrar `name`/`productName`, cambiar el nombre en `electron-builder` o cambiar la firma de la aplicación **deja ilegible toda credencial ya guardada**. Tiene un lado bueno no previsto —otro programa del mismo usuario no puede leerla— y uno caro, que es este. **No hay migración automática posible**: la llave vieja no existe más. Lo que sí se exige es que la aplicación **no falle en silencio ni se cuelgue**: detecta el fallo de descifrado, lo dice con esas palabras, lo deja en la bitácora, no lo confunde con una revocación y ofrece reconectar. Las ocho conductas tienen prueba. | Prompt 42 — 2026-09-13 |
| **El enrutador de lotes decide por PRESENCIA de una tabla decisiva, nunca por la primera fila del lote.** | Enrutar por `orden_en_lote = 0`, que es lo evidente; preferir una función cuando el lote mezcla tablas de varias | Una venta y un lote simple de catálogo **empiezan los dos por `productos`** —CLAUDE.md §4.20 lo había dejado anotado para este día—, así que enrutar por la primera fila mandaría toda venta a `sincronizar_lote_simple`, que la rechazaría por nombre y **detendría la cola con un error de forma sobre una tabla que nadie mencionó**: ruidoso, pero por la razón equivocada. Se enruta por presencia, en orden de especificidad. La apertura y el cierre de caja son el par peligroso, porque reciben lotes con **exactamente las mismas tablas** y solo los distingue el `estado`; tienen pruebas propias que exigen que uno nunca llame a la función del otro, y un estado que no sea `abierta` ni `cerrada` **se rechaza en vez de adivinarse**. Y un lote que mezcle tablas de funciones distintas no se manda: ninguna lo aceptaría, así que se rechaza acá con el motivo verdadero y sin gastar una petición. **Falsificado**: enrutando por la primera tabla caen 6 comprobaciones. | Prompt 43 — 2026-09-13 |
| **CORREGIDO: la detección de conexión usa `GET /auth/v1/health`, no `HEAD` como pedía §5.2, y comprueba la cabecera `sb-project-ref` además del cuerpo.** | Seguir el diseño al pie de la letra con `HEAD`; conformarse con el código 200; comprobar solo el `content-type` | **Medido: `HEAD` devuelve `405 Method Not Allowed` con `allow: GET`.** Un detector que use HEAD reportaría «sin internet» **siempre**, con la red perfecta —el peor falso negativo posible, porque dejaría la cola sin subir nunca sin que nada pareciera roto—. Y `HEAD` era además incoherente con la otra mitad de su propia fila del diseño, que exige «un 200 con el cuerpo esperado»: un HEAD no tiene cuerpo. Con `GET` la respuesta medida son **107 bytes** y trae algo mejor de lo previsto: la cabecera `sb-project-ref` con la referencia del proyecto. Un portal cautivo puede devolver 200 con `application/json` si se lo propone; **lo que no puede es firmar la respuesta con la referencia de ESTE proyecto**. Se exigen las tres cosas. | Prompt 43 — 2026-09-13 |
| **El latido diario consulta la BASE (`configuracion_negocio`), no `contrato_de_sincronizacion()` como proponía el pedido.** | Usar la función del contrato, que ya existe y es liviana; usar el health de Auth | Dos razones, y la primera es dirimente: **`contrato_de_sincronizacion()` exige el rol `restauracion` en su primera línea, y la terminal tiene el rol `terminal`**, así que le contestaría `403` siempre. Un latido que siempre falla no es un latido. La segunda es la que ya estaba en §5.3: el latido no existe para detectar conexión sino **para que el proyecto del plan gratuito no se pause** (riesgo 8.3), y para eso hace falta tocar Postgres —el health de Auth explícitamente no cuenta como actividad de base—. Medido como terminal, la consulta devuelve **200 con `[]`**, porque no hay política de lectura para ese rol, **y aun así llegó a Postgres**, que es lo único que importa: la lista vacía es el resultado correcto, no un fallo. | Prompt 43 — 2026-09-13 |
| **Sin credencial usable el proveedor NI ARMA el payload, y lo reporta como clase «credencial» (401), no como fallo de red.** | Devolverlo sin código, que se leería como transitorio; devolver un 4xx cualquiera, que detendría la cola | Los tres casos —nunca se conectó, no se pudo descifrar, la nube la rechazó— los cubre un solo chequeo, porque `accessTokenVigente()` ya devuelve `null` en los tres desde la fase 3.a. Reportarlo **sin** código HTTP lo haría leer como transitorio y gastaría la escalera de reintentos esperando algo que el tiempo no arregla; reportarlo como determinístico **bloquearía un lote que es perfectamente válido**. La clase «credencial» ya existía en `reintentos.ts` desde la fase 1.b con la semántica exacta de §3.2: la cola **no se toca** —no suma intento, no agenda, no bloquea— porque lo que falta se resuelve reconectando la terminal. Probado de punta a punta contra la cola SQLite real: el lote queda pendiente con `intentos = 0` y sube entero cuando vuelve la credencial. | Prompt 43 — 2026-09-13 |
| **CORREGIDO: `crearPrimerAdministrador` ahora ENCOLA. Sin eso, la cola de toda instalación nueva quedaba detenida para siempre en el primer lote.** | Dejarlo como estaba, que «solo» no subía un usuario; hacer opcional la dependencia `base` para no tocar los seis sitios de construcción | **Lo destapó una venta real contra Postgres, y no podía verlo ninguna prueba con dobles**: la restricción vive en la nube. `auditoria_log.usuario_id` tiene llave foránea hacia `usuarios`, y **todo** asiento de la tienda lleva el id de quien hizo la operación; con el primer administrador sin subir, el primer lote moría con `23503 auditoria_log_usuario_id_fkey` y la cola quedaba **detenida para siempre**. No era un caso raro: era *todas* las instalaciones. Era además el único camino de escritura del proyecto fuera de `conBandejaDeSalida` —se le escapó a la fase 1.a, que agregó la transacción a los otros seis servicios—, así que arreglarlo cierra de paso un hueco de atomicidad. `base` se hizo **obligatoria y no opcional**: opcional habría dejado el hueco abierto, en silencio, en cualquier sitio que se olvidara de pasarla, y el compilador no habría dicho nada. Tiene prueba propia que exige las dos filas, en un solo lote y en orden. | Prompt 44 — 2026-09-13 |
| **`olvidarLaEspera()` se conecta a tres disparadores reales, y el sondeo de `net.isOnline()` es un intervalo porque Electron NO emite evento.** | Dejarlo para una fase futura, como estaba; confiar solo en `powerMonitor`; sondear más seguido | Sin disparadores, la escalera de recomprobación manda siempre: tras una hora sin internet la terminal esperaría hasta 5 minutos para enterarse de que la red volvió, **aunque el sistema operativo ya lo supiera**. Los tres son `resume` y `on-ac` de `powerMonitor`, más la transición `false → true` de `net.isOnline()`. Ese último **no puede ser un evento**: el módulo `net` de Electron no es un EventEmitter, así que se sondea cada 30 s —una lectura en memoria del Network List Manager, sin red y sin costo— y **solo se actúa en la transición hacia arriba**, porque al sistema operativo se le cree únicamente el «no» (§5.2). Los 15 s de gracia tras despertar no se pusieron acá: los pone `alDespertar()` del planificador, que existía desde la fase 1.b con ese número escrito esperando este día. | Prompt 44 — 2026-09-13 |
| **PRUEBA ESTRUCTURAL NUEVA: cada `auditoria.registrar(` del dominio tiene que estar dentro de `conBandejaDeSalida` o de `enTransaccionDeNegocio`.** Encontró CINCO hechos de negocio que no llegaban a la nube. | Confiar en que la próxima vez alguien lo revise a mano; exigir solo `conBandejaDeSalida`, que es el molde común | La prueba que ya había —«solo tres archivos nombran `.transaction(`»— protege de que alguien **abra** una transacción por su cuenta, y no de lo contrario, **que es peor: no abrir ninguna**. `crearPrimerAdministrador` no nombraba `.transaction(` precisamente porque no abría transacción, así que pasaba limpio; el defecto vivió desde el Prompt 3. El asiento de auditoría es el marcador exacto de «acá pasó un hecho del negocio» —§4.17 lo dice al revés— y `auditoria_log` se sincroniza, así que un asiento fuera del envoltorio es por definición un hecho que no llega. **Se aceptan DOS envoltorios y no uno**: §4.17 ya había decidido que la venta y los dos métodos de caja usan `enTransaccionDeNegocio` + `encolarLote` directo, y la primera versión de la prueba los marcó como falsos positivos hasta que se comprobó que sí encolan. La lista de excepciones está vacía y una entrada sin motivo escrito hace fallar otra comprobación; hay además un control del propio detector, porque uno roto que dijera siempre «está dentro» dejaría la prueba pasando en falso. **Falsificada**: quitando un envoltorio, falla nombrando archivo y línea. | Prompt 45 — 2026-09-13 |
| **CORREGIDO: cinco asientos de auditoría de `autenticacion.ts` no se encolaban, y DOS de ellos contradecían lo que §4.8 afirma.** | Excusarlos en la lista de excepciones; dejarlos y anotarlos como pendiente | Los cinco son `autorizacion_bloqueada`, `pin_remoto_configurado`, la salida controlada, el ingreso correcto y el ingreso fallido / `usuario_bloqueado`. **§4.8 decía con todas las letras** que el candado no viaja pero «el hecho auditable sí: `usuario_bloqueado` y `autorizacion_bloqueada` quedan en `auditoria_log`, que sí está espejada»: **no estaba espejada**, y esa afirmación de la documentación era falsa desde que se escribió. Excusarlos habría sido documentar como aceptado un comportamiento que el propio diseño declara incorrecto. En cada uno se distingue lo que viaja de lo que no: el contador de intentos y el candado por superficie se quedan acá —estado operativo de la terminal (§4.4), que ni existe en Postgres— y lo que se encola es el asiento; en `configurarPinRemoto` se encola además la fila de `usuarios`, cuyo hash de PIN remoto no viaja porque `COLUMNAS_EXCLUIDAS` lo saca (decisión 17). | Prompt 45 — 2026-09-13 |
| **Migración `0027`: una función NUEVA, `sincronizar_asiento`, para el lote que no tiene fila principal de negocio. NO se amplió `sincronizar_lote_simple`.** | Agregar `auditoria_log` al `CASE` de la fila principal del lote simple, que era una línea; revertir los cinco arreglos de §4.26 | **El arreglo de §4.26 estaba incompleto y era peor que el defecto**: esos cinco producen lotes de un solo asiento, y las cinco funciones de la `0023` exigen una fila principal. Medido contra la nube: `HTTP 400 FORMA: la tabla auditoria_log no se sincroniza como lote simple`, `cola_detenida`. O sea que **el primer ingreso fallido de un cajero habría detenido toda la sincronización de la tienda** — un defecto silencioso convertido en uno que para la caja. No se amplió el lote simple porque su `CASE` de la fila principal es lo que obliga a que la fila de negocio vaya primera y el asiento detrás: admitiendo `auditoria_log` ahí, un lote de catálogo con el asiento delante pasaría en vez de rechazarse y se perdería la comprobación de orden de §2.4. Una función aparte dice en su nombre lo que acepta y su lista cerrada tiene un solo elemento. **La versión de contrato no sube**: agrega una puerta, no cambia ninguna, así que una terminal vieja sigue funcionando. **Aplicada en los DOS proyectos el 2026-09-14** (§4.29). | Prompt 46 — 2026-09-14 |
| **La `0027` reemplaza TAMBIÉN `contrato_de_sincronizacion`, porque una función nueva es invisible para la prueba de deriva si no se agrega a su lista fija.** | Dejar el contrato como estaba: la función nueva funcionaba igual | **Medido, y es el hallazgo incómodo**: tras crear `sincronizar_asiento`, `npm run verify:nube` seguía en verde y la foto seguía diciendo «13 funciones». `contrato_de_sincronizacion()` enumera por nombre con un `proname IN (...)` literal —lo cual es correcto, porque declara el contrato y no cualquier función que aparezca en `public`— pero significa que **había una función `SECURITY DEFINER` nueva en la nube que nada vigilaba**. La prueba de deriva no puede detectar lo que el contrato no declara. Queda como regla para la próxima función: agregarla a esa lista **es parte de crearla**, no un paso opcional. Con el reemplazo, la foto declara 14 funciones y la mitad A exige que la nueva exista, sea DEFINER y tenga `search_path` vacío. | Prompt 46 — 2026-09-14 |
| **La `0027` se aplica al real TEMPRANO, sin esperar a que haga falta.** | Dejarla anotada como pendiente y aplicarla recién antes de conectar la terminal, que era el plan | Decisión de Julio, con un criterio que vale como regla general para toda migración **puramente aditiva** de la que el código ya dependa: *no cuesta nada aplicarla temprano y sí cuesta olvidarla*. La `0027` agrega una puerta, no cambia ninguna y no sube la versión de contrato, así que contra un proyecto que todavía no la usa **no tiene ningún efecto observable**; y no aplicarla convertiría el primer ingreso fallido de la tienda en una cola detenida. Una nota en un documento no es una salvaguarda: el objeto aplicado sí. **Esto NO afloja el protocolo de infraestructura real** —SQL a la vista, aprobación explícita, evidencia leída del catálogo—: cambia cuándo se propone, no cómo se aplica. Evidencia en §4.29. | Prompt 47 — 2026-09-14 |
| **CORREGIDO: el `0027b` del proyecto de pruebas había reescrito `contrato_de_sincronizacion` a mano y derivó del archivo.** El descartable se realineó con el repositorio. | Dejarlo, porque la salida del contrato era idéntica igual; realinear el real en vez del descartable | Lo detectó la comprobación de §4.4 al cotejar `md5(pg_get_functiondef)` entre los dos proyectos: **no coincidían**, que es exactamente para lo que existe. La causa fue mía: el `0027b` del día anterior reescribió la función en vez de copiar el cuerpo de la `0023`, cambiando `pg_get_function_arguments` por `identity_arguments` y `p.proconfig` por `coalesce(p.proconfig, ARRAY[]::text[])`. **El real tenía la versión correcta** —el registro de su `0023` es byte a byte el archivo del repositorio— así que se corrigió el descartable. La divergencia resultó ser de TEXTO y no de comportamiento (ver la fila siguiente), pero se corrige igual: el `coalesce` sí cambiaría la salida el día que una función perdiera su `search_path`, y dos proyectos que corren código distinto invalidan la premisa de probar en uno para aplicar en el otro. | Prompt 47 — 2026-09-14 |
| **MEDIDO, contra una suposición mía: `pg_get_function_arguments` e `identity_arguments` devuelven LO MISMO para las funciones de este esquema.** | Dar por buena mi lectura de que una trae nombres de parámetro y la otra solo tipos, y concluir que los dos proyectos declaraban contratos distintos | Iba a reportar que la foto y el real declaraban argumentos distintos. **Se midió antes de afirmarlo y era falso**: `iguales = true` en las tres funciones probadas. Las dos formas se separan solo con parámetros `OUT`/`INOUT`/`VARIADIC` o con valores por omisión, y ninguna función de este esquema tiene eso. La confirmación definitiva fue comparar la SALIDA del contrato en los dos proyectos con los claims de `restauracion`: `92d5b3e7374cdcf36aaa9f185acadf67` en los dos. Es el mismo tipo de error que §4.22 ya dejó anotado —reportar como medido lo que era razonamiento— y esta vez se atrapó antes de escribirlo. | Prompt 47 — 2026-09-14 |
| **NO se arregla el `23505` de las restricciones únicas que no son la llave primaria: se documenta y lo decide Julio.** | Cambiar `escribir_fila` para que conozca la clave natural de cada tabla; derivar los UUID de la clave natural; clasificar el `23505` como transitorio | El arnés exhaustivo lo destapó midiendo: `escribir_fila` hace `ON CONFLICT (id) DO UPDATE`, o sea que el upsert solo absorbe choques contra la **llave primaria**, y hay **nueve restricciones únicas que no lo son** en tablas que la terminal escribe (`usuarios.nombre`, `categorias.nombre`, `productos.nombre`, `limites_descuento.rol`, `recibos.numero_recibo`, `recibos.venta_id`, `venta_detalle(venta_id,orden_linea)`, el desglose de caja y la caja única). Un choque contra cualquiera sale como `23505` crudo, se clasifica como determinístico —correctamente— y **detiene la cola**. Hoy la tienda no lo puede provocar, porque nada se borra y una clave natural queda atada a su UUID para siempre dentro de una misma base; lo disparan una reinstalación, una restauración o una segunda terminal. **No se arregla por cuenta propia** porque las tres salidas posibles tocan el contrato con la nube y ninguna es obviamente la correcta: es definición de diseño y va como el punto 19 de §6.2. | Prompt 47 — 2026-09-14 |
| **Las fotos se reducen a 800 px AL GUARDAR, con `nativeImage` de Electron.** | `sharp`, que es lo estándar; `jimp`, que es JavaScript puro; reducir solo al subir y dejar el disco con la foto entera; convertir los PNG a JPEG para bajar más el peso | El número lo puso §2.5.3 midiendo: 200 fotos de teléfono sin comprimir son **unos 600 MB**, el 60 % del plan gratuito de una sola vez; a 800 px son unos 30 MB. `sharp` es un módulo NATIVO que habría que recompilar para Electron y para Windows —exactamente lo que §4.14 rechazó para la impresora— y `jimp` suma megabytes para lo que Electron ya sabe hacer: es el mismo criterio por el que el PDF sale de Chromium y no de `pdfkit`. Se reduce **al guardar y no solo al subir** para que el disco de la terminal también se cuide y la cuadrícula dibuje la foto chica. **El formato no se cambia**: convertir los PNG a JPEG pierde la transparencia y cambia la extensión que la fila ya guardó, y cuál de las dos cosas conviene es una definición que Jimmy no dio. Medido: 8.02 MB / 3000×2000 → **110 KB / 800×533**, 98.7 % menos. | Prompt 49 — 2026-09-14 |
| **El redimensionador se INYECTA y es obligatorio; quien pone los píxeles vive en `adapters/`.** | Importar `nativeImage` directamente en `almacen-de-fotos.ts`; hacerlo opcional para no tocar los sitios de construcción | El dominio no importa Electron, por la misma razón que `AlmacenDeFotos` ya recibía la carpeta base por parámetro: así se prueba contra archivos reales sin arrancar la aplicación. **Obligatorio y no opcional** porque uno opcional dejaría que un sitio que se olvide de pasarlo guarde las fotos enteras **en silencio**, con el síntoma —el gigabyte lleno— apareciendo meses después; es el mismo criterio con que `base` se hizo obligatoria en la fase 3.b. La contrapartida se asume y se cubre: en Vitest lo que se prueba es el doble, así que **que los píxeles se reduzcan de verdad lo mide `npm run diagnostico:imagen` dentro de Electron**, igual que `diagnostico:credencial` hace con `safeStorage`. Y esa sonda **lee las constantes de la fuente en vez de copiarlas**, para que no puedan derivar. | Prompt 49 — 2026-09-14 |
| **Las FILAS de negocio suben antes que cualquier ARCHIVO, y entre archivos sí se saltea al que espera.** | Un solo orden de llegada para todo, como hasta ahora; una cola aparte para los archivos | §2.5.1: «las filas son el negocio, los archivos son el adorno». Con una foto de cientos de KB por delante, una venta cobrada esperaría a que suba el catálogo. **No rompe la regla de «no saltear ningún lote»**, que existe por las llaves foráneas de Postgres: un archivo no tiene ninguna, Storage no referencia nada y nada lo referencia, así que su orden respecto de las filas es libre. Entre archivos sí se saltea al que está en espera, y con las filas nunca: ahí el orden ES la integridad referencial, acá cada foto es independiente. Una cola aparte habría duplicado el trabajador, sus reintentos y su persistencia para no ganar nada. | Prompt 49 — 2026-09-14 |
| **Un archivo ausente es una clase de fallo PROPIA (`archivo_ausente`), señalada con un campo explícito y no con un código HTTP inventado.** | Devolver un 404 de mentira; clasificarlo por el texto del error; tratarlo como determinístico y detener la cola | La clasificación de este proyecto va por código HTTP y **nunca** por el texto, para no adivinar. Pero acá **no hubo petición**: el archivo faltaba antes de salir a la red, así que no hay código que mirar, y meterle un 404 haría que se leyera como una respuesta de la nube, que es lo contrario de lo que pasó. Tratarlo como determinístico detendría toda la sincronización de la tienda porque a una terminal le falta una foto, y §2.5.4 pide lo opuesto: no bloqueante, apartado un día, «la fila de la base sigue subiendo normalmente». La espera es de un día y no la escalera de reintentos porque aquella existe para una nube que ahora no puede y en un rato sí; acá lo que falta es un archivo, y nada de lo que pase en el próximo minuto lo trae. | Prompt 49 — 2026-09-14 |
| **CORREGIDO antes de cerrar: un lote apartado NO se cuenta como subido.** | Dejarlo como estaba, que funcionaba | Mi primera versión devolvía el lote apartado con `motivo: null` para que el ciclo siguiera, y el bucle lo sumaba a los subidos: el resumen decía **«cola_vaciada; 2 lotes»** de dos fotos que nunca salieron a la red. **La bitácora habría reportado como respaldado algo que no lo estaba**, que es justo lo que este proyecto trata como el peor de los errores. Lo encontró una prueba que esperaba `sin_pendientes` y recibió `cola_vaciada`. Ahora hay un contador aparte y el ciclo lo dice: «N archivo(s) sin subir: no están en el disco». | Prompt 49 — 2026-09-14 |
| **Los PDF NO se suben, y se hace cumplir en TRES capas.** | Dejar la decisión escrita en la documentación y confiar; implementar la subida detrás de una bandera apagada | §2.5.3: un PDF es dato derivado que la reimpresión regenera desde las filas, y subirlos llena el gigabyte del plan gratuito en unos ocho meses para respaldar algo que la restauración reconstruye en segundos. Una bandera apagada sería código muerto que un día alguien enciende sin releer el motivo. Las tres capas: el módulo **no tiene parámetro de bucket** —no se le puede pedir—, una prueba estructural comprueba que ningún archivo del proceso principal arma una ruta a `recibos` (con un control del propio detector), y la nube no le da a la terminal **ninguna política** sobre ese bucket. Medido: `POST /storage/v1/object/recibos/… -> HTTP 400 new row violates row-level security policy`. | Prompt 49 — 2026-09-14 |
| **DOS SEPARACIONES DEL DISEÑO, las dos con su razón medida: el SHA-256 va en línea y la subida usa la URL del proyecto.** | Seguir §2.5.2 al pie de la letra: `worker_thread` para el hash y `<ref>.storage.supabase.co` para subir | El `worker_thread` se pedía «porque leer 5 MB y hacer SHA-256 en un i3 son cientos de milisegundos que no tienen por qué congelar la ventana», y **esta misma fase eliminó la premisa**: la foto ya se guardó reducida, así que lo que se lee son decenas de KB. Un hilo aparte sería infraestructura para un problema que la reducción borró. La URL directa de Storage nunca se probó en este proyecto; la del proyecto **sí está medida y funcionando** desde la batería de la fase 2.c. Cambiar a un host no verificado para ganar nada medible es la clase de decisión que este proyecto no toma. Las dos separaciones quedan escritas en §4.33 para que se puedan revisar. | Prompt 49 — 2026-09-14 |
| **El indicador de la barra de estado NO exige rol ni sesión: es el único canal de sincronización sin `requiereRol`.** | Exigir sesión, ya que la barra siempre se dibuja dentro de la app; exigir rol administrativo como el resto de la sincronización | La barra de estado está montada SIEMPRE —incluso en la pantalla de ingreso, antes de cualquier sesión (§4.5)— así que un guard de sesión la habría dejado sin nada que mostrar en el momento en que más hace falta: al prender la máquina. Y no hace falta el de rol porque la respuesta no lleva NINGÚN dato sensible: ni correo, ni el texto de un error, ni nada de la credencial, solo un estado ya calculado (por el proceso principal, nunca por el renderer) y un número. Hay una prueba de guard que fija esta excepción por NOMBRE de canal, para que no pueda ampliarse en silencio el día que se agregue un canal nuevo. | Prompt 50 — 2026-09-14 |
| **«Saltar un lote» exige PIN de administrador AUNQUE el canal ya requiera sesión administrativa, y con su propia superficie de candado (`saltar_lote_de_sincronizacion`, migración local 029).** | Bastarse con `requiereRol` del canal, ya que solo un administrador logueado llega al botón; reusar la superficie de `cierre_de_caja_ajena` | El diseño lo pide con estas palabras: «tiene que quedar firmada». Es el mismo criterio que ya rige `cierre_con_diferencia` y `cierre_de_caja_ajena`: la sesión decide quién PUEDE llegar al botón, el PIN decide que ALGUIEN lo autorizó en ese instante concreto, con su nombre en la auditoría —y ese alguien es a quien coincidió el PIN, no necesariamente la sesión activa, el mismo criterio de `descuento_excedente`—. Reusar otra superficie mezclaría el candado de intentos de dos acciones sin relación: fallar tres veces al saltar un lote no debe bloquear el cierre de una caja ajena. **NO acepta el PIN remoto**, por el mismo alcance mínimo que `salida_controlada`, con un argumento más fuerte todavía: el hueco que deja es PERMANENTE, así que quien autoriza tiene que estar viendo la pantalla con el error delante, no recibiendo un código por teléfono. | Prompt 50 — 2026-09-14 |
| **La marca local de un lote saltado NO se limpia a `NULL` como en un éxito real: se reemplaza por una nota que dice que fue saltado a mano.** | Limpiar `error` a `NULL`, como hace `marcarLoteSincronizado` | Un lote saltado y un lote realmente subido son hechos DISTINTOS y no pueden dejar el mismo rastro local. Si `marcarLoteSaltado` limpiara el error como un éxito genuino, alguien que mirara la fila en el disco —sin pasar por `auditoria_log`— no tendría forma de distinguir «la nube lo aceptó» de «una persona decidió dejarlo sin subir». El registro completo y auditable de quién y por qué vive en `auditoria_log`, que sí se sincroniza; la nota local es una segunda capa de honestidad, no la fuente de verdad. | Prompt 50 — 2026-09-14 |
| **`ServicioDeSincronizacion` vive en `src/main/sincronizacion`, y la prueba estructural de §4.26 se amplió para escanearla también.** | Ponerlo en `src/main/domain/sincronizacion` para que la prueba existente lo cubriera sin tocarla | Es la PRIMERA escritura de `auditoria.registrar(` fuera de `src/main/domain` en toda la vida del proyecto. Moverlo a `domain/` habría torcido una convención de carpetas ya establecida —`sincronizacion/` es infraestructura de subida, no un servicio de negocio, y así lo describe §9 de este documento— solo para no tocar una prueba. Ampliar el escaneo de la prueba a las dos carpetas cubre exactamente la clase de caso que ya costó dos vueltas: un servicio nuevo, en cualquier carpeta, que se olvida del envoltorio. **Falsificado**: quitándole `conBandejaDeSalida` a `saltarLote`, la prueba lo nombra por archivo y línea. | Prompt 50 — 2026-09-14 |
| **El texto de la barra NO dice «sin conexión desde HH:MM», aunque esa es la redacción literal del diseño.** | Seguir la redacción de §3.3 al pie de la letra | Esta aplicación no tiene ningún reloj que registre el INSTANTE en que se perdió la conexión: el detector de la fase 3.b solo guarda el último veredicto, no cuándo cambió. Escribir una hora ahí sería inventar una precisión que nunca se midió, exactamente el tipo de afirmación que este proyecto corrigió en voz alta en §4.22. Se dice cuántos pendientes hay en cambio, que sí es un dato real y verificable en la base en ese instante. Hay una prueba que barre los seis estados posibles y exige que ninguno tenga forma de hora. | Prompt 50 — 2026-09-14 |
| **Verificado con `verify:pantallas` insertando un lote BLOQUEANTE de verdad, con una conexión SQLite aparte contra el archivo temporal de la corrida.** | Conformarse con las pruebas de Vitest para la acción más sensible de la fase; simular el bloqueo llamando al servicio directamente desde el guion | «Saltar un lote» es una acción irreversible y con PIN: es exactamente la clase de comportamiento que este proyecto no da por bueno sin verlo funcionar en la ventana real (regla general del proyecto). SQLite en modo WAL admite una segunda conexión de corta vida mientras la aplicación tiene la suya abierta, así que insertar el lote bloqueante a mano —sin pasar por ninguna función de negocio— es la forma más directa de simular «un lote quedó detenido» en una corrida sin `POS_NUBE_URL`, donde nada falla solo. Se ejercitaron reintentar, saltar con PIN equivocado (rechaza, el lote sigue bloqueante) y con PIN correcto (salta, y el asiento queda leíble en `auditoria_log` con una TERCERA conexión de solo lectura). `verify:pantallas` pasó de 39 a 46 comprobaciones. | Prompt 50 — 2026-09-14 |
| **CORREGIDO en el propio arnés de verificación: un `waitForTimeout` fijo se reemplazó por esperar la consecuencia visible.** | Agrandar el tiempo fijo hasta que dejara de fallar | La primera versión de la comprobación de «reintentar ahora» falló: el lote seguía viéndose bloqueante después de esperar 1000 ms. La causa no era el trabajador sino el arnés: el `onClick` de React dispara la acción con `void` porque un manejador de evento no se puede awaitear, así que `click()` de Playwright resuelve en cuanto el clic se despacha, no cuando la operación asincrónica termina. Agrandar el tiempo fijo habría tapado el síntoma sin arreglar la causa, y dejado una comprobación lenta y frágil. Se corrigió con `waitFor({ state: 'detached' })` sobre el aviso que tenía que desaparecer: se espera la consecuencia, no un reloj a ciegas. Es la misma lección que ya dejaron los defectos anteriores de este arnés (§4.11). | Prompt 50 — 2026-09-14 |
| **El id de `limites_descuento` pasa a ser FIJO por rol, con UUID en la migración (028 / 0028).** | `id = rol`, que sería más legible; derivar el UUID de la clave natural con un hash; dejarlo sorteado y enseñarle a `escribir_fila` la clave natural de cada tabla | Cierra la PRIMERA de las nueve restricciones únicas de §4.31, y es la única donde la clave natural **es** la identidad: `limites_descuento` tiene como mucho dos filas y siempre las mismas dos, una por rol. `id = 'venta'` no se puede sin reconstruir la tabla —SQLite exige `length(id) = 36` y Postgres es `UUID`—, y el rebuild de doce pasos ya se descartó en las migraciones 008 y 015. Derivar el UUID de un hash escondería en código una correspondencia que así queda **escrita en el esquema y comprobable a simple vista**. Y no se tocó `escribir_fila`, porque las otras ocho restricciones no son el mismo problema y una regla genérica les aplicaría una respuesta que no les corresponde. Rompe a propósito la regla de «UUID en el cliente», que existe para EVITAR colisiones entre instalaciones: acá la colisión es lo que se busca, igual que en `denominaciones` (Prompt 13) y en el `id = 'unica'` de `configuracion_negocio`. | Prompt 48 — 2026-09-14 |
| **La migración mueve también lo que estaba esperando en `sync_cola`, no solo la fila de negocio.** | Mover solo `limites_descuento` y dejar la cola como estaba | Una migración que cambia una llave primaria tiene que mover con ella todo lo que la nombra. Si un lote quedara pendiente apuntando al id viejo —y con el id viejo adentro del payload—, al subirlo la nube recibiría la fila con una llave primaria que en esa base ya no existe y chocaría contra `UNIQUE (rol)`: **la propia migración provocando el `23505` que vino a cerrar**. Se mueven `entidad_id` y el `id` de adentro del payload JUNTOS, con `json_set`, porque §4.17 sostiene que el payload es byte a byte lo que quedó guardado. Tiene prueba propia, sobre una base a la que se le aplican todas las migraciones MENOS esta, se le siembra la fila con id sorteado y recién entonces se corre. | Prompt 48 — 2026-09-14 |
| **El guion de la batería usa el id del ESQUEMA, no uno inventado por él.** | Dejarle su propio id fijo, que funcionaba | `verificacion-de-nube.cjs` ya tenía un id fijo propio con este comentario: «`limites_descuento.rol` es UNIQUE y esa tabla no se vacía entre corridas, así que un id nuevo por corrida chocaría contra la fila de la corrida anterior». **El diagnóstico era exacto y el arreglo estaba en el lugar equivocado**: nadie conectó que la aplicación sorteaba ese mismo id, así que el choque le esperaba igual a cualquier reinstalación o segunda terminal. Es una lección más general que este caso: **un arnés de prueba que esquiva un problema en vez de exhibirlo lo esconde**, y acá lo escondió durante dos fases. Ahora usa el id del esquema, y uno inventado sería rechazado por el CHECK. | Prompt 48 — 2026-09-14 |
| **RESTAURACIÓN (fase 4.b): NINGÚN id se regenera; cada fila local lleva el id de la nube, con `ON CONFLICT(id) DO NOTHING`.** | Sortear ids nuevos y mapearlos; regenerar solo los de las tablas «libres» | Es la regla no negociable de la fase, y no es de estilo: con ids nuevos, la primera vez que la terminal restaurada volviera a subir chocaría contra las ocho restricciones únicas abiertas del punto 19 de §6.2 (`usuarios.nombre`, `productos.nombre`…), porque el upsert de la nube solo absorbe choques por `(id)`. Con el mismo id, el choque es por `(id)` y se absorbe. Y es lo que hace idempotente cada página: repetirla no duplica. Comprobado id por id contra la terminal de origen y contra la nube real. | Prompt 51 — 2026-09-14 |
| **Un usuario restaurado queda con el centinela `HASH_SIN_PIN` en `pin_hash`, y `verificarPin` lo rechaza siempre sin lanzar.** | Hacer nulable `pin_hash` con una migración que recree `usuarios`; escribir un hash aleatorio que nadie conoce; una cadena vacía | Los hashes no existen en Postgres (decisión 17) y la columna local exige texto no vacío; recrear `usuarios` es el rebuild de doce pasos que el proyecto ya descartó tres veces, y `ventas` y `auditoria_log` la referencian. Un hash aleatorio «funcionaría» pero sería un PIN real que nadie conoce: indistinguible en la base de un PIN asignado, y `describirHash` lo tomaría por bueno. El centinela se distingue a simple vista y por código (`tienePin`), y hace la decisión 15 por construcción: no hay ningún hash real que recordar. La cadena vacía la rechaza el CHECK. Los 10 000 PIN posibles dan cero aciertos contra él. Ver §6.7 del diseño. | Prompt 51 — 2026-09-14 |
| **El PIN nuevo se asigna DENTRO de la pantalla de restauración, con la sesión de la nube como autorización, y la restauración no termina mientras un usuario activo siga sin PIN.** | Terminar y que el administrador los asigne desde la pantalla de usuarios | Nadie puede iniciar sesión: todos están sin PIN, y la pantalla de usuarios exige sesión administrativa. Sería un candado sin llave. Quien restaura ya se identificó con la cuenta del dueño en la nube, que es más fuerte que una sesión local. Un usuario de baja puede quedar sin PIN; si se reactiva, la pantalla de usuarios lo marca «Sin PIN» y la de ingreso no le ofrece el teclado. | Prompt 51 — 2026-09-14 |
| ~~**`pdf_path` se re-enraíza en la carpeta de recibos de ESTA máquina, conservando el nombre del archivo.**~~ **SUPERADA EL MISMO DÍA (Prompt 52, fila más abajo): el origen se corrigió y `pdf_path` es RELATIVA desde la migración 030; la conversión queda solo como compatibilidad con las filas ya subidas con ruta absoluta.** | Dejarla en `NULL`; dejar la ruta absoluta vieja; bajar los PDF | El pedido proponía `NULL` «si la columna lo permite», y no lo permite: `recibos.pdf_path` es `NOT NULL` con CHECK de no vacío. La ruta vieja es ABSOLUTA —`ServicioDeRecibos` guarda `join(carpeta, nombre)`, no la relativa que §2.5.1 supone— y en esta máquina esa carpeta no existe: la reimpresión fallaría al escribir y quedaría un recibo sin PDF, contra la regla del Prompt 1. Los PDF no se bajan porque nunca se subieron (decisión 6). Con la ruta re-enraizada, la reimpresión regenera el PDF desde las filas, probado con el archivo ausente. El nombre se corta por `/` o `\`, porque la terminal vieja pudo ser Windows y `path.basename` de macOS no parte `\`. | Prompt 51 — 2026-09-14 |
| **Anomalías por `recibido_en`: se EXCLUYEN solo las filas de las tablas que la nube SOLO INSERTA; las demás se restauran y se listan, y `usuarios` se revisa uno por uno.** | Excluir toda fila posterior al robo, como dice §6.5 literalmente; restaurar todo y solo listar | §6.5 dice «sin restaurar, para que decidas fila por fila», pero aplicado a todas las tablas rompe las llaves foráneas de lo legítimo: una fila anterior al robo y MODIFICADA después (un producto que una venta falsa descontó, una caja abierta antes y cerrada por el ladrón) tiene `recibido_en` posterior, y excluirla dejaría sin padre a las ventas legítimas. En las cinco tablas sin función de actualización (`ventas`, `venta_detalle`, `recibos`, `caja_sesion_denominaciones`, `auditoria_log`), «recibida después» ES «insertada después», y ninguna fila anterior las referencia —probado contra el grafo de llaves—: ahí la exclusión es segura, y cada fila se puede restaurar igual (una venta con sus hijas; una hija sola sin su venta se rechaza explicando el orden). Restaurar todo y solo listar dejaría ventas falsas en la base sin forma de quitarlas, porque nada se borra y la anulación no existe. **Es una interpretación del diseño y queda señalada para que Julio la confirme.** | Prompt 51 — 2026-09-14 |
| **Lo decidido durante la restauración se encola; lo restaurado NO.** | `sync_cola` vacía al terminar, como dice §6.3; encolar también lo restaurado | Lo restaurado ya está en la nube: subirlo otra vez sería churn puro. Pero un PIN asignado, un usuario revisado, una fila excluida restaurada a mano y la restauración completada son HECHOS del negocio, y la nube tiene que enterarse cuando la terminal se conecte con su propia credencial: si el ladrón promovió a un cajero y la revisión lo degradó, la nube tiene que reflejarlo. Van por `conBandejaDeSalida`, y la prueba estructural de §4.26 escanea también `src/main/restauracion`. «`sync_cola` vacía» se lee como «lo que bajó no se vuelve a subir». | Prompt 51 — 2026-09-14 |
| **La suma de ventas por mes se calcula EN POSTGRES con una función nueva, `restauracion_ventas_por_mes()` (migración 0029, INVOKER, solo rol restauración), aplicada en el descartable el 2026-09-14 y en el real el mismo día, con la aprobación de Julio.** | Los agregados de PostgREST (`total.sum()`); traer las filas y sumar en la terminal; una columna de mes | §6.4 pide la suma del lado de la nube, con `NUMERIC` exacto, para compararla contra Decimal: sumar en la terminal probaría la terminal contra sí misma. Los agregados de PostgREST no agrupan por una expresión de mes sin una columna o una función, y una columna sería esquema para una comprobación. Devuelve la suma como TEXTO, para que no pase por un `double`. Es INVOKER, no DEFINER: lee bajo las políticas de la 0025, y una función DEFINER menos es un aviso menos del linter. Y reemplaza el contrato para enumerarla, por la regla de §4.29. **Se aplicó al real el 2026-09-14** con la aprobación explícita de Julio, después de la 030 local y en ese orden; la evidencia leída del catálogo está en §4.4. | Prompt 51 — 2026-09-14; aplicada al real en el Prompt 53 — 2026-09-14 |
| **Los numéricos se piden a PostgREST con `::text` y se NORMALIZAN a la forma canónica local; nunca se redondean.** | Dejar que lleguen como número JSON; pedir CSV; copiar el texto de Postgres tal cual | Un número JSON es un `double`: exactamente lo que `money.ts` existe para evitar. Con `::text` llega la representación exacta de Postgres, que rellena a la escala de la columna —`"4.165000"` para `numeric(18,6)`, medido en la nube real— y no pasa el CHECK canónico de `subtotal_exacto` copiada tal cual… salvo que sí pasa (admite hasta diez decimales), lo que la haría distinta byte a byte de lo que la terminal escribió: se normaliza a `4.165`. Un valor con más decimales de los que su clase admite se rechaza, porque redondear en silencio es la corrupción que este módulo existe para impedir. CSV obligaría a parsear comillas y comas para lo mismo. | Prompt 51 — 2026-09-14 |
| **CORREGIDO al medir: PostgREST contesta `206 Partial Content` a un conteo con `Prefer: count=exact` y `limit=1`, y eso es ÉXITO.** | Exigir `200`, que era lo que el cliente hacía | La primera corrida real se detuvo en `usuarios` con «La nube rechazó el conteo (HTTP 206)». El 206 es el código de una respuesta con rango parcial, que es exactamente lo que se pidió. Ninguna prueba con dobles lo podía ver: el doble contestaba 200 porque yo creía que la nube contestaba 200. Quedó escrito en el cliente con la medición. | Prompt 51 — 2026-09-14 |
| **CORREGIDO al medir: el `logout` de GoTrue lleva `scope=local`, porque el alcance por omisión es GLOBAL y revoca todas las sesiones del usuario.** | Dejar el `logout` sin parámetro | En la segunda corrida, un cierre global desde otra sesión del mismo usuario dejó a la sesión de la restauración contestando `403` al cerrarse, aunque su access token seguía sirviendo. Y es lo correcto más allá del arnés: el usuario de restauración es el del dueño, y cerrar la restauración no tiene por qué cerrarle ninguna otra sesión. Con `scope=local`, los `logout` dieron `204` en la tercera corrida. | Prompt 51 — 2026-09-14 |
| **Los nueve canales de la restauración NO llevan guard de sesión ni de rol, y una prueba lo fija por nombre.** | Exigir `requiereRol`, como en todos los demás módulos administrativos | La restauración corre sobre una instalación VACÍA, antes de que exista ningún usuario: no puede haber sesión que exigir. La autorización es más fuerte, no más débil: la nube verifica la contraseña del usuario con rol `restauracion`, y el servicio se niega en cuanto la base tiene una fila de negocio o el puesto de control es de otro proyecto. Lo máximo que un renderer comprometido conseguiría es lo mismo que la pantalla de configuración inicial, que tampoco pide sesión. | Prompt 51 — 2026-09-14 |
| **La verificación real vive en un Vitest APARTE (`vitest.nube.config.ts`, archivos `*.nube.ts`, `npm run verify:restauracion`), no en `npm test` ni en un `.cjs`.** | Un guion `.cjs` como `verify:nube`; un modo de Electron como `verify:arranque`; incluirlo en `npm test` | Tiene que usar los servicios y el proveedor REALES, que son TypeScript con alias de ruta: un `.cjs` los tendría que reimplementar o cargar compilados. `npm test` no puede depender de la nube (§4, punto 4), así que los archivos terminan en `.nube.ts` y el patrón `*.test.ts` no los ve. El seguro de `proyectos-de-prueba.cjs` se comprueba antes de la primera petición, y la salida es cruda: cada petición con hora, método, ruta y código. | Prompt 51 — 2026-09-14 |
| **El arnés NO compara `precios_especiales` contra la terminal de origen, y dice por qué.** | Sembrarla por un servicio que no existe; hacer que el repositorio encole | En producción nada la escribe (punto 18 de §6.2); la terminal de origen la siembra por el repositorio directo, que no encola, así que nunca llega a la nube y la restauración no puede traerla. Se comprueba que la nube tiene cero y el origen una, y que la venta que usó el precio especial viaja igual en `precio_unitario_snap`. Es un recordatorio de que el punto 18 sigue abierto, no un defecto de esta fase. | Prompt 51 — 2026-09-14 |
| **`recibos.pdf_path` se guarda RELATIVA (`recibos/<nombre>.pdf`) desde la migración 030, igual que `foto_path`; el re-enraizado de la restauración queda SOLO como compatibilidad con las filas ya subidas con ruta absoluta.** | Dejar el re-enraizado como comportamiento permanente; una migración de la nube que reescriba las filas viejas; tolerar las dos formas en el lector local | Julio lo señaló al revisar la fase 4.b: el re-enraizado compensaba un defecto del ORIGEN —`ServicioDeRecibos` guardaba `join(carpeta, nombre)`, absoluta, desde el Prompt 23— y mientras el origen siguiera igual, cada recibo nuevo iba a subir con el mismo problema y cada restauración futura iba a tener que seguir compensándolo para siempre. El arreglo va en el origen: la fila guarda solo la relativa y la absoluta se resuelve al usarla (`ruta-de-pdf.ts`), con la misma barrera contra el recorrido de directorios que las fotos. La 030 convierte las filas locales que ya existían y los payloads pendientes de `sync_cola` —el payload es byte a byte la fila, §4.17— sin mover ningún archivo. Las filas que YA están en la nube con ruta absoluta no se reescriben: la terminal no tiene `UPDATE` sobre ninguna tabla (§4.21) y son la constancia de lo que se envió; la restauración las convierte al bajarlas, documentado como compatibilidad hacia atrás y no como comportamiento esperado. El lector local es estricto (solo relativa): tolerar las dos formas dejaría dos maneras de decir lo mismo en la misma columna, que es lo que el proyecto ya rechazó para `configuracion_negocio`. Verificado en el arnés real: el `pdf_path` de los dos recibos llega idéntico byte a byte, y una fila con la convención vieja (macOS y Windows) se convierte. | Prompt 52 — 2026-09-14 |
| **El número 29 quedó usado en las DOS direcciones —`029_saltar_lote_de_sincronizacion` local (fase 4.a) y `0029_restauracion_ventas_por_mes` de la nube (fase 4.b)— con contenidos distintos. Es un error de numeración mío: se documenta y NO se renumera.** | Renombrar la `0029` a `0030` antes de aplicarla al real; renumerar la local | El README de `supabase/migrations` dice que el espacio de numeración es UNO SOLO para las dos carpetas y que un número usado en una dirección queda reservado en la otra; la 4.b no lo respetó, y el propio README decía además que «la 029 local no existe», que era falso. Renumerar lo prohíbe el mismo README («el hueco es información»): la `029` local ya está aplicada en bases con su checksum y su nombre, y la `0029` ya está registrada por nombre en `pos-pruebas-descartable`; renombrar cualquiera dejaría un registro diciendo una cosa y el repositorio otra, la clase de discrepancia que §4.29 ya costó una vuelta. Queda anotado en las dos tablas del README con el motivo, y la siguiente local es la `030`, que reserva el `0030` del otro lado. | Prompt 52 — 2026-09-14 |
| **Un `timestamptz` con MÁS de tres decimales de segundo se conserva ENTERO al restaurar (con `Z`), en vez de rechazarse.** | Rechazarlo, como hacía la primera versión («normalizar sería truncar»); truncarlo a milisegundos; reescribir por SQL las filas de la nube que lo tengan | Lo destapó `verify:pantallas:restauracion`: la restauración se detenía en `configuracion_negocio.actualizado_en`, la única fila que siembra una migración con `now()` (0016) y que ninguna terminal pisa hasta que Jimmy cargue sus datos. **El proyecto real está así hoy** (`2026-09-11 14:58:55.89473+00`), o sea que la primera versión no podía restaurar contra él. Rechazar era la regla equivocada: esos decimales no los escribió nunca una terminal, así que no hay «forma original de tres decimales» que proteger; truncar sería perder los dígitos de verdad, que es lo que el módulo existe para no hacer; y reescribir la nube por SQL no protege de la próxima fila escrita desde el panel. El CHECK local admite cualquier cantidad de decimales, `Date.parse` los lee, y la regla de Julio para esta fase era «detenete si el valor convertido no pasa el CHECK local», no «detenete si tiene más decimales de los que la terminal escribe». Se conserva todo detrás de la fecha que `toISOString` ya pasó a UTC (los decimales de segundo no dependen de la zona). Probado con el valor del real, con una actualización real en SQLite, y en la quinta corrida del arnés por la ventana. | Prompt 52 — 2026-09-14 |
| **La restauración se verifica también POR LA VENTANA, con un guion aparte y con red (`verify:pantallas:restauracion`), que además mata el proceso con `SIGKILL` a mitad de la transferencia y retoma en un arranque limpio.** | Meterlo en `verify:pantallas` a secas; conformarse con el servicio (local y contra la nube) para la pantalla; simular la muerte cancelando desde la aplicación | `verify:pantallas` corre sin `POS_NUBE_URL` a propósito y en minutos; este recorrido necesita dos instalaciones, credenciales del proyecto de pruebas y la nube vacía, así que es un guion hermano y no un modo del mismo. Julio pidió ver la pantalla de «usuarios sin PIN» bloqueando el cierre y la retoma tras matar el proceso, no cancelarlo: el servicio no puede probar ni que el botón se niegue con el texto correcto ni que un proceso muerto con `SIGKILL` deje la base y el puesto de control coherentes para un arranque NUEVO. El arnés sondea `restauracion.json` cada 15 ms y mata al ver dos tablas listas; comprueba que las tablas listas están completas y las demás en cero; relanza sobre la misma carpeta y exige que abra directo en «Retomar». Encontró un defecto real (la fila anterior) y dos cosas que ninguna prueba con dobles muestra (la fábrica simulada con `POS_NUBE_URL` puesta, y dos `504` reales absorbidos por la escalera). | Prompt 52 — 2026-09-14 |
| **Un fallo transitorio de la nube A MITAD de una restauración la deja «detenida» y retomable; NO se reintenta sola. DECISIÓN FINAL, confirmada por Julio el 2026-09-14: nació como decisión abierta en el informe de la fase 4.b y él la cerró tal cual estaba construida.** | Una escalera de reintentos en el cliente de restauración, como la de la subida | El diseño (§6) no lo decidió y esta fase no lo inventó: la restauración es una operación atendida por una persona que está mirando la pantalla, y «se detuvo: HTTP 504; retomá» es honesto y suficiente; el puesto de control garantiza que retomar no repite ni pierde nada. La subida sí reintenta sola porque corre sin nadie delante. El arnés por la ventana vuelve a pulsar «Retomar» hasta tres veces anotando cada motivo, que es lo que haría una persona. **Julio la confirmó como final y no provisional**: una restauración detenida y visible, con su motivo, es lo que se quiere; si algún día una conexión que corta seguido pidiera una escalera acá, sería una decisión nueva con su propia fila, no un ajuste silencioso de esta. | Prompt 52 — 2026-09-14; confirmada como final en el Prompt 53 — 2026-09-14 |
| **La renovación del token DURANTE una restauración se verifica con una restauración real demorada por el arnés (75 s por página), no con dobles ni bajando el JWT del panel.** | Darla por buena porque `tokenVigente()` reusa la regla probada de la terminal; pedirle a Julio que bajara el JWT del proyecto de pruebas a 60 s; sembrar un año de ventas para que la restauración tardara de verdad | Julio preguntó qué pasa si la sesión supera los 900 s durante una corrida real, y «la regla es la misma que en la terminal» es razonamiento, no medición. Bajar el JWT del panel cambia la nube que se está verificando y ya costó una confusión (§4.22); sembrar un año de ventas mide la conexión de una casa y no la renovación. Un retraso del ARNÉS antes de cada página deja al cliente, al servicio, a GoTrue y a PostgREST exactamente como en producción y solo estira el reloj: la renovación ocurrió donde `vida-del-token.ts` la agenda, con tablas antes y después, y el control con el token viejo (`401 PGRST303`) es la mitad que ningún doble puede dar. Tarda diecisiete minutos, así que vive detrás de `POS_NUBE_RENOVACION=1` y no en `verify:restauracion` a secas. | Prompt 52 — 2026-09-14 |
| **Toda migración local se corre además sobre una COPIA de una base con datos reales antes de darse por hecha, y «ya está aplicada» se afirma leyendo `migraciones_aplicadas`, no por suponerlo.** | Darla por verificada con Vitest y con los arneses, que parten de bases nuevas | Julio pidió confirmar que la 030 «se aplica igual de limpia contra cualquier base con datos reales». Al mirar la base de trabajo de esta máquina resultó que NO la tenía —estaba en la 018 desde el 12 de septiembre, con la 028 y la 029 tampoco aplicadas— y que no tiene recibos, así que sobre ella la 030 no convertía nada. Se emitió un recibo con el código ANTERIOR (`09903de`) sobre una copia y se migró con el actual: fila, payload pendiente, PDF en su sitio y reimpresión, con salida cruda (§4.14); después se migró la base de trabajo, con respaldo. Las pruebas usan filas que yo invento con la forma que creo que tienen los datos, y una base con historia puede tener lo que ninguna previó. De paso: `verify:arranque` arranca contra una base temporal propia, no contra la de trabajo. | Prompt 53 — 2026-09-14 |
| **La restauración contra el proyecto REAL se ensaya con un guion aparte, `ensayo:restauracion`, que no siembra ni sube nada y en el que la contraseña la teclea la persona en la ventana.** | Aflojar el seguro para que `verify:restauracion` corra contra el real; pedirle a Julio la contraseña o un token para correrlo desde acá; darlo por bueno con el ensayo del descartable | Los dos arneses existentes siembran y suben una terminal de origen: contra el real escribirían datos falsos, y por eso el seguro los rechaza por nombre, y eso no se toca. La restauración en sí es solo lectura, así que lo que faltaba era un guion que SOLO restaure. La contraseña del usuario de restauración es la del dueño y no pasa por esta sesión ni por un archivo: el guion abre la aplicación real sobre una carpeta descartable, espera a que la persona la teclee, sigue la transferencia, exige que «Terminar» se niegue (nadie tiene PIN y el guion no asigna ninguno), deja la restauración para después y vuelca la base y la bitácora. Solo contra un proyecto que el seguro admita llena el formulario por su cuenta. Ensayado contra el descartable, 9 de 9, antes de proponerlo para el real (§4.35). | Prompt 53 — 2026-09-14 |
| **Cada petición HTTP de la restauración queda en la bitácora técnica con su método, su ruta (sin `select=` ni `order=`) y su código; nunca el token ni la contraseña.** | Seguir anotándolo solo en los arneses; anotar la URL entera; no anotar nada | La evidencia cruda que Julio exige la anotaban los arneses con su propio `fetch`, así que una restauración en la tienda —justo la que habría que poder auditar— no dejaba ese rastro. La lista de columnas es larga y siempre igual por tabla, y taparía lo que sí distingue una petición de otra (`limit`, `id=gt.…`); el token va en la cabecera y no se registra. Con prueba de que ni la contraseña ni los dos tokens aparecen en la bitácora, y de que lo que se recorta es solo lo que se anota: la petición sigue viajando entera. | Prompt 53 — 2026-09-14 |
| **`sync_cola` SE PODA: se borra de verdad lo ya subido hace más de 30 días, en un ciclo del trabajador y como mucho una vez por día. Lo pendiente, lo bloqueante, los archivos apartados y LO SALTADO A MANO no se tocan nunca.** | No podar y aceptar que la cola crezca; podar por cantidad de filas en vez de por antigüedad; borrar también los lotes saltados; un índice sobre `sincronizado_en` para acelerarlo | Riesgo 8.6: unas 150 000 filas al año, con su payload, en un disco que además guarda PDF. **Borrar rompe la regla del proyecto —nada se borra (§4.11)— y por eso la justificación tiene que ser exacta:** `sync_cola` no es historial del negocio, es una lista de TAREAS; el hecho vive en su tabla, la nube ya tiene su copia confirmada por `sincronizado_en`, y lo que se borra es la anotación de que faltaba subirlo. Si la tabla se borrara entera no se perdería un dato del negocio. Treinta días porque la pregunta más tardía que se le hace es la del cierre de mes («esta venta de fin de mes, ¿subió?»), y no tiene que cubrir ni una tienda sin internet —lo pendiente no se borra— ni la escalera de reintentos, que topa en una hora. **Lo saltado a mano se excluye porque la justificación no lo alcanza**: es una tarea que alguien decidió NO cumplir, y esa nota es su única marca en el disco. Por antigüedad y no por cantidad, porque la pregunta que protege es «¿cuándo?» y no «¿cuántas?». Sin índice: es un recorrido una vez por día de una tabla que la propia poda mantiene chica, y el índice encarecería cada inserción. Medido: 49 950 de 50 000 filas en 61 ms, en macOS. | Prompt 54 — 2026-09-14 |
| **El desfase del reloj se mide con el PUNTO MEDIO entre envío y recepción contra el CENTRO del segundo del servidor, con una incertidumbre explícita, y se avisa solo si pasa el minuto DESCONTADA esa incertidumbre.** | La resta directa `Date.now() - Date.parse(cabecera)`; medir solo en el ingreso, como ya hace `vida-del-token.ts`; corregir el reloj | Riesgo 8.5, que estaba «propuesto, no diseñado». La resta directa mide el desfase Y el viaje de ida y vuelta mezclados, y la cabecera `Date` tiene resolución de un segundo: con una conexión de tienda eso alcanza para inventar avisos que no existen, y un aviso falso repetido enseña a ignorarlo. Midiendo contra el punto medio y descontando la incertidumbre, **una conexión lenta no puede disparar el aviso: solo agranda la duda**, y hay prueba de que el mismo desfase avisa con una conexión normal y no con una lenta. Se mide en CADA respuesta de los cuatro caminos (proveedor, Auth, detector y restauración) con un observador compartido, que es lo que hace que el aviso salga una vez por hora y no una por camino. **No corrige la hora**: cambiarla es una acción administrativa que §4.6 prohíbe. Su umbral (60 s, del texto de §8.5) NO es el de §4.22 (30 s, cota medida de PostgREST): son dos diagnósticos por dos fuentes, y mezclarlos afirmaría como medido lo que no lo está. | Prompt 54 — 2026-09-14 |
| **Un rechazo de Auth queda en la bitácora técnica con su código HTTP y su `error_code`; un ingreso correcto no escribe nada.** | Dejarlo como estaba; registrar solo el mensaje legible; registrar también el cuerpo entero de la respuesta | Lo pidió un problema real del 2026-09-14: un ingreso de restauración rechazado mostraba «Supabase rechazó ese correo y esa contraseña» y el `invalid_credentials` no quedaba en ningún lado —Auth no recibía registrador y la causa técnica va al renderer sin pasar por `log-tecnico.log`—, así que hubo que reproducirlo con `curl`. Se registra el `error_code` y no solo el mensaje porque el código es estable y el mensaje es texto que puede cambiar de redacción. «No contestó» se distingue de «contestó que no», que se diagnostican distinto. El cuerpo entero no, porque un servidor puede devolver en él lo que se le mandó. Con pruebas de que la contraseña no aparece por ningún camino, incluido ese, y su control del buscador. | Prompt 54 — 2026-09-14 |
| **`win.files` REEMPLAZA a `files`, y lo que restringe el paquete son los patrones POSITIVOS de la lista que está en efecto. Medido en cuatro empaquetados, y evitó mandarle a Jimmy un instalador con las contraseñas de Supabase adentro.** | Confiar en que `files` sea una lista blanca, que es lo que el nombre sugiere; revisar el paquete a ojo | Con `files: [dist/**, dist-electron/**, package.json]` en la raíz y nada más, el primer instalador llevó `src/` entero con 93 archivos de prueba, `docs/`, `scripts/`, `supabase/`, los `tsconfig` y **`.env.nube-pruebas` y `.env.nube-real`**: contraseñas de verdad dentro del `.exe`. Agregar exclusiones ARRIBA no cambió nada (1262 → 1259 entradas), porque `win.files` ya existía y reemplaza esa lista. Lo que lo arregló fue mover los tres positivos DENTRO de `win.files` (→ 925, y 729 con las pruebas de las dependencias fuera). **Y se comprobó cuál de las dos cosas protege**: con los positivos en `win.files` y CERO exclusiones de `.env`, `src/` o pruebas, el paquete sale igualmente limpio. Las exclusiones se conservan como segunda capa y porque dejan la intención escrita, pero atribuirles el mérito habría sido afirmar lo que la medición no sostiene. | Prompt 55 — 2026-09-14; mecanismo corregido en el Prompt 56 |
| **La revisión del paquete es el `afterPack` de electron-builder, no un `npm run` aparte: si algo no debería viajar, el `.exe` no llega a existir.** | Un guion suelto que haya que acordarse de correr; un paso más en `npm run dist`; revisar a ojo el `release/` | Lo que estaba en juego la primera vez fueron contraseñas de Supabase dentro del instalador, y una revisión que hay que acordarse de correr es una revisión que un día no se corre —es el mismo argumento por el que la señal de transacción vive dentro del único envoltorio que abre transacciones (§4.18) y no en cada servicio—. `afterPack` ocurre con la aplicación ya empaquetada y ANTES de que NSIS arme el instalador, así que lanzar ahí aborta el empaquetado y el `.exe` nunca se crea; además borra el instalador que hubiera quedado de una corrida anterior, para que nadie tome por bueno un `.exe` viejo de una carpeta donde la corrida nueva falló. Un paso más en `npm run dist` no serviría: `npx electron-builder` a secas se lo saltearía. **Falsificado**: con un patrón que deja entrar `.env.nube-pruebas` y `src/`, el empaquetado sale con código 1 nombrando los cuatro archivos y `release/` queda sin ningún `.exe`. Las dos reglas que no se pueden falsificar desde la configuración —las pruebas y las dependencias— tienen sus 21 pruebas de Vitest cargando el guion de verdad. | Prompt 56 — 2026-09-14 |
| **El nombre del producto es `POS Jimmy Cano`, y el `appId` NO cambia.** | Dejar «POS Agricola»; «POS Agrícola» con tilde; renombrar también el appId por coherencia | De `productName` salen la carpeta de datos (`%APPDATA%\POS Jimmy Cano\`, donde vive la base con todas las ventas), la llave con que DPAPI cifra la credencial de la nube (§4.23, medido) y el nombre del ejecutable: **cambiarlo en una versión futura deja huérfana la base y deja ilegible toda credencial guardada**, sin recuperación automática. «POS Agricola» sin tilde se lee como un error de tecleo y con tilde mete un carácter no ASCII en una ruta de Windows sin ganar nada; el nombre del dueño hace inconfundible el ícono en su escritorio. El `appId` es un identificador y no un nombre visible: de él salen la clave de desinstalación del registro y la agrupación en la barra de tareas, así que cambiarlo instalaría la versión nueva AL LADO de la vieja en vez de actualizarla. El nombre se inyecta al paquete con `extraMetadata` y NO al `package.json` del repositorio, así que la aplicación de desarrollo sigue siendo `pos-agricola` y no comparte datos ni credencial con la instalada. | Prompt 55 — 2026-09-14 |
| **Empaquetar para Windows desde macOS NO necesita cross-compilar, porque no hay nada que compilar: `npmRebuild: false`.** | Dejar `npmRebuild: true` y confiar; montar una máquina Windows para el build; agregar un paso de CI en Windows | `better-sqlite3` 13 —la única dependencia nativa— trae los binarios de todas las plataformas dentro del paquete de npm (`prebuilds/`), elegidos en tiempo de ejecución por `process.platform` y hechos con N-API, así que el mismo archivo sirve para cualquier versión de Electron. Medido: en esta máquina no existe ningún `.node` compilado localmente, y el `prebuilds/win32-x64.node` es un `PE32+ DLL x86-64`. Con `npmRebuild: true` el empaquetado intentaría compilar C++ para Windows desde macOS, que es lo único que sí necesitaría una máquina Windows. **Lo que sigue sin medirse es que ese binario CARGUE en Windows**, que es distinto de que sea el archivo correcto. Si algún día entra una segunda dependencia nativa sin prebuilds, esta línea deja de alcanzar. | Prompt 55 — 2026-09-14 |
| **La pantalla de restauración nombra el proyecto de Supabase ANTES de que el usuario escriba nada.** | Dejarlo como estaba; mostrarlo solo en el error; mostrar solo la URL | El 2026-09-14 se tecleó la credencial del proyecto de PRUEBAS contra el REAL: cada proyecto tiene su propia tabla de usuarios, así que la credencial de uno nunca sirve en el otro, y GoTrue contesta `invalid_credentials`, que la pantalla traduce a «revisá que sean los de tu usuario de restauración». O sea que el síntoma apunta a la contraseña cuando el problema es el proyecto. Mostrarlo en el error llegaría tarde: lo que hay que evitar es tipear la credencial equivocada, no explicarla después. Se muestra la REFERENCIA —lo que el panel usa como nombre y lo que una persona reconoce— con la URL al lado. El dato ya viajaba en el progreso; lo que faltaba era mostrarlo. | Prompt 54 — 2026-09-14 |
| **Un turno con algún conteo de cierre SELLADO solo se cierra con autorización, aunque el conteo final cuadre.** El sello es un asiento `conteo_de_cierre_sellado` escrito al CONFIRMAR un conteo con diferencia. | Registrar solo el conteo final; exigir autorización solo si el final también tiene diferencia; guardar el sello en memoria o en una columna de `caja_sesiones` | Jimmy lo encontró en el equipo real: el cajero probaba números hasta cuadrar y no quedaba rastro del primero, lo que anulaba la autorización de diferencias. Exigir PIN solo si el final no cuadra deja el hueco intacto. La regla se reduce a un caso: si el final es un conteo sellado, ya tenía diferencia; si es otro, es una corrección. En memoria se borraría matando el proceso, que §4.5 permite. Una columna exigiría migración en la nube; `auditoria_log` ya es inmutable, se sincroniza y es donde un auditor busca. Usa el candado de `cierre_con_diferencia`, sin inventar otro. Ver §4.39. | Prompt 57 — 2026-09-14 |
| **La autorización de un reconteo vive en su propio asiento, `reconteo_de_cierre_autorizado`, con todos los conteos sellados y el final.** | Guardarla en `caja_sesiones.diferencia_autorizada_por` | Si el final cuadra, el CHECK de la migración 008 exige esas columnas vacías, y relajarlo reabriría el hueco de la 007 (§4.9). El asiento es la única constancia posible, y lleva los dos lados para que quien lo lea no tenga que reconstruirlos. | Prompt 57 — 2026-09-14 |
| **Un teclado alfanumérico en pantalla, UNO para toda la aplicación, abierto por `CampoDeTexto`; cierra al tocar fuera usando `click`, no `pointerdown`.** | Un teclado por formulario; confiar en el teclado táctil de Windows; cerrar en `pointerdown` | En la tienda no aparecía ningún teclado. Uno por campo dejaría dos abiertos a la vez. El de Windows no apareció en la prueba de Jimmy y encima taparía el nuestro, por eso `inputMode="none"`. `pointerdown` se midió: mueve el botón antes del clic y la categoría no se guarda. | Prompt 57 — 2026-09-14 |
| **El efectivo teórico en vivo sale del MISMO cálculo que `monto_esperado`, y se refresca cada 10 s.** | Calcularlo en la pantalla; una fórmula aparte para el turno | Dos cálculos terminan diciendo dos números. La pantalla no suma. Diez segundos porque las ventas se cobran en otra pantalla de la misma terminal. **La tensión con el conteo a ciegas queda abierta como punto 21 de §6.2.** | Prompt 57 — 2026-09-14 |
| **`productos.precio_compra` es nulable y `NULL` no es cero; el margen sin costo es «sin dato».** Migraciones 031 / 0031. | Default cero; exigir el costo al crear | El catálogo real no llegó y el costo no se conoce para todo. Cero diría que el producto no deja ganancia. El margen usa el costo vigente y lo dice. | Prompt 57 — 2026-09-14 |
| **La 0031 NO se aplicó a `pos-pruebas-descartable`: se midió dentro de un bloque revertido.** | Aplicarla ya, como las migraciones aditivas | Las funciones de la nube exigen el payload exacto, y la instalación de Jimmy sube a ese proyecto: aplicarla le detendría la cola. A diferencia de la 0027, esta cambia la forma del payload. Se aplica al instalar la versión con la 031. | Prompt 57 — 2026-09-14 |
| **El efectivo teórico solo viaja a la ventana de un rol ADMINISTRATIVO, y lo filtra el proceso principal.** | Esconderlo en la pantalla según el rol; mostrárselo a todos | Julio: si quien cuenta ve el número esperado, puede copiarlo en vez de contar. Esconderlo en la pantalla no protege: `window.pos.caja.estado()` se llama desde la consola. Para el rol venta ni se calcula. Las ventas en efectivo se ocultan con él porque inicial + ventas ES el teórico. §4.40. | Prompt 58 — 2026-09-14 |
| **Cerrar la caja son dos pasos, y el de conteo no muestra el teórico A NADIE, administrador incluido.** | Ocultarlo solo al rol venta; ocultarlo con CSS en la misma pantalla | El administrativo lo necesita para consultar durante el día, pero cuando cuenta es un cajero más. Con dos pasos la fila no está en el árbol mientras se cuenta. Se revela en la confirmación. Resuelve el punto 21 de §6.2. | Prompt 58 — 2026-09-14 |
| **INTERPRETACIÓN a confirmar: los diálogos posteriores a CONFIRMAR un conteo (diferencia y reconteo) siguen mostrando el esperado.** | Ocultarlo también ahí al rol venta | El conteo ya está sellado en `auditoria_log` y toda corrección exige PIN; quien autoriza tiene que ver qué aprueba (§4.9). Queda señalado en §4.40. | Prompt 58 — 2026-09-14 |
| **`venta_detalle.costo_unitario_snap` guarda el costo al vender; el margen usa esa foto, y una línea sin foto se cuenta aparte, nunca como cero.** Migraciones 032 / 0032. **SUPERA la fila del Prompt 57 que decía «el margen usa el costo vigente».** | Seguir con el costo vigente; rellenar las ventas viejas con el costo de hoy | Con el costo vigente, corregir un precio de compra hoy cambiaría el margen de ventas ya hechas. Rellenar el pasado con el costo de hoy sería inventarlo. Es el mismo criterio de `precio_unitario_snap` (§4.13). | Prompt 58 — 2026-09-14 |
| **A quien no es administrativo, el canal de cierre le manda esperado y diferencia en null, un mensaje sin montos, y el reconteo presentado como una autorización común** (`resultadoDeCierreParaLaVentana`). | Ocultarlo solo en la pantalla; dejar la diferencia visible; dejar los dos códigos distintos | Pedido de Julio. La diferencia con lo contado revela el esperado, y el código de reconteo solo aparece cuando el conteo nuevo cuadra, así que distinguirlo le diría a la cajera que acertó. El filtro envuelve todo el manejador y hay pruebas estructurales. **Cierra la interpretación de §4.40.1 y abre otra**: el administrador que autoriza en la sesión de la cajera no ve el monto. §4.40.3. | Prompt 59 — 2026-09-15 |
| **La 0031 y la 0032 se aplican a `pos-pruebas-descartable` y NO al real.** | Aplicarlas a los dos; esperar al instalador nuevo | Decisión de Julio. El real no sincroniza activamente hoy y su momento se decide con el plan de entrega. Se asume que la cola de la instalación de prueba de Jimmy se detiene hasta que instale una versión con la 031 y la 032. §4.40.4. | Prompt 59 — 2026-09-15 |
| **Cerrar con autorización son dos pasos: el PIN correcto revela el monto y deja una autorización PENDIENTE en el proceso principal; la caja se cierra con una segunda confirmación, y cancelar la retira.** | Mostrar el monto antes del PIN, como el descuento; cerrar con el PIN y mostrar el monto después; guardar la autorización en la ventana | Pedido de Julio. Antes del PIN no se puede mostrar: es lo que la cajera no debe ver. Cerrar primero dejaría aprobar sin ver. En la ventana, cancelar no la retiraría y quedaría usable desde la consola. Atada al turno, la sesión, el conteo y el monto mostrado; dos minutos y un solo uso. §4.40.5. | Prompt 60 — 2026-09-15 |
| **`POS_COMPILAR_SIN_NUBE=1` compila sin la nube incrustada; lo usan los arneses de pantalla.** | Borrar `.env.empaquetado` antes de verificar; incrustar solo en `dist` | Desde §4.38 toda compilación apuntaba al proyecto de pruebas y `verify:pantallas` medía otra cosa. La variable no cambia el empaquetado. Mover la incrustación solo a `dist` sería lo más limpio y cambia cómo compila `npm run dev`: queda para decidir. | Prompt 57 — 2026-09-14 |
| **CORREGIDO: `\\.\USB001` era probablemente incorrecto y nunca se midió en hardware real. La térmica se imprime por la cola de Windows en RAW, con PowerShell.** | Seguir escribiendo en la ruta con `node:fs`; una librería USB (libusb); un módulo nativo con `winspool` | La investigación previa a la pantalla, confirmada por fuentes externas independientes: `USB001` es un puerto del spooler, no un archivo; `usbprint.sys` se queda con la impresora USB y libusb exigiría reemplazarlo, rompiendo la cola. Un módulo nativo obliga a compilar para Windows (§4.37). Julio eligió PowerShell. §4.14 y §4.43. | Prompt 65 — 2026-09-15 |
| ~~**PowerShell se invoca con `-Command`, nunca con `-File`, y el comando no lleva comillas dobles.**~~ **REEMPLAZADA el mismo día por la fila siguiente: sigue sin `-File`, pero ya no usa `-Command` con `Invoke-Expression`.** | Un archivo `.ps1`; `-EncodedCommand` | Según la documentación de Microsoft (no medido), la política por omisión `Restricted` bloquea archivos de script pero no comandos. El script, el nombre y los bytes van en variables de entorno para que armar la línea de comandos no pueda romper nada. `ConstrainedLanguage` bloquea igual y se informa como `entorno`. §4.43. | Prompt 65 — 2026-09-15 |
| **Después de un ticket de prueba aceptado, la persona contesta cómo salió, y «símbolos raros o sin cortar» se guarda como señal de incompatibilidad ESC/POS, distinta de un fallo de conexión.** | Dar por buena la impresora si Windows aceptó el trabajo | Una térmica ESC/POS no contesta: ningún software puede saber si entendió los comandos. §4.43. | Prompt 65 — 2026-09-15 |
| **`impresora.json` guarda el NOMBRE de la impresora; el formato viejo con `dispositivo` se sigue leyendo pero la pantalla ya no lo ofrece.** | Migrar el archivo viejo; dejar de leerlo | Dejar de leerlo cambiaría en silencio a solo PDF una terminal que alguien configuró a mano. Guardar desde la pantalla lo reemplaza. §4.43. | Prompt 65 — 2026-09-15 |
| **PowerShell recibe el script constante con `-EncodedCommand`; el nombre de la impresora y los bytes van SOLO en variables de entorno, y ningún texto se convierte en código al ejecutar.** | `-Command` con `Invoke-Expression` del script (la versión anterior); pasar el nombre como argumento después de `-Command`; `-File` con los argumentos aparte | Pedido de Julio, con el principio de las funciones SECURITY DEFINER: el dato nunca se arma como código. La versión anterior no interpolaba el nombre, pero `Invoke-Expression` ejecutaba texto. Los argumentos después de `-Command` se interpretan como código, así que el nombre ahí sería la inyección. `-File` los pasa como valores, pero corre un archivo de script, que la política alcanza. En base64 la línea no tiene nada que escapar. Diez nombres hostiles en la prueba, falsificada. Riesgo inferido: antivirus que sospechan de `-EncodedCommand`. §4.43. | Prompt 66 — 2026-09-15 |
| **El historial de cajas lee lo guardado y NO recalcula el corte; la corrección de un recuento sellado sale del asiento `reconteo_de_cierre_autorizado`.** | Recalcular teórico y diferencia; agregar columnas a `caja_sesiones` para el reconteo | Recalcular haría que una regla nueva cambiara un corte viejo. Una columna exigiría migración en las dos nubes, y si el conteo final cuadra el CHECK de la 008 obliga a dejar la autorización vacía: el asiento es la única constancia. Un asiento ilegible se muestra como aviso, no se esconde. §4.44. | Prompt 67 — 2026-09-15 |
| **El asiento `reconteo_de_cierre_autorizado` se escribe siempre que un cierre con sellos CUADRA, no solo cuando cambió lo contado; y el mensaje distingue «cambió lo contado» de «cambió lo esperado».** | Seguir condicionándolo a `huboReconteo`; guardar el autorizante en `caja_cerrada.autorizadaPor` | Medido: con un sello, una venta en efectivo en el medio y el mismo número reconfirmado, el cierre exigía PIN y no dejaba escrito quién lo tecleó. `caja_cerrada.autorizadaPor` refleja las columnas de la diferencia de `caja_sesiones` y cambiarle el significado confundiría a quien ya la lee; el asiento de reconteo es donde §4.39 dice que está. Las dos causas son distintas y se registran por separado. §4.39. | Prompt 68 — 2026-09-15 |
| **Los filtros del historial son por día de APERTURA en hora de Guatemala y por quien ABRIÓ.** | Filtrar por día de cierre; filtrar por quien abrió o cerró | Una caja se identifica por su apertura, que existe también en las abiertas. Contar a quien cerró mezclaría en el filtro de Jimmy las cajas ajenas que solo cerró. Se reutiliza `resolverPeriodo`, para que un día signifique lo mismo que en los reportes (§4.15). §4.44. | Prompt 67 — 2026-09-15 |
| **La anulación de una venta usa UN canal, `venta:anular`, llamado dos veces: sin PIN valida y devuelve la vista previa; con PIN vuelve a validar, autoriza y ejecuta.** | Dos canales, uno para pedir y otro para confirmar; una autorización pendiente como la del cierre de caja | Es lo que dice §4.3 del diseño y el patrón del descuento excedente. Acá no hay ningún monto oculto que revelar después del PIN, así que la autorización pendiente del cierre (§4.40.5) no agrega nada. Volver a validar antes de mirar el PIN hace que una caja cerrada o una venta anulada mientras tanto no consuman un intento. §4.45. | Prompt 69 — 2026-09-15 |
| **`RepositorioDeVentas.anular()` se elimina y las consultas filtran con `VENTA_SIN_ANULACION`; dos se renombran a «NoAnuladas».** | Dejar `anular()` sin uso; dejar los nombres «Completadas» | Es el camino que el diseño descarta (§1.3), y dejarlo invita a usarlo. «Completadas» afirmaría que filtra por `estado`, que dice 'completada' también en las anuladas. Dos pruebas estructurales lo fijan. §4.45. | Prompt 69 — 2026-09-15 |
| **El lote de la anulación se encola desde el núcleo local aunque su puerta en la nube no exista todavía; y una versión con este núcleo no se instala en una terminal conectada.** | No encolar hasta el prompt de sincronización; encolar y cablear el enrutador ya | Encolar es el paso 8 de la transacción (§2.2), y no hacerlo dejaría anulaciones que nunca subirían sin que nada fallara. Cablear el enrutador sin la función de la nube no evita que la cola se detenga. La deriva anota la tabla en una lista que obliga a sacarla cuando llegue su espejo. §4.45. | Prompt 69 — 2026-09-15 |
| **Un conflicto de inventario al vender deja el asiento `conflicto_de_inventario` DESPUÉS de revertir, en una transacción aparte y en su propio lote. Si el asiento no se puede escribir, el cajero recibe igual el conflicto y la falla va a la bitácora técnica.** Hasta esta fecha §4.3 afirmaba que quedaba registrado y NO estaba implementado. | Escribirlo dentro de la transacción de la venta; corregir el texto de §4.3 en vez del código; dejar que una falla del asiento reemplace al conflicto; `log` opcional en `ServicioDeVenta` | Adentro, el `ROLLBACK` se lo lleva con la venta, que es lo que pasaba: medido con el código anterior, después del conflicto la bitácora solo tenía `caja_abierta`. Corregir solo el texto habría quitado la única evidencia de una premisa rota. Que la falla del asiento reemplazara al conflicto le mostraría al cajero «La operación no pudo completarse» en vez del producto que falló. El `log` es obligatorio para que ningún sitio la deje sin rastro. `entidad_tipo` es `productos` porque la venta nunca existió. **No cubre un segundo escritor en otra conexión**: con `BEGIN` a secas eso da `SQLITE_BUSY_SNAPSHOT` (medido); ver puntos 22 y 23 de §6.2. §4.3. | 2026-09-15 (número de prompt por confirmar) |
| **El asiento `conflicto_de_inventario` tiene UNA sola forma, que arma y escribe UNA sola puerta (`conflicto-de-inventario.ts`), con una prueba estructural que falla si la acción aparece fuera de ella; la anulación envuelve la escritura igual que la venta.** | Alinear a mano los dos servicios; dejar las dos formas y documentarlas; los nombres de la anulación (`saldoLeido`, `detalle`) | La venta y la anulación se escribieron a la vez, sin verse, y quedaron con cinco claves distintas para lo mismo. Alinear a mano deja abierto el hueco para el tercero. Nombres de la venta y sin `momento`, por decisión de Julio: `momento` repetía la columna `fecha`. `comparacion` es el nombre de la columna que las dos comparan. Sin envolver, una falla del asiento de la anulación le llegaba al cajero en lugar del conflicto (falsificado). Se pudo cambiar porque no había ningún asiento escrito: `auditoria_log` es inmutable. §4.3. | 2026-09-15 (número de prompt por confirmar) |
| **Ningún archivo del renderer dibuja un `<input>`, `<textarea>` ni `contentEditable` fuera de `TecladoEnPantalla.tsx`; lo hace cumplir una prueba sobre el árbol sintáctico, y `ProveedorDeTeclado` es el único hijo de `<main>`.** | Parchar los 22 campos uno por uno; una regla de ESLint; buscar `<input` con una expresión regular | El diálogo de salida quedó sin teclado porque agregar un campo suelto no hacía fallar nada: es el mismo hueco que se cerró con «todo asiento pasa por el envoltorio». Una regla de ESLint exigiría un plugin propio para lo que el compilador de TypeScript ya parsea en una prueba. Con expresiones regulares, un `<input>` citado en un comentario da falso positivo. Radio y checkbox se admiten con el tipo literal: se tocan y no reciben texto. §4.46. | Prompt 70 — 2026-09-15 |
| **El PIN de salida se teclea con `TecladoNumerico`, el mismo patrón de todas las autorizaciones, sin tocar el proceso principal.** | Un `CampoDeTexto` oculto con disposición entera | Es un PIN que se confirma, igual que el ingreso y las autorizaciones, y `TecladoNumerico` no tiene ningún campo que un teclado de Windows pueda reclamar. El teclado físico se conserva escuchando el diálogo. El candado y las tres vías viven en `controlled-exit.ts`, que no cambió. §4.46. | Prompt 70 — 2026-09-15 |
| **Las fechas conservan el control nativo y abren el calendario con `showPicker()` al tocar el campo.** | Escribir la fecha con el teclado en pantalla; un calendario propio | Elegir un día tocando es mejor que teclear `AAAA-MM-DD`, y un calendario propio sería mucho código para lo que Chromium ya trae. El riesgo es que no está medido en Windows táctil; si resulta incómodo, se cambia `CampoDeFecha` y la prueba estructural garantiza que es el único lugar. §4.46. | Prompt 70 — 2026-09-15 |
| **CORREGIDO: el cierre del teclado por «tocar fuera» mira dónde EMPEZÓ el gesto, no solo dónde terminó el `click`.** | Cerrar solo en `click` según su destino, como desde §4.39 | Medido en la app real: el teclado aparece bajo el dedo en el `mousedown`, el `click` va al ancestro común y el teclado se cerraba en el mismo toque que lo abría, en todo campo de la franja baja. `pointerdown` no sirve como disparador de cierre (§4.39, mueve el botón); sirve como marca de dónde empezó el gesto. §4.46. | Prompt 70 — 2026-09-15 |
| **La autorización remota es un código TOTP de seis dígitos (RFC 6238, HMAC-SHA1, 30 s, ±1 paso); el PIN remoto fijo se elimina (migración 037) sin conservar ninguno.** | Mantener el PIN fijo; un TOTP de 8 dígitos o de 60 s; conservar los PIN remotos existentes | Decisión de Julio. Un PIN fijo dictado una vez servía para siempre; un código TOTP sirve una vez y como mucho unos 90 s. Seis dígitos y 30 s son lo que muestran por omisión las apps de autenticación. El secreto nuevo no tiene nada que ver con el PIN viejo, así que conservarlo no era posible. §4.47. | Prompt 71 — 2026-09-15 |
| **El secreto de TOTP se guarda cifrado con `safeStorage`, en `usuarios.totp_secreto_cifrado` (BLOB), NUNCA sube a la nube y no tiene espejo.** | Guardar un hash (imposible: TOTP necesita el secreto); guardarlo en claro; subirlo cifrado | Regla no negociable de Julio: el secreto calcula todos los códigos futuros. Mismo mecanismo que la credencial de §4.23, con la misma advertencia: queda atado al nombre del producto. El CHECK de la base rechaza texto, así que un secreto en claro no entra ni por error. Probado buscando el secreto en todo archivo, payload, asiento y bitácora. §4.47. | Prompt 71 — 2026-09-15 |
| **Qué se tecleó lo decide el LARGO: 4 dígitos, PIN normal; 6 dígitos, código remoto, solo donde `ACEPTA_PIN_REMOTO` lo permite.** | Probar el código contra todo; preguntarle al cajero | Un mismo número ya no puede ser las dos cosas, así que desaparece la regla de «probar primero los normales». Seis dígitos donde el remoto no vale son `FORMATO_INVALIDO` y no consumen intento, igual que cualquier entrada que no es un PIN posible (§4.1). §4.47. | Prompt 71 — 2026-09-15 |
| **A REVISAR — un código TOTP sirve UNA sola vez (`totp_ultimo_paso`, comparar-y-cambiar), incluido el de la inscripción.** | Aceptar el mismo código mientras siga en la ventana | RFC 6238 §5.2. Sin esto, quien escucha el código dictado lo reusa unos 90 s. Consecuencia operativa: dos autorizaciones por teléfono seguidas obligan a esperar el código siguiente, hasta 30 s. Decisión técnica tomada sin consultar; queda señalada. §4.47. | Prompt 71 — 2026-09-15 |
| **Un código que coincide con dos administradores a la vez se rechaza (`CODIGO_AMBIGUO`) sin consumir intento ni paso.** | Atribuirlo al primero | Sería la atribución equivocada que §4.7 existe para impedir. Con secretos aleatorios de 160 bits la coincidencia es de uno en un millón por código, y el código siguiente la resuelve. §4.47. | Prompt 71 — 2026-09-15 |
| **A REVISAR — un código de inscripción equivocado DESCARTA el secreto y hay que empezar de nuevo con un QR nuevo.** | Conservar el secreto pendiente para reintentar con el mismo QR | Es la letra del pedido. La contrapartida: la cuenta ya agregada en el teléfono queda inútil y hay que borrarla, cosa que el mensaje dice. §4.47. | Prompt 71 — 2026-09-15 |
| **La colisión de PIN ya no mira la autorización remota; para el PIN normal no cambió.** | Comparar el PIN nuevo contra los códigos actuales de cada secreto | El secreto no lo elige una persona, así que no hay colisión de elección. Comparar contra el código de ahora exigiría descifrar todos los secretos en cada alta de usuario, sin proteger nada: el código cambia en 30 s. §4.47. | Prompt 71 — 2026-09-15 |
| **El QR lo arma el proceso principal como matriz de booleanos (`qrcode-generator`, MIT, JavaScript puro) y la ventana lo dibuja con `<rect>` de SVG.** | Mandar un `data:` o SVG en texto e inyectarlo; una librería nativa; generarlo en el renderer | La ventana no recibe HTML ni una URL que tenga que inyectar, y la política de contenido no cambia. Se comprobó en el paquete que la librería no tiene dependencias, guiones de instalación ni binarios. Que el QR se lee se midió con CoreImage, un lector ajeno. §4.47. | Prompt 71 — 2026-09-15 |
| **El emisor del `otpauth://` es la constante `EMISOR_DEL_CODIGO_REMOTO = 'Vixo POS'`, no `app.getName()`.** | Seguir con `app.getName()`; leer la marca de `package.json` | Pedido de Julio: la app de autenticación de Jimmy mostraba el nombre interno del repositorio. `app.getName()` cambia entre desarrollo y el instalador, y ninguno de los dos es la marca. `package.json` no tiene la marca en ningún campo. La premisa de que la marca ya estaba en la licencia y el publicador no se confirmó: hoy esta constante es el único lugar que la nombra. §4.47. | Prompt 72 — 2026-09-15 |
| **El instalador muestra la licencia (`build/licencia.txt`, texto fijado por su huella y sin cláusula de penalidad) y solo carga el español.** | `license_es.txt` localizado; RTF o HTML; dejar todos los idiomas | Pedido de Julio. Un `.txt` da la página con el botón «Acepto», el mismo que nombra el texto. Con todos los idiomas, un Windows en inglés diría «I Agree». La penalidad va solo en el contrato de servicios. §4.48. | Prompt 73 — 2026-09-15 |
| **«Vixo POS» es el publicador por `extraMetadata.author`, solo en el paquete; `productName`, `appId`, `shortcutName` y `uninstallDisplayName` no cambian.** | Cambiar `author` del package.json del repositorio; cambiar `productName` | Leído en app-builder-lib: el publicador sale de `author.name`, y la carpeta de datos, la clave de desinstalación y `app.getName()` salen de otros campos. Medido en el paquete: `CompanyName` y `Publisher` dicen «Vixo POS» y `productName` sigue igual. §4.48. | Prompt 73 — 2026-09-15 |
| **A REVISAR — el copyright queda «Copyright (c) 2026 Julio Orellana (Vixo POS)».** | «Copyright (c) 2026 Vixo POS» | El pedido dice agregar la marca al copyright. Poner solo la marca como titular es una decisión legal: la licencia dice que el software es «propiedad del desarrollador», y no consta que «Vixo POS» sea una persona jurídica. Se agregó sin quitar al titular. §4.48. | Prompt 73 — 2026-09-15 |
| **El acceso directo del escritorio es opcional con una página propia (`customPageAfterChangeDir`); electron-builder lo sigue creando y `customInstall` lo quita si se desmarcó.** | `createDesktopShortcut: false` y crearlo a mano; una casilla en la página final | Con `false`, el desinstalador de electron-builder deja de borrarlo. En la página final la elección llegaría después de instalar. En silencioso se crea, como antes. §4.48. | Prompt 73 — 2026-09-15 |
| **El título del asistente es `Caption "Instalación de Vixo POS"`, solo en el instalador; no se cambia `Name`.** | Cambiar `Name` para que todos los textos digan «Vixo POS»; no cambiar nada | `Caption` es solo de la ventana del instalador y electron-builder no lo fija. `Name` lo fija `common.nsh`: repetirlo es una advertencia y el empaquetado corre con `-WX`. Los textos de las páginas siguen diciendo «POS Jimmy Cano». §4.48. | Prompt 73 — 2026-09-15 |

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
| 2 | ¿La tienda emite factura fiscal (FEL/SAT) o solo recibo y proforma internos? | Cambia por completo el módulo de comprobantes y las obligaciones legales. **Y de esto depende una decisión ya tomada:** que una reimpresión muestre los datos VIGENTES del negocio en vez de un snapshot por venta (§4.14) se sostiene porque el papel dice de frente que es proforma y no vale como factura fiscal. Con facturación fiscal real, el emisor de un comprobante viejo pasa a ser un dato que no puede cambiar retroactivamente, y hay que revisar esa decisión. | Abierto |
| 3 | ¿El precio de mayoreo se activa por cantidad comprada, por tipo de cliente, o ambos? | Define el modelo de precios del catálogo. | Abierto |
| 4 | ¿Hay ventas al crédito / cuentas por cobrar? | Agregaría un módulo completo de clientes y saldos. | Abierto |
| 5 | ~~¿El PIN de autorización es por usuario administrador o uno solo para la tienda?~~ | — | **RESUELTO (Prompt 10): por usuario.** Cada usuario tiene su PIN con hash scrypt y sal propia; la auditoría registra el `usuario_id` real de quien autorizó. `POS_PIN_ADMINISTRADOR` ya no existe. Ver la sección 4.7. |
| 6 | ¿Qué roles exactos existen además de "venta" y "administrativo"? **Y quién tiene en la práctica el rol `administrativo`: solo el dueño, o también un encargado de confianza?** | Define la matriz de permisos (RBAC). Desde el Prompt 21 se pueden crear usuarios de los dos roles desde la pantalla, así que la pregunta dejó de ser teórica: el día que Jimmy le dé el rol administrativo a alguien más, hay que revisar el tope de descuento. **Y de esto depende el tope de descuento del rol administrativo**, que hoy se siembra en 100 % asumiendo que lo tiene el dueño (§4.13): si lo tuviera un empleado, ese 100 % le daría la capacidad de regalar mercadería sin que nadie más se entere, y el número habría que revisarlo. | Abierto |
| 7 | ¿Qué se hace con la merma (diferencia entre lo que entró al inventario y la suma de lo vendido)? ¿Se ajusta el saldo a mano y queda en auditoría? ¿Hace falta autorización de administrador para bajar inventario, como la hay para un descuadre de caja? | Sin regla, el inventario nunca cuadrará contra la realidad física del bodegón. **Ya hay un hueco concreto esperándola:** `ServicioDeProductos.ajustarInventario` solo SUMA y rechaza cualquier cantidad no positiva, a propósito, para no convertir la recepción de mercadería en una vía de bajar inventario sin controles. El módulo de mermas tiene que traer su propia regla de autorización. | Abierto |
| 8 | ~~¿El sistema debe impedir una venta que deje el inventario en negativo, o solo advertir?~~ | — | **RESUELTO (Prompt 6): la impide.** `inventario_disponible` tiene piso 0 en la base. Ver secciones 4.2 y 4.3. |
| 9 | **Modelo y marca de la impresora térmica. LLEGA EL JUEVES.** | El adaptador ESC/POS **ya está implementado**, pero **contra el estándar más común y sin probar contra hardware real**: solo comandos del núcleo, codificación CP850, sin código de barras ni imagen. **Hay que confirmar compatibilidad exacta con el modelo real el día que llegue.** Ver §4.14. ~~Falta además decidir cómo se configura el puerto~~ **Desde el 2026-09-15 hay pantalla** «Impresora de recibos» (§4.43), que imprime por la cola de Windows en RAW. **Con la impresora en la mano falta:** instalarla en Windows (`docs/GUIA-IMPRESORA.md`), elegirla en la pantalla, imprimir el ticket de prueba y contestar cómo salió. Que el ticket salga legible es lo único que ningún entorno de desarrollo puede verificar. | Abierto — **es lo próximo que hace falta del cliente**, junto con el catálogo |
| 10 | ¿Habrá más de una caja o sucursal sincronizando contra la misma nube? | Define si la sincronización necesita resolución de conflictos o solo respaldo. **Y define algo de seguridad:** con más de una caja, el bloqueo por intentos de un usuario necesita fuente de verdad centralizada o sincronización en tiempo real, o el presupuesto para adivinar un PIN se multiplica por el número de terminales. Ver la sección 4.4. | Abierto |
| 13 | **El catálogo real de Jimmy.** Nombres, categorías, precios, unidades e inventario inicial de verdad. Iba a entregarlo al día siguiente del Prompt 15. | Mientras no llegue, la tienda corre con el catálogo de ejemplo (`npm run seed:ejemplo`), que está marcado con el prefijo `[Ejemplo] ` justamente para que nadie lo confunda con el real. El día que llegue: `npm run seed:limpiar` y cargar el verdadero. | Abierto — **es lo próximo que hace falta del cliente** |
| 14 | ~~¿Qué debe ordenar los íconos de la pantalla de venta: `contador_ventas` o `cantidad_vendida`?~~ | — | **RESUELTO (Prompt 20): ordena `contador_ventas`, y no se cambia nada.** Julio lo decidió sin necesidad de consultarlo con Jimmy: contar VECES es la única medida comparable entre productos, porque las libras de maíz y las unidades de huevo no se suman en un mismo número. `cantidad_vendida` existe para **reportes futuros**, no para el orden de los íconos. |
| 15 | **¿Qué topes de descuento quiere Jimmy?** La mitad de «quién los configura desde dónde» ya está resuelta. | **YA HAY PANTALLA** (§4.16, Prompt 25): un administrador los cambia desde la aplicación, queda su nombre en `editado_por` y su asiento en `auditoria_log`. `npm run seed:limites` sigue existiendo para montar entornos de desarrollo, pero **ya no es la única puerta**. Lo que sigue abierto es el NÚMERO: los 10 % / Q20 del rol `venta` y los 100 % / Q1 000 del `administrativo` son valores de prueba y **no** una definición del negocio. Falta que Jimmy diga los topes reales. El del rol administrativo además **asume que ese rol lo tiene el dueño**, y hay que revisarlo si se le asigna a un empleado: ver la salvedad de §4.13 y el punto 6 de esta misma lista. | Abierto — falta el número, ya no la pantalla |
| 17 | **¿Un tope de descuento en porcentaje mayor que 100 debería rechazarse?** | Hoy **se acepta y la pantalla avisa sin bloquear** (§4.16). No es peligroso —`totalConDescuento` tiene piso en cero, así que 150 % no autoriza nada que 100 % no autorice ya— pero es un valor inútil y un tecleo plausible: confundir el campo del porcentaje con el de quetzales. Rechazarlo sería inventar una regla que Jimmy no confirmó, así que se avisa y se deja pasar. Si él prefiere que el sistema lo impida, es un cambio de tres líneas en `ServicioDeLimitesDeDescuento.leerNumero`. | Abierto — de bajo riesgo, se decide cuando haya ocasión |
| 18 | **¿Qué umbral de «stock bajo» tiene cada producto, y quién lo define?** | El reporte de inventario muestra la fotografía de hoy y **no tiene umbral ni alertas, a propósito** (§4.15): cuál es el mínimo de cada producto es una definición de negocio, y un umbral inventado convertiría una suposición nuestra en un aviso que parece una regla de la tienda. Hace falta saber si el mínimo es por producto, por categoría o uno solo para todo, y si depende de la temporada. Es un módulo futuro con su propio prompt. | Abierto — bloquea las alertas de stock, no el reporte |
| 16 | ~~¿Qué número de venta quiere ver el cajero en la confirmación?~~ | — | **RESUELTO (Prompt 23): el correlativo de `recibos.numero_recibo`.** La confirmación del cobro muestra «Recibo No. N», que es el mismo número que sale impreso en el papel y el que ordena el historial. El id de la venta sigue a la vista como referencia fina para rastrear en la base. |
| 18 | **¿Hace falta una pantalla para crear y editar precios especiales, y con qué reglas de autorización?** | `precios_especiales` existe desde el Prompt 5 y la venta los aplica desde el Prompt 19, pero **nada en producción los crea**: no hay servicio, ni canal, ni pantalla, así que hoy la tabla solo se llena desde las pruebas. Es el mismo hueco que tenía `limites_descuento` hasta el Prompt 25. Falta decidir quién puede configurar una promoción, si necesita autorización, y qué pasa con las vigencias solapadas más allá de la regla de «gana la más reciente» que el servicio ya aplica. **La sincronización lo tiene en cuenta**: la tabla está declarada como sincronizable y encolará sola el día que exista quien la escriba (§4.17). | Abierto |
| 19 | **¿Cómo debe resolverse un choque contra una restricción única que NO es la llave primaria, al subir a la nube?** **UNA DE LAS NUEVE YA ESTÁ CERRADA**: `limites_descuento`, con el id fijo por rol de las migraciones `028`/`0028` (§4.32). Quedan OCHO. **La restauración (fase 4.b, §4.35) ya no las provoca**: conserva los ids de la nube, así que una terminal restaurada que vuelva a subir choca por `(id)`, que el upsert absorbe. Lo que sigue abierto es la segunda terminal. | `escribir_fila` hace `ON CONFLICT (id) DO UPDATE`, así que solo absorbe choques contra la llave primaria, y un choque contra cualquier otra sale como `23505` y **detiene la cola**. Está medido contra la nube con `limites_descuento.rol`. Hoy la tienda con una sola caja no lo puede provocar; lo provocan una reinstalación, una restauración (fase 4.b) o una segunda terminal —donde `recibos.numero_recibo`, correlativo POR terminal, choca garantizado—. Las salidas posibles son al menos tres y ninguna es obvia: que `escribir_fila` conozca la clave natural de cada tabla, que los UUID se deriven de la clave natural, o que la terminal trate el `23505` de otro modo. **Las tres tocan el contrato con la nube**, así que se decide antes de la fase 4.b y antes de que exista una segunda caja, no cuando ocurra. Depende también del punto 10. | Abierto — **bloquea la restauración y el multi-terminal**, no la operación de hoy |
| 20 | **En una instalación NUEVA, ¿un asiento de auditoría anterior al primer usuario debería impedir restaurar?** | Hoy sí, y se descubrió sin buscarlo (§4.35): en una terminal recién creada no hay ningún administrador, así que la salida controlada se niega con `SIN_ADMINISTRADORES` —correcto, §4.1— y deja un asiento `salida_controlada_rechazada`. `auditoria_log` es una de las once tablas que la restauración exige VACÍAS, así que **pulsar el botón de salir una vez deja esa instalación sin poder restaurar**: «Esta instalación ya tiene datos», con el botón deshabilitado y sin que nadie haya cargado nada. Se sale borrando la carpeta de datos, que en la tienda significa volver a instalar. Son dos reglas correctas que se cruzan; las salidas posibles son dejarlo así (y decirlo en la pantalla, que hoy no lo explica), que `baseVacia()` ignore los asientos escritos antes de que exista el primer usuario, o que la salida controlada no audite cuando no hay a quién pedirle PIN —esta última **no**, porque perdería un hecho—. Toca una precondición de seguridad, así que se decide, no se improvisa. | Abierto — molesta el día que alguien toque ese botón antes de restaurar |
| 21 | ~~¿El efectivo teórico se muestra MIENTRAS el cajero cuenta, o se cuenta a ciegas?~~ | — | **RESUELTO (Prompt 58, §4.40): las dos cosas.** Solo el rol administrativo lo recibe, y el paso de conteo no lo muestra a nadie. La interpretación sobre los diálogos se cerró en el Prompt 59: tampoco lo muestran al rol venta (§4.40.3). |
| 22 | **¿La transacción de negocio debe abrir `BEGIN IMMEDIATE`, como dice §4.3, o se corrige el texto?** | Hoy `enTransaccionDeNegocio` abre `BEGIN` a secas. Medido el 2026-09-15: si otra conexión escribe entre la lectura y el comparar-y-cambiar, la venta falla con `SQLITE_BUSY_SNAPSHOT` en el acto, la ventana ve «La operación no pudo completarse.» y no queda asiento de conflicto. Con `.immediate()` la otra conexión es la que espera y falla. Afecta a las ocho operaciones de negocio, no solo a la venta. Hoy la instancia única lo hace improbable; importa si se abre el punto 10. §4.3. | Abierto — decisión técnica de Julio |
| 23 | ~~**¿Qué claves lleva `valor_nuevo` del asiento `conflicto_de_inventario`?**~~ | ~~La venta escribe `saldoQueSeLeyo`, `cantidadVendidaQueSeLeyo`, `comparacion` y `momento`. La anulación (§4.45) escribe `saldoLeido`, `cantidadVendidaLeida`, `detalle`, `causaTecnica` y `ventaId`. Es la misma acción con dos formas. Ningún código lee estos asientos, así que alinearlas no rompe nada, pero un auditor que filtre por la acción va a encontrar las dos. §4.3.~~ | **RESUELTO (2026-09-15, decisión de Julio): una sola forma y una sola puerta.** Nombres de la venta, sin `momento`, con `ventaId` (null en la venta) y `causaTecnica`. La escribe solo `conflicto-de-inventario.ts`, y una prueba estructural lo exige. No había ningún asiento escrito con ninguna de las dos formas (§4.3). |
| 24 | **La autorización remota por TOTP no viaja entre terminales ni sobrevive a una restauración, a una terminal nueva ni a un cambio del nombre del producto.** | Por la regla no negociable (§4.47), el secreto vive solo cifrado en ESTA terminal. En cada uno de esos casos el administrador tiene que volver a inscribirse, **estando físicamente en la terminal**, porque la inscripción exige su sesión. Con más de una caja (punto 10), cada una necesita su propia inscripción y el teléfono muestra una cuenta por caja. Hay que decidir si eso es aceptable o si se diseña otra cosa. **No se decidió acá.** | Abierto |
| 25 | **¿Qué pasa si Jimmy pierde el teléfono, o la instalación que ya tiene tenía un PIN remoto fijo?** | Perder el teléfono no se puede resolver a distancia: la reinscripción exige un administrador en la terminal. Mientras tanto, la vía remota de esa persona queda sin uso, y quien tenga el teléfono desbloqueado puede generar códigos hasta que se reinscriba. La instalación de prueba de Jimmy (`v1.0.0-prueba.1`) **tiene un PIN remoto fijo que deja de funcionar al instalar esta versión**: la 037 lo borra. Antes de actualizar hay que avisarle que se inscriba con la app, y decidir quién lo acompaña. | Abierto — **bloquea la entrega de esta versión a Jimmy** |
| 26 | ~~**La licencia dice «Versión: 1.1.0» y el package.json dice 1.0.0.**~~ | ~~El instalador de verificación salió como `POS-Jimmy-Cano-Setup-1.0.0.exe` con una licencia de la 1.1.0.~~ | **RESUELTO (2026-09-15, Julio): `package.json` pasó a 1.1.0.** Una prueba exige ahora que la versión de la licencia sea la del `package.json`, así que cada release futuro obliga a actualizar el texto aprobado (§4.48). |
| 27 | **¿Quién figura como titular en el copyright del instalador?** | Hoy «Julio Orellana (Vixo POS)» (§4.48). Poner solo «Vixo POS» depende de que la marca tenga una persona jurídica detrás o de cómo se inscriba ante el Registro de la Propiedad Intelectual. Es legal, no técnico. | Abierto — decisión de Julio |
| 11 | ¿Cada cuánto y hacia dónde se respalda la base de datos local? | El archivo SQLite contiene todas las ventas; hoy no hay política de respaldo. | Abierto |
| 12 | **Falta la verificación completa en una máquina Windows real** con teclado latinoamericano: el atajo `Ctrl+Shift+Alt+Q`, la intercepción de `Alt+F4`, que el Administrador de tareas (`Ctrl+Shift+Esc`) y `Ctrl+Alt+Supr` sigan funcionando, la ventana a pantalla completa sin marco, y más adelante impresión y touch. **Desde la fase 3.a se suma `npm run diagnostico:credencial`** **desde la 3.c también `npm run diagnostico:imagen`**, **desde el 2026-09-15 el teclado en pantalla con el dedo: que tocar una fecha abra un calendario usable, que `inputMode="none"` impida el teclado táctil de Windows encima del nuestro, y que el diálogo de salida se use sin teclado físico (§4.46)**, que comprueba que `nativeImage` reduzca la foto de verdad en esa máquina (§4.33). Y el primero, que comprueba que el `safeStorage` de esa máquina cifre de verdad el token de refresco: en Windows el respaldo es DPAPI y en macOS el llavero, así que la medición hecha en macOS no dice nada del caso real (§4.23). | Windows es la plataforma de producción y el criterio de aceptación final (ver el principio de la sección 4). Todo lo anterior está verificado en macOS y cubierto por pruebas que simulan la entrada de Windows, pero **eso no cuenta como verificado**. **Desde la fase 4.c hay además una lista concreta de NÚMEROS que medir en el i3 de la tienda** —riesgo 8.8 del diseño, tabla en §4.36—: la poda sobre una cola grande, el hueco del bucle de eventos durante un ciclo, una página de 1 000 filas al restaurar, la reducción de una foto, y el arranque del trabajador. Ninguno de esos números es falso; todos son de otra máquina. | Abierto — **es la prioridad de verificación del proyecto** en cuanto haya una máquina Windows |

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
- **Sí existe** el módulo de usuarios completo: autenticación con PIN, bloqueo
  por intentos, sesión en memoria, guard de permisos, primer arranque, pantalla
  de ingreso y **gestión de usuarios** —crear, editar, cambiar el PIN y dar de
  baja o reactivar, en cualquier momento y con rol administrativo—. Ver la
  sección 4.7. Hasta el Prompt 21 solo existía el primer arranque, así que no
  había forma de dar de alta al cajero de la tienda: ese hueco está cerrado.
- **Sí existe** el módulo de caja: apertura y cierre con los dos modos de
  captura, arqueo por denominaciones, autorización dual del descuadre, una sola
  caja en todo el sistema y autorización para cerrar la caja de otra persona.
  Ver la sección 4.9.
- **Sí existe** el módulo de catálogo: categorías, productos, ajuste de
  inventario con auditoría, fotos en disco local y sus dos pantallas de
  administración. Ver la sección 4.11.
- **Sí existe** un catálogo de ejemplo sembrable y borrable
  (`npm run seed:ejemplo` / `npm run seed:limpiar`), que **no** es parte de las
  migraciones. El catálogo real de Jimmy todavía no llegó.
- **Sí existe** el módulo de venta completo hasta el cobro: la pantalla táctil,
  el ticket, los precios especiales, el descuento con tope por rol y su
  autorización, la forma de pago y la transacción atómica que registra la venta.
  Ver las secciones 4.12 y 4.13.
- **Sí existe** el cálculo real de `monto_esperado`, con las ventas en efectivo
  sumadas y las de tarjeta excluidas. Ver la sección 4.10.
- **Sí existe** el módulo de comprobantes: datos del negocio, generación del
  PDF, impresión térmica por ESC/POS, historial y reimpresión. Ver la sección
  4.14. La impresión **está escrita contra el estándar y NO probada contra la
  impresora real**, que llega el jueves.
- **Sí existen** los tres reportes: resumen de ventas por período, ventas por
  producto e inventario, con su selector de período en hora de Guatemala. Ver la
  sección 4.15. **Ninguno agrega ni ordena en SQL sobre una columna decimal**, y
  esa regla vale para todo reporte futuro.
- **Sí existe** la pantalla de topes de descuento (§4.16), con confirmación y
  con `editado_por` llenado con el administrador real. `npm run seed:limites`
  sigue existiendo para entornos de desarrollo nuevos, pero **ya no es la única
  forma de cambiarlos**. Lo que falta es el número real que quiera Jimmy: punto
  15 de la sección 6.2.
- **Sí existe el NÚCLEO LOCAL de la anulación de una venta** (§4.45): las
  migraciones 033 y 034, el servicio con la reposición, el voucher y el PIN, los
  asientos y el canal `venta:anular`. **No existen todavía** su sincronización a
  la nube, la restauración, el recibo marcado, el reporte de cobros con tarjeta
  ni la pantalla. **Una versión con este núcleo no se instala en una terminal
  conectada a la nube** hasta que exista la sincronización.
- **No existen las alertas de stock mínimo, los gráficos ni la exportación de
  reportes a un archivo.** El umbral de cada producto es una definición de
  negocio que falta: punto 18 de la sección 6.2.
- Tampoco hay **mermas ni ajustes de inventario a la baja**: el ajuste que
  existe solo suma mercadería recibida, y las bajas son un módulo futuro con sus
  propias reglas de autorización.
- No hay log de auditoría: los puntos donde debería escribirse ya están
  marcados con `TODO(auditoria)` en el controlador de salida.
- **Sí existe** el historial de cajas (§4.44): todas las sesiones con quién
  abrió y cerró, diferencias autorizadas, recuentos corregidos, filtros y el
  desglose por denominación. Solo administrativo.
- **Sí existe** la impresión térmica real, por la cola de Windows en RAW, y la
  pantalla «Impresora de recibos» para elegirla, probarla y quitarla (§4.43).
  Sin `impresora.json` el recibo queda solo en PDF. No está probada en Windows
  ni contra la impresora de Jimmy. No hay adaptador real
  de Supabase: ahí sigue solo el contrato y la implementación simulada.
- **La APLICACIÓN todavía no habla con la nube, pero su diseño está aprobado y
  cuatro fases están construidas.** El diseño completo vive en
  `docs/SINCRONIZACION.md` (Prompt 28), aprobado el 2026-09-11 con dos
  excepciones anotadas en §4.17.
  - **Fase 1.a** (§4.17): la migración `018_sync_cola_lotes` y la **bandeja de
    salida transaccional**, que escribe en `sync_cola` dentro de la misma
    transacción de cada operación de negocio.
  - **Fase 1.b** (§4.18): el **trabajador**, que lee esa cola por lotes,
    respeta el orden de llegada, aplica el presupuesto por ciclo y la escalera
    de reintentos, detiene la cola ante un error determinístico y cede ante una
    venta en curso. Corre contra `SimulatedSyncProvider`.
  - **Fase 2.a** (§4.19): el proyecto de pruebas descartable y las migraciones
    `0019` a `0022`, que solo existen del lado de la nube.
  - **Fase 2.b** (§4.20): las **funciones de sincronización** de la `0023`, el
    guion `verify:nube` con su seguro, y la prueba de deriva. Aplicada en los
    dos proyectos el 2026-09-12, junto con la `0024`.
  - **Fase 2.c** (§4.21): las **políticas de RLS** de la `0025` y los **buckets
    de Storage** de la `0026`. Aplicadas en los dos proyectos el 2026-09-13,
    con los dos pasos manuales del panel hechos y medidos (§4.22). **La fase 2
    queda cerrada entera.**
  - **Fase 3.a** (§4.23): la **credencial de la terminal**.
    `safeStorage` cifrando el token de refresco en
    `<userData>/sincronizacion.credencial`, la pantalla «Conectar con la nube»
    solo para rol administrativo, la renovación automática antes del
    vencimiento —calculada con `exp - iat`, no con el reloj local— y el
    reintento con backoff ante un corte de red. Y la **credencial revocada**:
    el estado «sin credencial», su aviso con fecha y filas pendientes, y la
    cola que se sigue llenando sin poder subir hasta reaprovisionar.
  - **Fase 3.b** (§4.24): el **`SupabaseSyncProvider` real**, que enruta cada
    lote a una de las cinco funciones de la `0023` y usa por primera vez la
    credencial de la 3.a; la **detección de conexión** de tres capas y el
    latido diario que evita que el proyecto gratuito se pause.
  - **Fase 3.c** (§4.33): los **archivos**. La foto se reduce a 800 px al
    guardarse, se encola en `sync_cola` como `archivo_foto` y sube al bucket
    `fotos` sin `x-upsert`; los archivos van DESPUÉS de todas las filas de
    negocio, y una foto que ya no está en el disco se aparta un día sin
    detener la cola. **Los PDF de recibos NO se suben**, por decisión de
    §2.5.3, y hay tres capas que lo impiden.
  - **Fase 4.a** (§4.34): los **tres niveles de visibilidad** de §3.3 del
    diseño. El indicador de la barra de estado (siempre visible, sin guard de
    rol); el aviso al iniciar sesión con pendientes de más de 24 h (decisión 8,
    **provisional**); y la **pantalla de sincronización**, solo administrativo,
    con el error de un lote bloqueante tal cual lo devolvió Postgres y dos
    acciones —reintentar ahora, y **saltar el lote**, que exige PIN de
    administrador (superficie propia, sin PIN remoto) y queda en
    `auditoria_log` (decisión 9).
  - **Fase 4.b** (§4.35): la **restauración desde la nube**, desde la
    pantalla de configuración inicial y solo sobre una base vacía. Sesión
    efímera con el rol `restauracion`, precondición de deriva contra el
    contrato vivo, las doce tablas en el orden del grafo de llaves foráneas
    con los MISMOS ids que la nube, conversión de tipos sin redondear, fotos
    desde Storage, verificación por conteos y suma por mes al centavo,
    anomalías por `recibido_en`, todo usuario sin PIN hasta recibir uno nuevo,
    y un puesto de control retomable. Verificada contra
    `pos-pruebas-descartable` con `npm run verify:restauracion`, y por la
    ventana —con el proceso matado a mitad y retomado en un arranque limpio—
    con `npm run verify:pantallas:restauracion`.
  - **Fase 4.c** (§4.36): **el cierre del módulo.** La **poda** de `sync_cola`
    (riesgo 8.6): borra lo ya subido hace más de 30 días, en un ciclo del
    trabajador y como mucho una vez por día, sin tocar lo pendiente ni lo
    saltado a mano. El **aviso de reloj desfasado** (riesgo 8.5): se mide
    contra la cabecera `Date` de cada respuesta de los cuatro caminos que
    hablan con Supabase, con incertidumbre explícita para que una conexión
    lenta no invente avisos, y se avisa en la bitácora si pasa de un minuto.
    Más el **rechazo de Auth con su `error_code`** en la bitácora y **el
    proyecto de Supabase a la vista** en la pantalla de restauración.
  **EL MÓDULO DE SINCRONIZACIÓN ESTÁ TERMINADO.** No queda ninguna sección del
  diseño sin construir ni ningún riesgo de su §8 sin respuesta escrita: siete
  cerrados y tres abiertos a propósito —el robo antes de la revocación, que
  ningún software cierra; el pausado del proyecto gratuito y el respaldo local,
  que son decisiones de negocio— más el 8.8, que espera la máquina de la
  tienda. **La aplicación sigue sin haber hecho una llamada de red en la
  tienda**: sin
  `POS_NUBE_URL` no se construye la sesión de nube, y las únicas llamadas
  reales las hacen `npm run verify:nube`, `npm run verify:restauracion`,
  `npm run diagnostico:credencial` y `npm run diagnostico:imagen`, guiones de
  desarrollo. La `0029` está en el real desde el 2026-09-14 (§4.4): los dos
  proyectos tienen las mismas 24 migraciones y las mismas funciones.
- **`precios_especiales` se puede CONSUMIR pero no CREAR.** La venta lee los
  precios especiales vigentes y los aplica (§4.13), pero no hay servicio, ni
  canal IPC, ni pantalla que cree uno: la tabla se llena solo desde las pruebas.
  Ver el punto 18 de §6.2.

## 8. Comandos

```bash
npm install          # instalar dependencias (recompila better-sqlite3 para Electron)
npm run dev          # abrir la aplicación en modo desarrollo
npm test             # correr las pruebas automatizadas
npm run lint         # revisar reglas de código y de arquitectura
npm run typecheck    # verificar tipos en los tres proyectos de TypeScript
npm run verify       # lint + typecheck + pruebas, todo junto
npm run verify:arranque  # arranca la app, imprime un informe de verificación y sale
npm run seed:ejemplo     # siembra el catálogo de ejemplo (NO es una migración)
npm run seed:limpiar     # quita el catálogo de ejemplo, sin tocar datos reales
npm run seed:limites     # topes de descuento: venta 10 %/Q20, admin 100 %/Q1000
npm run seed:limites:limpiar  # los quita, y los dos roles vuelven a cero
                         # LOS DOS son para montar un entorno de desarrollo:
                         # desde el Prompt 25 los topes se cambian desde la
                         # aplicación, con su auditoría (§4.16).
npm run verify:pantallas # maneja la app real y comprueba qué se ve en pantalla
npm run verify:pantallas:caja  # la app real: teclado en pantalla, teórico en vivo, cierre con
                         # confirmación, EL RECUENTO SELLADO (escenario de Jimmy), el margen con
                         # la foto del costo, y quién ve el teórico: el administrativo en el
                         # resumen y NO al contar; la cajera ni en pantalla ni por el canal; y el
                         # PIN correcto que revela y espera (confirmar o cancelar). AL FINAL
                         # sale de la aplicación con el PIN REMOTO y lee el asiento (§4.41).
                         # Deja capturas y lee la base al final (§4.39).
npm run verify:pantallas:teclado  # la app real: toca los 22 campos que no tenían teclado y escribe con él; los
                         # caminos de salida (atajo real y sintético, Cmd+Q real, app.quit, close, botón)
                         # siguen pidiendo PIN; el candado de intentos; la sonda de macOS (§4.46).
npm run verify:pantallas:historial-de-cajas  # la app real: cinco cajas armadas por los canales reales
                         # (diferencia autorizada, exacta por denominación, cerrada por otra persona,
                         # recuento corregido, abierta); la cajera no llega; filtros y detalle (§4.44).
npm run verify:pantallas:impresora  # la app real con impresoras SIMULADAS: estado, prueba sin elegir,
                         # desconectada, la que recibe (bytes ESC/POS), confirmación «ilegible»,
                         # guardar, reinicio, venta con impresora y venta después de quitarla (§4.43).
npm run verify:nube      # compara lo que la nube declara con supabase/esquema-nube.json (con red)
npm run verify:nube -- --tomar-foto    # reescribe esa foto, a propósito
npm run verify:nube -- --destructivo   # la batería contra el proyecto de PRUEBAS; el seguro
                                       # se niega ante cualquier otro (código 3)
npm run fotos:reducir    # UNA SOLA VEZ: reduce a 800 px las fotos guardadas antes
                         # de la fase 3.c y las encola para subir. No es una
                         # migración. Correrlo dos veces no duplica nada (§4.33).
npm run diagnostico:imagen       # ¿el nativeImage REAL de este sistema reduce la foto?
                                 # Corre dentro de Electron. Código 0 se redujo,
                                 # 1 NO se redujo (GRAVE), 2 no se pudo medir.
                                 # HAY QUE CORRERLO EN WINDOWS (§4.33).
npm run diagnostico:credencial   # ¿el safeStorage REAL de este sistema cifra la credencial?
                                 # Corre dentro de Electron. Código 0 cifrada, 1 legible (GRAVE),
                                 # 2 sin cifrado disponible. HAY QUE CORRERLO EN WINDOWS (§4.23).
npm run verify:restauracion   # RESTAURACIÓN DE VERDAD contra pos-pruebas-descartable (fase 4.b):
                              # siembra una terminal de origen con los servicios reales, la sube,
                              # sube una segunda tanda «después del robo», restaura en una base
                              # nueva y compara ids, decimales byte a byte, sha256 de la foto,
                              # conteos y suma por mes. Imprime cada petición HTTP con su hora y
                              # su código. Exige las ONCE tablas de negocio del proyecto de
                              # pruebas VACÍAS (por SQL) y las credenciales de .env.nube-pruebas.
                              # NO corre en `npm test` (vitest.nube.config.ts).
npm run verify:pantallas:restauracion   # LA RESTAURACIÓN POR LA VENTANA, contra pos-pruebas-descartable:
                              # una app de ORIGEN creada con clics y conectada a la nube, otra app
                              # NUEVA que restaura con clics, el proceso MATADO con SIGKILL a mitad
                              # de la transferencia, arranque limpio que retoma, «terminar» negado
                              # hasta asignar los PIN, ingreso con el PIN nuevo (el viejo no entra).
                              # Exige la nube VACÍA y .env.nube-pruebas. Es la contraparte con red
                              # de verify:pantallas.
npm run verify:restauracion:renovacion   # ~17 MINUTOS: una restauración más larga que la vida del
                              # token (retraso por página); comprueba la renovación A MITAD de la
                              # transferencia y el control (el token viejo, 401 PGRST303). Exige la
                              # nube VACÍA. No corre con verify:restauracion a secas.
npm run ensayo:restauracion -- --entorno=.env.nube-real   # ENSAYO DE RESTAURACIÓN contra el proyecto
                              # REAL, sin sembrar ni subir nada: abre la app real sobre una carpeta
                              # DESCARTABLE, Julio teclea su contraseña en la ventana, y el guion
                              # sigue la restauración, exige que «Terminar» se niegue y vuelca la
                              # base y la bitácora (cada petición con su código). Sin --entorno va
                              # contra el descartable y llena el formulario solo. La carpeta queda.
                              # --carpeta=<ruta> RETOMA sobre una carpeta de ensayo ya existente
                              # (la corrida se interrumpió después de arrancar la restauración):
                              # se niega con código 2 si esa carpeta no tiene puesto de control y
                              # su base ya tiene filas, porque entonces no podría restaurar.
                              # Para CORTARLO: Ctrl+C. La aplicación no se cierra desde adentro
                              # mientras no haya un administrador (§4.35).
npm run verify:nube -- --esperar-vencimiento   # comprueba que un token VENCIDO sea rechazado.
                                       # TARDA la vida del token + 90 s de margen: con el JWT
                                       # en 900 s son ~16 minutos. El margen NO se baja de 60 s
                                       # (§4.22: PostgREST tolera ~30 s de reloj tras el exp).
```

Archivos que la aplicación usa en `<userData>` y que conviene conocer:

| Archivo o carpeta | Qué es |
|---|---|
| `pos-agricola.db` | La base de datos de la tienda. |
| `recibos/` | Los PDF de los comprobantes emitidos. |
| `fotos-de-productos/` | Las fotos del catálogo. |
| `impresora.json` | El NOMBRE de la impresora de Windows y la última prueba (§4.43). **Si no existe, no hay impresión** y el recibo queda solo en PDF. |
| `log-tecnico.log` | Bitácora TÉCNICA: fallos de impresión y de PDF. No es `auditoria_log`. |
| `restauracion.json` | El puesto de control de una restauración a medias (§4.35). **Si existe, la aplicación arranca en la pantalla de restauración** y no en la de ingreso. Se borra solo al terminar; nunca guarda una credencial. |

Los cuatro `seed:` arrancan el proceso principal sin abrir ventana, trabajan
contra la MISMA base que usa la aplicación e imprimen qué hicieron. Se activan
con un argumento de línea de comandos y no con una variable de entorno, para
que también funcionen en el `cmd` de Windows.

## 9. Mapa del repositorio

```
src/main/       proceso principal de Electron: ventana, SQLite, IPC
  database/          conexión a SQLite (nadie más la abre)
    migrations/      migraciones .sql numeradas del esquema local
                     (y un .LEER-ANTES-DE-TOCAR.md junto a la 008: su
                      restricción tapa un hueco de la 007)
    repositories/    una clase por tabla; la única puerta hacia los datos
    decimal-columns.ts  única vía para leer/escribir dinero, peso y cantidad
    bandeja-de-salida.ts  llena sync_cola DENTRO de la transacción de negocio
    transaccion-en-curso.ts  la ÚNICA puerta para abrir una transacción de
                             negocio; levanta la señal con la que el trabajador cede
    migrator.ts      aplica las migraciones y verifica sus checksums
  ipc/          manejadores IPC, con validación Zod de cada payload
    respuesta.ts   envoltorio único de respuesta; todo manejador pasa por aquí
  preload/      único puente hacia el renderer (expone window.pos)
  domain/       módulos de dominio
    usuarios/   autenticación, bloqueo por intentos, sesión, permisos y gestión de usuarios
    caja/       apertura y cierre del turno, arqueo por denominaciones e historial de cajas
    catalogo/   categorías, productos, ajuste de inventario, fotos y datos de ejemplo
    venta/      precio efectivo, descuento, topes por rol, la transacción de la venta y su anulación
    reportes/   los tres reportes y el período en hora de Guatemala. NUNCA agrega en SQL
    negocio/    los datos de la tienda que encabezan el recibo
    recibo/     modelo, plantilla, ESC/POS y emisión del comprobante
  sincronizacion/  el trabajador que lee sync_cola, sus reintentos y su cadencia
  restauracion/    la operación inversa (fase 4.b): cliente de solo lectura con sesión
                   efímera, conversión de tipos, orden por llaves foráneas, puesto de
                   control y el servicio. Sus asientos pasan por la bandeja de salida
  adapters/     implementaciones reales: impresión térmica por ESC/POS
  recibo/       HTML a PDF con el Chromium que Electron ya trae
  log-tecnico.ts  bitácora de eventos técnicos; NO es la de auditoría
  windows/      creación y bloqueos de la ventana kiosko
src/renderer/   interfaz React (sin acceso a Node, a SQLite ni a la red)
  src/venta/    lógica pura del ticket en memoria (sin DOM, sin IPC)
src/shared/     código compartido main <-> renderer
  adapters/     interfaces de integración + implementaciones seguras
  types/        contrato IPC y DTOs con Zod
  auth.ts       hash y verificación del PIN con scrypt (NO va al renderer)
  pin.ts        reglas de formato del PIN (sí va al renderer)
  money.ts      aritmética exacta con Decimal.js
  descuento.ts  cálculo del descuento discrecional (lo usan las DOS capas)
  contrato-de-sincronizacion.ts  la versión de contrato y las listas cerradas de la 0023
  __tests__/    pruebas automatizadas
scripts/        guiones de desarrollo: verify:pantallas, verify:nube y su seguro, y
                verify:pantallas:restauracion (la restauración por la ventana, con red),
                y ensayo-de-restauracion.cjs (la restauración contra CUALQUIER proyecto,
                el real incluido, sin sembrar nada: la contraseña la teclea la persona)
                (proyectos-de-prueba.cjs: la lista FIJA de proyectos descartables)
vitest.nube.config.ts  la configuración APARTE de las verificaciones con red
                (`*.nube.ts`): verify:restauracion. `npm test` no las ve
supabase/       espejo del esquema en Postgres (migraciones para la nube)
  migrations/0023_…  las funciones de sincronización; aplicada SOLO en el proyecto de pruebas
  esquema-nube.json  la FOTO del catálogo de la nube que coteja la prueba de deriva
docs/           arquitectura, guía de desarrollo, núcleo vs. negocio, integraciones
  SINCRONIZACION.md  diseño de la sincronización. APROBADO; fases 1.a, 1.b, 2.a y 2.b construidas
  ANULACION-DE-VENTA.md  diseño de la anulación de una venta. APROBADO; núcleo local construido (§4.45)
```

## 10. Antes de cerrar cualquier sesión de trabajo

1. `npm run verify` debe pasar (lint + tipos + pruebas).
2. Agregar las decisiones nuevas a la tabla de la sección 5.
3. Actualizar la sección 6 si se confirmó o se abrió algún punto.
4. Commits atómicos en `develop`, prefijo en inglés, descripción en español.
5. **Nunca** hacer commit directo a `main`.

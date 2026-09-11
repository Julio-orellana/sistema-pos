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
| Migraciones aplicadas | `20260905143642_esquema_inicial`<br>`20260905171724_fijar_search_path_auditoria_log_es_inmutable`<br>`20260907002143_denominaciones_y_desglose`<br>`20260907002154_pin_remoto`<br>`20260907002212_autorizacion_de_diferencia`<br>`20260907002231_autorizacion_solo_con_diferencia`<br>`20260908121557_categorias_activo`<br>`20260910040514_una_caja_por_sistema`<br>`20260910040526_caja_cerrada_por`<br>`20260911113517_boleta_solo_con_tarjeta`<br>`20260911113531_cantidad_vendida`<br>`20260911145855_configuracion_negocio` |
| Aplicadas el | 2026-09-05 (las dos primeras), 2026-09-06 (las cuatro del corte de caja), 2026-09-08 (`categorias.activo`), 2026-09-09 (las dos de la caja única) y 2026-09-11 (las dos del módulo de venta y la de `configuracion_negocio`) |
| Plan | gratuito |

Estado verificado contra el catálogo del proyecto, no contra el script, el
2026-09-11: **13 tablas**, RLS activo en las 13 sin políticas (deniega todo),
26 índices propios, 15 llaves foráneas y el trigger
`auditoria_log_prohibir_cambios`. La número 13 es `configuracion_negocio`, que
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

**NO QUEDA NINGUNA MIGRACIÓN PENDIENTE DE APLICAR EN LA NUBE.**

La última fue `0016_configuracion_negocio`, el 2026-09-11, por la vía de
siempre: SQL completo a la vista, aprobación explícita de Julio y evidencia
consultada después contra el catálogo del proyecto.

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
y 006, 011 y 013 (que solo amplían el CHECK de superficies de esa misma tabla)
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

Pendiente en la nube, para el prompt del módulo de sincronización:

- Crear las **políticas de RLS**. Hoy no hay ninguna, así que la llave anónima
  no puede leer ni escribir nada. La sincronización usará una llave de
  servicio, que ignora RLS por diseño. Mientras tanto, los 12 avisos
  `rls_enabled_no_policy` de nivel INFO son el resultado buscado, no un
  problema.

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
Sincronizar el candado sería dañino con más de una terminal: el bloqueo de una
caja dejaría bloqueada la otra, que es la negación de servicio que esta
separación vino a eliminar.

**Al agregar una superficie nueva** (por ejemplo, la autorización de descuentos
de la decisión 6) hay que ampliar el `CHECK` de `bloqueos_de_autorizacion` con
una migración nueva. Es deliberado: así el conjunto de superficies protegidas
queda siempre a la vista y auditable.

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

**La salida controlada NO acepta el PIN remoto**, solo el cierre con
diferencia. La razón no es que cerrar la aplicación sea una acción física: es
que el PIN remoto se pidió para UNA sola cosa, autorizar diferencias de caja
por teléfono. Dárselo además a la salida controlada sería ampliarle el alcance
más allá de lo que se pidió, y un permiso creado para un caso que termina
sirviendo para varios deja de ser un permiso acotado. Cada superficie nueva que
lo acepte tiene que pedirse y decidirse aparte. Es un parámetro por llamada
(`aceptaPinRemoto`), así que ampliarlo más adelante es cambiar un argumento —
pero es una decisión, no un descuido que haya que corregir.

#### Autorización del cierre descuadrado

Si `diferencia == 0`, cierra directo. Si no, **no cierra**: primero calcula y
**muestra el monto exacto** —y si es faltante o sobrante— y recién después pide
el código. Quien autoriza, esté presente o al teléfono, tiene que ver qué está
aprobando.

El candado de intentos usa `superficie = 'cierre_con_diferencia'`, **separado**
del de `'salida_controlada'` y del de ingreso. Un error de tecleo al autorizar
un descuadre no bloquea el login de nadie ni la salida de la aplicación. Ver la
sección 4.8.

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
| **Las ventas anuladas** | Hoy nada las produce —anular una venta registrada todavía no existe—, pero el filtro va desde ahora para que el día que exista no haya que acordarse de agregarlo. |
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
- No se redimensiona ni se comprime. Si hace falta, es una mejora futura.
- La ventana ve las fotos por el esquema propio `pos-foto:`, servido por el
  proceso principal, y **no** por `file:`, que le daría acceso a cualquier ruta
  del disco. Antes de abrir el archivo se comprueba que la ruta caiga dentro de
  la carpeta de fotos.
- **Subirlas a Supabase Storage es trabajo del módulo de sincronización.** Hoy
  la imagen vive solo en el disco de la tienda.

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

#### La autorización del descuento: superficie propia, sin PIN remoto

Superficie `descuento_excedente` (migración 013, no espejada), con su propio
candado de intentos. **No acepta el PIN remoto**, por la misma razón de alcance
de siempre: ese PIN se pidió para autorizar diferencias de caja por teléfono y
nada más. Dárselo además al descuento sería ampliarle el alcance más allá de lo
pedido, y un permiso creado para un caso que termina sirviendo para varios deja
de ser un permiso acotado. Y acá el argumento es más fuerte que en la salida
controlada: **un descuento es dinero que sale de la venta**, y autorizarlo a
distancia sin ver el ticket es aprobar a ciegas.

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

Es estado operativo de una máquina —dos cajas podrían tener la térmica en
puertos distintos— y esa tabla se espeja en la nube. Es el mismo criterio que ya
se aplicó a `bloqueos_de_autorizacion` (§4.4). **Sin archivo no hay impresora, y
eso NO es un error**: es el estado normal hoy. No hay pantalla para configurarlo
porque configurar una impresora que nadie vio sería adivinar qué opciones
ofrecerle a Jimmy.

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
| **PIN de autorización remota separado del PIN normal**, en la columna `pin_remoto_hash`. | Un solo PIN para todo; una contraseña aparte más larga | El PIN normal abre la sesión del administrador. Dictarlo por teléfono se lo entrega a quien escucha, para siempre y para todo. Con uno separado, lo que se cede al dictarlo es solo la capacidad de autorizar a distancia: no sirve para entrar, y la auditoría distingue `remoto` de `presencial`. El sistema deduce cuál se usó según cuál hash coincidió, sin preguntarle al cajero. Se rechaza configurarlo igual al PIN normal, porque eso anularía toda la separación. **Solo vale en el cierre con diferencia, no en la salida controlada**, y la razón es de alcance, no física: el PIN remoto se pidió para autorizar diferencias de caja y nada más, así que dárselo a otra acción sería ampliarlo más allá de lo pedido. Cada superficie nueva se decide aparte. | Prompt 13 — 2026-09-06; alcance corregido en Prompt 14 — 2026-09-06 |
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
| **CORREGIDO: un rechazo en la pantalla de topes vuelve al paso de edición, no se queda en la confirmación.** | Quedarse en la confirmación mostrando el error ahí | Lo encontró `npm run verify:pantallas` manejando la aplicación real, no una prueba de Vitest. Quedándose en la confirmación, los campos seguían visibles y editables pero **el botón «Guardar» no existe en ese estado** —ahí el botón dice «Sí, guardar este tope»—, así que quien corrigiera el número se quedaba mirando una confirmación que seguía repitiendo el valor rechazado. Volver a la edición deja el aviso junto al botón que lo produjo, que es la regla de §4.11, y pone el foco donde está el problema. Es la tercera vez que esta comprobación atrapa un defecto que ninguna prueba de Vitest podía ver. | Prompt 25 — 2026-09-11 |
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
| **`descuento_excedente` es una superficie de candado propia y NO acepta el PIN remoto** (migración 013, no espejada). | Reusar `cierre_con_diferencia`; aceptar el PIN remoto para poder autorizar por teléfono | La razón es de alcance, la misma de siempre: el PIN remoto se pidió para autorizar diferencias de caja por teléfono y nada más, y dárselo a otra acción sería ampliarlo más allá de lo pedido. Acá el argumento es incluso más fuerte que en la salida controlada: **un descuento es dinero que sale de la venta**, y autorizarlo a distancia sin ver el ticket es aprobar a ciegas; quien autoriza tiene que estar mirando la pantalla donde se le muestra el tope, el pedido y el exceso. No se reusa la superficie de la diferencia porque son candados independientes por diseño (§4.8) y fallar al autorizar un descuento no debe bloquear un corte de caja. | Prompt 19 — 2026-09-10 |
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
| 9 | **Modelo y marca de la impresora térmica. LLEGA EL JUEVES.** | El adaptador ESC/POS **ya está implementado**, pero **contra el estándar más común y sin probar contra hardware real**: solo comandos del núcleo, codificación CP850, sin código de barras ni imagen. **Hay que confirmar compatibilidad exacta con el modelo real el día que llegue.** Ver §4.14. Falta además decidir cómo se configura el puerto en la máquina de la tienda: hoy es un archivo `impresora.json` puesto a mano, y con el modelo a la vista se decide si hace falta una pantalla. | Abierto — **es lo próximo que hace falta del cliente**, junto con el catálogo |
| 10 | ¿Habrá más de una caja o sucursal sincronizando contra la misma nube? | Define si la sincronización necesita resolución de conflictos o solo respaldo. **Y define algo de seguridad:** con más de una caja, el bloqueo por intentos de un usuario necesita fuente de verdad centralizada o sincronización en tiempo real, o el presupuesto para adivinar un PIN se multiplica por el número de terminales. Ver la sección 4.4. | Abierto |
| 13 | **El catálogo real de Jimmy.** Nombres, categorías, precios, unidades e inventario inicial de verdad. Iba a entregarlo al día siguiente del Prompt 15. | Mientras no llegue, la tienda corre con el catálogo de ejemplo (`npm run seed:ejemplo`), que está marcado con el prefijo `[Ejemplo] ` justamente para que nadie lo confunda con el real. El día que llegue: `npm run seed:limpiar` y cargar el verdadero. | Abierto — **es lo próximo que hace falta del cliente** |
| 14 | ~~¿Qué debe ordenar los íconos de la pantalla de venta: `contador_ventas` o `cantidad_vendida`?~~ | — | **RESUELTO (Prompt 20): ordena `contador_ventas`, y no se cambia nada.** Julio lo decidió sin necesidad de consultarlo con Jimmy: contar VECES es la única medida comparable entre productos, porque las libras de maíz y las unidades de huevo no se suman en un mismo número. `cantidad_vendida` existe para **reportes futuros**, no para el orden de los íconos. |
| 15 | **¿Qué topes de descuento quiere Jimmy?** La mitad de «quién los configura desde dónde» ya está resuelta. | **YA HAY PANTALLA** (§4.16, Prompt 25): un administrador los cambia desde la aplicación, queda su nombre en `editado_por` y su asiento en `auditoria_log`. `npm run seed:limites` sigue existiendo para montar entornos de desarrollo, pero **ya no es la única puerta**. Lo que sigue abierto es el NÚMERO: los 10 % / Q20 del rol `venta` y los 100 % / Q1 000 del `administrativo` son valores de prueba y **no** una definición del negocio. Falta que Jimmy diga los topes reales. El del rol administrativo además **asume que ese rol lo tiene el dueño**, y hay que revisarlo si se le asigna a un empleado: ver la salvedad de §4.13 y el punto 6 de esta misma lista. | Abierto — falta el número, ya no la pantalla |
| 17 | **¿Un tope de descuento en porcentaje mayor que 100 debería rechazarse?** | Hoy **se acepta y la pantalla avisa sin bloquear** (§4.16). No es peligroso —`totalConDescuento` tiene piso en cero, así que 150 % no autoriza nada que 100 % no autorice ya— pero es un valor inútil y un tecleo plausible: confundir el campo del porcentaje con el de quetzales. Rechazarlo sería inventar una regla que Jimmy no confirmó, así que se avisa y se deja pasar. Si él prefiere que el sistema lo impida, es un cambio de tres líneas en `ServicioDeLimitesDeDescuento.leerNumero`. | Abierto — de bajo riesgo, se decide cuando haya ocasión |
| 18 | **¿Qué umbral de «stock bajo» tiene cada producto, y quién lo define?** | El reporte de inventario muestra la fotografía de hoy y **no tiene umbral ni alertas, a propósito** (§4.15): cuál es el mínimo de cada producto es una definición de negocio, y un umbral inventado convertiría una suposición nuestra en un aviso que parece una regla de la tienda. Hace falta saber si el mínimo es por producto, por categoría o uno solo para todo, y si depende de la temporada. Es un módulo futuro con su propio prompt. | Abierto — bloquea las alertas de stock, no el reporte |
| 16 | ~~¿Qué número de venta quiere ver el cajero en la confirmación?~~ | — | **RESUELTO (Prompt 23): el correlativo de `recibos.numero_recibo`.** La confirmación del cobro muestra «Recibo No. N», que es el mismo número que sale impreso en el papel y el que ordena el historial. El id de la venta sigue a la vista como referencia fina para rastrear en la base. |
| 11 | ¿Cada cuánto y hacia dónde se respalda la base de datos local? | El archivo SQLite contiene todas las ventas; hoy no hay política de respaldo. | Abierto |
| 12 | **Falta la verificación completa en una máquina Windows real** con teclado latinoamericano: el atajo `Ctrl+Shift+Alt+Q`, la intercepción de `Alt+F4`, que el Administrador de tareas (`Ctrl+Shift+Esc`) y `Ctrl+Alt+Supr` sigan funcionando, la ventana a pantalla completa sin marco, y más adelante impresión y touch. | Windows es la plataforma de producción y el criterio de aceptación final (ver el principio de la sección 4). Todo lo anterior está verificado en macOS y cubierto por pruebas que simulan la entrada de Windows, pero **eso no cuenta como verificado**. | Abierto — **es la prioridad de verificación del proyecto** en cuanto haya una máquina Windows |

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
- **No existe todavía**: **anular una venta ya registrada**. `RepositorioDeVentas.anular`
  existe como operación de datos y los reportes ya filtran por
  `estado = 'completada'` para el día que exista, pero no hay servicio, canal ni
  pantalla que la use, ni reglas de autorización, ni devolución de inventario.
- **No existen las alertas de stock mínimo, los gráficos ni la exportación de
  reportes a un archivo.** El umbral de cada producto es una definición de
  negocio que falta: punto 18 de la sección 6.2.
- Tampoco hay **mermas ni ajustes de inventario a la baja**: el ajuste que
  existe solo suma mercadería recibida, y las bajas son un módulo futuro con sus
  propias reglas de autorización.
- No hay log de auditoría: los puntos donde debería escribirse ya están
  marcados con `TODO(auditoria)` en el controlador de salida.
- **Sí existe** el adaptador real de impresión (`EscPosPrinterProvider`), con su
  implementación segura por defecto intacta: sin `impresora.json` configurado se
  usa `NullPrinterProvider` y el recibo queda solo en PDF. No hay adaptador real
  de Supabase: ahí sigue solo el contrato y la implementación simulada.

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
```

Archivos que la aplicación usa en `<userData>` y que conviene conocer:

| Archivo o carpeta | Qué es |
|---|---|
| `pos-agricola.db` | La base de datos de la tienda. |
| `recibos/` | Los PDF de los comprobantes emitidos. |
| `fotos-de-productos/` | Las fotos del catálogo. |
| `impresora.json` | Dónde está la térmica. **Si no existe, no hay impresión** y el recibo queda solo en PDF, que es el estado normal hoy. |
| `log-tecnico.log` | Bitácora TÉCNICA: fallos de impresión y de PDF. No es `auditoria_log`. |

Los cuatro `seed:` arrancan el proceso principal sin abrir ventana, trabajan
contra la MISMA base que usa la aplicación e imprimen qué hicieron. Se activan
con un argumento de línea de comandos y no con una variable de entorno, para
que también funcionen en el `cmd` de Windows.

## 9. Mapa del repositorio

```
src/main/       proceso principal de Electron: ventana, SQLite, IPC
  database/          conexión a SQLite (nadie más la abre)
    migrations/      migraciones .sql numeradas del esquema local
    repositories/    una clase por tabla; la única puerta hacia los datos
    decimal-columns.ts  única vía para leer/escribir dinero, peso y cantidad
    migrator.ts      aplica las migraciones y verifica sus checksums
  ipc/          manejadores IPC, con validación Zod de cada payload
    respuesta.ts   envoltorio único de respuesta; todo manejador pasa por aquí
  preload/      único puente hacia el renderer (expone window.pos)
  domain/       módulos de dominio
    usuarios/   autenticación, bloqueo por intentos, sesión, permisos y gestión de usuarios
    caja/       apertura y cierre del turno, arqueo por denominaciones
    catalogo/   categorías, productos, ajuste de inventario, fotos y datos de ejemplo
    venta/      precio efectivo, descuento, topes por rol y la transacción de la venta
    reportes/   los tres reportes y el período en hora de Guatemala. NUNCA agrega en SQL
    negocio/    los datos de la tienda que encabezan el recibo
    recibo/     modelo, plantilla, ESC/POS y emisión del comprobante
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

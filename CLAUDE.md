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
| Migraciones aplicadas | `20260905143642_esquema_inicial`<br>`20260905171724_fijar_search_path_auditoria_log_es_inmutable`<br>`20260907002143_denominaciones_y_desglose`<br>`20260907002154_pin_remoto`<br>`20260907002212_autorizacion_de_diferencia`<br>`20260907002231_autorizacion_solo_con_diferencia`<br>`20260908121557_categorias_activo`<br>`20260910040514_una_caja_por_sistema`<br>`20260910040526_caja_cerrada_por` |
| Aplicadas el | 2026-09-05 (las dos primeras), 2026-09-06 (las cuatro del corte de caja), 2026-09-08 (`categorias.activo`) y 2026-09-09 (las dos de la caja única) |
| Plan | gratuito |

Estado verificado contra el proyecto, no contra el script: **12 tablas**, RLS
activo en las 12 sin políticas (deniega todo), 24 índices propios, 14 llaves
foráneas, 44 restricciones CHECK y el trigger `auditoria_log_prohibir_cambios`.
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

**No hay ninguna migración pendiente de aplicar en la nube.** Las dos últimas
fueron `0010_una_caja_por_sistema` y `0012_caja_cerrada_por`, el 2026-09-09:
`idx_caja_sesiones_una_abierta` pasó a `(estado) WHERE estado = 'abierta'` y
`cerrada_por` quedó como `uuid` nulable con `ON DELETE SET NULL` hacia
`usuarios`, verificado contra `pg_indexes`, `information_schema` y
`pg_constraint`.

Las migraciones locales 002 (bloqueo por intentos), 003 (candado por superficie)
y 006 y 011 (que solo amplían el CHECK de superficies de esa misma tabla) **no
tienen espejo a propósito**: son estado operativo de una terminal, no datos de negocio.
Ver `supabase/migrations/README.md` y la fila correspondiente del registro de
decisiones.

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

### 4.10 PENDIENTE: `monto_esperado` todavía no suma ventas

`ServicioDeCaja.montoEsperadoDe` devuelve **el monto inicial**, que equivale a
asumir cero ventas en efectivo. Es correcto solo mientras no exista el módulo
de ventas.

> **EN CUANTO EXISTA EL MÓDULO DE VENTAS, ESTO DEBE PASAR A SER:**
> `monto_inicial + suma de las ventas en efectivo de esta sesión`.

No se inventó una lógica de ventas parcial para rellenarlo: quedaría enterrada
y nadie la encontraría después. Hay un `TODO(ventas)` en el método y una prueba
que documenta el comportamiento actual, para que cambiarlo obligue a tocar
ambos.

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
| **`monto_esperado` es hoy el monto inicial, con un TODO explícito.** | Inventar una suma de ventas parcial para que "quede completo" | Todavía no existe el módulo de ventas. Una lógica de ventas a medias, escrita para rellenar un hueco, quedaría enterrada y nadie la encontraría al construir el módulo real. Queda marcado en el código y en la sección 4.10, y hay una prueba que documenta el comportamiento actual para que cambiarlo obligue a tocar ambos. | Prompt 13 — 2026-09-06 |
| **El ajuste de inventario es una ACCIÓN PROPIA, no un campo de «editar producto».** Canal IPC propio, botón propio y nombre de acción propio en la auditoría (`inventario_ajustado`). El tipo `CambiosDeProducto` ni siquiera incluye el saldo. | Un campo más en el formulario de edición; un campo editable en la lista | Recibir mercadería y corregir el catálogo son **hechos distintos del negocio**. Si compartieran operación, cambiar el inventario quedaría registrado como «producto editado» y no se podría auditar cuánta mercadería entró sin abrir y leer el contenido de cada asiento; peor, se podría mover el saldo «de paso» al corregir un precio, sin que quedara constancia de que entró nada. Separadas, el asiento guarda saldo anterior, saldo nuevo, cantidad agregada y motivo. La operación **solo suma**: las mermas y pérdidas son un módulo futuro con sus propias reglas de autorización, y dejar que esta aceptara negativos convertiría la recepción de mercadería en una vía para bajar inventario sin controles. | Prompt 15 — 2026-09-07 |
| **NO se restringe cambiar `tipo_medida` después de creado un producto.** | Bloquear el cambio y obligar a crear un producto nuevo; permitirlo solo si el producto nunca se vendió | El motivo por el que se bloquearía —«corrompe las ventas pasadas»— **no aplica en este esquema**: `venta_detalle` guarda una foto del nombre, la unidad y el precio al momento de cada venta, así que un cambio de hoy no altera un solo comprobante de ayer. Sin ese riesgo, prohibirlo solo tendría costos: un error de carga —marcar «por unidad» algo que se vende por libra— obligaría a crear un producto nuevo y a arrastrar un duplicado inútil en el catálogo para siempre. La coherencia entre `tipo_medida` y `unidad_peso` sí se sigue exigiendo en cada cambio, en las tres capas. | Prompt 15 — 2026-09-07 |
| **`categorias` recibe `activo`; ninguna categoría ni producto se borra jamás.** | Borrar la categoría cuando ya no se usa; dejar `categorias` sin baja lógica | Sin `activo` no había forma de retirar una categoría de las opciones sin borrarla, y borrarla es imposible en cuanto tenga un producto: `productos.categoria_id` la referencia con ON DELETE RESTRICT. Desactivar resuelve el caso real sin tocar nada más. Se acota a propósito qué significa: **solo** deja de ofrecerse al crear o editar un producto; no desactiva sus productos, no los mueve y no los saca de la venta, porque eso retiraría mercadería del mostrador sin que nadie lo pidiera. | Prompt 15 — 2026-09-07 |
| **La foto de producto se valida por su FIRMA BINARIA, no solo por la extensión**, y se copia a `userData` con nombre UUID; en la base va la ruta relativa. | Confiar en la extensión y en el filtro del diálogo nativo; guardar la ruta absoluta; conservar el nombre original | Renombrar un archivo es gratis: un ejecutable llamado `foto.png` pasa cualquier comprobación de extensión, y el filtro del diálogo nativo se puede esquivar escribiendo el nombre a mano. Los primeros bytes sí dicen qué es el archivo de verdad. La ruta absoluta rompería un respaldo restaurado en otra computadora, y conservar el nombre original haría que dos fotos llamadas `foto.jpg` se pisaran entre productos. La ventana las ve por el esquema propio `pos-foto:` y no por `file:`, que le daría acceso a todo el disco. | Prompt 15 — 2026-09-07 |
| **Los datos de ejemplo NO pasan por el sistema de migraciones**, se marcan con el prefijo `[Ejemplo] ` en el nombre y su limpieza SÍ borra físicamente. | Sembrarlos en una migración; marcarlos con una columna `es_de_ejemplo`; darlos de baja lógica al limpiar | Una migración es historial permanente: se aplica una vez y no se deshace, así que un catálogo inventado quedaría en la base de la tienda para siempre y quitarlo exigiría otra migración. Una columna sería esquema permanente para un problema temporal —habría que espejarla en Postgres y quitarla después—, mientras que el prefijo **se ve** en pantalla y avisa solo. Y la baja lógica no serviría: el nombre seguiría ocupado por el UNIQUE y el «Maíz blanco» real de Jimmy chocaría con el de mentira. Es la única excepción a «nunca borrar», y se sostiene porque estos registros no tienen historial que proteger; si alguno llegara a tener ventas, no se borra nada. | Prompt 15 — 2026-09-07 |
| **Un `ErrorDeNegocio` cruza el puente IPC con SU código y SU mensaje**, no envuelto en un genérico. | Devolver siempre «La operación no pudo completarse» y dejar el detalle en la bitácora | Los mensajes de negocio están escritos para que los lea una persona frente a la pantalla —«El precio no puede ser negativo»— y esconderlos detrás de un genérico deja a quien carga el catálogo sin saber qué corregir. Era además lo que §4.7 ya decía que pasaba («el mensaje llega a la interfaz ya traducido») y no era cierto. Cualquier otro error sí se generaliza: un fallo inesperado no debe filtrar detalles internos a la ventana. El envoltorio vive en un solo lugar, `src/main/ipc/respuesta.ts`, para que ningún módulo tenga su propia variante. | Prompt 15 — 2026-09-07 |
| **`playwright-core` como devDependency, en modo Electron, para `npm run verify:pantallas`.** | No verificar la interfaz automáticamente y confiar en pruebas manuales; usar el paquete `playwright` completo; escribir un arnés propio sobre el protocolo de depuración de Chrome | Hay defectos que ninguna prueba de Vitest puede ver: si el mensaje correcto LLEGA a la ventana y si quedó dentro de la parte visible. Los dos que se encontraron eran de esa clase y aparecieron a mano. Se eligió `playwright-core` y no `playwright` porque el primero **no tiene guiones de instalación ni dependencias** y por lo tanto no descarga navegadores —medido: tras instalarlo y usarlo no existe ninguna carpeta `ms-playwright`—, y su modo `_electron` maneja el binario de Electron que el proyecto ya tiene. **No viaja en el instalador de Jimmy**, comprobado empaquetando: `electron-builder` reescribe el `package.json` que va dentro del asar dejando solo `dependencies`, y una búsqueda de «playwright» en los 935 archivos del paquete y en todo el `.app` no devuelve nada. | Prompt 16 — 2026-09-08 |
| **Los mensajes al usuario no inventan razones de negocio.** «El precio no puede ser negativo», no «…Se permite 0, para muestras y regalos». | Explicar en el mensaje para qué sirve cada regla | Que un precio 0 se acepte es una decisión técnica del esquema; PARA QUÉ le sirve a la tienda es una definición de negocio que Jimmy no confirmó. Un mensaje que se la atribuya convierte una suposición nuestra en algo que parece decidido por él, y eso es exactamente lo que este proyecto no puede hacer: el resto de la documentación distingue con cuidado lo confirmado de lo supuesto. La regla vale para todo texto que vea una persona. | Prompt 16 — 2026-09-08 |
| **CORREGIDO: la caja es UNA EN TODO EL SISTEMA, no una por usuario.** El índice único parcial pasa de `(usuario_id) WHERE estado='abierta'` a `(estado) WHERE estado='abierta'` (migración 010 y su espejo 0010). | Dejar la restricción por usuario; no restringir y confiar en que nadie abra dos; restringir por terminal | El alcance original estaba mal, no corto: permitía que **dos personas distintas abrieran cada una su turno sobre el mismo cajón físico de dinero**, y con dos turnos simultáneos ninguno de los dos cortes significa nada, porque lo que entra por uno sale contado en el otro. Jimmy tiene una sola caja y una sola pantalla. Se indexa la propia columna `estado` porque dentro de la condición su valor es siempre el mismo, así que la unicidad sobre ella permite una sola fila. El mensaje de `CAJA_YA_ABIERTA` deja de decir «ya tenés» y pasa a «ya hay»: la caja abierta puede ser de cualquiera, y atribuírsela a quien intenta abrir lo manda a buscar un turno propio que no existe. | Prompt 17 — 2026-09-08 |
| **Cerrar una caja que abrió otra persona exige el PIN normal de un administrador, SIN excepción por rol.** Superficie de candado propia, `cierre_de_caja_ajena` (migración 011, no espejada). | Dejar cerrar a cualquiera; permitírselo libre a quien tenga rol administrativo; reusar la superficie `cierre_con_diferencia` | Si la caja es una sola, al turno de la tarde le toca cerrar el de la mañana, y ese cierre mueve dinero que el que cierra no contó al abrir. Se exige autorización **siempre** que quien cierra no sea quien abrió, incluso si quien cierra es administrador: la excepción «salvo que sea administrador» es la misma clase de caso especial que ya costó una vuelta con la intercepción de `Cmd+Q`, parece inofensiva y abre el hueco; además, con ella el cierre ajeno de un administrador no quedaría registrado como tal. No se reusa la superficie de la diferencia porque un mismo cierre puede necesitar las dos autorizaciones y compartir candado haría que fallar una bloqueara la otra; y porque el PIN remoto vale para la diferencia y **no** para esto. | Prompt 17 — 2026-09-08 |
| **`caja_sesiones.cerrada_por` guarda a QUIEN CERRÓ, no a quien autorizó, y va NULL cuando cerró quien abrió** (migración 012 y su espejo 0012). | Guardar al administrador que autorizó; repetir siempre el `usuario_id` de quien cerró; no guardar nada y deducirlo de la auditoría | Son tres personas posibles y distintas: quien abrió, quien cerró y quien autorizó. Guardar al autorizante haría que el corte pareciera hecho por un administrador que quizá ni estaba en la tienda. Dejarlo NULL cuando coincide con quien abrió hace que `WHERE cerrada_por IS NOT NULL` sean exactamente los cierres que necesitaron autorización, sin comparar dos columnas. Quién autorizó sí queda, en el asiento de auditoría del cierre, junto con los otros dos. | Prompt 17 — 2026-09-08 |
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
| 2 | ¿La tienda emite factura fiscal (FEL/SAT) o solo recibo y proforma internos? | Cambia por completo el módulo de comprobantes y las obligaciones legales. | Abierto |
| 3 | ¿El precio de mayoreo se activa por cantidad comprada, por tipo de cliente, o ambos? | Define el modelo de precios del catálogo. | Abierto |
| 4 | ¿Hay ventas al crédito / cuentas por cobrar? | Agregaría un módulo completo de clientes y saldos. | Abierto |
| 5 | ~~¿El PIN de autorización es por usuario administrador o uno solo para la tienda?~~ | — | **RESUELTO (Prompt 10): por usuario.** Cada usuario tiene su PIN con hash scrypt y sal propia; la auditoría registra el `usuario_id` real de quien autorizó. `POS_PIN_ADMINISTRADOR` ya no existe. Ver la sección 4.7. |
| 6 | ¿Qué roles exactos existen además de "venta" y "administrativo"? | Define la matriz de permisos (RBAC). | Abierto |
| 7 | ¿Qué se hace con la merma (diferencia entre lo que entró al inventario y la suma de lo vendido)? ¿Se ajusta el saldo a mano y queda en auditoría? ¿Hace falta autorización de administrador para bajar inventario, como la hay para un descuadre de caja? | Sin regla, el inventario nunca cuadrará contra la realidad física del bodegón. **Ya hay un hueco concreto esperándola:** `ServicioDeProductos.ajustarInventario` solo SUMA y rechaza cualquier cantidad no positiva, a propósito, para no convertir la recepción de mercadería en una vía de bajar inventario sin controles. El módulo de mermas tiene que traer su propia regla de autorización. | Abierto |
| 8 | ~~¿El sistema debe impedir una venta que deje el inventario en negativo, o solo advertir?~~ | — | **RESUELTO (Prompt 6): la impide.** `inventario_disponible` tiene piso 0 en la base. Ver secciones 4.2 y 4.3. |
| 9 | Modelo y marca de la impresora térmica. | Necesario para escribir el adaptador ESC/POS real. | Abierto |
| 10 | ¿Habrá más de una caja o sucursal sincronizando contra la misma nube? | Define si la sincronización necesita resolución de conflictos o solo respaldo. **Y define algo de seguridad:** con más de una caja, el bloqueo por intentos de un usuario necesita fuente de verdad centralizada o sincronización en tiempo real, o el presupuesto para adivinar un PIN se multiplica por el número de terminales. Ver la sección 4.4. | Abierto |
| 13 | **El catálogo real de Jimmy.** Nombres, categorías, precios, unidades e inventario inicial de verdad. Iba a entregarlo al día siguiente del Prompt 15. | Mientras no llegue, la tienda corre con el catálogo de ejemplo (`npm run seed:ejemplo`), que está marcado con el prefijo `[Ejemplo] ` justamente para que nadie lo confunda con el real. El día que llegue: `npm run seed:limpiar` y cargar el verdadero. | Abierto — **es lo próximo que hace falta del cliente** |
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
- **Sí existe** el módulo de usuarios: autenticación con PIN, bloqueo por
  intentos, sesión en memoria, guard de permisos, primer arranque y pantalla de
  ingreso. Ver la sección 4.7.
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
- No existe la pantalla de ventas, ni el cálculo real de `monto_esperado` (ver
  la sección 4.10).
- No hay lógica de ventas ni de descuentos. Tampoco hay **mermas ni ajustes de
  inventario a la baja**: el ajuste que existe solo suma mercadería recibida, y
  las bajas son un módulo futuro con sus propias reglas de autorización.
- `productos.contador_ventas` existe y se lee, pero **nada lo incrementa
  todavía**: lo hará la venta, dentro de su misma transacción.
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
npm run seed:ejemplo     # siembra el catálogo de ejemplo (NO es una migración)
npm run seed:limpiar     # quita el catálogo de ejemplo, sin tocar datos reales
npm run verify:pantallas # maneja la app real y comprueba qué se ve en pantalla
```

Los dos últimos arrancan el proceso principal sin abrir ventana, trabajan
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
    usuarios/   autenticación, bloqueo por intentos, sesión y permisos
    caja/       apertura y cierre del turno, arqueo por denominaciones
    catalogo/   categorías, productos, ajuste de inventario, fotos y datos de ejemplo
  windows/      creación y bloqueos de la ventana kiosko
src/renderer/   interfaz React (sin acceso a Node, a SQLite ni a la red)
src/shared/     código compartido main <-> renderer
  adapters/     interfaces de integración + implementaciones seguras
  types/        contrato IPC y DTOs con Zod
  auth.ts       hash y verificación del PIN con scrypt (NO va al renderer)
  pin.ts        reglas de formato del PIN (sí va al renderer)
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

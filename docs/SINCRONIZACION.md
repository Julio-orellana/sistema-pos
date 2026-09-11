# Sincronización con la nube — documento de diseño

> **ESTADO: DISEÑO, PENDIENTE DE REVISIÓN. NO HAY NADA IMPLEMENTADO.**
> Este documento existe para que Julio lo revise antes de autorizar una sola
> línea de código. Ninguna sección de abajo describe algo que ya funcione;
> describe lo que se propone construir y por qué. Cuando algo no tiene una
> respuesta sólida, lo dice, en la sección 8.

## 0. Qué se leyó para escribir esto, y qué se encontró de entrada

Este diseño no sale de memoria. Sale de leer CLAUDE.md completo, el esquema
local de SQLite tal como queda tras las 17 migraciones, el catálogo real de
`pos-jimmy-cano` consultado hoy, el README de `supabase/migrations`, la
interfaz `SyncProvider` que ya existe en `src/shared/adapters`, y la
documentación de Supabase sobre Auth, RLS, Storage y pausado de proyectos,
leída hoy y no recordada. Los límites del plan gratuito se leyeron de la
página de precios. Un PDF de recibo se generó con la aplicación real para
medirlo.

### Las cinco inconsistencias que aparecieron antes de diseñar nada

Se señalan, no se resuelven: decidir cuál versión es la correcta es tuyo.

| # | Qué dice la documentación | Qué existe de verdad | Consecuencia para este diseño |
|---|---|---|---|
| 1 | «La nube lleva datos de negocio; el estado operativo de una terminal se queda en SQLite» (README de migraciones, CLAUDE.md §4.4). | **`ventas.estado_sincronizacion` EXISTE en Postgres**, con su CHECK, desde la 0001. Es estado operativo de la terminal, exactamente lo que la regla dice que no se espeja. | En la nube esa columna va a decir siempre lo que la terminal mande o su `DEFAULT 'pendiente'`, que allá no significa nada. Es el mismo error que el README describe para `intentos_fallidos`: «columnas siempre en cero engañan al auditor». Este diseño **no la manda** en el payload. Hace falta decidir si se quita de Postgres con una migración. |
| 2 | La infraestructura de sincronización «ya existe»: `sync_cola` y `ventas.estado_sincronizacion`. | **Nadie escribe en `sync_cola` fuera de las pruebas.** La transacción de venta no encola nada. `estado_sincronizacion` se pone en `'pendiente'` al insertar y ninguna otra línea del proyecto la lee ni la cambia. | Es andamiaje sin conectar. Sirve como punto de partida, pero `sync_cola` necesita columnas que no tiene (sección 2.4). |
| 3 | El README de `supabase/migrations` lista en su tabla de «qué se espeja» **10 tablas**. | Postgres tiene **13**: faltan en esa tabla `denominaciones`, `caja_sesion_denominaciones` y `configuracion_negocio`, que sí están espejadas. | La lista definitiva de este documento (sección 2.1) sale del catálogo real, no del README. |
| 4 | El README dice que la `0016` está **pendiente**. | Se aplicó el 2026-09-11, igual que la `0017`, que el README no menciona. | Documentación desactualizada. Se corrige aparte; no afecta el diseño. |
| 5 | La interfaz `SyncProvider` tiene `traerCambios(desde)`: un método de **bajada** incremental. | La sincronización continua de este diseño es **solo subida** (sección 2.2). Bajar cambios sería tener dos escritores, que es el problema que el prompt excluye. | Ese método no lo usa la sincronización continua. O se retira de la interfaz, o queda reservado para la restauración con otro nombre. |

Y un hallazgo que no es inconsistencia pero condiciona todo lo demás:
**cuatro tablas no tienen `actualizado_en`** —`venta_detalle`, `recibos`,
`auditoria_log`, `caja_sesion_denominaciones`— porque son de solo inserción.
Es una buena noticia: lo que nunca cambia se sincroniza con la forma más
simple y más segura de upsert (sección 3.1).

---

## 1. Credencial y seguridad de acceso

### 1.1 La recomendación de partida, validada con reservas

La recomendación era: Supabase Auth con una identidad propia del dispositivo,
nunca la llave `service_role`, y políticas RLS que exijan
`auth.role() = 'authenticated'`. **La primera mitad es correcta y es lo que se
propone. La segunda mitad no alcanza, y conviene decir por qué antes de
adoptarla.**

`auth.role() = 'authenticated'` significa «cualquiera que haya iniciado sesión
en Supabase Auth en este proyecto». Eso incluye:

- **A vos mismo**, cuando entres con tu usuario para una restauración: tu
  sesión de lectura tendría de paso permiso de escritura.
- **A cualquier usuario anónimo**, si algún día se habilitan los inicios de
  sesión anónimos: la documentación dice explícitamente que «los usuarios
  anónimos usan el rol `authenticated` para acceder a la base».
- **A cualquier usuario que se cree por error o por descuido** en el
  proyecto.

Es decir: la política no distinguiría la terminal de nadie más. Para un
proyecto con un solo inquilino parece que da igual, pero la sección 1.5
muestra que la distinción es justamente lo que limita el daño en el robo.

### 1.2 Lo que se propone

**Un usuario permanente de Supabase Auth por terminal**, con estas
características:

| Aspecto | Decisión | Por qué |
|---|---|---|
| Tipo de usuario | **Permanente, con correo sintético y contraseña larga aleatoria.** Por ejemplo `terminal-1@pos.jimmycano.invalid` (dominio reservado, no recibe correo). | Un usuario **anónimo** queda descartado: la documentación dice que «no tiene forma de volver a iniciar sesión como el mismo usuario si cierra sesión». Una terminal que perdiera su sesión —por revocación, por un fallo, por reinstalar— no podría recuperar su identidad, y todo lo que dependa de `auth.uid()` se rompería. |
| Marca de rol | `app_metadata.rol = 'terminal'`, fijado **desde la administración** al crear el usuario. | `app_metadata` **no lo puede modificar el propio usuario** (la documentación lo recomienda para datos de autorización por eso mismo; `user_metadata` sí es editable por el usuario y no sirve). Es lo que las políticas RLS van a exigir. |
| Qué exigen las políticas | `(select auth.jwt() -> 'app_metadata' ->> 'rol') = 'terminal'` **y** `(select auth.jwt() ->> 'is_anonymous')::boolean = false`. | Distingue la terminal de vos, de un anónimo y de cualquier otro usuario. Se envuelve en `select` porque la documentación mide que así Postgres lo evalúa una vez por consulta y no una vez por fila. |
| Rol de lectura para la restauración | Otro valor distinto: `app_metadata.rol = 'restauracion'`, en **tu** usuario, no en el de la terminal. | La restauración (sección 6) lee todo; la terminal escribe y casi no lee. Son dos identidades con dos alcances, y ninguna tiene el del otro. |
| Llave pública de la API | La llave publicable (`anon` / `sb_publishable_...`) va dentro de la aplicación, como en cualquier cliente. | No es un secreto: solo identifica el proyecto. Sola no puede hacer nada, porque RLS está activo sin políticas para `anon`. |
| `service_role` | **Nunca viaja en el instalador, nunca se guarda en la terminal, nunca la usa la aplicación.** | Ignora RLS por diseño. Se usa una sola vez, desde tu máquina, para crear el usuario de la terminal (sección 1.3). |

**Por qué no un mecanismo distinto.** Se consideraron dos alternativas y se
descartaron con razón:

- *Una función Edge que reciba los cambios y escriba con `service_role`
  del lado del servidor.* Mueve el secreto a la nube, que es correcto, pero
  la terminal necesita igual una credencial para llamar a la función, así que
  el problema de la credencial no desaparece: se duplica, y encima se agrega
  un componente que hay que mantener y que cuenta contra los límites del plan.
- *Acceso directo a Postgres con una contraseña de rol.* Es una credencial
  todavía más poderosa que un JWT, sin expiración, sin rotación y sin RLS
  aplicado por PostgREST. Peor en todos los ejes.

### 1.3 Cómo llega la credencial a la terminal, sin que `service_role` la toque

El aprovisionamiento es un acto manual, tuyo, de una sola vez por terminal:

1. **Desde tu máquina**, con `service_role` o desde el panel de Supabase,
   creás el usuario de la terminal: correo sintético, contraseña aleatoria
   larga, `email_confirm: true`, `app_metadata: { rol: 'terminal',
   terminal: 'caja-1' }`.
2. En la terminal, en una pantalla nueva **solo para rol administrativo**
   («Conectar con la nube»), escribís ese correo y esa contraseña **una vez**.
3. La aplicación inicia sesión contra Supabase Auth, recibe el par de tokens,
   y **guarda únicamente el token de refresco** (sección 1.4). **La contraseña
   se descarta en ese momento y no se guarda en ningún lado.**
4. Desde ahí, la terminal se mantiene sola (sección 1.6).

Lo que queda en el disco es una sesión, no una contraseña. Si hace falta
volver a aprovisionar —revocación, reinstalación— se repite el paso 2 con una
contraseña nueva, y la vieja deja de servir cuando la cambies o borres el
usuario.

### 1.4 Dónde y cómo se guarda

**Con `safeStorage` de Electron**, que en Windows usa DPAPI y en macOS el
llavero. Se guarda en `<userData>/sincronizacion.credencial` como un `Buffer`
cifrado, nunca como texto. Electron 44, la versión del proyecto, lo trae
(`encryptString` / `decryptString`, verificado en sus definiciones).

**Qué protege DPAPI y qué no, dicho sin adornos.** DPAPI cifra con material
derivado de la **cuenta de Windows** del usuario que corre la aplicación.
Protege contra alguien que se lleve el disco y no tenga la contraseña de esa
cuenta. **No protege contra quien inicie sesión en la máquina como ese
usuario.** Y una terminal en modo kiosko casi seguro inicia sesión sola al
encender —o tiene la contraseña pegada al monitor—, así que en la práctica
**quien se lleva la computadora y la enciende tiene la credencial**. Por eso
este diseño asume, como pide el prompt, que la credencial **es extraíble**, y
el trabajo de verdad está en la sección 1.5: limitar lo que esa credencial
puede hacer.

### 1.5 El escenario que le da sentido al módulo: la terminal robada

Supongamos lo peor: la computadora fue robada, el ladrón la enciende, extrae
la sesión de Supabase de `userData`, y además tiene el archivo SQLite con
todo. **¿Qué le permite hacer la credencial que no pudiera hacer ya con el
disco?** Esa es la pregunta correcta, porque el disco ya le da todo lo
pasado: cada venta, cada nombre, cada hash de PIN.

Lo que la credencial **agrega** al ladrón es acceso a la **nube**, que es el
único lugar donde va a seguir viviendo el negocio después del robo. Y ahí
está el peligro exacto que el prompt nombra: el respaldo convirtiéndose en la
vulnerabilidad justo en el escenario para el que existe.

| Qué podría intentar el ladrón | ¿Lo permite este diseño? | Cómo se limita |
|---|---|---|
| **Borrar** ventas, productos o cualquier fila de la nube | **No.** No hay política de `DELETE` para el rol terminal, en ninguna tabla. | Borrar nunca es necesario: este proyecto no borra nada de negocio (§4.11). Sin política, PostgREST devuelve 403 y la fila queda. |
| **Insertar** ventas falsas, productos falsos, asientos falsos | **Sí, hasta que se revoque.** Insertar es lo que la terminal hace. | Lo que inserte queda **atribuido a esa terminal** (`auth.uid()` en el JWT) y con fecha de servidor. Al restaurar, todo lo insertado después del robo se puede identificar y descartar por fecha. Y no puede insertar sin que quede la marca. |
| **Modificar** filas ya subidas: cambiar un precio, un total, un nombre | **Parcialmente.** `UPDATE` se concede **solo en las tablas que lo necesitan** (sección 2.3), y **nunca** en `ventas`, `venta_detalle`, `recibos`, `auditoria_log` ni `caja_sesion_denominaciones`. | Las cinco tablas del dinero cobrado son de **solo inserción en la nube**: no hay política de `UPDATE` para la terminal. `auditoria_log` además es inmutable por trigger en los dos esquemas. El ladrón puede ensuciar el catálogo hasta la revocación; **no puede reescribir el historial de ventas**. |
| **Leer** todo el historial desde la nube | **Solo lo que la política de `SELECT` le dé**, que es lo mínimo que `UPDATE` exige (sección 2.3). | Ya lo tiene en el disco; lo que la nube agregaría son las ventas **futuras** de la terminal de reemplazo. Ver el riesgo abierto en 8.2. |
| **Seguir escribiendo después de que vos te enteres** | **No, con una ventana acotada.** | Revocar es **borrar el usuario de la terminal** (`auth.admin.deleteUser`) o banearlo (`ban_duration`). El token de refresco deja de servir de inmediato; **el JWT vigente sigue siendo válido hasta que expire**, porque PostgREST solo verifica firma y vencimiento, no si la sesión existe. Por eso la sección 1.6 propone un JWT corto. |

**Lo que este diseño NO limita, y hay que decirlo:** el daño entre el robo y
el momento en que vos te enterás y revocás. Durante esa ventana el ladrón
puede insertar basura y ensuciar el catálogo. La ventana no la acorta ningún
mecanismo técnico: la acorta que la sección 3.4 haga **visible** la
sincronización, para que la terminal de reemplazo o vos noten pronto que
alguien más está escribiendo. Queda en 8.1.

### 1.6 Ciclo de vida: expiración, revocación, renovación

| Situación | Qué pasa | Qué hace la aplicación |
|---|---|---|
| **Uso normal** | El JWT expira; la biblioteca cliente lo renueva sola con el token de refresco antes de que venza. El refresco es de un solo uso y rota. | Nada. La sesión guardada se actualiza con cada rotación, cifrada, en el mismo archivo. |
| **Expiración del JWT** | Se propone bajarla del valor por omisión (1 hora) a **15 minutos**. La documentación desaconseja bajar de 5. | Es la cota de la ventana de la sección 1.5 tras una revocación. Cuesta un refresco cada 15 minutos: una petición de unos cientos de bytes, 96 veces al día. Nada para el plan ni para la máquina. **Es una configuración del proyecto entero**, así que también aplica a tu sesión de restauración; no molesta, la biblioteca refresca sola. |
| **Corte de red durante un refresco** | El refresco puede no recibir respuesta. | La documentación describe la excepción: reutilizar el token padre dentro del mismo linaje devuelve el activo, así que un refresco perdido **no** termina la sesión. La aplicación no hace nada especial. |
| **Revocación** (borrado, baneo, cambio de contraseña) | El siguiente refresco devuelve 401 y no hay forma de recuperarse sola. | El módulo pasa al estado **«sin credencial»**: sigue encolando todo localmente, no pierde nada, y la barra de estado lo dice en rojo con la fecha desde la que está así. Se sale solo repitiendo el aprovisionamiento (sección 1.3) con rol administrativo. |
| **Reloj de la máquina mal puesto** | Un JWT «del futuro» o «vencido» por desfase. | La documentación advierte que los equipos de escritorio pueden desfasarse minutos u horas. Es un riesgo abierto (8.5): la sincronización no corrige el reloj, y un desfase grande la deja sin poder autenticar hasta que alguien lo arregle en Windows. |
| **Límite de sesiones del plan** | Time-box e inactividad de sesión **son de plan Pro**. | En el plan gratuito **no se puede** hacer que la sesión de la terminal caduque sola. La única expiración forzable es la del JWT. Anotado en 8.1. |

### 1.7 Lo que hay que hacer en el panel de Supabase, y que la aplicación no puede hacer sola

Todo esto se hace una vez, con tu cuenta, y queda registrado en una migración
de `supabase/migrations` para las políticas:

1. Habilitar el proveedor de correo y contraseña en Auth. Desactivar los
   inicios anónimos si estuvieran activos.
2. Bajar la expiración del JWT a 15 minutos.
3. Crear el usuario de la terminal con `app_metadata.rol = 'terminal'`.
4. Ponerle a tu usuario `app_metadata.rol = 'restauracion'` y, si el plan lo
   permite, MFA.
5. Aplicar la migración `0018` con las políticas RLS de la sección 2.3 y la
   `0019` con los buckets y políticas de Storage de la sección 2.5.

---

## 2. Qué se sincroniza y en qué dirección

### 2.1 Lista definitiva, leída del catálogo real de `pos-jimmy-cano`

**Las 13 tablas espejadas**, con lo que este diseño necesita saber de cada
una:

| Tabla | ¿Cambia después de creada? | ¿Tiene `actualizado_en`? | Cómo se sube | Unidad de trabajo |
|---|---|---|---|---|
| `usuarios` | Sí: nombre, rol, PIN, activo | Sí | Insertar y actualizar | Sola |
| `categorias` | Sí | Sí | Insertar y actualizar | Sola |
| `productos` | Sí: catálogo, **inventario**, contadores | Sí | Insertar y actualizar | Sola, **y también dentro de cada venta** (el inventario baja) |
| `precios_especiales` | Sí | Sí | Insertar y actualizar | Sola |
| `limites_descuento` | Sí | Sí | Insertar y actualizar | Sola |
| `configuracion_negocio` | Sí, la única fila | Sí | **Solo actualizar** (la fila `'unica'` ya existe en la nube desde la 0016) | Sola |
| `denominaciones` | No. Las 11 son fijas | Sí, pero irrelevante | **No se sube.** Ya están en la nube con los mismos UUID, sembradas por la 0004 | — |
| `caja_sesiones` | Sí: se abre, después se cierra | Sí | Insertar y actualizar | Con su desglose y su auditoría |
| `caja_sesion_denominaciones` | No | **No** | Solo insertar | Con la caja |
| `ventas` | Hoy no. Mañana, `estado` (anulación) | Sí | Solo insertar (ver 2.3) | Con su detalle, sus productos y su auditoría |
| `venta_detalle` | No | **No** | Solo insertar | Con la venta |
| `recibos` | Sí: `impreso`, y `pdf_path` al reimprimir | **No** | Solo insertar (ver 2.3) | Sola, después de la venta |
| `auditoria_log` | **Nunca.** Inmutable por trigger en los dos esquemas | **No** | Solo insertar, y el upsert **tiene** que ser «no hacer nada» si existe | Con la operación que la generó |

**Lo que NUNCA se sincroniza**, con la razón que ya está documentada:

| Qué | Por qué, citando lo ya decidido |
|---|---|
| `sync_cola` | «Es la lista local de qué falta subir. Subirla sería subir la lista de pendientes junto con los pendientes» (README). Es además la cola de este diseño: subirla no tendría sentido. |
| `bloqueos_de_autorizacion` | «Estado de seguridad de una terminal, válido durante 30 segundos. No debe sincronizarse nunca, bajo ningún diseño futuro» (CLAUDE.md §4.4). Sincronizarlo con más de una caja haría que un error de tecleo en una bloqueara la otra. |
| `usuarios.intentos_fallidos`, `usuarios.bloqueado_hasta` | «Estado por identidad, local por ahora» (README); «hoy no se sincroniza por una limitación de la arquitectura de una sola terminal, y probablemente haga falta con multi-sucursal» (CLAUDE.md §4.4). **Se excluyen del payload de `usuarios`.** |
| `migraciones_aplicadas` | Control del migrador local. |
| `ventas.estado_sincronizacion` | Es estado operativo de la terminal. **Existe en Postgres por la inconsistencia 1 de la sección 0**, pero este diseño no lo manda. |
| Los archivos `impresora.json` y `log-tecnico.log` | Estado operativo de una máquina (CLAUDE.md §4.14). |

### 2.2 Dirección: solo subida, y por qué no hay bajada

La sincronización continua **sube y no baja**. La terminal es la única fuente
de verdad; la nube es un espejo que llega tarde. Si la nube pudiera cambiar
algo en la terminal habría dos escritores, y ese es el problema multi-escritor
que el prompt excluye explícitamente.

La única operación que trae datos de la nube a la terminal es la
**restauración** (sección 6), que es otra cosa: corre sobre una terminal
vacía, una vez, a mano, y con otra credencial.

### 2.3 Las políticas RLS que este diseño necesita

Hoy las 13 tablas tienen RLS activo y **cero políticas**: nadie puede leer ni
escribir, y eso es correcto hasta que exista esto. Las políticas van en una
migración nueva, `0018_politicas_de_sincronizacion`, y son estas. `T` es la
condición del rol terminal de la sección 1.2; `R` la del rol restauración.

| Tabla | `INSERT` (terminal) | `UPDATE` (terminal) | `SELECT` (terminal) | `SELECT` (restauración) | `DELETE` |
|---|---|---|---|---|---|
| `usuarios` | `T` | `T` | `T` | `R` | nadie |
| `categorias` | `T` | `T` | `T` | `R` | nadie |
| `productos` | `T` | `T` | `T` | `R` | nadie |
| `precios_especiales` | `T` | `T` | `T` | `R` | nadie |
| `limites_descuento` | `T` | `T` | `T` | `R` | nadie |
| `configuracion_negocio` | nadie (la fila existe) | `T` | `T` | `R` | nadie |
| `denominaciones` | nadie | nadie | nadie | `R` | nadie |
| `caja_sesiones` | `T` | `T` | `T` | `R` | nadie |
| `caja_sesion_denominaciones` | `T` | **nadie** | nadie | `R` | nadie |
| `ventas` | `T` | **nadie, hoy** | nadie | `R` | nadie |
| `venta_detalle` | `T` | **nadie** | nadie | `R` | nadie |
| `recibos` | `T` | **nadie, hoy** | nadie | `R` | nadie |
| `auditoria_log` | `T` | **nadie, y además el trigger** | nadie | `R` | nadie |

Tres cosas de esta tabla que no son obvias:

- **`UPDATE` arrastra `SELECT`.** La documentación de Supabase es explícita:
  «para hacer un `UPDATE` hace falta una política de `SELECT`
  correspondiente; sin ella no funciona como se espera». Por eso las tablas
  que la terminal actualiza también las puede leer. Es la razón por la que la
  columna `SELECT (terminal)` no está vacía, y es un costo real en el
  escenario del robo (8.2). Las cinco tablas del dinero no se actualizan, y
  por eso **no** se pueden leer con la credencial de la terminal.
- **`ventas` y `recibos` son de solo inserción hoy, y eso es una decisión.**
  Mañana la anulación de ventas va a necesitar cambiar `ventas.estado`, y la
  reimpresión ya cambia `recibos.impreso`. Cuando eso llegue, hay dos caminos:
  conceder `UPDATE` (y con él `SELECT`) sobre esas tablas, o hacer ese cambio
  puntual por una función de Postgres que solo toque esa columna. **Se decide
  cuando exista la anulación, no antes**; mientras tanto, el historial de
  ventas en la nube es intocable con la credencial de la terminal, y ese es el
  mejor estado posible.
- **`recibos.impreso` y `recibos.pdf_path` no se sincronizan al cambiar.**
  Son estado de esta terminal: si el papel salió por esta impresora, y dónde
  está el PDF en este disco. La nube recibe el recibo al emitirse, una vez. Es
  coherente con que `recibos` no tenga `actualizado_en`.

### 2.4 El flujo completo: de la fila local a la fila confirmada

**El principio: la cola se escribe dentro de la misma transacción que el dato.**
Es el patrón de «bandeja de salida transaccional», y es la única forma de que
un cierre forzado —que este proyecto permite a propósito— no pueda dejar un
cambio hecho sin su entrada en la cola, ni una entrada sin su cambio. Es la
misma transacción de §4.13 con un paso más.

```
   TRANSACCIÓN LOCAL (SQLite, BEGIN IMMEDIATE, ya existe)
   ├─ 1..7  los siete pasos de la venta (§4.13), sin cambios
   └─ 8     INSERT en sync_cola: una fila por cada fila de negocio escrita,
            todas con el mismo lote_id, en el orden en que se escribieron
   COMMIT   ← si la app muere antes de acá, no hay venta ni cola. Después, hay las dos.

   TRABAJADOR (proceso principal, fuera de la transacción, en su propio ciclo)
   ├─ a  ¿hay conexión real? (sección 5). Si no, dormir.
   ├─ b  leer el lote más viejo sin sincronizar (FIFO por creado_en, después por orden dentro del lote)
   ├─ c  subirlo (sección 4: una llamada por lote)
   ├─ d  2xx → marcar sincronizado_en en TODAS las filas del lote, en una transacción local
   │     4xx determinístico → marcar error, detener la cola, avisar (sección 3.3)
   │     red / 5xx → dejar como estaba, dormir con backoff, reintentar
   └─ e  volver a b mientras haya lotes y quede presupuesto del ciclo
```

**Lo que `sync_cola` necesita y hoy no tiene.** La tabla existe desde la 001
con `entidad_tipo`, `entidad_id`, `operacion`, `payload`, `intentado_en`,
`sincronizado_en`, `error`, `creado_en`. Faltan, y van en una migración local
(no se espeja, como corresponde):

| Columna nueva | Para qué |
|---|---|
| `lote_id TEXT NOT NULL` | Agrupa las filas de una misma unidad de trabajo, para subirlas juntas (sección 4). |
| `orden_en_lote INTEGER NOT NULL` | Padres antes que hijos dentro del lote. |
| `intentos INTEGER NOT NULL DEFAULT 0` | Para el backoff y para el aviso de «lleva N intentos». |
| `proximo_intento_en TEXT` | Cuándo volver a intentar. Persistido, para que un reinicio no reinicie el backoff. |
| `bloqueante INTEGER NOT NULL DEFAULT 0` | `1` cuando falló con un error determinístico y detiene la cola hasta que alguien mire. |

El `payload` es la **fila completa** serializada como JSON, con los decimales
como **cadena canónica**, tal como están en SQLite. Nunca como número: un
`number` de JSON pierde dígitos, y Postgres recibe la cadena y la convierte a
`NUMERIC` exacto él mismo. Es la política de precisión de CLAUDE.md §5
aplicada al viaje hacia la nube.

**Qué dispara un intento.** Una combinación, y cada disparador tiene su
razón:

| Disparador | Cuándo | Por qué |
|---|---|---|
| **Al confirmar una transacción local** | 2 segundos después del `COMMIT`, agrupando si hay varias seguidas | Es el caso normal: una venta se cobra y sube enseguida. Los 2 segundos evitan competir con el recibo, que también se está generando. |
| **Intervalo de respaldo** | Cada 5 minutos si hay pendientes | Cubre cualquier disparador que se haya perdido. |
| **Al detectar conexión** | Cuando la sección 5 pasa de «sin internet» a «con internet» | Es el momento en que una desconexión larga termina. |
| **Al arrancar la aplicación** | 30 segundos después de que la ventana esté lista | Después de un cierre forzado puede haber quedado un lote a medias. Los 30 segundos son para no competir con el arranque en un i3. |
| **Al despertar de suspensión** | `powerMonitor` de Electron, evento `resume` | La red se levanta unos segundos después de despertar; se espera 15 segundos. |

**Cómo se decide qué va primero tras una desconexión larga.** **Estrictamente
en orden de llegada, por `creado_en` del lote.** Se consideró priorizar
«ventas primero, catálogo después» y se descartó: romper el orden de llegada
rompe las llaves foráneas. Una venta referencia a un producto que pudo haberse
creado esa misma mañana, sin conexión; si la venta sube primero, Postgres la
rechaza por FK. El orden de llegada es exactamente el orden en que las
referencias existen, y por eso es el único orden correcto. La única cola con
otra prioridad es la de **archivos** (sección 2.5), que va detrás de todas las
filas porque un archivo nunca es referenciado por una llave foránea.

**Cómo no se le pisa la pantalla al cajero.** Esto es lo que el hardware
exige, y se diseña desde ahora:

- El trabajador vive en el **proceso principal**, no en el renderer. La
  ventana ni se entera.
- **Lotes de hasta 50 filas** y **un lote por iteración**, con un `setTimeout`
  de 250 ms entre lotes cuando hay muchos pendientes. En un i3 de 2011 con
  4 GB, serializar 50 filas y hacer un `fetch` no llega a bloquear el bucle
  de eventos de forma perceptible; serializar 5 000 sí.
- **Presupuesto por ciclo**: como mucho 30 segundos o 20 lotes, lo que
  ocurra primero; después descansa 60 segundos aunque quede trabajo. Tras
  una semana sin conexión puede haber miles de filas: se suben en varios
  ciclos, no en uno que congele la máquina.
- **Cede ante la venta.** Si en el instante de empezar un lote hay una
  transacción de venta en curso —better-sqlite3 es síncrono, así que esto se
  detecta con una bandera que el servicio de venta levanta y baja—, el
  trabajador espera al siguiente ciclo.
- **Sin compresión, sin hash de filas, sin nada pesado** en el camino de las
  filas. Lo pesado es solo de archivos, y va aparte.

### 2.5 Archivos: fotos y PDF, que no son filas

Dos tipos de archivo viven hoy solo en el disco local, con su ruta relativa en
la base: las fotos de producto en `fotos-de-productos/<uuid>.jpg|png`
(`productos.foto_path`) y los PDF en `recibos/<nombre>.pdf`
(`recibos.pdf_path`). Los dos quedaron pospuestos «para el módulo de
sincronización», que es este.

#### 2.5.1 La ruta local no cambia de significado, y no se agrega ninguna columna

**`foto_path` y `pdf_path` siguen siendo exactamente lo que son: la ruta
relativa en este disco.** El funcionamiento sin internet no depende de que la
nube exista, hoy ni nunca, y eso se garantiza no tocando esas columnas.

Tampoco se agrega una columna «ruta en la nube», y la razón es que **no hace
falta: la ruta en Storage se deriva de la ruta local**, con una convención
fija:

| Archivo | Ruta local (en la base) | Objeto en Storage |
|---|---|---|
| Foto | `fotos-de-productos/5ea12297-….jpg` | bucket `fotos`, objeto `5ea12297-….jpg` |
| PDF | `recibos/recibo-000001-2026-09-11T19-09-34-701Z.pdf` | bucket `recibos`, objeto `<recibo.id>.pdf` |

La restauración (sección 6) deriva la ruta de Storage de la fila, la baja, y
la escribe en la ruta local que la fila ya dice. Una columna nueva sería un
segundo lugar donde la misma información puede discrepar.

**Qué lleva la cuenta de qué archivo subió.** La misma `sync_cola`, con dos
`entidad_tipo` nuevos —`archivo_foto` y `archivo_pdf`— y un `payload` con la
ruta local, el objeto de destino, el tamaño y el SHA-256 del archivo al
momento de encolarse. Van en la cola **después** de la fila que los
referencia, en su propio lote, y el trabajador los atiende **solo cuando no
queda ninguna fila pendiente**: las filas son el negocio, los archivos son el
adorno.

#### 2.5.2 Cómo se reintenta una subida cortada a la mitad

«A medias» significa algo distinto para un archivo, y por eso el mecanismo es
distinto. La respuesta depende del tamaño, y los dos casos de este proyecto
caen en el mismo lado:

| | Fotos | PDF |
|---|---|---|
| Tamaño real | Tope de 5 MB (§4.11); una foto de teléfono sin comprimir pesa entre 2 y 4 MB | **78 KB** un recibo de una línea, medido hoy con la aplicación real (Chromium incrusta las fuentes, por eso no baja de ahí) |
| ¿Cambia el contenido en la misma ruta? | **No.** Una foto nueva recibe un UUID nuevo (§4.11). El archivo en una ruta es inmutable. | **Sí.** La reimpresión **escribe encima** del mismo `pdf_path` (§4.14). |

Supabase Storage ofrece **subidas reanudables** con el protocolo TUS: trozos
de 6 MB, una URL de subida válida 24 horas, y reanudación desde el último
trozo confirmado. **Es la herramienta correcta para archivos grandes, y
ninguno de los nuestros lo es**: un archivo menor que un trozo se sube entero
o no se sube. Reanudar «desde el último trozo» de un archivo de un solo trozo
es volver a empezar.

Por eso el diseño para los tamaños de este proyecto es más simple, y más
robusto por ser simple:

1. **Subida en una sola petición**, con el SHA-256 calculado antes de
   encolar guardado en el payload.
2. **Si se corta**, se reintenta entera con el mismo backoff de las filas. Un
   archivo de 3 MB en la conexión de una tienda (pongamos 2 Mbps de subida)
   tarda unos 12 segundos: reintentarlo entero es barato.
3. **Idempotencia por nombre y por contenido.** Para fotos, el objeto se sube
   **sin** `x-upsert`: si Storage responde «el objeto ya existe», es que una
   subida anterior llegó y la confirmación se perdió, y como el contenido de
   esa ruta es inmutable, **se marca como éxito**. Para PDF, cuyo contenido sí
   puede cambiar por reimpresión, se sube **con** `x-upsert` y gana el último;
   pero ver 2.5.3, porque probablemente no convenga subirlos.
4. **La URL directa de Storage** (`<ref>.storage.supabase.co`) y no la del
   proyecto, que la documentación recomienda para archivos.
5. **El hash del archivo se calcula en un `worker_thread`**, no en el hilo
   principal: leer 5 MB y hacer SHA-256 en un i3 son unos cientos de
   milisegundos que no tienen por qué congelar la ventana.

**Cuándo sí haría falta TUS:** si algún día se aceptaran archivos mayores de
6 MB. Queda anotado, con el dato de que exigiría `tus-js-client` —que no está
instalado— y persistir la URL de subida en la cola, porque en el proceso
principal no hay `localStorage` donde la biblioteca guarde su huella.

#### 2.5.3 El costo real en el plan gratuito, con números

Límites leídos hoy de la página de precios: **1 GB de Storage**, **500 MB de
base de datos**, **5 GB de egreso al mes**, **50 MB por archivo**, y **el
proyecto se pausa tras una semana con poca actividad** (más sobre esto en
8.3). Al exceder un límite en el plan gratuito no se cobra: se avisa por
correo y se entra en un período de gracia.

**Hipótesis explícita, para que la puedas corregir:** 60 ventas por día, 26
días al mes; un catálogo de 200 productos con foto.

| Qué | Cálculo | Resultado |
|---|---|---|
| PDF de recibos | 60 × 26 × 78 KB | **≈ 122 MB por mes** |
| ↳ El gigabyte de Storage se llena en | 1 024 MB ÷ 122 MB | **≈ 8 meses** |
| Fotos, subidas como están | 200 × 3 MB (promedio de teléfono, sin comprimir) | **≈ 600 MB de una vez** |
| Fotos, redimensionadas a 800 px y comprimidas | 200 × 150 KB | ≈ 30 MB |
| Base de datos en Postgres | una venta con dos líneas, recibo y auditoría ≈ 2 KB | 60 × 26 × 2 KB ≈ 3 MB por mes: **años** de margen en 500 MB |
| Egreso | La sincronización continua es casi todo **ingreso**, que no cuenta. Cuenta la restauración y la consulta remota. | Restaurar 1 GB de archivos gasta 1 de los 5 GB del mes |

**Las dos decisiones que estos números piden, y que son tuyas:**

1. **Los PDF probablemente no deberían subirse.** Un PDF es **dato derivado**:
   se regenera desde `ventas`, `venta_detalle` y `configuracion_negocio`, y
   eso ya existe y es lo que hace la reimpresión (§4.14). Subirlos gasta el
   gigabyte en ocho meses para respaldar algo que la restauración puede
   reconstruir en segundos. La propuesta es **no subirlos por omisión** y
   dejar la subida como una opción apagada. Si preferís tenerlos igual, el
   diseño lo soporta con `x-upsert`, pero el plan gratuito deja de alcanzar
   antes de un año.
2. **Las fotos hay que reducirlas antes de subir, y probablemente antes de
   guardar.** CLAUDE.md §4.11 ya dice que no se redimensionan y que «si hace
   falta, es una mejora futura». Hace falta: 600 MB de fotos sin comprimir
   son el 60 % del plan de una sola vez. Redimensionar a 800 píxeles de lado
   mayor con calidad 80 baja el catálogo entero a unos 30 MB, y en la
   cuadrícula de venta una foto de 800 px se ve igual. Se propone hacerlo **al
   guardar**, no solo al subir, así el disco de la terminal también se cuida.

#### 2.5.4 Si el archivo local ya no existe

La fila dice `foto_path`, pero el archivo se borró a mano, o el disco se
restauró a medias. **No rompe nada:**

- El trabajador, al ir a leer el archivo para subirlo, no lo encuentra. Marca
  la entrada de la cola con `error = 'archivo_ausente'`, la deja como **no
  bloqueante** —a diferencia de un error de fila— y sigue con lo demás.
- Se registra en `log-tecnico.log`, no en `auditoria_log`: es un problema
  del disco, no un hecho del negocio (§4.14).
- Se reintenta **una vez al día** durante 7 días, por si el archivo vuelve;
  después queda listado en la pantalla de sincronización (sección 3.4) como
  «archivos que no se pudieron respaldar», con el nombre del producto o el
  número de recibo, para que alguien decida.
- La fila de la base sigue subiendo normalmente, con su `foto_path` tal cual:
  la nube sabe que ese producto **tenía** foto aunque no la tenga.

---

## 3. Idempotencia y reintentos

Este es el corazón del problema, y la respuesta corta es: **los UUID
generados en el cliente hacen que cada fila tenga una identidad antes de
subir, y Postgres sabe decir «esta ya la tengo» sin que la terminal tenga que
recordarlo.**

### 3.1 Los UUID del cliente, aprovechados como pide el prompt

CLAUDE.md §5 decidió desde el Prompt 5 que todas las claves primarias son
UUID generados en la terminal, justamente porque «con autoincrementales, dos
ventas creadas offline tendrían el mismo id y colisionarían al subir». Este
diseño cobra esa decisión:

**Toda subida es un upsert por clave primaria, nunca una inserción ciega.**
PostgREST lo expone como `Prefer: resolution=...` y supabase-js como
`upsert(filas, { onConflict: 'id', ignoreDuplicates })`. Postgres lo ejecuta
como `INSERT ... ON CONFLICT (id) DO ...`, y hay dos variantes, cada una para
un tipo de tabla:

| Variante | SQL que Postgres ejecuta | Para qué tablas | Por qué |
|---|---|---|---|
| **No hacer nada si existe** (`ignoreDuplicates: true`) | `ON CONFLICT (id) DO NOTHING` | `ventas`, `venta_detalle`, `recibos`, `auditoria_log`, `caja_sesion_denominaciones` | Son de solo inserción. Si la fila ya está, es que un intento anterior llegó. **Para `auditoria_log` es obligatoria**: el trigger `auditoria_log_prohibir_cambios` es `BEFORE UPDATE`, y un `DO UPDATE` lo dispararía y fallaría; `DO NOTHING` no ejecuta ningún `UPDATE` y pasa limpio. |
| **Actualizar si existe** (`ignoreDuplicates: false`) | `ON CONFLICT (id) DO UPDATE SET ...` | `usuarios`, `categorias`, `productos`, `precios_especiales`, `limites_descuento`, `caja_sesiones`, `configuracion_negocio` | Cambian después de creadas. Se manda la fila completa y gana la de la terminal, que es la única fuente de verdad. |

**Qué pasa exactamente en cada escenario que el prompt nombra:**

| Escenario | Qué ocurre |
|---|---|
| La fila subió, la respuesta 2xx se perdió en un corte de red | La terminal no marcó `sincronizado_en`, así que reintenta el mismo lote. Postgres encuentra los UUID, hace `DO NOTHING` o `DO UPDATE` con los mismos valores, responde 2xx. La terminal marca. **Cero duplicados, por construcción**: la clave primaria de la nube lo impide aunque la terminal se equivoque. |
| La aplicación se cerró a la fuerza a mitad de un lote | Hay dos casos y los dos son seguros. **Antes de que Postgres respondiera:** la cola sigue sin `sincronizado_en`; al arrancar, el trabajador ve `intentado_en` reciente sin confirmación y lo trata como pendiente. **Después de que Postgres respondió pero antes de marcar localmente:** igual que el caso anterior; el reintento es idempotente. **No hay ningún estado en memoria que perder**: todo lo que el trabajador sabe está en `sync_cola`, y `sync_cola` está en SQLite con `synchronous = FULL`, que sobrevive hasta un corte de energía (§5). |
| El mismo lote se sube dos veces por un error de programación | Mismo resultado: idempotente. |
| Una fila de `productos` cambió tres veces sin conexión | Hay tres entradas en la cola, en orden. Se suben en orden y la última gana. Como la terminal es el único escritor, «la última en orden de llegada» es exactamente el estado correcto. |

### 3.2 Política de reintentos

| Tipo de fallo | Ejemplos | Qué se hace | Cuántas veces |
|---|---|---|---|
| **Transitorio** | Sin red, tiempo de espera agotado, DNS, 5xx, 429 (límite de tasa) | Se deja el lote como estaba y se espera con **backoff exponencial con variación aleatoria**: 5 s, 30 s, 2 min, 10 min, 30 min, y después **cada hora**. El `proximo_intento_en` se persiste en la cola. | **Sin límite.** Una desconexión de una semana no es un error: es una desconexión. La cola espera. |
| **Determinístico** | 400 (un CHECK de Postgres rechazó la fila), 409 (llave foránea que no existe), 403 (RLS negó la operación), 422 | **Se detiene la cola en ese lote** (`bloqueante = 1`), se guarda el cuerpo de la respuesta en `error`, se avisa (3.4). **No se reintenta en bucle**: reintentar algo que Postgres ya dijo que es inválido es ruido. | Una vez. Se reintenta solo cuando alguien lo pide desde la pantalla, después de mirar el error. |
| **De credencial** | 401 | Se pasa al estado «sin credencial» (1.6). La cola no se toca. | Hasta reprovisionar. |

**Por qué un error determinístico detiene la cola en vez de saltar el lote.**
Saltar sería peor. Si la venta de las 10:15 falla por un CHECK y se sube la
de las 10:20, el respaldo tiene un hueco **silencioso**: parece completo y no
lo está, y con las llaves foráneas es probable que las siguientes también
fallen o, peor, que suban referenciando algo que no llegó. Una cola detenida
y **visible** es un problema que alguien va a ver; un hueco silencioso es un
problema que nadie va a ver hasta el día del robo. Es el mismo criterio de
«cero reintentos automáticos» del conflicto de inventario (§4.3): no tapar el
defecto, mostrarlo.

### 3.3 Qué se considera «fallando de forma persistente», y a quién se le avisa

Nadie va a mirar un archivo de log. Por eso la visibilidad es de tres niveles,
en orden de intrusión:

| Nivel | Dónde | Cuándo aparece | Qué dice |
|---|---|---|---|
| **Permanente** | La barra de estado (`BarraDeEstado`, que ya existe en todas las pantallas), junto al nombre del usuario | Siempre | Un solo texto corto: `Nube: al día`, `Nube: 12 pendientes`, `Nube: sin conexión desde 14:20`, `Nube: DETENIDA`. Sin color cuando está al día; ámbar con pendientes viejos; **rojo** cuando está detenida o sin credencial. |
| **Al iniciar sesión** | Un aviso destacado en la pantalla de sesión, solo para rol administrativo | Cuando hay pendientes de **más de 24 horas**, o la cola está detenida, o no hay credencial | «Hay 340 cambios sin respaldar en la nube desde ayer a las 09:12. Ver detalle.» |
| **Pantalla de sincronización** | Nueva, solo administrativo | Cuando se entra | Estado, pendientes por tabla, el lote detenido con su error **completo y legible**, archivos ausentes, y tres acciones: «reintentar ahora», «saltar este lote» (con confirmación y asiento de auditoría, porque es una decisión) y «conectar con la nube» (reaprovisionar). |

**El umbral de 24 horas** es el que separa «se cortó internet un rato» de
«algo está mal». Es un número provisional para que lo revises.

**Un lote saltado a mano queda en la auditoría** con quién lo saltó y qué
contenía. Es la única forma legítima de dejar un hueco en el respaldo, y por
eso tiene que quedar firmada.

---

## 4. Orden y consistencia entre tablas relacionadas

### 4.1 Qué escribe cada operación, medido en el código

Para diseñar la atomicidad hay que saber qué es «una unidad de trabajo». Se
leyó del código, no se supuso:

| Operación local | Filas que escribe en una sola transacción | Tablas |
|---|---|---|
| **Registrar una venta** (`ServicioDeVenta.registrar`) | 1 en `ventas`, N en `venta_detalle`, N actualizaciones en `productos` (inventario, `contador_ventas`, `cantidad_vendida`), 1 o 2 en `auditoria_log` | 4 |
| **Emitir el recibo** (`ServicioDeRecibos.emitir`, **después** de la transacción de la venta, a propósito, §4.14) | 1 en `recibos` | 1 |
| **Cerrar una caja** | 1 actualización en `caja_sesiones`, N en `caja_sesion_denominaciones`, 1 o 2 en `auditoria_log` | 3 |
| **Abrir una caja** | 1 en `caja_sesiones`, N en `caja_sesion_denominaciones`, 1 en `auditoria_log` | 3 |
| Crear o editar un producto, un usuario, una categoría, un tope, la configuración | 1 fila, más 1 en `auditoria_log` | 2 |

### 4.2 El problema, dicho con precisión

La transacción local es atómica: o están las cuatro tablas o ninguna. En la
nube, **PostgREST ejecuta cada petición HTTP en una transacción de Postgres**,
así que un lote de **una** tabla también es atómico. Lo que no es atómico es
**entre peticiones**: si la venta sube en una petición y sus líneas en otra,
hay un instante en que la nube tiene una venta sin líneas.

### 4.3 Las dos opciones, y la recomendación

**Opción A — una petición por tabla, en orden de llaves foráneas.**
Para una venta: primero `productos` (las actualizaciones de inventario, que
no dependen de nada), después `ventas`, después `venta_detalle`, después
`auditoria_log`. Siempre padres antes que hijos. La nube puede quedar, entre
dos peticiones, con una venta sin líneas. Nunca con líneas sin venta.

**Opción B — una sola petición por unidad de trabajo, a una función de
Postgres.** Se crea en la nube una función `sincronizar_lote(lote jsonb)` que
recibe todas las filas del lote y las inserta en sus tablas **dentro de una
transacción**, con los mismos `ON CONFLICT` de la sección 3.1. La terminal
hace **una** llamada por venta. O entra todo, o no entra nada.

| | Opción A | Opción B |
|---|---|---|
| ¿La nube puede quedar a medias? | **Sí, temporalmente**: entre peticiones, y tras un corte, hasta el próximo ciclo | **No** |
| Complejidad en la terminal | Un ciclo por tabla, con orden | Una llamada |
| Complejidad en la nube | Ninguna | Una función SQL por tipo de lote, con su migración, sus pruebas y su mantenimiento cuando cambie el esquema |
| RLS | Se aplica petición por petición | Se aplica igual: la función es `SECURITY INVOKER`, corre como el usuario terminal, y cada `INSERT` adentro pasa por las políticas |
| Peticiones por venta | 4 | 1 |
| Costo en un i3 | 4 `fetch` y 4 serializaciones | 1 y 1 |
| Qué pasa si una fila del lote es inválida | Las tablas anteriores ya subieron; el lote se detiene a medias, con un hueco parcial en la nube | Nada subió; el lote se detiene entero |

**Recomendación: la opción B para las unidades de varias tablas** —la venta,
la apertura y el cierre de caja— **y upserts directos para todo lo demás**.
Las razones, en orden de peso:

1. **No hay margen de error, y la B no tiene ventana.** Con la A, «el
   reintento lo completa pronto» es verdad en el caso normal, pero el caso
   que importa es el anormal: un lote detenido por un error determinístico en
   `venta_detalle` deja en la nube una venta sin líneas **indefinidamente**,
   hasta que alguien mire. Un respaldo con ventas sin líneas es un respaldo
   que miente sobre lo que se vendió.
2. **Es más barata para la máquina**, no más cara: una petición en vez de
   cuatro.
3. **El costo es una función SQL, y ese costo es visible y auditable**: vive
   en una migración, se prueba contra el proyecto real como todo lo demás, y
   cuando el esquema cambie hay que actualizarla, lo que va a fallar ruidoso
   y no silencioso.

**Si se eligiera la A**, la justificación de «temporalmente, porque el
reintento lo completa pronto» vale **solo con estas dos garantías** escritas:
que el orden padres→hijos es estricto, y que la restauración (sección 6.5)
**detecta y reporta** toda venta sin líneas y toda caja cerrada sin desglose
antes de dar por buena la restauración. Sin eso, la A no es aceptable.

### 4.4 El recibo y la venta son dos unidades, y está bien

El recibo se emite **después** de la transacción de la venta, por decisión
documentada (§4.14): generar el PDF y hablar con la impresora no van dentro de
una transacción. Por lo tanto la venta y el recibo son **dos lotes**, y la
nube puede tener durante un momento una venta sin recibo. Es aceptable, y es
distinto del caso de las líneas: una venta sin recibo **sigue siendo una
venta completa**; un recibo es un documento que se le emite. Si la terminal
muere entre la venta y el recibo, localmente también hay una venta sin recibo
(§4.14 lo dice en voz alta), y la nube refleja fielmente ese estado.

---

## 5. Detección de conexión, para Windows 10 y 11

### 5.1 Por qué `navigator.onLine` no alcanza, y qué ofrece Electron

Electron 44 expone en el proceso principal `net.isOnline()` y la propiedad
`net.online`. La propia definición de Electron dice, textualmente: *«Un valor
de `false` es un indicador bastante fuerte de que el usuario no va a poder
conectarse a sitios remotos. Sin embargo, un valor de `true` es
inconcluyente: aunque algún enlace esté activo, no es seguro que un intento
de conexión a un sitio remoto concreto vaya a tener éxito.»* En Windows,
Chromium lo saca del Network List Manager del sistema, que ve la red local: un
cable conectado a un router sin salida a internet, o un portal cautivo, dan
`true`.

### 5.2 Tres capas, de la más barata a la más cara

| Capa | Qué comprueba | Costo | Qué respuesta se le cree |
|---|---|---|---|
| **1. El sistema operativo** | `net.isOnline()` | Cero: es una lectura en memoria | **Solo el `false`.** Si dice que no hay red, no se intenta nada y se espera. |
| **2. Una petición real y liviana a Supabase** | `HEAD https://<ref>.supabase.co/auth/v1/health`, con tiempo de espera de **8 segundos** y la llave publicable en la cabecera | Unos cientos de bytes por comprobación | Solo un **200 con el cuerpo esperado** cuenta como «hay internet real». Un portal cautivo devuelve 200 con HTML de otro sitio: se rechaza por el tipo de contenido. DNS que no resuelve, tiempo agotado o cualquier otra cosa: «sin internet». |
| **3. El propio intento de sincronizar** | La primera petición real del ciclo | Ya se iba a hacer | Si falla por red, se vuelve a la capa 2 con backoff. |

**La capa 2 se hace contra Supabase mismo y no contra un sitio genérico**, por
dos razones: lo que importa no es «hay internet» sino «se llega a la nube de
este proyecto», y porque no se le regala tráfico a un tercero.

### 5.3 Cadencia, para que no sea costoso

La comprobación no corre en un intervalo fijo. Corre **cuando tiene sentido**:

| Momento | Qué se hace |
|---|---|
| **No hay nada pendiente** | No se comprueba la conexión para nada. Una máquina al día no gasta un byte en preguntar si podría subir algo que no tiene. |
| **Hay pendientes y la última comprobación dio «sin internet»** | Se recomprueba con backoff: 30 s, 1 min, 2 min, 5 min, y **5 minutos como tope**. A ese ritmo, un día entero sin internet son 288 comprobaciones de unos 300 bytes: **menos de 100 KB**. |
| **Cambio de estado del sistema** | `net.isOnline()` pasa de `false` a `true`; `powerMonitor` emite `resume` o `on-ac`; el renderer recibe el evento `online` de la ventana y lo reenvía por IPC. Cualquiera de esos dispara una comprobación **inmediata** (con 15 s de gracia tras despertar). |
| **Latido diario** | Una vez al día, aunque no haya pendientes, una consulta mínima a PostgREST: `GET /rest/v1/configuracion_negocio?select=id&limit=1`. | **Esta no es para detectar conexión: es para que el proyecto no se pause** (8.3). La documentación dice que «unas pocas consultas de usuario a la base por día» bastan, y que el health de Auth no cuenta como actividad de base. |

### 5.4 Lo específico de Windows

- **Espera de 15 segundos tras `resume`**: al despertar de suspensión, Windows
  restablece el adaptador de red unos segundos después de que el sistema
  ya corre. Comprobar en el instante cero da un falso «sin internet» y mete
  el backoff donde no hacía falta.
- **El tiempo de espera de 8 segundos importa en Windows** porque el
  comportamiento por omisión de una petición hacia un destino inalcanzable
  puede ser esperar hasta 21 segundos por los reintentos de TCP del sistema.
  Se corta antes con `AbortController`.
- **Proxy del sistema**: si la tienda tuviera un proxy configurado en
  Windows, `net.fetch` de Electron lo respeta y el `fetch` de Node no. Se usa
  `net.fetch` por eso.
- Nada de esto se puede dar por verificado hasta correrlo en una máquina
  Windows real, que sigue siendo el pendiente 12 de §6.2.

---

## 6. Restauración desde la nube

### 6.1 Cuándo, y cuándo no

**Cuándo:** una terminal nueva, o una reemplazada porque la anterior falló,
se dañó o fue robada. **Una vez por terminal.** Es la operación inversa de
todo lo anterior, y por eso es otra cosa: baja en vez de subir, lee todo en vez
de escribir poco, la corre una persona con su propia credencial en vez del
sistema solo, y **solo corre sobre una base vacía**.

**Cuándo no:** nunca sobre una terminal que ya tiene datos. Si la base local
tiene una sola venta, la restauración se niega. Mezclar lo que hay con lo
que baja es el escenario multi-escritor que este documento no diseña. La
única excepción sería explícita, con PIN de administrador, y con un respaldo
del archivo local hecho antes, y **no se propone construirla ahora**.

### 6.2 Precondiciones, todas comprobadas por la propia pantalla antes de empezar

| Precondición | Cómo se comprueba | Si falla |
|---|---|---|
| La base local está vacía | `usuarios` sin filas, es decir, la instalación está en su primer arranque | Se niega, con el motivo |
| Las migraciones locales están al día | El migrador ya corrió al arrancar | No aplica: si no corrieron, la app no abre |
| **El esquema local y el de la nube coinciden** | Se lee el conjunto de columnas de cada tabla espejada por PostgREST (`OPTIONS` / el esquema OpenAPI) y se compara con `PRAGMA table_info` local | Se niega y nombra la diferencia. Restaurar con esquemas distintos es cómo se restaura mal en silencio. |
| **El proyecto no está pausado** | La capa 2 de la sección 5 | Se muestra un mensaje que dice exactamente qué hacer: «Entrá al panel de Supabase y reanudá el proyecto». Ver 8.3: una terminal rota dos semanas es tiempo suficiente para que el proyecto se haya pausado. |
| Hay credencial de restauración | Vos iniciás sesión en la pantalla con **tu** usuario, el que tiene `app_metadata.rol = 'restauracion'` | — |

**La credencial de restauración no se guarda.** Es una sesión que vive
mientras la pantalla está abierta y se cierra al terminar, con `signOut`.
Nunca toca `safeStorage`. Es la diferencia de alcance de la sección 1.2
llevada hasta el final: lo que puede leer todo no se queda en la máquina.

### 6.3 Qué trae, y en qué orden

**El orden es el del grafo de llaves foráneas de Postgres, leído hoy del
catálogo**: cada tabla después de las que referencia.

| Paso | Tabla | Referencia a | Qué se hace con lo que ya existe localmente |
|---|---|---|---|
| 1 | `usuarios` | — | Insertar. `intentos_fallidos = 0`, `bloqueado_hasta = NULL`: esas columnas no vienen de la nube y no deben venir. |
| 2 | `categorias` | — | Insertar |
| 3 | `denominaciones` | — | **No se traen.** Las 11 ya las sembró la migración 004 con los mismos UUID. Se **verifica** que la nube tenga las mismas 11, y si no coinciden se detiene. |
| 4 | `configuracion_negocio` | — | **Actualizar** la fila `'unica'`, que la migración 016 ya creó vacía. |
| 5 | `productos` | `categorias` | Insertar |
| 6 | `precios_especiales` | `productos` | Insertar |
| 7 | `limites_descuento` | `usuarios` (`editado_por`) | Insertar |
| 8 | `caja_sesiones` | `usuarios` (tres columnas) | Insertar. Una caja **abierta** que quedó en la nube se restaura abierta: la terminal nueva la va a ver como «la abrió otra persona» y el flujo de cerrar caja ajena con PIN (§4.9) la resuelve. No hay que inventar nada. |
| 9 | `caja_sesion_denominaciones` | `caja_sesiones`, `denominaciones` | Insertar |
| 10 | `ventas` | `caja_sesiones`, `usuarios` | Insertar. `estado_sincronizacion = 'sincronizado'` localmente, porque ya está en la nube. |
| 11 | `venta_detalle` | `ventas`, `productos` | Insertar |
| 12 | `recibos` | `ventas` | Insertar. `impreso = 0`; `pdf_path` tal como estaba. `siguienteNumero()` es `MAX + 1` sobre la tabla (verificado en el repositorio), así que la numeración continúa sola. |
| 13 | `auditoria_log` | `usuarios` | Insertar, en orden de fecha. |
| 14 | Archivos: fotos | — | Bajar de Storage a `fotos-de-productos/`, derivando el objeto de `foto_path` (2.5.1). Las que falten en la nube se anotan; el producto sigue existiendo sin foto, que es su estado normal (§4.11). |
| 15 | Archivos: PDF | — | Solo si se decidió subirlos (2.5.3). Si no, **no se bajan y no hace falta**: la reimpresión los regenera desde las filas. |

Después: `sync_cola` vacía, y la sincronización continua arranca desde cero
con la credencial de la terminal, que se aprovisiona **después** de restaurar,
no antes.

### 6.4 Cómo se convierte lo que baja, sin perder un centavo

Postgres devuelve `NUMERIC`, `timestamptz`, `boolean`, `uuid`. SQLite exige
TEXT canónico con CHECK, ISO con `Z`, `0`/`1`, texto. La conversión es el
lugar donde una restauración puede corromper en silencio, así que se hace en
un solo módulo, con estas reglas y sus pruebas:

| De Postgres | A SQLite | Regla |
|---|---|---|
| `NUMERIC` (dinero, peso, cantidad) | TEXT canónico | Se lee **como texto** de la respuesta JSON, nunca como `number`; se pasa por `Decimal` y por `aColumnaMonto` / `aColumnaCantidad` / `aColumnaExacta` de `decimal-columns.ts`, que es la única vía autorizada (§5). Si el CHECK canónico rechaza el valor, la restauración se detiene y lo dice: es preferible a un valor mal redondeado. |
| `timestamptz` | ISO con `Z` | PostgREST devuelve `2026-09-11T19:09:34.701+00:00`. **El CHECK local exige el sufijo `Z`**; se normaliza con `new Date(...).toISOString()`, que da los milisegundos y la `Z`. |
| `boolean` | `0` / `1` | `aColumnaBooleana` |
| `uuid` | TEXT de 36 | Tal cual |

Y una verificación al final de cada tabla: **el conteo local tiene que ser
igual al de la nube**. Para `ventas`, además, **la suma de `total` por mes**,
calculada en la nube con `SUM` sobre `NUMERIC` (que allá sí es exacto, §5) y
localmente con `sumarLista` de Decimal, tiene que coincidir al centavo. Si no
coincide, la restauración no se da por buena.

### 6.5 Anomalías que la restauración busca antes de declararse completa

Son las que la sección 4 admite como posibles o el robo puede haber dejado:

| Anomalía | Qué significa | Qué se hace |
|---|---|---|
| Una venta sin líneas en la nube | Un lote que subió a medias (solo con la opción A) | Se lista. No se restaura como venta válida sin que vos lo veas. |
| Una caja cerrada sin desglose, que se cerró en modo detallado | Igual | Se lista |
| Filas con `creado_en` **posterior** a la fecha del robo que vos indiques | Basura que el ladrón pudo insertar con la credencial antes de la revocación (1.5) | La pantalla pide esa fecha si la restauración es por robo, y lo que sea posterior se muestra aparte, **sin restaurar**, para que decidas fila por fila. |
| Un producto cuya foto no está en Storage | Se subió la fila y no el archivo | Se restaura sin foto y se lista |

### 6.6 Cómo se le comunica el progreso, con el hardware y la conexión reales

Va a tardar. Con PostgREST **la página máxima es de 1 000 filas**, y en un i3
de 2011 escribir 1 000 filas en SQLite con sus CHECK dentro de una transacción
son unos 2 segundos; con la conexión de una tienda, bajar cada página es
otro segundo o dos. Un año de operación —15 000 ventas, 40 000 líneas,
15 000 recibos, 30 000 asientos— son unas 100 páginas: **entre 5 y 10
minutos de filas**. Las fotos, a 2 Mbps de bajada, 30 MB comprimidas son un
par de minutos; 600 MB sin comprimir, **más de 40 minutos** (otra razón para
2.5.3).

Por eso la pantalla, que es nueva y solo de rol administrativo:

- Muestra **una fila por tabla**, en el orden de 6.3, con estado
  «esperando / bajando 3 200 de 15 000 / listo», y un total.
- **Se puede cerrar y volver a abrir**: el progreso por tabla se guarda en
  `<userData>/restauracion.json` al terminar cada página, y **retomar
  significa seguir por la tabla y la página donde quedó**. Como cada fila
  tiene su UUID y se inserta con «ignorar si existe», repetir una página ya
  hecha no duplica nada.
- **Se puede cancelar**, y cancelar deja la base en el estado que estaba al
  final de la última página completa. Si se cancela y no se retoma, la base
  queda a medias y la pantalla lo dice al arrancar: «Hay una restauración
  incompleta; retomala o borrá esta instalación».
- No estima tiempo total, porque la estimación en la primera página siempre
  miente. Muestra filas por segundo desde hace 30 segundos y la cantidad que
  falta, que es lo que una persona puede leer sin que se le prometa nada.
- Todo corre en el proceso principal, página por página, cediendo el bucle
  de eventos entre páginas. La ventana sigue respondiendo; no se puede vender,
  porque no hay nada que vender todavía.

---

## 7. Decisiones que este diseño te pide, en una lista

Ninguna está tomada. Están numeradas para que puedas contestar por número.

1. **Rol por `app_metadata`** en vez de `auth.role() = 'authenticated'`
   (sección 1.1). Recomendación: sí.
2. **JWT de 15 minutos** para todo el proyecto (1.6). Recomendación: sí.
3. **Solo inserción en la nube para `ventas`, `venta_detalle`, `recibos`,
   `auditoria_log` y `caja_sesion_denominaciones`**, sin política de
   `UPDATE` para la terminal, hasta que exista la anulación (2.3).
   Recomendación: sí.
4. **Quitar `ventas.estado_sincronizacion` de Postgres** con una migración, o
   dejarlo y documentarlo como columna sin significado (sección 0, punto 1).
   Recomendación: quitarlo.
5. **Opción B**, función de Postgres por unidad de trabajo, para venta,
   apertura y cierre de caja (4.3). Recomendación: sí.
6. **No subir los PDF de recibos por omisión** (2.5.3). Recomendación: no
   subirlos. Es la decisión con más impacto en el plan gratuito.
7. **Redimensionar las fotos al guardar** (2.5.3). Recomendación: sí, a
   800 px de lado mayor.
8. **Umbral de 24 horas** para el aviso de pendientes viejos (3.3). Es un
   número provisional.
9. **Un lote saltado a mano exige PIN y queda en auditoría** (3.3).
   Recomendación: sí.
10. Si el `SyncProvider` actual se adapta o se reemplaza: su
    `traerCambios(desde)` no encaja con «solo subida» (sección 0, punto 5).
11. **Biblioteca**: `@supabase/supabase-js` no está instalada. Las llamadas
    necesarias son pocas —Auth por REST, PostgREST con `Prefer`, Storage con
    `POST`— y podrían hacerse con `net.fetch` sin agregar dependencia. Es una
    decisión de superficie contra comodidad; se deja abierta (8.7).

---

## 8. Riesgos identificados y no resueltos

Cada uno es un lugar donde este documento **no tiene** una respuesta sólida.
Están escritos para que se decidan, no para que se olviden.

### 8.1 La ventana entre el robo y la revocación

Nada técnico la acorta. Durante ese tiempo la credencial robada puede
insertar filas basura y modificar el catálogo (no el historial de ventas).
Lo que este diseño hace es **acotar la ventana después de la revocación** a
la vida del JWT (15 minutos) y **hacer visible** la sincronización para que
la terminal de reemplazo note actividad ajena. Lo que no hace es enterarte
del robo: eso no es problema de software. Y en el plan gratuito **no hay
caducidad de sesión configurable** (es de Pro), así que una sesión robada no
caduca sola jamás; solo la revocación manual la termina.

### 8.2 Los hashes de PIN viven en la nube

`usuarios` se espeja entero, con `pin_hash` y `pin_remoto_hash` (la 0005 dice
textualmente «columna de `usuarios`, que ya se sincroniza entera»). Son
scrypt con sal (§4.7), pero **un PIN de cuatro dígitos tiene 10 000 valores**:
con los parámetros actuales, recorrerlos todos contra un hash es cuestión de
minutos en cualquier computadora. Quien lea `usuarios` en la nube tiene los
PIN de todos.

¿Quién puede leerla? Con la sección 2.3, **la terminal**, porque actualiza
`usuarios` y `UPDATE` arrastra `SELECT`; y **tu usuario de restauración**.
En el escenario del robo el ladrón ya tiene esos hashes en el disco, así que
la nube no le agrega nada ahí. **Lo que la nube sí agrega es un segundo lugar
desde donde robarlos sin robar la computadora**: una credencial de terminal
filtrada por otra vía, o tu cuenta de Supabase.

Opciones, ninguna elegida:

- **No sincronizar los hashes.** La restauración los necesitaría: sin ellos,
  nadie puede entrar en la terminal nueva. Habría que reconstruir los PIN a
  mano tras restaurar (crear usuarios de nuevo), que es aceptable para una
  tienda con dos o tres personas, y elimina el riesgo entero.
- **Sincronizar solo por inserción y sin `SELECT`**, moviendo el cambio de
  PIN a una función de Postgres que actualice sin devolver nada. Cierra la
  lectura desde la terminal, no desde tu cuenta.
- **Dejarlo así y aceptarlo**, anotado.

### 8.3 El proyecto gratuito se pausa solo

Leído hoy: un proyecto gratuito con «poca actividad de base de datos durante
7 días» se pausa; hay un aviso por correo una semana antes y **90 días** para
reanudarlo desde el panel; después solo queda descargar el respaldo. El
latido diario de la sección 5.3 lo evita **mientras la terminal esté
encendida**. Dos escenarios lo rompen:

- **Vacaciones de más de una semana con la terminal apagada.** Se pausa. Al
  volver, la sincronización falla hasta que alguien entre al panel y reanude.
  La cola espera, no se pierde nada, pero hace falta una acción manual que
  hoy nadie sabe que existe. Mitigación: el aviso por correo llega a tu
  cuenta, no a Jimmy.
- **Justo el escenario de la restauración**: la terminal se rompió, pasaron
  dos semanas hasta conseguir otra, el proyecto se pausó a los siete días.
  La restauración lo detecta (6.2) y dice qué hacer, pero **el respaldo está
  pausado exactamente cuando se lo necesita**. Dentro de los 90 días se
  reanuda con un clic; pasados, hay que restaurar desde un archivo
  descargado, que es otro procedimiento que este documento no diseña.

La salida real es el plan Pro, que «no está sujeto a pausado». El proyecto
ya prevé pasar a plan pagado antes de la entrega (§3); este riesgo dice que
**no es opcional** si la nube tiene que ser un respaldo confiable.

### 8.4 `ON CONFLICT DO NOTHING` bajo RLS, sin verificar

La sección 3.1 asume que un upsert con «no hacer nada si existe» **no exige
política de `SELECT`** en Postgres, y que por eso la terminal puede reintentar
sobre `ventas` sin poder leerla. Es lo que dice la semántica de Postgres
—`DO NOTHING` no lee la fila existente—, pero **no se verificó contra
PostgREST con RLS en el proyecto real**, porque hacerlo exige crear políticas
y un usuario, y este prompt prohíbe tocar la nube. Es la **primera cosa que
hay que medir** al implementar, antes de escribir la cola: si resultara que
hace falta `SELECT`, la tabla de 2.3 cambia y el riesgo 8.2 crece.

### 8.5 El reloj de la máquina

Todo depende de que Windows tenga la hora bien: `ventas.fecha` y `creado_en`
se generan con el reloj local, el JWT se valida contra él, y el orden de la
cola es por `creado_en`. Un reloj atrasado horas hace que las ventas de hoy
aparezcan en el reporte de ayer (§4.15 ya lo sufre) y que Auth rechace un JWT
«del futuro». La sincronización **no corrige el reloj ni lo detecta**. Podría
compararlo contra la cabecera `Date` de las respuestas de Supabase y avisar
si el desfase pasa de un minuto; queda propuesto, no diseñado.

### 8.6 `sync_cola` crece sin límite

Cada fila de negocio deja una fila en la cola, para siempre, con su payload
completo. Un año de operación son unas 150 000 entradas: decenas de
megabytes en un disco que además guarda PDF. Hace falta una **poda** —borrar
lo sincronizado hace más de N días— y es de las pocas operaciones del
proyecto que borra de verdad. Se justifica como el guion de datos de ejemplo
(§4.11): no es historial, es una lista de pendientes ya cumplidos. El número
de días y si se hace en arranque o en un ciclo del trabajador quedan sin
decidir.

### 8.7 Dependencia nueva en el proceso principal

`@supabase/supabase-js` trae su propio cliente de Auth con almacenamiento
configurable, reintentos de refresco y tipado. También trae peso y una
superficie que se actualiza sola. La alternativa es `net.fetch` contra tres
endpoints REST bien documentados. Con `supabase-js`, hay que verificar que su
refresco automático funcione en un proceso sin `localStorage` con un
`storage` propio sobre `safeStorage`; con `fetch` a mano, hay que escribir
ese refresco. No hay una respuesta sólida sin probar las dos en el hardware.

### 8.8 Lo que el hardware todavía no midió

Todo número de rendimiento de este documento —2 segundos por página de 1 000
filas, cientos de milisegundos por hash de 5 MB— es una estimación para un
i3 de 2011. **Nada se midió en esa máquina**, porque no hay una. Es el mismo
pendiente 12 de §6.2, extendido a esto: la primera implementación tiene que
medirse allí antes de dar por buenos los presupuestos de la sección 2.4.

### 8.9 Restaurar sobre una terminal que ya tiene datos

Excluido a propósito (6.1). Pero el caso existe: la terminal no se perdió,
solo se corrompió el archivo SQLite, y hay ventas de esta mañana que no
llegaron a subir. Restaurar desde la nube las pierde; no restaurar deja la
base corrupta. La respuesta correcta es un **respaldo local** independiente
—copia del archivo SQLite a otro disco o USB cada noche—, que es el pendiente
11 de §6.2 y que este documento no cubre. Conviene decidirlo junto con esto.

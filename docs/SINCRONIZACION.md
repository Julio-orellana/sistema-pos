# Sincronización con la nube — documento de diseño

> **ESTADO: APROBADO, EN IMPLEMENTACIÓN POR FASES. Aprobado por Julio el
> 2026-09-11.**
>
> Las 17 decisiones de la sección 7 quedan adoptadas con la recomendación del
> documento, salvo dos:
>
> - **Decisión 10** (`traerCambios` en `SyncProvider`): se resuelve
>   **retirando el método de la interfaz**. Va en la fase 1.b, no antes.
> - **Decisión 11**: queda **abierta hasta medir en hardware real** (fase 3).
>   Ningún número de rendimiento de este documento se da por bueno hasta
>   entonces.
>
> **Qué está implementado hoy, y qué no.** Este documento sigue describiendo el
> diseño completo, no el estado del código.
>
> - **Fase 1.a — construida.** La migración `018_sync_cola_lotes` y la **bandeja
>   de salida transaccional** de la sección 2.4: cada operación de negocio llena
>   `sync_cola` dentro de su misma transacción.
> - **Fase 1.b — construida.** El **trabajador** de la sección 2.4: lee la cola
>   por lotes, respeta el orden de llegada, aplica el presupuesto por ciclo y la
>   escalera de reintentos de la sección 3.2, detiene la cola ante un error
>   determinístico y cede ante una venta en curso. Corre contra
>   `SimulatedSyncProvider`. La decisión 10 se ejecutó: `traerCambios` ya no
>   está en la interfaz.
> - **Fase 2.a — construida.** El proyecto de pruebas descartable de la 9.5 y
>   las migraciones `0019` a `0022`: `recibido_en` en doce tablas (mitigación
>   1 de 1.5.1), y las decisiones 4 y 17 aplicadas. Ver CLAUDE.md §4.19.
> - **Fase 2.b — construida, SOLO en el proyecto de pruebas.** Las funciones
>   de la migración `0023` —usuario, apertura, cierre, venta, lote simple y el
>   contrato de la 9.2—, el guion `verify:nube` con su seguro, y la prueba de
>   deriva en sus dos mitades. **El riesgo 8.4 se midió y cambió el diseño:**
>   todo lote sube por función y la terminal no tiene política directa sobre
>   ninguna tabla (ver 8.4 y CLAUDE.md §4.20). `pos-jimmy-cano` no tiene la
>   `0023` todavía.
>
> **Lo que sigue sin existir:** las políticas de RLS de la 2.3 (fase 2.c), el
> `SyncProvider` real contra Supabase y las credenciales de la sección 1 en la
> terminal (fase 3), la detección de conexión de la sección 5, los archivos de
> la 2.5, la pantalla de sincronización de la 3.3 y la restauración de la 6.
> **Este documento describe el diseño; donde lo construido se apartó de él,
> hay una nota «COMO QUEDÓ CONSTRUIDO» al principio de la sección.**

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
| 1 | «La nube lleva datos de negocio; el estado operativo de una terminal se queda en SQLite» (README de migraciones, CLAUDE.md §4.4). | **`ventas.estado_sincronizacion` EXISTE en Postgres**, con su CHECK, desde la 0001. Es estado operativo de la terminal, exactamente lo que la regla dice que no se espeja. | En la nube esa columna va a decir siempre lo que la terminal mande o su `DEFAULT 'pendiente'`, que allá no significa nada. Es el mismo error que el README describe para `intentos_fallidos`: «columnas siempre en cero engañan al auditor». Este diseño **no la manda** en el payload. Hace falta decidir si se quita de Postgres con una migración. **RESUELTA en la fase 2.a: la `0020` la quitó de Postgres.** |
| 2 | La infraestructura de sincronización «ya existe»: `sync_cola` y `ventas.estado_sincronizacion`. | **Nadie escribe en `sync_cola` fuera de las pruebas.** La transacción de venta no encola nada. `estado_sincronizacion` se pone en `'pendiente'` al insertar y ninguna otra línea del proyecto la lee ni la cambia. | Es andamiaje sin conectar. Sirve como punto de partida, pero `sync_cola` necesita columnas que no tiene (sección 2.4). |
| 3 | El README de `supabase/migrations` lista en su tabla de «qué se espeja» **10 tablas**. | Postgres tiene **13**: faltan en esa tabla `denominaciones`, `caja_sesion_denominaciones` y `configuracion_negocio`, que sí están espejadas. | La lista definitiva de este documento (sección 2.1) sale del catálogo real, no del README. **RESUELTA en la fase 2.a: el README se reescribió con las trece.** |
| 4 | El README dice que la `0016` está **pendiente**. | Se aplicó el 2026-09-11, igual que la `0017`, que el README no menciona. | Documentación desactualizada. Se corrige aparte; no afecta el diseño. **RESUELTA en la fase 2.a: el README tiene el estado real de los dos proyectos.** |
| 5 | La interfaz `SyncProvider` tiene `traerCambios(desde)`: un método de **bajada** incremental. | La sincronización continua de este diseño es **solo subida** (sección 2.2). Bajar cambios sería tener dos escritores, que es el problema que el prompt excluye. | **RESUELTA en la fase 1.b: se retiró de la interfaz.** La restauración tendrá la suya propia en la fase 4.b. |

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
| **Modificar** filas ya subidas: cambiar un precio, un total, un nombre | **Parcialmente.** `UPDATE` directo se concede **solo sobre el catálogo** (sección 2.3), y **nunca** en `ventas`, `venta_detalle`, `recibos`, `auditoria_log`, `caja_sesion_denominaciones`, ni —desde 1.5.1— en `usuarios` ni `caja_sesiones`, que solo se escriben por función con una forma fija. | Las cinco tablas del dinero cobrado son de **solo inserción en la nube**: no hay política de `UPDATE` para la terminal. `auditoria_log` además es inmutable por trigger en los dos esquemas. Un cierre de caja no se puede reescribir: no existe función que lo haga. El ladrón puede ensuciar el catálogo hasta la revocación, y **toda modificación queda con `recibido_en` del servidor** (1.5.1); **no puede reescribir el historial de ventas ni de cajas**. |
| **Leer** todo el historial desde la nube | **Solo el catálogo**: lo mínimo que el `UPDATE` directo exige (sección 2.3). Ni ventas, ni cajas, ni usuarios. | Ya lo tiene en el disco; lo que la nube agregaría son las ventas **futuras** de la terminal de reemplazo, y con 2.3 **no puede leerlas**. Los hashes de PIN tampoco (8.2). |
| **Seguir escribiendo después de que vos te enteres** | **No, con una ventana acotada.** | Revocar es **borrar el usuario de la terminal** (`auth.admin.deleteUser`) o banearlo (`ban_duration`). El token de refresco deja de servir de inmediato; **el JWT vigente sigue siendo válido hasta que expire**, porque PostgREST solo verifica firma y vencimiento, no si la sesión existe. Por eso la sección 1.6 propone un JWT corto. |

#### 1.5.1 `usuarios`: el análisis que faltaba, y un hueco en la detección

La primera versión de esta sección analizó las cinco tablas del dinero y dejó
`usuarios` fuera, con `UPDATE` concedido a la terminal en 2.3. Eso era un
error de análisis, y al corregirlo apareció un segundo hueco, en la propia
detección de la sección 6.5. Los dos se resuelven acá y cambian 2.3, 4.3, 6.2
y 6.5.

**Qué podía hacer la credencial robada contra `usuarios` con la tabla 2.3
original:**

| Acción | ¿Era posible? | Qué tan grave, y por qué |
|---|---|---|
| **Sobrescribir `pin_hash` o `pin_remoto_hash` de un administrador** | Sí, con `UPDATE` | **Menos grave de lo que parece, por una razón que obliga a otra regla.** El ladrón ya tiene el archivo SQLite, y con él los hashes de todos; un PIN de cuatro dígitos se fuerza en minutos (8.2). Es decir: **después de un robo, TODOS los PIN están comprometidos, haya o no tocado la nube.** Por lo tanto la restauración **resetea todos los PIN y borra todos los PIN remotos, siempre y en toda restauración, no solo tras un robo** (6.1). Con esa regla, lo que el ladrón haya escrito en `pin_hash` en la nube se descarta sin mirarlo. El vector existe; su efecto es nulo. Y si los hashes dejan de sincronizarse (decisión 17), el vector desaparece. |
| **Cambiar `rol` de un cajero a `administrativo`** | Sí | **Grave, y el reset de PIN no lo neutraliza.** Restaurado, ese cajero es administrador. |
| **Poner `activo = 0` a todos los administradores** | Sí | **Grave: es una negación de servicio contra la restauración.** El primer arranque solo se ofrece con la tabla vacía (§4.7), así que una terminal restaurada sin ningún administrador activo queda sin forma de administrarse. |
| **Cambiar `nombre`** | Sí | Menor: rompe la atribución, no da acceso. |
| **Insertar un administrador nuevo con su propio PIN** | Sí, con `INSERT` | Igual de grave que promover a uno. |

**Y el hueco en la detección, que es el más serio de todos:** la sección 6.5
proponía detectar lo insertado por el ladrón buscando filas con `creado_en`
posterior a la fecha del robo. **`creado_en` viene en el payload que manda
la terminal, así que el ladrón lo elige.** Puede insertar una venta falsa
fechada el mes pasado, o modificar un usuario y dejar `actualizado_en` como
estaba. Ninguna marca de tiempo que ponga el cliente sirve para detectar lo
que hizo el cliente. Y un `UPDATE` ni siquiera toca `creado_en`, como vos
señalaste.

**La respuesta a las dos cosas es la misma: el servidor tiene que poner su
propia marca de tiempo en todo lo que recibe, y el cliente no tiene que poder
tocarla.**

##### Mitigación 1: `recibido_en`, una marca del servidor en las 13 tablas

Una columna **solo en la nube**, no espejada en SQLite porque no es dato de
negocio sino metadato del respaldo:

```
recibido_en timestamptz NOT NULL DEFAULT now()
```

mantenida por un trigger `BEFORE INSERT OR UPDATE` en cada tabla que **la
fija a `now()` e ignora cualquier valor que venga en el payload**. Así:

- Toda fila insertada por el ladrón tiene `recibido_en` posterior al robo,
  diga lo que diga su `creado_en`.
- Toda fila modificada por el ladrón tiene `recibido_en` posterior al robo,
  diga lo que diga su `actualizado_en`.
- La restauración (6.5) filtra por `recibido_en`, que es la única fecha que
  el ladrón no controla, y ya no por `creado_en`.

Lo que `recibido_en` **no** da es el valor anterior de una fila modificada:
dice que la tocaron, no qué decía antes. Para las tablas donde eso importa
está la mitigación 2.

##### Mitigación 2: `usuarios` y `caja_sesiones` no se actualizan directo, se escriben por una función

Con el mismo criterio que las tablas del dinero —donde no hay `UPDATE` para
la terminal— **se retira el `UPDATE` directo sobre `usuarios` y sobre
`caja_sesiones`**, y los cambios legítimos pasan por funciones de Postgres
con la forma exacta de la operación:

| Función | Qué hace | Qué rechaza, aunque lo pida la credencial legítima |
|---|---|---|
| `sincronizar_usuario(fila jsonb)` | Inserta o actualiza **un** usuario, y en la **misma transacción** inserta el asiento de `auditoria_log` que vino en el lote | Cambiar `id` o `creado_en`. Un `rol` que no sea `venta` ni `administrativo`. **Dejar cero administradores activos**: el mismo invariante que `ServicioDeUsuarios` protege localmente (§4.7), ahora también en la nube. Una fila sin su asiento de auditoría. |
| `sincronizar_apertura_de_caja(lote jsonb)` | Inserta la caja y su desglose de apertura | Una caja que ya exista |
| `sincronizar_cierre_de_caja(lote jsonb)` | **La única transición permitida**: `abierta` → `cerrada`, con los montos, el desglose de cierre y la auditoría | Cerrar una caja que ya está cerrada. Cambiar `monto_inicial`, `usuario_id` o `abierta_en`. **Reescribir los números de un cierre ya hecho: no hay ninguna función que lo haga.** |

**Por qué `SECURITY DEFINER` y no `SECURITY INVOKER`, dicho con cuidado.**
Una función `INVOKER` corre como quien la llama, así que RLS le aplica
adentro: si la terminal no tiene política de `UPDATE` sobre `usuarios`, la
función tampoco puede actualizar. No sirve para restringir; solo para
agrupar. Una función `DEFINER` corre con los privilegios de su dueño, el
dueño de la tabla, que pasa por encima de RLS: **la función se vuelve la
única puerta, y la forma de la puerta es la política.** Es exactamente lo que
hace falta acá, y exactamente lo que hay que hacer con cuidado:

| Endurecimiento obligatorio | Por qué |
|---|---|
| `SET search_path = ''` en la definición | Sin esto, quien llama puede hacer que la función resuelva un nombre de tabla hacia otro esquema. Es la misma corrección que ya se le hizo a `auditoria_log_es_inmutable` (§4.4). |
| `REVOKE EXECUTE ... FROM public, anon` y `GRANT EXECUTE ... TO authenticated` | La llave publicable no debe poder ni llamarla. |
| La primera línea comprueba `(select auth.jwt() -> 'app_metadata' ->> 'rol') = 'terminal'` y falla si no | Que `authenticated` pueda ejecutarla no significa que cualquier usuario autenticado pueda: adentro se exige el rol de terminal, y tu usuario de restauración **no** lo tiene. |
| Nombres de tabla calificados con esquema (`public.usuarios`) | Consecuencia del `search_path` vacío. |
| Nunca `EXECUTE` con texto armado desde el payload | El payload es entrada no confiable, igual que un payload de IPC (§5). |
| **El linter de seguridad de Supabase va a listar cada una de estas funciones como `SECURITY DEFINER` ejecutable por `authenticated`**, igual que hoy lista `rls_auto_enable()` | Es esperado y hay que anotarlo en §4.4 como aviso conocido, con la razón, para que nadie lo «corrija» quitándole el `DEFINER`. |

> **COMO QUEDÓ CONSTRUIDO (fase 2.b, migración `0023`).** Las firmas son
> `(lote jsonb, version_de_contrato integer)` y devuelven una constancia por
> fila. Son **cinco** funciones de escritura, no tres: a las de esta tabla se
> sumaron `sincronizar_venta` (DEFINER, ver 4.3) y `sincronizar_lote_simple`
> (ver «Qué queda igual», más abajo), por el resultado del riesgo 8.4. Los seis
> puntos del endurecimiento están confirmados en el catálogo, punto por punto,
> más uno que Julio exigió: **lista cerrada de tablas admitidas por función**.
> El linter dio exactamente los cinco avisos previstos y ninguno de
> `search_path`. `caja_sesion_denominaciones` viaja dentro de la apertura y del
> cierre. Detalle en CLAUDE.md §4.20.

**Lo que estas funciones logran, y lo que no.** El ladrón tiene la misma
credencial que la terminal legítima, así que puede llamar a las mismas
funciones. Lo que **no** puede: reescribir un cierre de caja, dejar la
tienda sin administradores, ni tocar `usuarios` sin dejar `recibido_en` y un
asiento. Lo que **sí** puede todavía: promover a un cajero o insertar un
administrador. **Eso no se puede impedir con una credencial compartida; se
puede detectar sin excepción**, y por eso 6.5 obliga a revisar uno por uno a
todo usuario con `recibido_en` posterior al robo, y a resetear todos los PIN.

**Un efecto lateral que mejora otro riesgo.** Sin `UPDATE` directo sobre
`usuarios`, la terminal ya no necesita `SELECT` sobre `usuarios` (2.3): la
función lee por su cuenta. Es decir, **la credencial de la terminal deja de
poder leer los hashes de PIN desde la nube**, que era la mitad del riesgo 8.2.

##### Qué queda igual, y por qué

> **SUPERADO por la medición del riesgo 8.4 (fase 2.b).** El catálogo, los
> topes, la configuración y los recibos **también** suben por función,
> `sincronizar_lote_simple`, con lista cerrada y regla de conflicto por tabla.
> La razón no es la que este párrafo descartaba —proteger datos de bajo
> valor— sino que el upsert directo exigía darle `SELECT` a la terminal sobre
> `auditoria_log`, que va en todos los lotes. Lo de abajo se conserva como
> historia del razonamiento.

`categorias`, `productos`, `precios_especiales`, `limites_descuento` y
`configuracion_negocio` conservan `UPDATE` directo. Son el catálogo: de bajo
valor para un atacante, fáciles de volver a cargar, y con `recibido_en` toda
modificación posterior al robo queda listada para revisión. Llevarlas también
a funciones es posible —sección 7, decisión 14— pero multiplica las funciones
que hay que mantener (sección 9) para proteger datos que no lo necesitan.

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
5. Aplicar, en este orden y cada una con su SQL a la vista y tu aprobación:
   `0018` con `recibido_en` y su trigger en las 13 tablas (1.5.1); `0019` con
   las funciones de escritura y su endurecimiento (1.5.1 y 4.3); `0020` con
   las políticas RLS de la sección 2.3; `0021` con los buckets y políticas de
   Storage de la sección 2.5. Las políticas van después de las funciones a
   propósito: mientras no haya políticas, nada escribe, y así la ventana en
   la que la nube acepta escrituras es la última en abrirse.

---

## 2. Qué se sincroniza y en qué dirección

### 2.1 Lista definitiva, leída del catálogo real de `pos-jimmy-cano`

**Las 13 tablas espejadas**, con lo que este diseño necesita saber de cada
una:

| Tabla | ¿Cambia después de creada? | ¿Tiene `actualizado_en`? | Cómo se sube | Unidad de trabajo |
|---|---|---|---|---|
| `usuarios` | Sí: nombre, rol, activo. **El PIN cambia localmente pero, si se adopta la decisión 17, su hash no viaja** | Sí | Insertar y actualizar, **solo por función** (1.5.1) | Sola, con su asiento de auditoría en la misma llamada |
| `categorias` | Sí | Sí | Insertar y actualizar | Sola |
| `productos` | Sí: catálogo, **inventario**, contadores | Sí | Insertar y actualizar | Sola, **y también dentro de cada venta** (el inventario baja) |
| `precios_especiales` | Sí | Sí | Insertar y actualizar | Sola |
| `limites_descuento` | Sí | Sí | Insertar y actualizar | Sola |
| `configuracion_negocio` | Sí, la única fila | Sí | **Solo actualizar** (la fila `'unica'` ya existe en la nube desde la 0016) | Sola |
| `denominaciones` | No. Las 11 son fijas | Sí, pero irrelevante | **No se sube.** Ya están en la nube con los mismos UUID, sembradas por la 0004 | — |
| `caja_sesiones` | Sí: se abre, después se cierra | Sí | Insertar al abrir y **una sola transición** al cerrar, **solo por función** (1.5.1) | Con su desglose y su auditoría |
| `caja_sesion_denominaciones` | No | **No** | Solo insertar, dentro de la función de la caja | Con la caja |
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

**SUPERADA EN LA FASE 2.b, POR LA MEDICIÓN DEL RIESGO 8.4. La tabla vigente es
esta; la original queda más abajo como historia del razonamiento.**

| Tabla | INSERT / UPDATE / DELETE (terminal) | SELECT (terminal) | SELECT (restauración) | Único camino de escritura |
|---|---|---|---|---|
| `usuarios` | nadie | nadie | `R` (2.c) | `sincronizar_usuario` |
| `categorias` | nadie | nadie | `R` (2.c) | `sincronizar_lote_simple` |
| `productos` | nadie | nadie | `R` (2.c) | `sincronizar_lote_simple` y `sincronizar_venta` |
| `precios_especiales` | nadie | nadie | `R` (2.c) | `sincronizar_lote_simple` |
| `limites_descuento` | nadie | nadie | `R` (2.c) | `sincronizar_lote_simple` |
| `configuracion_negocio` | nadie | nadie | `R` (2.c) | `sincronizar_lote_simple`, solo `actualizar` |
| `denominaciones` | nadie | nadie | `R` (2.c) | ninguno: la sembró la `0004` y nunca cambia |
| `caja_sesiones` | nadie | nadie | `R` (2.c) | `sincronizar_apertura_de_caja` y `sincronizar_cierre_de_caja` |
| `caja_sesion_denominaciones` | nadie | nadie | `R` (2.c) | las dos de caja |
| `ventas` | nadie | nadie | `R` (2.c) | `sincronizar_venta` |
| `venta_detalle` | nadie | nadie | `R` (2.c) | `sincronizar_venta` |
| `recibos` | nadie | nadie | `R` (2.c) | `sincronizar_lote_simple`, solo `insertar` |
| `auditoria_log` | nadie, y además el trigger | nadie | `R` (2.c) | las cinco, siempre con `DO NOTHING` |

`R` sigue siendo la condición del rol restauración de 1.2, y es **la única
política que la fase 2.c va a crear**. Para el rol terminal no habrá ninguna
política sobre ninguna tabla: `pg_policies` tiene que seguir sin una sola fila
que nombre a la terminal, hoy y después de 2.c. `EXECUTE` sobre las cinco
funciones de escritura lo tiene `authenticated`, y adentro cada función exige
el claim `rol = 'terminal'`; los ayudantes internos no son ejecutables ni por
`authenticated`. Se midió en el proyecto de pruebas: sin políticas, la terminal
no lee, no actualiza ni borra nada directamente —lista vacía, cero filas
afectadas, `42501` al insertar—, aunque acabe de escribir por función.

**Lo que hoy frena a la terminal en el real es RLS, no la ausencia de GRANT, y
hay que decirlo.** Leído del catálogo de los dos proyectos el 2026-09-12: `anon`
y `authenticated` tienen, por omisión de Supabase, los OCHO privilegios de tabla
de Postgres 17 —`SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`
y `MAINTAIN`— sobre las trece tablas, y los privilegios por omisión
(`pg_default_acl`) conceden lo mismo a toda tabla nueva. Es una sola capa, y
`TRUNCATE` ni siquiera pasa por RLS. **La fase 2.c agrega la segunda capa** con
la migración `0024`, **ya aplicada y medida en `pos-pruebas-descartable` el
2026-09-12**: `REVOKE ALL` a `anon` y a `authenticated` sobre las trece tablas,
seguido de `GRANT SELECT` a `authenticated`, y lo mismo en los privilegios por
omisión para las tablas futuras. Se escribe `REVOKE ALL` y no una lista de
privilegios a propósito: la primera versión enumeraba seis y dejaba `MAINTAIN`
—nuevo en PG17, invisible en `information_schema` y visible en `pg_class.relacl`
como la letra `m`— puesto; con `REVOKE ALL` no puede escaparse ninguno, ni uno
que Postgres agregue mañana. `SELECT` se conserva concedido a `authenticated`
porque restauración y terminal son el MISMO rol de Postgres —el rol del diseño
es un claim del JWT, no un rol de la base— y es la política `R` la que decide
quién lo ejerce. Las funciones `SECURITY DEFINER` no dependen de nada de esto:
corren como `postgres`, el dueño de las tablas. Lo que la `0024` NO puede cubrir
es el `pg_default_acl` del rol de plataforma `supabase_admin`, que `postgres` no
es miembro y no puede alterar; no afecta a este esquema, cuyas trece tablas y
migraciones corren como `postgres`.

Hoy las 13 tablas tienen RLS activo y **cero políticas**: nadie puede leer ni
escribir, y eso es correcto hasta que exista esto. Las políticas van en una
migración nueva, `0020_politicas_de_sincronizacion` (1.7), y son estas. `T` es la
condición del rol terminal de la sección 1.2; `R` la del rol restauración.

| Tabla | `INSERT` (terminal) | `UPDATE` (terminal) | `SELECT` (terminal) | `SELECT` (restauración) | `DELETE` |
|---|---|---|---|---|---|
| `usuarios` | **nadie: por función** (1.5.1) | **nadie: por función** | **nadie** | `R` | nadie |
| `categorias` | `T` | `T` | `T` | `R` | nadie |
| `productos` | `T` | `T` | `T` | `R` | nadie |
| `precios_especiales` | `T` | `T` | `T` | `R` | nadie |
| `limites_descuento` | `T` | `T` | `T` | `R` | nadie |
| `configuracion_negocio` | nadie (la fila existe) | `T` | `T` | `R` | nadie |
| `denominaciones` | nadie | nadie | nadie | `R` | nadie |
| `caja_sesiones` | **nadie: por función** (1.5.1) | **nadie: por función** | **nadie** | `R` | nadie |
| `caja_sesion_denominaciones` | **nadie: por función** (va con la caja) | **nadie** | nadie | `R` | nadie |
| `ventas` | `T` | **nadie, hoy** | nadie | `R` | nadie |
| `venta_detalle` | `T` | **nadie** | nadie | `R` | nadie |
| `recibos` | `T` | **nadie, hoy** | nadie | `R` | nadie |
| `auditoria_log` | `T` | **nadie, y además el trigger** | nadie | `R` | nadie |

Cuatro cosas de esta tabla que no son obvias:

- **`UPDATE` arrastra `SELECT`.** La documentación de Supabase es explícita:
  «para hacer un `UPDATE` hace falta una política de `SELECT`
  correspondiente; sin ella no funciona como se espera». Por eso las tablas
  que la terminal actualiza **directo** también las puede leer. Es un costo
  real en el escenario del robo, y es la razón por la que `usuarios` y
  `caja_sesiones` **salieron** de la columna de `UPDATE` directo (1.5.1): al
  escribirse por función, la terminal ya no las lee, y **los hashes de PIN
  dejan de ser legibles con la credencial de la terminal**.
- **Las filas marcadas «por función» no tienen ninguna política para la
  terminal.** Las escribe una función `SECURITY DEFINER` (1.5.1 y 4.3) que
  pasa por encima de RLS con la forma exacta de cada operación. La tabla de
  arriba es literalmente lo que un `SELECT * FROM pg_policies` tiene que
  devolver para el rol terminal: nada sobre esas tablas.
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

> **COMO QUEDÓ CONSTRUIDO.** Las tres variantes de la tabla de abajo existen,
> pero **todas dentro de las funciones**: `escribir_fila` recibe por
> parámetro `'actualizar'` (DO UPDATE) o `'ignorar'` (DO NOTHING) y cada
> función lo decide POR TABLA; no hay upsert directo por PostgREST, porque el
> riesgo 8.4 resultó real. La regla de `auditoria_log` —siempre DO NOTHING—
> se cumple en las cinco funciones y se comprobó como control que un DO UPDATE
> dispara el trigger. La idempotencia es la de esta sección, con una
> precisión: repetir el MISMO lote devuelve `sin_cambios`/`ya_existia` con la
> misma huella; OTRO lote con el mismo id se rechaza (CLAUDE.md §4.20).

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
| **Actualizar si existe** (`ignoreDuplicates: false`) | `ON CONFLICT (id) DO UPDATE SET ...` | `categorias`, `productos`, `precios_especiales`, `limites_descuento`, `configuracion_negocio` | Cambian después de creadas. Se manda la fila completa y gana la de la terminal, que es la única fuente de verdad. |
| **Por función**, con el `ON CONFLICT` adentro | El que corresponda, dentro de la función | `usuarios`, `caja_sesiones`, `caja_sesion_denominaciones` | No hay upsert directo (1.5.1). La función hace exactamente lo mismo que las dos filas de arriba, pero además exige la forma de la operación: una transición, un invariante, un asiento. **La idempotencia es la misma**: reintentar la llamada con el mismo lote termina en el mismo estado. |

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

> **COMO QUEDÓ CONSTRUIDO.** Opción B para la venta, la apertura y el cierre,
> como recomienda esta sección, **y además para todo lo demás**
> (`sincronizar_lote_simple`), porque el riesgo 8.4 impidió los upserts
> directos. Y **`sincronizar_venta` es `SECURITY DEFINER`, no INVOKER** como
> dice la fila «RLS» de la tabla: como INVOKER, el `DO NOTHING` de `ventas`
> exigiría `SELECT` a la terminal. Con eso, las cinco funciones de escritura
> llevan el mismo endurecimiento de 1.5.1.

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
| RLS | Se aplica petición por petición | Depende de la función. La de **venta** puede ser `SECURITY INVOKER`: solo inserta en tablas donde la terminal ya tiene `INSERT` y actualiza `productos`, donde ya tiene `UPDATE`; RLS le aplica adentro y no gana ningún privilegio. Las de **apertura y cierre de caja** y la de **usuario** tienen que ser `SECURITY DEFINER`, porque son la única puerta a tablas sin política (1.5.1), con todo el endurecimiento de esa sección |
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
   cuando el esquema cambie hay que actualizarla. **Que ese cambio falle
   ruidoso en una prueba y no en la primera venta real es el tema de la
   sección 9 entera.**
4. **Con 1.5.1 la opción B dejó de ser opcional para la caja.** `caja_sesiones`
   ya no tiene `UPDATE` directo, así que el cierre **solo** puede subir por
   función. La venta podría seguir siendo la opción A; se recomienda que no,
   por las razones 1 y 2.

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

**EL RESET DE PIN ES AUTOMÁTICO, SIEMPRE, SIN PREGUNTAR.** Toda restauración
—por robo, por falla, por reemplazo— termina con **todos los PIN reseteados y
todos los PIN remotos borrados**, y ningún usuario puede entrar a la terminal
nueva hasta recibir un PIN nuevo desde la pantalla de usuarios. No depende de
ninguna marca que ponga quien restaura, y las razones para no dejarlo a
elección son cuatro:

1. **«Falla» no es «no expuesto».** Una computadora que falló va a un taller,
   o se guarda en un cajón, o se vende. En cualquiera de esos caminos alguien
   tiene el disco, y en el disco están los hashes, y un PIN de cuatro dígitos
   se fuerza en minutos (8.2). La única situación en que los hashes no están
   expuestos es que el disco haya sido destruido físicamente, y quien restaura
   no puede saberlo con certeza.
2. **Cuesta minutos.** La tienda tiene dos o tres usuarios. Ponerles PIN nuevo
   es menos trabajo que decidir si hacía falta.
3. **Le quita una decisión a alguien que está restaurando bajo presión**, y
   una decisión que, si se toma mal, deja a un tercero con acceso de
   administrador.
4. **Quita una rama del código.** Una restauración que a veces resetea y a
   veces no es dos restauraciones que probar.

La pregunta «¿es un robo?» **sigue existiendo en 6.2, pero para otra cosa**:
sirve para fechar la revisión de lo que el ladrón pudo escribir en la nube
(6.5). No gobierna el reset.

**Consecuencia que mejora otro riesgo:** si la terminal restaurada **nunca**
confía en los hashes que vienen de la nube, **no hay motivo para que estén
en la nube**. La sección 7, decisión 17, propone dejar de sincronizar
`pin_hash` y `pin_remoto_hash` y quitarlos de Postgres, lo que cierra el
riesgo 8.2 entero.

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
| **Se sabe por qué se restaura** | La pantalla pregunta: ¿falla del equipo, o robo? Si es robo, pide **la fecha y hora aproximadas** del robo. **Esta pregunta solo fecha la revisión de 6.5; el reset de PIN no depende de ella, es siempre (6.1).** | Sin esa fecha no se puede filtrar lo que el ladrón hizo (6.5). Ante la duda, se elige robo y una fecha anterior: sobra revisión, no falta. |

**La credencial de restauración no se guarda.** Es una sesión que vive
mientras la pantalla está abierta y se cierra al terminar, con `signOut`.
Nunca toca `safeStorage`. Es la diferencia de alcance de la sección 1.2
llevada hasta el final: lo que puede leer todo no se queda en la máquina.

### 6.3 Qué trae, y en qué orden

**El orden es el del grafo de llaves foráneas de Postgres, leído hoy del
catálogo**: cada tabla después de las que referencia.

| Paso | Tabla | Referencia a | Qué se hace con lo que ya existe localmente |
|---|---|---|---|
| 1 | `usuarios` | — | Insertar. `intentos_fallidos = 0`, `bloqueado_hasta = NULL`: esas columnas no vienen de la nube y no deben venir. **Siempre, en toda restauración (6.1): `pin_hash` se escribe con un centinela que no coincide con ningún PIN y que `verificarPin` rechaza sin lanzar, `pin_remoto_hash` queda en `NULL`, y todo usuario tiene que recibir un PIN nuevo desde la pantalla de usuarios antes de poder entrar.** Si la decisión 17 se adopta, los hashes ni siquiera vienen de la nube. |
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
| Filas con **`recibido_en`** posterior a la fecha del robo, en cualquiera de las 13 tablas | Lo que el ladrón insertó **o modificó** con la credencial antes de la revocación (1.5). Se filtra por `recibido_en`, la marca del servidor, **nunca por `creado_en` ni `actualizado_en`**, que vienen del cliente y el ladrón las elige (1.5.1). | Se muestra aparte, **sin restaurar**, para que decidas fila por fila. Para una fila modificada no hay valor anterior que mostrar: solo que fue tocada, cuándo, y por qué usuario de Auth. |
| **Cualquier usuario con `recibido_en` posterior al robo** | Un cajero promovido, un administrador desactivado o renombrado, un administrador nuevo | **Revisión obligatoria, uno por uno, antes de terminar.** Es la única defensa contra lo que 1.5.1 admite que no se puede impedir. |
| **Ningún administrador activo** después de aplicar lo revisado | El ladrón desactivó a todos, o vos rechazaste al único que quedaba | La restauración **no termina** hasta que haya al menos uno: ofrece reactivar a un administrador existente, y ese administrador recibe su PIN nuevo ahí mismo. Es el mismo invariante de §4.7, aplicado en el único momento en que la tabla podría quedar sin él. |
| **PIN sin resetear** | — | No es una anomalía que se busque: es un paso que **no se puede saltar, en ninguna restauración** (6.1). La pantalla no da por terminada la restauración mientras algún usuario activo siga sin PIN nuevo. |
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

> **TODAS CONTESTADAS el 2026-09-11.** Quedan adoptadas con la recomendación
> del documento, salvo dos: la **10** se resolvió retirando `traerCambios` de
> `SyncProvider` —hecho en la fase 1.b— y la **11** queda ABIERTA hasta medir
> en hardware real (fase 3). La lista se conserva tal como se escribió, con su
> numeración, para que las respuestas se puedan cotejar contra lo que se
> preguntó. Ver CLAUDE.md §4.17.

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
12. **`recibido_en` con trigger en las 13 tablas**, solo en la nube, como la
    única fecha que la restauración usa para detectar lo que hizo el ladrón
    (1.5.1). Recomendación: sí, y es la más importante de esta segunda
    ronda: sin ella la detección de 6.5 no vale nada.
13. **`usuarios` y `caja_sesiones` sin `UPDATE` directo; se escriben por
    funciones `SECURITY DEFINER` endurecidas** (1.5.1). Recomendación: sí.
    Trae consigo que el linter de Supabase liste esas funciones como aviso,
    igual que hoy lista `rls_auto_enable()`, y hay que anotarlo.
14. **¿También el catálogo por funciones?** `categorias`, `productos`,
    `precios_especiales`, `limites_descuento` y `configuracion_negocio`
    conservan `UPDATE` directo (1.5.1). Recomendación: dejarlos así por ahora;
    son de bajo valor, se detectan con `recibido_en`, y cada función más es
    más superficie que mantener (sección 9). **SUPERADA por la medición de
    8.4 (fase 2.b): sí van por función, `sincronizar_lote_simple`, porque el
    upsert directo exigía `SELECT` sobre `auditoria_log`.**
15. **Toda restauración resetea todos los PIN y borra los remotos,
    automáticamente y sin preguntar** (6.1). No depende de marcar «robo»: esa
    marca solo fecha la revisión de 6.5. Recomendación: sí. Un disco que
    falló también puede estar en manos de un tercero.
16. **Las funciones se prueban en un proyecto de Supabase SEPARADO y
    descartable, nunca contra `pos-jimmy-cano`** (9.5). Recomendación: sí.
    **Lo que hace falta decidir es qué proyecto pausar**: la organización ya
    tiene los dos proyectos activos que permite el plan gratuito, y uno de
    ellos, `dembow-ay-lupita`, es ajeno a este trabajo. Sin pausarlo no se
    puede crear el de pruebas. **HECHO el 2026-09-11:** se pausó
    `dembow-ay-lupita` y se creó `pos-pruebas-descartable`
    (`ztidrshifrblhfraiowg`).
17. **Dejar de sincronizar `pin_hash` y `pin_remoto_hash`, y quitar las dos
    columnas de Postgres con una migración.** Consecuencia directa de la
    decisión 15: si la terminal restaurada nunca confía en los hashes de la
    nube, no hay ninguna razón para que la nube los tenga, y el riesgo 8.2
    desaparece entero, incluida tu propia cuenta. Cuesta una migración —hoy
    `pin_hash` es `NOT NULL` con CHECK en la 0001 y `pin_remoto_hash` llegó en
    la 0005— y cambia el payload de `sincronizar_usuario`. Recomendación:
    sí. Si algún día multi-sucursal necesitara compartir PIN entre cajas, es
    un diseño propio con su propia decisión, no una razón para guardarlos
    hoy.

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

¿Quién puede leerla? **Ya no la terminal**: con 1.5.1, `usuarios` se escribe
por función y la terminal no tiene `SELECT` sobre ella (2.3), así que una
credencial de terminal filtrada **no** puede leer los hashes desde la nube.
Queda **tu usuario de restauración**, que lee todo. El riesgo pasó de dos
puertas a una, y esa una es tu cuenta de Supabase.

**Y con la decisión 17 se cierra del todo**: como toda restauración resetea
los PIN sin mirar la nube (6.1), los hashes no tienen ninguna función allá.
Si se dejan de sincronizar y se quitan de Postgres, no hay nada que leer. Las
tres opciones de arriba quedan como registro de por qué se llegó a esa
conclusión; la primera —«no sincronizar los hashes»— es la que se recomienda,
y su costo, «reconstruir los PIN a mano tras restaurar», ya es obligatorio por
6.1 de todos modos.

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

### 8.4 `ON CONFLICT DO NOTHING` bajo RLS — MEDIDO: SÍ exige `SELECT`. Resuelto cambiando el diseño

**Medido el 2026-09-11 en el proyecto de pruebas, como `authenticated` con los
claims de la terminal, en SQL directo (`SET LOCAL ROLE authenticated` más
`request.jwt.claims`) y confirmado por PostgREST.** Con una política de solo
`INSERT`, `INSERT ... ON CONFLICT (id) DO NOTHING` falla con `42501` («new row
violates row-level security policy») **aunque no haya ningún conflicto**; con
`INSERT` + `SELECT` pasa; `DO UPDATE` exige además `UPDATE`. La semántica que
esta sección asumía era falsa.

La consecuencia era la que el párrafo original anticipaba: para reintentar
sobre `ventas`, `venta_detalle`, `recibos` y —peor— `auditoria_log`, que va en
**todos** los lotes, la terminal habría necesitado `SELECT` sobre las tablas
del dinero y de la auditoría, que es justo lo que 1.5 evita. Se detuvo la
implementación, se avisó, y Julio aprobó la otra salida: **todo lote sube por
una función `SECURITY DEFINER`** (las tres de 1.5.1, `sincronizar_venta` como
DEFINER y una nueva `sincronizar_lote_simple` para el resto), **y la terminal no
tiene política directa sobre ninguna tabla.** Riesgo cerrado; la tabla de 2.3
quedó reducida a `SELECT` para restauración.

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

### 8.9 Las funciones `SECURITY DEFINER` son la superficie más delicada del diseño

> **Estado tras la fase 2.b:** son **cinco** de escritura (usuario, apertura,
> cierre, venta y lote simple); el contrato de 9.2 quedó como `SECURITY
> INVOKER` porque solo lee `pg_catalog`. El linter del proyecto de pruebas
> lista exactamente esos cinco avisos y ninguno de `search_path`; CLAUDE.md
> §4.4 y §4.20 dicen que son esperados y que no se «corrigen». Dónde se
> probaron: `npm run verify:nube -- --destructivo`, 67 comprobaciones contra
> el proyecto descartable, más 91 mediciones en SQL directo.

Con 1.5.1 hay cuatro funciones que pasan por encima de RLS: usuario,
apertura, cierre y el contrato de 9.2. Un error en cualquiera es un error con
privilegios de dueño de tabla. El endurecimiento de 1.5.1 es una lista, y una
lista se puede cumplir a medias. **Dónde se prueban ya tiene respuesta:** un
proyecto separado y descartable (9.5), nunca el real. Lo que sigue abierto es
lo que 9.5 dice al final: que ese proyecto solo puede existir activo si se
pausa otro, y que hay que aceptar que el linter de Supabase va a mostrar
estas funciones como avisos permanentes, con el riesgo de que alguien, dentro
de un año, «los arregle» quitando el `DEFINER` y dejando la cola detenida sin
entender por qué.

### 8.10 Restaurar sobre una terminal que ya tiene datos

Excluido a propósito (6.1). Pero el caso existe: la terminal no se perdió,
solo se corrompió el archivo SQLite, y hay ventas de esta mañana que no
llegaron a subir. Restaurar desde la nube las pierde; no restaurar deja la
base corrupta. La respuesta correcta es un **respaldo local** independiente
—copia del archivo SQLite a otro disco o USB cada noche—, que es el pendiente
11 de §6.2 y que este documento no cubre. Conviene decidirlo junto con esto.

---

## 9. Deriva entre el servicio local y las funciones de Postgres

Las funciones de la opción B (4.3) y las de 1.5.1 viven en otro lenguaje y en
otro lugar que la lógica que ya existe en la terminal. El día que una
migración local agregue una columna a `ventas` y nadie toque la función,
**la primera venta real que intente subir va a fallar**, o peor, va a subir
sin esa columna y nadie se va a enterar. Esta sección diseña cómo eso falla
antes, en una prueba, y con el nombre de la columna.

### 9.1 Primero: reducir lo que puede derivar

La deriva se detecta mejor cuando hay poco que derive. Tres reglas de diseño
para las funciones, antes de cualquier prueba:

| Regla | Qué evita |
|---|---|
| **Las funciones no calculan nada de negocio.** No redondean, no suman, no reparten centavos, no evalúan topes. Reciben valores finales, ya calculados por el servicio local con Decimal, y los escriben. Lo único que deciden es estructural: el orden de inserción, un `ON CONFLICT`, una transición (`abierta` → `cerrada`), un invariante (queda un administrador activo). | Que exista una segunda implementación de la aritmética del proyecto. Con una sola, no hay dos versiones que puedan discrepar. Es la misma razón por la que el descuento vive en `@shared/descuento` y no en dos capas (§5). |
| **Las funciones no enumeran columnas.** Escriben con `jsonb_populate_record(NULL::public.ventas, fila)`, que asigna cada clave del JSON a la columna del mismo nombre **leyendo la definición real de la tabla en el momento de ejecutar**. | Que una columna nueva en la tabla exija tocar la función: no la exige. Lo que sí queda como riesgo es el silencio: una clave que la tabla no tiene **se ignora sin error**, y eso es exactamente lo que la prueba de 9.2 tiene que atrapar. |
| **Cada función lleva un número de versión de contrato**, y cada lote lleva el que la terminal espera. Si no coinciden, la función falla con un error que dice los dos números. | Que la terminal y la nube cambien por separado. Es un error determinístico (3.2): detiene la cola y se ve. |

### 9.2 La prueba de deriva, en dos mitades

> **COMO QUEDÓ CONSTRUIDO.** Mitad A: `src/main/database/__tests__/deriva-de-esquema.test.ts`,
> 54 pruebas, en cada `npm test`. Mitad B: `npm run verify:nube` (sin
> argumentos). Dos diferencias con lo escrito abajo, a propósito:
> `contrato_de_sincronizacion()` es `SECURITY INVOKER` —solo lee
> `pg_catalog`— y **la foto no se regenera sola cuando coincide**: se toma con
> `--tomar-foto` y se revisa en el commit, para que un cambio hecho desde el
> panel nunca entre a la foto sin que alguien lo lea. Las exclusiones de la
> mitad A salen de `COLUMNAS_EXCLUIDAS` de la bandeja de salida —la misma
> lista que arma los payloads— y de `recibido_en`. Se comprobó que las dos
> mitades muerden con la foto manipulada de 9.3.

Hay una regla del proyecto que condiciona el diseño: **las pruebas no dependen
de que Supabase esté disponible ni consumen su cuota** (CLAUDE.md §4, punto
4). Así que una sola prueba contra el catálogo real no puede vivir en
`npm test`. Se parte en dos, y cada mitad atrapa una forma distinta de
deriva:

```
   esquema local (SQLite)  ──(A: npm test, sin red)──►  supabase/esquema-nube.json
                                                              │
                                                    (B: npm run verify:nube, con red)
                                                              ▼
                                                     catálogo real de pos-jimmy-cano
```

**Mitad A — sin red, en cada `npm test`.** Se agrega al repositorio un archivo
`supabase/esquema-nube.json`: **la foto del catálogo real**, con las 13
tablas, sus columnas, tipos y nulabilidad, las funciones de sincronización con
su versión de contrato, y qué tablas escribe cada una. La prueba compara ese
archivo con el esquema local que sale de aplicar las 17 migraciones (con
`PRAGMA table_info`, como ya hace `checks-con-null.test.ts`), aplicando las
exclusiones **explícitas y listadas** —`sync_cola` y `bloqueos_de_autorizacion`
enteras, `usuarios.intentos_fallidos` y `bloqueado_hasta`, `recibido_en` del
lado de la nube— y falla si:

- una columna existe de un lado y no del otro, **nombrándola**;
- una columna es nulable de un lado y `NOT NULL` del otro;
- una tabla que la foto dice que escribe una función tiene columnas que el
  payload local de esa operación no manda, o al revés;
- la versión de contrato que espera el código local no es la de la foto.

Es la mitad que atrapa **«cambié el esquema local y no el espejo»**, que es el
caso frecuente, y lo atrapa sin red, en el mismo `npm test` de siempre.

**Mitad B — con red, a mano: `npm run verify:nube`.** Un guion como
`verify:pantallas`, que se corre **antes de cada aplicación de migración en la
nube y después**, y antes de cada entrega. Llama a una función
`contrato_de_sincronizacion()` en la nube —`SECURITY DEFINER`, endurecida
como las demás, ejecutable solo con el rol `restauracion`— que devuelve
`information_schema.columns` de las 13 tablas y `pg_proc` de las funciones,
y la compara con `supabase/esquema-nube.json`. Si difieren, imprime la
diferencia y sale con código 1; si coinciden, **regenera la foto** para que
la mitad A trabaje contra el catálogo de hoy. Es la mitad que atrapa
**«cambié la nube y no la foto»**, y también «alguien tocó la nube desde el
panel sin migración».

**Por qué no una sola prueba con red.** Porque entonces `npm test` fallaría
sin internet, y un desarrollador sin conexión no podría saber si rompió algo.
Y porque una prueba que necesita credenciales de la nube en la máquina de
desarrollo es una credencial más que cuidar. La foto en el repositorio es
la separación: la mitad A no necesita nada, la mitad B se corre cuando se
toca la nube.

### 9.3 Cómo se comprueba que la prueba muerde

Igual que con `checks-con-null.test.ts`: **una comprobación que nunca se vio
fallar no prueba nada** (§4.11). Al implementarla, hay que reintroducir a
propósito cada tipo de deriva y ver la prueba fallar con el nombre correcto:

| Deriva reintroducida a propósito | Qué tiene que decir la prueba |
|---|---|
| Migración local `ALTER TABLE ventas ADD COLUMN propina TEXT` sin espejo | «`ventas.propina` existe en SQLite y no en la foto de la nube» |
| Editar la foto quitando `ventas.total` | «`ventas.total` existe en SQLite y no en la foto de la nube» |
| Subir el número de contrato en la función sin tocar el cliente | Mitad B: «la nube declara el contrato 3 y la foto dice 2»; y en producción, la cola se detiene con el mismo mensaje (3.2) |
| Quitar `SET search_path = ''` de una función | Mitad B: la foto también guarda `proconfig` de cada función, y la compara |

### 9.4 Qué NO detecta esto, dicho para no confiar de más

- **Un cambio de significado sin cambio de esquema.** Si `subtotal_impreso`
  pasara a significar otra cosa manteniendo el nombre y el tipo, ninguna
  prueba de columnas lo ve. La defensa contra eso es la regla 9.1: las
  funciones no interpretan valores, los copian; el significado vive en un
  solo lugar, el servicio local.
- **Un cambio en los CHECK de Postgres.** La foto podría incluirlos, y es
  barato agregarlo, pero un CHECK nuevo en la nube que rechace un payload
  legítimo se manifiesta igual que cualquier error determinístico: cola
  detenida y visible (3.2). No es silencioso, que es lo que importa.
- **Que la función sea correcta.** Que las columnas coincidan no dice que la
  lógica estructural —la transición de la caja, el invariante de
  administradores— esté bien. Eso lo cubren pruebas propias de cada función,
  corridas con `verify:nube` contra una rama de Supabase o contra el proyecto
  con datos de prueba, que es una decisión de implementación (7, decisión 16).

### 9.5 Dónde se prueban las funciones: un proyecto de Supabase aparte, y qué lo condiciona

**Las cuatro funciones `SECURITY DEFINER`, los triggers de `recibido_en` y las
políticas RLS se prueban contra un proyecto de Supabase SEPARADO y
descartable, nunca contra `pos-jimmy-cano`.** Es la única forma de probarlas
de verdad: hay que insertar, ver qué rechazan, y borrar, y nada de eso puede
ocurrir en el proyecto de la tienda, donde rige «nunca se borra».

#### Lo que se verificó hoy contra la organización real, no contra la página de precios

| Dato | Valor | De dónde sale |
|---|---|---|
| Plan de la organización | **gratuito** | Consultado hoy |
| Proyectos en la organización | **tres**: `pos-jimmy-cano` (activo), `dembow-ay-lupita` (activo, ajeno a este trabajo), `Olam Church` (pausado) | Listado hoy. **Actualizado el 2026-09-11 (fase 2.b):** `Olam Church` ya no existe; `dembow-ay-lupita` está **pausado**; y el tercero es `pos-pruebas-descartable`, activo. Los dos activos son el real y el de pruebas. |
| Costo de crear un proyecto nuevo | **$0 al mes** | La propia API de costos, consultada hoy |
| Límite del plan gratuito | **«Dos proyectos gratuitos activos. Los proyectos pausados no cuentan.»** Y el límite se cuenta sobre todas las organizaciones donde uno es dueño o administrador. | Documentación de facturación, leída hoy |

**La consecuencia, sin rodeos: hoy NO se puede crear un tercer proyecto
activo.** Los dos lugares están ocupados, y uno de ellos lo ocupa un proyecto
que no tiene nada que ver con este. Este documento **no decide** qué hacer con
`dembow-ay-lupita`: no es de este proyecto. Lo que sí deja claro es que sin
un lugar libre no hay proyecto de pruebas, y que las opciones son tres:

| Opción | Qué implica | Cuándo conviene |
|---|---|---|
| **Pausar `dembow-ay-lupita` mientras dure la implementación** | Un clic en el panel; se reanuda igual, dentro de 90 días, con sus datos intactos. Mientras esté pausado no responde. | Si ese proyecto no está en uso activo. Es la opción más simple. |
| **Crear el de pruebas, usarlo, y pausarlo entre sesiones** | Un proyecto pausado no cuenta, así que se puede alternar: reanudar el de pruebas (unos minutos) cuando toca probar, pausarlo al terminar. Pero **para crearlo** hace falta un lugar libre en ese momento, así que igual hay que pausar otro al menos una vez. | Si `dembow-ay-lupita` se usa, pero de forma intermitente. |
| **Plan Pro** | Sin límite de proyectos activos y sin pausado automático. | Ya está previsto antes de la entrega (§3) y el riesgo 8.3 lo vuelve necesario para el proyecto real; adelantarlo resuelve esto de paso. |

#### Cómo se monta y se usa el proyecto de pruebas

1. **Se crea vacío**, en la misma región que el real (`us-east-2`), con un
   nombre que no deje dudas: `pos-pruebas-descartable`.
2. **Se le aplican las mismas migraciones, desde los mismos archivos** de
   `supabase/migrations/`, con la misma herramienta y en el mismo orden que al
   real. No hay un esquema «de pruebas»: hay un solo esquema y dos proyectos.
   La mitad B de 9.2 (`verify:nube`) acepta el proyecto como parámetro y
   comprueba que los dos catálogos coincidan antes de correr nada.
3. **Se le crean los mismos dos roles de Auth** —un usuario terminal y uno de
   restauración, con `app_metadata` como en 1.2— y un tercero que **no** tiene
   rol, para probar que sin rol no se puede nada. Se crean desde tu máquina,
   igual que en 1.3. Su `service_role` tampoco se guarda en el repositorio:
   solo hace falta para crear esos usuarios, una vez.
4. **Las pruebas de las funciones corren ahí, con red, desde
   `npm run verify:nube --destructivo`**, y con un seguro que no es opcional:
   **el guion se niega a correr en modo destructivo contra cualquier proyecto
   cuya referencia no esté en una lista fija de proyectos de prueba**, escrita
   en el propio guion. `zgsdaelmbxufgcsideep`, el real, no está en esa lista
   y no puede estarlo. Equivocarse de proyecto tiene que ser imposible, no
   improbable.

#### Qué prueban esas pruebas, que ninguna prueba local puede probar

> **COMO QUEDÓ CONSTRUIDO.** La batería de `npm run verify:nube -- --destructivo`
> cubre esta tabla con 67 comprobaciones por PostgREST y JWT reales, con dos
> precisiones: la fila del riesgo 8.4 quedó **superada** —se midió que SÍ exige
> `SELECT`, y por eso ya no hay `INSERT` directo que probar—, y la de
> `recibido_en` es más fuerte que lo escrito: un payload que la traiga **se
> rechaza con nombre**, y la que pone el servidor se comprueba en la constancia.
> Sobre «borra lo que insertó»: el reinicio con `service_role` está escrito
> pero no se ejercitó (no hay `service_role` del proyecto de pruebas en la
> máquina), y `auditoria_log` no se puede vaciar por PostgREST porque es
> inmutable: se trunca por SQL. **Con la `0024` aplicada en el proyecto de
> pruebas (2026-09-12), la misma batería sigue dando 67/67 sin cambiar ninguna
> comprobación de función**: solo las sondas de acceso directo pasan de «viola
> RLS» a «permission denied» (403 para la terminal, 401 para la llave
> publicable). Detalle en CLAUDE.md §4.20.

| Qué | Por qué solo se puede probar allá |
|---|---|
| Que el usuario terminal puede llamar a `sincronizar_usuario`, `sincronizar_apertura_de_caja` y `sincronizar_cierre_de_caja`, y que el usuario sin rol y el de restauración **no** | El chequeo de `app_metadata` vive dentro de la función, en Postgres |
| Que la terminal **no** puede hacer `UPDATE` ni `DELETE` directos sobre `usuarios` ni `caja_sesiones`, ni `SELECT` sobre las tablas del dinero | Son las políticas RLS reales, evaluadas por PostgREST |
| Que `sincronizar_cierre_de_caja` rechaza cerrar una caja ya cerrada, y que `sincronizar_usuario` rechaza dejar cero administradores activos | Es la lógica estructural de las funciones |
| Que `recibido_en` queda con la hora del servidor **aunque el payload mande otra** | Es el trigger, y la hora del servidor solo existe allá |
| Que un `INSERT ... ON CONFLICT DO NOTHING` bajo RLS no exige política de `SELECT` | Es el riesgo 8.4, y esta es la prueba que lo cierra |
| Que la llave publicable sola no puede leer ni escribir nada | Es el estado «RLS sin políticas para `anon`» que el proyecto real tiene desde el Prompt 5 |
| Que repetir un lote da el mismo estado (3.1) | Idempotencia real contra Postgres real |

Cada una de estas pruebas **borra lo que insertó** al terminar, y el guion
además vacía las 13 tablas del proyecto de pruebas antes de empezar. Eso es
exactamente lo que no se puede hacer en el real, y por eso el proyecto es
otro.

#### Lo que hay que saber sobre la vida de ese proyecto

- **Se va a pausar solo** a los siete días sin actividad (8.3). Está bien:
  se reanuda antes de probar. Pausado no cuenta contra el límite.
- **A los 90 días pausado, se pierde.** También está bien: no hay nada en él
  que no se pueda recrear desde las migraciones en unos minutos. Es
  descartable por diseño; que se descarte solo no es un problema.
- **No se mezcla con el real ni por accidente**: nombre distinto, referencia
  distinta, lista fija en el guion, y las credenciales de uno no sirven en el
  otro porque Auth es por proyecto.

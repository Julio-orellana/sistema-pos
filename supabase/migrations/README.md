# Migraciones de Supabase (Postgres)

Espejo en la nube del esquema local. **No todo lo que existe en SQLite se
espeja.**

## Qué se espeja y qué no

> **REGLA: la nube lleva DATOS DE NEGOCIO. El estado operativo local de una
> terminal se queda en SQLite.**

| Tabla local | ¿Se espeja? | Por qué |
|---|---|---|
| `usuarios`, `categorias`, `productos`, `precios_especiales`, `limites_descuento`, `caja_sesiones`, `ventas`, `venta_detalle`, `recibos`, `auditoria_log` | **Sí** | Son los datos del negocio: qué se vendió, a qué precio, quién lo hizo. |
| `sync_cola` | **No** | Es la lista local de qué falta subir. Subirla sería subir la lista de pendientes junto con los pendientes. |
| `bloqueos_de_autorizacion` | **No** | Estado de seguridad de **una** terminal, válido durante 30 segundos. Ver abajo. |
| `usuarios.intentos_fallidos`, `usuarios.bloqueado_hasta` | **No** | Mismas razones: son columnas locales de una tabla que sí se espeja. |
| `usuarios.pin_hash`, `usuarios.pin_remoto_hash` | **No, desde la `0021`** | Un PIN de cuatro dígitos tiene 10 000 valores: quien lea esa tabla en la nube los saca todos. Y no hacen falta allá, porque toda restauración resetea los PIN sin mirarlos. Decisión 17. |
| `ventas.estado_sincronizacion` | **No, desde la `0020`** | Dice si ESTA terminal ya subió ESTA venta: estado operativo local. En la nube una fila que está, está sincronizada. Decisión 4. |
| `migraciones_aplicadas` | **No** | Control del migrador local. |

Y al revés, una sola vez: **`recibido_en` existe solo en la nube**, en **doce**
de las trece tablas. No se espeja hacia SQLite y no puede: es la hora del
servidor, y su razón de ser es ser la única fecha que el cliente no controla.
Ver la dirección 2 de los huecos, más abajo.

**La tabla número trece, `denominaciones`, NO la lleva**, y no es una excepción
arbitraria: es que ahí no hay nada que detectar. `recibido_en` existe para
delatar lo que escribió un cliente comprometido, y en `denominaciones` no hay
ningún cliente que escriba. Sus once filas las sembró la migración `0004` en la
nube, con los mismos UUID que el esquema local, y la sección 2.1 del diseño la
marca como «**No se sube.** Ya están en la nube con los mismos UUID». La bandeja
de salida la deja fuera de las tablas sincronizables desde la fase 1.a, con una
prueba que comprueba que nunca se encola. Una columna `recibido_en` allí no
contestaría «¿cuándo recibimos esta fila?» sino «¿cuándo corrió la migración?»,
que es otra pregunta y ya la contesta el registro de migraciones de Supabase.

## Por qué el estado de bloqueo no sube a la nube

1. **Es efímero.** Una fila de bloqueo deja de significar nada 30 segundos
   después de escribirse. Con sincronización diferida llegaría a la nube ya
   vencida.
2. **Nadie la consultaría desde allá.** No hay reporte ni conciliación que la
   necesite. El hecho auditable —que hubo un bloqueo— **sí** viaja: queda en
   `auditoria_log` con las acciones `usuario_bloqueado` y
   `autorizacion_bloqueada`, y esa tabla sí está espejada.
3. **Sincronizarla sería activamente dañino con más de una terminal.** El
   candado del diálogo de autorización protege *ese* diálogo en *esa* máquina.
   Si el bloqueo de la terminal A viajara a la terminal B, un error de tecleo
   en una caja dejaría bloqueada la otra: exactamente la negación de servicio
   que la separación de candados vino a eliminar (ver `CLAUDE.md` §4.8).
4. **Columnas siempre en cero engañan al auditor.** Si `intentos_fallidos`
   existiera en la nube sin sincronizarse nunca, quien consultara Postgres
   vería `0` para todos y podría concluir que nadie falló jamás un ingreso.

## Los huecos de numeración, y sus DOS direcciones

**No falta nada ni se rompió nada.** Hay **un solo espacio de numeración
compartido** entre las dos carpetas: un número identifica un cambio de esquema,
y cada cambio existe de un lado, del otro, o de los dos. Por eso el número de
`0016_configuracion_negocio.sql` es el mismo que el de la local
`016_configuracion_negocio`.

De ahí salen dos clases de hueco, y **significan cosas distintas**:

| Dónde falta el número | Qué significa | Ejemplos |
|---|---|---|
| **Falta aquí**, existe en `src/main/database/migrations/` | Ese cambio es **solo local**: toca algo que no se espeja, porque es estado operativo de una terminal y no dato de negocio. | 0002, 0003, 0006, 0011, 0013, 0018 |
| **Falta allá**, existe aquí | Ese cambio es **solo de la nube**: no tiene sentido en SQLite, o directamente no puede existir ahí. | 0019, 0020, 0021, 0022, 0024, 0025, 0026, 0027, 0029 |

La segunda dirección es nueva: apareció en la fase 2.a de la sincronización,
2026-09-11. Antes todos los huecos eran de la primera clase, y por eso este
archivo decía que un hueco significaba «esa migración local no tiene espejo».
**Ya no alcanza con esa frase**: hay que mirar de qué lado falta el número.

**No renumerar nunca** para «tapar» los que faltan, en ninguna de las dos
carpetas: el hueco es información, y renumerar la destruye.

### Dirección 1 — el cambio es solo local, y aquí no hay archivo

| Migración local | Archivo aquí | Por qué |
|---|---|---|
| `001_esquema_inicial` | `0001_esquema_inicial.sql` | Datos de negocio |
| `002_bloqueo_de_usuarios` | **(ninguno, a propósito)** | Estado por identidad, local por ahora |
| `003_bloqueos_de_autorizacion` | **(ninguno, a propósito)** | Estado por superficie, local siempre |
| `004_denominaciones_y_desglose` | `0004_denominaciones_y_desglose.sql` | Datos de negocio: el arqueo del corte |
| `005_pin_remoto` | `0005_pin_remoto.sql` | Columna de `usuarios`, que ya se sincroniza entera |
| `006_superficie_cierre_con_diferencia` | **(ninguno, a propósito)** | Amplía `bloqueos_de_autorizacion`, que no se espeja |
| `007_autorizacion_de_diferencia` | `0007_autorizacion_de_diferencia.sql` | Parte del corte de caja |
| `008_autorizacion_solo_con_diferencia` | `0008_autorizacion_solo_con_diferencia.sql` | Parte del corte de caja |
| `009_categorias_activo` | `0009_categorias_activo.sql` | Catálogo: dato de negocio |
| `010_una_caja_por_sistema` | `0010_una_caja_por_sistema.sql` | Corte de caja: dato de negocio |
| `011_superficie_cierre_de_caja_ajena` | **(ninguno, a propósito)** | Amplía `bloqueos_de_autorizacion`, que no se espeja |
| `012_caja_cerrada_por` | `0012_caja_cerrada_por.sql` | Corte de caja: dato de negocio |
| `013_superficie_descuento_excedente` | **(ninguno, a propósito)** | Amplía `bloqueos_de_autorizacion`, que no se espeja |
| `014_boleta_solo_con_tarjeta` | `0014_boleta_solo_con_tarjeta.sql` | Regla sobre `ventas`: dato de negocio |
| `015_cantidad_vendida` | `0015_cantidad_vendida.sql` | Columna de `productos`: dato de negocio |
| `016_configuracion_negocio` | `0016_configuracion_negocio.sql` | Datos de la tienda: salen impresos en el recibo |
| `017_descuento_autorizado_via` | `0017_descuento_autorizado_via.sql` | Columna de `ventas`: dato de negocio |
| `018_sync_cola_lotes` | **(ninguno, a propósito)** | Amplía `sync_cola`, que no se espeja |
| `028_limites_descuento_id_determinista` | `0028_limites_descuento_id_determinista.sql` | El id de un tope pasa a ser FIJO por rol. Tiene que ser el MISMO valor de los dos lados, o la fila llega a la nube con una llave primaria distinta de la que allá ya existe |

Cada migración local que sea dato de negocio se espeja con su mismo número. **No renumerar** para "tapar" los
que faltan: el hueco es información.

Son **seis números** omitidos pero **tres casos**: el 0003, el 0006, el 0011 y
el 0013 son la misma tabla, `bloqueos_de_autorizacion` —la 006, la 011 y la 013
solo le amplían el CHECK de superficies—, así que si la tabla no se espeja,
ninguna migración que la toque se espeja tampoco. Ese es todo el motivo de esos
cuatro huecos: no hay ninguna razón adicional, ni nada pendiente de decidir
sobre ellos. El 0002 es el suyo propio. **Y el 0018 es el tercer caso**: le
agrega a `sync_cola` las cinco columnas de la bandeja de salida (`lote_id`,
`orden_en_lote`, `intentos`, `proximo_intento_en`, `bloqueante`), y `sync_cola`
es la lista local de qué falta subir, así que tampoco se espeja ninguna
migración que la toque.

Los dos casos **no son equivalentes**, aunque hoy tomen la misma decisión:

- **`bloqueos_de_autorizacion`** no debe sincronizarse **nunca**, bajo ningún
  diseño futuro.
- **`usuarios.intentos_fallidos` / `bloqueado_hasta`** hoy no se sincroniza por
  una limitación de la arquitectura de una sola terminal, y **probablemente
  haga falta** cuando exista multi-sucursal.

El detalle y la razón de cada uno están en `CLAUDE.md`, sección 4.4.

### Dirección 2 — el cambio es solo de la nube, y allá no hay archivo

**NO EXISTEN NI VAN A EXISTIR las migraciones locales 019, 020, 021, 023, 024, 025, 026, 027 ni 029.**
Las tres primeras de esta dirección llegaron juntas, con la fase 2.a de la
sincronización, y nacen de la misma pregunta: qué tiene que haber en la nube que
no tiene por qué estar en la terminal, y qué hay hoy en la nube que nunca debió
estar. La `0023` llegó con la fase 2.b y es de otra clase: código que corre en
Postgres. La `0024` llegó con la fase 2.c y es de una tercera: privilegios de
tabla, un concepto que en SQLite no existe.

| Archivo aquí | Migración local | Por qué no la hay, en concreto |
|---|---|---|
| `0019_recibido_en.sql` | **(ninguna, a propósito)** | Agrega `recibido_en` a doce de las trece tablas —todas menos `denominaciones`, que no recibe escrituras de la terminal—: la hora del SERVIDOR en que la nube recibió cada fila, fijada por un trigger que ignora lo que venga en el payload. **En SQLite no puede existir por diseño, no por comodidad:** su razón de ser es ser la única fecha que el cliente no controla, y en la base del cliente *toda* fecha la controla el cliente. Una columna así en SQLite sería una marca que el ladrón elige, o sea exactamente lo que esta columna existe para no ser. Ver `docs/SINCRONIZACION.md` §1.5.1, mitigación 1. |
| `0020_quitar_estado_sincronizacion.sql` | **(ninguna, a propósito)** | Quita `ventas.estado_sincronizacion` **de Postgres**. La columna **sigue existiendo y sigue usándose en SQLite**: dice si esta terminal ya subió esta venta, que es estado operativo local. En la nube no significaba nada —una fila que está en Postgres está, por definición, sincronizada— y mostraba siempre su `DEFAULT`, que es el mismo error que este README describe arriba para `intentos_fallidos`. Es la inconsistencia 1 del diseño, resuelta. Decisión 4. |
| `0022_fijar_search_path_auditoria.sql` | **(ninguna, a propósito)** | Le fija `search_path = ''` a `auditoria_log_es_inmutable`. En SQLite no existe el concepto. **Este cambio ya estaba aplicado en `pos-jimmy-cano` desde el 2026-09-05, pero nunca se había escrito el archivo**: se aplicó directamente para callar un aviso del linter. Lo detectó el proyecto de pruebas al comparar los dos catálogos, que es exactamente para lo que existe (§9.5). Sin este archivo, aplicar esta carpeta sobre un proyecto vacío no reproducía el esquema real. |
| `0021_quitar_hashes_de_pin.sql` | **(ninguna, a propósito)** | Quita `usuarios.pin_hash` y `pin_remoto_hash` **de Postgres**. Las dos columnas **siguen existiendo en SQLite**, donde son lo que hace funcionar el ingreso y el diálogo de autorización: quitarlas allá dejaría a la tienda sin poder abrir. Se quitan acá porque un PIN de cuatro dígitos tiene 10 000 valores y quien lea esa tabla en la nube los saca todos, y porque **no hacen falta**: toda restauración resetea los PIN sin mirarlos (decisión 15). Decisión 17. |
| `0023_funciones_de_sincronizacion.sql` | **(ninguna, a propósito)** | Las **funciones de sincronización**: las cinco `SECURITY DEFINER` por las que escribe la terminal —usuario, apertura de caja, cierre de caja, venta y lote simple—, sus ayudantes internos y `contrato_de_sincronizacion()` para la prueba de deriva. Son código que corre **en Postgres**, con `auth.jwt()`, RLS y `jsonb_populate_record`: en SQLite no existe nada de eso ni hace falta, porque la terminal es quien llama, no quien recibe. Ver CLAUDE.md §4.20. **Aplicada en los dos proyectos el 2026-09-12.** |
| `0024_privilegios_de_tabla.sql` | **(ninguna, a propósito)** | Revoca los privilegios de tabla que Supabase concede por omisión a `anon` y `authenticated`, y deja a `authenticated` con `SELECT` y nada más. **En SQLite no existe el concepto**: no hay roles ni privilegios de tabla, y el único que abre la base es el proceso principal. Se escribe `REVOKE ALL` + `GRANT SELECT` en vez de enumerar privilegios, porque enumerar dejó afuera `MAINTAIN` (nuevo en Postgres 17, invisible en `information_schema`). Ver CLAUDE.md §4.20. |
| `0025_politicas_de_restauracion.sql` | **(ninguna, a propósito)** | Una política RLS `FOR SELECT` para el rol `restauracion` sobre cada una de las 13 tablas, y ninguna para la terminal. **En SQLite no hay RLS ni roles**: la base la abre un solo proceso y el control de acceso es el guard de permisos del IPC (§4.7). Ver CLAUDE.md §4.21. |
| `0026_storage_de_archivos.sql` | **(ninguna, a propósito)** | Los buckets privados `fotos` y `recibos` y sus políticas, más una restrictiva que le cierra `storage.objects` a `anon`. **En SQLite no hay Storage**: los archivos viven en `<userData>` y su ruta relativa está en `productos.foto_path` y `recibos.pdf_path`, que esta migración no toca. Ver CLAUDE.md §4.21. |

**Las cuatro tienen la misma forma y conviene verla:** ninguna es «la nube va
atrasada respecto de lo local». Dos de ellas *quitan* de la nube algo que lo
local conserva, y las otras dos *agregan* a la nube algo que lo local no puede
tener: una columna que solo el servidor puede fijar, y funciones que solo
Postgres puede correr. Es decir, los esquemas dejaron de ser espejos exactos a
propósito, y estas cuatro son la lista completa de en qué difieren.

Si algún día hace falta una cuarta, va en esta tabla con su razón escrita, y el
número que use queda reservado también del lado local.

> No confundir estos números con las versiones de migración que registra
> Supabase (`20260905143642`, etc.): esas las genera la propia plataforma al
> aplicar, y son independientes del nombre del archivo.

## Estado

| Migración | Aplicada en `pos-jimmy-cano` |
|---|---|
| `0001_esquema_inicial.sql` | Sí — `20260905143642` |
| *(fijar search_path de la función de auditoría)* | Sí — `20260905171724` |
| *(no hay 0002 ni 0003: ver la sección anterior)* | — |
| `0004_denominaciones_y_desglose.sql` | Sí — `20260907002143` |
| `0005_pin_remoto.sql` | Sí — `20260907002154` |
| *(no hay 0006: ver la sección anterior)* | — |
| `0007_autorizacion_de_diferencia.sql` | Sí — `20260907002212` |
| `0008_autorizacion_solo_con_diferencia.sql` | Sí — `20260907002231` |
| `0009_categorias_activo.sql` | Sí — `20260908121557` |
| `0010_una_caja_por_sistema.sql` | Sí — `20260910040514` |
| *(no hay 0011: ver la sección anterior)* | — |
| `0012_caja_cerrada_por.sql` | Sí — `20260910040526` |
| *(no hay 0013: ver la sección anterior)* | — |
| `0014_boleta_solo_con_tarjeta.sql` | Sí — `20260911113517` |
| `0015_cantidad_vendida.sql` | Sí — `20260911113531` |
| `0016_configuracion_negocio.sql` | Sí — aplicada el 2026-09-11 |
| `0017_descuento_autorizado_via.sql` | Sí — aplicada el 2026-09-11 |
| *(no hay 0018: ver la sección anterior)* | — |
| `0019_recibido_en.sql` | Sí — aplicada el 2026-09-11 |
| `0020_quitar_estado_sincronizacion.sql` | Sí — aplicada el 2026-09-11 |
| `0021_quitar_hashes_de_pin.sql` | Sí — aplicada el 2026-09-11 |
| `0022_fijar_search_path_auditoria.sql` | Sí — el CAMBIO estaba desde el 2026-09-05; el archivo se escribió y se aplicó el 2026-09-11, y fue un no-op comprobado |
| `0023_funciones_de_sincronizacion.sql` | Sí — aplicada el 2026-09-12, después de probarse en `pos-pruebas-descartable` desde el 2026-09-11. Las 13 definiciones de función del real son idénticas a las del de pruebas (`md5(pg_get_functiondef)`), y el registro guarda el archivo byte a byte. |
| `0024_privilegios_de_tabla.sql` | Sí — aplicada el 2026-09-12, justo después de la `0023`. `anon` quedó sin ningún privilegio de tabla y `authenticated` solo con `SELECT`; `has_table_privilege(…, 'MAINTAIN')` da `false` en las trece. |

| `0027_sincronizar_asiento.sql` | Sí — aplicada el 2026-09-14, el mismo día que en `pos-pruebas-descartable`. Crea `sincronizar_asiento` y reemplaza `contrato_de_sincronizacion` para que la conozca. La huella de las 14 funciones del contrato es `1b0bcbf6c033cb163c4bc396dbe52e37` **en los dos proyectos**. |

| `0028_limites_descuento_id_determinista.sql` | Sí — aplicada el 2026-09-14, después de probarse en `pos-pruebas-descartable` el mismo día. El CHECK `limites_descuento_id_fijo_por_rol` quedó `convalidated = true`, y los CUATRO CHECK de la tabla tienen `md5(pg_get_constraintdef)` idéntico en los dos proyectos. Falsificado en el real: un id sorteado y un id cruzado se rechazan los dos, sin dejar ninguna fila. |
| `0029_restauracion_ventas_por_mes.sql` | **NO — pendiente de aprobación.** Aplicada en `pos-pruebas-descartable` el 2026-09-14 (fase 4.b) y verificada allí con `npm run verify:restauracion`. Crea `restauracion_ventas_por_mes()` —`SECURITY INVOKER`, solo rol `restauracion`, suma `ventas.total` por mes UTC con `NUMERIC` y la devuelve como texto— y reemplaza `contrato_de_sincronizacion` para que la enumere. Es puramente aditiva y la versión de contrato no sube. **Hasta que se aplique en el real, restaurar contra `pos-jimmy-cano` se detiene en la precondición de deriva** diciendo exactamente eso («la función restauracion_ventas_por_mes no existe en la nube: falta aplicar la migración que la crea»), sin bajar una fila. |

**QUEDA UNA MIGRACIÓN PENDIENTE DE APLICAR EN `pos-jimmy-cano`: la `0029`**,
que el descartable ya tiene desde el 2026-09-14 (24 migraciones contra 23).
Es aditiva, no sube la versión de contrato, y sin ella la restauración contra
el real se niega en la precondición en vez de restaurar mal. Antes de ella
no quedaba ninguna pendiente: **los dos proyectos tenían las 23.** Las dos
últimas parejas fueron la `0027` y la `0028`, el
2026-09-14; antes la `0025` y la `0026`, el 2026-09-13, y la `0023` y la `0024`,
el 2026-09-12.

> **LA `0028` ES LA PRIMERA MIGRACIÓN PAREJA DESDE LA `0017`, y el par importa
> más de lo habitual.** Fija los mismos dos UUID de los dos lados. Si corriera
> una sola de las dos, la terminal escribiría un id y la nube esperaría otro
> para la misma fila de negocio, que es exactamente el estado que la migración
> viene a impedir. **Al reconstruir el proyecto descartable desde estos
> archivos, las dos van juntas.**

> **POR QUÉ LA `0027` SE APLICÓ TEMPRANO, ANTES DE QUE HICIERA FALTA.** Es
> puramente aditiva —agrega una función, no cambia ninguna, y la versión de
> contrato no sube—, así que ninguna terminal vieja se rompe con ella, y **el
> código de la terminal ya la necesitaba**: sin ella, un lote de asiento suelto
> detiene la cola entera (medido: `HTTP 400 FORMA: la tabla auditoria_log no se
> sincroniza como lote simple`). Decisión de Julio: una migración así no cuesta
> nada aplicar temprano y sí cuesta olvidar. Ver CLAUDE.md §4.29.

> **EL HISTORIAL DE LOS DOS PROYECTOS NO ES SIMÉTRICO PARA LA `0027`, y conviene
> saberlo.** En el real quedó registrada como UNA migración,
> `0027_sincronizar_asiento`, con el archivo completo. En el descartable quedó
> partida en dos, `0027_sincronizar_asiento` y `0027b_contrato_conoce_el_asiento`,
> porque allá se aplicó en dos pasos mientras se construía. **Los OBJETOS sí son
> idénticos**, que es lo que se verifica; la asimetría es solo del registro, y no
> se corrige porque el descartable se reconstruye desde estos archivos.

**Los dos pasos del panel que la fase 2.c necesitaba también están HECHOS y
MEDIDOS, los dos el 2026-09-13**, así que no queda nada de la fase 2:

- **`app_metadata.rol = 'restauracion'`** en el usuario de Julio del real. Sin
  ese claim las trece políticas de la `0025` no le sirven a nadie. Verificado
  leyendo la fila, ejercitando las trece políticas con los claims armados desde
  el `app_metadata` real, y —lo que faltaba— acuñando un token de verdad, que
  trajo el claim copiado por GoTrue. Ver CLAUDE.md §4.21.
- **JWT en 900 s.** Medido acuñando un token del proyecto real: `expires_in =
  900` y `exp - iat = 900`. Y contra el proyecto de pruebas se comprobó además
  que el token **deja de servir** pasado el `exp`, que es otra cosa distinta de
  que su carga útil diga 900. Ver CLAUDE.md §4.22.

Antes de ellas,
Las cuatro anteriores son las de la fase 2.a, aplicadas el 2026-09-11 por la
vía de siempre:
primero contra `pos-pruebas-descartable`, después el SQL completo a la vista, y
recién con la aprobación explícita de Julio contra `pos-jimmy-cano`.

**Fueron las primeras que solo existen de este lado, y las primeras que QUITAN
columnas.** Antes de quitarlas se contó qué había: `usuarios` tenía **0 filas**,
así que no se destruyó ni un hash. Las tres sentencias `DROP COLUMN` pasaron
**sin `CASCADE`**, que es la prueba de que nada dependía de esas columnas.

Estado del catálogo real después de aplicarlas, leído de él y no del archivo:

| | Antes | Después | Por qué |
|---|---|---|---|
| Tablas | 13 | 13 | — |
| Columnas | 118 | **127** | +12 de `recibido_en`, −3 quitadas |
| Índices | 49 | 49 | — |
| CHECK | 52 | **50** | −1 de `pin_hash`, −1 de `estado_sincronizacion` |
| Foráneas | 15 | 15 | — |
| Triggers | 1 | **13** | +12 de `recibido_en` |
| Con RLS / políticas | 13 / 0 | 13 / 0 | — |

La huella md5 de todas las columnas con su tipo y nulabilidad da
`d85af488732d5874cd87844d2039713d` **en los dos proyectos**: los esquemas son
idénticos columna por columna.

El linter de seguridad sigue reportando lo mismo que antes: 13 avisos INFO de
`rls_enabled_no_policy`, que son el estado buscado, y los dos WARN de
`rls_auto_enable`, ajenos a este esquema. **`fijar_recibido_en` no aparece**,
porque es `SECURITY INVOKER`.

### Estado en `pos-pruebas-descartable` (referencia `ztidrshifrblhfraiowg`)

Creado el 2026-09-11 en `us-east-2`, plan gratuito, para lo que manda §9.5 del
diseño. **Tiene aplicadas las dieciocho migraciones**: las doce del esquema, la
`0022`, las tres de la fase 2.a, la `0023` de la fase 2.b y la `0024` de la fase
2.c. Es el único proyecto donde las de la nube se prueban antes de existir en la
tienda. Desde el 2026-09-12 **el real tiene el mismo juego**: la huella del
contrato que declaran los dos, y la de la foto de este repositorio, es la misma
(`81b685b17f47750bb6c56812ae89c99e`). Lo que sigue siendo exclusivo del proyecto
de pruebas es que **acá se puede escribir y borrar**: sus tres usuarios de Auth y
la batería destructiva no existen ni pueden existir del lado del real.

Su registro de `schema_migrations` guarda la `0023` byte a byte igual al archivo
de esta carpeta (mismo md5, sin el salto de línea final), y la FOTO de su
catálogo es `supabase/esquema-nube.json`, tomada con
`npm run verify:nube -- --tomar-foto` y cotejada en cada `npm test` por la prueba
de deriva. Las credenciales de sus tres usuarios de Auth viven en
`.env.nube-pruebas` (ignorado por git; plantilla en `.env.nube-pruebas.ejemplo`).
`npm run verify:nube -- --destructivo` escribe y vuelve a escribir filas de
mentira ahí, y **solo ahí**: el seguro de `scripts/proyectos-de-prueba.cjs` se
niega ante cualquier otra referencia, y ante la del real por nombre.

Después de cada corrida de la batería quedan filas de mentira: las de las once
tablas de negocio se vacían con la `service_role` del proyecto (o por SQL), y
`auditoria_log` **solo por SQL** (`TRUNCATE`), porque es inmutable por trigger
también para la `service_role`. Que crezca entre corridas no importa: los ids son
nuevos en cada una.

Comparado con `pos-jimmy-cano` **antes** de aplicarle las tres nuevas, los ocho
contadores del catálogo daban idénticos —13 tablas, 118 columnas, 49 índices, 52
CHECK, 15 foráneas, 1 trigger, 13 con RLS, 0 políticas— con dos únicas
diferencias, una esperada y otra no:

| Diferencia | ¿Esperada? | Qué se hizo |
|---|---|---|
| `auditoria_log_es_inmutable` sin `search_path` en el de pruebas | **No** | Se escribió la `0022`, que faltaba. Ver la dirección 2. |
| `rls_auto_enable()` existe solo en el real | **Sí** | Es preexistente del proyecto y ajena a este esquema (CLAUDE.md §4.4). **No se replica**: replicarla sería copiar a la fuerza algo que ni siquiera es nuestro. |

Antes de ellas no quedaba ninguna pendiente. Las dos últimas aplicadas
fueron `0016` —la tabla con los datos de la tienda que encabezan el recibo— y
`0017` —la columna `ventas.descuento_autorizado_via`—, las dos el 2026-09-11,
por la vía de siempre: SQL a la vista, aprobación explícita de Julio y evidencia
consultada después contra el catálogo del proyecto, no contra el archivo.

Antes de ellas, `0014` y `0015` se aplicaron el mismo día y se verificaron
igual: `ventas_boleta_solo_con_tarjeta`
existe con `convalidated = true`, y `productos.cantidad_vendida` quedó
`numeric(14,3) NOT NULL DEFAULT 0` con su `CHECK (cantidad_vendida >= 0)`.
`ventas` y `productos` siguen en 0 filas.

Las dos anteriores —`0010` y `0012`— se aplicaron el 2026-09-09 por la vía de
siempre, y se verificaron contra el catálogo del proyecto:
`idx_caja_sesiones_una_abierta` quedó sobre `(estado)` y ya no sobre
`(usuario_id)`, y `cerrada_por` existe como `uuid` nulable con llave foránea
`ON DELETE SET NULL` hacia `usuarios`.

La `0009` se
aplicó el 2026-09-08 por la vía de siempre —SQL a la vista y aprobación
explícita— y se verificó contra el catálogo del proyecto: la columna `activo`
quedó `boolean NOT NULL DEFAULT true` y el índice `idx_categorias_activas`
existe sobre `(activo, orden)`.

Las cuatro del corte de caja (0004, 0005, 0007 y 0008) se aplicaron el
2026-09-06 por esa misma vía, y se verificaron consultando el catálogo del
proyecto: 12 tablas con RLS activo, los dos CHECK de `caja_sesiones` con
`convalidated = true`, y las 11 denominaciones cotejadas una a una contra los
UUID del esquema local.

## Al agregar una migración local nueva

Preguntarse primero: **¿esto es dato de negocio o estado operativo de esta
terminal?** Solo lo primero necesita archivo en esta carpeta.

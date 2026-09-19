# 003 — Plan: cómo se construye la anulación con autorización a distancia

> Implementa [`spec.md`](spec.md). Escrito el 2026-09-19, antes de tocar el
> código. Las tareas están en [`tasks.md`](tasks.md). **La sección 1 es la que
> Julio tiene que revisar:** ¿alcanza con cambiar `ACEPTA_PIN_REMOTO` o hace falta
> una migración?

---

## 0. Lo que se leyó antes de planear

| Archivo | Qué hace hoy | Qué importa para este cambio |
|---|---|---|
| `src/main/domain/usuarios/autenticacion.ts:114-138` | `ACEPTA_PIN_REMOTO`, la tabla de qué superficie acepta el código remoto. `anulacion_de_venta: false`, con su razón en el comentario. La cabecera (líneas 68-112) tiene la tabla de razones y la historia de las dos ampliaciones anteriores: el descuento el 2026-09-11 y la salida el 2026-09-15. | Es el cambio de política: un booleano, con su historia al lado. |
| `autenticacion.ts:397-528` (`autorizarComoAdministrador`) | Decide por el largo. Con 4 dígitos prueba los PIN y concede con vía `'presencial'` (línea 438). Con 6 dígitos, en una superficie que acepta el remoto, prueba los códigos TOTP y concede con vía `'remoto'` (línea 524). En una que no lo acepta devuelve `FORMATO_INVALIDO` (línea 452). Si el código coincide con dos administradores, `CODIGO_AMBIGUO` (línea 505). | **No se toca.** Los dos caminos de éxito ya ponen la vía. |
| `src/main/ipc/anulacion-de-venta.ts:99-125` (`FlujoDeAnulacionDeVenta`) | Valida todo antes de mirar el código. Llama a `autorizarComoAdministrador(pedido.pin, 'anulacion_de_venta')` y pasa `via: permiso.viaDeAutorizacion ?? 'presencial'`. | **No se toca.** El `?? 'presencial'` es inalcanzable con un permiso concedido (riesgo R6). |
| `src/main/domain/venta/servicio-de-anulacion.ts:393-430` | Escribe la fila (`autorizadaVia: autorizacion.via`) y el asiento `venta_anulada` (`valorNuevo.autorizadaVia`), con el mismo valor. | **No se toca.** Es el mecanismo que el pedido dice conservar. |
| `src/main/database/migrations/038_anulacion_solo_presencial.sql` | `ADD CONSTRAINT anulaciones_de_venta_solo_presencial CHECK (autorizada_via = 'presencial')`. Su cabecera ya anticipaba la vuelta atrás: «Volver a ampliar sería una migración con `DROP CONSTRAINT anulaciones_de_venta_solo_presencial`, medido en SQLite 3.53.4». | Es lo que se deshace. **No se edita:** está aplicada y el migrador guarda su checksum. |
| `supabase/migrations/0038_anulacion_solo_presencial.sql` | El mismo CHECK en Postgres, con su `COMMENT`. Deja a propósito el CHECK amplio de la columna, para que ampliar sea «la MISMA sentencia en los dos». Dice que el contrato no declara restricciones. | Se deshace con la misma sentencia. **No se edita.** |
| `supabase/migrations/0033_anulaciones_de_venta.sql:59` | La columna: `autorizada_via TEXT NOT NULL CHECK (autorizada_via IN ('presencial', 'remoto'))`. | **Queda:** después del cambio, esa es la regla. |
| `supabase/migrations/0035_sincronizar_anulacion_de_venta.sql` | `sincronizar_anulacion_de_venta` no mira la vía (no aparece ni `autorizada_via` ni `presencial`). El contrato vigente arma `'tablas'` desde `pg_attribute` y `'funciones'` desde `pg_proc`, sin `pg_constraint`. | Quitar un CHECK **no cambia el contrato** (§1.3). |
| `src/renderer/src/components/ModalDeAnulacion.tsx` | El teclado del paso de autorización (línea 303) usa el largo por omisión, `[4]`. El texto (líneas 299-300) dice «El código de autorización remota no sirve para anular una venta», y el botón (línea 282), «Anular con PIN de administrador». La cabecera (punto 3) explica por qué no. **La confirmación ya muestra «En persona» o «A distancia» (línea 347)**, un camino que hoy es inalcanzable. | Hay que cambiar el largo, los textos y el comentario. |
| `src/shared/pin.ts:31` | `LARGOS_DE_AUTORIZACION = [4, 6]`, lo que pasan los tres diálogos que aceptan el remoto. | Es el valor que va en la anulación. |
| `src/main/database/__tests__/anulacion-solo-presencial.test.ts` | Prueba lo que hace la 038. Tiene además la prueba de acoplamiento **«LA BASE Y ACEPTA_PIN_REMOTO DICEN LO MISMO»** (líneas 129-155). | Se adapta con constancia (§4.2). La prueba de acoplamiento queda. |
| `autenticacion.test.ts:900-912`, `servicio-de-anulacion.test.ts:957-972` | Exigen que `anulacion_de_venta` rechace el código: la primera en la tabla, la segunda con `FORMATO_INVALIDO`, sin consumir intento. | Se invierten, dejando escrito qué exigían (§4.2). |
| `productos-precio-mayorista.test.ts:108-110` | Migra con TODAS las migraciones una base que está en la 038 y espera que se aplique solo la 039. | Con la 040 se aplicarían dos. Se acota a «hasta la 039», igual que la T5 de la spec 002. |
| `scripts/verificacion-de-anulacion.cjs` | El arnés de la anulación en la aplicación real. Corre en una ventana de **1100×900** (`setSize`, línea 81) y solo prueba el PIN presencial. | Pasa a **1024×768 exactos**, con la emulación de CDP, y suma el camino remoto (§5.3). |
| `scripts/verificacion-de-nube.cjs:464` | La batería destructiva arma su anulación con `'presencial'` y no prueba el rechazo de `'remoto'`. | No hace falta tocarla. |

**Todos los teclados de autorización, auditados.** Así se ve que hoy todos
coinciden con la política y que solo cambia uno:

| Superficie | `ACEPTA_PIN_REMOTO` | Teclado | Largos que confirma |
|---|---|---|---|
| `salida_controlada` | sí | `ModalDeSalida.tsx:144` | `LARGOS_DE_AUTORIZACION` |
| `cierre_con_diferencia` | sí | `PantallaDeCaja.tsx:491` (diferencia) y `:577` (reconteo) | `LARGOS_DE_AUTORIZACION` |
| `descuento_excedente` | sí | `DialogoDeCobro.tsx:293` | `LARGOS_DE_AUTORIZACION` |
| `cierre_de_caja_ajena` | no | `PantallaDeCaja.tsx:404` | `[4]`, el valor por omisión |
| `saltar_lote_de_sincronizacion` | no | `PantallaDeSincronizacion.tsx:170` | `[4]`, el valor por omisión |
| **`anulacion_de_venta`** | **no → sí** | **`ModalDeAnulacion.tsx:303`** | **`[4]` → `LARGOS_DE_AUTORIZACION`** |

Los demás teclados numéricos no autorizan en ninguna superficie: el ingreso, los
PIN de usuarios y de restauración, la configuración inicial, la inscripción de
la app (`[6]`) y los de cantidad.

---

## 1. La decisión central: SÍ hace falta migración, y NO obliga a actualizar la tienda el mismo día

### 1.1 Qué pasa si solo se cambia `ACEPTA_PIN_REMOTO`

Con el booleano en `true` y sin tocar la base:

1. El código de la app autoriza, y el paso de TOTP queda consumido.
2. El `INSERT` en `anulaciones_de_venta` choca con el CHECK
   `anulaciones_de_venta_solo_presencial`.
3. La transacción de la anulación se revierte entera: el inventario, los
   contadores, la fila y el asiento.
4. El cajero ve el genérico «Los datos de la operación no cumplen una regla del
   sistema» (`DATO_INVALIDO`).

**La función no andaría.** Es exactamente para lo que se escribió la 038: falla
**cerrado**. Además, antes de que nada de eso llegue a una tienda, `npm test` ya
falla en la prueba de acoplamiento («LA BASE Y ACEPTA_PIN_REMOTO DICEN LO
MISMO»). Cambiar solo el booleano no es una opción.

### 1.2 Las formas de evitar la migración de la nube, y por qué se descartan

| Alternativa | Por qué no |
|---|---|
| Guardar `'presencial'` aunque la autorización haya sido a distancia | **La fila mentiría**, y en la peor dirección para este control: una autorización remota se leería como presencial. Además contradice el pedido: «la vía queda registrada en cada anulación… igual que hoy». |
| Guardar la vía solo en el asiento | La fila seguiría obligada a decir `'presencial'` por el CHECK: la misma mentira, en el dato que leen la restauración y cualquier reporte futuro. |
| Quitar solo el CHECK local | La nube rechaza el lote con `23514`, el lote queda bloqueante y **se detiene TODA la cola de la tienda**, no solo la anulación, hasta que alguien aplique la migración de la nube. Es el peor resultado operativo posible. |
| Una columna nueva (por ejemplo, `autorizada_a_distancia`) | Cambia la forma del payload. **Esa sí** es la clase de migración que obliga a actualizar la tienda el mismo día, como la 0039. Sería más riesgo, no menos. |

**Conclusión:** hace falta una migración local, la `040`, y su espejo en la
nube, la `0040`. Las dos quitan la restricción con la misma sentencia.

### 1.3 Por qué ESTA migración de la nube no obliga a actualizar la tienda el mismo día

La sincronización se detiene cuando cambia la **forma** de lo que se sube: las
columnas, que revisa `exigir_claves_conocidas`, o la versión de contrato. Un
CHECK no es ninguna de las dos cosas:

- **No cambia el contrato.** `contrato_de_sincronizacion()` (0035) arma
  `'tablas'` desde `pg_attribute` y `'funciones'` desde `pg_proc`, y no lee
  `pg_constraint`. Tampoco cambian la foto `esquema-nube.json` ni la versión de
  contrato, que sigue en 1.
- **No toca la función.** `sincronizar_anulacion_de_venta` no mira la vía.
- **Es una relajación pura.** Toda fila que la nube aceptaba antes, la sigue
  aceptando. La 1.3.1 de la tienda solo puede producir anulaciones
  `'presencial'`: su tabla dice `false`, su teclado confirma 4 dígitos y su base
  local tiene el CHECK de la 038. Para ella no cambia nada.
- **Es lo contrario de la 0039**, que agregó columnas y por eso era una
  migración PAREJA: los dos lados tenían que ir juntos. La 0040 no lo es.

**Por eso la 0040 se puede aplicar en `pos-jimmy-cano` cualquier día ANTES de
instalar la versión nueva, sin ningún efecto sobre la 1.3.1 que está operando.**
Esto se mide en el ensayo (§5.2): no se da por sentado.

### 1.4 La única regla de orden, y qué pasa si se rompe

**La 0040 tiene que estar en la nube antes de que una terminal con esta versión
autorice una anulación a distancia.**

Si se rompe, pasa esto (a medir en el ensayo, §5.2):

1. La nube rechaza el lote de esa anulación con `23514`, nombrando
   `anulaciones_de_venta_solo_presencial`.
2. El lote queda bloqueante y la cola de la tienda se detiene. Se ve en la barra:
   «Nube: detenida».
3. **No se pierde nada:** la anulación está confirmada en la base local y el lote
   espera.
4. Se sale aplicando la 0040 y tocando «Reintentar ahora».

Las anulaciones presenciales, en cambio, suben con o sin la 0040.

### 1.5 SQLite sí sabe quitar la restricción: medido, no supuesto

La cabecera de la 038 ya lo anticipaba («medido en SQLite 3.53.4»). Se volvió a
medir hoy, con el `better-sqlite3` del proyecto, sobre una tabla de juguete con
los mismos dos CHECK:

```
better-sqlite3 13.0.3 · SQLite 3.53.4
con la restricción, INSERT remoto → SQLITE_CONSTRAINT_CHECK CHECK constraint failed: t_solo_presencial
con la restricción, INSERT presencial → aceptado
esquema guardado ANTES: CREATE TABLE t (id TEXT PRIMARY KEY, via TEXT NOT NULL CHECK (via IN ('presencial', 'remoto')), CONSTRAINT t_solo_presencial CHECK (via = 'presencial'))
DENTRO de una transacción: ALTER TABLE t DROP CONSTRAINT t_solo_presencial → aceptado
esquema guardado DESPUÉS: CREATE TABLE t (id TEXT PRIMARY KEY, via TEXT NOT NULL CHECK (via IN ('presencial', 'remoto')))
sin la restricción, INSERT remoto → aceptado
sin la restricción, INSERT de otra vía (el CHECK de la columna sigue) → SQLITE_CONSTRAINT_CHECK CHECK constraint failed: via IN ('presencial', 'remoto')
DROP de una restricción que no existe → SQLITE_ERROR no such constraint: no_existe
integrity_check: [{"integrity_check":"ok"}]
filas: [{"id":"2","via":"presencial"},{"id":"3","via":"remoto"}]
```

Funciona dentro de una transacción, que es donde el migrador corre cada
migración. Quita solo la restricción con nombre y deja el CHECK de la columna.
**No hace falta rehacer la tabla.**

---

## 2. Las migraciones

### 2.1 `040_anulacion_autorizacion_remota.sql` (SQLite)

```sql
ALTER TABLE anulaciones_de_venta
  DROP CONSTRAINT anulaciones_de_venta_solo_presencial;
```

- **Va sin `IF EXISTS`, a propósito.** Si la restricción no estuviera, la
  migración falla con «no such constraint» en vez de pasar en silencio. Nunca
  debería faltar: el migrador aplica las migraciones en orden, y la 038 va antes.
- **No puede fallar por los datos:** quitar un CHECK no revisa filas. Las
  anulaciones que ya existen quedan iguales, byte a byte (CA-5).
- **La cabecera cuenta la reversión:** que la pidió el cliente y cuándo, la razón
  original de la 038 citada entera, y que la 038 se deja como está porque es
  historia aplicada.
- **Se registra en `migrator.ts`** con `orden: 40` y el nombre del archivo, y un
  comentario que nombra su espejo.

### 2.2 `0040_anulacion_autorizacion_remota.sql` (Postgres)

```sql
ALTER TABLE public.anulaciones_de_venta
  DROP CONSTRAINT anulaciones_de_venta_solo_presencial;
```

- **Es la misma sentencia en los dos lados.** Es lo que la 0038 buscó al dejar
  el CHECK amplio de la columna: «volver a ampliar algún día es la MISMA sentencia
  en los dos». El `COMMENT ON CONSTRAINT` de la 0038 se va con la restricción.
- **La cabecera explica por qué es seguro aplicarla antes que la versión
  nueva** (§1.3) y la regla de orden (§1.4).
- **No toca ninguna función, ni el contrato, ni la foto.** La versión de contrato
  no sube.
- **No se aplica en ninguna nube en esta spec.** Se escribe, se ensaya en un
  Postgres local y se le muestra el SQL a Julio. Aplicarla es un paso aparte,
  proyecto por proyecto (§6).

### 2.3 Lo que NO hay que tocar, y se comprobó

- **La restauración:** `CLASES_DE_COLUMNA` y el orden no dependen de los CHECK.
- **La foto `esquema-nube.json` y las dos mitades de la deriva.**
- **La batería de la nube:** ya sube su anulación con `'presencial'`.
- **`checks-con-null.test.ts`:** quitar un CHECK no puede agregar un caso de
  NULL.

---

## 3. El código

### 3.1 La política

`ACEPTA_PIN_REMOTO.anulacion_de_venta` pasa a `true`. El comentario de la
entrada **conserva el argumento anterior entero**, con la marca «HASTA EL
2026-09-19», y agrega la decisión del cliente.

La cabecera de `autenticacion.ts` también cambia:

- **La fila de la tabla de razones** dice «Sí, desde el 2026-09-19, a pedido del
  cliente», con la razón anterior conservada al lado.
- **Una sección nueva,** «`anulacion_de_venta`: la tercera ampliación, y la
  primera que deshace una defensa de seguridad». El descuento y la salida
  ampliaron superficies que nunca tuvieron una restricción en la base. Esta
  desarma tres capas puestas a propósito, y lo que la reemplaza es solo lo que se
  registra.

### 3.2 La pantalla

En `ModalDeAnulacion.tsx`:

- **El teclado:** `largos={LARGOS_DE_AUTORIZACION}`, igual que los otros tres
  diálogos.
- **El texto del paso de autorización:** «Un administrador debe autorizar la
  anulación con su PIN en persona, o dictando por teléfono el código de seis
  dígitos de su aplicación». Es la misma redacción del cobro y del cierre de caja.
- **El botón:** de «Anular con PIN de administrador» pasa a «Pedir la
  autorización de un administrador». Ya no es solo un PIN.
- **La cabecera, punto 3:** conserva la razón anterior y dice qué cambió.

La confirmación **no se toca**: ya muestra «A distancia» cuando la vía es
`'remoto'` (línea 347), y ahora ese camino se vuelve alcanzable. A 1024×768 el
teclado dice «4 o 6 dígitos» en lugar de «4 dígitos»; que el paso entre entero
se mide en el arnés (§5.3).

### 3.3 Lo que no cambia en el código

Quedan igual `autorizarComoAdministrador`, el flujo, el servicio, el repositorio,
el esquema del canal y el candado. El esquema del canal ya admite seis dígitos:
`pin` es un texto de hasta `LARGO_MAXIMO_PIN_EN_EL_PUENTE` caracteres.

### 3.4 El contador de anulaciones remotas en el resumen de ventas (agregado al aprobar)

Es la «versión de 20 líneas» que pidió Julio (spec §3.4, CA-18):

- **El repositorio de anulaciones** gana `contarRemotasEnRango(desdeIso,
  hastaIso)`: un `count(*)` de `anulaciones_de_venta` con `autorizada_via =
  'remoto'` y `fecha` dentro del rango. Filtrar por fecha en SQL está permitido, y
  contar filas también, porque es un entero. Lo que §4.15 prohíbe es agregar
  columnas decimales.
- **`ServicioDeReportes`** recibe ese repositorio como dependencia obligatoria y
  agrega `anulacionesRemotas` al resumen, con el mismo `periodo` resuelto que el
  resto: días de Guatemala, con el extremo de fin de día inclusivo. **Cuenta por
  la fecha de la ANULACIÓN, no por la de la venta:** la pregunta es cuántas
  autorizaciones a distancia hubo en el período.
- **El DTO** `ResumenDeVentasIpc` suma el campo. El canal ya exige el rol
  administrativo.
- **La pantalla** lo muestra en un renglón de referencia, «Anulaciones
  autorizadas a distancia», **fuera** de la condición «No hay ventas completadas
  en este período». Si la única venta del día se anuló a distancia, el período no
  tiene ventas completadas, y dentro de la condición el contador quedaría
  escondido justo en el caso que tiene que mostrar.

### 3.5 Una propuesta que NO está incluida

Hoy el largo de cada teclado de autorización y `ACEPTA_PIN_REMOTO` son dos
lugares que tienen que coincidir, y nada lo exige. Coinciden en las seis
superficies (tabla de §0). Una prueba estructural podría atarlos: cada diálogo de
autorización confirmaría 6 dígitos si y solo si su superficie acepta el remoto.

Que no coincidan falla **cerrado** en las dos direcciones, así que no es un
agujero de seguridad:

- con el teclado en `[4]` y la superficie en `true`, el código no se puede
  teclear;
- con el teclado en `[4, 6]` y la superficie en `false`, seis dígitos dan
  `FORMATO_INVALIDO`, sin consumir intento.

Queda como tarea opcional (T-opt) y se hace solo si Julio la pide.

---

## 4. Las pruebas

### 4.1 Nuevas

**Servicio, con la base real, la autenticación real y un secreto TOTP sembrado**
(el mismo recurso que ya usa `servicio-de-anulacion.test.ts`):

- **CA-1:** el código vigente de Jimmy anula una venta en efectivo. La fila queda
  con `autorizada_via = 'remoto'` y `autorizada_por = Jimmy`, y el asiento
  `venta_anulada` dice `autorizadaVia: 'remoto'`.
- **CA-2:** lo mismo con tarjeta, después del voucher correcto.
- **CA-3:** el PIN de 4 dígitos sigue dejando `'presencial'`. Si una prueba de
  hoy ya lo cubre, no se duplica: se cita.
- **CA-6:** un código equivocado de 6 dígitos da `PIN_INCORRECTO`, suma un
  intento y deja su asiento con el código. Tres equivocados dan
  `AUTORIZACION_BLOQUEADA` por 30 segundos.
- **CA-7:** con el mismo código, la segunda anulación no se autoriza. *(Al construir: `CODIGO_YA_USADO`, que cuenta como intento; lo fija la prueba y el arnés.)*
- **CA-8:** con la caja de la venta cerrada, un código correcto recibe
  `CAJA_DE_LA_VENTA_CERRADA`, sin consumir intento ni el paso del código. El paso
  se comprueba así: el mismo código sirve después para otra venta de la caja
  abierta.

**El flujo:** el DTO que vuelve a la ventana dice `autorizadaVia: 'remoto'`
(CA-1, CA-4).

**La 040** (archivo nuevo, `anulacion-autorizacion-remota.test.ts`):

- sobre una base migrada entera, `'remoto'` entra y la restricción ya no está en
  el esquema guardado;
- el CHECK de la columna sigue rechazando cualquier otra vía, y el `NOT NULL`
  sigue;
- sobre una base en la 039 con anulaciones `'presencial'`, la 040 se aplica sola
  y deja las filas idénticas.

**El espejo:** la 040 y la 0040 quitan la misma restricción con la misma
sentencia, y ninguna agrega restricciones ni toca el CHECK de la columna
(CA-12).

**El modal (jsdom):** el teclado confirma con 6 dígitos y el código llega entero
al canal. El texto nombra el código de la app. La confirmación dice «A distancia»
si el resultado es `'remoto'` (CA-9).

**El contador (CA-18):**

- **En el servicio,** con la base real y anulaciones de verdad: una remota y una
  presencial en el período dan 1, y una remota de ayer no cuenta en «hoy».
- **El borde de las 18:00 de Guatemala:** una anulación a las 23:30 hora de
  Guatemala (05:30 UTC del día siguiente) cuenta en su día.
- **Con la única venta del día anulada a distancia,** el resumen da 0 ventas y
  1 anulación remota.
- **En la pantalla (jsdom),** el renglón se ve con ventas y también cuando no
  hay ninguna.

### 4.2 Las que cambian, y cómo queda constancia

Cada prueba que cambia conserva, en un comentario, qué exigía antes y por qué
dejó de exigirlo. Es el criterio de «no borrar la historia» que usa todo el
proyecto.

| Prueba | Hoy exige | Pasa a exigir |
|---|---|---|
| `autenticacion.test.ts:900`, «las TRES que lo aceptan» | Tres superficies en `true` | **Cuatro**: suma `anulacion_de_venta` |
| `autenticacion.test.ts:906`, «las TRES que NO lo aceptan…» | `anulacion_de_venta` en `false` | **Dos**: `cierre_de_caja_ajena` y `saltar_lote_de_sincronizacion`. La anulación sale de la lista, con la constancia |
| `autenticacion.test.ts:914`, «el comportamiento real coincide con la tabla» | — | No cambia: recorre la tabla, así que ahora exige que la anulación acepte el código |
| `servicio-de-anulacion.test.ts:958`, «el CÓDIGO REMOTO (6 dígitos) se rechaza…» | `FORMATO_INVALIDO`, sin intento, sin anular | Se invierte: el código **autoriza** y deja `'remoto'`. Cambia también el título del `describe` |
| `anulacion-solo-presencial.test.ts`, los `describe` de la 038 (líneas 93-127 y 157-191) | Con TODAS las migraciones, `'remoto'` se rechaza y los dos CHECK conviven | Migran **hasta la 038**: siguen probando lo que la 038 hizo, que es historia. Lo de hoy lo prueba el archivo de la 040 |
| `anulacion-solo-presencial.test.ts`, el acoplamiento (líneas 129-155) | Que la base y la tabla digan las dos «no» | **No cambia de lógica:** exige que coincidan, y ahora las dos dicen «sí». Su mensaje nombra la 040 y la 0040 |
| `productos-precio-mayorista.test.ts:108-110` | Con TODAS las migraciones se aplica solo la 039 | Hasta la 039, igual que la T5 de la spec 002 |

### 4.3 Falsificaciones

Una a la vez. Antes y después se comprueba el sha256 del archivo, y se restaura
desde una copia, no con `git checkout`: así se evita lo que pasó en la spec 002
(M11).

| # | Mutación | Qué tiene que caer |
|---|---|---|
| F1 | `anulacion_de_venta: false`, con la 040 puesta | El acoplamiento (la base dice sí, la tabla no), CA-1 y CA-2 del servicio, y la tabla de `autenticacion.test.ts` |
| F2 | Sacar la 040 del migrador, con la tabla en `true` | El acoplamiento (la base dice no, la tabla sí), CA-1 (sale `DATO_INVALIDO`) y CA-10 |
| F3 | El modal sin `largos` (vuelve a `[4]`) | La prueba del modal y, en la app real, el arnés |
| F4 | El flujo pasa `via: 'presencial'` fijo | CA-1 y CA-2 (la fila y el asiento), y el arnés en la app real |
| F5 | La 0040 con otro nombre de restricción, o quitando además el CHECK de la columna | La prueba del espejo |
| F6 | El contador cuenta todas las anulaciones, no solo las remotas | La prueba del servicio que mezcla una remota y una presencial |
| F7 | La pantalla dibuja el contador dentro de la condición «hay ventas» | La prueba de la pantalla sin ventas |

---

## 5. Verificación

### 5.1 La 040 sobre una COPIA de la base de trabajo real

Se hace por el mismo camino que la aplicación (`abrirBaseDeDatos` y
`cerrarBaseDeDatosOrdenadamente`), con una sonda temporal. Se toma el sha256 del
original antes y después, y se verifica `integrity_check`, `foreign_key_check`,
las filas iguales, el esquema sin la restricción y un `INSERT` de `'remoto'` que
entra.

La base de trabajo seguía en la 038 el 2026-09-18, así que la copia va a aplicar
la 039 y la 040. Se informan las dos. **La base de trabajo misma no se migra.**

### 5.2 La 0040 ensayada en un Postgres 17 LOCAL (no es Supabase)

Es la misma receta de §4.53 y §4.66:

- **El montaje.** Postgres de Homebrew en el scratchpad, con lo mínimo de
  Supabase simulado, y las migraciones de `supabase/migrations/` salvo la 0026
  (Storage).
- **El contrato.** El md5 de la salida de `contrato_de_sincronizacion()`, con los
  claims de `restauracion`, antes y después de la 0040: tiene que ser el mismo
  (CA-12). La lista de restricciones de `anulaciones_de_venta`, antes y después.
- **La terminal real subiendo por un puente.** Son los servicios, la bandeja, el
  trabajador y `SupabaseSyncProvider` de verdad (CA-13):
  - **(a)** sin la 0040, un lote de anulación `'presencial'` sube;
  - **(b)** sin la 0040, un lote `'remoto'` da `400` con `23514` y la cola se
    detiene;
  - **(c)** con la 0040 aplicada, «Reintentar» lo sube;
  - **(d)** con la 0040, un lote `'presencial'` sigue subiendo.
  - **(e)** lotes que quedaron **pendientes** mientras se aplica la 0040, como
    los que la tienda puede tener en su cola ese día, suben después sin
    detenerse. Es la pregunta que Julio dejó al aprobar sobre el orden de
    despliegue (§6).
- **Cuánto dura el `ALTER TABLE`.** Hace falta para planear la aplicación en el
  real mientras la tienda opera (§6, paso 8).

### 5.3 En la aplicación real: `verify:pantallas:anulacion`

- **Pasa a 1024×768 exactos**, con la emulación de CDP puesta de nuevo antes de
  cada medición, como `verify:pantallas:1024`. Hoy corre en 1100×900.
- **Suma el camino remoto.** Jimmy inscribe su app por los canales, con el TOTP
  propio del arnés (`scripts/totp-de-arnes.cjs`, escrito aparte del de la
  aplicación). Ana pide anular una cuarta venta. Se teclea un código equivocado
  de 6 dígitos: «PIN incorrecto.», su asiento y un intento más. Después, el
  código bueno.
- **Comprueba todo lo que se ve y se guarda:** la confirmación dice «A
  distancia»; con otra conexión, la fila y el asiento dicen `'remoto'`; y el
  camino presencial de siempre da `'presencial'`.
- **Cuida los pasos del código.** Espera al paso siguiente después de la
  inscripción, porque ese código ya se usó.
- **El paso de autorización entra entero** a 1024×768.
- **Se falsifica en la app:** con F3 y F4.

### 5.4 `npm run verify` completo

---

## 6. El orden de operaciones, de acá a la tienda

| Paso | Qué | Dónde | Condición para seguir |
|---|---|---|---|
| 1 | Fase 1: código, 040, 0040 **escrita**, pruebas y arnés | `develop` | `npm run verify` y el arnés en verde |
| 2 | La 040 sobre una copia de la base de trabajo | scratchpad | CA-5 |
| 3 | La 0040 ensayada en un Postgres 17 local, con la terminal subiendo | scratchpad | CA-12, CA-13 |
| 4 | Julio ve el SQL de la 040 y la 0040. **En esta spec no se aplica en ninguna nube, tampoco en el descartable** (lo pidió al aprobar) | — | Un pedido aparte **para el descartable** |
| 5 | La 0040 en `pos-pruebas-descartable`: aviso a la otra sesión, catálogo antes y después, md5 del registro igual al del archivo, restricción ausente y CHECK de la columna presente, mitad B de la deriva sin diferencias | descartable | La evidencia |
| 6 | *(Opcional, pregunta 4)* una anulación remota subida de verdad contra el descartable | descartable | La aprobación de Julio |
| 7 | Julio aprueba **aparte** la 0040 para `pos-jimmy-cano` | — | Una aprobación separada |
| 8 | La 0040 en `pos-jimmy-cano`: releer el catálogo antes, confirmar que no hay otro escritor ni una transacción larga, aplicar, verificar, y confirmar después, en lectura, que la tienda sigue subiendo (`recibido_en` avanza) | real | La evidencia |
| 9 | Publicar la versión que trae la 040. El número se decide con el release | — | — |
| 10 | **Instalarla en la tienda, cualquier día DESPUÉS del paso 8.** La 040 corre sola al arrancar | tienda | — |
| 11 | Que Jimmy inscriba su app en la terminal, si todavía no lo hizo (pregunta 3) | tienda, en persona | — |

**No hace falta que 8 y 10 sean el mismo día.** Lo único obligatorio es que 8
vaya antes que 10.

**Del paso 8 al paso 10**, la tienda sigue con la 1.3.1 contra una nube más
permisiva, sin ningún efecto. Si alguien instalara la versión nueva sin haber
hecho el paso 8, las anulaciones presenciales seguirían subiendo, y la primera
remota detendría la cola hasta aplicar la 0040 (§1.4).

---

## 7. Documentación

- **CLAUDE.md:**
  - una sección nueva, §4.70, con la reversión, la razón original y la evidencia;
  - la fila de `anulacion_de_venta` en la tabla de §4.9 y la de §4.45, con la
    razón anterior tachada, no borrada;
  - una nota «REVERTIDA el 2026-09-19» en §4.54 y en §4.58 (el teclado de cuatro
    dígitos);
  - en §5, una fila nueva, y la marca «REVERTIDA» en la fila de la 038;
  - en §6.2, la regla de orden, la restauración con versiones anteriores y lo que
    Julio conteste en las preguntas.
- **`docs/ANULACION-DE-VENTA.md`:** §1.1, §4.2, §10.1 y la decisión 2 de §12. Las
  razones de §4.2 se conservan enteras, y se agrega una nota que dice que siguen
  siendo ciertas y que el cliente eligió asumirlas.
- **Los comentarios del código:** `autenticacion.ts` (§3.1) y
  `ModalDeAnulacion.tsx` (§3.2).
- **`supabase/migrations/README.md`:** filas para la 040 y la 0040.
- **`spec/constitution/roadmap.md`:** la fila de la anulación.
- **La 038 y la 0038 no se editan.** Sus cabeceras quedan como historia, y las de
  la 040 y la 0040 remiten a ellas.

---

## 8. Riesgos

| # | Riesgo | Qué lo acota |
|---|---|---|
| R1 | **El fraude de §2 de la spec,** aceptado por el cliente | Solo lo que se registra: la vía, quién autorizó, el motivo y los rechazos. Nada lo impide. La pregunta 2 propone hacer visible la vía para poder revisarla. |
| R2 | Instalar la versión nueva antes de la 0040 | La cola se detiene de forma visible y se recupera sin perder nada (§1.4). El orden de §6 lo evita. |
| R3 | Restaurar con una versión anterior | Se restaura con esta versión o una posterior (spec §5.5). Queda en §6.2 de CLAUDE.md. |
| R4 | Jimmy sin inscribir | La vía remota no funciona hasta que se inscriba, y nada se rompe (pregunta 3). |
| R5 | Volver atrás más adelante | No es simétrico (spec §5.6). Se decide con otro diseño si hiciera falta. |
| R6 | El `?? 'presencial'` del flujo (`anulacion-de-venta.ts:124`) | Es inalcanzable con un permiso concedido: los dos caminos de éxito ponen la vía (`autenticacion.ts:438` y `:524`). Si un cambio futuro lo volviera alcanzable, una autorización remota se guardaría como presencial, justo la dirección que esconde el riesgo, y CA-1 lo atraparía. **No se toca**, porque el pedido es no cambiar ese mecanismo. |
| R7 | El `ALTER TABLE` en el real mientras la tienda opera | Toma un bloqueo exclusivo sobre `anulaciones_de_venta` mientras dura. Quitar un CHECK no reescribe la tabla ni recorre filas. Cuánto dura se mide en el ensayo (§5.2), y se aplica sin transacciones largas en curso (§6, paso 8). |
| R8 | Windows | No se verifica, como siempre. |

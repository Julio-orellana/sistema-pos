# Anulación de una venta — documento de diseño

> **Estado: APROBADO entero el 2026-09-15. El NÚCLEO LOCAL está construido**
> (secciones 1, 2, 3.1 a 3.4, 4 y 6; migraciones locales 033 y 034; ver
> CLAUDE.md §4.45). **Falta:** la sincronización (7), la restauración (8), el
> recibo (5), el reporte de cobros con tarjeta (3.5) y la pantalla.
> Escrito el 2026-09-15. Ninguna migración de este documento se aplica a ningún
> proyecto de Supabase —tampoco a `pos-pruebas-descartable`— sin que Julio vea
> el SQL completo primero.
>
> **Decisión 9 resuelta el 2026-09-15** (sección 3.3 y la tabla de la sección 12).

## Alcance decidido (no se reabre)

- Se anula una venta **solo si la caja donde se registró sigue abierta**, sin
  importar quién la abrió. Con la caja cerrada no hay anulación posible.
- **PIN de administrador siempre**: también cuando el cajero corrige su propio
  error, y también cuando quien anula es administrador.
- Se anula **la venta completa**, nunca líneas sueltas.
- **El inventario se repone siempre** que se anula.
- En la nube, la anulación sube como **un hecho nuevo que referencia a la
  venta**. La fila de `ventas` de la nube no se modifica nunca.

## Índice

0. [Qué se leyó, y lo que apareció antes de diseñar](#0-qué-se-leyó-y-lo-que-apareció-antes-de-diseñar)
1. [Modelo de datos](#1-modelo-de-datos)
2. [Reposición de inventario](#2-reposición-de-inventario)
3. [El efectivo esperado de la caja](#3-el-efectivo-esperado-de-la-caja)
4. [Autorización](#4-autorización)
5. [El recibo](#5-el-recibo)
6. [Auditoría](#6-auditoría)
7. [Sincronización](#7-sincronización)
8. [Restauración](#8-restauración)
9. [Migraciones que hacen falta](#9-migraciones-que-hacen-falta)
10. [Cómo se va a verificar](#10-cómo-se-va-a-verificar)
11. [Lo que este diseño no hace](#11-lo-que-este-diseño-no-hace)
12. [Decisiones que este diseño te pide](#12-decisiones-que-este-diseño-te-pide)

Y, dentro de la sección 3, [3.5 El reporte de cobros con tarjeta](#35-el-reporte-de-cobros-con-tarjeta).

---

## 0. Qué se leyó, y lo que apareció antes de diseñar

Se leyó CLAUDE.md completo y el código que una anulación toca: los dos
esquemas, `ServicioDeVenta`, los repositorios de ventas y productos, el
servicio y el flujo de cierre de caja, las funciones de la `0023` y de la
`0027`, el proveedor de Supabase, el enrutador de lotes, la restauración y el
recibo. Siete cosas condicionan lo que sigue.

### 0.1 Dos números de prompt, para no confundirlos

La transacción atómica de la venta es la **§4.13** de CLAUDE.md, del Prompt 19.
El **Prompt 7** es otra cosa: la política de cero reintentos ante un conflicto
de inventario (§4.3). Este diseño usa las dos.

### 0.2 En la nube, «ventas solo se inserta» NO rechaza una venta distinta: la ignora sin avisar

El riesgo 8.4 hizo que toda escritura de la terminal pase por una función
`SECURITY DEFINER`, y la regla de cada tabla vive dentro de esas funciones. La
de `ventas` es esta:

```sql
-- supabase/migrations/0023_funciones_de_sincronizacion.sql:643-651
WHEN 'ventas' THEN
  ...
  IF (cambio ->> 'operacion') <> 'insertar' THEN
    RAISE EXCEPTION 'FORMA: ventas solo se inserta';
  END IF;
  venta := cambio -> 'datos';
  constancias := constancias || public.escribir_fila('public.ventas'::regclass, venta, 'ignorar');
```

`ignorar` es `INSERT … ON CONFLICT (id) DO NOTHING`, y el resultado es
`ya_existia` **sin comparar el contenido** (`0023:243-258`). Del lado de la
terminal, `ya_existia` cuenta como éxito:

```ts
// src/main/sincronizacion/supabase-sync-provider.ts:86
const RESULTADOS_DE_EXITO = ['insertada', 'actualizada', 'ya_existia', 'sin_cambios'] as const;
```

Las dos formas ingenuas de subir una anulación fallan, y una de ellas en
silencio:

| Implementación ingenua | Qué pasaría |
|---|---|
| Encolar la fila de `ventas` como `actualizar`, con `estado = 'anulada'` | La función contesta `FORMA: ventas solo se inserta`. Es un error determinístico y **la cola se detiene**. |
| Encolar la fila de `ventas` otra vez como `insertar` | La función contesta `ya_existia`, **la terminal lo toma como éxito y lo marca subido**, y la nube sigue diciendo `completada`. Nadie se entera. |

La apertura y el cierre de caja sí comparan el contenido y rechazan uno
distinto (§4.20). `ventas` no. Por eso lo que decidiste para la nube no es una
cuestión de estilo: **es la única forma de que la anulación llegue**. Este
diseño prohíbe, además, volver a encolar una fila de `ventas` ya insertada.

> **Recomendación aparte, fuera de este diseño:** que `sincronizar_venta`
> compare la huella cuando la venta ya existe y rechace un contenido distinto,
> como ya hacen las cajas. Cerraría esta pérdida silenciosa para cualquier
> error futuro, no solo para la anulación. Es una migración de la nube y se
> decide por separado.

### 0.3 El esquema ya estaba preparado para OTRA forma de anular

- `ventas.estado` admite `'anulada'` desde el principio (`001:338` y `0001:206`).
- `RepositorioDeVentas.anular()` hace `UPDATE ventas SET estado = 'anulada'`
  (`ventas.ts:184-190`). **Ningún código de producción lo llama**: solo dos
  pruebas (`repositorios.test.ts:376` y `reportes.test.ts:208`).
- Cuatro consultas filtran `estado = 'completada'`: `ventas.ts:156`,
  `ventas.ts:203`, `ventas.ts:225` y `venta-detalle.ts:138`.

Este diseño **no** usa ese camino. La razón está en la sección 1.

### 0.4 §4.3 promete un asiento ante un conflicto de inventario, y la venta no lo escribe

La tabla de §4.3 dice «¿Queda registrado? Sí, un asiento de auditoría». En el
código, `ServicioDeVenta.registrar` lanza `errorDeConflictoDeInventario` dentro
de la transacción (`servicio-de-venta.ts:236-249` y `:326-339`). La transacción
se revierte entera y nadie escribe nada después: `CONFLICTO_DE_INVENTARIO` solo
aparece en `errores.ts` y en ese servicio.

La anulación sí lo registra (sección 2.5). El hueco de la venta queda señalado
para arreglarlo por separado.

> **ARREGLADO EL 2026-09-15.** La venta escribe el asiento `conflicto_de_inventario`
> después de revertir, en su propio lote, con `operacion: 'venta'` (CLAUDE.md
> §4.3). Dos cosas quedaron abiertas: sus claves no coinciden con las de la
> anulación (punto 23 de §6.2 de CLAUDE.md), y un segundo escritor en otra
> conexión no llega a ningún asiento, porque la transacción abre `BEGIN` y no
> `BEGIN IMMEDIATE` (punto 22).

### 0.5 El comentario de la migración 015 dice que `cantidad_vendida` «nunca baja»

```sql
-- src/main/database/migrations/015_cantidad_vendida.sql:49-50
-- Sin GLOB '-*': acumula ventas, nunca baja. Las mermas y las
-- devoluciones son módulos futuros y traerán su propio camino.
```

Este diseño **la hace bajar** al anular, y la sección 2.4 dice por qué. El
CHECK solo prohíbe el negativo; lo que contradice es el comentario. Una
migración aplicada no se edita (su checksum lo impide), así que la aclaración va
a CLAUDE.md, igual que la nota de §4.2 sobre el comentario viejo de la 001.

### 0.6 El pedido llegó cortado

El punto 6 terminaba en «quién vendió originalmente, quién anuló, quién». Se
completó con quién autorizó y el motivo. Las secciones 7 a 12 son lo que el
alcance decidido obliga a resolver. Si el pedido tenía puntos después del 6, no
llegaron.

### 0.7 El cierre de caja decide leyendo la bitácora, y en un caso cierra sin dejar constancia de quién autorizó

Agregado el 2026-09-15, al contestar si algún código usa `auditoria_log` como
fuente de verdad.

**`valor_anterior` no lo usa ningún código para decidir ni para calcular.** Su
único lector es el historial de cajas (`historial-de-cajas.ts:305`), que lo
muestra en pantalla.

**`valor_nuevo` sí.** `ServicioDeCaja.conteosSelladosDe`
(`servicio-de-caja.ts:664-683`) lee los asientos `conteo_de_cierre_sellado`, e
`intentarCerrar` decide con ellos tres cosas:

- si hay que escribir un sello nuevo (`:486-499`);
- si un cierre que cuadra exige PIN (`:511-527`);
- si hubo reconteo (`:532`), comparando **solo el monto contado**.

El asiento `reconteo_de_cierre_autorizado` es la única constancia de quién
autorizó un cierre que cuadra, porque la 008 obliga a dejar vacías esas columnas
de `caja_sesiones`. Y se escribe **solo si hubo reconteo** (`:597`).

**La consecuencia, medida** con una prueba temporal sobre SQLite real, que se
borró y no está en el repositorio. Si el esperado cambia entre el sello y el
conteo final, y el número contado es el mismo:

- el cierre exige el PIN;
- se cierra con el PIN;
- y **el id de quien autorizó no queda en ningún asiento ni en
  `caja_sesiones`**.

Pasa hoy, con un sobrante y después una venta en efectivo por el mismo monto.
Con la anulación pasaría en el caso del fraude más común: falta dinero, y se
anula una venta por ese monto.

```
[anulacion] 1) venta de Q27.50; cuenta Q500 con esperado 527.50 -> REQUIERE_AUTORIZACION, diferencia -27.50
[anulacion] 2) se anula esa venta; confirma otra vez Q500 -> REQUIERE_AUTORIZACION_DE_RECONTEO, esperado 500.00, diferencia 0.00
[anulacion]    mensaje que ve quien autoriza: Antes se confirmó un conteo de Q500.00 con un FALTANTE de Q27.50. Corregir un conteo que mostraba una diferencia exige la autorización de un administrador, aunque ahora cuadre.
[anulacion] 3) PIN de Jimmy -> autenticado=true
[anulacion] 4) cierre con esa autorización -> cerrada=true CIERRE_CORRECTO
[anulacion] asiento caja_cerrada usuario=Cajera … "autorizadaPor":null,"autorizadaVia":null,"conteosSellados":1,"huboReconteo":false}
[anulacion] caja_sesiones: {… "diferencia_autorizada_por":null,"diferencia_autorizada_via":null,"cerrada_por":null}
[anulacion] el id de Jimmy (quien tecleó el PIN) aparece en 0 asiento(s) y en 0 fila(s) de caja_sesiones
```

La anulación de ese ensayo se simuló con `RepositorioDeVentas.anular()`, que ya
existe. Tiene sobre el esperado el mismo efecto que la anulación de este
documento. El mensaje, además, habla de «corregir un conteo» cuando el número
contado no cambió: lo que cambió fue el esperado.

**Hay que arreglarlo antes de implementar la anulación** (decisión 12).
Recomiendo dos cambios:

- escribir el asiento de la autorización siempre que el cierre se haya
  autorizado por un sello, y no solo cuando cambió el número contado;
- que el mensaje diga que cambió el esperado cuando esa es la razón.

> **ARREGLADO EL 2026-09-15**, en el cambio aparte que se hizo antes de
> implementar la anulación (commits `cff3c41`, `473153e`, `8eadc24`). Las dos
> recomendaciones se aplicaron tal cual. El escenario del sobrante y la venta y
> el del esperado que baja quedaron como pruebas permanentes en
> `servicio-de-caja.test.ts`, y el primero también en `verify:pantallas:caja`.
> Evidencia y falsificación en CLAUDE.md §4.39.

---

## 1. Modelo de datos

### 1.1 Decisión: una tabla nueva, y la fila de la venta no se toca nunca

Se agrega **`anulaciones_de_venta`**, con una fila por venta anulada. La fila de
`ventas` no se modifica: ni `estado`, ni `actualizado_en`, ni ningún monto.
`venta_detalle` y `recibos` tampoco.

> **Regla única: una venta está anulada si y solo si existe su fila en
> `anulaciones_de_venta`.** Vale igual en la terminal, en la nube y en una base
> restaurada.

En términos contables es un **asiento de reversión**: el hecho original queda
escrito tal como ocurrió, y la reversión es otro hecho, con su fecha, su motivo
y sus responsables.

Esquema local propuesto:

```sql
CREATE TABLE IF NOT EXISTS anulaciones_de_venta (
  id              TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  -- UNIQUE: una venta se anula una sola vez.
  venta_id        TEXT NOT NULL UNIQUE REFERENCES ventas (id) ON DELETE RESTRICT,
  -- Quién tenía la sesión cuando se pidió la anulación.
  solicitada_por  TEXT NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  -- El administrador cuyo PIN coincidió. Puede ser la misma persona.
  autorizada_por  TEXT NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  autorizada_via  TEXT NOT NULL CHECK (autorizada_via IN ('presencial', 'remoto')),
  motivo          TEXT NOT NULL CHECK (length(trim(motivo)) > 0 AND length(motivo) <= 200),
  fecha           TEXT NOT NULL CHECK (fecha LIKE '____-__-__T__:__:__%Z')
);
```

Y un disparador que rechaza `UPDATE` y `DELETE`, igual que el de
`auditoria_log`: es evidencia de un control contra el fraude, y una anulación
que se puede editar o borrar no sirve como evidencia.

Tres detalles del esquema:

| Detalle | Por qué |
|---|---|
| **No copia** el total, la forma de pago, quién vendió ni la caja | Todo eso está en `ventas`, que no cambia nunca. Una copia sería un segundo lugar que puede discrepar. La nube encuentra la caja leyendo la venta. |
| `autorizada_via` admite `'remoto'` aunque la sección 4.2 recomienda no aceptarlo | Qué superficie acepta el PIN remoto vive en **una sola tabla**, `ACEPTA_PIN_REMOTO` (§4.9). Repetir esa política en un CHECK crearía el segundo lugar que el proyecto ya eliminó. Guardar la vía deja la fila leíble sola, y ampliar la política un día no exigiría migración. |
| Motivo obligatorio, hasta 200 caracteres | Es el mismo tope del motivo del ajuste de inventario (`servicio-de-productos.ts:73`). La diferencia es que acá no puede ir vacío: una anulación sin motivo no se puede revisar. |

### 1.2 Las tres formas posibles, y por qué esta

| Forma | Qué pasa en la nube | Qué pasa al restaurar | Veredicto |
|---|---|---|---|
| **A.** Columnas nuevas en `ventas` (anulada en, por, motivo…) | La fila ya subió y la nube solo la inserta: **las columnas nunca llegan** (0.2) | La venta vuelve como válida: el efectivo y los reportes **la cuentan otra vez** | Descartada: pierde la anulación |
| **B.** `ventas.estado = 'anulada'` más una fila hermana | La nube dice `completada` para siempre, por el alcance decidido | Llega `completada` con su fila hermana, y **hay que volver a poner `anulada` después de bajar**, en cada camino (también en «restaurar igual» fila por fila) | Descartada: ver abajo |
| **C.** Solo la fila hermana (la elegida) | Idéntica a la terminal | Se restaura como una tabla más, sin paso extra | **Elegida** |

**La razón decisiva contra B:** en la nube `ventas.estado` va a decir
`completada` para siempre, porque así lo decidiste. Si en la terminal esa misma
columna dijera `anulada`, **la misma columna de la misma fila significaría dos
cosas en dos copias**. Eso obliga a compensar en la restauración y en cualquier
camino que traiga ventas desde la nube. C no tiene nada que compensar.

### 1.3 Lo que cuesta C, dicho en voz alta

1. **`ventas.estado` queda en `completada` en toda venta, también en las
   anuladas.** Quien lea la tabla cruda sin mirar `anulaciones_de_venta` va a
   ver una venta anulada como completada. Se dice en el código, en CLAUDE.md y
   en el `COMMENT` de la columna en Postgres. La columna no se quita ni se le
   cambia el CHECK: sería el rebuild de doce pasos (`venta_detalle` y `recibos`
   la referencian) y un cambio de contrato con la nube.
2. **Las cuatro consultas de 0.3 cambian** de `estado = 'completada'` a «no
   tiene anulación». El filtro vive en un solo fragmento con nombre. Una prueba
   estructural, como la del `SUM()` de §4.15, falla si alguna consulta de
   ventas decide por `estado`.
3. **`RepositorioDeVentas.anular()` se elimina.** Es el camino que este diseño
   descarta, y dejarlo invita a usarlo. Sus dos pruebas pasan a insertar una
   fila de anulación.
4. **Una prueba estructural exige que ningún archivo de producción escriba
   `'anulada'`.**

### 1.4 Qué sostiene cada invariante

| Invariante | Quién lo sostiene |
|---|---|
| Una venta se anula una sola vez | `UNIQUE (venta_id)` en los dos esquemas; el servicio, con un mensaje claro; la función de la nube |
| Solo con la caja de la venta abierta | El servicio, dentro de la transacción; la función de la nube (7.3) |
| Una anulación no se edita ni se borra | Disparador en los dos esquemas; en Postgres además sin privilegios de escritura (0024) y solo con `ignorar` |
| No hay anulación sin motivo | CHECK en los dos esquemas y el servicio |
| No hay anulación sin autorizante | `autorizada_por NOT NULL`; el servicio solo la escribe con un PIN aceptado |

---

## 2. Reposición de inventario

### 2.1 La reposición SUMA sobre el saldo de hoy, no vuelve al saldo de entonces

Es la regla central de esta sección. Un ejemplo con el maíz:

| Hora | Hecho | Saldo |
|---|---|---|
| 08:00 | Saldo al abrir | 100.000 lb |
| 09:00 | Venta A de 5 lb | 95.000 |
| 10:00 | Ajuste de inventario: llegaron 50 lb | 145.000 |
| 11:00 | Venta B de 3 lb | 142.000 |
| 12:00 | **Se anula la venta A** | **147.000** = 142.000 + 5.000 |

El asiento de la venta A guardó `saldoAnterior: 100.000`. **Volver a ese número
borraría el ajuste y la venta B.** Por eso la anulación nunca usa los saldos del
asiento de la venta: lee el saldo actual y le suma lo vendido.

### 2.2 Los pasos, en una sola transacción

Todo ocurre dentro de `enTransaccionDeNegocio`, igual que la venta (§4.13). Si
cualquier paso falla, no queda nada escrito. El PIN se verifica **antes** de
abrir la transacción (sección 4).

| # | Paso | Por qué va donde va |
|---|---|---|
| 1 | Se reverifica que la venta exista, que no tenga anulación y que su caja siga `abierta` | Entre la vista previa y el PIN alguien pudo cerrar la caja o anular la venta. Va antes de tocar nada. |
| 2 | Se leen las líneas de `venta_detalle` y se **agrupan por producto**, sumando con Decimal | Un producto, una lectura y una escritura. Hoy la venta rechaza el mismo producto dos veces, pero el esquema no lo impide. |
| 3 | Por cada producto se lee su fila **dentro de la transacción** y se calculan el saldo nuevo y los contadores nuevos, con todas sus validaciones (2.3) | Todas las validaciones antes de la primera escritura. |
| 4 | **Comparar-y-cambiar del inventario**, producto por producto | Primera escritura. |
| 5 | **Comparar-y-cambiar de los contadores**, en un solo `UPDATE` (2.4) | La misma transacción, por la misma razón que el paso 6 de la venta. |
| 6 | Se inserta la fila de `anulaciones_de_venta` | |
| 7 | Se escribe el asiento `venta_anulada` (sección 6) | |
| 8 | Se encola el lote (sección 7) | Dentro de la misma transacción, como toda la bandeja de salida (§4.17). |

El comparar-y-cambiar del paso 4 es el de §4.3, con la suma en vez de la resta:

```sql
UPDATE productos
   SET inventario_disponible = :saldoLeido_mas_cantidad,   -- calculado con Decimal
       actualizado_en        = :ahora
 WHERE id = :productoId
   AND inventario_disponible = :saldoLeido;
```

`changes = 0` es un conflicto, y se trata como en la sección 2.5.

**Qué protege el comparar-y-cambiar:** la ventana entre la lectura del paso 3 y
la escritura del paso 4. **No** protege la historia desde la venta: esa
historia no importa, por 2.1.

### 2.3 Qué pasa en cada caso

| Caso | Qué hace la anulación | Por qué |
|---|---|---|
| Hubo un **ajuste de inventario** entre la venta y la anulación | Nada especial: suma sobre el saldo que lee adentro | 2.1 |
| Hubo **otra venta** del mismo producto entre las dos | Lo mismo | 2.1 |
| El saldo cambió **entre la lectura y la escritura** de la propia anulación | `CONFLICTO_DE_INVENTARIO`: se revierte todo, cero reintentos | §4.3. Con una sola conexión síncrona no debería poder pasar; si pasa, hay un segundo escritor. |
| El producto está **desactivado** | Se repone igual, no se reactiva, la vista previa lo avisa y el asiento lo anota | §4.11: desactivar conserva el inventario y la mercadería volvió igual |
| La venta fue **con tarjeta** y el voucher tecleado no coincide con el de la venta | **Se rechaza antes de pedir el PIN**, sin escribir nada | Decisión 9. Ver 3.3. |
| Cambió la **unidad** del producto (`tipo_medida` o `unidad_peso`) | **Se rechaza la anulación entera antes de pedir el PIN**, sin escribir nada | No hay factores de conversión (§6.2, punto 1). Sumar 2.500 lb a un producto que hoy se cuenta por unidad dejaría un saldo falso **sin ningún error**. Se compara la foto `venta_detalle.unidad_snap` con la unidad actual, calculada igual que al vender (`servicio-de-venta.ts:687-689`). |
| `cantidad_vendida` quedaría **negativa**, o `contador_ventas` bajaría **de cero** | Se rechaza, sin corregir en silencio | Son datos inconsistentes. Los CHECK de la 015 y de la 001 son la última red. |
| Cambiaron el precio, el costo o el nombre | No importa | La reposición mueve cantidades. El dinero sale de `ventas.total`, que no cambió. |

El mensaje de la unidad cambiada, propuesto:

> «La unidad de Maíz blanco cambió desde la venta (se vendió en lb y hoy se
> cuenta por unidad). El sistema no tiene cómo convertir la cantidad, así que la
> venta no se anuló.»

Como la caja sigue abierta, la salida existe: volver a poner la unidad con que
se vendió, anular y volver a cambiarla. Cada cambio queda en su asiento.

### 2.4 Los contadores del producto también bajan

```sql
UPDATE productos
   SET contador_ventas  = contador_ventas - 1,
       cantidad_vendida = :cantidadLeida_menos_cantidad,     -- calculado con Decimal
       actualizado_en   = :ahora
 WHERE id = :productoId
   AND cantidad_vendida = :cantidadLeida
   AND contador_ventas >= 1;
```

Es el espejo de `registrarVentaDeProducto` (`productos.ts:310-333`): los dos
contadores se mueven en un solo `UPDATE`, para que sea imposible mover uno sin
el otro (§4.13).

**Por qué bajan, aunque la 015 diga «nunca baja» (0.5):**

1. **Hay una prueba que ya exige que bajen.** `reportes.test.ts:478-485` suma
   los reportes por período y exige que den `productos.cantidad_vendida`: «son
   los mismos hechos». Los reportes van a excluir la venta anulada. Si el
   acumulado no bajara, esa igualdad se rompería con la primera anulación.
2. **La conciliación de inventario.** `cantidad_vendida` existe para conciliar
   contra el saldo (§4.13). Si el saldo sube 5 lb al reponer y lo vendido no
   baja 5 lb, la conciliación queda 5 lb corrida para siempre.
3. **El orden de la cuadrícula.** Una venta anulada no es una vez vendida: no
   debe subir el producto en la pantalla de venta.

El comentario de la 015 pedía que las devoluciones «trajeran su propio camino».
Este es ese camino.

### 2.5 Si el comparar-y-cambiar falla

Rige la política de §4.3 sin cambios:

| Pregunta | Respuesta |
|---|---|
| ¿Reintenta sola? | No, ninguna vez |
| ¿Qué se revierte? | Todo: inventario, contadores, la fila de anulación, el asiento y el lote |
| ¿Qué ve quien pidió? | `CONFLICTO_DE_INVENTARIO`: «El inventario de {producto} cambió mientras se anulaba. La venta no se anuló. Volvé a intentarlo.» |
| ¿Queda registrado? | **Sí.** Después de la reversión, en una transacción aparte, se escribe el asiento `conflicto_de_inventario` (sección 6), que sube por `sincronizar_asiento` |
| ¿Hay que volver a teclear el PIN? | Sí. La autorización fue para un intento que no ocurrió |

### 2.6 Una observación, sin cambio

`ajustarInventario` lee el producto **fuera** de su transacción y escribe con
`fijarInventario`, que no compara nada (`servicio-de-productos.ts:627-631`,
`productos.ts:231-237`). Con una sola conexión síncrona no hay forma de que algo
se meta en el medio. La anulación no depende de eso, porque compara su propia
lectura. No se toca en este diseño.

---

## 3. El efectivo esperado de la caja

### 3.1 La fórmula

Es la misma de §4.10, con la anulación en el filtro:

```
monto_esperado(S) = monto_inicial(S)
                  + Σ total(v)   para cada venta v con
                                 v.caja_sesion_id = S,
                                 v.forma_pago = 'efectivo',
                                 y SIN fila en anulaciones_de_venta
```

El filtro va en SQL; la suma, con Decimal (§4.15):

```sql
SELECT v.* FROM ventas v
 WHERE v.caja_sesion_id = ?
   AND v.forma_pago = 'efectivo'
   AND NOT EXISTS (SELECT 1 FROM anulaciones_de_venta a WHERE a.venta_id = v.id)
 ORDER BY v.fecha;
```

Es la misma consulta que hoy usa `totalesEnEfectivoDeSesion`
(`ventas.ts:218-228`), así que `montoEsperadoDe` y el resumen del turno siguen
saliendo de un solo cálculo (`servicio-de-caja.ts:395-411`). **No hay una
segunda fórmula.**

### 3.2 Por qué excluir y no restar

Como solo se anula con la caja abierta, la venta y su anulación caen siempre en
el mismo turno. Excluir la venta da exactamente el mismo número que sumarla y
restarla, sin inventar un movimiento negativo que no existe.

Ejemplo:

| Hecho | Esperado |
|---|---|
| Caja abierta con Q500.00 | Q500.00 |
| Venta A en efectivo, Q27.50 | Q527.50 |
| Venta B con tarjeta, Q40.00 | Q527.50 |
| Venta C en efectivo, Q12.00 | Q539.50 |
| **Se anula A** | **Q512.00** |
| **Se anula B** | **Q512.00**, sin cambio |

### 3.3 Con tarjeta: el voucher de la venta original (decisión 9, resuelta)

No cambia el efectivo esperado, igual que al registrarla: ese dinero nunca
entró al cajón. **La devolución al cliente se hace en la terminal del banco, y
el sistema no tiene cómo verlo.**

**Lo decidido el 2026-09-15:**

1. Para anular una venta **con tarjeta**, el flujo pide el **número de voucher**
   junto con el motivo, **antes de la vista previa**. Es el mismo momento en que
   se valida la unidad cambiada (2.3).
2. Se compara contra `ventas.num_boleta` **de esa venta exacta**.
3. Si no coincide, se rechaza con el mensaje «El voucher no coincide con el de
   la venta original» y **no se llega a pedir el PIN**.
4. **No hay tabla de vouchers ni columna nueva.** El voucher ya está guardado en
   la venta desde que se cobró. Para ver qué cobros con tarjeta quedaron
   anulados hay un reporte de solo lectura (3.5).

**Cómo se compara, con precisión:**

| Pregunta | Respuesta |
|---|---|
| ¿Contra qué? | `ventas.num_boleta` de la fila con ese `venta_id`. Nunca contra otras ventas: un voucher correcto de otra venta se rechaza igual. |
| ¿Qué normalización? | Se quitan los espacios de los dos extremos **de los dos lados**, y nada más. Distingue mayúsculas y **no** quita ceros a la izquierda: `0012` y `12` son distintos. |
| ¿Por qué recortar también lo guardado? | La pantalla de cobro recorta la boleta antes de mandarla (`cobro.ts:100`), pero `ServicioDeVenta` la guarda **tal como llega** (`servicio-de-venta.ts:267`) y solo la recorta para validar (`:508`). Una venta cobrada llamando al canal a mano podría tener espacios guardados. |
| ¿Y si la venta fue en efectivo? | No se pide voucher. Si el pedido trae uno, se rechaza con `DATO_INVALIDO` («Una venta en efectivo no lleva voucher»), igual que el cobro rechaza una boleta en efectivo. |
| ¿Y si es con tarjeta y falta el voucher? | Se rechaza antes del PIN: «Esta venta fue con tarjeta: escribí el número de voucher». |
| ¿Puede una venta con tarjeta no tener `num_boleta`? | No. La migración 014 lo exige no vacío (`ventas_boleta_solo_con_tarjeta`). Para ventas anteriores a la 014 es **inferencia, no medición**: SQLite se niega a agregar un CHECK que una fila existente viola, medido para la 008 (§4.9), así que una base con una venta así no habría llegado a aplicar la 014. En la nube, la 0014 quedó `convalidated = true` (§4.4). |
| ¿El mensaje dice cuál era el voucher correcto? | No. |
| ¿Consume un intento del candado de PIN? | No. No se llegó a comparar ningún PIN (§4.1). |
| ¿Deja asiento? | **No, igual que la unidad cambiada**: no se escribió nada ni se pidió autorización. Queda en la sección 12 (decisión 13) por si preferís lo contrario. |
| ¿Se vuelve a comparar con el PIN? | Sí. El pedido con PIN trae el voucher otra vez y la transacción de 2.2 lo valida de nuevo, como todo lo demás. |
| ¿Se guarda el voucher tecleado? | No hace falta: si la anulación existe, el voucher tecleado **es** `ventas.num_boleta`, y ese ya va en `valor_anterior.numBoleta` del asiento (6.2). |

> **LO QUE ESTE CONTROL GARANTIZA Y LO QUE NO, dicho en voz alta.** El número de
> boleta **sale impreso en el recibo** (`plantilla-de-recibo.ts:182-183`), y la
> reimpresión desde el historial de recibos muestra ese mismo texto a cualquiera
> con sesión (§4.14). Entonces el voucher prueba que quien anula **tiene a mano
> el número de esa venta**, y evita anular la venta equivocada por un error de
> número de recibo. **No prueba que tenga el comprobante del banco**, porque el
> número se puede leer de la reimpresión. El control contra el fraude sigue
> siendo el PIN de administrador (sección 4). No reabro la decisión: lo dejo
> escrito para que nadie le atribuya al voucher más de lo que da. Queda como
> decisión 14 por si querés cambiar algo.

### 3.4 Lo que la anulación toca de la caja abierta

| Qué | Qué pasa |
|---|---|
| El efectivo del cajón | Quien anula le devuelve el dinero al cliente. Si no lo devuelve, el cajón queda con más de lo esperado y el cierre da **sobrante**, que exige autorización (§4.9). El control detecta que el dinero no salió. |
| El resumen del turno | Las ventas en efectivo y su cantidad bajan. Solo lo ve un administrador (§4.40). |
| Una autorización de cierre pendiente | **Deja de valer sola**: el flujo compara el esperado y contesta «El monto cambió después de autorizarse» (`cierre-de-caja.ts:182-194`). |
| Los conteos sellados | Quedan como estaban, y un turno con un sello se sigue cerrando solo con autorización (§4.39). ~~Pero hoy, si el número final es el mismo del sello, esa autorización no queda registrada en ningún lado (0.7).~~ **Arreglado el 2026-09-15:** quien autoriza queda en `reconteo_de_cierre_autorizado`, con `cambioElEsperado: true` cuando la causa fue la anulación. |
| El historial de cajas (§4.44) | No cambia: muestra el esperado que se guardó al cerrar, y ese ya incluye la anulación. |
| Lo que ve el rol venta | Nada del teórico. La respuesta de la anulación nunca lo lleva (§4.40). |

### 3.5 El reporte de cobros con tarjeta

Una sección de solo lectura en la pantalla de reportes, **«Cobros con tarjeta»**,
junto a las tres que ya existen. Sirve para cotejar contra la terminal del banco
qué cobros siguen en pie y cuáles se anularon en el sistema.

**Qué muestra:** todas las ventas con `forma_pago = 'tarjeta'`, de la más
reciente a la más vieja, una fila por venta.

| Columna | De dónde sale |
|---|---|
| Fecha y hora, en hora de Guatemala | `ventas.fecha` (§4.15) |
| Recibo No. | `recibos.numero_recibo`; «sin recibo» si la aplicación se cayó antes de emitirlo (§4.14) |
| Voucher | `ventas.num_boleta` |
| Total | `ventas.total`, tal cual, sin sumar nada |
| Quién vendió | `ventas.usuario_id`, con el nombre de hoy |
| **Estado** | **«Anulado»** si existe su fila en `anulaciones_de_venta`; **«Activo»** si no |
| Anulado el | `anulaciones_de_venta.fecha`, solo si está anulado |

**La consulta.** Filtra y ordena en SQL sobre texto ISO y sobre columnas que no
son decimales, que es exacto (§4.15). No agrega nada:

```sql
SELECT v.id, v.fecha, v.num_boleta, v.total, v.usuario_id,
       r.numero_recibo,
       a.fecha AS anulada_en
  FROM ventas v
  LEFT JOIN recibos r              ON r.venta_id = v.id
  LEFT JOIN anulaciones_de_venta a ON a.venta_id = v.id
 WHERE v.forma_pago = 'tarjeta'
 ORDER BY v.fecha DESC, v.id;
```

`recibos.venta_id` y `anulaciones_de_venta.venta_id` son `UNIQUE`, así que los
dos `LEFT JOIN` no pueden duplicar una venta.

**Por qué no puede divergir:** el estado **no se guarda en ningún lado**. Se
deriva en cada consulta de la misma regla de 1.1 —anulada si y solo si existe
la fila—, que es la que usan el efectivo esperado y los demás reportes. No lee
`ventas.estado` (1.3) ni los asientos de auditoría (6.3).

| Detalle | Decisión |
|---|---|
| Quién la ve | **Rol administrativo**, con `requiereRol`, como los otros tres reportes (§4.15). Es información de dueño. La prueba que cuenta canales y guards del archivo de reportes pasa de 5 a 6. |
| Canal | `reportes:cobros-con-tarjeta`, sin payload, y en la prueba de clonado de todos los canales (§4.42). |
| Período | **Ninguno: muestra todos**, como se pidió. No se midió cuánto tarda con años de ventas en el i3. Si hiciera falta, agregar el selector de período que ya usan los otros reportes es un cambio acotado y no toca esta regla. |
| Totales | **No muestra sumas.** No se pidieron. Si hicieran falta, se suman en la aplicación con Decimal, nunca con `SUM()` (§4.15). |
| La pantalla | No calcula nada: recibe el estado ya resuelto. |
| Nube y restauración | Nada nuevo: lee `ventas` y `recibos`, que ya se sincronizan y se restauran, y `anulaciones_de_venta`, que este diseño ya sincroniza y restaura (secciones 7 y 8). |

---

## 4. Autorización

### 4.1 Una superficie propia, con su propio candado

Se agrega **`anulacion_de_venta`** al CHECK de `bloqueos_de_autorizacion`, con
una migración local sin espejo, como la 011, la 013 y la 029. Mantiene el mismo
candado que las demás: **3 intentos y 30 segundos**.

- **Independiente** de las otras cinco superficies y del ingreso. Bloquear la
  anulación no bloquea el descuento, la diferencia, la salida, la caja ajena ni
  el salto de lote, y al revés. Se suman sus combinaciones a las pruebas
  cruzadas que ya existen (§4.8).
- `ACEPTA_PIN_REMOTO` es un `Record` de todas las superficies
  (`autenticacion.ts:107-122`): el compilador **no deja** agregar esta sin
  contestar si acepta el remoto.

### 4.2 PIN remoto: recomiendo que NO

Rige el valor por omisión del proyecto, y acá hay razones concretas para
mantenerlo:

1. **El fraude que este PIN existe para frenar es el que un teléfono no puede
   verificar.** Se cobra en efectivo, el cajero anula y se queda con el dinero.
   Quien autoriza tiene que ver que hay un cliente, que la mercadería volvió y
   que el dinero salió del cajón. Por teléfono, lo que se autoriza es un relato.
2. **Mueve más que un descuento.** El descuento excedente arriesga el exceso
   sobre el tope, con el ticket todavía abierto. La anulación borra del corte
   **el total entero** de una venta ya cobrada, y además **sube el
   inventario**: si la mercadería no volvió, el faltante aparece recién en un
   conteo físico.
3. **No se parece a la salida controlada**, que se amplió el 2026-09-15: cerrar
   la aplicación no mueve dinero ni inventario.
4. **Es el mismo criterio de `cierre_de_caja_ajena`**: quien actúa está parado
   frente a la caja.

**El costo, dicho en voz alta:** si no hay ningún administrador en la tienda, la
anulación espera a que llegue uno. Mientras tanto la caja tiene que quedar
abierta; si se cierra, esa venta ya no se puede anular. Ampliarlo después sigue
siendo posible, con una decisión explícita, como el descuento y la salida.

### 4.3 El flujo

Es el patrón del descuento excedente: primero se muestra qué se va a
autorizar, después se pide el PIN. Acá no hay ningún monto oculto que revelar
después, así que no hace falta el paso extra de §4.40.5.

1. **Pedido sin PIN.** `venta:anular` recibe `{ ventaId, motivo, voucher }`,
   con `voucher` en `null` para una venta en efectivo. Se valida, en este orden:
   - que la venta exista;
   - que su caja esté abierta;
   - que no tenga anulación;
   - **si fue con tarjeta, que el voucher coincida con su `num_boleta`** (3.3);
     si fue en efectivo, que no traiga voucher;
   - que ninguna unidad haya cambiado;
   - que el motivo sea válido.

   Si algo lo impide, se contesta el motivo y **no se pide el PIN**. Si no, se
   contesta `REQUIERE_AUTORIZACION` con la vista previa.
2. **Pedido con PIN.** Se llama a `autorizarComoAdministrador('anulacion_de_venta', pin)`.
   - PIN equivocado: asiento `anulacion_de_venta_rechazada` y un intento más.
   - Candado agotado: `AUTORIZACION_BLOQUEADA` y el asiento
     `autorizacion_bloqueada` que ya existe (`autenticacion.ts:399-433`).
   - PIN aceptado: corre la transacción de 2.2, que vuelve a validar todo.

**La vista previa muestra lo que se va a anular:**
- número de recibo, fecha y hora;
- quién vendió y quién abrió la caja;
- forma de pago y total, y el voucher si fue con tarjeta (ya lo tecleó quien
  pide, así que no revela nada);
- cada línea con su nombre y su unidad de la foto;
- los productos desactivados, avisados.

Si fue en efectivo, dice «Hay que devolverle Q27.50 al cliente». Si fue con
tarjeta, dice «La devolución se hace en la terminal del banco». **No muestra el
teórico.**

| Pregunta | Respuesta |
|---|---|
| ¿Quién puede pedirla? | Cualquiera con sesión (`requiereSesion`, como `venta:cobrar`). Lo que autoriza es el PIN, no el rol. |
| ¿De dónde sale quién la pidió? | De la sesión del proceso principal, nunca del payload (§4.13). |
| ¿Un administrador con sesión también teclea el PIN? | Sí, el suyo. Es la regla que decidiste, la misma del cierre de caja ajena. |
| ¿Si la caja la abrió otra persona, hace falta además el PIN de caja ajena? | **No.** El alcance dice «sin importar quién la abrió», y el PIN de administrador ya se exige siempre. Un segundo PIN no agregaría un control distinto. El asiento anota quién abrió la caja. |
| ¿Desde qué pantalla? | Desde el historial de recibos: ahí el cajero ya busca la venta por número. El botón solo aparece si la caja de esa venta sigue abierta. Si la venta fue con tarjeta, el formulario pide el voucher además del motivo. |

---

## 5. El recibo

### 5.1 Decisión: no hay documento nuevo; el recibo original se marca como anulado

- **No se emite una nota de crédito ni ningún papel con numeración propia.** El
  recibo ya es una proforma, no una factura fiscal (§4.14). Inventar un
  correlativo de anulaciones daría un documento con apariencia fiscal que la
  tienda no tiene base para emitir.
- El recibo **conserva su número**, así que la numeración no queda con huecos.
- Al reimprimirlo, **lleva una marca visible** y todo lo demás exactamente como
  se entregó: líneas, precios, descuento y total. La venta anulada se sigue
  leyendo tal como ocurrió.

Así se vería en el rollo, debajo de la leyenda de proforma:

```
          ** REIMPRESIÓN **
         ** VENTA ANULADA **
 Anulada: 15/09/2026 12:04
 Autorizó: Jimmy
 Motivo: el cliente devolvió el producto
----------------------------------------
 Recibo No.                          128
 ...
```

Es honesto con lo que pasó: hubo una venta, se entregó ese papel, y después se
anuló, con fecha, responsable y motivo. El papel lo dice en ese orden.

### 5.2 Los detalles

| Qué | Cómo |
|---|---|
| El modelo del recibo | Gana `anulacion: { fecha, autorizadaPor, motivo } \| null`, leída de la tabla nueva. **No recalcula nada** (§4.14). |
| El PDF | Se regenera **después** de confirmar la anulación, fuera de la transacción y sobre el mismo `pdf_path` (§4.14). Si falla, queda en la bitácora técnica y la anulación queda hecha. |
| ¿Se imprime solo? | No. La confirmación ofrece un botón para imprimir el recibo marcado, por si el cliente quiere constancia. |
| El historial de recibos | Muestra «Anulada» junto al número. |
| Si la tienda pasa a facturar con FEL/SAT | Anular un documento tributario es un trámite legal propio, y esta decisión se revisa ese día (§6.2, punto 2). |

---

## 6. Auditoría

### 6.1 Los asientos

| Acción | Cuándo | `usuario_id` | Cómo sube |
|---|---|---|---|
| **`venta_anulada`** | Al anular, dentro de la transacción | Quien la pidió | En el lote de la anulación (7.1) |
| **`anulacion_de_venta_rechazada`** | Cada PIN bien formado pero equivocado | Quien la pidió | Suelto, por `sincronizar_asiento` |
| `autorizacion_bloqueada` (ya existe) | Al agotar los tres intentos | Sin usuario, como hoy | Suelto, por `sincronizar_asiento` |
| **`conflicto_de_inventario`** | Si falla el comparar-y-cambiar, después de revertir | Quien la pidió | Suelto, por `sincronizar_asiento` |

`usuario_id` es quien operó, y quien autorizó va dentro del asiento. Es la misma
convención de `caja_cerrada` (`servicio-de-caja.ts:561-579`).

**Cada PIN rechazado queda escrito**, y no solo el bloqueo. Probar PIN para
anular una venta es evidencia del mismo fraude que el control existe para
frenar. Es lo que ya hace la salida controlada.

`conflicto_de_inventario` lleva la operación como dato (`operacion: 'anulacion'`),
no como otra acción. Así, cuando se corrija el hueco de la venta (0.4), la
venta usa la misma acción con `operacion: 'venta'`. Es el criterio de §4.1: el
origen es un dato del asiento.

> **Desde el 2026-09-15 la venta ya lo usa**, con `valor_nuevo`
> `{ operacion, productoId, nombre, comparacion, saldoQueSeLeyo,
> cantidadVendidaQueSeLeyo, momento }`. La anulación escribe `saldoLeido`,
> `cantidadVendidaLeida`, `detalle`, `causaTecnica` y `ventaId`. Alinearlas está
> pendiente (punto 23 de §6.2 de CLAUDE.md).

Los tres asientos sueltos son **exactamente el caso para el que existe
`sincronizar_asiento`**: hechos del negocio sin fila principal (0027).

### 6.2 Lo que lleva `venta_anulada`

`valor_anterior` es la venta tal como estaba; `valor_nuevo` es la anulación y
lo que movió:

```json
{
  "valor_anterior": {
    "ventaId": "…",
    "numeroRecibo": 128,
    "fecha": "2026-09-15T16:02:11.000Z",
    "vendidaPor": "id de Ana",
    "cajaSesionId": "…",
    "cajaAbiertaPor": "id de Ana",
    "formaPago": "efectivo",
    "numBoleta": null,
    "total": "27.50"
  },
  "valor_nuevo": {
    "anulacionId": "…",
    "solicitadaPor": "id de Rosa",
    "autorizadaPor": "id de Jimmy",
    "autorizadaVia": "presencial",
    "motivo": "el cliente devolvió el producto",
    "fecha": "2026-09-15T18:04:40.000Z",
    "efectivoQueDejaDeContar": "27.50",
    "lineas": [
      {
        "productoId": "…",
        "nombreSnap": "Maíz blanco",
        "unidadSnap": "lb",
        "cantidad": "5.000",
        "productoActivo": true,
        "saldoAnterior": "142.000",
        "saldoNuevo": "147.000",
        "cantidadVendidaAnterior": "8.000",
        "cantidadVendidaNueva": "3.000"
      }
    ]
  }
}
```

- `efectivoQueDejaDeContar` es el total si fue en efectivo y `0.00` si fue con
  tarjeta.
- El voucher tecleado no va aparte: coincide por construcción con
  `numBoleta`, que ya está en `valor_anterior` (3.3).
- **Nunca se registra el PIN**, ni en claro ni con hash.
- `numeroRecibo` va `null` si la venta no llegó a tener recibo, porque la
  aplicación se cayó entre las dos cosas (§4.14).

### 6.3 Ningún código lee estos asientos

Los asientos de la anulación son **fotografías para una persona**, igual que los
`*_snap` de `venta_detalle`. Por eso copiar el total o quién vendió en
`valor_anterior` no contradice la regla de 1.1: esa regla es para datos que otro
código lee.

- Nada decide ni calcula con ellos. Si una anulación existe se sabe por
  `anulaciones_de_venta`; la reposición lee `productos`; el efectivo esperado
  lee `ventas`.
- Una prueba estructural lo fija: el servicio de anulación no llama a ninguna
  lectura del repositorio de auditoría, y ningún archivo de producción lee
  asientos `venta_anulada`.

**No es la regla de todo el sistema, y no hay que creer que lo es:** el cierre
de caja sí decide con los sellos que lee de la bitácora (0.7).

---

## 7. Sincronización

### 7.1 El lote

Todas las filas de la anulación van en un solo lote, dentro de la misma
transacción:

```
anulaciones_de_venta   insertar     (una, primero)
productos              actualizar   (uno por producto de la venta)
auditoria_log          insertar     (el asiento venta_anulada)
```

Los productos van como `actualizar` con la fila entera, igual que en el lote de
la venta. La terminal es el único escritor y la cola es FIFO, así que la última
fila que llega es el estado correcto (`0023:637-640`).

**El orden de la cola resuelve dos casos solo:**

- **La venta todavía no subió cuando se anula** (la tienda estaba sin
  internet). El lote de la venta se encoló antes, y el trabajador no saltea
  ningún lote (§4.18). La nube recibe primero la venta y después la anulación.
- **La caja se cierra después de anular.** El lote del cierre se encola después
  del de la anulación, así que en la nube la anulación siempre llega con la
  caja todavía abierta. La sección 7.3 se apoya en esto.

### 7.2 Una función nueva, con el mismo endurecimiento de `sincronizar_asiento`

`sincronizar_asiento` no alcanza sola: su lista cerrada tiene **un solo
elemento**, `auditoria_log` (`0027:95-104`). La fila de anulación y los
productos no pueden pasar por ahí, y ampliarla le quitaría justamente lo que la
hace segura.

«El mismo patrón» es entonces una **puerta nueva con la misma forma**:
**`sincronizar_anulacion_de_venta(lote, version_de_contrato)`**.

- `SECURITY DEFINER` con `search_path = ''`.
- `REVOKE` de `public` y `anon`, y `GRANT` solo a `authenticated`.
- El rol `terminal`, no anónimo, comprobado en la primera línea.
- Nombres calificados por esquema y ningún `EXECUTE` con texto del lote (§1.5.1).
- Lista cerrada de tablas, con la regla de cada tabla escrita en la función.

### 7.3 Lo que la función comprueba, en orden

1. El rol, la versión de contrato y que el lote sea una lista no vacía.
2. **La forma exacta:**
   - una sola fila de `anulaciones_de_venta` como `insertar`, primera;
   - uno o más `productos` como `actualizar`;
   - **exactamente un** asiento, con `accion = 'venta_anulada'` y `entidad_id`
     igual a la venta;
   - nada más.
3. **Que la venta exista en la nube.** Si no está, lo dice con esas palabras,
   en vez de dejar salir un `23503` crudo. El caso real es que el lote de esa
   venta se haya saltado a mano (§4.34).
4. **Si la venta ya tiene una anulación:**
   - con el mismo id y el mismo contenido: es un reintento, y contesta
     `ya_existia`, como toda la `0023`;
   - con otro id o con otro contenido: la rechaza.
5. **Que la caja de la venta, leída de `public.ventas`, esté `abierta` en la
   nube.** Solo se comprueba si la anulación todavía no existía.
6. **Que los productos del lote sean exactamente los de las líneas de esa venta
   en la nube.** Nadie puede usar esta puerta para reescribir el inventario de
   otro producto.
7. Escribe con `escribir_fila`:
   - la anulación con `ignorar`;
   - los productos con `actualizar`;
   - el asiento con `ignorar`.

**No comprueba** el PIN, los montos ni la aritmética del inventario. No puede
ver el PIN, y las funciones no calculan nada de negocio (§9.1 del diseño de
sincronización).

### 7.4 Qué puede hacer con esta puerta alguien que robó la credencial de la terminal

- **Solo puede anular ventas de la caja que figura abierta en la nube en ese
  momento**, y cada una una sola vez (7.3, puntos 4 y 5). Las ventas de todas
  las cajas cerradas quedan fuera de su alcance.
- Puede sobrescribir la fila de los productos de esa venta. Eso **ya** lo
  permite hoy el lote de una venta: la puerta nueva no abre nada que no
  estuviera abierto.
- **Lo que haga queda detectable:** la anulación tiene `recibido_en`, y la
  restauración la excluye si es posterior al robo (sección 8).

### 7.5 El resto del cableado

| Pieza | Cambio |
|---|---|
| `TablaSincronizable` (`bandeja-de-salida.ts:73-85`) | Agrega `anulaciones_de_venta`. No hay columnas excluidas. |
| `TABLA_DECISIVA` del enrutador (`enrutador-de-lotes.ts:60-63`) | Agrega `['anulaciones_de_venta', 'sincronizar_anulacion_de_venta']`. **Sin esto, el lote caería en `sincronizar_lote_simple`, que lo rechazaría por nombre y detendría la cola.** Un lote con esa tabla y cualquier otra decisiva es incoherente y se rechaza. |
| `FUNCIONES_DE_ESCRITURA` y `TABLAS_ADMITIDAS_POR_FUNCION` (`contrato-de-sincronizacion.ts:36-105`) | Agregan la función y sus tres tablas. |
| `contrato_de_sincronizacion()` | **Se reemplaza para que conozca la tabla y la función.** Sin eso, la prueba de deriva no las ve (§4.29). |
| `supabase/esquema-nube.json` | Se vuelve a tomar la foto con `--tomar-foto`, a propósito, y se revisa en el commit. |
| Versión de contrato | **No sube.** Es una puerta nueva y ninguna existente cambia de forma, igual que la `0027`. |

**El orden de aplicación importa.** Una terminal sin anulación funciona igual
contra una nube que ya la tiene. **Una terminal con anulación contra una nube
sin la migración detiene su cola en la primera anulación**: la función no
existe, PostgREST contesta 404, y es determinístico. Se ve y se recupera
aplicando la migración y pulsando «Reintentar ahora». Por eso la migración de
la nube se aplica, con tu aprobación, **antes** de instalar la versión que
anula.

---

## 8. Restauración

| Pieza | Cambio |
|---|---|
| `ORDEN_DE_RESTAURACION` (`orden-de-restauracion.ts:46-59`) | `anulaciones_de_venta` va después de `recibos` y antes de `auditoria_log`. Referencia a `ventas` y a `usuarios`, que ya bajaron. |
| La lista de llaves foráneas de la prueba del orden | Suma las tres de la tabla nueva: `venta_id`, `solicitada_por` y `autorizada_por`. |
| `TABLAS_QUE_SOLO_SE_INSERTAN` (`orden-de-restauracion.ts:76-82`) | Agrega `anulaciones_de_venta`: la nube solo la inserta. |
| `CLASES_DE_COLUMNA` | Agrega sus columnas, cotejadas contra la foto. |
| Verificación de conteos | Cuenta la tabla nueva: nube = acá + excluidas. |
| `restauracion_ventas_por_mes` | **No cambia.** Suma todas las ventas, anuladas o no (`0029:28`), y la terminal también. |

**Qué pasa con una anulación posterior al robo.** Queda **excluida y listada**,
como toda fila de una tabla de solo inserción. Ninguna fila anterior la
referencia, así que excluirla no rompe ninguna llave.

| Escenario | Resultado |
|---|---|
| Venta legítima anterior al robo, anulación falsa posterior | La venta se restaura válida y la anulación queda excluida. **El ladrón no puede borrar una venta legítima del corte restaurado.** |
| Venta y anulación, las dos posteriores | Las dos quedan excluidas y listadas. |
| «Restaurar igual» una anulación excluida | Exige que su venta esté restaurada; si no, se rechaza explicando el orden, como las demás hijas. **No se restaura sola junto con su venta**: es otro hecho, con otro autor. |
| El lote de una anulación se saltó a mano | La nube no la tiene, y una base restaurada va a traer esa venta como válida. Es el hueco deliberado que deja todo lote saltado, y queda en `auditoria_log` (§4.34). |

---

## 9. Migraciones que hacen falta

**Ninguna está escrita ni aplicada.** Antes de aplicar cualquiera se muestra el
SQL completo y se espera tu aprobación, primero para `pos-pruebas-descartable`
y después para `pos-jimmy-cano`.

| Número | Lado | Qué hace |
|---|---|---|
| `033_anulaciones_de_venta` | Local | La tabla y su disparador de inmutabilidad. El cambio de las cuatro consultas no es una migración: es código. |
| `0033_anulaciones_de_venta` | Nube, espejo de la 033 | La tabla con `uuid` y `timestamptz`, el mismo disparador, RLS activo, `REVOKE ALL` y `GRANT SELECT` (como la 0024), `recibido_en` con su disparador (como la 0019), la política de lectura de `restauracion` con la condición idéntica a las otras trece (como la 0025) y los `COMMENT`, incluido el de `ventas.estado`. |
| `034_superficie_anulacion_de_venta` | Solo local | Amplía el CHECK de `bloqueos_de_autorizacion`. El `0034` queda reservado. |
| `0035_sincronizar_anulacion_de_venta` | Solo nube | La función y el reemplazo de `contrato_de_sincronizacion`. El `035` local queda reservado. |

Las dos locales se corren además sobre **una copia de la base de trabajo real**
antes de darlas por hechas, y «aplicada» se afirma leyendo
`migraciones_aplicadas` (§4.14).

---

## 10. Cómo se va a verificar

### 10.1 Pruebas de Vitest, con nombres que se leen como lista de verificación

**Servicio, sobre SQLite real:**
- una venta en efectivo anulada deja de contar en el efectivo esperado, y una
  con tarjeta no lo cambia;
- el inventario se repone **sumando sobre el saldo de hoy**, con un ajuste y
  otra venta en el medio;
- los dos contadores bajan, y **la suma de los reportes vuelve a dar el
  acumulado**;
- un producto desactivado se repone y no se reactiva;
- con la unidad cambiada se rechaza **sin escribir nada**, contando filas;
- con tarjeta y **voucher distinto** se rechaza con «El voucher no coincide con
  el de la venta original», **sin pedir PIN, sin sumar intento al candado y sin
  escribir nada**, contando filas;
- con tarjeta, el voucher **correcto de OTRA venta** también se rechaza;
- con tarjeta y **sin voucher** se rechaza antes del PIN;
- en efectivo, un pedido **con voucher** se rechaza;
- el voucher se compara recortando espacios de los dos lados, **incluida una
  boleta guardada con espacios** por el canal, y distingue `0012` de `12`;
- el pedido con PIN y un voucher distinto del primer pedido se rechaza en la
  transacción;
- con la caja cerrada se rechaza;
- la segunda anulación de la misma venta se rechaza;
- sin motivo se rechaza;
- un conflicto del comparar-y-cambiar **revierte todo** y deja el asiento
  `conflicto_de_inventario`;
- la fila de `ventas`, `venta_detalle` y `recibos` quedan **byte a byte iguales**
  antes y después de anular;
- el lote encolado tiene la forma de 7.1 y **nunca incluye `ventas`**;
- el disparador rechaza editar o borrar una anulación.

**Autorización:**
- el PIN remoto se rechaza en esta superficie;
- cada PIN equivocado deja su asiento;
- el candado es independiente de las otras cinco superficies y del ingreso, en
  los dos sentidos.

**El reporte de cobros con tarjeta (3.5):**
- lista **solo** las ventas con tarjeta, de la más reciente a la más vieja, con
  su voucher;
- una venta anulada dice «Anulado» con su fecha, y una sin anular dice «Activo»;
- **no depende de `ventas.estado`**: con la fila de anulación presente y
  `estado = 'completada'`, dice «Anulado»;
- una venta sin recibo aparece igual, con «sin recibo»;
- el rol venta recibe `PERMISO_DENEGADO` y el servicio no se ejecuta;
- la respuesta pasa `structuredClone`.

**Estructurales:**
- ninguna consulta decide por `ventas.estado`;
- no hay tabla ni columna de vouchers en ninguna migración;
- ningún archivo de producción escribe `'anulada'`;
- el canal nuevo tiene su guard y pasa por la prueba de clonado de todos los
  canales (§4.42).

**Enrutador y contrato:**
- el lote va a la función nueva;
- mezclado con otra tabla decisiva, se rechaza;
- la deriva conoce la tabla y la función.

**Estructural de la auditoría (6.3):**
- el servicio de anulación no lee `auditoria_log`, y nada lee asientos
  `venta_anulada`.

**Del arreglo previo (0.7), ya hecho:**
- los dos escenarios medidos ya son pruebas permanentes (sobrante y venta;
  esperado que baja). Con la anulación implementada, se agrega el faltante
  cubierto por una anulación de verdad, en lugar de `anular()` del repositorio,
  que este diseño elimina (1.3).

**Falsificaciones planeadas**, una por vez, para ver que cada prueba muerde:
- volver al saldo del asiento de la venta en vez de sumar;
- no bajar los contadores;
- dejar el filtro por `estado`;
- comparar el voucher contra cualquier venta con tarjeta y no contra la de ese
  `venta_id`;
- que el reporte lea `ventas.estado` en vez de `anulaciones_de_venta`;
- aceptar el PIN remoto;
- encolar la fila de `ventas`.

### 10.2 En la aplicación real (macOS; Windows sigue pendiente)

Un arnés `verify:pantallas:anulacion` arma el escenario por los canales reales.

1. Ana abre la caja y cobra una venta en efectivo y **dos con tarjeta**.
2. Rosa pide anular la de efectivo desde el historial de recibos.
3. La vista previa no muestra el teórico, y un PIN equivocado deja el asiento.
4. Jimmy teclea su PIN, y el esperado baja.
5. El recibo reimpreso dice «VENTA ANULADA».
6. Una segunda anulación se rechaza.
7. Rosa pide anular una de tarjeta con un **voucher equivocado**: aparece «El
   voucher no coincide con el de la venta original», **no aparece el teclado
   del PIN**, el candado sigue en 0 intentos y la base no cambia.
8. Con el voucher correcto, llega la vista previa, y con el PIN de Jimmy se
   anula.
9. Jimmy abre «Cobros con tarjeta»: la anulada dice «Anulado» con su fecha y la
   otra dice «Activo». Rosa no ve la sección, y el canal le contesta
   `PERMISO_DENEGADO`.
10. Con la caja cerrada, el botón ya no aparece y el canal se niega.

Al final lee la base con otra conexión y guarda capturas.

### 10.3 Contra la nube, solo en `pos-pruebas-descartable`

La batería destructiva suma la función nueva:
- el reintento idéntico da `ya_existia`;
- una segunda anulación distinta, rechazada;
- una venta que no está en la nube, rechazada con nombre;
- la caja ya cerrada en la nube, rechazada;
- un producto ajeno a la venta en el lote, rechazado;
- sin rol, con rol `restauracion` o con la llave publicable, `403`/`401`;
- la terminal no puede leer la tabla nueva;
- y **la fila de `ventas` de la nube no cambia**, comparada por huella antes y
  después.

La restauración se ejercita con una anulación anterior y otra posterior a la
fecha del robo.

---

## 11. Lo que este diseño no hace

- **Anular con la caja cerrada.** Queda fuera, como decidiste.
- **Anular líneas sueltas**, y **devoluciones parciales**. `ventas` y
  `venta_detalle` siguen con sus campos sin piso reservados para ese módulo
  (§4.2).
- **Hablar con el banco** para una venta con tarjeta. El sistema no sabe si la
  anulación se hizo en la terminal bancaria; el reporte de 3.5 sirve para
  cotejarlo a mano.
- **Guardar el voucher de la anulación bancaria.** Decisión 9: no hay tabla ni
  columna de vouchers.
- **Un reporte de anulaciones por persona.** Recomiendo construirlo pronto: el
  fraude de anulación se detecta por patrones —quién anula más, a qué hora, por
  cuánto—, no por un solo PIN. Este diseño deja todos los datos para hacerlo.
- **Arreglar el asiento que falta en el conflicto de la venta** (0.4) ni
  endurecer `sincronizar_venta` (0.2). Son cambios separados.

---

## 12. Decisiones que este diseño te pide

| # | Decisión | Lo que recomiendo |
|---|---|---|
| 1 | Cómo se guarda la anulación | **Tabla nueva `anulaciones_de_venta`; la fila de `ventas` no se toca y `ventas.estado` queda en `completada`** (sección 1) |
| 2 | Si la superficie acepta el PIN remoto | **No** (4.2) |
| 3 | Si bajan `cantidad_vendida` y `contador_ventas` | **Sí, los dos, en un `UPDATE`**, aunque la 015 diga «nunca baja» (2.4) |
| 4 | Qué pasa con la unidad cambiada desde la venta | **Rechazar la anulación entera, sin convertir** (2.3) |
| 5 | El recibo | **Sin documento nuevo: el original se marca como anulado al reimprimirse** (sección 5) |
| 6 | Si cada PIN rechazado deja asiento | **Sí** (6.1) |
| 7 | El motivo | **Obligatorio, texto libre, hasta 200 caracteres**, como el ajuste de inventario |
| 8 | Si la caja ajena exige un segundo PIN | **No** (4.3) |
| 9 | ~~**Para Jimmy:** cómo anula hoy un cobro con tarjeta en la terminal del banco, y si hace falta guardar la referencia de esa anulación~~ | **RESUELTA el 2026-09-15:** se pide el voucher antes de la vista previa y se compara con `ventas.num_boleta` de esa venta; si no coincide se rechaza sin PIN. No hay tabla de vouchers; hay un reporte de solo lectura de cobros con tarjeta, Activo o Anulado (3.3, 3.5) |
| 10 | Endurecer `sincronizar_venta` para que rechace una venta existente con otro contenido | Decidirlo por separado (0.2) |
| 11 | El reporte de anulaciones por persona | Hacerlo después de esto (sección 11) |
| 12 | El cierre que exige PIN por un sello y no registra quién lo autorizó (0.7) | ~~Arreglarlo antes de implementar la anulación~~ **ARREGLADO el 2026-09-15** (0.7) |
| 13 | Si un voucher que no coincide deja asiento de auditoría | **No**, igual que la unidad cambiada: no se pidió autorización ni se escribió nada (3.3) |
| 14 | El voucher sale impreso en el recibo, así que no prueba tener el comprobante del banco | **Dejarlo como está**: es un control contra anular la venta equivocada, y el PIN sigue siendo el control contra el fraude (3.3) |

# 002 — Plan: cómo se construye el precio mayorista

> Implementa [`spec.md`](spec.md). Escrito el 2026-09-18, antes de tocar el
> código. Las tareas están en [`tasks.md`](tasks.md).

---

## 0. Lo que se leyó antes de planear

| Archivo | Qué hace hoy | Qué importa para este cambio |
|---|---|---|
| `src/main/domain/venta/precios.ts` | `precioEfectivoDe(precioBase, vigentes)` calcula el precio con el precio especial vigente más reciente: una **rebaja** en porcentaje o en quetzales, con piso en cero, redondeada a centavos. | **No se toca.** Sigue siendo la única regla del precio especial. Su resultado pasa a ser UNO de los candidatos. |
| `src/main/domain/venta/servicio-de-venta.ts:731` | `resolverLinea` pone `precioUnitario = precioEfectivoDe(...).precio` y guarda `especialAplicado`. El paso 5 lo congela en `precio_unitario_snap`; el paso 7 lo anota en el asiento con `precioEspecialId`. | Es donde entra el tercer candidato. La cantidad ya está redondeada a tres decimales en ese punto (`redondearCantidad`). |
| `src/main/ipc/venta.ts:181` | Arma `ProductoParaVender` con `precioEfectivo` (el precio con el especial) y el descriptor `precioEspecial`. | Tiene que mandar también el precio mayorista y su cantidad mínima: la pantalla los necesita para recalcular sin preguntarle al proceso principal en cada tecla. |
| `src/renderer/src/venta/ticket.ts` | `LineaDeTicket.precioUnitario` es una foto del precio al agregar el producto, **que no cambia con la cantidad**. `agregarAlTicket` suma la cantidad del ícono; `fijarCantidad` pone la del teclado. | Las dos funciones tienen que recalcular el precio con la cantidad nueva. |
| `src/renderer/src/components/TicketDeVenta.tsx:108` | La fila «Precio especial · 10 % menos · antes ~~Q6.00~~» sale si `linea.precioEspecial !== null`. | Tiene que salir según el ORIGEN del precio, no según si hay un especial vigente: si gana el mayorista, esa fila no va. |
| `src/shared/descuento.ts` | El cálculo del descuento discrecional, compartido por las dos capas para que la pantalla y el cobro no puedan discrepar. | **Es el patrón a seguir** para el precio de la línea. |
| `src/main/database/migrations/031_productos_precio_compra.sql` y `0031` | Agregan una columna nulable a `productos`, con su CHECK canónico, y le agregan la clave en `null` a los payloads que esperaban en `sync_cola`. | **Es el precedente directo** de la 039. |
| `src/main/database/migrations/038_anulacion_solo_presencial.sql` | `ALTER TABLE … ADD CONSTRAINT … CHECK`, gramática que SQLite no documenta pero que se midió en la versión empaquetada (§5, fila de la 008). | Precedente para las dos reglas de tabla (R1 y R3). |
| `src/main/database/__tests__/checks-con-null.test.ts` | Recorre todos los CHECK del esquema y falla si alguno puede dar NULL. | Las cuatro restricciones nuevas tienen que pasarla sin agregar excepciones. |
| `src/main/domain/catalogo/servicio-de-productos.ts:227` | `verificar` valida y redondea los campos; `crear` y `editar` escriben con su asiento dentro de `conBandejaDeSalida`. | Suma la validación del mayorista y los campos del asiento. |
| `src/renderer/src/components/FormularioDeProducto.tsx` | `motivoParaNoGuardar` da el primer impedimento en tiempo real; el campo de precio de compra es el modelo de campo opcional. | Suma la casilla y los dos campos. |
| `src/main/restauracion/conversion-de-tipos.ts:108` | `CLASES_DE_COLUMNA.productos` declara la clase de cada columna, y una prueba la coteja contra la foto de la nube. | Suma `precio_mayorista: 'monto'` y `cantidad_minima_mayorista: 'cantidad'`. |
| `supabase/esquema-nube.json` | La foto que coteja la prueba de deriva, por nombre de columna. | Suma las dos columnas, en el orden en que la 0039 las agrega. |
| `scripts/verificacion-de-nube.cjs:389` | La batería arma los payloads de `productos` a mano, con `precio_compra: null`. | Suma las dos claves. **Desde ese cambio, la batería exige la 0039 aplicada**, como pasó con la 0031. |
| `src/main/database/__tests__/anulacion-solo-presencial.test.ts:165` | Espera que migrar una base parada en la 037 aplique **solo** la 038. | Con la 039 aplicaría dos. Se acota la prueba a las migraciones hasta la 038, que es lo que mide. |

**Lo que no hay que tocar, y se comprobó:** el recibo, el reporte y la
anulación leen el precio congelado en `venta_detalle`; ninguno recalcula precios
del catálogo. El precio especial nunca supera al de lista (es una rebaja con
piso en cero), así que ningún comportamiento de hoy cambia (spec §3.2).

## 1. La decisión central: UNA función compartida elige el precio

### 1.1 La firma

```ts
// src/shared/precio-de-linea.ts
export type OrigenDelPrecio = 'lista' | 'especial' | 'mayorista';

export interface PrecioMayorista {
  readonly precio: EntradaDecimal;
  readonly cantidadMinima: EntradaDecimal;
}

export interface CandidatosDePrecio {
  /** Precio de lista vigente. Participa SIEMPRE: es el piso de seguridad. */
  readonly lista: EntradaDecimal;
  /** El precio con el especial vigente ya aplicado, o null si no hay ninguno. */
  readonly especial: EntradaDecimal | null;
  /** La configuración del producto, o null si no tiene. */
  readonly mayorista: PrecioMayorista | null;
}

export function calificaParaMayorista(mayorista: PrecioMayorista | null, cantidad: EntradaDecimal): boolean;
export function precioDeLinea(candidatos: CandidatosDePrecio, cantidad: EntradaDecimal):
  { readonly precio: Decimal; readonly origen: OrigenDelPrecio };
```

`precioDeLinea` arma la lista de candidatos que aplican **en el orden del
empate** —especial, lista, mayorista (spec P5)— y devuelve el primero de los
menores. El precio de lista está en la lista siempre: **quitarlo es la
falsificación que tiene que hacer caer el caso de seguridad** (CA-8).

### 1.2 Quién la usa

| Dónde | Para qué |
|---|---|
| `ServicioDeVenta.resolverLinea` (proceso principal) | Decide lo que se cobra y se congela en `precio_unitario_snap`. |
| `ticket.ts` (pantalla) | Recalcula el precio de la línea cada vez que cambia la cantidad. |

El proceso principal le pasa como candidato especial el resultado de
`precioEfectivoDe` **solo si hubo un precio especial vigente**; la pantalla le
pasa el `precioEfectivo` que recibió **solo si trajo un descriptor de precio
especial**. Los dos parten de los mismos datos: la pantalla, de los que cargó al
abrirse; el proceso principal, de los del momento de cobrar (spec P9).

### 1.3 Las alternativas que se descartaron

| Alternativa | Por qué no |
|---|---|
| Meter el mayorista dentro de `precioEfectivoDe`, en `src/main` | La pantalla no puede importar del proceso principal, y necesita el mismo cálculo para recalcular en vivo. Terminaría con su propia copia: dos criterios, y un cliente que paga un precio distinto del que vio. Es lo que `@shared/descuento` ya evitó para el descuento. |
| Que la pantalla le pregunte el precio al proceso principal en cada cambio de cantidad | Un viaje por el puente IPC por tecla, para algo que se calcula con cuatro números que la pantalla ya tiene. |
| Guardar el origen del precio en una columna de `venta_detalle` | El pedido prohíbe un campo nuevo, y no hace falta: el origen queda en el asiento de la venta (§4.2). |

## 2. El esquema: migración local 039 y su espejo 0039

### 2.1 La 039 (SQLite)

```sql
ALTER TABLE productos
  ADD COLUMN precio_mayorista TEXT
    CONSTRAINT productos_precio_mayorista_canonico
    CHECK (precio_mayorista IS NULL
           OR (typeof(precio_mayorista) = 'text'
               AND precio_mayorista GLOB '[0-9]*.[0-9][0-9]'
               AND NOT precio_mayorista GLOB '*.*.*'
               AND NOT precio_mayorista GLOB '?*-*'
               AND NOT precio_mayorista GLOB '-*'));

ALTER TABLE productos
  ADD COLUMN cantidad_minima_mayorista TEXT
    CONSTRAINT productos_cantidad_minima_mayorista_canonica
    CHECK (cantidad_minima_mayorista IS NULL
           OR (typeof(cantidad_minima_mayorista) = 'text'
               AND cantidad_minima_mayorista GLOB '[0-9]*.[0-9][0-9][0-9]'
               AND NOT cantidad_minima_mayorista GLOB '*.*.*'
               AND NOT cantidad_minima_mayorista GLOB '?*-*'
               AND NOT cantidad_minima_mayorista GLOB '-*'
               AND cantidad_minima_mayorista GLOB '*[1-9]*'));   -- R4: > 0

ALTER TABLE productos ADD CONSTRAINT productos_mayorista_completo            -- R1
  CHECK ((precio_mayorista IS NULL AND cantidad_minima_mayorista IS NULL)
      OR (precio_mayorista IS NOT NULL AND cantidad_minima_mayorista IS NOT NULL));

ALTER TABLE productos ADD CONSTRAINT productos_mayorista_menor_que_lista     -- R3
  CHECK (precio_mayorista IS NULL
         OR CAST(replace(precio_mayorista, '.', '') AS INTEGER)
          < CAST(replace(precio_base, '.', '') AS INTEGER));

UPDATE sync_cola SET payload = json_set(payload,
         '$.precio_mayorista', json('null'),
         '$.cantidad_minima_mayorista', json('null'))
 WHERE entidad_tipo = 'productos' AND sincronizado_en IS NULL
   AND json_type(payload, '$.precio_mayorista') IS NULL;
```

Lo que conviene saber de cada pieza:

- **La forma canónica copia la de `precio_compra` (031) y la de
  `cantidad_predefinida_icono` (001).** «Estrictamente mayor que cero» se
  escribe como en la 001: no empieza con menos y tiene al menos un dígito
  distinto de cero.
- **R3 compara CENTAVOS ENTEROS, nunca texto ni punto flotante.** En SQLite
  estas columnas son TEXT, y el texto se compara byte a byte: `'10.00' <
  '9.00'` da verdadero (el mismo defecto que §4.15 midió con `ORDER BY`). Un
  `CAST(... AS REAL)` metería punto flotante, que el proyecto prohíbe en
  dinero. Como la forma canónica garantiza exactamente dos decimales, quitar el
  punto da los centavos: `'6.00'` → 600, `'0.50'` → 50. Es exacto. Se prueba
  con los pares que engañan a la comparación de texto.
- **R1 y R3 son restricciones de tabla**, con `ADD CONSTRAINT`, que SQLite no
  documenta pero que el proyecto ya usa y tiene medido en la versión empaquetada
  (008, 038). Si una versión futura de SQLite dejara de aceptarla, las pruebas
  de la migración fallan en desarrollo.
- **Ninguna de las cuatro puede dar NULL**: todas empiezan por `IS NULL OR` o
  son combinaciones de `IS NULL` / `IS NOT NULL`. La auditoría permanente lo
  comprueba sola.
- **Las filas que ya existen quedan con NULL en las dos columnas**, así que
  pasan las cuatro restricciones.

### 2.2 La 0039 (Postgres)

```sql
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS precio_mayorista NUMERIC(14, 2)
    CONSTRAINT productos_precio_mayorista_no_negativo
    CHECK (precio_mayorista IS NULL OR precio_mayorista >= 0);

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS cantidad_minima_mayorista NUMERIC(14, 3)
    CONSTRAINT productos_cantidad_minima_mayorista_positiva
    CHECK (cantidad_minima_mayorista IS NULL OR cantidad_minima_mayorista > 0);

ALTER TABLE public.productos ADD CONSTRAINT productos_mayorista_completo
  CHECK ((precio_mayorista IS NULL AND cantidad_minima_mayorista IS NULL)
      OR (precio_mayorista IS NOT NULL AND cantidad_minima_mayorista IS NOT NULL));

ALTER TABLE public.productos ADD CONSTRAINT productos_mayorista_menor_que_lista
  CHECK (precio_mayorista IS NULL OR precio_mayorista < precio_base);

COMMENT ON COLUMN public.productos.precio_mayorista IS '…';
COMMENT ON COLUMN public.productos.cantidad_minima_mayorista IS '…';
```

- **Tipos**: `NUMERIC(14,2)` como `precio_base` y `NUMERIC(14,3)` como
  `cantidad_predefinida_icono`. En Postgres la comparación es numérica y exacta.
- **Las dos reglas de tabla llevan el MISMO nombre en los dos lados**, como la
  038. Las de forma se llaman distinto, como en la 031/0031: en Postgres no hay
  «forma canónica» que exigir.
- **No se toca ninguna función.** `escribir_fila` y `exigir_claves_conocidas`
  leen las columnas del catálogo al ejecutar (§4.20). La versión de contrato no
  sube.

### 2.3 Todo lo demás que tiene que saber de las dos columnas

| Pieza | Cambio |
|---|---|
| `migrator.ts` | La 039 en el registro, con el comentario de su espejo. |
| `supabase/esquema-nube.json` | Las dos columnas al final de `productos`, en el orden de la 0039. |
| `CLASES_DE_COLUMNA.productos` | `precio_mayorista: 'monto'`, `cantidad_minima_mayorista: 'cantidad'`. |
| `verificacion-de-nube.cjs` | Las dos claves en `null` en el payload de productos. |
| `supabase/migrations/README.md` | Las filas de la 039 y la 0039. |
| `errores.ts` | Reglas específicas para `productos_mayorista_completo`, `productos_mayorista_menor_que_lista` y los dos CHECK de forma, antes de la genérica. |

### 2.4 Cómo se ensaya antes de mostrar el SQL

1. **Vitest** sobre SQLite real: cada regla, con aceptados y rechazados (CA-17),
   y la migración sobre datos viejos y sobre la cola (CA-18).
2. **Una copia de la base de trabajo real** de esta Mac, migrada con el
   migrador de la aplicación, con el sha256 del original antes y después
   (CA-18; regla de §4.14).
3. **Un Postgres 17 LOCAL** (el de Homebrew, en el scratchpad), con lo mínimo de
   Supabase simulado como en §4.53: se aplican las migraciones del repositorio
   en orden, después la 0039, y se prueban las cuatro reglas con `INSERT` y
   `UPDATE` dentro de transacciones que terminan en `ROLLBACK`. Se comprueba
   también que el contrato declare las dos columnas como dice la foto. **No es
   Supabase**: lo que es de la plataforma se ve recién en el descartable.
4. **Recién entonces se le muestra a Julio el SQL completo** de la 039 y la
   0039. Ninguna nube se toca sin su aprobación, proyecto por proyecto.

### 2.5 Orden de aplicación, y por qué importa

Las funciones de la nube exigen el payload exacto. Por eso:

| Terminal | Nube | Qué pasa |
|---|---|---|
| Con la 039 | Sin la 0039 | El primer lote de productos o de venta se rechaza por «columnas de más» y la cola se detiene, visible. |
| Sin la 039 | Con la 0039 | Lo mismo, por «columnas de menos». |
| Con las dos | — | Sube. La 039 ya reescribió los payloads que esperaban. |

Es la misma situación que se midió con la 0031 (§4.39). Hoy la tienda corre la
1.2.0 **sin nube** (roadmap §1), así que no hay una cola que detener: el riesgo
aparece el día que se conecte una versión con la 039, y ese día la nube tiene
que tener la 0039.

## 3. La configuración: dominio, servicio e IPC

### 3.1 Un par que no se puede construir a medias

`Producto` gana `mayorista: PrecioMayorista | null`, **un solo objeto** con el
precio y la cantidad mínima, no dos campos sueltos. Es el criterio de
`AutorizacionDeDescuento` (§4.13): un precio sin cantidad **no se puede
construir**. El repositorio lo parte en las dos columnas al escribir y lo arma al
leer; si alguna vez leyera una fila con una sola de las dos llena (la base no lo
permite), **lanza** en vez de inventar la otra.

### 3.2 Una sola regla para el formulario y el servicio

```ts
// src/shared/precio-mayorista.ts
export function revisarPrecioMayorista(entrada: {
  readonly precioBase: string;
  readonly precioMayorista: string | null;   // null o '' = no viene
  readonly cantidadMinima: string | null;
}): { ok: true; mayorista: { precio: Decimal; cantidadMinima: Decimal } | null }
  | { ok: false; mensaje: string; causaTecnica: string };
```

Aplica R1 a R4 **sobre los valores redondeados** —el precio a dos decimales y la
cantidad a tres, igual que se van a guardar—, así que decide lo mismo que
decidiría la base. El formulario la llama mientras se escribe; el servicio la
llama antes de escribir y convierte el rechazo en `ErrorDeNegocio`
(`DATO_INVALIDO`). **El texto de cada rechazo existe una sola vez.**

Al **editar**, si el pedido no trae los campos del mayorista (un guion o una
prueba que no habla de precios), se conserva el que el producto ya tenía, como
el precio de compra (§4.39). **La regla R3 se revisa igual contra el precio de
lista nuevo**: es lo que hace que bajar la lista por debajo del mayorista dé un
mensaje de negocio y no un error de la base (CA-24).

### 3.3 IPC

| Contrato | Cambio |
|---|---|
| `esquemaProductoNuevo` / `esquemaProductoEditado` | `precioMayorista` y `cantidadMinimaMayorista`, obligatorios en el payload y nulables, como `precioCompra`. Van sueltos a propósito: si faltara uno, el servicio responde con el mensaje de R1 y no con un rechazo genérico de Zod. |
| `ProductoIpc` (administración) | `mayorista: PrecioMayoristaIpc \| null`. |
| `ProductoParaVender` (cuadrícula) | `mayorista: PrecioMayoristaIpc \| null`. `precioEfectivo` sigue siendo el precio sin mayorista; se corrige su comentario. |
| `VentaRegistrada` | `lineasConPrecioMayorista`, al lado de `lineasConPrecioEspecial`. |

### 3.4 Asientos

`producto_creado` y `producto_editado` ganan `precioMayorista` y
`cantidadMinimaMayorista` (antes y después). `venta_registrada` gana, por línea,
`origenDelPrecio` y `mayorista`. `precioEspecialId` sigue existiendo, pero solo
se llena cuando el precio especial fijó el precio.

## 4. La venta

### 4.1 `resolverLinea`

```ts
const efectivo = precioEfectivoDe(producto.precioBase, vigentes.get(producto.id) ?? []);
const elegido = precioDeLinea(
  {
    lista: producto.precioBase,
    especial: efectivo.especialAplicado === null ? null : efectivo.precio,
    mayorista: producto.mayorista,
  },
  cantidad, // ya redondeada a tres decimales
);
```

`precioUnitario` pasa a ser `elegido.precio`; la línea guarda `origen`, y
`especialAplicado` solo si `origen === 'especial'`. Nada más de la transacción
cambia: el subtotal, el descuento, el reparto de centavos y el congelado usan el
precio unitario como hoy.

### 4.2 El descuento discrecional

No se toca ninguna línea de `@shared/descuento` ni de `resolverDescuento`. Lo
comprueban las pruebas de descuento que ya existen, sin modificarlas, más CA-15.

## 5. La pantalla de venta

### 5.1 La línea del ticket

`LineaDeTicket` gana tres campos, todos fotos de lo que llegó al abrir la
pantalla: `precioConEspecial` (el precio con el especial, o `null`), `mayorista`
y `origenDelPrecio`. `precioUnitario` se sigue llamando igual —lo leen el
subtotal, el total y el diálogo de cobro—, pero deja de ser fijo: **lo recalcula
`precioDeLinea` cada vez que cambia la cantidad**, dentro de `agregarAlTicket`
(producto nuevo y producto que ya estaba) y de `fijarCantidad`. Así ningún
camino que cambie la cantidad puede olvidarse de recalcular: los dos pasan por la
misma función privada.

### 5.2 La marca

En `TicketDeVenta.tsx`, en la misma fila y con el mismo estilo que el precio
especial:

| Origen | Fila | `data-prueba` |
|---|---|---|
| `especial` | «Precio especial · 10 % menos · antes ~~Q6.00~~» (como hoy) | `precio-especial` |
| `mayorista` | «Precio mayorista · desde 50 lb · antes ~~Q6.00~~» | `precio-mayorista` |
| `lista` | Ninguna | — |

Se distingue por el texto y por una clase propia, con el mismo tamaño y lugar.

## 6. El formulario

`Borrador` gana `aplicaMayorista: boolean`, `precioMayorista: string` y
`cantidadMinimaMayorista: string`.

- La casilla es un `<input type="checkbox">` con el tipo literal, que la prueba
  de §4.46 admite. Los dos campos son `CampoDeTexto`, con el teclado en pantalla.
- **Desmarcar vacía los dos campos en el mismo cambio de estado**: no hay un
  instante en que la casilla esté desmarcada y los valores sigan ahí.
- `motivoParaNoGuardar` suma, con la casilla marcada: primero «falta el precio»
  o «falta la cantidad» (con los textos de la función compartida) y después
  `revisarPrecioMayorista`. Con la casilla desmarcada no revisa nada y el payload
  lleva `null` en los dos.

## 7. Las pruebas

### 7.1 Nuevas

| Archivo | Qué exige | Criterios |
|---|---|---|
| `src/shared/__tests__/precio-de-linea.test.ts` | Los tres escenarios de precedencia con cada ganador, los empates, el caso de seguridad, lb, kg y unidades en los dos lados del umbral | CA-1 a CA-11 |
| `src/shared/__tests__/precio-mayorista.test.ts` | R1 a R4 con sus textos, el redondeo antes de comparar, y los pares que engañan a la comparación de texto | CA-17, CA-21 |
| `src/main/database/__tests__/productos-precio-mayorista.test.ts` | La 039: cada restricción con aceptados y rechazados por nombre, datos viejos, la cola, el espejo 0039 con los mismos nombres | CA-17, CA-18, CA-19, CA-24 |
| `src/main/domain/venta/__tests__/precio-mayorista-en-la-venta.test.ts` | Los mismos escenarios con el servicio y SQLite real: `precio_unitario_snap`, el origen en el asiento, el descuento, y **la pantalla contra el servicio** en una grilla | CA-1 a CA-6, CA-10, CA-11, CA-13 a CA-15, CA-23 |
| Reporte (`reportes.test.ts`) | El margen de una venta a precio mayorista, con números | CA-16 |
| Servicio de productos, formulario, ticket y pantalla de venta | Sus partes de CA-12, CA-20, CA-21 y CA-24, y la marca de V3 | CA-12, CA-20, CA-21, CA-24 |

### 7.2 Las que cambian, y cómo queda constancia

- `anulacion-solo-presencial.test.ts:165` pasa a aplicar solo hasta la 038. Mide
  lo mismo; se deja escrito por qué.
- Los objetos de prueba que arman `ProductoParaVender`, `ProductoIpc`,
  `LineaDeTicket` o `VentaRegistrada` a mano ganan los campos nuevos (el
  compilador los señala todos).
- Si alguna prueba fija las claves exactas del asiento `venta_registrada`, gana
  las dos nuevas, con un comentario que lo diga.

### 7.3 Falsificación

Una mutación por vez, con el sha256 del archivo antes y después, anotando qué
cae:

| # | Mutación | Qué tiene que caer |
|---|---|---|
| M1 | **Quitar el precio de lista de los candidatos** (pedido explícito) | El caso de seguridad (CA-7) |
| M2 | Umbral exclusivo (`>` en vez de `>=`) | CA-2 en el borde |
| M3 | El mayorista sin mirar la cantidad | CA-1 |
| M4 | El ticket no recalcula al cambiar la cantidad | CA-12 |
| M5 | El servicio ignora el mayorista | CA-2 del servicio y la comparación pantalla/servicio (CA-13) |
| M6 | Sin el CHECK de R3 | CA-17 y la parte de base de CA-24 |
| M7 | Desmarcar la casilla no vacía los campos | CA-20 |
| M8 | La 039 sin la reescritura de la cola | CA-18 |
| M9 | La marca dice «Precio especial» cuando ganó el mayorista | La prueba de V3 |
| M10 | R1 escrita con la forma que puede dar NULL | CA-22 (la auditoría permanente) |

## 8. Verificación en la aplicación real

Un arnés nuevo, `scripts/verificacion-de-precio-mayorista.cjs`
(`npm run verify:pantallas:mayorista`), con el patrón de los demás: la
aplicación compilada sin nube, una carpeta de datos temporal, la ventana fijada
en **1024×768** por CDP antes de cada medición, y la aplicación terminada solo
con `terminarAplicacion`. Recorre:

1. **El formulario:** la casilla desmarcada al crear, los campos que no
   existen, marcarla, un precio mayorista igual al de lista (el aviso, el botón
   deshabilitado), desmarcarla (los valores se van), volver a marcarla (vacíos),
   guardar una configuración válida, y leer la fila de la base. Editar: la
   casilla aparece marcada con los valores. Intentar bajar la lista por debajo
   del mayorista: el aviso.
2. **La venta:** abrir la caja, agregar el producto (por peso), ver el precio de
   lista sin marca, llevar la cantidad al umbral con el teclado (precio
   mayorista, marca, total), bajarla (vuelve), subirla otra vez, cobrar, y leer
   `venta_detalle.precio_unitario_snap` y el asiento de la base.

Imprime cada paso con lo que leyó de la pantalla y de la base, y sale con código
1 si algo falla. Se falsifica con M4 (la pantalla no recalcula) para ver que el
arnés lo atrapa.

## 9. Documentación

- CLAUDE.md: §4.66 nueva; filas de §5; §6.2 punto 3 (resuelto por cantidad) y
  las preguntas nuevas; §7; §8 (el comando del arnés); §9 (la carpeta de la spec
  y los dos módulos compartidos).
- `spec/constitution/roadmap.md` y `mission.md` §5, que dice que el sistema «no
  distingue precio al detalle de precio al por mayor».
- `supabase/migrations/README.md`.

## 10. Riesgos

| Riesgo | Qué se hace |
|---|---|
| **La pantalla y el cobro calculan distinto** y el cliente paga otro precio del que vio | Una sola función compartida, y una prueba que compara las dos capas en una grilla (CA-13). |
| **La nube y la terminal quedan desparejas** y la cola se detiene | Se documenta el orden (§2.5); la 0039 no se aplica sin Julio; la batería queda exigiendo la 0039. |
| **Cambiar de libras a kilogramos** deja el mismo número de cantidad mínima con otro significado | Igual que el precio de lista hoy. Las etiquetas del formulario dicen la unidad. Queda como pregunta (spec §11.5). |
| **El salto de precio en el umbral** (más cantidad, menos total) | Es propio de la regla. Está en el spec (P10) para que nadie lo lea como un defecto. |
| **La gramática `ADD CONSTRAINT` no documentada** | Precedente en la 008 y la 038; las pruebas de la 039 fallan si SQLite deja de aceptarla. |
| **La decisión 1 se da vuelta** después de construir | La 039 no está aplicada en ninguna base que importe y la 0039 en ninguna nube; el cambio a B está descrito en §11. |
| **Todo se mide en macOS** | Windows sigue pendiente, como el resto del proyecto. |

## 11. Si Julio elige B en la decisión 1

Lo que cambiaría, para que la decisión se tome sabiendo el costo:

1. **La 039 y la 0039 pierden el CHECK `productos_mayorista_menor_que_lista`.**
2. **En su lugar, un disparador `BEFORE UPDATE OF precio_mayorista,
   cantidad_minima_mayorista`** en los dos lados, que rechaza solo cuando el
   precio mayorista CAMBIA y queda mayor o igual que la lista. **No puede haber
   uno de `INSERT`**: la restauración y la subida insertan filas de la nube que
   pueden estar legítimamente en ese estado (la lista bajó después), y un
   disparador de alta las rechazaría. Así que el alta queda cubierta solo por
   el servicio. En Postgres, además, la función del disparador es una función
   nueva que hay que agregar a la lista de `contrato_de_sincronizacion` (regla
   de §4.29), y eso reescribe el contrato y la foto.
3. **El servicio y el formulario** revisarían R3 solo cuando cambian los campos
   del mayorista, y al bajar la lista por debajo mostrarían un aviso que no
   bloquea.
4. **El caso de seguridad** se probaría también con el servicio y en la
   aplicación real.

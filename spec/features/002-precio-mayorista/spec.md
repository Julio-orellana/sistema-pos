# 002 — Precio mayorista por cantidad mínima

> **Estado:** spec escrito el 2026-09-18, antes de tocar el código. Lo siguen
> [`plan.md`](plan.md) (cómo se construye) y [`tasks.md`](tasks.md) (la lista de
> tareas).
>
> **Construido en `develop` el mismo día**, con la evidencia en CLAUDE.md §4.66.
> Queda abierto: **la decisión 1 (§4.3)** y **la 0039, escrita y sin aplicar en
> ninguna nube**. Verificado en macOS; no en Windows.
>
> **Pedido por:** Julio Orellana. **Cliente:** Jimmy Cano.
>
> **Resuelve a medias el punto 3 de §6.2 de CLAUDE.md** («¿El precio de mayoreo
> se activa por cantidad comprada, por tipo de cliente, o ambos?»): se activa
> **por cantidad comprada**. Por tipo de cliente queda fuera (§10).

---

## 1. El problema

La tienda vende al detalle y al por mayor (CLAUDE.md §1), pero el sistema no
distingue una cosa de la otra: la constitución lo dice en su lista de lo que el
sistema NO es («No distingue precio al detalle de precio al por mayor»,
`spec/constitution/mission.md` §5). Hoy el precio de una línea sale de dos
cosas:

| Mecanismo | Qué es | Dónde vive |
|---|---|---|
| **Precio de lista** | El precio del producto | `productos.precio_base` |
| **Precio especial** | Una **rebaja** preconfigurada, por fecha, en porcentaje o en quetzales, que se resta del precio de lista (con piso en cero) | `precios_especiales`, aplicado por `precioEfectivoDe` (`src/main/domain/venta/precios.ts`) |

Y encima, sobre la venta completa, el **descuento discrecional** con tope por
rol, que este spec no toca.

El precio que se cobra queda congelado en cada línea, en
`venta_detalle.precio_unitario_snap`. De ahí lo leen el recibo, el margen y los
reportes. **El precio mayorista entra por ese mismo mecanismo**: no se crea
ningún campo nuevo en las líneas de venta.

## 2. Qué se pide

1. Un producto puede tener, opcionalmente, un **precio mayorista** y una
   **cantidad mínima**. Sin ellos, el producto funciona exactamente igual que
   hoy.
2. En la venta, si la cantidad de la línea llega a la cantidad mínima, el
   precio mayorista **compite** con los demás.
3. El precio que se cobra es **el menor de los que aplican**.
4. La pantalla recalcula el precio **en vivo** cuando la cantidad cruza el
   umbral, en las dos direcciones, y dice por qué el precio no es el de lista.
5. El formulario de producto tiene un interruptor para activarlo, desmarcado
   por omisión.

## 3. La regla del precio

### 3.1 En una frase

> **El precio de una línea es el MENOR entre el precio de lista vigente, el
> precio especial vigente (si hay uno) y el precio mayorista (si la cantidad de
> ESA línea llega a la cantidad mínima).**

El precio de lista participa **siempre** en la comparación, como piso de
seguridad: un precio mayorista que haya quedado más caro que el de lista nunca
se cobra. Es la decisión de negocio que Julio dio por tomada en el pedido.

### 3.2 Los tres candidatos

| Candidato | Valor | Cuándo participa |
|---|---|---|
| **Lista** | `productos.precio_base` en el momento de cobrar | Siempre |
| **Especial** | El precio de lista menos el precio especial vigente más reciente, con piso en cero y redondeado a centavos. **Es la regla de hoy, sin cambios** (`precioEfectivoDe`) | Solo si hay un precio especial vigente |
| **Mayorista** | `productos.precio_mayorista` | Solo si el producto lo tiene configurado **y** la cantidad de la línea es **mayor o igual** que `productos.cantidad_minima_mayorista` |

**Una aclaración sobre el precio especial, leída en el código.** Hoy el precio
especial nunca puede ser más caro que el de lista: es una rebaja, y
`precios_especiales.valor` tiene piso en cero (`001_esquema_inicial.sql`,
tabla 4). O sea que entre lista y especial siempre gana el especial, igual que
hoy. Lo nuevo es el tercer candidato.

### 3.3 Las precisiones que hacen falta para que la regla no sea ambigua

| # | Precisión | Por qué |
|---|---|---|
| P1 | **El umbral es inclusivo.** Con una cantidad mínima de 50 lb, 50.000 lb ya califica; 49.999 lb no. | «A partir de 50 libras» incluye las 50. |
| P2 | **El precio mayorista se aplica a TODA la línea**, no solo a lo que pasa del umbral. | Es lo que dice el pedido («si la cantidad de ESA línea ya califica»). Un precio por tramos sería otro módulo (§10). |
| P3 | **La cantidad que se compara es la de la línea, que es la cantidad total de ese producto en la venta.** | El ticket junta el mismo producto en una sola línea y el proceso principal rechaza dos líneas del mismo producto (CLAUDE.md §4.13). No hay forma de partir una compra para esquivar el umbral ni de sumarla dos veces. |
| P4 | **La cantidad mínima está en la unidad del producto**: libras o kilogramos si se vende por peso, unidades si se vende por unidad. | Es la misma unidad en que se escribe la cantidad del ticket. |
| P5 | **Si dos candidatos empatan en el precio menor**, el cobro es el mismo; lo único que decide el empate es **qué se muestra**. El orden es: especial, lista, mayorista. | Conserva el comportamiento de hoy: un precio especial vigente se marca siempre, aunque rebaje cero. Y el mayorista solo se marca cuando **baja** el precio: si empata, no hizo nada. |
| P6 | **El descuento discrecional no cambia.** Se aplica sobre el subtotal que resulte de estos precios, con las mismas funciones de hoy (`@shared/descuento`). | Restricción del pedido. Es lo mismo que ya pasa con el precio especial (§4.13, «Un mismo ticket puede llevar los dos»). |
| P7 | **No hay un selector de «detalle» o «mayoreo»**, ni cliente. El cambio es automático, por cantidad. | La pantalla de venta decidió no dibujar ese selector mientras no existiera el módulo (CLAUDE.md §4.12). Este spec lo hace innecesario. |
| P8 | **El precio elegido se congela en `precio_unitario_snap`**, como hoy. | Pedido explícito: reusar el mecanismo. Recibo, margen y reportes lo leen de ahí sin cambios. |
| P9 | **Lo que se cobra lo decide el proceso principal**, con el catálogo del momento de cobrar. La pantalla muestra el mismo cálculo con los datos que cargó al abrirse. | Es la regla de hoy para el precio especial (CLAUDE.md §4.12): el pago no lleva precios, solo producto y cantidad. |
| P10 | **Cruzar el umbral hacia arriba puede bajar el total.** 49.999 lb a Q6.00 son Q299.99; 50 lb a Q5.50 son Q275.00. | Es propio de cualquier precio por cantidad mínima. Se dice para que nadie lo lea como un defecto. |

## 4. La configuración del producto

### 4.1 Dos columnas nuevas, las dos opcionales

| Columna | Forma | Sin configurar |
|---|---|---|
| `productos.precio_mayorista` | Monto canónico de **dos** decimales, como `precio_base` | `NULL` |
| `productos.cantidad_minima_mayorista` | Cantidad canónica de **tres** decimales, como el peso y la cantidad | `NULL` |

**Premisa del pedido corregida:** el pedido nombra «precio_venta». Esa columna
no existe: el precio de lista es `productos.precio_base` (buscado en `src`,
`supabase` y `scripts` el 2026-09-18, sin ninguna aparición de `precio_venta`).
Todo lo que el pedido dice de «precio_venta» se aplica a `precio_base`.

**Los productos que ya existen quedan sin precio mayorista** (`NULL` en las
dos). Ninguno cambia de precio.

### 4.2 Las reglas, y en qué capa se hace cumplir cada una

| # | Regla | Base (CHECK) | Servicio | Formulario |
|---|---|---|---|---|
| R1 | **Van juntos**: los dos llenos o los dos vacíos | Sí | Sí | Sí (el interruptor) |
| R2 | El precio mayorista es un monto válido y **no negativo** | Sí | Sí | Sí |
| R3 | El precio mayorista es **estrictamente menor** que el precio de lista | **Sí (ver §4.3)** | Sí | Sí |
| R4 | La cantidad mínima es una cantidad válida y **estrictamente mayor que cero** | Sí | Sí | Sí |

El texto de cada rechazo es **el mismo** en el formulario y en el servicio:
sale de una sola función compartida (plan §3). La base es la última red: si
alguna vez llegara hasta ella, el error se traduce a un mensaje de negocio
(`errores.ts`), no a «CHECK constraint failed».

**Sobre R2, el cero.** Se acepta un precio mayorista de Q0.00, igual que se
acepta un precio de lista de cero (CLAUDE.md §4.2). Para qué le serviría a la
tienda es una definición que nadie dio, y este spec no la inventa. Ver la
pregunta 3 de §11.

### 4.3 El choque entre R3 en la base y el caso de seguridad (DECISIÓN 1, A REVISAR)

El pedido dice dos cosas que, tal como están escritas, **no pueden cumplirse a
la vez**:

- «`precio_mayorista` debe ser estrictamente menor que `precio_venta` al
  guardarse. **Validalo en la base con CHECK**, no solo en la aplicación.»
- «El caso de seguridad: precio mayorista fijo que queda MÁS CARO que un precio
  de lista **reducido después**.»

Un CHECK de la base se vuelve a evaluar **cada vez que se escribe la fila**, no
solo cuando se guarda el precio mayorista. Si la base exige mayorista < lista,
bajar después el precio de lista por debajo del mayorista **se rechaza**: el
caso de seguridad no puede llegar a existir en los datos.

Las dos salidas:

| | A. CHECK siempre (**lo que se construye**) | B. La regla R3 solo al guardar el mayorista |
|---|---|---|
| En la base | CHECK `productos_mayorista_menor_que_lista`, en SQLite y en Postgres | Un disparador que se evalúa solo cuando cambian las columnas del mayorista. No es un CHECK, y no puede cubrir el alta ni la restauración (plan §11) |
| Bajar la lista por debajo del mayorista | **Se rechaza**, con un mensaje que dice qué hacer: bajar o quitar el mayorista en el mismo formulario | Se acepta. El mayorista queda «muerto» hasta que se corrija, y el piso de seguridad hace que se cobre la lista |
| El caso de seguridad | **No puede darse con datos guardados.** Se prueba sobre la función compartida que usan la venta y la pantalla (CA-7), con su falsificación (CA-8), y se prueba aparte que la base impide llegar a él (CA-24) | Se puede dar, y se prueba de punta a punta: servicio y aplicación real |
| Qué se cumple del pedido | La letra de R3 («con CHECK») y el piso de seguridad en la regla | El caso de seguridad en el sistema entero; R3 queda en la base solo a medias |

**Se construye A** porque es la letra de la instrucción («con CHECK») y es la
más estricta: con A hay dos protecciones (la base impide el estado, y la regla
de precio igual cobraría la lista), con B una sola. Y porque CLAUDE.md §6 manda
no resolver una definición de negocio «con el mejor criterio técnico»: se deja
señalada y se sigue con el resto.

**La consecuencia de A, dicha en voz alta:** el día que Jimmy quiera bajar el
precio de lista de un producto que tiene mayorista, el formulario le va a pedir
que ajuste o quite el mayorista antes de guardar. **Si Julio prefiere B**, el
cambio está acotado —la 039 y la 0039 no están aplicadas en ninguna base que
importe— y se describe en el plan §11. **Se decide antes de aplicar la 0039 en
cualquier nube.**

## 5. El formulario de producto

| # | Comportamiento |
|---|---|
| F1 | Una casilla **«¿Aplica precio mayorista?»**, **desmarcada** al crear un producto y al editar uno que no lo tiene. |
| F2 | Mientras está desmarcada, **los dos campos no se ven** (no están en la pantalla, no solo ocultos con estilos). |
| F3 | Al marcarla aparecen los dos campos, **vacíos**: «Precio mayorista en quetzales (por lb / kg / unidad)» y «Cantidad mínima para el precio mayorista (en lb / kg / unidades)». |
| F4 | **Al desmarcarla, los dos valores se borran.** Si se vuelve a marcar, los campos aparecen vacíos otra vez. Guardar con la casilla desmarcada **quita** el precio mayorista del producto. |
| F5 | Al editar un producto que **ya tiene** precio mayorista, la casilla aparece **marcada** y los dos campos con sus valores. |
| F6 | Mientras la casilla está marcada, las reglas R1 a R4 se comprueban **mientras se escribe**, con el mismo aviso de siempre (`producto-impedimento`) y el botón de guardar deshabilitado. El texto es el mismo que daría el servicio. |
| F7 | El precio usa el teclado decimal. La cantidad mínima usa el decimal si el producto se vende por peso y el de enteros si se vende por unidad, igual que la cantidad del ícono. |
| F8 | Las etiquetas dicen la unidad del producto y cambian si cambia el tipo de medida o la unidad de peso. |

## 6. La pantalla de venta

| # | Comportamiento |
|---|---|
| V1 | El precio unitario de la línea es el que resulta de la regla de §3, **con la cantidad de ese momento**. |
| V2 | **Recálculo en vivo.** Cambiar la cantidad —con el teclado o volviendo a tocar el ícono— recalcula el precio, el subtotal de la línea y el total del ticket. Subir hasta el umbral cambia al precio mayorista; bajar por debajo lo devuelve al de antes. |
| V3 | Cuando el precio no es el de lista, **la línea dice por qué**, en su propia fila, en el mismo lugar donde hoy dice «Precio especial»: «**Precio mayorista** · desde 50 lb · antes ~~Q6.00~~» o «**Precio especial** · 10 % menos · antes ~~Q6.00~~». Nunca las dos a la vez: se nombra solo la que fijó el precio. |
| V4 | Con el precio de lista no se muestra ninguna marca, como hoy. |

## 7. Lo que queda escrito al cobrar

| Qué | Cómo |
|---|---|
| `venta_detalle.precio_unitario_snap` | El precio elegido. **Ninguna columna nueva** en `venta_detalle`. |
| Asiento `venta_registrada`, por línea | Se agrega **`origenDelPrecio`** (`lista`, `especial` o `mayorista`) y, si el producto tiene precio mayorista, **`mayorista`** con el precio y la cantidad mínima usados. `precioEspecialId` queda como hoy, pero solo cuando el precio especial fue el que fijó el precio. Es contenido del asiento: no cambia ningún esquema. Lo propone este spec, no el pedido; ver la pregunta 4 de §11. |
| Asientos `producto_creado` y `producto_editado` | Llevan `precioMayorista` y `cantidadMinimaMayorista`, antes y después. |
| El recibo | Sin cambios: imprime el precio cobrado, como con el precio especial. No lleva marca de mayorista (§10). |
| El margen del reporte por producto | Sin cambios de código: `subtotal_impreso − costo_unitario_snap × cantidad`, y `subtotal_impreso` sale del precio congelado. **Se comprueba con una prueba** (CA-16). |
| La anulación | Sin cambios: repone inventario y devuelve el total de la venta, que ya incluye el precio mayorista. |

## 8. La nube y la sincronización

- **Migración local 039** y **su espejo 0039** en Postgres, con los mismos
  nombres de restricción.
- **La 0039 está escrita y NO se aplica en ningún proyecto** sin la aprobación
  explícita de Julio, y por separado para cada uno: primero
  `pos-pruebas-descartable`; `pos-jimmy-cano`, nunca sin un pedido aparte.
- **La 039 y la 0039 van juntas.** Las funciones de la nube exigen el payload
  exacto (`exigir_claves_conocidas`). Una terminal con la 039 contra una nube
  sin la 0039 detiene su cola en el primer lote de productos o de venta, y al
  revés también: medido para la 0031 (CLAUDE.md §4.39).
- La 039 le agrega las dos claves, en `null`, a los payloads de productos que
  esperaban en la cola, como hizo la 031.
- La versión de contrato no sube: se agregan columnas y ninguna función cambia.

## 9. Criterios de aceptación

Cada criterio dice cómo se comprueba. «Vitest» es la suite automatizada
(`npm run verify`). «App real» es un arnés que maneja la aplicación Electron
compilada, a 1024×768 exactos. **Todo se verifica en macOS; Windows queda
pendiente, como siempre.**

Los ejemplos usan: **Maíz** por libra, lista Q6.00, mayorista Q5.50 desde
50 lb; **Azúcar** por kilogramo, lista Q9.00, mayorista Q8.20 desde 25.5 kg;
**Huevo** por unidad, lista Q1.25, mayorista Q1.10 desde 30 unidades.

| # | Criterio | Cómo se comprueba |
|---|---|---|
| CA-1 | **Solo mayorista, sin llegar al umbral.** Maíz, 49.999 lb, sin precio especial: se cobra Q6.00, origen lista, sin marca. | Vitest: función compartida y servicio con base real |
| CA-2 | **Solo mayorista, justo en el umbral.** Maíz, 50.000 lb: se cobra Q5.50, origen mayorista (P1). Con 80 lb, también Q5.50. | Vitest: función compartida y servicio |
| CA-3 | **Solo especial.** Maíz sin mayorista, precio especial del 10 %: se cobra Q5.40, origen especial, con cualquier cantidad. **Igual que hoy.** | Vitest: función compartida y servicio |
| CA-4 | **Los dos, gana el mayorista.** Maíz con especial del 5 % (Q5.70) y mayorista Q5.50 desde 50 lb: con 50 lb se cobra Q5.50 (mayorista); con 49.999 lb, Q5.70 (especial). | Vitest: función compartida y servicio |
| CA-5 | **Los dos, gana el especial.** Maíz con especial del 10 % (Q5.40) y mayorista Q5.50 desde 50 lb: con 60 lb se cobra Q5.40 (especial), aunque la cantidad califique. | Vitest: función compartida y servicio |
| CA-6 | **Empate.** Especial de Q0.50 menos (Q5.50) y mayorista Q5.50, con 60 lb: se cobra Q5.50 y la marca es la del especial (P5). | Vitest |
| CA-7 | **SEGURIDAD.** Mayorista Q5.50 fijado cuando la lista era Q6.00; la lista baja después a Q5.00; sin especial; 60 lb: se cobra **Q5.00, origen lista**, nunca el mayorista. Con un especial del 10 % sobre la lista nueva: Q4.50, origen especial. | Vitest, sobre la función compartida que usan la venta y la pantalla (con A, la base no deja guardar ese estado: CA-24) |
| CA-8 | **Falsificación del piso.** Quitar el precio de lista de la comparación de mínimos hace caer CA-7. | Mutación temporal, con el sha256 del archivo antes y después |
| CA-9 | **Por peso, en libras.** Cubierto por CA-1 y CA-2: el borde está en el tercer decimal. | Vitest |
| CA-10 | **Por peso, en kilogramos.** Azúcar: 25.499 kg → Q9.00 (lista); 25.500 kg → Q8.20 (mayorista). | Vitest: función compartida y servicio |
| CA-11 | **Por unidad.** Huevo: 29 → Q1.25; 30 → Q1.10. | Vitest: función compartida y servicio |
| CA-12 | **Recálculo en vivo.** En el ticket, subir la cantidad hasta el umbral cambia el precio, la marca y el total; bajarla los devuelve. Vale con el teclado y volviendo a tocar el ícono. | Vitest (ticket) y app real |
| CA-13 | **Lo que la pantalla muestra es lo que se cobra.** Para una grilla de casos (los tres productos, con y sin especial, a los dos lados del umbral), el precio de la línea del ticket es igual al `precio_unitario_snap` que guarda la venta. | Vitest, ticket contra servicio con base real |
| CA-14 | El precio elegido queda en `precio_unitario_snap`, y `venta_detalle` **no tiene ninguna columna nueva**. | Vitest |
| CA-15 | **El descuento discrecional no cambia.** Maíz 50 lb a precio mayorista (Q275.00) con un 10 % de descuento: subtotal Q275.00, total Q247.50. Las pruebas de descuento que ya existen pasan sin tocarlas. | Vitest |
| CA-16 | **El margen refleja el precio mayorista.** Maíz con costo Q4.00: 50 lb a Q5.50 dan un margen de **Q75.00** en el reporte por producto (con el precio de lista habría dado Q100.00). | Vitest, reporte real sobre base real |
| CA-17 | **La base hace cumplir R1 a R4**, con restricciones con nombre: rechaza uno de los dos solo, un precio negativo o mal formado, un precio igual o mayor que la lista, y una cantidad cero, negativa o mal formada. Acepta los dos vacíos y una configuración válida. | Vitest sobre SQLite real |
| CA-18 | **La 039 sobre datos que ya existen:** los productos quedan sin mayorista, los payloads pendientes ganan las dos claves en `null` y lo ya subido no se toca. También sobre una **copia** de la base de trabajo real, con el sha256 del original igual antes y después. | Vitest y corrida sobre la copia (salida cruda en el informe) |
| CA-19 | **El espejo 0039 es exacto:** mismos nombres y mismas reglas; la foto `esquema-nube.json` y la restauración conocen las dos columnas. **No está aplicado en ninguna nube.** | Vitest (deriva y conversión) y ensayo en un Postgres 17 local |
| CA-20 | **El formulario** cumple F1 a F8. | Vitest (jsdom) y app real |
| CA-21 | **El servicio** rechaza cada configuración inválida con su mensaje **antes de escribir nada**, y los asientos del producto llevan los campos del mayorista. | Vitest |
| CA-22 | **Ningún CHECK nuevo puede dar NULL**: la auditoría permanente (`checks-con-null.test.ts`) pasa sin agregar excepciones. | Vitest |
| CA-23 | El asiento `venta_registrada` dice el **origen** del precio de cada línea. | Vitest |
| CA-24 | **(Consecuencia de la decisión 1)** Con un producto que tiene mayorista Q5.50, bajar su precio de lista a Q5.50 o menos se rechaza con un mensaje que dice qué hacer, en el formulario, en el servicio y en la base. | Vitest y app real |
| CA-25 | **La aplicación real:** el interruptor del formulario, y una venta que cruza el umbral en vivo hacia arriba y hacia abajo, se cobra, y deja en la base el precio mayorista. | App real (arnés nuevo) |

## 10. Fuera de alcance

- **Precio por tipo de cliente.** No hay módulo de clientes.
- **Varios umbrales** (por ejemplo, un precio desde 50 lb y otro desde 100 lb)
  y **precios por tramos**.
- **Una marca en el papel del recibo.** El recibo imprime el precio cobrado,
  igual que con el precio especial.
- **Un aviso del tipo «llevando 2 lb más paga Q5.50»** cuando la cantidad no
  llega al umbral, y mostrar el precio mayorista en el ícono de la cuadrícula.
- **Una pantalla para crear precios especiales**, que sigue sin existir (punto
  18 de §6.2). Las pruebas los siembran por el repositorio.
- **Aplicar la 0039 en una nube.** Espera la aprobación de Julio.
- **Windows.**

## 11. Preguntas para Julio

> **CONTESTADAS EL 2026-09-18** (las tres que bloqueaban): la 1 es **A**, tal
> como está construida; la 3 es **NO**: el precio mayorista tiene que ser mayor
> que cero; la 5 es **limpiar**: cambiar la unidad de un producto con mayorista
> lo quita en la misma edición, y el asiento dice por qué. Detalle y evidencia en
> CLAUDE.md §4.66, «Las tres decisiones de Julio». Las preguntas 2 y 4 siguen
> como están construidas.

1. **La decisión 1 (§4.3): ¿A o B?** Se construye A. Hay que decidirlo antes de
   aplicar la 0039.
2. **El empate (P5).** Con el mismo precio, se marca el especial antes que el
   mayorista. Es una elección de este spec: el precio cobrado es el mismo.
3. **¿Se permite un precio mayorista de Q0.00?** Hoy sí, como el precio de
   lista (§4.2). Prohibirlo es una línea en la regla compartida y en los CHECK.
4. **El origen del precio en el asiento de la venta (§7).** No lo pidió el
   pedido. Se agrega porque un auditor va a querer saber por qué una línea se
   cobró a un precio que no es el de lista, y cuesta cero en el esquema.
5. **Cambiar la unidad de un producto** (de libras a kilogramos) deja el mismo
   número de cantidad mínima con otro significado: 50 lb pasan a ser 50 kg. Hoy
   pasa lo mismo con el precio de lista, que también es por unidad. No se
   agrega ningún aviso; ¿hace falta?

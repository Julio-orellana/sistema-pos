# 001 — Dos copias impresas por venta: la del cliente y la de la tienda

> **Estado:** spec escrito el 2026-09-18, antes de tocar el código. Lo siguen
> [`plan.md`](plan.md) (cómo se construye) y [`tasks.md`](tasks.md) (la lista de
> tareas).
>
> **Pedido por:** Julio Orellana. **Cliente:** Jimmy Cano.
>
> **Es el primer spec de `spec/`.** El pedido dice que el proceso de
> Spec-Driven Development «ya está establecido para este proyecto», pero el
> 2026-09-18 no existía ninguna carpeta `spec/` ni ningún `spec.md`, `plan.md`
> o `tasks.md`. Se buscó en todas las ramas locales y remotas (`git ls-tree`) y
> en el disco de todas las copias de trabajo. La numeración arranca acá, con el
> `001`.

---

## 1. El problema

Hoy cada venta imprime **un solo papel**, y ese papel se lo lleva el cliente.
Ese papel lleva dos datos que son de control interno de la tienda:

- **Quién autorizó un descuento** que pasó el tope del rol («Autorizado por:
  Jimmy»). Hoy sale en el papel porque ese papel era la única copia
  (CLAUDE.md §4.14), y una prueba lo exige
  (`src/main/domain/recibo/__tests__/recibo.test.ts:300`).
- **El número de boleta** (el voucher de la terminal del banco) de una venta
  con tarjeta («Boleta 004512»).

Además, **la tienda no se queda con ningún papel**. Lo que queda es el PDF en
el disco y las filas de la base.

## 2. Qué se pide

Cada vez que se imprime un recibo salen **dos copias** por la impresora
térmica:

1. **La copia del cliente**, sin los datos que no le corresponde ver.
2. **La copia de la tienda**, completa, para control interno.

Un encabezado en el papel distingue claramente una copia de la otra.

El **PDF** que se guarda en el disco no cambia: sigue siendo la versión
completa. Lo ven solo personas con sesión, en el historial.

## 3. Qué lleva cada copia, dato por dato

Es la tabla que define el comportamiento. «Sí» quiere decir que el dato sale
**cuando existe**: por ejemplo, la boleta solo existe en una venta con tarjeta.

| # | Dato del papel | Copia del **cliente** | Copia de la **tienda** | PDF y pantalla del historial |
|---|---|---|---|---|
| 1 | Nombre comercial, dirección, teléfono y NIT (o sus marcadores entre corchetes) | Sí | Sí | Sí |
| 2 | «RECIBO DE VENTA» | Sí | Sí | Sí |
| 3 | «Proforma, no válido como factura fiscal» | Sí | Sí | Sí |
| 4 | **Encabezado de la copia** (sección 4) | «COPIA DEL CLIENTE» | «COPIA DE LA TIENDA» + «Control interno. No se entrega al cliente.» | **No lleva**: no es una copia impresa |
| 5 | «** REIMPRESIÓN **» | Sí | Sí | Sí |
| 6 | Marca de venta anulada: «** VENTA ANULADA **», fecha y motivo | Sí | Sí | Sí |
| 6b | **«Autorizó: …»** de la marca de anulada (quién autorizó la anulación) | **NO** (desde el 2026-09-18, decisión 1 de §9) | Sí | Sí |
| 7 | Número de recibo, fecha y hora | Sí | Sí | Sí |
| 8 | Nombre de quien cobró (cajero) | Sí | Sí | Sí |
| 9 | Cada línea: producto, cantidad × precio unitario e importe | Sí | Sí | Sí |
| 10 | «Precios e importes ya incluyen el descuento.» | Sí | Sí | Sí |
| 11 | «Descuento 30 %  -20.07» (tipo, valor y cuánto se rebajó) | Sí | Sí | Sí |
| 12 | **«Autorizado por: …»** (descuento sobre el tope del rol) | **NO** | Sí | Sí |
| 13 | TOTAL | Sí | Sí | Sí |
| 14 | Forma de pago («Efectivo» / «Tarjeta») | Sí | Sí | Sí |
| 15 | **«Boleta …»** (número del voucher) | **NO** | Sí | Sí |
| 16 | «¡Gracias por su compra!» | Sí | Sí | Sí |

**Lo que se oculta es una lista CERRADA de tres datos**: el 6b, el 12 y el 15.
~~de dos datos: el 12 y el 15~~ (corregido el 2026-09-18, decisión 1 de §9).
Todo lo demás sale en las dos copias. Eso incluye cualquier dato que se agregue al
papel en el futuro, salvo que alguien decida explícitamente ocultarlo.

**Datos del cliente.** Hoy el recibo no lleva ningún dato del cliente (nombre,
NIT del comprador, etc.): no existe un módulo de clientes (CLAUDE.md §4.12).
Por la regla anterior, el día que existan saldrán en las dos copias. Ninguna
copia puede omitir un dato del cliente.

**El descuento no se oculta.** La copia del cliente sigue diciendo que hubo
descuento, de cuánto y que los precios ya lo incluyen (datos 10 y 11). Solo se
oculta **quién lo autorizó**. Sin el descuento, el cliente no podría entender
por qué el precio unitario impreso no es el de lista (§4.14).

~~**La marca de anulada (dato 6) NO se oculta, y es a propósito.** El pedido dice
«lo que se oculta es específicamente autorización de descuento y número de
tarjeta/boleta». La anulación también nombra a quien la autorizó («Autorizó:
Jimmy»), que es el mismo tipo de dato. Queda en la pregunta abierta 1 de la
sección 9: no se decide acá.~~

**CORREGIDO EL 2026-09-18: Julio decidió la pregunta 1.** La copia del cliente
tampoco dice quién autorizó la ANULACIÓN (dato 6b), con el mismo criterio que
el autorizante del descuento. **La marca misma sí sale** en las dos copias
—«** VENTA ANULADA **», la fecha y el motivo—: el cliente tiene que poder ver
que su venta se anuló, cuándo y por qué. Si el nombre de quien autorizó es
largo y ocupa más de un renglón, se omiten todos sus renglones.

## 4. Los encabezados de cada copia

### 4.1 El texto

| Copia | Renglones |
|---|---|
| Cliente | `COPIA DEL CLIENTE` |
| Tienda | `COPIA DE LA TIENDA`<br>`Control interno. No se entrega al cliente.` |

Por qué esta redacción y no la sugerida en el pedido («COPIA CLIENTE» /
«COPIA TIENDA — control interno»):

- **«DEL CLIENTE» / «DE LA TIENDA»** se lee como una frase y no como un
  código. Es la forma habitual en comprobantes en español.
- **El segundo renglón de la copia de la tienda le dice a quien la tiene en la
  mano qué hacer con ella**, en tono impersonal: «No se entrega al cliente».
  «Control interno» es el término que usa un auditor.
- **Sin raya (—) y sin tildes, a propósito.** La térmica imprime en CP850, y
  la raya no existe en CP850: `escpos.ts` la cambia por un guion. Sin
  caracteres fuera de ASCII, los encabezados salen igual en cualquier página de
  códigos que tenga la impresora. Es el mismo criterio de
  `MARCA_DE_VENTA_ANULADA`.
- **Sin asteriscos**, a diferencia de «** REIMPRESIÓN **» y
  «** VENTA ANULADA **». Los asteriscos marcan un ESTADO excepcional del
  recibo. El encabezado de copia es la identificación del documento, como
  «RECIBO DE VENTA», y va en el mismo estilo: mayúsculas y centrado.
- **Los dos entran en 48 columnas** (el ancho del recibo, `COLUMNAS_80MM`).
  El más largo tiene 42 caracteres.

### 4.2 Dónde va

Debajo de la leyenda de proforma y **antes** de las marcas de reimpresión y de
anulada. La cabecera del negocio y el título quedan iguales en las dos copias.
Lo que cambia empieza en el renglón que dice qué copia es. Una reimpresión de
una venta anulada se lee así:

```
                RECIBO DE VENTA
    Proforma, no válido como factura fiscal
               COPIA DEL CLIENTE
               ** REIMPRESIÓN **
              ** VENTA ANULADA **
Anulada: 18/09/2026 11:02
Autorizó: Jimmy
Motivo: el cliente devolvió el producto
------------------------------------------------
```

### 4.3 Cómo se van a ver

Una venta de 10 lb de maíz a Q6.69, con 30 % de descuento autorizado por Jimmy
(el tope del rol venta es menor) y pagada con tarjeta. Los datos del negocio
todavía no están cargados. Calculado a 48 columnas; la hora es ilustrativa.

**Copia del cliente**

```
              [Nombre del negocio]
                  [Dirección]
                Tel. [Teléfono]
                   NIT [NIT]

                RECIBO DE VENTA
    Proforma, no válido como factura fiscal
               COPIA DEL CLIENTE
------------------------------------------------
Recibo No.                                     1
Fecha                           18/09/2026 10:15
Cajero                                       Ana
------------------------------------------------
Maíz blanco
  10 lb x 4.68                             46.83
------------------------------------------------
  Precios e importes ya incluyen el descuento.
Descuento 30 %                            -20.07
TOTAL                                      46.83

Forma de pago                            Tarjeta

            ¡Gracias por su compra!
```

**Copia de la tienda**

```
              [Nombre del negocio]
                  [Dirección]
                Tel. [Teléfono]
                   NIT [NIT]

                RECIBO DE VENTA
    Proforma, no válido como factura fiscal
               COPIA DE LA TIENDA
   Control interno. No se entrega al cliente.
------------------------------------------------
Recibo No.                                     1
Fecha                           18/09/2026 10:15
Cajero                                       Ana
------------------------------------------------
Maíz blanco
  10 lb x 4.68                             46.83
------------------------------------------------
  Precios e importes ya incluyen el descuento.
Descuento 30 %                            -20.07
Autorizado por: Jimmy
TOTAL                                      46.83

Forma de pago                            Tarjeta
Boleta                                    004512

            ¡Gracias por su compra!
```

## 5. Cuándo salen las dos copias

| Momento | ¿Imprime? | Qué sale |
|---|---|---|
| Se cobra una venta (`venta:cobrar` → emitir el recibo) | Sí | Las dos copias |
| Se vuelve a emitir el recibo de una venta que ya lo tenía (un reintento, por ejemplo después de un corte de luz) | Sí | Las dos copias, las dos con «** REIMPRESIÓN **», como hoy |
| Se reimprime desde el historial de recibos | Sí | Las dos copias, las dos con «** REIMPRESIÓN **» |
| Se anula una venta (el PDF se regenera marcado, §4.59) | **No**, como hoy | Nada sale por la térmica |
| El ticket de prueba de la pantalla «Impresora de recibos» | Sí, como hoy | **Un** ticket de prueba: no es un recibo |
| No hay impresora configurada | No, como hoy | Nada; el recibo queda en PDF |

**El orden de impresión: primero la copia del cliente, después la de la
tienda.** La del cliente es la que alguien está esperando en el mostrador. La
de la tienda es la que se guarda.

## 6. Lo que NO cambia

| Qué | Por qué se menciona |
|---|---|
| **El PDF del disco** | Sigue siendo la versión completa, con el autorizante y la boleta, y sin encabezado de copia. Para los mismos datos, su HTML es idéntico byte a byte al de antes. |
| **La pantalla del historial** («Ver» y el texto que se muestra al reimprimir) | Sigue mostrando la versión completa, sin encabezado de copia, idéntica a la de antes. La ve personal con sesión, igual que el PDF. |
| **El número de recibo** | Las dos copias llevan el mismo número. No se consume otro número. |
| **La base, la nube y la auditoría** | Nada se guarda distinto y nada nuevo se sincroniza. Quién autorizó un descuento sigue en `ventas.descuento_autorizado_por` y en `auditoria_log`. |
| **Qué se muestra en la pantalla de venta** | Sin cambios de pantalla. |
| **El ticket de prueba** | Sigue siendo uno solo. |

## 7. Criterios de aceptación

Cada criterio dice cómo se comprueba. «Vitest» es la suite automatizada
(`npm run verify`). «App real» es el arnés que maneja la aplicación Electron
compilada con la impresora simulada, que escribe en un archivo los bytes que
recibiría la térmica. **Todo lo de este spec se verifica en macOS. Windows y la
3nStar RPT004 de la tienda quedan pendientes** (§9).

| # | Criterio | Cómo se comprueba |
|---|---|---|
| CA-1 | Al cobrar una venta con impresora configurada, la térmica recibe **exactamente dos copias**, primero la del cliente y después la de la tienda, **cada una con su propio corte de papel**. | Vitest (impresora que anota) y app real (bytes del archivo: dos cortes, y el encabezado de cada copia en ese orden) |
| CA-2 | La copia de la tienda es **la versión completa de la pantalla, más su encabezado de dos renglones** debajo de la leyenda de proforma. Ningún otro renglón cambia. | Vitest, renglón por renglón, sobre una grilla de 24 recibos (con y sin descuento autorizado, con y sin boleta, original y reimpresión, en pie y anulada) |
| CA-3 | La copia del cliente difiere de la de la tienda **exactamente** en esto: su encabezado es «COPIA DEL CLIENTE», no lleva el renglón «Autorizado por: …», no lleva el renglón «Boleta …» y, desde el 2026-09-18, no lleva el «Autorizó: …» de la marca de anulada (con todos sus renglones). **Ningún otro renglón cambia ni cambia de orden.** | Vitest, comparación renglón por renglón en la misma grilla, y app real con los bytes |
| CA-4 | En la copia del cliente no aparece el nombre de quien autorizó el descuento en el bloque del descuento, ni el número de boleta **en ningún renglón**. | Vitest y app real |
| CA-5 | La copia del cliente **sí** lleva el cajero, las líneas, el descuento con su valor y su rebaja, la aclaración, el TOTAL, la forma de pago, la reimpresión y la marca de anulada con su fecha y su motivo. ~~y la marca de anulada completa~~ (corregido el 2026-09-18: sin quién la autorizó, CA-19). | Vitest y app real |
| CA-6 | Una venta en efectivo sin descuento autorizado **y sin anular**: las dos copias **difieren solo en el encabezado**. | Vitest |
| CA-7 | Reimprimir desde el historial saca las dos copias, **las dos con «** REIMPRESIÓN **»**. | Vitest y app real (tocando «Reimprimir» en la pantalla) |
| CA-8 | Volver a emitir el recibo de una venta que ya lo tenía saca las dos copias, como una reimpresión. | Vitest |
| CA-9 | **El PDF no cambia:** para los mismos datos, su HTML es idéntico byte a byte al de antes del cambio. Lleva quién autorizó y la boleta, y no lleva ningún encabezado de copia. | Comparación antes/después sobre la grilla de 24 recibos (una sola vez, salida cruda en el informe), Vitest, y app real leyendo el PDF del disco |
| CA-10 | **La pantalla del historial no cambia:** el texto de «Ver» y el que se muestra al reimprimir son idénticos byte a byte a los de antes. | Comparación antes/después sobre la grilla, y app real |
| CA-11 | Anular una venta **no imprime nada**, como hoy. | Vitest (la prueba que ya existe sigue pasando) |
| CA-12 | Sin impresora configurada, no se manda nada y el mensaje al cajero es el de siempre. | Vitest |
| CA-13 | Si la impresora falla, la venta queda registrada, el PDF queda generado y el recibo no se marca como impreso, como hoy. | Vitest |
| CA-14 | El recibo se marca como impreso cuando **el trabajo con las dos copias** fue aceptado, y el mensaje al cajero nombra las dos copias. | Vitest y app real |
| CA-15 | Los encabezados entran en 48 columnas y usan solo ASCII. **Ningún renglón de ninguna copia pasa de 48 columnas.** | Vitest |
| CA-16 | La copia del cliente oculta una **lista cerrada** de tres datos (eran dos hasta el 2026-09-18). Si alguien agrega un dato al papel sin decidir nada, sale en las dos copias. Si alguien oculta otro dato en la copia del cliente, una prueba falla. | Vitest (comparación renglón por renglón de CA-3) y una prueba estructural que recorre el código |
| CA-17 | **La prueba que exigía «quién autorizó» en el papel se conserva**: ahora lo exige en la copia de la tienda, y deja escrito qué decía antes y por qué cambió. Lo mismo la del número de boleta. | Revisión del archivo de pruebas |
| CA-18 | La copia del cliente se imprime siempre con su encabezado: ningún camino de producción manda a la térmica la versión de pantalla. | Prueba estructural sobre el código de `src/main` |
| CA-19 | **(2026-09-18, decisión 1 de §9)** En la copia del cliente de una venta anulada no aparece quién autorizó la anulación, **ni un pedazo del nombre** aunque ocupe más de un renglón; la de la tienda, la pantalla y el PDF sí lo llevan. | Vitest (la grilla, renglón por renglón, y un nombre largo con su control) y app real (la reimpresión de la venta anulada) |
| CA-20 | **(2026-09-18, decisión 2 de §9)** La copia de la tienda sale en **todas** las ventas, sin condición: también en efectivo sin descuento. | Vitest (`COPIAS_QUE_SE_IMPRIMEN` es `['cliente', 'tienda']`) y app real (la venta en efectivo también manda dos copias) |

## 8. Fuera de alcance

- **Elegir cuántas copias imprime cada negocio.** Por ahora son siempre dos.
  El plan explica por qué y deja una recomendación para cuando haya otro
  cliente de Vixo POS (plan §8).
- **Reimprimir solo una de las dos copias** (por ejemplo, solo la de la tienda
  si se trabó el papel). Hoy reimprimir saca las dos.
- ~~**Ocultar el autorizante de la anulación en la copia del cliente**: es la
  pregunta 1 de §9.~~ Entró al alcance el 2026-09-18 (CA-19).
- **La prueba en la impresora física** (3nStar RPT004): sigue pendiente, como
  el punto 9 de §6.2 de CLAUDE.md.

## 9. Preguntas para Julio, y cómo se decidieron

> **Las preguntas 1 y 2 se DECIDIERON el 2026-09-18.** El texto original de
> cada una se conserva abajo; la decisión va debajo de cada pregunta.


1. **¿La copia del cliente debe ocultar también quién autorizó una ANULACIÓN?**
   Hoy sale «Autorizó: Jimmy» en las dos copias de una venta anulada
   reimpresa. Es el mismo tipo de dato que el autorizante del descuento. No se
   ocultó porque el pedido dice «específicamente» el descuento y la boleta. El
   diseño de la anulación (`docs/ANULACION-DE-VENTA.md` §5.2) dice que ese
   papel marcado se reimprime «por si el cliente quiere constancia», así que el
   cliente lo recibe.

   **DECIDIDO (Julio, 2026-09-18): SÍ se oculta**, con el mismo criterio que el
   autorizante del descuento. La marca, la fecha y el motivo siguen en las dos
   copias. Criterio CA-19.
2. **El papel se duplica.** Cada venta gasta el doble de rollo térmico. En una
   venta en efectivo sin descuento autorizado, la copia de la tienda dice lo
   mismo que la del cliente salvo el encabezado. ¿Jimmy quiere la copia de la
   tienda en todas las ventas, o solo cuando hay algo que controlar
   (descuento autorizado o tarjeta)? Este spec hace lo pedido: siempre dos.

   **DECIDIDO (Julio, 2026-09-18): la copia de la tienda sale SIEMPRE, sin
   condición, y no es configurable por ahora.** No exige cambio de código: es
   como ya estaba (`COPIAS_QUE_SE_IMPRIMEN`). Criterio CA-20. La recomendación
   para el día que otro cliente de Vixo POS pida elegirlo sigue en plan §8.
3. **La prueba física en la RPT004.** Las dos copias viajan en un solo trabajo,
   con un corte entre ellas (plan §2). Que el modelo de la tienda corte bien
   entre una copia y la otra solo se ve con el papel en la mano.

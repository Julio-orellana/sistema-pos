# 001 — Plan: cómo se construyen las dos copias

> Implementa [`spec.md`](spec.md). Escrito el 2026-09-18, antes de tocar el
> código. Las tareas están en [`tasks.md`](tasks.md).

---

## 0. Lo que se leyó antes de planear

| Archivo | Qué hace hoy | Qué importa para este cambio |
|---|---|---|
| `src/main/domain/recibo/modelo-de-recibo.ts` | Arma `ModeloDeRecibo` desde lo guardado. **No calcula nada.** | Ya trae todo lo que hace falta: `descuento.autorizadoPor` y `numBoleta`. **El modelo no cambia.** |
| `src/main/domain/recibo/plantilla-de-recibo.ts:108` | `reciboComoTexto(modelo, ancho)` dibuja el texto de la térmica y de la pantalla. | Es la función que recibe el parámetro nuevo. El renglón del autorizante está en la línea 188 y el de la boleta en la 205. |
| `plantilla-de-recibo.ts:241` | `reciboComoHtml(modelo)` dibuja el PDF. | **No se toca.** |
| `src/main/domain/recibo/servicio-de-recibos.ts:305` | `intentarImprimir` arma un `ComprobanteImprimible` con `contenidoTexto: reciboComoTexto(modelo)` y `copias: 1`. | Es el único lugar que manda un recibo a la térmica. Lo llaman `emitir`, `reimprimir` y el reintento de `emitir`. La regeneración de la anulación pasa `imprimir: false` y no llega hasta acá. |
| `src/shared/adapters/receipt-printer.ts:27` | El contrato: `contenidoTexto?: string` y `copias: number`. | `copias` solo sabe pedir N copias **del mismo texto**. Nadie en producción pide un número distinto de 1. |
| `src/main/adapters/impresora-configurada.ts:190` | `ImpresoraPorColaDeWindows` manda **un trabajo por copia**, cada uno con su propio PowerShell. | Con dos copias en llamadas separadas, cada venta haría dos trabajos (ver §2). |
| `src/main/adapters/escpos-printer.ts:75` | El proveedor viejo por ruta escribe los bytes una vez por copia. | Mismo cambio que el anterior. |
| `src/main/ipc/recibos.ts:249` y `:269` | «Ver» y «Reimprimir» devuelven `texto: reciboComoTexto(modelo)` para la pantalla. | **La pantalla no cambia** (spec §6). |
| `src/main/domain/recibo/__tests__/recibo.test.ts:300` | «quién autorizó el descuento sale EN EL PAPEL, no solo en la auditoría». | Es la prueba que el pedido manda actualizar (§5). |
| `recibo.test.ts:319` | «con tarjeta sale el número de boleta; en efectivo no aparece». | Misma situación con la boleta. |
| `src/main/ipc/__tests__/anular-desde-el-historial.test.ts:719` | «el voucher SÍ llega al rol venta: ya está impreso en el papel del cliente». | **Su justificación deja de ser cierta.** El comportamiento no cambia (§5). |
| `src/shared/types/ipc.ts:1655` | El comentario de `ReciboEnHistorialIpc.numBoleta` dice que la boleta «ya sale IMPRESO en el papel del cliente». | Deja de ser cierto. Se corrige y queda constancia (§9). |
| CLAUDE.md §4.14, §4.60 y la tabla de §5 | Afirman que el autorizante y la boleta salen en el papel del cliente. | Se corrigen sin borrar lo anterior (§9). |

**Una aclaración sobre lo que el pedido llama «la prueba estructural»**: la
prueba que exige el autorizante en el papel (`recibo.test.ts:300`) **no es
estructural** en el sentido de las otras pruebas del proyecto. No recorre el
árbol sintáctico: registra una venta real y mira el texto. Se actualiza como
pide el pedido y, además, se agrega una prueba estructural de verdad (§6.3).

## 1. La decisión central: un parámetro sobre la misma función de render

### 1.1 La firma

```ts
reciboComoTexto(modelo: ModeloDeRecibo, destino: DestinoDelTexto, ancho = COLUMNAS_80MM): string

type CopiaImpresa = 'cliente' | 'tienda';
type DestinoDelTexto = CopiaImpresa | 'pantalla';
```

Una sola función dibuja los tres textos:

| `destino` | Para qué | Qué es |
|---|---|---|
| `'pantalla'` | «Ver» y «Reimprimir» del historial | La versión completa, **idéntica a la de hoy** byte a byte |
| `'tienda'` | La segunda copia de la térmica | La de pantalla, más el encabezado de la copia de la tienda |
| `'cliente'` | La primera copia de la térmica | La de la tienda, con el encabezado del cliente y **sin los dos datos reservados** |

**El parámetro es OBLIGATORIO, sin valor por omisión.** Con un valor por
omisión, un camino nuevo que imprimiera llamando a `reciboComoTexto(modelo)`
mandaría la versión de pantalla a la térmica sin que nada fallara, y el
cliente recibiría el autorizante y la boleta. Obligatorio, el compilador hace
que cada llamada diga para qué es el texto. Hay que tocar las 13 llamadas que
tienen las pruebas, y eso es parte del beneficio: cada prueba dice qué copia
revisa.

### 1.2 Qué lleva cada destino: UNA tabla

```ts
export const QUE_LLEVA_CADA_DESTINO: Readonly<Record<DestinoDelTexto, LoQueLlevaElTexto>> = {
  pantalla: { encabezado: [],                                  autorizacionDelDescuento: true,  boleta: true  },
  tienda:   { encabezado: ENCABEZADO_DE_LA_COPIA_DE_LA_TIENDA, autorizacionDelDescuento: true,  boleta: true  },
  cliente:  { encabezado: ENCABEZADO_DE_LA_COPIA_DEL_CLIENTE,  autorizacionDelDescuento: false, boleta: false },
};
```

Es **el único lugar** que decide qué ve el cliente. La plantilla consulta la
tabla en exactamente dos renglones: el del autorizante y el de la boleta. No
compara el destino contra `'cliente'` en ningún lado. `Record<DestinoDelTexto, …>`
hace que el compilador exija una fila por destino: si algún día hay una tercera
copia, no se puede agregar sin decidir qué lleva.

### 1.3 Las alternativas que se descartaron

| Alternativa | Por qué no |
|---|---|
| **Dos plantillas**, una por copia | La prohíbe el pedido, y con razón: dos plantillas se desincronizan con el primer cambio. Es el defecto de patrón que el proyecto ya pagó con el nombre legible de las tablas (§4.57). |
| **Tachar el modelo antes de dibujar**: un `modeloParaElCliente(modelo)` que ponga `autorizadoPor` y `numBoleta` en `null`, y la misma plantilla sin cambios | Funciona, pero la diferencia entre copias queda en los datos y no en un parámetro de la plantilla, que es lo que pide el pedido. Además, un modelo tachado es indistinguible de uno sin autorización ni boleta. Si alguien lo pasara al PDF, el PDF saldría incompleto sin que nada lo detecte. Con el parámetro, el modelo sigue siendo la verdad y cada salida dice qué muestra. |
| **Un valor por omisión** (`destino = 'pantalla'`) | Ver §1.1: deja abierta la puerta de imprimir la versión completa sin darse cuenta. |
| **Pasarle el destino también a `reciboComoHtml`** | El PDF no es una copia impresa y el pedido dice que no cambia. Tocar su firma sería tocar la función que hay que dejar igual. |

### 1.4 El encabezado va en la plantilla, no en el modelo

`ModeloDeRecibo` describe **la venta**, y es el mismo para las tres salidas. Qué
copia se está dibujando no es un dato de la venta, así que no entra al modelo.
Los textos de los encabezados viven en `plantilla-de-recibo.ts` como
constantes exportadas, igual que los textos del papel que viven en el modelo.
Las pruebas los importan de ahí y no los repiten.

## 2. Cómo llegan las dos copias a la térmica: UN solo trabajo

### 2.1 El contrato cambia

```ts
// src/shared/adapters/receipt-printer.ts
export interface ComprobanteImprimible {
  readonly idComprobante: string;
  readonly tipo: TipoComprobante;
  readonly rutaPdf: string;
  /** El texto de cada copia, en el orden en que salen. Todas en un solo trabajo. */
  readonly copiasEnTexto: readonly string[];
}
```

Reemplaza a `contenidoTexto?: string` y `copias: number`.

### 2.2 Por qué un solo trabajo y no dos llamadas

| | Dos llamadas (una por copia) | **Un trabajo con las dos** |
|---|---|---|
| PowerShell por venta | **Dos**. Cada uno arranca PowerShell, compila el `Add-Type` y espera 1,5 s para leer el trabajo (`cola-de-windows.ts:185`). | **Uno, como hoy** |
| Espera del cajero después de COBRAR | Hasta el doble. `venta:cobrar` espera la impresión (`ipc/venta.ts:348`), y cada llamada tiene un límite de 12 s (`LIMITE_DE_POWERSHELL_MS`). | La misma de hoy |
| Qué se sabe si algo falla a la mitad | Casi nada más: una térmica ESC/POS no contesta, y Windows solo informa si aceptó el trabajo (§4.43). | Lo mismo: aceptado o no |
| Cómo lo ve la cola de Windows | Dos trabajos que pueden quedar separados por otro | Un trabajo; nada se mete entre las dos copias |

El costo de PowerShell no está medido en el i3 de la tienda (§4.43 lo dice),
pero **es el mismo trabajo que hoy**. Con dos llamadas se duplicaría un costo que
nadie midió.

### 2.3 Los bytes

```ts
// src/main/domain/recibo/escpos.ts
export function copiasComoEscPos(textos: readonly string[]): Uint8Array
```

Devuelve `reciboComoEscPos(texto1)` seguido de `reciboComoEscPos(texto2)`.
**Cada copia es un recibo ESC/POS entero**: inicializar (`ESC @`), página de
códigos, texto, avance y corte parcial. Así se puede afirmar byte a byte que
cada copia es exactamente lo que hoy sale como único papel, con su encabezado
agregado.

> **RIESGO, dicho en voz alta: el `ESC @` de la segunda copia llega cuando la
> impresora todavía procesa el corte de la primera.** Según la especificación
> de Epson, `ESC @` borra el buffer de impresión (el renglón que se está
> armando) pero **no el buffer de recepción**. Los comandos se procesan en
> orden. Para cuando llega, el texto de la primera copia ya se imprimió, porque
> cada renglón termina en salto de línea y el corte va después. **Esto es
> documentación, no medición.** Se confirma con la RPT004 en la mano (spec §9,
> pregunta 3). Si la impresora hiciera algo raro, la salida es quitar el
> `ESC @` de la segunda copia. Es un cambio de una línea en
> `copiasComoEscPos`.

### 2.4 Los adaptadores

Los dos proveedores reales hacen lo mismo:

1. Si no llegó ninguna copia, o alguna está vacía, devuelven un fallo: «El
   comprobante llegó sin texto para imprimir.» Es la misma regla de hoy.
2. `copiasComoEscPos(comprobante.copiasEnTexto)`.
3. **Un envío**: `ImpresoraPorColaDeWindows` hace un `enviar`, y
   `EscPosPrinterProvider` hace un `writeFileSync`.
4. La bitácora técnica dice cuántas copias iban en el trabajo.

`NullPrinterProvider` no lee el texto y no cambia.

### 2.5 El orden: cliente primero

`COPIAS_QUE_SE_IMPRIMEN = ['cliente', 'tienda']`. La del cliente es la que
alguien espera en el mostrador. Con el corte parcial, la primera copia queda
colgando por fuera y se arranca primero para entregarla. La de la tienda queda
pegada al rollo y se guarda.

## 3. El servicio de recibos

```ts
// intentarImprimir
const comprobante: ComprobanteImprimible = {
  idComprobante: recibo.id,
  tipo: 'recibo',
  rutaPdf,
  copiasEnTexto: textosDeLasCopias(modelo),   // [cliente, tienda]
};
```

`textosDeLasCopias(modelo)` vive en la plantilla y es la ÚNICA forma de armar lo
que va a la térmica. Recorre `COPIAS_QUE_SE_IMPRIMEN`.

| Qué | Antes | Después |
|---|---|---|
| Qué se manda | Un texto, `copias: 1` | Dos textos, en un trabajo |
| Mensaje si salió bien | Lo que diga el adaptador: «Recibo enviado a la impresora.» | «Recibo enviado a la impresora: copia del cliente y copia de la tienda.» Se arma desde `COPIAS_QUE_SE_IMPRIMEN`, así que si la lista cambia, el mensaje cambia con ella |
| `recibos.impreso` | `true` si el trabajo fue aceptado | Igual: `true` si **el trabajo con las dos copias** fue aceptado |
| Sin impresora o con fallo | Mensajes de siempre | **Sin cambios** |
| El PDF | `reciboComoHtml(modelo)` | **Sin cambios** |

El mensaje dice «enviado» y no «impreso»: Windows solo informa que aceptó el
trabajo (§4.43). Se ve en el aviso del historial al reimprimir. La pantalla de
venta sigue diciendo «Se imprimió.» cuando sale bien: esa pantalla no se toca
(spec §6).

## 4. La pantalla y el PDF no cambian, y se va a demostrar

- `ipc/recibos.ts` pasa `'pantalla'` en «Ver» y en «Reimprimir».
- `reciboComoHtml` no se toca.

**Cómo se demuestra.** Antes de tocar el código se tomó una «foto»: la grilla de
24 modelos armados a mano (con y sin descuento, con descuento sin autorizante y
con autorizante, efectivo y tarjeta, original y reimpresión, en pie y anulada),
dibujada con el código de `75c270c` en texto y en HTML. El resultado quedó en
un archivo de la sesión (no del repositorio), con sha256 `62e0382d…`. Después del cambio se
dibuja la misma grilla con `'pantalla'` y con `reciboComoHtml`, y las 48 salidas
tienen que ser **idénticas byte a byte**. La comparación es de una sola vez y
va en el informe con su salida cruda. No queda como prueba permanente, porque
los 24 recibos fijados en una prueba harían fallar cualquier cambio legítimo
futuro del papel. Lo permanente son las propiedades de §6.

## 5. Las pruebas que cambian, y cómo queda constancia

Ninguna se borra. Cada una conserva su bloque con un comentario que dice qué
decía antes, desde cuándo cambió y por qué.

| Prueba | Antes | Después |
|---|---|---|
| `recibo.test.ts:300` | «quién autorizó el descuento sale EN EL PAPEL, no solo en la auditoría». Exigía «Autorizado por: Jimmy» en `reciboComoTexto(modelo)`, el único papel | Exige el autorizante en la **copia de la tienda** (y en la pantalla y el PDF). Una prueba nueva al lado exige que **no** esté en la del cliente. El comentario cuenta que antes el único papel se lo llevaba el cliente, y por qué ahora no |
| `recibo.test.ts:319` | «con tarjeta sale el número de boleta; en efectivo no aparece» | Lo mismo con la boleta: en la copia de la tienda sí, en la del cliente no, y en efectivo en ninguna |
| `anular-desde-el-historial.test.ts:719` | «el voucher SÍ llega al rol venta: ya está impreso en el papel del cliente» | **El comportamiento no cambia** (el voucher sigue llegando a cualquiera con sesión). Cambia el porqué: lo tecleó quien cobró, y sale en la copia de la tienda. El nombre y el comentario lo dicen |
| Las demás llamadas a `reciboComoTexto(modelo)` en `recibo.test.ts` | Sin destino | Cada una con su destino. Las que hablan del «papel» (leyenda, marcadores, reimpresión, que las líneas suman el total) se comprueban en **las dos copias** |
| `adapters.test.ts` y `servicio-de-impresora.test.ts` | `contenidoTexto` y `copias: 1` | `copiasEnTexto` |

## 6. Las pruebas nuevas

### 6.1 La plantilla (funciones puras)

En `copias-del-recibo.test.ts`, sobre la **misma grilla de 24 recibos** de §4:

- La de la tienda es la de pantalla con su encabezado insertado debajo de la
  leyenda, y nada más (renglón por renglón).
- La del cliente difiere de la de la tienda **exactamente** en: el encabezado,
  el renglón del autorizante (si lo hay) y el de la boleta (si la hay). Se
  calcula la diferencia y se exige que sea esa. Así, ocultar cualquier otro
  dato hace fallar la prueba.
- Ni el nombre del autorizante del descuento ni el número de boleta aparecen
  en ningún renglón de la copia del cliente fuera de lo permitido. El nombre
  del autorizante sí puede aparecer en la marca de anulada: es la pregunta 1
  del spec, y la prueba lo deja escrito.
- Ningún renglón de ningún destino pasa de 48 columnas.
- Los encabezados son ASCII, entran en 48 columnas y son distintos.
- `textosDeLasCopias(modelo)` es `[cliente, tienda]`.
- **Las dos copias literales** del ejemplo del spec (§4.3), renglón por
  renglón. Si el papel cambia, esta prueba lo muestra con un diff.

### 6.2 El servicio, con una impresora que anota

En `recibo.test.ts`, con la base real y el servicio de venta real:

- Cobrar: la impresora recibe **un** comprobante con **dos** textos, en orden
  cliente → tienda, iguales a `textosDeLasCopias(modelo)`.
- Reimprimir: dos copias, las dos con REIMPRESIÓN.
- Reintento de emitir: dos copias, como reimpresión.
- Regenerar el PDF por una anulación: la impresora no recibe nada.
- El PDF es `reciboComoHtml(modelo)`: lleva el autorizante y la boleta, y no
  lleva ningún encabezado de copia.
- `impreso` y el mensaje que nombra las dos copias.

### 6.3 La estructural

En `copias-del-recibo-estructural.test.ts`, que recorre el árbol sintáctico de
`src/main` sin las pruebas:

- Toda llamada de producción a `reciboComoTexto` pasa el destino como un
  literal. La única excepción es `textosDeLasCopias`, que recorre la lista de
  copias.
- **El literal `'pantalla'` solo aparece en `ipc/recibos.ts`**: la versión
  completa nunca se arma para la térmica.
- **`copiasEnTexto` solo recibe `textosDeLasCopias(...)`**: no hay otro camino
  para decidir qué va al papel.
- Controles del detector: le da casos armados con el defecto y exige que los
  encuentre.

### 6.4 ESC/POS y adaptadores

- `copiasComoEscPos([a, b])` es `reciboComoEscPos(a)` seguido de
  `reciboComoEscPos(b)`: dos `ESC @`, dos cortes, en orden.
- `ImpresoraSegunElArchivo` con la impresora simulada: **un** envío por recibo,
  con las dos copias adentro.
- El proveedor viejo por ruta: una escritura con las dos copias.
- Sin copias o con una vacía: fallo con el mensaje de siempre.

### 6.5 Falsificación

Cada red se prueba rompiéndola a propósito, una mutación por vez, restaurando
el archivo y comparando su sha256:

1. La plantilla deja pasar el autorizante en la copia del cliente.
2. La plantilla oculta además el cajero en la copia del cliente: tiene que
   caer la comparación renglón por renglón.
3. El servicio manda la versión de pantalla a la térmica.
4. El servicio manda las copias en orden inverso.
5. Los adaptadores vuelven a un envío por copia.
6. Se manda `'pantalla'` desde otro archivo de producción: tiene que caer la
   estructural.

## 7. Verificación en la aplicación real

Un arnés nuevo, `scripts/verificacion-de-copias-del-recibo.cjs`
(`npm run verify:pantallas:copias`). Sigue el patrón de los demás: maneja la
aplicación compilada con `playwright-core` y la impresora simulada (que escribe
los bytes en un archivo). Deja capturas y lee la base y el PDF del disco. Fija
la ventana a **1024×768** con CDP antes de cada captura, como
`verify:pantallas:1024`.

1. Jimmy crea el primer usuario, fija el tope del rol venta, crea a Ana y el
   catálogo, y elige la impresora simulada **desde el canal real** de la
   pantalla «Impresora de recibos».
2. Ana abre la caja y cobra con tarjeta, con boleta y con un descuento que pasa
   el tope, autorizado con el PIN de Jimmy. Es la venta del ejemplo del spec.
3. Se leen los bytes del archivo de la impresora simulada. Se parten por el
   comando de corte, se decodifican de CP850 y **se imprime en el informe el
   texto completo de las dos copias**, tal cual salió.
4. Comprobaciones: dos copias, en orden. La del cliente sin autorizante ni
   boleta. La de la tienda con los dos. La de la tienda coincide con el texto
   que muestra «Ver» más su encabezado, lo que de paso verifica el decodificador
   CP850 del arnés. El PDF del disco lleva el autorizante y la boleta, y no
   lleva encabezado de copia.
5. Se reimprime **tocando «Reimprimir»** en el historial: dos copias con
   REIMPRESIÓN, y el aviso de la pantalla nombra las dos.
6. Una venta en efectivo sin descuento: las dos copias difieren solo en el
   encabezado.
7. Se anula la venta con tarjeta y se reimprime: el informe muestra cómo sale
   la copia del cliente de una venta anulada (pregunta 1 del spec).

## 8. ¿Siempre dos copias, o configurable? Recomendación

**Recomiendo: hoy, siempre dos y fijas en el código, en una sola constante
(`COPIAS_QUE_SE_IMPRIMEN`). Configurable recién cuando haya un segundo cliente
de Vixo POS que lo pida.** No se construye configuración ahora.

Por qué no ahora:

- **No hay a quién configurárselo.** Jimmy pidió dos. Una opción sin segundo
  cliente es una decisión inventada: qué opciones ofrecer, con qué valor por
  omisión y quién la cambia. El proyecto no inventa definiciones de negocio.
- **Dónde tendría que vivir cuesta una migración en las dos nubes.** Cuántas
  copias imprime un negocio es **política de control interno del negocio**, no
  estado de una máquina. Por eso le corresponde `configuracion_negocio`, que se
  sincroniza, y no `impresora.json`, que es de la terminal. Eso es una migración
  local, su espejo en Postgres (que exige aprobación explícita en los dos
  proyectos) y un campo en la pantalla «Datos del negocio». Se hace el día que
  se necesite, no antes.
- **Pasar a configurable no rompe nada de lo que se construye hoy.** El día
  que haga falta, la lista `COPIAS_QUE_SE_IMPRIMEN` pasa a leerse de la
  configuración en vez de ser una constante. La plantilla, la tabla de destinos,
  el contrato con la impresora y las pruebas ya funcionan con cualquier lista de
  copias.

Cuando se haga, las opciones razonables son tres:

| Opción | Para qué negocio |
|---|---|
| Solo la del cliente | Un negocio chico que no quiere gastar papel en control |
| Cliente y tienda, **siempre** | Lo de Jimmy hoy |
| Cliente siempre, y la de la tienda **solo cuando hay algo que controlar** (descuento autorizado o tarjeta) | El punto medio: ahorra la mitad del papel en las ventas en efectivo sin descuento, donde las dos copias dicen lo mismo |

La tercera es una pregunta para Jimmy (spec §9, pregunta 2), no una decisión
técnica.

## 9. Documentación que se corrige, con constancia

Nada se borra. Lo que dejó de ser cierto se tacha o se anota «CORREGIDO EL
2026-09-18» al lado, con el motivo.

| Dónde | Qué decía | Qué va a decir |
|---|---|---|
| CLAUDE.md §4.14, «Quién autorizó el descuento va EN EL PAPEL» | Que va en el papel porque es la única copia que se lleva el cliente | Se conserva y se agrega la corrección: desde la spec 001 va en la copia de la tienda (y en el PDF y la pantalla), no en la del cliente |
| CLAUDE.md §4.60 (tabla «Dos desviaciones») y la fila de §5 sobre los totales del historial | «el voucher ya sale impreso en el papel del cliente» | Anotado: ya no. La decisión (el voucher llega a cualquiera con sesión) se sostiene por otra razón: lo tecleó quien cobró y está en la copia de la tienda |
| `docs/ANULACION-DE-VENTA.md:576` | La misma frase | La misma anotación |
| `src/shared/types/ipc.ts`, comentario de `numBoleta` | «ya sale IMPRESO en el papel del cliente» | La razón nueva, con la vieja citada |
| `src/main/ipc/recibos.ts` (cabecera) y `PantallaDeRecibos.tsx` (dos comentarios) | «el recibo no revela nada que el cliente no haya visto» y «lo que se ve en pantalla es lo que sale del rollo» | Lo que es verdad ahora: la pantalla muestra la versión completa, que es la de la tienda sin su encabezado |
| `recibo.test.ts` (cabecera) | «Es el único papel que se lleva el cliente» | Una de las dos copias |
| `receipt-printer.ts` y `docs/INTEGRACIONES.md` | El contrato con `copias: number` | El contrato nuevo |
| `docs/GUIA-IMPRESORA.md` | No dice qué sale en cada venta | Una sección nueva: salen dos copias, cuál se entrega y cuál se guarda |
| CLAUDE.md | — | §4.63 nueva, una fila en §5, los puntos abiertos en §6.2, el comando nuevo en §8, `spec/` en el mapa de §9 y una línea sobre el proceso en §10 |

## 10. Riesgos

| Riesgo | Qué lo cubre |
|---|---|
| El papel se gasta el doble | Dicho en el spec (pregunta 2) y en la guía de la impresora. Es consecuencia directa de lo pedido. |
| El cajero entrega la copia equivocada | El encabezado de cada copia, y el segundo renglón de la de la tienda: «No se entrega al cliente». El orden ayuda: la del cliente sale primero. |
| La RPT004 no corta bien entre las dos copias, o el segundo `ESC @` hace algo inesperado | No se puede medir sin el aparato (§2.3). Queda como pendiente físico en el punto 9 de §6.2, con la salida de una línea escrita. |
| Un camino futuro manda a la térmica la versión completa | El parámetro obligatorio (§1.1) y la prueba estructural (§6.3). |
| Alguien oculta otro dato en la copia del cliente sin decidirlo | La comparación renglón por renglón (§6.1): la diferencia entre copias tiene que ser exactamente la lista cerrada. |
| El cliente sigue viendo quién autorizó una anulación | No es un riesgo técnico, es una decisión pendiente (spec §9, pregunta 1). |
| Documentación que afirma algo que dejó de ser cierto | La lista de §9, recorrida con `grep` antes de cerrar. |

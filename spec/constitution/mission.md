# Misión

> Parte de la **constitución** del proyecto (`spec/constitution/`): el contexto
> estable que toda funcionalidad nueva da por sabido. Si algo de acá contradice
> el código o `CLAUDE.md`, uno de los dos está mal y se resuelve antes de seguir.
> Última revisión: 2026-09-18, versión 1.2.0.

## 1. Qué es

Un **sistema de punto de venta (POS) de escritorio** para una tienda de
productos agrícolas en Guatemala. La tienda vende **a granel** —maíz, azúcar,
frijol, por peso, descontando de sacos abiertos— y **por unidad**.

- **Cliente:** Jimmy Cano, dueño de la tienda.
- **Desarrollador responsable:** Julio Orellana.
- **Moneda:** quetzal (GTQ, `Q`), dos decimales.
- **Uso:** una sola computadora en el mostrador, con Windows, en pantalla
  completa y táctil. El cajero no puede salirse de la aplicación, pero el
  sistema operativo conserva siempre sus salidas de emergencia.

## 2. Para quién

| Quién | Qué necesita del sistema |
|---|---|
| **El cajero** (rol «venta») | Armar un ticket rápido con el dedo, cobrar en efectivo o con tarjeta, abrir y cerrar su caja, y reimprimir un recibo sin pedir ayuda. |
| **El dueño o un administrador** (rol «administrativo») | Cargar el catálogo y el inventario, gestionar usuarios y topes de descuento, autorizar excepciones con su PIN —en persona o a distancia—, leer reportes y revisar el historial de cajas. |
| **Quien audita** | Que cada hecho sensible quede registrado, con quién lo hizo y quién lo autorizó, en un registro que nadie puede editar. |

## 3. Propuesta de valor

Lo que el sistema ofrece hoy, y lo que lo distingue de una caja registradora
genérica:

1. **Funciona sin internet.** Toda la operación ocurre en la computadora de la
   tienda. La nube es un respaldo que se pone al día cuando hay conexión; su
   ausencia nunca impide vender.
2. **El dinero cuadra al centavo.** Ningún cálculo de dinero, peso o cantidad
   usa punto flotante, y el recibo impreso siempre suma exactamente el total
   cobrado.
3. **Los controles de caja no se pueden esquivar en silencio.** Una diferencia
   al cerrar exige autorización; un conteo con diferencia queda sellado y
   corregirlo después también exige autorización; quien cuenta el cajón no ve
   el monto que el sistema espera.
4. **Toda excepción tiene responsable.** Descuentos sobre el tope, cierres
   descuadrados, cierres de una caja ajena, anulaciones y la propia salida de la
   aplicación pasan por el PIN de un administrador, y cada autorización queda en
   una bitácora inmutable que además viaja a la nube.
5. **Si la computadora se pierde, el negocio no se pierde.** La tienda se puede
   reconstruir en una máquina nueva desde el respaldo en la nube, con una
   verificación de conteos y montos antes de darla por buena.
6. **Siempre hay comprobante.** El recibo se genera en PDF haya o no impresora;
   la impresión térmica es una capa opcional encima.

## 4. Un producto, no solo un encargo

El sistema se construye para Jimmy bajo una **licencia de uso permanente, no
exclusiva y no transferible** (`build/licencia.txt`). El software base es
propiedad del desarrollador, que se reserva el derecho de reutilizarlo,
adaptarlo y comercializarlo con otros clientes. Se distribuye bajo la marca
comercial **Vixo POS**; «POS Jimmy Cano» es el nombre de esta implementación.

La consecuencia de diseño es una regla, no una intención
(`docs/NEGOCIO_VS_NUCLEO.md`):

> **Nada específico de Jimmy vive en el núcleo del código.** Lo suyo —nombre y
> NIT del negocio, catálogo, precios, usuarios, topes de descuento, impresora,
> proyecto de nube— es configuración o datos. Atender a un segundo cliente
> parecido no debería exigir cambiar código; si lo exige, es un defecto.

Hoy esa regla está cumplida solo en parte: la moneda, el idioma español y el
huso horario de Guatemala son constantes del código, a propósito, mientras
todos los clientes previstos sean guatemaltecos.

> La propuesta comercial original (`Propuesta_POS_Cotizacion_Final.docx`) **no
> está en el repositorio**. Esta misión se reconstruyó a partir de `CLAUDE.md`,
> `docs/` y la licencia del instalador.

## 5. Lo que el sistema NO es hoy

Para no atribuirle capacidades que no tiene:

- **No emite factura fiscal.** El recibo es una proforma y lo dice en el papel.
- **No es multi-caja ni multi-sucursal.** Admite una sola caja abierta y está
  diseñado para una terminal por proyecto de nube.
- ~~**No distingue precio al detalle de precio al por mayor**, aunque la tienda
  venda de las dos formas.~~
  **Corregido el 2026-09-18:** desde la spec 002 (en `develop`, todavía no en el
  1.2.0 instalado) distingue el precio al por mayor **según la cantidad** de la
  línea. **No** distingue por tipo de cliente: no hay módulo de clientes.
- **No maneja ventas al crédito, mermas ni ajustes de inventario a la baja,
  alertas de stock mínimo, código de barras ni básculas digitales.**
- **No está verificado en Windows**, que es su plataforma de producción. Todo
  lo medido hasta hoy se midió en macOS.

El detalle de qué está construido y qué falta vive en
[roadmap.md](./roadmap.md); las decisiones técnicas, en
[tech-stack.md](./tech-stack.md).

## 6. Cómo se trabaja en este proyecto

Julio no es desarrollador de software: es auditor financiero y verifica
comparando **resultado esperado contra resultado real**. Por eso:

- Las **pruebas automatizadas** y la **documentación** son el mecanismo de
  confianza del proyecto, no un extra. Los nombres de las pruebas se leen en
  español como una lista de verificación.
- Lo que no se puede probar automáticamente lleva un procedimiento manual
  escrito, y toda medición se reporta con su salida cruda.
- **Toda funcionalidad nueva nace en Spec-Driven Development**: primero
  `spec/features/NNN-<slug>/spec.md` con criterios de aceptación comparables,
  después `plan.md`, después `tasks.md`, y recién entonces el código.

# Guía para la tienda: instalar la impresora térmica

Esta guía es para la **puesta en marcha en la computadora de la tienda**. No es
parte de la aplicación. La aplicación solo sabe usar una impresora que Windows
ya tenga instalada.

> **Nada de esta guía se probó todavía en la computadora de la tienda ni con la
> impresora de Jimmy.** Es el procedimiento estándar de Windows. Si algún paso
> no coincide con lo que se ve en la pantalla, anotalo tal cual se ve.

## Antes de empezar

- La impresora conectada por USB y encendida, con papel.
- Una sesión de Windows con permiso de administrador (instalar una impresora lo
  pide).
- El PIN de un administrador del punto de venta.

## 1. Ver si Windows ya la instaló solo

1. Abrí **Configuración → Bluetooth y dispositivos → Impresoras y escáneres**.
2. Si la impresora aparece en la lista, anotá **el nombre exacto** y seguí en
   el paso 3.
3. Si no aparece, seguí en el paso 2.

## 2. Instalarla a mano con «Generic / Text Only»

Hacé esto si el fabricante no trae un controlador para Windows, o si la
impresora no aparece sola.

1. En **Impresoras y escáneres**, tocá **Agregar dispositivo** y después
   **Agregar manualmente** («La impresora que deseo no está en la lista»).
2. Elegí **Agregar una impresora local o de red con configuración manual**.
3. En **Usar un puerto existente**, elegí el puerto USB (suele llamarse
   `USB001 (Puerto de impresora virtual para USB)`). Si hay varios, desconectá y
   volvé a conectar la impresora para ver cuál aparece.
4. En **Fabricante** elegí **Generic** y en **Impresoras** elegí
   **Generic / Text Only**.
5. Ponele un nombre corto y sin símbolos raros, por ejemplo `Termica`.
6. **No la compartas** y **no la pongas como predeterminada**: el punto de venta
   la usa por su nombre.
7. Si Windows ofrece imprimir una página de prueba, **salteala**. Esa página no
   usa los comandos del punto de venta y no dice nada útil.

> **Por qué «Generic / Text Only» y no el puerto directo.** El punto de venta le
> manda a la impresora los bytes tal cual (modo RAW) a través de la cola de
> Windows. Para eso la impresora tiene que existir en la lista de Windows, y
> «Generic / Text Only» es el controlador que no toca los bytes. Escribir
> directo en `USB001` no funciona: es un puerto de la cola, no un archivo.

## 3. Elegirla en el punto de venta

1. Iniciá sesión con un administrador.
2. En el menú tocá **Impresora de recibos**.
3. En **Impresoras instaladas en esta computadora**, tocá la impresora del paso 1
   o del paso 2.
4. Tocá **Imprimir recibo de prueba**.
5. Mirá el papel y contestá en la pantalla lo que salió:
   - **Sí, salió bien**: el texto se lee, las letras con tilde y la ñ salen
     bien, y el papel sale cortado.
   - **Salió con símbolos raros o sin cortar**: la impresora recibe, pero no
     entiende todos los comandos. **Anotá el modelo y avisale a Julio**, y si
     podés sacale una foto al ticket.
   - **No salió nada**: revisá encendido, papel y cable, y probá otra vez.
6. Si salió bien, tocá **Usar esta impresora**. El estado tiene que decir
   «Impresora configurada: [nombre]».

## Qué sale en cada venta: dos copias

Cada vez que se cobra, y cada vez que se reimprime un recibo desde el
historial, salen **dos papeles**, uno detrás del otro y cada uno cortado:

1. **Primero la copia del cliente.** Arriba, debajo de «Proforma, no válido
   como factura fiscal», dice **COPIA DEL CLIENTE**. Es la que se le entrega.
   No dice quién autorizó un descuento ni el número de boleta de la tarjeta:
   son datos de control interno.
2. **Después la copia de la tienda.** Dice **COPIA DE LA TIENDA** y, debajo,
   «Control interno. No se entrega al cliente.». Se guarda. Esta sí dice quién
   autorizó el descuento y el número de boleta, para cuadrar contra la terminal
   del banco.

Consecuencias prácticas:

- **El rollo se gasta el doble** que con un solo papel. Conviene tener rollos
  de repuesto a mano.
- Si al cobrar la impresora imprime **una sola** copia, o corta en un lugar
  raro entre las dos, **anotá el modelo y avisale a Julio**, con una foto del
  papel si podés. Las dos copias viajan juntas en un solo envío, y cómo corta
  la impresora de la tienda entre una y otra todavía no se probó.

## Si la pantalla muestra un error

| Lo que dice | Qué revisar |
|---|---|
| No se encontró la impresora | El nombre cambió o la impresora se desinstaló. Tocá **Volver a buscar**. |
| No se pudo conectar con la impresora | Encendido, cable USB, que no esté «En pausa» en Windows. |
| La impresora recibió el ticket pero reporta un problema | Papel, tapa abierta, o la impresora figura «Sin conexión» en Windows. |
| Esta computadora no pudo ejecutar el envío | Es un problema de la computadora, no de la impresora. Copiá el **Detalle técnico** y avisale a Julio. Si dice «modo restringido», hay una política de Windows que lo impide. |

## Volver a solo PDF

En **Impresora de recibos**, tocá **Quitar la impresora**. Los recibos se siguen
generando en PDF, como siempre. No se borra ningún recibo.

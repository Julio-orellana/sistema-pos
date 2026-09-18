# Hoja de ruta

> Parte de la **constitución** del proyecto (`spec/constitution/`). Resume qué
> está construido y qué queda por hacer. **No es un changelog**: el detalle de
> cada funcionalidad construida sigue en `CLAUDE.md` §4 y en `docs/`, hasta que
> se retome y se migre a su propio `spec/features/NNN-<slug>/`.
> Estado al 2026-09-18, versión 1.2.0.

## 1. Dónde está hoy

- **Versión 1.2.0**, empaquetada como instalador de Windows y marcada como la
  versión de entrega a Jimmy. **El build de producción (1.2.0) está instalado
  en el equipo real de la tienda, sin conectar a ningún proyecto de nube
  todavía**: se está probando el hardware antes del reseteo de la carpeta de
  datos y del primer arranque real con Jimmy.
- **El proyecto de nube real (`pos-jimmy-cano`)** tiene aplicado el esquema
  completo —las mismas migraciones que el descartable— y cero filas de negocio.
  **Desde el 2026-09-18 el repositorio tiene una migración de nube más, la
  `0039` del precio mayorista, escrita y sin aplicar en ninguno de los dos**
  (leído del catálogo ese día: 29 migraciones en cada uno, la última la
  `0038`). Una versión con la `039` local no sincroniza contra ellos hasta que
  se aplique (CLAUDE.md §4.66).
- **En `develop`, sin publicar todavía:** el precio mayorista por cantidad
  mínima (spec 002). El 1.2.0 instalado en la tienda no lo tiene.
- **La verificación en el hardware real de la tienda está en curso**, no
  terminada: ya se confirmaron y corrigieron ahí varios problemas (ver §3.1
  para lo que sigue pendiente). El resto de lo medido en este documento sigue
  siendo de macOS salvo que se diga lo contrario.

## 2. Construido

Resumen por área. Cada renglón remite a la sección de `CLAUDE.md` que lo
cuenta con su evidencia.

| Área | Qué hace hoy | Dónde |
|---|---|---|
| **Aplicación y kiosko** | Pantalla completa táctil, salida controlada con PIN por tres vías, instancia única, teclado en pantalla en todo campo de texto, pantalla verificada a 1024×768 | §4.1, §4.5, §4.46, §4.62 |
| **Usuarios y seguridad** | Primer administrador, alta y gestión de usuarios con dos roles, PIN con scrypt, bloqueo por intentos, candados separados por superficie, PIN único entre usuarios activos | §4.7, §4.8 |
| **Autorización a distancia** | Código TOTP de seis dígitos de una app de autenticación, para diferencias de caja, descuentos y la salida | §4.47, §4.41 |
| **Caja** | Una caja en todo el sistema, conteo simple o por denominaciones, cierre descuadrado con autorización, cierre de caja ajena con PIN, **conteos sellados** que impiden probar números hasta cuadrar, teórico oculto a quien cuenta, confirmación del cierre | §4.9, §4.10, §4.39, §4.40 |
| **Historial de cajas** | Todas las sesiones, con quién abrió y cerró, diferencias y recuentos autorizados, filtros y desglose | §4.44 |
| **Catálogo e inventario** | Categorías (ordenadas solas por ventas), productos por peso o por unidad, fotos reducidas, ajuste de inventario que solo suma, precio de compra | §4.11, §4.63, §4.39 |
| **Venta** | Ticket táctil, precio especial vigente, descuento con tope por rol y autorización, efectivo o tarjeta con boleta, registro atómico, costo congelado por línea | §4.12, §4.13, §4.40 |
| **Anulación de venta** | Desde el historial de recibos, solo con la caja abierta, con PIN presencial de administrador y voucher si fue con tarjeta; repone inventario y marca el recibo | §4.45, §4.58, §4.59 |
| **Recibos** | Datos del negocio, PDF siempre, impresión térmica ESC/POS por la cola de Windows con pantalla para elegir y probar la impresora, historial, reimpresión, filtro por método de pago con voucher y estado | §4.14, §4.43, §4.60 |
| **Recibo en dos copias** | Cada venta y cada reimpresión sacan por la térmica, en un solo trabajo, la copia del cliente y la de la tienda. La del cliente no lleva quién autorizó un descuento, el número de boleta ni quién autorizó una anulación; la de la tienda lleva todo; el PDF y la pantalla siguen siendo la versión completa. Siempre dos, no configurable por ahora. Spec `spec/features/001-recibo-copia-tienda-cliente/` | §4.65 |
| **Precio mayorista por cantidad** *(en `develop`, sin publicar)* | Un producto puede tener un precio mayorista desde una cantidad mínima. La línea se cobra al MENOR de lista, precio especial vigente y mayorista si la cantidad de esa línea llega al umbral; el precio de lista participa siempre, como piso. Se recalcula en vivo al cambiar la cantidad y se congela en `precio_unitario_snap`. La base no deja guardar un mayorista que no sea menor que la lista. **El espejo `0039` no está aplicado en ninguna nube.** Spec `spec/features/002-precio-mayorista/` | §4.66 |
| **Reportes** | Resumen de ventas, ventas por producto con margen, inventario; en hora de Guatemala y sin sumar en SQL | §4.15, §4.39 |
| **Topes de descuento** | Configurables desde la aplicación, con auditoría | §4.16 |
| **Auditoría** | Bitácora inmutable de todo hecho sensible, que también se respalda | §4.26 |
| **Sincronización con la nube** | Bandeja de salida, trabajador, funciones de escritura endurecidas, credencial cifrada, detección de conexión, fotos, visibilidad en la barra de estado y pantalla propia, poda de la cola y aviso de reloj desfasado. **Módulo terminado** | §4.17–§4.36, §4.51, §4.52 |
| **Restauración** | Reconstruir la tienda en una máquina nueva desde la nube, retomable, con verificación y revisión de lo escrito después de un robo | §4.35 |
| **Empaquetado** | Instalador NSIS con licencia, marca Vixo POS, nube incrustada al compilar y revisión automática de que no viaje nada indebido | §4.37, §4.38, §4.48, §4.49 |

## 3. Pendiente

### 3.1 Verificación que falta hacer, no construir

| Qué | Por qué importa |
|---|---|
| **Todo en Windows**: atajos con teclado latinoamericano, kiosko, cifrado con DPAPI, reducción de fotos, teclado en pantalla con el dedo | Es la plataforma de producción; lo de macOS no cuenta como verificado |
| **Rendimiento en el i3 de la tienda** | Ningún número de rendimiento se midió en esa máquina |
| **Impresión física en la 3nStar RPT004** | El ancho de 48 columnas coincide con su ficha; falta el ticket real |
| **Por qué no abrió la aplicación con la red de la tienda** | La causa no está medida; hace falta la bitácora técnica de esa máquina |
| **Cómo llega el dedo y cómo se porta la tarjeta gráfica** en el equipo real | Decide cuál de los arreglos de desplazamiento trabaja allá |
| **Batería destructiva de la anulación** contra el proyecto descartable | Escrita, no corrida |

### 3.2 Definiciones de negocio que faltan

| Qué | Estado |
|---|---|
| El **catálogo real** de Jimmy | Mientras no llegue, hay un catálogo de ejemplo que se quita con un comando |
| Los **topes de descuento reales** por rol | Los actuales son de prueba |
| Qué **unidades** usa y con qué conversiones (libra, arroba, quintal) | Abierto |
| Qué **roles** existen de verdad, y quién tiene el administrativo | Abierto; condiciona el tope del rol administrativo |
| Umbral de **stock bajo** por producto | Abierto; bloquea las alertas |
| Cómo se activa el **precio de mayoreo** | ~~Abierto~~ **Por cantidad comprada: construido** (spec 002, CLAUDE.md §4.66). **Por tipo de cliente sigue abierto**: no hay módulo de clientes. Queda por decidir si bajar la lista por debajo de un mayorista se rechaza o se acepta (decisión 1 de la spec) |
| Si hay **ventas al crédito** | Abierto |
| Cada cuánto y adónde se hace un **respaldo local** de la base | Abierto; es la respuesta para restaurar una terminal que ya tiene datos |
| Pasar la nube al **plan pagado** antes de la entrega | Sin él, el proyecto gratuito se pausa solo tras una semana sin actividad |

### 3.3 Módulos futuros

La lista de la propuesta original (según la enumera Julio: el documento no
está en el repositorio), más lo que `CLAUDE.md` y `docs/` dejan anotado como
módulo pendiente:

| Módulo | Nota |
|---|---|
| **Facturación electrónica (FEL / SAT)** | Cambia el módulo de comprobantes y obliga a revisar decisiones tomadas: la reimpresión con datos vigentes del negocio y la anulación sin documento nuevo |
| **Múltiples cajas y sucursales** | Hoy hay una caja y se asume una terminal por proyecto. Exige resolver los choques contra restricciones únicas al subir, el bloqueo por intentos centralizado, una fila de configuración por sucursal, la autorización TOTP por terminal y una protección estructural de una sola terminal por proyecto |
| **Ajustes de inventario a la baja y mermas, con aprobación** | Hoy el ajuste solo suma, a propósito; las bajas necesitan su propia autorización |
| **Alertas de stock mínimo** | Espera el umbral de §3.2 |
| **Devoluciones parciales** | La anulación es de la venta entera; los campos sin piso de ventas y líneas están reservados para esto |
| **Pantalla de precios especiales** | La venta los aplica, pero nada en la aplicación los crea |
| ~~**Precio de mayoreo y ventas al crédito**~~ **Ventas al crédito, y precio por tipo de cliente** | Esperan las definiciones de §3.2. El precio mayorista por CANTIDAD ya está construido (spec 002, §2) |
| **Código de barras** | De la propuesta original |
| **Básculas digitales** | De la propuesta original; se agregaría detrás de un adaptador, como la impresora |
| **Aplicación móvil** | De la propuesta original |
| **Reportes avanzados** | De la propuesta original. Ya anotado: un reporte de anulaciones por persona, para detectar patrones de fraude; y la exportación de reportes y los gráficos |

### 3.4 Deuda y mejoras técnicas anotadas

No bloquean la entrega; cada una está con su contexto en `CLAUDE.md` §6.2 o,
la de `sincronizar_venta`, en `docs/ANULACION-DE-VENTA.md` §0.2.

- Que la transacción de negocio abra `BEGIN IMMEDIATE`, como dice la
  documentación del inventario.
- Que `sincronizar_venta` rechace una venta ya existente con otro contenido.
- Que Auth use la misma pila de red que el resto (proxy de Windows) y revisar
  los límites de tiempo de las peticiones.
- Reenviar la historia de una base a un proyecto de nube nuevo, si la tienda
  conserva su base al pasar a producción.
- Cerrar la sesión de Auth que queda viva cuando la restauración rechaza un
  usuario de otro rol.
- Qué hacer con el inventario de una anulación posterior a un robo, al
  restaurar.
- Que un asiento anterior al primer usuario no impida restaurar una instalación
  nueva.
- Textos y estados de la barra de nube en casos límite (cifrado del sistema no
  disponible, fotos que fallan).
- Qué pasa con la autorización TOTP si Jimmy pierde el teléfono.

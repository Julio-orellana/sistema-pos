# Núcleo reutilizable vs. negocio de Jimmy

Este documento **no es un formalismo**. Existe porque la base de este sistema se
va a reutilizar con otros clientes parecidos a Jimmy: tiendas que venden a
granel y por unidad, al detalle y al por mayor.

**Regla general del proyecto:**

> Nada específico de Jimmy Cano puede estar escrito dentro del núcleo. Todo lo
> suyo vive en **configuración** o en **datos**.

Si para atender a un segundo cliente hay que editar un archivo de
`src/shared/` o de `src/main/domain/`, algo se hizo mal.

---

## 1. Prueba rápida antes de escribir cualquier línea

Preguntá: **"si mañana entra otro cliente, ¿esto cambia?"**

- **Sí cambia** → es del negocio. Va en configuración, en la base de datos o en
  datos semilla.
- **No cambia** → es del núcleo. Va en el código.

Ejemplo: "el descuento máximo del rol venta es 10%".
El **10%** cambia por cliente → es dato. El **mecanismo** de comparar un
descuento contra un límite y pedir autorización por PIN no cambia → es núcleo.

## 2. Qué es específico del negocio de Jimmy

Nada de esto puede estar escrito dentro del código del núcleo.

| Elemento | Dónde debe vivir | Estado hoy |
|---|---|---|
| Nombre comercial de la tienda | Tabla de configuración de la instalación | No implementado |
| Logo y datos de contacto en el comprobante | Configuración + archivo en Storage | No implementado |
| NIT, dirección y régimen fiscal | Configuración de la instalación | No implementado |
| Catálogo inicial de productos (maíz, azúcar, frijol…) | Datos semilla, cargables desde archivo | No implementado |
| Fotos de producto | Storage (Supabase) o carpeta local, referenciadas por ruta | No implementado |
| Precios, precios de mayoreo y umbrales de mayoreo | Base de datos | No implementado |
| Valores de los límites de descuento por rol | Configuración editable por el administrador | No implementado |
| Nombres de los roles más allá de venta / administrativo | Base de datos | No implementado |
| Usuarios, PIN y permisos | Base de datos | No implementado |
| Peso estándar del saco (60 lb) y nomenclatura de lote (`maiz_6`) | Configuración por producto | No implementado |
| Factores de conversión entre unidades (libra, arroba, quintal, kg) | Tabla de configuración de unidades | No implementado — ver punto 2 de "Pendiente de confirmación" |
| Formato y numeración del comprobante | Plantilla configurable | No implementado |
| Modelo de impresora térmica | Variable de entorno + adaptador | Contrato listo, adaptador real pendiente |
| Credenciales y proyecto de Supabase | `.env`, nunca en el repositorio | `.env.example` listo |
| Moneda y símbolo (GTQ, `Q`) | Constante configurable en `money.ts` | Hoy es constante; **si aparece un cliente fuera de Guatemala, se mueve a configuración** |

## 3. Qué es núcleo reutilizable

Esto sirve tal cual para el próximo cliente.

| Componente | Qué aporta | Estado hoy |
|---|---|---|
| **Aritmética decimal** (`src/shared/money.ts`) | Suma, resta, multiplicación, redondeo comercial, porcentajes, prorrateo por residuo mayor y formato de moneda, todo exacto. | Implementado y probado (78 pruebas) |
| **Contrato IPC y sobre de respuesta** (`src/shared/types/ipc.ts`) | Frontera tipada y validada entre interfaz y proceso principal. | Implementado |
| **Interfaces de integración** (`src/shared/adapters/`) | `ReceiptPrinterProvider` y `SyncProvider`, con implementaciones seguras por defecto. | Implementado |
| **Cascarón de la aplicación** (`src/main/index.ts`, `windows/`) | Arranque, modo kiosko, instancia única, aislamiento del renderer. | Implementado |
| **Capa de acceso a datos** (`src/main/database/`) | Conexión SQLite configurada, migraciones y repositorios. | Conexión implementada; esquema pendiente |
| **Motor de ventas** | Armado de la venta, cálculo de líneas y totales, cobro y vuelto. | No implementado |
| **Sistema de lotes a granel** | Lote con peso inicial y restante, descuento total o parcial, obligación de abrir lote nuevo al agotarse. | No implementado |
| **Motor de descuentos** | Comparación contra límite por rol y flujo de autorización por PIN con registro en auditoría. | No implementado |
| **Sincronización** | Cola de cambios, empuje, traída y resolución de conflictos, detrás de `SyncProvider`. | No implementado |
| **Auditoría** | Registro inmutable de hechos sensibles. | No implementado |
| **Generación de comprobantes en PDF** | Documento siempre generado, independiente de la impresión física. | No implementado |
| **RBAC** | Verificación de permisos en el proceso principal. | No implementado |
| **Andamiaje de calidad** | Configuración de Vitest, ESLint con guardarraíles de arquitectura, tres proyectos de TypeScript, verificación de arranque. | Implementado |

## 4. La zona gris, resuelta de antemano

Casos donde la frontera no es obvia y ya hay criterio acordado:

| Caso | Resolución |
|---|---|
| Redondeo HALF_UP a dos decimales | **Núcleo**, pero con la cantidad de decimales y el modo declarados como constantes en `money.ts`. Si un cliente usa una moneda de tres decimales, se cambia la constante, no la lógica. |
| Símbolo `Q` y separador de miles | **Núcleo por ahora, dato en cuanto haya un segundo país.** Ya está aislado en constantes de `money.ts` para que la migración sea de una línea. |
| "Un saco son 60 libras" | **Dato.** El peso del lote es un campo del lote, nunca una constante del código. |
| "Los lotes se llaman `maiz_6`" | **Dato.** El identificador lo genera una plantilla configurable por producto. |
| "El rol venta puede dar hasta 10%" | **Dato.** El mecanismo de límite y autorización es núcleo. |
| Idioma español de la interfaz | **Núcleo por ahora.** Todos los clientes previstos son guatemaltecos. Si eso cambia, se agrega una capa de traducción; hasta entonces sería complejidad sin uso. |
| Impuestos (IVA) | **Núcleo el mecanismo, dato la tasa y las reglas.** No se ha definido si Jimmy factura — ver "Pendiente de confirmación". |

## 5. Cómo se instalará el próximo cliente (objetivo de diseño)

Cuando el sistema esté terminado, poner en marcha una tienda nueva debería ser:

1. Instalar la aplicación empaquetada.
2. Cargar un archivo de configuración de la instalación (nombre, logo, NIT,
   moneda, unidades y factores de conversión).
3. Importar el catálogo de productos y sus precios.
4. Crear usuarios y roles, y configurar los límites de descuento.
5. Apuntar el `.env` al proyecto de Supabase de ese cliente.

**Cero cambios de código.** Cada vez que una tarea futura obligue a tocar el
código para atender a un cliente nuevo, eso es un defecto de diseño: hay que
anotarlo aquí y corregirlo.

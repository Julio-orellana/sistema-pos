# Stack técnico y decisiones de arquitectura

> Parte de la **constitución** del proyecto (`spec/constitution/`). Este archivo
> recoge las decisiones que valen para **todo** el sistema, con su porqué, al
> nivel que le sirve a alguien que nunca tocó el código. El detalle de cada una
> —las mediciones, las alternativas descartadas, las falsificaciones— vive en
> `CLAUDE.md` (§4 y la tabla de decisiones de §5) y en `docs/`.
> Última revisión: 2026-09-18.

## 1. Las piezas

| Capa | Tecnología | Por qué |
|---|---|---|
| Aplicación de escritorio | **Electron** | Funciona sin internet, empaqueta un instalador de Windows y trae Chromium, que el proyecto reutiliza para el PDF y la reducción de fotos sin sumar dependencias. |
| Interfaz | **React + TypeScript estricto** | Sin `any` implícito: el tipado es parte del mecanismo de confianza. |
| Build | **electron-vite + Vite** | Una sola configuración para los tres procesos (principal, preload, ventana). |
| Base local | **SQLite con better-sqlite3** | Transaccional, en un solo archivo respaldable, y síncrona, lo que simplifica las transacciones de una venta. |
| Nube | **Supabase (Postgres + Auth + Storage)** | Respaldo remoto y restauración. Se habla con su REST por `net.fetch`; **no** se usa `@supabase/supabase-js`, para no sumar una dependencia al proceso principal. |
| Aritmética | **Decimal.js** | Ver §4. |
| Validación de mensajes | **Zod** | Los tipos de TypeScript desaparecen al compilar; Zod valida en tiempo de ejecución. |
| Pruebas | **Vitest**, más arneses que manejan la aplicación real con `playwright-core` en modo Electron | Vitest no ve lo que aparece en la ventana; los arneses sí (§9). |
| Lint | **ESLint + typescript-eslint** con reglas de arquitectura | Hace fallar el lint ante importaciones prohibidas entre capas. |
| Instalador | **electron-builder (NSIS)** | Instalador de Windows x64. |

**Plataforma:** Windows es producción y el criterio de aceptación final para
todo lo que dependa de la plataforma. macOS es solo el entorno de desarrollo:
lo verificado allí se anota como pendiente de confirmar en Windows.

## 2. Arquitectura en capas

```
Ventana (React)          no sabe qué es SQLite ni Supabase
   │  window.pos.*       único puente, expuesto por el preload
Frontera IPC             canales tipados; todo payload se valida con Zod
   │
Servicios y dominio      las reglas del negocio, en el proceso principal
   │
Infraestructura          repositorios SQLite · adaptadores (impresora, nube)
```

- **La base de datos solo se toca desde el proceso principal.** La ventana
  nunca accede a SQLite ni a la red; una regla de ESLint lo impide.
- **La ventana es entrada no confiable.** Nunca manda un precio, un total ni un
  permiso: manda qué producto y cuánto, y el proceso principal recalcula todo.
  Los permisos se comprueban en el proceso principal envolviendo cada canal
  (`requiereRol` / `requiereSesion`), nunca ocultando un botón.
- **Toda respuesta viaja en un sobre** `{ ok, datos } | { ok: false, error }`,
  y el envoltorio común verifica que se pueda clonar antes de mandarla: un
  objeto de dominio con funciones adentro dejaría la llamada colgada.
- **Las integraciones externas van detrás de una interfaz** con una
  implementación segura por omisión (sin impresora, nube simulada), que se
  reemplaza por configuración y no tocando el dominio.

## 3. Modo kiosko sin encerrar al dueño

La ventana es pantalla completa, sin marco, sin menú, sin zoom y sin clic
derecho. **Nunca se usa `kiosk: true` de Electron** y nunca se tocan los
mecanismos de escape del sistema operativo (Administrador de tareas,
`Ctrl+Alt+Supr`, Forzar Salida): es una terminal de venta, no un kiosco
público, y si se cuelga el dueño tiene que poder matarla.

Cerrar la aplicación desde adentro —atajo del administrador, `Alt+F4`/`Cmd+Q`
o el botón de la barra de estado— pasa siempre por el mismo PIN y el mismo
asiento de auditoría, y termina en un cierre ordenado que consolida la base.

## 4. Dinero, peso y cantidad: nunca punto flotante

- **Todo cálculo usa Decimal.js**, desde un solo módulo compartido
  (`money.ts`). Cero operadores nativos sobre montos.
- **Redondeo comercial HALF_UP, una sola vez al final.** La cadena de cálculo
  se mantiene exacta; se redondea al guardar, mostrar o imprimir.
- **«El total manda».** Los importes de línea impresos se derivan del total y
  se reparten por residuo mayor, con desempate determinista por posición, para
  que el papel sume exactamente lo cobrado.
- **En SQLite los decimales se guardan como TEXT canónico**, con un CHECK que
  exige la forma exacta (2 decimales el dinero, 3 el peso). Un único módulo
  (`decimal-columns.ts`) lee y escribe esas columnas. En Postgres son
  `NUMERIC`, que ya es exacto.
- **Ningún reporte suma ni ordena en SQL sobre una columna decimal**: SQLite
  convertiría el texto a punto flotante (medido: cambia centavos) y ordenaría
  byte a byte (`'10.000'` antes que `'2.500'`). Se filtra en SQL y se suma y
  ordena en la aplicación.

## 5. Integridad de los datos locales

- **Identificadores UUID generados en el cliente**, nunca autoincrementales:
  la terminal crea filas sin internet y no pueden colisionar al subir. Las
  excepciones —denominaciones, topes por rol, la fila única de configuración—
  usan ids fijos a propósito, porque ahí la coincidencia entre instalaciones es
  lo que se busca.
- **Las reglas viven también en la base.** Pisos (el inventario nunca negativo),
  coherencias (una boleta solo con tarjeta, un autorizante solo con su vía) y
  CHECK con nombre, además del servicio y de la pantalla. Los errores de
  restricción se traducen a mensajes de negocio en un solo lugar.
- **Una sola forma de abrir una transacción de negocio**
  (`enTransaccionDeNegocio`), que además avisa al sincronizador que se aparte.
- **Descuento de inventario con comparar-y-cambiar** dentro de la transacción,
  y cero reintentos automáticos ante un conflicto: si pasa, se revierte todo y
  decide el cajero.
- **Nada del negocio se borra**: productos, categorías y usuarios se
  desactivan; una venta anulada se registra como un hecho nuevo y su fila
  original no se toca.
- **La bitácora de auditoría es inmutable por trigger**, en SQLite y en
  Postgres.
- **Migraciones numeradas con checksum.** Una migración aplicada no se edita
  nunca; el migrador se niega a arrancar si cambió.
- WAL con `synchronous = FULL` (sobrevivir a un corte de luz), e instancia
  única de la aplicación.

## 6. Offline-first: la bandeja de salida

La terminal es **la única fuente de verdad**; la nube es un espejo que llega
tarde.

- **Bandeja de salida transaccional (outbox).** Cada operación de negocio
  escribe, **dentro de su misma transacción**, las filas que hay que subir en
  `sync_cola`, agrupadas en un lote y ordenadas padres antes que hijos. Matar
  el proceso nunca deja un dato sin su entrada en la cola, ni al revés. Una
  prueba estructural exige que todo asiento de auditoría se escriba dentro de
  una transacción que encola, porque un asiento fuera de ella es un hecho que
  nunca llegaría a la nube.
- **El payload se lee de la base**, no se reconstruye: viaja byte a byte lo
  que quedó guardado.
- **Un trabajador en el proceso principal** sube lote por lote, en estricto
  orden de llegada (las llaves foráneas lo exigen), con presupuesto por ciclo
  para no congelar la ventana, y cediendo ante cualquier transacción en curso.
- **Clasificación de fallos por código HTTP:** un fallo transitorio espera con
  una escalera de reintentos persistida; uno determinístico **detiene la cola
  entera y visible** —nunca se saltea un lote en silencio—; uno de credencial
  no toca la cola. Saltar un lote a mano exige PIN y queda auditado.
- **La sincronización es solo de subida.** No hay bajada incremental: habría
  dos escritores. La única bajada es la **restauración**, una operación manual,
  sobre una base vacía, con otra credencial, que conserva los ids de la nube,
  convierte los tipos sin redondear y verifica conteos y sumas por mes al
  centavo antes de darse por buena.
- **Las fotos** se reducen al guardarlas y suben a Storage después de todas las
  filas. **Los PDF de recibos no se suben**: son dato derivado y se regeneran
  desde las filas.

## 7. La nube: una sola puerta de escritura

- **La terminal no tiene ningún permiso directo sobre ninguna tabla.** Escribe
  únicamente llamando a funciones de Postgres `SECURITY DEFINER`, una por forma
  de lote (usuario, apertura y cierre de caja, venta, lote simple, asiento
  suelto, anulación). Cada función comprueba el rol de la terminal en su
  primera línea, tiene `search_path` vacío, acepta una lista cerrada de tablas,
  decide por tabla si actualizar o ignorar, no calcula nada de negocio y nunca
  arma SQL con texto del lote. El linter de Supabase las lista como aviso, y es
  esperado.
- **Credencial por terminal**, con un rol en `app_metadata` y un JWT de 15
  minutos. En la terminal solo se guarda el token de refresco, cifrado con
  `safeStorage`; la contraseña se descarta al conectar. La llave `service_role`
  nunca viaja en la aplicación.
- **RLS en todas las tablas**, con privilegios de tabla revocados; la única
  política concede lectura al rol de restauración. Una marca de tiempo del
  servidor (`recibido_en`) en las tablas que la terminal escribe permite
  detectar, al restaurar, lo que una credencial robada haya escrito.
- **Versión de contrato** en cada llamada: si la terminal y la nube no la
  comparten, la función falla diciendo los dos números.
- **Dos proyectos de Supabase**: el real y uno descartable. Nada que toque la
  nube se prueba primero en el real, y ninguna migración se aplica a ninguno de
  los dos sin que Julio vea el SQL. El proyecto al que apunta un instalador se
  incrusta al compilar.

## 8. Detección de deriva entre SQLite y Postgres

El esquema vive dos veces, en dos lenguajes. Para que una columna nueva en un
lado y no en el otro falle en una prueba y no en la primera venta real:

- La nube publica su contrato con una función (`contrato_de_sincronizacion`),
  y el repositorio guarda una **foto** de ese contrato
  (`supabase/esquema-nube.json`), que solo cambia por un commit que alguien lee.
- **Mitad A, en cada `npm test`, sin red:** el esquema local, con todas las
  migraciones aplicadas, contra la foto; incluidas las propiedades de cada
  función (DEFINER, `search_path`).
- **Mitad B, con red (`npm run verify:nube`):** lo que la nube declara contra la
  foto.
- Las funciones exigen el payload **exacto**: una columna de más o de menos se
  rechaza con su nombre, en vez de ignorarse.

## 9. Cómo se verifica

- **Vitest** para toda regla de negocio y todo cálculo con Decimal, con
  nombres de prueba en español que se leen como lista de verificación.
- **Pruebas estructurales** que recorren el árbol sintáctico del código y fallan
  con archivo y línea ante un defecto de patrón (un asiento fuera de la
  bandeja, un campo de texto sin teclado en pantalla, un mapa de nombres
  duplicado, una petición de red sin límite de tiempo). Cada una tiene un
  control que demuestra que su detector detecta.
- **Arneses sobre la aplicación real** (`npm run verify:pantallas*`), a
  1024×768, la pantalla de la tienda, para lo que Vitest no puede ver.
- **Falsificación:** una prueba que nunca se vio fallar no prueba nada; los
  cambios importantes se verifican reintroduciendo el defecto a propósito.
- **`npm run verify`** (lint + tipos + pruebas) debe pasar antes de cada
  commit.

## 10. Otras decisiones que atraviesan todo

- **Seguridad del PIN:** cuatro dígitos con hash scrypt y sal por usuario,
  comparación en tiempo constante, bloqueo por intentos persistido, y candados
  separados para el ingreso y para cada superficie de autorización. La
  autorización a distancia es un código TOTP de seis dígitos, de un solo uso,
  cuyo secreto vive cifrado en la terminal y nunca sube a la nube.
- **Datos nunca como código:** un dato externo viaja siempre como parámetro o
  variable aparte, nunca armado dentro de SQL, PowerShell o un shell.
- **La red nunca demora la primera pantalla:** todo lo que usa la red arranca
  después de que la ventana se muestra, y toda petición lleva límite de tiempo.
- **Comprobante:** el PDF sale del Chromium de Electron; la térmica recibe
  ESC/POS en crudo por la cola de impresión de Windows.
- **Hora de Guatemala (UTC−6)** para todo lo que dice «hoy»; se guarda en UTC.
- **Dos bitácoras distintas:** `auditoria_log` para hechos del negocio y un
  archivo técnico local para fallos de hardware, red y arranque.
- **Idioma:** lo técnico genérico en inglés; el dominio del negocio, los
  comentarios y las pruebas, en español.
- **Git:** `develop` para el trabajo y `main` solo por merges que Julio apruebe;
  commits atómicos con prefijo en inglés y descripción en español.

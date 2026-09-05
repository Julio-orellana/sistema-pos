# Guía de desarrollo

Cómo se escribe código en este proyecto. Está dirigida tanto a Claude en
sesiones futuras como a cualquier persona que retome el trabajo.

---

## 1. Convenciones de nombres

La regla base está en `CLAUDE.md` y no tiene excepciones. Aquí queda con
ejemplos, que es donde se resuelven las dudas reales.

### 1.1 Inglés — técnico genérico

Carpetas, archivos de infraestructura y utilidades sin contenido de negocio:

```
src/main/database/connection.ts
src/main/ipc/register-handlers.ts
src/main/windows/main-window.ts
src/shared/adapters/receipt-printer.ts
```

También las interfaces de integración que ya se nombraron así por acuerdo:
`ReceiptPrinterProvider`, `SyncProvider`.

### 1.2 Español — dominio de negocio

Entidades, campos, funciones de cálculo financiero, canales IPC, códigos de
error y **todo** lo que el cliente o el auditor van a leer:

```ts
producto, venta, lote, descuento, caja, comprobante, autorizacion
montoACadena(), redondearPeso(), porcentajeDe(), repartirMonto()
'diagnostico:base-de-datos', 'ventas:registrar'
'DIVISION_ENTRE_CERO', 'PAYLOAD_INVALIDO'
```

**Nota sobre `money.ts`:** sus operaciones (`sumar`, `restar`, `redondearMonto`)
están en español aunque parezcan "aritmética genérica". Son vocabulario
financiero del proyecto, y así una prueba se lee sola:
`expect(montoACadena(sumar('0.1', '0.2'))).toBe('0.30')`.

**Métodos de las interfaces de integración:** el nombre de la interfaz está en
inglés, pero sus métodos actúan sobre entidades del dominio y van en español:
`imprimirComprobante()`, `empujarCambios()`, `traerCambios()`.

### 1.3 Comentarios

- Comentarios y JSDoc de lógica de negocio no trivial: **siempre en español**.
- Un comentario debe explicar **por qué**, no **qué**. `// suma los totales`
  sobra; `// no se redondea aquí porque encadenar descuentos redondeados deja
  un centavo suelto` vale su espacio.
- Cada archivo con lógica de negocio abre con un bloque que explica su
  responsabilidad y las reglas que hace cumplir.

### 1.4 Otras convenciones

| Elemento | Convención | Ejemplo |
|---|---|---|
| Archivos | `kebab-case.ts` | `register-handlers.ts` |
| Componentes React | `PascalCase.tsx` | `App.tsx` |
| Tipos e interfaces | `PascalCase` | `DiagnosticoBaseDeDatos` |
| Funciones y variables | `camelCase` | `redondearMonto` |
| Constantes de módulo | `MAYUSCULAS_CON_GUION_BAJO` | `DECIMALES_MONTO` |
| Tablas y columnas SQL | `snake_case` en español | `lote_granel`, `peso_restante` |

## 2. Cómo se agrega un módulo nuevo, paso a paso

Ejemplo: agregar el módulo **descuentos**.

1. **Tipos y contrato IPC.** En `src/shared/types/` declarar las entidades
   (`LimiteDeDescuento`, `SolicitudDeAutorizacion`) y, en `ipc.ts`, los canales
   nuevos con su esquema Zod. Nada cruza la frontera sin estar declarado aquí.
2. **Dominio puro.** En `src/main/domain/descuentos/` escribir las reglas sin
   SQL, sin Electron y sin red: recibe datos, devuelve decisiones. Todo cálculo
   monetario usa `money.ts`.
3. **Pruebas del dominio.** Antes de conectar nada, `descuentos.test.ts` con
   casos concretos y nombres en español. Si la regla no se puede probar sin
   base de datos, el diseño está mal.
4. **Repositorio.** En `src/main/database/repositories/` la interfaz y su
   implementación SQLite. La interfaz vive donde la usa el dominio.
5. **Migración.** Agregar la migración del esquema. Nunca se edita una
   migración ya aplicada: se agrega otra.
6. **Servicio de aplicación.** En `src/main/services/` orquestar el caso de uso:
   abrir transacción, llamar al dominio, persistir, emitir eventos.
7. **Manejador IPC.** En `src/main/ipc/` registrar el canal: validar con Zod,
   llamar al servicio, responder con `RespuestaIpc<T>`.
8. **API del preload.** Agregar el método a `ApiPos` y exponerlo en
   `src/main/preload/index.ts`.
9. **Interfaz React.** Recién ahora la pantalla, que solo llama a `window.pos`.
10. **Documentar.** Fila nueva en la tabla de decisiones de `CLAUDE.md` si hubo
    una decisión de diseño; actualizar `ARCHITECTURE.md` si cambió una
    responsabilidad; actualizar `NEGOCIO_VS_NUCLEO.md` si algo es específico de
    Jimmy.

## 3. Qué se prueba con Vitest y qué no

### Se prueba SIEMPRE

- **Todo lo que use Decimal.js.** Cálculo de líneas, totales, descuentos,
  vueltos, conversiones de unidad, prorrateos. Con casos borde de redondeo.
- **La política de redondeo del sistema.** La regla es **redondeo único al
  final**: la cadena de cálculo se mantiene exacta y se redondea una sola vez,
  al persistir, mostrar o imprimir. Cualquier función de cálculo nueva debe
  sumarse al grupo de pruebas "Política de redondeo del sistema" de
  `money.test.ts`, que existe justamente para que la política no dependa de
  que alguien la recuerde.
- **Todas las reglas de negocio.** Límites de descuento por rol, autorización
  por PIN, agotamiento de lotes, apertura obligatoria de lote nuevo, cuadre del
  corte de caja.
- **Las máquinas de estado.** Estados válidos de una venta, de un lote y de un
  turno de caja, incluyendo las transiciones prohibidas.
- **La validación de payloads.** Que un DTO inválido sea rechazado con el
  código de error correcto.
- **Los adaptadores por defecto.** Que se pueda cerrar una venta sin impresora y
  trabajar sin Supabase.

### No necesita prueba automatizada

- Estilos CSS y detalles visuales.
- Configuración de Electron y de la ventana — se cubre con
  `npm run verify:arranque`, que produce un informe comparable.
- Envoltorios de una línea que solo reenvían a otra función.
- Tipos de TypeScript: los verifica `npm run typecheck`.
- Llamadas reales a Supabase: se prueban de forma deliberada y puntual, en una
  sesión dedicada, no en cada ciclo de desarrollo.

### Cómo se escribe una prueba en este proyecto

El nombre de la prueba es para el auditor, no para el programador:

```ts
// Sirve: describe el caso y el resultado esperado.
it('bloquea un descuento de 25% cuando el límite del rol venta es 10%', ...)
it('0.1 + 0.2 da exactamente 0.3 (JavaScript nativo daría 0.30000000000000004)', ...)

// No sirve: no se puede auditar sin leer el código.
it('funciona correctamente', ...)
it('descuento OK', ...)
```

Reglas:

- Nombres y mensajes de fallo **en español**.
- Usar números concretos del negocio real de Jimmy (libras de maíz, quetzales),
  no `foo` y `bar`.
- Cada `describe` agrupa por comportamiento observable, no por función.
- Un caso borde por prueba. Si una prueba falla, debe quedar claro **qué** regla
  se rompió.

## 4. Cómo cerrar la aplicación (y no matar el proceso)

La ventana corre en modo kiosko: no tiene barra de título, ni botón de cerrar,
ni menú. Esto es deliberado, pero significa que hay que conocer la salida.

### 4.1 La salida controlada (la que hay que usar)

Presionar **`Ctrl + Shift + Alt + Q`** — en macOS, **`Ctrl + Shift + Option + Q`**.
Aparece un diálogo que pide el **PIN de administrador**. Con el PIN correcto la
aplicación se cierra de forma ordenada.

> Este atajo es una salida de emergencia del administrador. **No se documenta
> ni se le muestra al usuario de venta**, y no debe existir ningún botón, menú
> ni pista visual que lo revele. Si algún día aparece uno, es un defecto.

**El PIN en desarrollo:** si no hay `POS_PIN_ADMINISTRADOR` en el `.env`, en
desarrollo se usa **`0000`** y la consola lo avisa al arrancar. Para trabajar
con un PIN propio:

```bash
echo "POS_PIN_ADMINISTRADOR=1234" >> .env
```

En producción **no hay PIN de respaldo**: si la instalación no tiene uno
configurado, la salida controlada queda deshabilitada y el diálogo lo dice.

### 4.2 Qué significa "cierre ordenado"

No es solo `app.quit()`. En orden:

1. Se quitan los canales IPC, para que no entre trabajo nuevo.
2. Se consolida el WAL de SQLite en el archivo principal
   (`wal_checkpoint(TRUNCATE)`), de modo que el `.db` quede completo y
   respaldable, sin un `-wal` suelto al lado.
3. Se cierra la conexión y recién entonces la aplicación.

Matar el proceso desde el Administrador de tareas o con `kill -9` se salta los
tres pasos.

### 4.3 Otras salidas, y por qué no alcanzan

| Vía | Sirve | Comentario |
|---|---|---|
| `Ctrl + Shift + Alt + Q` + PIN | Sí | La única que cierra de forma ordenada. Es la que hay que usar. |
| `Cmd + Q` (macOS) | Parcial | Electron cierra la app y la red de seguridad de `will-quit` libera la base, pero **sin** consolidar el WAL. |
| `Ctrl + C` en la terminal de `npm run dev` | Parcial | Mata el proceso de Electron. Sirve para salir de un apuro en desarrollo, no consolida nada. |
| Administrador de tareas / `kill -9` | Último recurso | Deja el WAL sin consolidar. Es exactamente lo que la salida controlada vino a evitar. |

### 4.4 Verificar la salida sin abrir la ventana

```bash
npm run verify:arranque
```

Ese comando ejercita el camino completo dentro de la aplicación real —atajo,
PIN incorrecto rechazado, PIN correcto autorizado, cierre ordenado— e imprime
un informe en JSON con lo que encontró.

## 5. Reglas de código que hace cumplir el lint

`npm run lint` no es cosmético: bloquea errores de arquitectura.

| Regla | Qué impide |
|---|---|
| `no-restricted-imports` en `src/renderer` | Que el renderer importe `better-sqlite3`, `electron`, `node:*` o código de `src/main`. |
| `no-restricted-imports` en `src/shared` | Que el código compartido dependa de Electron, SQLite o el SDK de Supabase. |
| `@typescript-eslint/no-magic-numbers` | Un `0.16` suelto en un cálculo. Todo número con significado lleva nombre. |
| `@typescript-eslint/no-explicit-any` y familia `no-unsafe-*` | Que se pierda el tipado en la frontera con librerías externas. |
| `explicit-function-return-type` | Funciones cuyo tipo de retorno haya que adivinar. |
| `no-floating-promises` | Un `await` olvidado — en una venta, eso es una venta perdida en silencio. |
| `no-restricted-imports` en `src/shared` | Que el código compartido dependa de Electron, SQLite o el SDK de Supabase. |

## 6. Checklist de "listo para commit"

Antes de cada commit, en orden:

- [ ] `npm run lint` pasa sin errores.
- [ ] `npm run typecheck` pasa en los tres proyectos (node, preload, web).
- [ ] `npm test` pasa, y las pruebas nuevas tienen nombres en español legibles.
- [ ] Todo cálculo de dinero, peso o cantidad usa `money.ts`. **Cero** operadores
      `+ - * /` sobre montos.
- [ ] Se respeta el **redondeo único al final**: ninguna función de cálculo
      nueva redondea resultados intermedios.
- [ ] Los comentarios de la lógica de negocio no obvia están en español y
      explican el *por qué*.
- [ ] Ningún nombre nuevo rompe la convención de idioma.
- [ ] Nada específico de Jimmy quedó dentro del núcleo reutilizable
      (ver [NEGOCIO_VS_NUCLEO.md](./NEGOCIO_VS_NUCLEO.md)).
- [ ] Si el trabajo dependía de un punto sin confirmar, quedó un `TODO(...)` en
      el código y una línea en "Pendiente de confirmación" de `CLAUDE.md`.
- [ ] **No** se implementó ninguna regla de selección automática de lote.
- [ ] El commit es atómico, va a `develop`, con prefijo en inglés
      (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`) y descripción
      en español.

Atajo: `npm run verify` corre lint, tipos y pruebas de un solo tirón.

## 7. Trabajo con Git

- Solo dos ramas: `main` y `develop`.
- Todo el trabajo ocurre en `develop`.
- `main` no recibe commits directos; solo merges que Julio apruebe después de
  revisar.
- No se crean ramas por tarea.
- Formato del mensaje:

```
feat: agrega el cálculo de descuento por rol con autorización por PIN

Los límites se leen de la configuración del rol y la excepción puntual
queda registrada en auditoría con el usuario que autorizó.
```

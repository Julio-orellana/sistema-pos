# POS Agrícola

Sistema de punto de venta de escritorio para una tienda de productos agrícolas
en Guatemala. Venta **a granel** (por peso, descontando de lotes) y **por
unidad**, al detalle y al por mayor.

- **Cliente:** Jimmy Cano
- **Estado:** andamiaje del proyecto (Prompt 1). Todavía **no hay pantallas de
  negocio** ni esquema de base de datos del dominio.
- **Contexto completo del proyecto:** [CLAUDE.md](./CLAUDE.md)

---

## Requisitos

- **Node.js 22 o superior** (`node -v`)
- **npm 10 o superior**
- macOS: herramientas de línea de comandos de Xcode
  (`xcode-select --install`), necesarias para compilar `better-sqlite3`.
- Windows: Build Tools de Visual Studio con el componente de C++.

## Instalación

```bash
npm install
```

El `postinstall` recompila automáticamente `better-sqlite3` contra el ABI de
Electron. Si algún día falla la carga del módulo nativo:

```bash
npm run rebuild
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Abre la aplicación en modo desarrollo, con recarga en caliente. |
| `npm test` | Corre todas las pruebas automatizadas una vez. |
| `npm run test:watch` | Corre las pruebas y se queda observando cambios. |
| `npm run lint` | Revisa reglas de código **y de arquitectura**. |
| `npm run typecheck` | Verifica tipos en los tres proyectos (main, preload, renderer). |
| `npm run verify` | Lint + tipos + pruebas, todo junto. Es el comando previo a cada commit. |
| `npm run verify:arranque` | Arranca la aplicación real, imprime un informe de verificación y sale. |
| `npm run build` | Compila los tres procesos para producción. |
| `npm run dist` | Genera el instalador con electron-builder. |

### Correr la aplicación

```bash
npm run dev
```

Abre en **modo kiosko**: pantalla completa, sin barra de título, sin menú, sin
zoom y sin menú de clic derecho. En desarrollo la ventana muestra una **pantalla
de verificación técnica**, no la caja: comprueba que la aritmética decimal, la
conexión a SQLite y los adaptadores estén funcionando.

Para cerrarla durante el desarrollo: `Cmd+Q` en macOS, `Alt+F4` en Windows, o
`Ctrl+C` en la terminal donde corre.

### Correr las pruebas

```bash
npm test
```

Las pruebas están escritas **para poder auditarlas**: los nombres describen el
caso y el resultado esperado en español, de modo que se leen como una lista de
verificación sin abrir el código. Ejemplos reales de la salida:

```
✓ 0.1 + 0.2 da exactamente 0.3 (JavaScript nativo daría 0.30000000000000004)
✓ usa medio hacia arriba y NO redondeo bancario: 0.125 da 0.13, no 0.12
✓ reparte Q10 entre tres líneas iguales sin perder ni un centavo
✓ imprimir sin impresora responde ok y deja constancia de que fue omitido por diseño
✓ un valor desconocido no habilita nada por accidente
```

### Verificar el arranque sin mirar la pantalla

```bash
npm run verify:arranque
```

Arranca la aplicación de verdad —misma ventana, misma base de datos, mismos
adaptadores—, imprime un informe en JSON y sale. Sirve para comparar resultado
esperado contra resultado real sin depender de que alguien mire la pantalla:

```json
{
  "ventana": {
    "medido": {
      "modoKiosko": true,
      "pantallaCompleta": true,
      "menuDeAplicacionEliminado": true,
      "factorDeZoom": 1
    },
    "declarado": {
      "sinMarcoNiBarraDeTitulo": true,
      "aislamientoDeContexto": true,
      "integracionDeNodeEnRenderer": false
    }
  },
  "baseDeDatos": {
    "conectada": true,
    "versionSqlite": "3.53.4",
    "modoJournal": "wal",
    "llavesForaneasActivas": true
  }
}
```

> En macOS el campo `barraDeMenuVisible` siempre reporta `true`, porque el menú
> pertenece a la barra del sistema y no a la ventana. En macOS el dato que
> importa es `menuDeAplicacionEliminado`.

## Configuración

Copiar la plantilla y llenarla:

```bash
cp .env.example .env
```

Mientras `POS_SYNC_PROVIDER` valga `simulado` (el valor por defecto), el sistema
**no hace ninguna llamada a Supabase** y no consume su cuota del plan gratuito.
Ver [docs/INTEGRACIONES.md](./docs/INTEGRACIONES.md).

## Dónde se guardan los datos

La base de datos local es un archivo SQLite fuera de la carpeta de la
aplicación, para que sobreviva a actualizaciones y reinstalaciones:

- **macOS:** `~/Library/Application Support/pos-agricola/pos-agricola.db`
- **Windows:** `%APPDATA%\pos-agricola\pos-agricola.db`

## Documentación

| Documento | Para qué sirve |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | Contexto persistente: decisiones tomadas, registro de decisiones técnicas y puntos pendientes de confirmar. **Empezar por aquí.** |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Capas del sistema, módulos de dominio y patrones de diseño con ejemplos concretos. |
| [docs/DEVELOPMENT_GUIDE.md](./docs/DEVELOPMENT_GUIDE.md) | Convenciones, cómo agregar un módulo, qué se prueba y checklist de commit. |
| [docs/NEGOCIO_VS_NUCLEO.md](./docs/NEGOCIO_VS_NUCLEO.md) | Qué es específico de Jimmy y qué es núcleo reutilizable para otros clientes. |
| [docs/INTEGRACIONES.md](./docs/INTEGRACIONES.md) | Contratos de impresora y sincronización, y cómo se activa la implementación real. |

## Ramas

- `main` — solo recibe merges aprobados por Julio. **Nunca** commits directos.
- `develop` — donde ocurre todo el trabajo.

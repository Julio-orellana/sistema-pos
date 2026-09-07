# Migraciones de Supabase (Postgres)

Espejo en la nube del esquema local. **No todo lo que existe en SQLite se
espeja.**

## Qué se espeja y qué no

> **REGLA: la nube lleva DATOS DE NEGOCIO. El estado operativo local de una
> terminal se queda en SQLite.**

| Tabla local | ¿Se espeja? | Por qué |
|---|---|---|
| `usuarios`, `categorias`, `productos`, `precios_especiales`, `limites_descuento`, `caja_sesiones`, `ventas`, `venta_detalle`, `recibos`, `auditoria_log` | **Sí** | Son los datos del negocio: qué se vendió, a qué precio, quién lo hizo. |
| `sync_cola` | **No** | Es la lista local de qué falta subir. Subirla sería subir la lista de pendientes junto con los pendientes. |
| `bloqueos_de_autorizacion` | **No** | Estado de seguridad de **una** terminal, válido durante 30 segundos. Ver abajo. |
| `usuarios.intentos_fallidos`, `usuarios.bloqueado_hasta` | **No** | Mismas razones: son columnas locales de una tabla que sí se espeja. |
| `migraciones_aplicadas` | **No** | Control del migrador local. |

## Por qué el estado de bloqueo no sube a la nube

1. **Es efímero.** Una fila de bloqueo deja de significar nada 30 segundos
   después de escribirse. Con sincronización diferida llegaría a la nube ya
   vencida.
2. **Nadie la consultaría desde allá.** No hay reporte ni conciliación que la
   necesite. El hecho auditable —que hubo un bloqueo— **sí** viaja: queda en
   `auditoria_log` con las acciones `usuario_bloqueado` y
   `autorizacion_bloqueada`, y esa tabla sí está espejada.
3. **Sincronizarla sería activamente dañino con más de una terminal.** El
   candado del diálogo de autorización protege *ese* diálogo en *esa* máquina.
   Si el bloqueo de la terminal A viajara a la terminal B, un error de tecleo
   en una caja dejaría bloqueada la otra: exactamente la negación de servicio
   que la separación de candados vino a eliminar (ver `CLAUDE.md` §4.8).
4. **Columnas siempre en cero engañan al auditor.** Si `intentos_fallidos`
   existiera en la nube sin sincronizarse nunca, quien consultara Postgres
   vería `0` para todos y podría concluir que nadie falló jamás un ingreso.

## Los números 0002, 0003 y 0006 NO existen aquí, y es a propósito

**No falta nada ni se rompió nada.** El número de cada archivo de esta carpeta
corresponde al de su migración local en `src/main/database/migrations/`. Un
hueco en la numeración significa que **esa migración local no tiene espejo**.

| Migración local | Archivo aquí | Por qué |
|---|---|---|
| `001_esquema_inicial` | `0001_esquema_inicial.sql` | Datos de negocio |
| `002_bloqueo_de_usuarios` | **(ninguno, a propósito)** | Estado por identidad, local por ahora |
| `003_bloqueos_de_autorizacion` | **(ninguno, a propósito)** | Estado por superficie, local siempre |
| `004_denominaciones_y_desglose` | `0004_denominaciones_y_desglose.sql` | Datos de negocio: el arqueo del corte |
| `005_pin_remoto` | `0005_pin_remoto.sql` | Columna de `usuarios`, que ya se sincroniza entera |
| `006_superficie_cierre_con_diferencia` | **(ninguno, a propósito)** | Amplía `bloqueos_de_autorizacion`, que no se espeja |
| `007_autorizacion_de_diferencia` | `0007_autorizacion_de_diferencia.sql` | Parte del corte de caja |
| `008_autorizacion_solo_con_diferencia` | `0008_autorizacion_solo_con_diferencia.sql` | Parte del corte de caja |
| `009_categorias_activo` | `0009_categorias_activo.sql` | Catálogo: dato de negocio |

Cada migración local que sea dato de negocio se espeja con su mismo número. **No renumerar** para "tapar" los
que faltan: el hueco es información.

Son **tres números** omitidos pero **dos casos**: el 0003 y el 0006 son la
misma tabla, `bloqueos_de_autorizacion` —la 006 solo le amplía el CHECK de
superficies—, así que si la tabla no se espeja, ninguna migración que la toque
se espeja tampoco. Ese es todo el motivo del hueco del 0006: no hay ninguna
razón adicional, ni nada pendiente de decidir sobre él.

Los dos casos **no son equivalentes**, aunque hoy tomen la misma decisión:

- **`bloqueos_de_autorizacion`** no debe sincronizarse **nunca**, bajo ningún
  diseño futuro.
- **`usuarios.intentos_fallidos` / `bloqueado_hasta`** hoy no se sincroniza por
  una limitación de la arquitectura de una sola terminal, y **probablemente
  haga falta** cuando exista multi-sucursal.

El detalle y la razón de cada uno están en `CLAUDE.md`, sección 4.4.

> No confundir estos números con las versiones de migración que registra
> Supabase (`20260905143642`, etc.): esas las genera la propia plataforma al
> aplicar, y son independientes del nombre del archivo.

## Estado

| Migración | Aplicada en `pos-jimmy-cano` |
|---|---|
| `0001_esquema_inicial.sql` | Sí — `20260905143642` |
| *(fijar search_path de la función de auditoría)* | Sí — `20260905171724` |
| *(no hay 0002 ni 0003: ver la sección anterior)* | — |
| `0004_denominaciones_y_desglose.sql` | Sí — `20260907002143` |
| `0005_pin_remoto.sql` | Sí — `20260907002154` |
| *(no hay 0006: ver la sección anterior)* | — |
| `0007_autorizacion_de_diferencia.sql` | Sí — `20260907002212` |
| `0008_autorizacion_solo_con_diferencia.sql` | Sí — `20260907002231` |
| `0009_categorias_activo.sql` | **No — pendiente de aplicar** |

**Hay una migración pendiente de aplicar en la nube: `0009`.** Como todas, se
aplica solo con la aprobación explícita de Julio y después de mostrarle el SQL
exacto.

Las cuatro del corte de caja (0004, 0005, 0007 y 0008) se aplicaron el
2026-09-06 por esa misma vía, y se verificaron consultando el catálogo del
proyecto: 12 tablas con RLS activo, los dos CHECK de `caja_sesiones` con
`convalidated = true`, y las 11 denominaciones cotejadas una a una contra los
UUID del esquema local.

## Al agregar una migración local nueva

Preguntarse primero: **¿esto es dato de negocio o estado operativo de esta
terminal?** Solo lo primero necesita archivo en esta carpeta.

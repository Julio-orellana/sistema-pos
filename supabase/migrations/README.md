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

## Los números 0002 y 0003 NO existen aquí, y es a propósito

**No falta nada ni se rompió nada.** El número de cada archivo de esta carpeta
corresponde al de su migración local en `src/main/database/migrations/`. Un
hueco en la numeración significa que **esa migración local no tiene espejo**.

| Migración local | Archivo aquí | Por qué |
|---|---|---|
| `001_esquema_inicial` | `0001_esquema_inicial.sql` | Datos de negocio |
| `002_bloqueo_de_usuarios` | **(ninguno, a propósito)** | Estado por identidad, local por ahora |
| `003_bloqueos_de_autorizacion` | **(ninguno, a propósito)** | Estado por superficie, local siempre |

La próxima migración local que sí sea dato de negocio —supongamos `004`— se
espeja como `0004_...`, conservando el hueco. **No renumerar** para "tapar" los
que faltan: el hueco es información.

Los dos casos omitidos **no son equivalentes**, aunque hoy tomen la misma
decisión:

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

**No hay ninguna migración pendiente de aplicar en la nube.** Las migraciones
locales 002 y 003 no tienen espejo a propósito.

## Al agregar una migración local nueva

Preguntarse primero: **¿esto es dato de negocio o estado operativo de esta
terminal?** Solo lo primero necesita archivo en esta carpeta.

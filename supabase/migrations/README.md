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

## Estado

| Migración | Aplicada en `pos-jimmy-cano` |
|---|---|
| `0001_esquema_inicial.sql` | Sí — `20260905143642` |
| *(fijar search_path de la función de auditoría)* | Sí — `20260905171724` |

**No hay ninguna migración pendiente de aplicar en la nube.** Las migraciones
locales 002 y 003 no tienen espejo a propósito.

## Al agregar una migración local nueva

Preguntarse primero: **¿esto es dato de negocio o estado operativo de esta
terminal?** Solo lo primero necesita archivo en esta carpeta.

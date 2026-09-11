# ⚠ Antes de tocar `008_autorizacion_solo_con_diferencia.sql`

> **Este archivo está al lado de la migración a propósito.** La advertencia no
> se puede poner dentro del `.sql` porque esa migración **ya está aplicada** y el
> migrador guarda su checksum SHA-256: cambiarle un solo carácter —aunque sea un
> comentario— hace que la aplicación **se niegue a abrir** toda base que ya la
> haya aplicado. Ver la fila «Migraciones numeradas con checksum registrado» del
> registro de decisiones de CLAUDE.md §5.

## La restricción de esta migración sostiene algo más de lo que dice su nombre

`caja_sesiones_autorizacion_solo_con_diferencia` se escribió para una cosa: que
un cierre de caja lleve autorización **si y solo si** hay descuadre. Eso sigue
siendo su razón de ser.

**Pero además, sin habérselo propuesto, es lo único que tapa un hueco de la
migración 007.**

## El hueco de la 007, en concreto

`caja_sesiones_autorizacion_coherente`, de la migración 007, está escrita así:

```sql
(diferencia_autorizada_via IS NULL AND diferencia_autorizada_por IS NULL)
OR (diferencia_autorizada_via IN ('presencial', 'remoto')
    AND diferencia_autorizada_por IS NOT NULL)
```

Su comentario dice que rechaza «una autorización sin vía, o una vía sin
autorizante». **La segunda mitad no la rechaza.** Con `diferencia_autorizada_via`
en NULL, la expresión `via IN ('presencial','remoto')` no devuelve FALSO sino
NULL; la segunda rama entera da NULL; la primera da FALSO; y `FALSO OR NULL` es
NULL. **Un CHECK de SQL solo rechaza cuando su expresión da FALSO: con NULL deja
pasar la fila.**

Medido en los dos motores. En SQLite da NULL en 5 de 36 combinaciones, en
Postgres en 4 de 32, siempre el mismo caso: autorizante presente y vía vacía.

## Por qué hoy no hay ningún dato mal guardado

Porque **esta** migración exige las dos columnas de forma explícita:

```sql
diferencia_autorizada_por IS NOT NULL
AND diferencia_autorizada_via IS NOT NULL
```

`IS NOT NULL` devuelve FALSO —nunca NULL— así que cortocircuita la rama y el
CHECK muerde. En cada una de las combinaciones donde la 007 se rinde, esta
restricción devuelve FALSO y la fila no entra. Comprobado con `INSERT` reales
contra la tabla completa, no solo evaluando expresiones.

## Qué hay que hacer si se va a relajar esta restricción

El caso realista: alguien quiere permitir que un cierre **cuadrado** lleve
autorización, o aflojar de algún otro modo las cuatro condiciones de la segunda
rama. Si eso pasa:

1. **Comprobar primero si reabre el hueco de la 007.** Si la restricción nueva
   deja de exigir `diferencia_autorizada_via IS NOT NULL` para algún caso, ese
   caso queda protegido únicamente por la 007, que no protege.
2. Si lo reabre, la reparación correcta es **una migración nueva** que agregue la
   coherencia bien escrita, con los `IS NOT NULL` **adelante**, como quedó la
   017 para `ventas`. La 007 no se edita: está aplicada.
3. Correr `npm test`. Dos pruebas de `checks-con-null.test.ts` están puestas
   justamente para esto y van a fallar: la que fija el checksum de esta migración
   y la que inserta filas incoherentes contra `caja_sesiones`.

## Dónde está todo esto verificado

`src/main/database/__tests__/checks-con-null.test.ts`. Recorre los CHECK del
esquema, los evalúa sobre grillas que incluyen NULL, y comprueba con filas reales
que `caja_sesiones` rechaza toda combinación incoherente.

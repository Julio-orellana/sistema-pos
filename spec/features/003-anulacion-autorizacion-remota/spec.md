# 003 — Anular una venta con autorización a distancia

> **Estado:** spec escrito el 2026-09-19, antes de tocar el código. Lo siguen
> [`plan.md`](plan.md) (cómo se construye) y [`tasks.md`](tasks.md) (la lista de
> tareas). **Aprobado por Julio el 2026-09-19**, con la decisión sobre la
> migración (plan §1) y un agregado: el contador de anulaciones remotas en el
> resumen de ventas (§3.4, CA-18). **Ninguna migración se aplica en ninguna nube
> dentro de esta spec, tampoco en el descartable.**
>
> **Pedido por:** Jimmy Cano, el cliente, a través de Julio Orellana.
>
> **REVIERTE UNA DECISIÓN DE SEGURIDAD DELIBERADA**, a pedido explícito del
> cliente e informado del riesgo: `docs/ANULACION-DE-VENTA.md` §4.2 (decisión
> 2), CLAUDE.md §4.9, §4.45 y §4.54. La razón original se conserva escrita en §2.

---

## 1. El problema

Hoy una anulación solo la autoriza un administrador que esté en la tienda,
tecleando su PIN de cuatro dígitos en la terminal. Si Jimmy no está, la venta
espera a que llegue. Y si mientras tanto se cierra la caja, esa venta ya no se
puede anular: la anulación solo existe para ventas de la caja abierta (diseño
§4.2, «El costo, dicho en voz alta»).

Jimmy pidió poder autorizarla a distancia, dictando por teléfono el código de
seis dígitos de su app de autenticación (TOTP, CLAUDE.md §4.47). Es lo mismo que
ya hace con un cierre descuadrado, con un descuento que pasa el tope y con la
salida controlada.

## 2. Lo que se deja de proteger, dicho en voz alta

La superficie `anulacion_de_venta` rechaza el código remoto desde que existe,
por una razón que **sigue siendo cierta**:

> **Anular una venta afirma un hecho físico —que el cliente devolvió la
> mercadería y que el dinero salió del cajón— que un administrador a distancia no
> puede verificar.** Por teléfono, lo que se autoriza es un relato. Y es el
> patrón de fraude más común en un punto de venta: se cobra en efectivo, se anula
> la venta y el dinero queda en el bolsillo de quien anuló. Además, la anulación
> borra del corte el total entero de una venta ya cobrada y sube el inventario:
> si la mercadería no volvió, el faltante aparece recién en un conteo físico.
> (Diseño §4.2, razones 1 y 2.)

Esa razón se sostenía en tres capas:

| Capa | Qué la hace cumplir | Desde |
|---|---|---|
| La política | `ACEPTA_PIN_REMOTO.anulacion_de_venta = false` (`autenticacion.ts:137`) | 2026-09-15 (§4.45) |
| La base local | Migración `038`: CHECK `anulaciones_de_venta_solo_presencial`, `autorizada_via = 'presencial'` | 2026-09-17 (§4.54) |
| La nube | Migración `0038`, con el mismo CHECK, aplicada en `pos-jimmy-cano` y en `pos-pruebas-descartable` | 2026-09-17 (§4.4, §4.56) |

Julio le explicó a Jimmy qué protección se pierde, y Jimmy lo pidió igual. **Es
una decisión de negocio del cliente, informada.**

**Lo que queda como control es lo que se registra:**

- quién pidió la anulación, quién la autorizó y **por qué vía**;
- el motivo;
- cada intento fallido, con su asiento;
- con TOTP, el código dictado sirve **una sola vez** y como mucho unos 90
  segundos.

Nada de eso **impide** el fraude de arriba: solo deja rastro para encontrarlo
después.

## 3. Qué cambia

1. **La superficie `anulacion_de_venta` acepta el código de la app.** Además del
   PIN de cuatro dígitos de un administrador presente, acepta el código de seis
   dígitos de su app, dictado a distancia. Qué se tecleó lo decide el largo, igual
   que en las demás superficies (§4.47): cuatro dígitos son el PIN
   (`presencial`) y seis son el código (`remoto`).
2. **La pantalla de anulación acepta los dos largos en el paso de
   autorización.** Es lo mismo que ya hacen el cobro (descuento excedente), el
   cierre con diferencia y la salida controlada. El texto dice que sirve el PIN en
   persona o el código dictado por teléfono.
3. **La base, local y en la nube, deja de rechazar `autorizada_via = 'remoto'`.**
4. **El resumen de ventas cuenta las anulaciones autorizadas a distancia en el
   período** (agregado por Julio al aprobar el plan). Es la versión chica de la
   pregunta 2: un número, visible aunque el período no tenga ventas completadas.
   Si la única venta del día se anuló a distancia, ese es justo el caso que Jimmy
   tiene que ver. Cuenta por la fecha de la anulación, en hora de Guatemala, con
   el mismo período que el resto del reporte. Lo ve solo el rol administrativo,
   como todo reporte (§4.15).

## 4. Lo que NO cambia

- **Cómo se registra la vía.** La decide la verificación, nunca quien pide: el
  pedido no trae ningún campo de vía. Queda en la fila
  (`anulaciones_de_venta.autorizada_via`) y en el asiento `venta_anulada`
  (`valor_nuevo.autorizadaVia`), con el mismo código de hoy. Lo único nuevo es que
  el valor `'remoto'` se vuelve alcanzable.
- **Las anulaciones ya registradas no se tocan.** Todas dicen `'presencial'`,
  porque la base no admitía otra cosa, y lo siguen diciendo. Ninguna migración
  reescribe filas.
- **El orden del flujo.** Primero van las validaciones: caja abierta, venta sin
  anular, voucher, unidad, contadores y motivo. Recién después se evalúa el código.
  Un código tecleado para una venta que no se puede anular no consume nada.
- **El candado propio de la superficie:** 3 intentos y 30 segundos,
  independiente de las otras superficies y del ingreso.
- **Cada rechazo deja su asiento** `anulacion_de_venta_rechazada`, con su código
  y nunca con lo tecleado.
- **El recibo y la impresión.** El PDF se regenera al confirmar la anulación, y
  anular no imprime nada.
- **Las otras superficies.** `cierre_de_caja_ajena` y
  `saltar_lote_de_sincronizacion` siguen sin aceptar el código: esta ampliación
  no se hereda, igual que las anteriores.
- **La sincronización.** No cambian el contrato, su versión (1), la foto
  `esquema-nube.json` ni la función `sincronizar_anulacion_de_venta`.

## 5. Consecuencias que hay que saber

1. **Un código equivocado ahora cuenta.** Un código de seis dígitos bien formado
   y equivocado cuenta como intento fallido (`PIN_INCORRECTO`) y deja su asiento.
   Hasta hoy, en esta superficie, seis dígitos eran `FORMATO_INVALIDO` y no
   contaban (§4.1: solo cuenta lo que es un PIN posible).
2. **Un código ya usado no autoriza otra anulación.** Para dos anulaciones
   seguidas por teléfono hay que esperar el código siguiente, hasta 30 segundos
   (TOTP de un solo uso, §4.47).
3. **Un código que coincide con dos administradores** se rechaza con
   `CODIGO_AMBIGUO`, sin consumir intento.
4. **Jimmy tiene que estar inscrito con su app en la terminal de la tienda**
   (§4.47). La inscripción exige su sesión, en persona. Sin ella, la vía remota
   no funciona y no pasa nada más.
5. **Restaurar desde la nube exige esta versión o una posterior.** Las versiones
   anteriores (1.3.1 incluida) tienen el CHECK de la 038, así que su restauración
   se detiene en `anulaciones_de_venta` si en la nube hay alguna anulación remota.
6. **Volver atrás no es simétrico.** Una vez que existe una anulación remota,
   volver a poner el CHECK falla: la 038 se niega sobre una base con una fila
   `'remoto'`, y está medido en `anulacion-solo-presencial.test.ts`. Estrechar de
   nuevo exigiría otro diseño, por ejemplo una restricción que valga solo para
   filas nuevas.

## 6. Criterios de aceptación

| # | Criterio | Cómo se verifica |
|---|---|---|
| CA-1 | **El código de la app autoriza.** Con la caja abierta, una venta en efectivo se anula con el código vigente de un administrador inscrito. La fila queda con `autorizada_via = 'remoto'` y con `autorizada_por` igual a ese administrador, y el asiento `venta_anulada` dice `autorizadaVia: 'remoto'`. | Vitest con base real; app real |
| CA-2 | **Con tarjeta también**, después de teclear el voucher correcto. | Vitest |
| CA-3 | **El PIN de cuatro dígitos no cambia:** autoriza en persona y deja `'presencial'` en la fila y en el asiento. Las pruebas del camino presencial pasan sin tocarlas. | Vitest; app real |
| CA-4 | **La vía la decide la verificación.** El pedido de anulación no tiene ningún campo de vía: la vía sale de lo tecleado. | Vitest (el flujo) y el esquema del canal |
| CA-5 | **Las anulaciones ya registradas no se tocan.** La 040 aplicada sobre una base con anulaciones `'presencial'` las deja idénticas. Lo mismo sobre una **copia** de la base de trabajo real, con el sha256 del original igual antes y después. | Vitest; corrida sobre la copia |
| CA-6 | **Un código equivocado** no anula nada, suma un intento al candado de `anulacion_de_venta` y deja `anulacion_de_venta_rechazada` con `codigo: 'PIN_INCORRECTO'`, sin lo tecleado. Al tercer intento, el candado bloquea 30 segundos. | Vitest |
| CA-7 | **Un código ya usado no sirve otra vez:** con el mismo código, una segunda anulación no se autoriza. *(Precisado al construir: el servicio responde `CODIGO_YA_USADO`, con su propio mensaje, y cuenta como intento.)* | Vitest y la app real |
| CA-8 | **Las validaciones siguen antes que el código.** Con la caja de la venta cerrada, un código correcto no consume ni un intento ni el paso del código, y la respuesta es `CAJA_DE_LA_VENTA_CERRADA`. | Vitest |
| CA-9 | **La pantalla acepta los dos largos.** En el paso de autorización, el teclado confirma con 4 o con 6 dígitos, y el texto dice que sirve el PIN en persona o el código dictado por teléfono. Si la vía fue remota, la confirmación dice «A distancia». A 1024×768 el paso entra entero en la pantalla. | Vitest (jsdom); app real a 1024×768 |
| CA-10 | **La base local acepta `'remoto'` después de la 040.** La restricción `anulaciones_de_venta_solo_presencial` ya no está en el esquema. El CHECK de la columna sigue y rechaza cualquier otra vía, y `NOT NULL` sigue. | Vitest sobre SQLite real |
| CA-11 | **La base y `ACEPTA_PIN_REMOTO` siguen diciendo lo mismo.** La prueba de acoplamiento de la 038 se conserva y ahora exige que las dos digan que sí. | Vitest |
| CA-12 | **El espejo `0040` es exacto y no cambia el contrato.** Quita la misma restricción con la misma sentencia, y ninguna de las dos migraciones toca el CHECK de la columna. La foto `esquema-nube.json` no cambia, la mitad A de la deriva pasa sin tocarla y la salida de `contrato_de_sincronizacion()` tiene el mismo md5 antes y después. | Vitest; ensayo en un Postgres 17 local |
| CA-13 | **La 0040 no afecta a la 1.3.1, y el orden importa.** Se mide en un Postgres 17 local con la terminal real subiendo. Con la 0040 aplicada, un lote de anulación `'presencial'` sube igual que antes. Sin la 0040, un lote `'remoto'` se rechaza con `23514` y la cola se detiene. Aplicada la 0040, «Reintentar» lo sube. | Ensayo local, con la salida cruda |
| CA-14 | **Las otras superficies no cambian.** `cierre_de_caja_ajena` y `saltar_lote_de_sincronizacion` siguen rechazando el código, y las tres que lo aceptaban lo siguen aceptando. | Vitest (la tabla y el comportamiento) |
| CA-15 | **En la aplicación real, a 1024×768:** una anulación a distancia hecha con clics, primero con un código equivocado y después con el bueno, deja la fila y el asiento en `'remoto'`. El camino presencial de siempre sigue intacto. | Arnés `verify:pantallas:anulacion` |
| CA-16 | **Documentado sin borrar la historia.** CLAUDE.md, el diseño y los comentarios del código dicen que esto revierte una decisión de seguridad a pedido del cliente, con la razón original tachada, no borrada. | Lectura |
| CA-17 | **Todo pasa, y las pruebas muerden.** `npm run verify` pasa, y cada falsificación del plan (§4.3) hace fallar lo que tiene que fallar. | Vitest; mutaciones con sha256 |
| CA-18 | **El contador del resumen de ventas.** Cuenta solo las anulaciones con `autorizada_via = 'remoto'` cuya fecha cae en el período (hora de Guatemala), no las presenciales. Se ve también cuando el período no tiene ventas completadas. | Vitest (servicio y pantalla); app real |

## 7. Fuera de alcance

- **Mostrar la vía** en el historial de recibos o en la copia de la tienda.
  Julio eligió el contador del resumen (§3.4).
- **Un reporte de anulaciones por persona o por vía** (diseño, decisión 11).
  El contador es un número, no ese reporte.
- **Aplicar la `0040` en cualquier nube, incluido el descartable.** Lo pidió
  Julio así al aprobar. Aplicarla es un paso aparte, proyecto por proyecto
  (plan §6).
- **Publicar un instalador.**
- **Windows**, como siempre.

## 8. Preguntas para Julio

> **CONTESTADAS EL 2026-09-19, al aprobar el plan:**
>
> - **La 1 está aprobada.**
> - **La 2 se resolvió con el contador** de anulaciones remotas en el resumen de
>   ventas (§3.4, CA-18), no con una marca en el historial.
> - **La 4 es no:** ninguna nube se toca en esta spec, tampoco el descartable.
>   La evidencia de CA-13 queda del ensayo en un Postgres local.
> - **La 3 sigue abierta:** ¿Jimmy ya está inscrito?

1. **La decisión del plan (§1).** Sí hace falta migración, local (`040`) y en la
   nube (`0040`). La de la nube es una relajación pura: se puede aplicar antes y
   no obliga a actualizar la tienda el mismo día. La única regla es que la `0040`
   esté en la nube antes de instalar la versión nueva. ¿La aprobás?
2. **¿Mostrar «a distancia» en el historial de recibos y en la copia de la
   tienda?** Hoy la vía solo se ve en la pantalla de confirmación, en el momento,
   y en `auditoria_log`. Si lo único que queda contra el fraude es revisar
   después, esa revisión tiene que poder hacerse sin leer la base. Recomiendo que
   sí, como un cambio aparte y chico. No está en el alcance si no lo aprobás.
3. **¿Jimmy ya está inscrito con su app en la terminal de la tienda?** Si no, la
   vía remota no funciona hasta que se inscriba, en persona (§5.4).
4. **¿Se pueden escribir filas de prueba en `pos-pruebas-descartable`?** Serían
   una venta, su anulación remota y sus asientos, para probar la subida contra
   Supabase de verdad y no solo contra un Postgres local. Los asientos y la
   anulación son inmutables y solo se van con un `TRUNCATE`. Si preferís que no,
   la evidencia de CA-13 queda del ensayo local.

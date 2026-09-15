/**
 * proyectos-de-prueba.cjs — El SEGURO del modo destructivo de `verify:nube`.
 *
 * `npm run verify:nube -- --destructivo` escribe filas de mentira en las
 * tablas de un proyecto de Supabase y, si tiene la `service_role`, las vacía
 * antes de empezar. Eso no puede correr JAMÁS contra `pos-jimmy-cano`, que es
 * el proyecto real de la tienda. Este archivo es lo único que decide contra
 * qué proyectos sí puede correr, y lo decide con una LISTA FIJA escrita acá,
 * no con una variable de entorno ni con un argumento: cambiarla exige un
 * commit que alguien va a leer.
 *
 * Tres cosas que el seguro comprueba, en este orden:
 *
 *   1. Que la lista NO contenga la referencia del proyecto real. Si alguien la
 *      agregara, el seguro se niega a correr con CUALQUIER proyecto, incluso
 *      con uno de prueba legítimo: una lista envenenada no se usa.
 *   2. Que la referencia pedida no sea la del proyecto real, y que esté en la
 *      lista.
 *   3. Que la URL corresponda a esa referencia. Sin esto, alguien podría
 *      declarar la referencia de prueba y apuntar la URL al proyecto real.
 *
 * Vive en su propio archivo, y no dentro del guion, para que la prueba
 * automatizada (`verificacion-de-nube.test.ts`) ejercite EXACTAMENTE la misma
 * función que el guion usa, y no una copia.
 *
 * CommonJS a propósito: el guion es un `.cjs` que corre con `node` pelado,
 * sin build, y las pruebas lo cargan con `createRequire`.
 */

'use strict';

/**
 * Las referencias de los proyectos DESCARTABLES. Solo contra estos puede
 * correr el modo destructivo. Hoy hay uno: `pos-pruebas-descartable`, creado
 * el 2026-09-11 para las fases 2.a y 2.b de la sincronización.
 */
const PROYECTOS_DE_PRUEBA = Object.freeze(['ztidrshifrblhfraiowg']);

/**
 * La referencia de `pos-jimmy-cano`, el proyecto REAL de la tienda. Está
 * escrita acá para poder negarla por nombre: no alcanza con que no esté en la
 * lista, tiene que estar prohibida de forma explícita.
 */
const PROYECTO_REAL = 'zgsdaelmbxufgcsideep';

/** Forma de una referencia de proyecto de Supabase: veinte letras minúsculas. */
const FORMA_DE_REFERENCIA = /^[a-z]{20}$/;

/** Error con nombre propio, para que el guion lo distinga de un fallo de red. */
class ProyectoNoAdmitido extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ProyectoNoAdmitido';
  }
}

/**
 * Deja pasar solo un proyecto de prueba, o lanza `ProyectoNoAdmitido`.
 *
 * `lista` se puede inyectar ÚNICAMENTE para que las pruebas demuestren que una
 * lista envenenada también se rechaza. El guion no la pasa nunca.
 */
function exigirProyectoDePrueba(referencia, url, lista = PROYECTOS_DE_PRUEBA) {
  if (lista.includes(PROYECTO_REAL)) {
    throw new ProyectoNoAdmitido(
      `La lista de proyectos de prueba contiene la referencia del proyecto REAL (${PROYECTO_REAL}). ` +
        'El seguro se niega a correr con esa lista contra cualquier proyecto.',
    );
  }
  if (referencia === PROYECTO_REAL) {
    throw new ProyectoNoAdmitido(
      `${referencia} es pos-jimmy-cano, el proyecto REAL. El modo destructivo no corre contra él, nunca.`,
    );
  }
  if (typeof referencia !== 'string' || !FORMA_DE_REFERENCIA.test(referencia)) {
    throw new ProyectoNoAdmitido(
      `"${String(referencia)}" no tiene forma de referencia de proyecto (veinte letras minúsculas).`,
    );
  }
  if (!lista.includes(referencia)) {
    throw new ProyectoNoAdmitido(
      `${referencia} no está en la lista fija de proyectos de prueba (${lista.join(', ')}). ` +
        'Agregarla es un cambio de código, no de configuración.',
    );
  }
  let host;
  try {
    host = new URL(url).host;
  } catch {
    throw new ProyectoNoAdmitido(`La URL "${String(url)}" no es una URL válida.`);
  }
  if (host !== `${referencia}.supabase.co`) {
    throw new ProyectoNoAdmitido(
      `La URL ${url} no corresponde a la referencia ${referencia}: el seguro compara las dos.`,
    );
  }
  return referencia;
}

// Se comprueba también al cargar el módulo, antes de que nadie llame a nada:
// una lista envenenada no debe poder ni importarse sin ruido.
if (PROYECTOS_DE_PRUEBA.includes(PROYECTO_REAL)) {
  throw new Error(
    `proyectos-de-prueba.cjs: la lista fija contiene la referencia del proyecto real (${PROYECTO_REAL}).`,
  );
}

module.exports = { PROYECTOS_DE_PRUEBA, PROYECTO_REAL, ProyectoNoAdmitido, exigirProyectoDePrueba };

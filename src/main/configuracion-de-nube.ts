/**
 * A qué proyecto de Supabase apunta ESTA copia de la aplicación.
 *
 * ---------------------------------------------------------------------------
 * EL PROBLEMA QUE RESUELVE
 * ---------------------------------------------------------------------------
 * Hasta la fase de empaquetado, la configuración de la nube viajaba en
 * variables de entorno: `POS_NUBE_URL`, `POS_NUBE_LLAVE_PUBLICABLE` y
 * `POS_SYNC_PROVIDER`. Eso sirve en una máquina de desarrollo y **no sirve en
 * un `.exe` instalado**: nadie va a definir variables de entorno en la
 * computadora del mostrador, y el acceso directo que crea el instalador
 * tampoco puede hacerlo. Medido sobre el primer instalador (§4.37): la
 * aplicación empaquetada arrancaba sin nube, con las pantallas diciendo «sin
 * configurar», que era correcto pero dejaba la pregunta abierta.
 *
 * Este módulo es la respuesta: los tres valores se **incrustan al compilar** y
 * la aplicación instalada se conecta sola.
 *
 * ---------------------------------------------------------------------------
 * EL ENTORNO GANA, Y LO INCRUSTADO ES EL RESPALDO
 * ---------------------------------------------------------------------------
 * El orden no es caprichoso. Los arneses de verificación —`ensayo:restauracion`,
 * `verify:pantallas:restauracion`— lanzan la aplicación con sus propias
 * variables de entorno para apuntarla a donde ellos necesitan. Si lo incrustado
 * ganara, esos arneses seguirían diciendo que apuntan a un proyecto y la
 * aplicación estaría hablando con otro, **en silencio**: exactamente la
 * confusión entre el proyecto de pruebas y el real que ya costó una vuelta
 * (§4.37).
 *
 * Y es **todo o nada**, no una mezcla campo por campo: si el entorno define la
 * URL, los tres valores salen del entorno. Media configuración de un lado y
 * media del otro sería una tercera configuración que nadie escribió.
 *
 * ---------------------------------------------------------------------------
 * QUÉ SE INCRUSTA, Y QUÉ NO SE INCRUSTA NUNCA
 * ---------------------------------------------------------------------------
 * Se incrusta **a qué proyecto** conectarse. Los tres valores son públicos: la
 * URL identifica el proyecto y la llave publicable, sola, no puede nada,
 * porque RLS está activo y `anon` no tiene ninguna política (§1.2 del diseño).
 *
 * **NO se incrusta ninguna credencial de terminal, y no se va a incrustar.**
 * El correo y la contraseña del usuario de sincronización se teclean una vez
 * en «Conectar con la nube», y lo único que queda en el disco es el token de
 * refresco cifrado con `safeStorage` (§4.23). Poner una contraseña dentro del
 * `.exe` sería la misma clase de defecto que `verify:paquete` existe para
 * atrapar: cualquiera que abra el instalador la tendría.
 */

/**
 * Lo que la compilación incrusta. `electron.vite.config.ts` lo reemplaza por
 * un objeto literal —o por `null` si no hay nada que incrustar— antes de que
 * este archivo llegue al bundle.
 */
declare const __NUBE_INCRUSTADA__: NubeIncrustada | null | undefined;

interface NubeIncrustada {
  readonly url: string;
  readonly llavePublicable: string;
  readonly proveedor: string;
}

/** De dónde salió la configuración que la aplicación está usando. */
export type OrigenDeLaConfiguracion = 'entorno' | 'incrustada' | 'ninguna';

export interface ConfiguracionDeNube {
  /** Vacía si no hay proyecto configurado; el resto de la aplicación ya sabe leer eso. */
  readonly url: string;
  readonly llavePublicable: string;
  /** Lo que `leerConfiguracionAdaptadoresDelEntorno` espera: `'supabase'` o cualquier otra cosa. */
  readonly proveedor: string | undefined;
  readonly origen: OrigenDeLaConfiguracion;
}

/**
 * Lo incrustado, leído con cuidado.
 *
 * El `typeof` no es adorno: `npm test` corre con Vitest, que **no pasa por
 * electron-vite**, así que ahí el identificador no existe y una referencia
 * directa sería un `ReferenceError` que tiraría abajo media suite.
 */
function loIncrustado(): NubeIncrustada | null {
  if (typeof __NUBE_INCRUSTADA__ === 'undefined' || __NUBE_INCRUSTADA__ === null) {
    return null;
  }
  return __NUBE_INCRUSTADA__;
}

/**
 * La configuración vigente. `entorno` se inyecta para poder probar sin tocar
 * `process.env` de verdad.
 */
export function leerConfiguracionDeNube(
  entorno: Readonly<Record<string, string | undefined>> = process.env,
  incrustada: NubeIncrustada | null = loIncrustado(),
): ConfiguracionDeNube {
  const urlDelEntorno = entorno.POS_NUBE_URL ?? '';
  if (urlDelEntorno !== '') {
    return {
      url: urlDelEntorno,
      llavePublicable: entorno.POS_NUBE_LLAVE_PUBLICABLE ?? '',
      proveedor: entorno.POS_SYNC_PROVIDER,
      origen: 'entorno',
    };
  }

  if (incrustada !== null && incrustada.url !== '') {
    return {
      url: incrustada.url,
      llavePublicable: incrustada.llavePublicable,
      proveedor: incrustada.proveedor,
      origen: 'incrustada',
    };
  }

  return { url: '', llavePublicable: '', proveedor: entorno.POS_SYNC_PROVIDER, origen: 'ninguna' };
}

/**
 * La REFERENCIA del proyecto, que es como se lo reconoce en el panel de
 * Supabase (`https://abcd….supabase.co` → `abcd…`). Cadena vacía si no hay
 * proyecto o si la URL no tiene esa forma.
 */
export function referenciaDelProyecto(url: string): string {
  if (url === '') {
    return '';
  }
  try {
    return new URL(url).hostname.split('.')[0] ?? '';
  } catch {
    return '';
  }
}

/** Una línea para la bitácora técnica: a qué apunta esta copia, y por qué. */
export function describirConfiguracionDeNube(configuracion: ConfiguracionDeNube): string {
  if (configuracion.origen === 'ninguna') {
    return 'sin proyecto de nube configurado: la sincronización y la restauración van a decir «sin configurar»';
  }
  const comoLlego = configuracion.origen === 'entorno' ? 'por variables de entorno' : 'incrustado al compilar';
  const proveedor = configuracion.proveedor === 'supabase' ? 'SupabaseSyncProvider' : 'el proveedor SIMULADO';
  return `proyecto de nube ${referenciaDelProyecto(configuracion.url)} (${comoLlego}); el trabajador va a usar ${proveedor}`;
}

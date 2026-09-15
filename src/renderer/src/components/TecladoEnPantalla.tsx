/**
 * Teclado alfanumérico en pantalla, para los formularios.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE
 * ---------------------------------------------------------------------------
 * Jimmy lo encontró en el equipo real: en la pantalla táctil de la tienda NO
 * aparece ningún teclado al tocar el nombre de un producto o de una categoría,
 * y el mostrador no tiene teclado físico. El teclado NUMÉRICO ya existía
 * (`TecladoNumerico`, para PIN y cantidades), pero sirve para confirmar un
 * número y nada más; los formularios necesitan escribir texto. Es la misma
 * regla que ya justificaba el numérico: la caja es táctil y nunca puede
 * depender de un teclado físico.
 *
 * ---------------------------------------------------------------------------
 * CÓMO FUNCIONA
 * ---------------------------------------------------------------------------
 * UN SOLO teclado para toda la aplicación, montado por `ProveedorDeTeclado`
 * en el cascarón y anclado abajo, encima de la barra de estado. Cada campo que
 * lo usa es un `CampoDeTexto`: al tocarlo, el teclado se abre ligado a ESE
 * campo, y cada tecla le llama a su `alCambiar` como si se hubiera escrito. Un
 * teclado por campo haría que dos quedaran abiertos a la vez en un formulario
 * largo.
 *
 * El campo lleva `inputMode="none"` para que Windows no abra ADEMÁS su propio
 * teclado táctil encima del nuestro. Un teclado físico, si lo hay, sigue
 * funcionando igual: el `onChange` del campo no cambió.
 *
 * Qué texto queda después de cada tecla lo decide `teclado/teclas.ts`, que es
 * puro y tiene sus pruebas.
 *
 * ---------------------------------------------------------------------------
 * ESTE MÓDULO ES LA ÚNICA PUERTA PARA PEDIR TEXTO (2026-09-15)
 * ---------------------------------------------------------------------------
 * El diálogo de salida controlada nació con un `<input>` nativo antes de que
 * existiera cualquier teclado en pantalla, y nunca se migró. En la pantalla
 * táctil de la tienda eso lo dejaba inutilizable, y la auditoría encontró
 * veintiún campos más en la misma situación. Ahora ningún archivo del renderer
 * puede dibujar un `<input>`, un `<textarea>` ni un `contentEditable` por su
 * cuenta: la prueba `todo-campo-usa-el-teclado.test.ts` falla nombrando el
 * archivo y la línea. Los únicos que se admiten fuera de acá son los radio y
 * los checkbox, que se tocan y no reciben texto.
 *
 * Tres formas, según lo que se pide:
 *
 *   · `CampoDeTexto` — texto, decimal o entero, con el teclado de abajo. Con
 *     `oculto` enmascara lo escrito (contraseñas y PIN de un formulario).
 *   · `CampoDeFecha` — una fecha, o fecha y hora. Tocar el campo en cualquier
 *     parte abre el calendario: sin eso, Chromium solo lo abre tocando el
 *     iconito, y el resto del campo espera un teclado físico.
 *   · Para un PIN que se confirma solo (ingreso, autorizaciones, salida) se
 *     sigue usando `TecladoNumerico`, que dibuja sus propias teclas y no
 *     tiene ningún `<input>`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

import {
  FILAS_DE_TEXTO,
  FILAS_DE_SIMBOLOS,
  FILAS_NUMERICAS,
  aplicarTecla,
  conMayuscula,
  type DisposicionDeTeclado,
  type Tecla,
} from '../teclado/teclas';

/** El campo al que está ligado el teclado ahora mismo. */
interface CampoActivo {
  readonly id: string;
  readonly disposicion: DisposicionDeTeclado;
  readonly etiqueta: string;
  readonly largoMaximo: number | undefined;
  readonly valor: string;
  /** Contraseña o PIN: la vista del teclado muestra puntos, nunca el texto. */
  readonly oculto: boolean;
  /** ¿La primera letra sale en mayúscula? Sí para nombres; no para un correo. */
  readonly mayusculaInicial: boolean;
}

/** Lo que un campo le pide al teclado. */
interface ControlDelTeclado {
  readonly abrir: (
    campo: CampoActivo,
    alCambiar: (valor: string) => void,
  ) => void;
  readonly actualizar: (id: string, valor: string, alCambiar: (valor: string) => void) => void;
  readonly cerrar: (id: string) => void;
  /** Cierra el teclado, esté ligado al campo que esté. Ver `useCerrarTecladoEnPantalla`. */
  readonly cerrarCualquiera: () => void;
}

const ContextoDelTeclado = createContext<ControlDelTeclado | null>(null);

export function ProveedorDeTeclado({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [activo, setActivo] = useState<CampoActivo | null>(null);
  const [mayusculas, setMayusculas] = useState(false);
  /** Capa de símbolos de la disposición de texto (ver `FILAS_DE_SIMBOLOS`). */
  const [simbolos, setSimbolos] = useState(false);

  /*
    `alCambiar` vive en una REFERENCIA y no en el estado, y no es un detalle:
    cada vez que el formulario se dibuja, su `alCambiar` es una función nueva.
    Si viviera en el estado, el campo lo actualizaría, el proveedor se volvería
    a dibujar, el formulario también, y así en bucle.
  */
  const alCambiarDelActivo = useRef<((valor: string) => void) | null>(null);

  const abrir = useCallback<ControlDelTeclado['abrir']>((campo, alCambiar) => {
    alCambiarDelActivo.current = alCambiar;
    setActivo(campo);
    // Un nombre empieza con mayúscula; el resto del texto no. Un correo o una
    // contraseña, tampoco: una mayúscula que nadie pidió cambia lo que valen.
    setMayusculas(
      campo.disposicion === 'texto' && campo.mayusculaInicial && campo.valor.length === 0,
    );
    setSimbolos(false);
  }, []);

  const actualizar = useCallback<ControlDelTeclado['actualizar']>((id, valor, alCambiar) => {
    setActivo((anterior) => {
      if (anterior?.id !== id) {
        return anterior;
      }
      alCambiarDelActivo.current = alCambiar;
      // Devolver el MISMO objeto cuando nada cambió hace que React no vuelva a
      // dibujar: es lo que corta el bucle descrito arriba.
      return anterior.valor === valor ? anterior : { ...anterior, valor };
    });
  }, []);

  const cerrar = useCallback<ControlDelTeclado['cerrar']>((id) => {
    setActivo((anterior) => {
      if (anterior?.id !== id) {
        return anterior;
      }
      alCambiarDelActivo.current = null;
      return null;
    });
  }, []);

  /*
    TOCAR FUERA LO CIERRA. Sin esto, después de escribir un precio el teclado
    seguiría tapando la mitad inferior del formulario —justo donde está
    «Guardar»— hasta que alguien encontrara «Listo». Se ignoran los toques
    sobre el propio teclado y sobre cualquier campo que lo use: pasar de un
    campo a otro no tiene que cerrarlo y volver a abrirlo.

    SE ESCUCHA `click` Y NO `pointerdown`, y no es un detalle: la primera
    versión cerraba en `pointerdown`, eso quitaba el espacio reservado al pie
    ANTES de que llegara el clic, el botón «Guardar» se movía debajo del dedo y
    el clic caía en otro lado. Lo encontró `verify:pantallas` manejando la
    aplicación real: el formulario de categorías no guardaba.
  */
  /*
    Y SE MIRA DÓNDE EMPEZÓ EL GESTO, NO SOLO DÓNDE TERMINÓ (2026-09-15). Lo
    encontró `verify:pantallas:teclado` con la ventana a 720 px de alto: tocar
    un campo de la franja baja abre el teclado en el `mousedown`, el teclado
    queda debajo del dedo, el `mouseup` cae sobre el teclado y el navegador
    manda el `click` al ANCESTRO COMÚN de los dos —`<main>`—, que no está
    dentro de ningún campo. El teclado se cerraba en el mismo toque que lo
    abría. Registrado, evento por evento:

      mousedown→restauracion-correo · focus→restauracion-correo ·
      mouseup→teclado-en-pantalla · click→MAIN

    Un toque en la pantalla táctil genera la misma secuencia. Por eso el
    comienzo del gesto se escucha SIEMPRE, también con el teclado cerrado: el
    toque que lo abre empieza cuando todavía no hay nada abierto.
  */
  const gestoEmpezoEnElTeclado = useRef(false);
  useEffect(() => {
    const alEmpezarGesto = (evento: Event): void => {
      const destino = evento.target;
      gestoEmpezoEnElTeclado.current =
        destino instanceof Element && destino.closest('[data-teclado-en-pantalla]') !== null;
    };
    document.addEventListener('pointerdown', alEmpezarGesto, true);
    document.addEventListener('mousedown', alEmpezarGesto, true);
    return (): void => {
      document.removeEventListener('pointerdown', alEmpezarGesto, true);
      document.removeEventListener('mousedown', alEmpezarGesto, true);
    };
  }, []);

  const hayActivo = activo !== null;
  useEffect(() => {
    if (!hayActivo) {
      return undefined;
    }
    const alTocar = (evento: MouseEvent): void => {
      const destino = evento.target;
      if (destino instanceof Element && destino.closest('[data-teclado-en-pantalla]') !== null) {
        return;
      }
      if (gestoEmpezoEnElTeclado.current) {
        return;
      }
      alCambiarDelActivo.current = null;
      setActivo(null);
    };
    document.addEventListener('click', alTocar, true);
    return (): void => {
      document.removeEventListener('click', alTocar, true);
    };
  }, [hayActivo]);

  const cerrarCualquiera = useCallback<ControlDelTeclado['cerrarCualquiera']>(() => {
    alCambiarDelActivo.current = null;
    setActivo(null);
  }, []);

  const control = useMemo<ControlDelTeclado>(
    () => ({ abrir, actualizar, cerrar, cerrarCualquiera }),
    [abrir, actualizar, cerrar, cerrarCualquiera],
  );

  const pulsar = (tecla: Tecla): void => {
    if (activo === null) {
      return;
    }
    const nuevo = aplicarTecla(activo.valor, tecla, {
      disposicion: activo.disposicion,
      largoMaximo: activo.largoMaximo,
    });
    if (nuevo === activo.valor) {
      return;
    }
    setActivo({ ...activo, valor: nuevo });
    alCambiarDelActivo.current?.(nuevo);
    // Mayús vale para UNA letra, como en un teléfono: dejarla fija escribiría
    // «AZÚCAR» sin que nadie lo haya querido.
    if (tecla.tipo === 'caracter' && mayusculas) {
      setMayusculas(false);
    }
  };

  /**
   * Evita que tocar una tecla le quite el foco al campo. Sin esto, cada
   * pulsación haría perder el cursor del campo y un teclado físico conectado
   * dejaría de escribir ahí.
   */
  const noRobarFoco = (evento: React.MouseEvent): void => {
    evento.preventDefault();
  };

  return (
    <ContextoDelTeclado.Provider value={control}>
      {children}
      {/* Espacio al pie del contenido mientras el teclado está abierto: sin
          él, los últimos campos de un formulario largo quedarían siempre
          debajo del teclado, sin forma de desplazarlos a la vista. */}
      {activo !== null && <div className="teclado-en-pantalla__reserva" aria-hidden="true" />}

      {activo !== null && (
        <div
          className="teclado-en-pantalla"
          data-teclado-en-pantalla="teclado"
          data-prueba="teclado-en-pantalla"
          data-disposicion={activo.disposicion}
          role="group"
          aria-label={`Teclado en pantalla: ${activo.etiqueta}`}
        >
          <div className="teclado-en-pantalla__vista">
            <span className="teclado-en-pantalla__etiqueta">{activo.etiqueta}</span>
            {/* El campo puede quedar tapado por el propio teclado en un
                formulario largo: lo que se escribe se ve también acá. */}
            <span className="teclado-en-pantalla__valor" data-prueba="tp-vista">
              {activo.valor === ''
                ? ' '
                : activo.oculto
                  ? '•'.repeat(Array.from(activo.valor).length)
                  : activo.valor}
            </span>
          </div>

          <div className="teclado-en-pantalla__filas">
            {(activo.disposicion === 'texto'
              ? simbolos
                ? FILAS_DE_SIMBOLOS
                : FILAS_DE_TEXTO
              : FILAS_NUMERICAS
            ).map((fila) => (
              <div key={fila.join('')} className="teclado-en-pantalla__fila">
                {fila.map((caracter) => {
                  const escrito =
                    activo.disposicion === 'texto' ? conMayuscula(caracter, mayusculas) : caracter;
                  return (
                    <button
                      key={caracter}
                      type="button"
                      className="teclado-en-pantalla__tecla"
                      data-prueba={`tp-${caracter}`}
                      onMouseDown={noRobarFoco}
                      onClick={() => {
                        pulsar({ tipo: 'caracter', caracter: escrito });
                      }}
                    >
                      {escrito}
                    </button>
                  );
                })}
              </div>
            ))}

            <div className="teclado-en-pantalla__fila">
              {activo.disposicion === 'texto' ? (
                <>
                  <button
                    type="button"
                    className={
                      mayusculas
                        ? 'teclado-en-pantalla__tecla teclado-en-pantalla__tecla--activa'
                        : 'teclado-en-pantalla__tecla'
                    }
                    data-prueba="tp-mayus"
                    aria-pressed={mayusculas}
                    onMouseDown={noRobarFoco}
                    onClick={() => {
                      setMayusculas((anterior) => !anterior);
                    }}
                  >
                    Mayús
                  </button>
                  <button
                    type="button"
                    className={
                      simbolos
                        ? 'teclado-en-pantalla__tecla teclado-en-pantalla__tecla--activa'
                        : 'teclado-en-pantalla__tecla'
                    }
                    data-prueba="tp-simbolos"
                    aria-pressed={simbolos}
                    aria-label={simbolos ? 'Volver a las letras' : 'Mostrar símbolos'}
                    onMouseDown={noRobarFoco}
                    onClick={() => {
                      setSimbolos((anterior) => !anterior);
                    }}
                  >
                    {simbolos ? 'abc' : '#@'}
                  </button>
                  <button
                    type="button"
                    className="teclado-en-pantalla__tecla teclado-en-pantalla__tecla--espacio"
                    data-prueba="tp-espacio"
                    onMouseDown={noRobarFoco}
                    onClick={() => {
                      pulsar({ tipo: 'espacio' });
                    }}
                  >
                    Espacio
                  </button>
                </>
              ) : (
                <>
                  {activo.disposicion === 'decimal' ? (
                    <button
                      type="button"
                      className="teclado-en-pantalla__tecla"
                      data-prueba="tp-."
                      onMouseDown={noRobarFoco}
                      onClick={() => {
                        pulsar({ tipo: 'caracter', caracter: '.' });
                      }}
                    >
                      .
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="teclado-en-pantalla__tecla"
                    data-prueba="tp-0"
                    onMouseDown={noRobarFoco}
                    onClick={() => {
                      pulsar({ tipo: 'caracter', caracter: '0' });
                    }}
                  >
                    0
                  </button>
                </>
              )}
              <button
                type="button"
                className="teclado-en-pantalla__tecla"
                data-prueba="tp-borrar"
                aria-label="Borrar el último carácter"
                onMouseDown={noRobarFoco}
                onClick={() => {
                  pulsar({ tipo: 'borrar' });
                }}
              >
                ←
              </button>
              <button
                type="button"
                className="teclado-en-pantalla__tecla teclado-en-pantalla__tecla--listo"
                data-prueba="tp-listo"
                onMouseDown={noRobarFoco}
                onClick={() => {
                  cerrar(activo.id);
                }}
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </ContextoDelTeclado.Provider>
  );
}

export interface CampoDeTextoProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> {
  readonly valor: string;
  readonly alCambiar: (valor: string) => void;
  /** Qué teclado se abre. Por omisión, el de texto. */
  readonly disposicion?: DisposicionDeTeclado;
  /** Lo que el teclado muestra arriba, para saber qué se está escribiendo. */
  readonly etiqueta: string;
  /**
   * Contraseña o PIN: el campo es de tipo `password` y la vista del teclado
   * muestra puntos. Por omisión, `false`.
   */
  readonly oculto?: boolean;
  /**
   * ¿La primera letra sale en mayúscula? Por omisión sí, que es lo correcto
   * para un nombre. Un correo, una contraseña o un número de boleta, no.
   */
  readonly mayusculaInicial?: boolean;
}

/**
 * Un campo de texto que abre el teclado en pantalla al tocarlo.
 *
 * Fuera de un `ProveedorDeTeclado` —en una prueba que monta el formulario
 * suelto— es un campo común: no hay teclado que abrir y no falla.
 */
export function CampoDeTexto({
  valor,
  alCambiar,
  disposicion = 'texto',
  etiqueta,
  oculto = false,
  mayusculaInicial = true,
  maxLength,
  onFocus,
  ...resto
}: CampoDeTextoProps): React.JSX.Element {
  const teclado = useContext(ContextoDelTeclado);
  const id = useId();

  // Mantiene al teclado al día con lo que el campo tiene, incluso si cambió
  // por un teclado físico o porque el formulario lo reescribió.
  useEffect(() => {
    teclado?.actualizar(id, valor, alCambiar);
  });

  // Si el campo desaparece —se cerró el formulario—, el teclado se va con él.
  useEffect(
    () => (): void => {
      teclado?.cerrar(id);
    },
    [teclado, id],
  );

  const abrirTeclado = (campo: HTMLInputElement): void => {
    if (teclado === null) {
      return;
    }
    teclado.abrir(
      { id, disposicion, etiqueta, largoMaximo: maxLength, valor, oculto, mayusculaInicial },
      alCambiar,
    );
    // Que el campo quede a la vista y no debajo del teclado recién abierto.
    requestAnimationFrame(() => {
      campo.scrollIntoView({ block: 'center' });
    });
  };

  return (
    <input
      {...resto}
      data-teclado-en-pantalla="campo"
      type={oculto ? 'password' : 'text'}
      inputMode={teclado === null ? undefined : 'none'}
      value={valor}
      maxLength={maxLength}
      onChange={(evento) => {
        alCambiar(evento.target.value);
      }}
      onFocus={(evento) => {
        onFocus?.(evento);
        abrirTeclado(evento.currentTarget);
      }}
      // También al TOCARLO: si se cerró el teclado con «Listo», el campo
      // conserva el foco y tocarlo de nuevo no dispara otro `focus`.
      onClick={(evento) => {
        abrirTeclado(evento.currentTarget);
      }}
    />
  );
}

/**
 * Cierra el teclado en pantalla, esté ligado al campo que esté.
 *
 * Lo usa un diálogo que se abre SOLO, sin que nadie haya tocado fuera del
 * teclado: el de salida controlada aparece con el atajo o con Alt+F4 aunque
 * haya un formulario a medio escribir. Sin cerrarlo, el teclado —que va por
 * encima de todo modal— taparía las teclas del PIN, y un toque ahí escribiría
 * en el formulario de abajo.
 *
 * Fuera de un `ProveedorDeTeclado` devuelve una función que no hace nada.
 */
export function useCerrarTecladoEnPantalla(): () => void {
  const teclado = useContext(ContextoDelTeclado);
  return teclado?.cerrarCualquiera ?? cerrarNada;
}

function cerrarNada(): void {
  // Sin proveedor no hay teclado que cerrar.
}

export interface CampoDeFechaProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> {
  /** `AAAA-MM-DD`, o `AAAA-MM-DDTHH:MM` con `conHora`: lo que da el campo nativo. */
  readonly valor: string;
  readonly alCambiar: (valor: string) => void;
  /** Fecha y hora (`datetime-local`) en vez de solo fecha. */
  readonly conHora?: boolean;
}

/**
 * Un campo de fecha que abre el CALENDARIO al tocarlo en cualquier parte.
 *
 * El control nativo se conserva a propósito: elegir un día en un calendario es
 * lo correcto en una pantalla táctil, y escribir `2026-09-15` con un teclado
 * en pantalla sería peor. Lo que faltaba es que se abriera: Chromium solo lo
 * abre tocando el iconito del borde, y el resto del campo espera un teclado
 * físico. `showPicker()` lo abre desde cualquier toque.
 *
 * `inputMode="none"` por la misma razón que en `CampoDeTexto`: que Windows no
 * abra su teclado táctil encima del calendario. Un teclado físico sigue
 * escribiendo la fecha igual.
 */
export function CampoDeFecha({
  valor,
  alCambiar,
  conHora = false,
  onClick,
  ...resto
}: CampoDeFechaProps): React.JSX.Element {
  return (
    <input
      {...resto}
      data-campo-de-fecha="campo"
      type={conHora ? 'datetime-local' : 'date'}
      inputMode="none"
      value={valor}
      onChange={(evento) => {
        alCambiar(evento.target.value);
      }}
      onClick={(evento) => {
        onClick?.(evento);
        abrirCalendario(evento.currentTarget);
      }}
    />
  );
}

/**
 * Abre el calendario del campo, si el motor lo permite.
 *
 * `showPicker` lanza si el calendario ya está abierto o si el toque no cuenta
 * como gesto de una persona; en los dos casos no hay nada que hacer y el campo
 * sigue funcionando con el iconito. En jsdom ni siquiera existe.
 */
function abrirCalendario(campo: HTMLInputElement): void {
  if (typeof campo.showPicker !== 'function') {
    return;
  }
  try {
    campo.showPicker();
  } catch {
    // Ya abierto, o sin gesto de usuario: el campo sigue siendo usable.
  }
}

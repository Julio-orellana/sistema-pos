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
}

/** Lo que un campo le pide al teclado. */
interface ControlDelTeclado {
  readonly abrir: (
    campo: CampoActivo,
    alCambiar: (valor: string) => void,
  ) => void;
  readonly actualizar: (id: string, valor: string, alCambiar: (valor: string) => void) => void;
  readonly cerrar: (id: string) => void;
}

const ContextoDelTeclado = createContext<ControlDelTeclado | null>(null);

export function ProveedorDeTeclado({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [activo, setActivo] = useState<CampoActivo | null>(null);
  const [mayusculas, setMayusculas] = useState(false);

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
    // Un nombre empieza con mayúscula; el resto del texto no.
    setMayusculas(campo.disposicion === 'texto' && campo.valor.length === 0);
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
      alCambiarDelActivo.current = null;
      setActivo(null);
    };
    document.addEventListener('click', alTocar, true);
    return (): void => {
      document.removeEventListener('click', alTocar, true);
    };
  }, [hayActivo]);

  const control = useMemo<ControlDelTeclado>(
    () => ({ abrir, actualizar, cerrar }),
    [abrir, actualizar, cerrar],
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
              {activo.valor === '' ? ' ' : activo.valor}
            </span>
          </div>

          <div className="teclado-en-pantalla__filas">
            {(activo.disposicion === 'texto' ? FILAS_DE_TEXTO : FILAS_NUMERICAS).map((fila) => (
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
    teclado.abrir({ id, disposicion, etiqueta, largoMaximo: maxLength, valor }, alCambiar);
    // Que el campo quede a la vista y no debajo del teclado recién abierto.
    requestAnimationFrame(() => {
      campo.scrollIntoView({ block: 'center' });
    });
  };

  return (
    <input
      {...resto}
      data-teclado-en-pantalla="campo"
      type="text"
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

/**
 * Teclado numérico en pantalla.
 *
 * La caja es táctil y NUNCA debe depender de un teclado físico: si el teclado
 * se desconecta o se moja, el cajero tiene que poder seguir trabajando. Por eso
 * el PIN se ingresa siempre desde aquí.
 *
 * El PIN nunca se muestra en texto plano: cada dígito ingresado se representa
 * con un punto lleno, para que quien esté detrás del mostrador no lo lea.
 */

import { LARGO_DEL_PIN } from '@shared/pin';

/** Dígitos, en la disposición de un teclado telefónico. */
const FILAS_DE_DIGITOS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

export interface TecladoNumericoProps {
  /** Dígitos ingresados hasta ahora. */
  readonly valor: string;
  /** Se llama con el valor nuevo tras cada pulsación. */
  readonly alCambiar: (valor: string) => void;
  /** Se llama cuando el PIN llega al largo completo y se confirma. */
  readonly alConfirmar: () => void;
  /** Bloquea el teclado mientras se verifica. */
  readonly deshabilitado?: boolean;
}

export function TecladoNumerico({
  valor,
  alCambiar,
  alConfirmar,
  deshabilitado = false,
}: TecladoNumericoProps): React.JSX.Element {
  const completo = valor.length === LARGO_DEL_PIN;

  const agregar = (digito: string): void => {
    if (valor.length < LARGO_DEL_PIN) {
      alCambiar(valor + digito);
    }
  };

  const borrar = (): void => {
    alCambiar(valor.slice(0, -1));
  };

  return (
    <div className="teclado">
      {/* Retroalimentación visual: un punto por dígito, nunca el número. */}
      <div className="teclado__puntos" data-prueba="puntos-del-pin" aria-live="polite">
        {Array.from({ length: LARGO_DEL_PIN }, (_, indice) => (
          <span
            key={indice}
            className={indice < valor.length ? 'teclado__punto teclado__punto--lleno' : 'teclado__punto'}
          />
        ))}
      </div>
      <span className="visualmente-oculto" aria-live="polite">
        {`${String(valor.length)} de ${String(LARGO_DEL_PIN)} dígitos ingresados`}
      </span>

      <div className="teclado__grilla">
        {FILAS_DE_DIGITOS.flat().map((digito) => (
          <button
            key={digito}
            type="button"
            className="teclado__tecla"
            data-prueba={`tecla-${digito}`}
            onClick={() => { agregar(digito); }}
            disabled={deshabilitado || completo}
          >
            {digito}
          </button>
        ))}

        <button
          type="button"
          className="teclado__tecla teclado__tecla--secundaria"
          data-prueba="tecla-borrar"
          onClick={borrar}
          disabled={deshabilitado || valor.length === 0}
          aria-label="Borrar el último dígito"
        >
          ←
        </button>

        <button
          type="button"
          className="teclado__tecla"
          data-prueba="tecla-0"
          onClick={() => { agregar('0'); }}
          disabled={deshabilitado || completo}
        >
          0
        </button>

        <button
          type="button"
          className="teclado__tecla teclado__tecla--principal"
          data-prueba="tecla-confirmar"
          onClick={alConfirmar}
          disabled={deshabilitado || !completo}
          aria-label="Confirmar el PIN"
        >
          ✓
        </button>
      </div>
    </div>
  );
}

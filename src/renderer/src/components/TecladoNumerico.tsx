/**
 * Teclado numérico en pantalla.
 *
 * La caja es táctil y NUNCA debe depender de un teclado físico: si el teclado
 * se desconecta o se moja, el cajero tiene que poder seguir trabajando. Por eso
 * tanto el PIN como las cantidades del ticket se ingresan desde aquí.
 *
 * DOS MODOS, y la diferencia no es cosmética:
 *
 *   · `pin` (por omisión) — largo exacto y ENMASCARADO. El PIN nunca se
 *     muestra en texto plano: cada dígito es un punto lleno, para que quien
 *     esté detrás del mostrador no lo lea. Es el comportamiento original y no
 *     cambió: las cuatro pantallas que ya lo usaban no pasan ningún modo.
 *   · `cantidad` — el número SÍ se muestra, en grande. Ocultar una cantidad
 *     que el cliente está mirando pesar no protegería nada y haría imposible
 *     corregir un error de tecleo. Admite punto decimal según el producto.
 */

import { LARGO_DEL_PIN } from '@shared/pin';

/** Dígitos, en la disposición de un teclado telefónico. */
const FILAS_DE_DIGITOS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

/**
 * Tope de dígitos de una cantidad.
 *
 * No es una regla de negocio, es un freno a los errores de tecleo: nadie vende
 * diez millones de libras de maíz de una vez, y sin tope un dedo apoyado en el
 * 9 llena la línea de dígitos hasta desbordar la pantalla.
 */
const MAXIMO_DE_DIGITOS_DE_CANTIDAD = 9;

export interface TecladoNumericoProps {
  /** Lo ingresado hasta ahora. Dígitos en modo PIN; número en modo cantidad. */
  readonly valor: string;
  /** Se llama con el valor nuevo tras cada pulsación. */
  readonly alCambiar: (valor: string) => void;
  /** Se llama al confirmar, cuando el valor está completo. */
  readonly alConfirmar: () => void;
  /** Bloquea el teclado mientras se verifica. */
  readonly deshabilitado?: boolean;
  /** `pin` enmascara y exige largo exacto; `cantidad` muestra el número. */
  readonly modo?: 'pin' | 'cantidad';
  /**
   * Solo en modo cantidad: cuántos decimales admite.
   *
   * 3 para los productos por peso —el mismo límite que rige en todo el
   * sistema— y 0 para los que se venden por unidad, donde media docena de
   * huevos se pide como seis unidades, no como 0.5 docenas.
   */
  readonly decimales?: number;
  /** Texto bajo el número, en modo cantidad. Por ejemplo la unidad. */
  readonly leyenda?: string;
  /**
   * Solo en modo PIN: los largos que se pueden confirmar. Por omisión, solo el
   * del PIN (4). Un diálogo que acepta también el código de la app de
   * autenticación pasa `[4, 6]`, y la inscripción de ese código pasa `[6]`.
   * Las teclas se apagan al llegar al más largo.
   */
  readonly largos?: readonly number[];
  /**
   * Solo en modo cantidad: ¿se puede confirmar un cero?
   *
   * En el ticket no —una línea de cero libras no es una venta—, y por eso el
   * valor por omisión es `false`. Al CONTAR efectivo sí: una caja puede cerrar
   * sin billetes de Q200, y un cajón vacío es un conteo tan válido como otro.
   */
  readonly admiteCero?: boolean;
}

export function TecladoNumerico({
  valor,
  alCambiar,
  alConfirmar,
  deshabilitado = false,
  modo = 'pin',
  decimales = 0,
  leyenda,
  admiteCero = false,
  largos = [LARGO_DEL_PIN],
}: TecladoNumericoProps): React.JSX.Element {
  const esPin = modo === 'pin';
  const largoMaximo = Math.max(...largos);
  const largoMinimo = Math.min(...largos);
  // Un punto por dígito: tantos como el largo más corto, y crecen si se sigue
  // tecleando. Con [4, 6] el PIN normal se ve igual que siempre.
  const puntosVisibles = Math.min(largoMaximo, Math.max(largoMinimo, valor.length));
  const admitePunto = !esPin && decimales > 0;

  /** Cuántos decimales lleva escritos el valor actual. */
  const decimalesEscritos = (): number => {
    const punto = valor.indexOf('.');
    return punto === -1 ? 0 : valor.length - punto - 1;
  };

  /** En modo cantidad, ¿el valor representa algo mayor que cero? */
  const cantidadUtil = (): boolean => {
    if (valor === '' || valor === '.') {
      return false;
    }
    const numero = Number(valor);
    return Number.isFinite(numero) && (numero > 0 || (admiteCero && numero === 0));
  };

  const completo = esPin ? largos.includes(valor.length) : cantidadUtil();

  /**
   * ¿Se puede agregar un dígito más?
   *
   * Repite exactamente los dos frenos de `agregar`, para que una tecla nunca
   * se vea habilitada y no haga nada al tocarla: en una pantalla táctil eso se
   * lee como que el toque no se registró y lleva a golpearla más fuerte.
   */
  const hayEspacio = esPin
    ? valor.length < largoMaximo
    : valor.replace('.', '').length < MAXIMO_DE_DIGITOS_DE_CANTIDAD &&
      !(valor.includes('.') && decimalesEscritos() >= decimales);

  const agregar = (digito: string): void => {
    if (esPin) {
      if (valor.length < largoMaximo) {
        alCambiar(valor + digito);
      }
      return;
    }
    // Con punto puesto, no se admiten más decimales de los permitidos.
    if (valor.includes('.') && decimalesEscritos() >= decimales) {
      return;
    }
    if (valor.replace('.', '').length >= MAXIMO_DE_DIGITOS_DE_CANTIDAD) {
      return;
    }
    // Un cero a la izquierda solo, sin punto, se reemplaza: "05" no es nada.
    if (valor === '0') {
      alCambiar(digito);
      return;
    }
    alCambiar(valor + digito);
  };

  const agregarPunto = (): void => {
    if (!admitePunto || valor.includes('.')) {
      return;
    }
    // Tocar el punto sin haber escrito nada da "0.", que es lo que el cajero
    // espera al querer teclear medio kilo directamente.
    alCambiar(valor === '' ? '0.' : `${valor}.`);
  };

  const borrar = (): void => {
    alCambiar(valor.slice(0, -1));
  };

  return (
    <div className="teclado">
      {esPin ? (
        <>
          {/* Retroalimentación visual: un punto por dígito, nunca el número. */}
          <div className="teclado__puntos" data-prueba="puntos-del-pin" aria-live="polite">
            {Array.from({ length: puntosVisibles }, (_, indice) => (
              <span
                key={indice}
                className={
                  indice < valor.length ? 'teclado__punto teclado__punto--lleno' : 'teclado__punto'
                }
              />
            ))}
          </div>
          <span className="visualmente-oculto" aria-live="polite">
            {largos.length === 1
              ? `${String(valor.length)} de ${String(largoMaximo)} dígitos ingresados`
              : `${String(valor.length)} dígitos ingresados`}
          </span>
        </>
      ) : (
        <div className="teclado__cantidad" data-prueba="cantidad-ingresada" aria-live="polite">
          <span className="teclado__numero">{valor === '' ? '0' : valor}</span>
          {leyenda !== undefined && <span className="teclado__leyenda">{leyenda}</span>}
        </div>
      )}

      <div className="teclado__grilla">
        {FILAS_DE_DIGITOS.flat().map((digito) => (
          <button
            key={digito}
            type="button"
            className="teclado__tecla"
            data-prueba={`tecla-${digito}`}
            onClick={() => {
              agregar(digito);
            }}
            disabled={deshabilitado || !hayEspacio}
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
          onClick={() => {
            agregar('0');
          }}
          disabled={deshabilitado || !hayEspacio}
        >
          0
        </button>

        {/* La tecla del punto solo existe donde el decimal significa algo: en
            un producto por unidad no hay media unidad que teclear. */}
        {admitePunto ? (
          <button
            type="button"
            className="teclado__tecla"
            data-prueba="tecla-punto"
            onClick={agregarPunto}
            disabled={deshabilitado || valor.includes('.')}
            aria-label="Punto decimal"
          >
            .
          </button>
        ) : null}

        <button
          type="button"
          className="teclado__tecla teclado__tecla--principal"
          data-prueba="tecla-confirmar"
          onClick={alConfirmar}
          disabled={deshabilitado || !completo}
          aria-label={esPin ? 'Confirmar el PIN' : 'Confirmar la cantidad'}
        >
          ✓
        </button>
      </div>
    </div>
  );
}

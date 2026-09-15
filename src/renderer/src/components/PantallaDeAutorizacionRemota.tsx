/**
 * Autoservicio: inscribirse en la autorización remota por TOTP.
 *
 * Solo para un administrador ya autenticado, y solo sobre su propia cuenta: el
 * proceso principal toma el usuario de la sesión y nunca de la pantalla.
 *
 * EL FLUJO, y por qué tiene este orden:
 *
 *   1. Al abrir, el proceso principal genera un secreto y lo guarda EN MEMORIA.
 *      No se escribe nada todavía.
 *   2. La pantalla muestra el QR y el mismo secreto en texto, para quien no
 *      pueda escanear.
 *   3. La persona escribe el código de seis dígitos que muestra su aplicación.
 *      Solo si coincide, el proceso principal guarda el secreto, cifrado. Así
 *      queda probado que el teléfono lo cargó bien antes de reemplazar nada.
 *   4. Si el código no coincide, la inscripción se descarta entera: el secreto
 *      mostrado deja de servir y hay que empezar de nuevo.
 *
 * EL SECRETO SE VE UNA SOLA VEZ. La pantalla no lo guarda en ningún lado y lo
 * borra del estado al terminar, al descartar o al salir.
 */

import { useEffect, useState } from 'react';

import { LARGO_DEL_CODIGO_REMOTO } from '@shared/pin';
import type { InscripcionRemotaIpc, RespuestaIpc } from '@shared/types/ipc';
import { llamarAlProcesoPrincipal } from './llamar-al-proceso-principal';
import { TecladoNumerico } from './TecladoNumerico';

const MENSAJE_SIN_RESPUESTA =
  'El sistema no respondió. Volvé al menú y entrá de nuevo a «Autorización remota» para ver si quedó guardada.';

/** Los códigos con los que la inscripción mostrada ya no sirve y hay que pedir otra. */
const CODIGOS_QUE_DESCARTAN = new Set(['CODIGO_DE_INSCRIPCION_INCORRECTO', 'INSCRIPCION_NO_VIGENTE']);

function pedirInscripcion(): Promise<RespuestaIpc<InscripcionRemotaIpc>> {
  return llamarAlProcesoPrincipal(() => window.pos.sesion.iniciarAutorizacionRemota(), undefined, MENSAJE_SIN_RESPUESTA);
}

/** El secreto en grupos de cuatro, que es como se copia a mano sin perderse. */
function enGrupos(secreto: string): string {
  return secreto.replace(/(.{4})(?=.)/g, '$1 ');
}

/** El QR como SVG: un rectángulo por módulo oscuro, con el margen blanco que exige el estándar. */
function CodigoQr({ modulos }: { readonly modulos: readonly (readonly boolean[])[] }): React.JSX.Element {
  const margen = 4;
  const lado = modulos.length + margen * 2;
  return (
    <svg
      data-prueba="qr-de-inscripcion"
      role="img"
      aria-label="Código QR para cargar la cuenta en la aplicación de autenticación"
      viewBox={`0 0 ${String(lado)} ${String(lado)}`}
      width={280}
      height={280}
      shapeRendering="crispEdges"
    >
      <rect x={0} y={0} width={lado} height={lado} fill="#ffffff" />
      {modulos.flatMap((fila, y) =>
        fila.map((oscuro, x) =>
          oscuro ? (
            <rect key={`${String(x)}-${String(y)}`} x={x + margen} y={y + margen} width={1} height={1} fill="#000000" />
          ) : null,
        ),
      )}
    </svg>
  );
}

export function PantallaDeAutorizacionRemota({
  alVolver,
}: {
  readonly alVolver: () => void;
}): React.JSX.Element {
  const [inscripcion, setInscripcion] = useState<InscripcionRemotaIpc | null>(null);
  const [codigo, setCodigo] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [paso, setPaso] = useState<'cargando' | 'escanear' | 'descartada' | 'listo'>('cargando');
  const [trabajando, setTrabajando] = useState(false);

  /** Muestra la inscripción que devolvió el proceso principal, o por qué no hubo. */
  const mostrar = (respuesta: RespuestaIpc<InscripcionRemotaIpc>): void => {
    if (!respuesta.ok) {
      setMensaje(respuesta.error.mensaje);
      setPaso('descartada');
      return;
    }
    setMensaje(null);
    setInscripcion(respuesta.datos);
    setPaso('escanear');
  };

  const empezarDeNuevo = (): void => {
    setPaso('cargando');
    setInscripcion(null);
    setCodigo('');
    void pedirInscripcion().then(mostrar);
  };

  useEffect(() => {
    // Se pide UNA vez, al abrir la pantalla. Cada pedido genera un secreto
    // distinto y descarta el anterior.
    void (async (): Promise<void> => {
      mostrar(await pedirInscripcion());
    })();
    // Salir de la pantalla descarta la inscripción en el proceso principal:
    // un secreto mostrado y no confirmado no tiene que quedar vivo.
    return (): void => {
      void window.pos.sesion.cancelarAutorizacionRemota();
    };
  }, []);

  const confirmar = (): void => {
    setTrabajando(true);
    void (async (): Promise<void> => {
      const respuesta = await llamarAlProcesoPrincipal(
        () => window.pos.sesion.confirmarAutorizacionRemota(codigo),
        undefined,
        MENSAJE_SIN_RESPUESTA,
      );
      setTrabajando(false);
      setCodigo('');
      if (!respuesta.ok) {
        setMensaje(respuesta.error.mensaje);
        if (CODIGOS_QUE_DESCARTAN.has(respuesta.error.codigo)) {
          setInscripcion(null);
          setPaso('descartada');
        }
        return;
      }
      setMensaje(null);
      setInscripcion(null);
      setPaso('listo');
    })();
  };

  return (
    <div className="ingreso" data-prueba="pantalla-de-autorizacion-remota">
      <h1>Autorización remota</h1>

      <div className="advertencia" data-prueba="explicacion-autorizacion-remota">
        <p>
          Para autorizar sin estar en la tienda, se dicta por teléfono el código de seis
          dígitos que muestra una aplicación de autenticación (por ejemplo Google
          Authenticator o Microsoft Authenticator). El código cambia cada 30 segundos y
          sirve una sola vez: quien lo escuche no puede volver a usarlo.
        </p>
        <p>
          <strong>El QR y el texto de abajo solo se muestran ahora.</strong> Quien los vea
          puede generar tus códigos: que nadie más los fotografíe.
        </p>
      </div>

      {inscripcion?.reemplazaUnaAnterior === true && (
        <p className="alerta" data-prueba="reemplaza-inscripcion-anterior">
          Ya tenés una autorización remota. Si confirmás esta, la anterior deja de servir y
          tenés que borrar esa cuenta vieja de la aplicación.
        </p>
      )}

      {mensaje !== null && (
        <p className="alerta" data-prueba="mensaje-autorizacion-remota">
          {mensaje}
        </p>
      )}

      {paso === 'cargando' && <p className="configuracion__paso">Preparando…</p>}

      {paso === 'escanear' && inscripcion !== null && (
        <div className="configuracion__paso">
          <p>1. En la aplicación, agregá una cuenta escaneando este código.</p>
          <CodigoQr modulos={inscripcion.qr} />
          <p>Si no podés escanear, escribí esta clave (tipo «basada en tiempo»):</p>
          <p>
            <code data-prueba="secreto-de-inscripcion">{enGrupos(inscripcion.secreto)}</code>
          </p>
          <p>2. Escribí el código de {String(LARGO_DEL_CODIGO_REMOTO)} dígitos que muestra la aplicación.</p>
          <TecladoNumerico
            valor={codigo}
            alCambiar={setCodigo}
            alConfirmar={confirmar}
            deshabilitado={trabajando}
            largos={[LARGO_DEL_CODIGO_REMOTO]}
          />
        </div>
      )}

      {paso === 'descartada' && (
        <div className="configuracion__paso">
          <button type="button" data-prueba="empezar-de-nuevo" onClick={empezarDeNuevo}>
            Empezar de nuevo
          </button>
        </div>
      )}

      {paso === 'listo' && (
        <p className="configuracion__paso" data-prueba="autorizacion-remota-guardada">
          Listo. Desde ahora podés autorizar a distancia dictando el código de la aplicación.
        </p>
      )}

      <button type="button" className="boton--secundario" onClick={alVolver}>
        Volver
      </button>
    </div>
  );
}

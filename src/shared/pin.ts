/**
 * pin.ts — Reglas de formato del PIN.
 *
 * Está separado de auth.ts a propósito: auth.ts usa `node:crypto` y por eso
 * NO puede entrar al renderer, pero la interfaz sí necesita conocer el largo
 * del PIN para armar el teclado numérico y habilitar el botón. Aquí vive solo
 * lo que es seguro compartir con la pantalla: reglas puras, sin dependencias.
 */

/**
 * Un PIN son exactamente cuatro dígitos.
 *
 * Cuatro es lo que un cajero teclea rápido en una pantalla táctil con un
 * cliente enfrente. La defensa contra la fuerza bruta no es el largo del PIN
 * sino el bloqueo por intentos: tres fallos y el usuario queda bloqueado 30
 * segundos, lo que hace inviable recorrer los 10 000 valores posibles.
 */
export const LARGO_DEL_PIN = 4;

/** Un PIN válido son exactamente cuatro dígitos, sin espacios ni símbolos. */
const FORMATO_DEL_PIN = /^[0-9]{4}$/;

/**
 * ¿El texto tiene forma de PIN?
 *
 * Se comprueba ANTES de intentar verificar. La distinción importa para el
 * limitador de intentos: una entrada que ni siquiera es un PIN posible es un
 * error de tecleo, no un intento de adivinar, y no debe consumir intentos.
 */
export function tieneFormatoDePinValido(pin: string): boolean {
  return FORMATO_DEL_PIN.test(pin);
}

/** Deja solo los dígitos de un texto, recortado al largo del PIN. */
export function normalizarEntradaDePin(texto: string): string {
  return texto.replace(/[^0-9]/g, '').slice(0, LARGO_DEL_PIN);
}

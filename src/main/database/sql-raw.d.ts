/**
 * Permite importar archivos .sql como texto: `import sql from './x.sql?raw'`.
 * Vite los convierte en una constante de cadena al compilar, así que las
 * migraciones viajan dentro del bundle y no dependen de que exista una carpeta
 * de archivos junto al ejecutable instalado en la máquina de la tienda.
 */
declare module '*.sql?raw' {
  const contenido: string;
  export default contenido;
}

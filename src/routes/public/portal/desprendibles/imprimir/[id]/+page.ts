/**
 * Sin SSR, como el resto del portal: los datos se piden con el token que vive
 * en `localStorage`, que en el servidor no existe. Se declara aquí porque la
 * página rompe la cadena de layouts del portal y no conviene depender de la
 * herencia para algo que necesita.
 */
export const ssr = false;
export const prerender = false;

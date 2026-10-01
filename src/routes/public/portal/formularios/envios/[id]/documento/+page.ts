/**
 * Igual que el resto del portal: sin SSR.
 *
 * Se declara aquí y no se hereda porque esta página ROMPE la cadena de layouts
 * del portal (`+page@public.svelte`), y dejar la opción implícita sería confiar
 * en un detalle de resolución de SvelteKit para algo que la página necesita:
 * los datos se piden con el token que vive en `localStorage`, que en el
 * servidor no existe.
 */
export const ssr = false;
export const prerender = false;

// Esta sub-ruta se salta el layout del dashboard para ocupar el viewport
// entero, y sus gráficas de `chart.js` tocan `window` al montar. No funciona
// en SSR, así que la marcamos client-only.
export const ssr = false;
export const prerender = false;

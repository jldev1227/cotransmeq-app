// Esta sub-ruta monta el editor Univer (canvas + WebGL + window). No funciona
// en SSR. Marcamos la página entera como client-only para que Vite NO intente
// ejecutar el grafo de imports de Univer en el server.
export const ssr = false;
export const prerender = false;
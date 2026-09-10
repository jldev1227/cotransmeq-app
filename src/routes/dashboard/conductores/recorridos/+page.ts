// Esta ruta monta el editor Univer (canvas + WebGL + window). No funciona en
// SSR, así que es client-only: sin esto Vite intenta ejecutar el grafo de
// imports de Univer en el servidor y la ruta ni siquiera compila.
export const ssr = false;
export const prerender = false;

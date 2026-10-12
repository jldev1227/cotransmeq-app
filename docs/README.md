# Documentación técnica del frontend

Dashboard administrativo y portal del conductor de Cotransmeq (SvelteKit 2,
Svelte 5). Estos documentos describen el código tal como está; si algo no
coincide, manda el código y hay que corregir el documento.

## Por dónde empezar

| Si vas a… | Lee |
|---|---|
| Entender el proyecto | [arquitectura.md](./arquitectura.md) y [rutas-y-pantallas.md](./rutas-y-pantallas.md) |
| Crear una página nueva | [componentes-y-estilos.md](./componentes-y-estilos.md), [listados-y-filtros.md](./listados-y-filtros.md) y [autenticacion-y-permisos.md](./autenticacion-y-permisos.md) |
| Llamar a un endpoint | [cliente-api.md](./cliente-api.md) y la referencia del backend (`backend-cotransmeq/docs/api/`) |
| Mostrar cambios en vivo o avisos | [tiempo-real-y-notificaciones.md](./tiempo-real-y-notificaciones.md) |
| Tocar el portal del conductor | [portal-del-conductor.md](./portal-del-conductor.md) |
| Tocar una hoja tipo Excel | [canvas-univer.md](./canvas-univer.md) |
| Generar un PDF, imprimir o exportar | [documentos-y-pdf.md](./documentos-y-pdf.md) |
| Configurar un entorno o desplegar | [variables-de-entorno.md](./variables-de-entorno.md) y [despliegue.md](./despliegue.md) |
| Probar un cambio | [pruebas-y-calidad.md](./pruebas-y-calidad.md) |

## Documentos

**Estructura**

- [arquitectura.md](./arquitectura.md) — stack, carpetas, zonas de la app, layouts, hooks, service worker y rutas de servidor.
- [rutas-y-pantallas.md](./rutas-y-pantallas.md) — todas las páginas, con su módulo de permiso y la API que consumen.
- [autenticacion-y-permisos.md](./autenticacion-y-permisos.md) — login, token, guardia de rutas, sidebar por permisos, portal del conductor, app móvil y recuperación de contraseña.
- [cliente-api.md](./cliente-api.md) — cómo se llama al backend, errores, descargas y subidas; qué archivo de `src/lib/api/` va con qué módulo.

**Interfaz**

- [componentes-y-estilos.md](./componentes-y-estilos.md) — Tailwind, colores, regla de ancho y componentes compartidos.
- [listados-y-filtros.md](./listados-y-filtros.md) — filtros, paginación y búsqueda con la URL como fuente de verdad.
- [estado-y-stores.md](./estado-y-stores.md) — stores, persistencia y las trampas de runes.
- [tiempo-real-y-notificaciones.md](./tiempo-real-y-notificaciones.md) — Socket.IO, presencia, campana y Web Push.

**Áreas especiales**

- [portal-del-conductor.md](./portal-del-conductor.md) — offline primero: IndexedDB, outbox y reglas de UX.
- [canvas-univer.md](./canvas-univer.md) — las hojas de nómina, recorridos, cierres y liquidaciones.
- [documentos-y-pdf.md](./documentos-y-pdf.md) — PDF del servidor, impresión del navegador, pdfmake, Excel y QR.

**Operación**

- [variables-de-entorno.md](./variables-de-entorno.md) — públicas y privadas, estáticas y dinámicas.
- [pruebas-y-calidad.md](./pruebas-y-calidad.md) — `svelte-check`, lint, Vitest, Sentry y CI (este repo no tiene e2e).
- [despliegue.md](./despliegue.md) — imagen de Docker, Proxmox y comprobaciones.

**Por dominio** (anteriores, siguen vigentes)

- [formularios-dinamicos/](./formularios-dinamicos/README_ARQUITECTURA.md) — arquitectura, API y sockets, base de datos, modo offline, operación y seeds HSEQ.
- [pesv/](./pesv/README_DASHBOARD_FRONTEND.md) — dashboard y flujos del PESV.
- [sarlaft-declaracion-empresa-transporte/](./sarlaft-declaracion-empresa-transporte/README.md) — declaración SARLAFT de empresa de transporte.

Las convenciones de código y las trampas conocidas están en
[AGENTS.md](../AGENTS.md).

## Documentos sueltos de la raíz

La raíz tiene documentos de cambios puntuales (`README-*.md`, `README_*.md`,
`VERCEL_DEPLOY.md`, `DEPLOY_PROXMOX.md`…). Son históricos: sirven para
entender cómo se llegó a algo, pero pueden describir comportamiento que ya
cambió. Lo vigente está en esta carpeta.

## Mantener la documentación

- Un cambio de comportamiento lleva su cambio de documento en el mismo commit.
- Lo mismo en `ingreso-svelte`: los documentos son gemelos y cada uno anota
  sus diferencias al final.

# cotransmeq-app — Frontend de Cotransmeq

Dashboard administrativo y portal del conductor de Cotransmeq, en SvelteKit 2
con Svelte 5 (runes). Habla con la API de `backend-cotransmeq`.

El mismo producto corre para Transmeralda en el repo gemelo `ingreso-svelte`.
Todo cambio se aplica en los dos (ver [AGENTS.md](./AGENTS.md)).

## Arranque local

Requisitos: Node 22 (el de la imagen de Docker), el backend levantado y un
`.env` a partir de [.env.example](./.env.example) (las variables están
explicadas en [docs/variables-de-entorno.md](./docs/variables-de-entorno.md)).

```bash
npm install
npm run dev          # vite dev en http://localhost:5173 (5174 si el 5173 está ocupado)
```

El login del equipo está en `/login`; `/login?admin=1` entra aunque el
navegador tenga guardada la sesión del portal del conductor.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run check` | `svelte-check`; tiene que quedar en cero errores (el CI lo exige) |
| `npm run lint` / `npm run format` | Prettier + ESLint / formatear |
| `npm test` | Vitest |
| `npm run test:reconexion` | Pruebas de integración de reconexión de sockets |
| `npm run build` / `npm run preview` | Compilar y probar la versión compilada |

## Documentación

Empieza por [docs/README.md](./docs/README.md). Lo principal:

- [Arquitectura](./docs/arquitectura.md) y [rutas y pantallas](./docs/rutas-y-pantallas.md).
- [Autenticación y permisos](./docs/autenticacion-y-permisos.md) y [cliente de la API](./docs/cliente-api.md).
- [Componentes y estilos](./docs/componentes-y-estilos.md) y [listados y filtros](./docs/listados-y-filtros.md).
- [Estado y stores](./docs/estado-y-stores.md) y [tiempo real y notificaciones](./docs/tiempo-real-y-notificaciones.md).
- [Portal del conductor](./docs/portal-del-conductor.md), [canvas (Univer)](./docs/canvas-univer.md) y [documentos y PDF](./docs/documentos-y-pdf.md).
- [Variables de entorno](./docs/variables-de-entorno.md), [pruebas y calidad](./docs/pruebas-y-calidad.md) y [despliegue](./docs/despliegue.md).

La referencia de los endpoints que consume el front está en el backend:
`backend-cotransmeq/docs/api/`.

Las convenciones de código (runes, ancho de página, listados por URL, portal
offline) y las trampas conocidas están en [AGENTS.md](./AGENTS.md).

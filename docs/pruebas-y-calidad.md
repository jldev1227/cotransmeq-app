# Pruebas y calidad

Qué comprobaciones tiene el frontend y cómo se corren: tipos con
`svelte-check`, formato y lint (con el problema de Prettier propio de este
repo), pruebas unitarias con Vitest, la suite de reconexión, el rastreo de
errores con Sentry y lo que hace (y no hace) el job de CI. Este repo **no
tiene pruebas e2e**: ni Playwright ni carpeta `e2e/`. Léelo antes de dar un
cambio por terminado, antes de escribir una prueba y antes de tocar el
workflow.

## Resumen

| Comando | Qué hace | ¿Lo corre CI? |
|---|---|---|
| `npm run check` | `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json` | Sí, con `--threshold error` |
| `npm run lint` | `prettier --check . && eslint .` | No |
| `npm run format` | `prettier --write .` (falla en los `.svelte`, ver abajo) | No |
| `npm test` | `vitest run` con [vitest.config.ts](../vitest.config.ts) | No |
| `npm run test:watch` | `vitest` en modo observación | No |
| `npm run test:reconexion` | `vitest run --config vitest.integracion.config.ts` | No |

No hay `npm run test:e2e`: `package.json` no declara `@playwright/test` y no
existen `playwright.config.ts` ni `e2e/`.

Lo único que frena un despliegue es `svelte-check`. Vitest, Prettier y ESLint
son responsabilidad de quien cambia el código, antes de llevarlo a `main`. Y
todo cambio se aplica también en `ingreso-svelte`, así que las comprobaciones
se corren en los dos repos.

## Tipos: `svelte-check`

`svelte-check --threshold error` está en **cero errores** (11-oct-2026, según
[AGENTS.md](../AGENTS.md)) y tiene que seguir así: el job `verificar` lo corre
antes de desplegar y un error lo frena. `npm run check` muestra también los
avisos, que no bloquean.

`svelte-check` sobre todo el proyecto pide varios GB de memoria (en CI corre con
`NODE_OPTIONS=--max-old-space-size=6144`). Para mirar solo lo tuyo:

```bash
npx svelte-check --tsconfig ./tsconfig.json --threshold error --output machine 2>&1 | grep -i "<tu-archivo>"
```

## Formato y lint

**Prettier** ([.prettierrc](../.prettierrc), idéntico al del gemelo):
tabulaciones, comillas simples, sin coma final, ancho 100, con
`prettier-plugin-svelte` y `prettier-plugin-tailwindcss` (ordena las clases de
Tailwind; lee `src/app.css`). [.prettierignore](../.prettierignore) excluye los
lockfiles y `/static/`.

**Prettier falla en los `.svelte` de este repo.** El error que se ha visto es
`TypeError: getVisitorKeys is not a function or its return value is not iterable`
en cualquier componente, también en los que nadie ha tocado: no es del archivo
sino de las dependencias (no se volvió a ejecutar al escribir este documento).
Lo que dicen `package.json` y `package-lock.json` de cada repo:

| Paquete | Cotransmeq: declarado → instalado | Transmeralda: declarado → instalado |
|---|---|---|
| `prettier` | `^3.6.2` → 3.9.6 | `^3.8.3` → 3.9.6 |
| `prettier-plugin-svelte` | `^3.4.0` → 3.5.2 | `^3.5.2` → 3.5.2 |
| `prettier-plugin-tailwindcss` | `^0.6.14` → **0.6.14** | `^0.7.4` → **0.7.4** |

La única versión instalada que cambia entre los dos repos es la de
`prettier-plugin-tailwindcss`. El arreglo natural sería alinear las tres
declaraciones con las del gemelo; mientras tanto, la regla es: **formatea en
`ingreso-svelte` y copia el resultado aquí** (con `sed` para el nombre de la
marca), en vez de formatear en este repo. Si no, los dos repos divergen en el
orden de las clases de Tailwind, porque el plugin que las ordena solo corre en
uno. Ya se nota: `Header.svelte` tiene aquí
`whitespace-nowrap text-[12px] font-medium` donde el gemelo tiene
`text-[12px] font-medium whitespace-nowrap`, y muchos archivos difieren en los
saltos de línea.

No todo el repo está formateado (por ejemplo,
[realtimeCollab.ts](../src/lib/stores/realtimeCollab.ts) usa dos espacios y no
lleva `;`), así que `npm run lint` sobre el repo entero no sale limpio aunque
Prettier funcionara. Revisa solo lo que tocas.

Si `node_modules/.bin/prettier` da «Permission denied», invócalo por Node:
`node node_modules/prettier/bin/prettier.cjs --write <archivo>`.

**ESLint** ([eslint.config.js](../eslint.config.js), configuración plana e
idéntica a la del gemelo): ignora lo de `.gitignore` y aplica las recomendadas
de JavaScript, `typescript-eslint` y `eslint-plugin-svelte`, más las de
Prettier para no pelear con el formato. Desactiva `no-undef` (TypeScript ya lo
cubre) y analiza los `.svelte` y `.svelte.ts` con el servicio de proyecto de
TypeScript.

## Vitest

[vitest.config.ts](../vitest.config.ts) (idéntico al del gemelo) vive aparte de
`vite.config.ts` a propósito: el plugin de SvelteKit exige el runtime de
`$app/*` y un servidor de desarrollo, y lo que se prueba aquí son funciones
puras —builders de los canvas, adaptadores, la outbox, los listados— que
corren en Node.

| Ajuste | Valor | Por qué |
|---|---|---|
| `environment` | `node` | Sin DOM: no hay pruebas de componentes. |
| `include` | `tests/**/*.test.ts` | |
| `exclude` | `node_modules` y `tests/integracion/**` | La integración tarda y va aparte. |
| Alias | `$lib` a mano y `$app/environment` → [tests/dobles/app-environment.ts](../tests/dobles/app-environment.ts) | Sin el plugin nadie los resuelve. El doble fija `browser: true`, porque lo que se prueba solo hace algo en el navegador. |
| `setupFiles` | [tests/dobles/almacenamiento.ts](../tests/dobles/almacenamiento.ts) | `localStorage` en memoria: `portalStore` lo lee al importarse. |
| Pool | `threads`, un solo worker | Univer y ExcelJS son pesados de cargar; un worker por archivo cuesta más que la suite entera. |

Como no hay DOM ni WebGL, el motor de Univer no se instancia en las pruebas.
El criterio es extraer la aritmética a un módulo puro y probar eso (los
builders devuelven el snapshot del libro como objeto plano).

```bash
npm test                                         # toda la suite
npx vitest run tests/listing-filtros.test.ts     # un archivo
npm run test:watch                               # mientras escribes
```

Las 17 pruebas de `tests/` (más una de integración), por área:

| Área | Archivos |
|---|---|
| Tiempo real | `socket-listeners` (el alta y la baja de listeners funcionan), `socket-reconexion` (opciones y reacciones de `lib/socket.ts`, con socket.io doblado) |
| Listados | `listing-filtros`, `listing-store`, `listing-texto` |
| Portal y formularios | `outbox-cadena-envio`, `outbox-descartar-borrador`, `outbox-init-adjunto`, `outbox-recuperacion-validacion`, `fecha-diligenciamiento`, `formularios-etapas` |
| Canvas | `cell-change-nomina`, `nomina-conteo-estados`, `recorridos-canvas`, `recorridos-filas` |
| Liquidaciones | `trazabilidad-liquidacion` |
| Otros | `markdown-asistente` |

El gemelo tiene otras 17 que aquí no existen, aunque varias prueban módulos
que este repo también tiene: `autoguardado-liquidacion`, `canvas-cambio-hoja`,
`desprendible-planillas-sin-recargos`, `marcas-dias`, `mensajes-error-api`,
`migrar-borradores-locales`, `mis-formularios-filtros`, `nomina-builder`,
`recargos/historialCambios`, `recuperacion-token`, `reparto-cierre-envios`,
`reparto-propietarios`, `resumen-filtro`, `servicios-historial-builder`,
`servicios-historial-indices`, `totales-visibles` y `upsert-liquidacion`. Al
replicar un cambio en uno de esos módulos, la prueba que lo cubre está en
`ingreso-svelte`.

Para escribir una prueba: archivo `tests/<tema>.test.ts`, importa de `$lib/...`,
sin red ni base de datos. Si lo que quieres probar está dentro de un componente
o necesita Univer, sácalo antes a un módulo `.ts`.

### Suite de reconexión

[vitest.integracion.config.ts](../vitest.integracion.config.ts) corre
`tests/integracion/**`: levanta un servidor socket.io de verdad, importa
`lib/socket.ts` tal cual, **mata el servidor más de veinte segundos** y
comprueba que el cliente vuelve solo. Es lo que demuestra el arreglo de los
reintentos (la configuración anterior se rendía a los ~15 s) y lo que la hace
inaceptable en la suite de cada guardado. Los tests atan un puerto fijo, así
que van en serie (`fileParallelism: false`), con `testTimeout` de 90 s.

```bash
npm run test:reconexion
```

## Sin pruebas e2e

Este repo no tiene Playwright. Lo que en el gemelo cubren los e2e —que el
canvas del historial monta y sincroniza entre dos usuarios, que los filtros
de los listados sobreviven a recargar, la aplicación pública de evaluaciones
y el aspecto de los toasts— aquí solo se comprueba a mano en el navegador. El
código de esas pantallas es en su mayoría el mismo, así que los e2e de
`ingreso-svelte` (`e2e/`) dan una señal sobre él, pero corren contra el
entorno de Transmeralda, no contra este.

## Sentry

Opcional. Solo se activa con DSN, y el DSN se lee **en tiempo de ejecución**
(`$env/dynamic`), así que se enciende o se apaga sin recompilar la imagen: va
en el archivo de variables de runtime del frontend en el servidor (ver
[.env.example](../.env.example) y [despliegue.md](./despliegue.md)).

| | Navegador | Servidor (SSR y rutas `/api` de SvelteKit) |
|---|---|---|
| Archivo | [hooks.client.ts](../src/hooks.client.ts) | [hooks.server.ts](../src/hooks.server.ts) |
| DSN | `PUBLIC_SENTRY_DSN` | `SENTRY_DSN` |
| Entorno | `PUBLIC_SENTRY_ENVIRONMENT`, o `development`/`production` según `dev` | `SENTRY_ENVIRONMENT`, o `NODE_ENV`, o `production` |
| Sin DSN | El SDK ni se descarga: el `import` es dinámico | El SDK no se carga |

**Qué se reporta.** Los `handleError` de los dos hooks escriben siempre el error
en la consola o el log y lo mandan a Sentry solo si el estado es **500 o más**,
con la etiqueta `ruta` (id de la ruta o, si no hay, el `pathname`). El SDK
arranca con sus integraciones por defecto: el repo no añade ni quita ninguna y
no fija `tracesSampleRate`.

**Qué no se reporta.**

- Los 404 y demás 4xx: no son fallos de la aplicación.
- «Failed to fetch dynamically imported module» (`ignoreErrors`): son chunks
  viejos tras un despliegue, y `hooks.client.ts` ya los recupera recargando la
  página una vez por sesión.
- Ningún dato de la petición: `dataCollection` apaga usuario, cookies,
  cabeceras, cuerpos y query string. Llevan el token y datos personales
  (cédulas, salarios).
- Los errores que la aplicación atrapa y muestra al usuario (un `catch` con
  toast), incluidas casi todas las peticiones fallidas a la API.

## CI

[.github/workflows/deploy-proxmox.yml](../.github/workflows/deploy-proxmox.yml)
corre en cada push a `main` y a mano (`workflow_dispatch`), serializado por el
grupo de concurrencia `cotransmeq-app-production`.

| Job | Dónde | Qué hace |
|---|---|---|
| `verificar` | `ubuntu-latest`, 20 min | `npm ci` con Node 22, `npx svelte-kit sync` y `npx svelte-check --tsconfig ./tsconfig.json --threshold error`. Corre en un runner de GitHub y no en el del servidor para no competir por memoria con producción. |
| `deploy` | Runner propio `cotransmeq-ct123`, entorno `production`, 90 min | Solo si `verificar` pasa. Ejecuta `sudo /usr/local/sbin/deploy-cotransmeq-app "$GITHUB_SHA"`; las variables las pone el servidor, no el workflow. Detalle en [despliegue.md](./despliegue.md). |

No corre Vitest, Prettier ni ESLint.

## Antes de dar un cambio por terminado

1. `svelte-check` en cero errores en lo que tocaste, en los dos repos.
2. Las pruebas de Vitest del área (`npx vitest run tests/<archivo>.test.ts`),
   aquí y, si la prueba solo existe allí, en `ingreso-svelte`.
3. Formato: lo que toques se formatea en `ingreso-svelte` y se copia aquí. En
   los `.svelte` es obligatorio, porque aquí Prettier falla.
4. Si tocaste sockets o nombres de eventos: el test de contrato del backend
   (ver [tiempo-real-y-notificaciones.md](./tiempo-real-y-notificaciones.md#contrato-de-eventos-con-el-backend)).
5. Si tocaste un listado: compruébalo a mano (filtros en la URL, recargar,
   volver atrás); aquí no hay e2e que lo haga.
6. Aplica el mismo parche en `ingreso-svelte` y compáralo con `diff`.

## Diferencias con Transmeralda

| | Cotransmeq | Transmeralda |
|---|---|---|
| Playwright | No tiene `@playwright/test`, `playwright.config.ts`, `e2e/` ni `npm run test:e2e` | Los cuatro, con cuatro specs |
| Vitest | 17 pruebas más la de reconexión (misma configuración) | 34 más la de reconexión |
| Prettier | Falla en los `.svelte`; plugin de Tailwind 0.6.14 | Funciona; plugin de Tailwind 0.7.4 |
| Servidor de desarrollo | 5173 (5174 si está ocupado; `vite.config.ts` no fija puerto) | Puerto fijo 5273 |
| CI | Runner `cotransmeq-ct123`, script `deploy-cotransmeq-app` sin variables | Runner `transmeralda-ct121`, script `deploy-ingreso-svelte` con archivos de variables armados desde `vars` y `secrets` |

`package.json` conserva el nombre heredado `"name": "ingreso-svelte"` y está
indentado con dos espacios; no tiene efecto en las pruebas.

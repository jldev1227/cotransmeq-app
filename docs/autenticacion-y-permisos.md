# Autenticación y permisos

Cómo entra cada tipo de usuario, dónde se guarda la sesión, qué protege cada
guardia, qué pasa cuando el backend responde 401, cómo se decide qué ve cada
quien (sidebar, menú, botones) y cómo funcionan el portal del conductor, el
enlace de la app móvil y la recuperación de contraseña. Léelo antes de tocar
el login, un guardia, el mapa de permisos o cualquier pantalla que muestre u
oculte acciones según el usuario. La otra mitad (cómo valida el backend el
token y aplica los permisos) está en `backend-cotransmeq/docs/autenticacion.md`,
`backend-cotransmeq/docs/middlewares.md` y `backend-cotransmeq/docs/permisos.md`.

**Regla de fondo:** todo lo que hace el frontend con la sesión y los permisos es
de presentación. El backend vuelve a comprobar el token y el permiso en cada
petición; el front solo evita mostrar lo que iba a devolver 401 o 403.

## Tres formas de entrar

| Quién | Cómo entra | Credencial | Dónde se usa |
|---|---|---|---|
| Equipo administrativo | `/login` con correo y contraseña | JWT del backend (30 días) | `/dashboard/**` |
| Conductor | Enlace mágico a su correo (`/public/portal?token=…`) | Token del portal | `/public/portal/**` y la app móvil |
| Administrativo en el teléfono | Enlace de 30 días generado en Mi perfil | Código que la app canjea por un JWT | App móvil (`cotransmeq://admin`) |

Además hay enlaces públicos con su propio token en la URL (asistencias,
evaluaciones, invitaciones, certificados, servicio compartido…) que no abren
ninguna sesión; ver [rutas-y-pantallas.md](./rutas-y-pantallas.md#páginas-públicas-sueltas).

## Login del dashboard

[login/+page.svelte](../src/routes/login/+page.svelte) llama a
`authStore.login()` de [auth.ts](../src/lib/stores/auth.ts), que hace
`POST /api/auth/login` y guarda el token y el usuario. Detalles que importan:

- **Sesión ya abierta.** Al montar, hidrata la sesión (`authStore.init()`, con
  un techo de 3 s) y, si ya hay sesión, salta al destino sin mostrar el
  formulario.
- **Destino tras entrar** (`resolveTarget`): primero `?redirect=` (solo rutas
  internas: empieza por `/` y no por `//`), luego `redirect_after_login` de
  `localStorage` (lo deja `authStore.logout()`), y si no, `/dashboard`. Nunca
  devuelve a una ruta de `/dashboard/nomina`; el código no explica por qué.
- **Dispositivo de conductor.** Si el navegador tiene la marca del portal
  (`cotransmeq_portal_home`, ver más abajo) y no hay sesión, `/login` manda a
  `/public/portal`. Dos escapes: `/login?admin=1` y escribir `/` o `/login` en
  la barra (`entradaDirectaAlLogin()`: el documento con que arrancó la pestaña
  fue `/` o `/login`, sin referrer del mismo origen y fuera de la PWA
  instalada). Un login administrativo correcto borra la marca.
- **«Recordarme en este dispositivo»** solo recuerda el correo
  (`remember_me`, `remembered_email`). No se envía `rememberMe` al backend, así
  que el token dura siempre 30 días (el backend daría 90 con ese flag).
- **Errores.** El login va con `silent401()`: un 401 aquí es «credenciales
  incorrectas», no «sesión vencida», y no debe disparar la redirección del
  interceptor. `describeLoginError` traduce el error a un texto legible y filtra
  los mensajes en inglés del backend.

## Dónde vive la sesión

Las claves de la sesión del dashboard conservan el nombre `transmeralda_*` del
código de origen; no las renombres solo en este repo, porque las leen
[apiClient.ts](../src/lib/api/apiClient.ts), [socketClient.ts](../src/lib/socketClient.ts),
[fetchConSesion.ts](../src/lib/api/fetchConSesion.ts), `MapboxSearch`, las rutas de servidor y
[hooks.server.ts](../src/hooks.server.ts).

| Dónde | Clave | Qué guarda | Quién lo lee |
|---|---|---|---|
| `localStorage` | `transmeralda_token` | El JWT | `apiClient` (cabecera `Authorization`), `socketClient`, `fetchConSesion` (los clientes con `fetch` propio), `MapboxSearch` |
| `localStorage` | `transmeralda_user` | El usuario: `area` (lista), `role`/`rol`, `permisos`, `permisos_rutas`… | `authStore` y, a través de él, sidebar y guardias de cliente |
| Cookie | `transmeralda_token` | El mismo JWT; `path=/`, `SameSite=Strict`, 7 días | `hooks.server.ts` y las rutas `/api/maps/*` |
| `localStorage` | `redirect_after_login` | Ruta a la que volver | Login |

La cookie la escribe JavaScript, así que no es `HttpOnly`, y el token también
está en `localStorage`: un XSS puede leerlo. La cookie vence a los 7 días pero
`authStore.init()` la renueva en cada carga de la app; si venció, el guardia
manda a `/login?redirect=…`, el login encuentra el token en `localStorage` y
devuelve al destino sin pedir credenciales.

El JWT lo firma el backend con `sub`, `correo`, `role`, `nombre`, `area` y
`permisos`. **No lleva `permisos_rutas`** a propósito: es la palanca para
recortar el acceso a alguien y en el token no surtiría efecto hasta el
siguiente login.

`authStore.init()` hidrata el store desde `localStorage` y refresca el usuario
con `GET /api/auth/profile`. Si el perfil responde 401 cierra la sesión; si
falla la red, se queda con los datos locales. Se llama desde el layout raíz
(fuera de `/public`), el del dashboard, `UniverAuthGuard`, el layout del
detalle de servicio, `/` y `/login`; las llamadas simultáneas comparten una sola
petición gracias a la deduplicación de GET de `apiClient`. El perfil devuelve
también `modulos_accesibles` resueltos por el backend, pero el front no lo usa:
recalcula con su copia del mapa.

## El guardia del servidor

Los enlaces privados compartidos por WhatsApp llegan sin cookie al guardia y
terminan en el login. El login usa el parámetro `redirect` para mostrar en su
HTML inicial el título y la descripción pública del módulo en la vista previa
(Open Graph), sin publicar datos del registro. Tras autenticarse se abre la
ruta original.

El `handle` de [hooks.server.ts](../src/hooks.server.ts) solo actúa en
`/dashboard/**` y solo en cargas completas de página (no hay cargas de servidor,
así que la navegación de cliente no pasa por él).

1. Toma el token de la cookie `transmeralda_token` o de `Authorization`.
2. Sin token: redirige a `/login?redirect=<ruta + consulta>`. Se conserva la
   consulta para que un enlace filtrado (`/dashboard/flota?q=renault`) no pierda
   sus filtros al pasar por el login.
3. Decodifica el payload **sin verificar la firma** y mira `exp`. Si no se
   puede leer, venció o no trae `area` como lista, borra la cookie y manda a
   `/login?redirect=<ruta + consulta>` para conservar el enlace solicitado.
4. Resuelve el módulo por el primer segmento tras `/dashboard` y llama a
   `checkAccess(role, area, módulo, payload.permisos_rutas)`. Como el token no
   trae `permisos_rutas`, aquí siempre mandan las áreas.
5. Si no hay acceso, redirige a `landingRoute(...)` con `?denied=1` (nadie lee
   ese parámetro), salvo que el destino sea la misma ruta, para no entrar en un
   bucle.
6. Deja `token`, `userRole` y `userArea` en `event.locals`.

Trampas de este guardia, todas verificables en el código:

- **`landingRoute` puede mandar a una ruta que no existe.** Si el usuario no
  tiene `servicios`, devuelve el primer módulo accesible distinto de `perfil`,
  y el primero del mapa es `dashboard` (general): el destino queda en
  `/dashboard/dashboard?denied=1`, que es un 404. Le pasa a quien solo tiene
  áreas sin `servicios` (contabilidad, mantenimiento) al abrir en carga
  completa una ruta que no le corresponde. El guardia de cliente, en cambio,
  manda a `/dashboard`.
- **Usa las áreas del token, no las actuales.** El token congela las áreas del
  momento del login durante 30 días; el backend ya lee las de la base en cada
  petición y el guardia de cliente las del perfil refrescado. Tras cambiarle
  las áreas a alguien, el guardia de servidor puede dejarlo pasar donde ya no
  debe (lo corta el de cliente) o rechazarlo donde ya puede.
- **Ignora la lista blanca** (`permisos_rutas`), por lo dicho arriba.
- Un token con `area: []` pasa sin comprobar módulo (`userArea.length > 0`).
- `App.Locals.userArea` está tipado como `string` y recibe una lista.

## El guardia del cliente

[dashboard/+layout.svelte](../src/routes/dashboard/+layout.svelte):

- En cada cambio de ruta, salvo `/dashboard`, comprueba el módulo con
  `checkAccess(role || rol, area, módulo, permisos_rutas)` usando el usuario del
  store (refrescado por el perfil, con lista blanca). Sin acceso: aviso «No
  tienes permiso para acceder a esta sección» y `goto('/dashboard')`.
- Cada 60 s revisa el `exp` del token: avisa cuando quedan 5 minutos o menos y
  cierra la sesión al vencer.
- Escucha `sesion-cerrada` en el socket: cuando un administrador cierra la
  sesión desde «Equipo», muestra un modal con cuenta atrás de 5 s y hace
  logout.
- Hasta tener `mounted && user` solo pinta el cargador.

Los canvas no usan este layout. Su
[UniverAuthGuard](../src/lib/components/univer/UniverAuthGuard.svelte) repite la
hidratación, la comprobación de módulo (con el `moduleId` del layout) y la
revisión de caducidad, pero no el modal de sesión cerrada, y al denegar manda a
`/dashboard/servicios`.

[jwt.ts](../src/lib/utils/jwt.ts) decodifica el payload con `atob`, que no
acepta el alfabeto base64url (`-`, `_`) de los JWT. Si el payload codificado
contiene esos caracteres (depende de los bytes: ciertos nombres con tildes
pueden producirlos), `decodeJWT` devuelve `null`, `isTokenExpired` da `true` y
el layout cierra la sesión. El guardia del servidor usa
`Buffer.from(…, 'base64url')` y no tiene el problema.

## Qué pasa con un 401

- **`apiClient` fuera de `/public/`**: el interceptor llama a `sesionVencida()`
  ([fetchConSesion.ts](../src/lib/api/fetchConSesion.ts)), que borra token,
  usuario y cookie y hace una recarga completa de
  `/login?redirect=<ruta + consulta>`, así que tras entrar se vuelve al mismo
  sitio con sus filtros. No lo hace con `silent401()`.
- **`apiClient` dentro de `/public/`**: no redirige; el 401 se propaga a quien
  llamó. Sacar al conductor del formulario por un desplegable que no cargó
  sería peor.
- **Llamadas con `fetch` propio** (los clientes de acciones correctivas,
  asistencias, inducciones, salidas NC, notificaciones, liquidaciones de
  servicios, el asistente y Web Push, y las llamadas directas de las páginas
  de evaluaciones, servicios y `CalendarServicio`): salen por
  `fetchConSesion()`, que ante un 401 hace lo mismo que el interceptor —
  `sesionVencida()`— y devuelve la respuesta a quien llamó sin cambiarla. Las
  rutas públicas de esos clientes (`/api/public/asistencias/*`, el registro de
  inducción del visitante) siguen con `fetch` a secas y no redirigen. Detalle
  en [cliente-api.md](./cliente-api.md).
- **`authStore.logout()`** limpia `localStorage` y la cookie, guarda la ruta
  actual en `redirect_after_login` y va a `/login`; en `/public/*` va al login
  del portal. No avisa al backend: lo usan los cierres que no pide el usuario
  (401, token vencido, sesión cerrada por un administrador, cuenta
  deshabilitada), en los que la sesión ya no vale.
- **Cerrar sesión con el botón** (cabecera del dashboard → `handleLogout` en
  [dashboard/+layout.svelte](../src/routes/dashboard/+layout.svelte)):
  1. `desuscribirAlCerrarSesion()` desactiva los avisos Web Push de ese
     navegador (techo de 2 s). Va primero porque necesita la sesión viva.
  2. `authStore.cerrarSesion()` llama a `POST /api/auth/logout` con el token
     todavía puesto, para que el backend cierre la fila de `sesiones`, y
     después hace `logout()`. Plazo de 3 s, con `silent401()` y errores
     ignorados: si el backend no contesta, el usuario sale igual (y la fila
     queda activa hasta que vence o la cierra un administrador).

  La caducidad no desuscribe los avisos ni avisa al backend.

Reintentos, deduplicación y cancelaciones de `apiClient` están en
[cliente-api.md](./cliente-api.md).

### `SessionTimer`

[SessionTimer.svelte](../src/lib/components/SessionTimer.svelte) muestra el
tiempo que le queda al token, pero el layout monta el `Header` con
`showSessionTimer={false}`, así que hoy no pinta nada. La lógica de caducidad
que funciona es la del layout (arriba).

## Mapa de permisos

[permissions.ts](../src/lib/config/permissions.ts) quiere ser espejo exacto de
`backend-cotransmeq/src/config/permissions.ts` (y es idéntico al de
Transmeralda). El front solo decide qué se pinta; el backend decide el 403. Si
no coinciden, el sidebar muestra una entrada que la API rechaza o esconde una
que el usuario sí puede usar.

**Áreas:** `administracion`, `operaciones`, `contabilidad`, `facturacion`,
`talento_humano`, `hseq`, `mantenimiento` (con etiquetas en `AREA_LABELS`). Un
usuario puede tener varias; manda la mejor.

**Niveles:** `full` (todo), `read` (consulta), `limited` (una función concreta,
p. ej. facturación solo registra facturas en liquidaciones de servicios). La
jerarquía del backend es `limited` < `read` < `full`: una ruta que pide `read`
deja fuera a quien solo tiene `limited`.

**Cómo resuelve `checkAccess(rol, áreas, módulo, permisos_rutas)`**, en orden:

1. Módulo desconocido: denegado. Por eso todo `moduleId` que se pase a un
   guardia tiene que existir en el mapa.
2. Lista blanca (`users.permisos_rutas` con al menos una clave) y el rol no es
   `admin`: sustituye por completo a las áreas. Solo los módulos listados, con
   el nivel listado, incluidos los `general`. `perfil` siempre se concede.
3. `general: true`: cualquier sesión, nivel `full`.
4. Áreas: `full` si alguna está en `full`, luego `read`, luego `limited`.

`getAccessibleModules` aplica lo mismo a todo el mapa.

| Módulo | `full` | `read` | `limited` |
|---|---|---|---|
| `dashboard`, `actividad`, `perfil`, `flota`, `conductores`, `clientes`, `mis-formularios` | Todos (`general`) | | |
| `servicios` | administración, operaciones | HSEQ, talento humano, facturación | |
| `recargos` | administración, operaciones | HSEQ, facturación, talento humano | |
| `solicitudes` | administración, operaciones | facturación, contabilidad | |
| `sarlaft` | administración, talento humano | | |
| `asistencias`, `acciones-correctivas`, `evaluaciones` | administración, HSEQ | | |
| `salidas-nc` | administración, operaciones, HSEQ | | |
| `viaticos` | administración, operaciones | contabilidad | |
| `formularios` | administración, HSEQ | operaciones | |
| `nomina` | administración, talento humano, facturación | | |
| `extractos` | administración, operaciones | | |
| `recorridos` | administración, operaciones | contabilidad, facturación, talento humano, HSEQ, mantenimiento | |
| `liquidaciones-servicios` | administración, operaciones | | facturación |
| `liquidaciones-terceros`, `liquidaciones-terceros-adicionales` | administración, operaciones | | facturación, contabilidad |
| `certificados` | administración, contabilidad | | |
| `terceros` | administración, contabilidad, talento humano, facturación, operaciones | | |
| `usuarios`, `sesiones`, `directorio` | administración | | |
| `mantenimiento` | administración, mantenimiento | operaciones, HSEQ | |
| `combustible` | administración, operaciones, mantenimiento | contabilidad, HSEQ | |
| `incidentes` | administración, HSEQ | operaciones, mantenimiento, talento humano | |
| `cartera` | administración, facturación, contabilidad | operaciones | |

`recorridos` es un módulo aparte de `conductores` a propósito: la ficha de un
conductor la ve todo el mundo, pero la hoja de recorridos alimenta bonos y
pernoctes de la nómina. `mis-formularios` es aparte de `formularios` porque
diligenciar lo que a uno le asignaron no puede depender del permiso del
constructor; el acceso a cada asignación lo deciden sus destinatarios en el
backend.

### Dónde el espejo no es exacto (11-oct-2026)

- El backend tiene un módulo `contabilidad` que el front no tiene: el editor de
  permisos (que ofrece las claves del mapa del front) no puede concederlo.
- En `perfil`, `flota`, `conductores` y `clientes` la lista `full` del backend
  incluye `mantenimiento` y la del front no. No cambia nada porque son
  `general`.
- Con lista blanca y rol `admin`, el backend concede `full` en todo; el front
  ignora la lista y aplica las áreas, así que a un `admin` sin el área
  `administracion` el menú le puede mostrar menos de lo que la API le permite.
  El front compara el rol sin distinguir mayúsculas; el backend, exacto.
- El backend normaliza la lista blanca (descarta claves que no son módulos y
  niveles que no son `full`/`read`/`limited`); el front la usa tal cual.
- El backend lee `permisos_rutas` de la base en cada petición (caché de 30 s);
  el front la toma del usuario guardado, que se refresca con el perfil al
  cargar la app. Un cambio se ve en el front al recargar.

Un cambio en el mapa va en los cuatro archivos: front y back de los dos repos.

## Permiso individual `bonos-planilla`

Es independiente del área: vive en el JSON `permisos` del usuario
(`permisos['bonos-planilla'] === true`). Se concede o se quita en la pestaña de
permisos de `/dashboard/usuarios` (`POST /api/usuarios/permisos/bonos-planilla`,
solo administración). En el front:

- `authStore.hasBonosPlanilla()` lo consulta.
- El canvas de recorridos solo deja marcar bonos con `full` en `recorridos` **y**
  este permiso (`puedeMarcarBonos`).
- `TablaDiasLaborados` y `ModalConfigBonos` pasan a solo lectura sin él.

El backend lo exige en las escrituras de bonos (`requireBonosPlanilla` y el
parche del canvas de recorridos) y lo lee de la sesión, no del token: el cambio
aplica de inmediato en la API y en el front al recargar.

## Sidebar y menú

[menu.ts](../src/lib/config/menu.ts) es la lista única de entradas (`id`,
etiqueta, icono de `lucide-svelte`, `href`); es idéntica a la de Transmeralda.
El `id` es el módulo de permiso. [Sidebar.svelte](../src/lib/components/Sidebar.svelte)
filtra con `checkAccess(role || rol, area, id, permisos_rutas)` y resalta la
sección por el prefijo de la ruta (los canvas de terceros resaltan «Liq.
Terceros»; sesiones y directorio, «Equipo»).

No están en el menú: `perfil`, `actividad`, `directorio`, `sesiones` y los
canvas que se abren desde otra pantalla (recorridos, adicionales, ingresos,
ocasional, primas, análisis). `liquidaciones-terceros-adicionales` ya no tiene
entrada, pero sigue en el mapa porque su `+layout@.svelte` lo pasa al guardia.
El backend tiene un espejo de etiquetas y rutas para el asistente de IA
(`modules/asistente/modulos.ts`): una entrada nueva aquí va también allí.

## Cómo decide una página qué botones mostrar

El patrón es un `$derived` que lee el nivel del módulo:

```ts
// Se lee `$authStore` a propósito: getAccessLevel() consulta el store sin
// suscribirse, y sin esa lectura el derived no se recalcula al hidratar.
const puedeEditar = $derived(
	!!$authStore.user && authStore.getAccessLevel('servicios') === 'full'
);
```

`read` entra a la pantalla pero no ve las acciones de escritura; `limited` ve
solo lo que su caso permite (facturación registra facturas). Lo usan, entre
otras, servicios, flota, conductores, clientes, terceros, cartera, extractos,
viáticos, combustible, mantenimiento, recargos y los canvas de recorridos y de
cierres. Ocultar el botón no protege nada: el backend devuelve 403 igual.

## Portal del conductor

Sesión propia, sin relación con la del dashboard
([portalStore.ts](../src/lib/stores/portalStore.ts)):

1. En `/public/portal` el conductor escribe su cédula:
   `POST /api/conductor-portal/solicitar-acceso` y el backend le manda un
   enlace a su correo.
2. El enlace abre `/public/portal?token=…`. La página valida con
   `GET /api/conductor-portal/verificar-token`: tres intentos de 15 s, solo
   reintenta errores de red y 5xx (un 401 es un enlace vencido), avisa de
   conexión lenta a los 5 s y, sin red, ofrece reintentar con el mismo enlace.
   Un token en la URL siempre gana a la sesión guardada.
3. Con éxito, `portalSession.login()` guarda `{ token, conductor, expiresAt }`
   en `localStorage` (`cotransmeq_portal_token`), quita el token de la URL y va
   a formularios, o a desprendibles si el enlace traía `desprendible`, `prima`
   o `tab`. La pantalla anuncia que el enlace sirve 30 días; la fecha real es la
   `expires_at` que devuelve el backend.
4. Las peticiones salen con `portalFetch`/`portalFetchBlob` (o el cliente de
   formularios del portal) con `Authorization: Bearer <token del portal>`.
5. Ante un 401, las pantallas llaman a `expirarSesionPortal()`: logout y
   `goto('/public/portal')` con `replaceState`. Nunca `/login` ni
   `authStore.logout()`. `portalSession.logout()` no toca IndexedDB; el botón
   «Cerrar sesión» del portal solo vacía las cachés de lectura si no queda
   trabajo pendiente.

**La marca `cotransmeq_portal_home`.** Se escribe al iniciar sesión en el
portal y sobrevive al logout y a la caducidad; solo la borra un login
administrativo. Con ella, `/` y `/login` devuelven al conductor a su login
cuando un fallo lo saca del portal (un 401 que recarga `/login`, el acceso
directo de la PWA, que aquí arranca en `/` por el `start_url` del manifiesto).
Los escapes son los del login: `/login?admin=1` y la entrada directa.

**El puente `/public/abrir-app`.** Gmail anula los enlaces con esquema propio,
así que los correos traen un https a
[abrir-app](../src/routes/public/abrir-app/+page.svelte), que quita el token de
la barra y abre la app: en Android con `intent://portal?token=…`
(paquete `com.cotransmeq.conductores`, y si no está instalada cae al portal web
con `browser_fallback_url`); en iOS con `cotransmeq://portal?token=…` y botones
de respaldo. El backend arma esos enlaces en `lib/portal-access-link.ts`.

El funcionamiento offline del portal está en
[portal-del-conductor.md](./portal-del-conductor.md).

## App móvil para administrativos

En Mi perfil, [AccesoAppMovil.svelte](../src/lib/components/perfil/AccesoAppMovil.svelte)
genera un enlace de 30 días para entrar a la app del teléfono (API
`app-usuarios`: `GET`, `POST` y `DELETE /api/app-usuarios/enlace`):

- El enlace completo se ve una sola vez, con QR y botón de compartir: el
  backend guarda solo el hash del código.
- Generar otro invalida el anterior; revocarlo cierra las sesiones que abrió.
- Es `/public/abrir-app?tipo=usuario&codigo=…`, que abre
  `cotransmeq://admin?codigo=…` (en Android sin respaldo web: si la app no está,
  el intent lleva a la tienda).
- La app canjea el código por un JWT con la misma forma que el del dashboard
  más `tipo: 'app_usuario'`; lo que ve adentro depende de los permisos del
  usuario. Desde una sesión de la app no se puede generar otro enlace (403).
- La puede usar cualquier usuario: el backend devuelve `habilitado` siempre en
  `true` y el componente no lo mira. El comentario de `perfil/+page.svelte` que
  la limita a administración, operaciones y HSEQ es anterior a ese cambio.

En la misma pantalla, «Conectar con Claude o ChatGPT» emite tokens personales
para el MCP del backend (API `mcp`).

## Recuperación de contraseña

El enlace lo emite y lo valida el propio frontend, en rutas de servidor; la
contraseña la escribe el backend.

1. `/recuperar-password` hace `POST /api/auth/recuperar-password` a la ruta
   propia de SvelteKit. Responde siempre lo mismo exista o no la cuenta (no es
   un directorio de quién trabaja en la empresa) y frena por correo (3 cada
   15 min) y por IP (15 cada 15 min).
2. Esa ruta pregunta al backend si la cuenta existe
   (`POST /api/auth/recuperacion/lookup`), firma el enlace y lo manda por
   Resend. El token es `v1.<payload>.<firma>`: HMAC-SHA256 con
   `PASSWORD_RECOVERY_SECRET` (mínimo 32 caracteres, solo del front), con
   correo, `jti` y caducidad de 30 minutos. Si el backend no responde se manda
   igual: el último paso lo rechazaría.
3. `/recuperar-password/[token]` pregunta a la ruta propia si el enlace sirve
   (GET; el navegador no puede comprobar la firma) y envía la contraseña nueva
   (POST), con freno de 30 intentos por IP cada 15 min.
4. La ruta llama a `POST /api/auth/recuperacion/aplicar` con la cabecera
   `x-recovery-token`, cuyo valor es `PASSWORD_RECOVERY_SERVICE_TOKEN`: el
   **secreto compartido con el backend**. El backend guarda la contraseña,
   rechaza enlaces emitidos antes del último cambio de la cuenta
   (`emitidoEn > usuarios.updated_at`, que es lo que garantiza el uso único) y
   cierra todas las sesiones del usuario.

Los frenos y la lista de enlaces consumidos son memoria de la instancia: no
sobreviven a un reinicio ni se comparten entre instancias. Sin el secreto de
firma o sin Resend las rutas responden 503 «no está configurada en este
entorno» en vez de fingir que el correo salió. Las piezas están en
`src/lib/server/recuperacion/`; las variables, en
[variables-de-entorno.md](./variables-de-entorno.md).

Los comentarios del código remiten a `README-RECUPERACION-PASSWORD.md`, que en
este repo no existe; está en `ingreso-svelte`, y su sección sobre el backend
está desactualizada (los dos endpoints ya existen y el uso único se basa en
`updated_at`, no en una tabla).

## Diferencias con Transmeralda

- Allí el portal usa `transmeralda_portal_token` y la marca
  `transmeralda_portal_home`; las claves del dashboard son las mismas.
- Allí la app se abre con `transmeralda://` y el paquete de Android es
  `com.transmeralda.conductores`.
- Su manifiesto web no declara `start_url`.
- `ingreso-svelte` sí tiene `README-RECUPERACION-PASSWORD.md`.

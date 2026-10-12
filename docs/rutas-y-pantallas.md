# Rutas y pantallas

Inventario de todas las páginas de `src/routes` (los `+page.svelte` y los dos
`+page@public.svelte`), agrupadas por zona, con el módulo de permiso que las
abre y los módulos del backend que consumen. Sirve para saber dónde vive una
pantalla, quién puede entrar y a qué parte de la API habla antes de tocarla.
Cómo se organizan las zonas y los layouts está en
[arquitectura.md](./arquitectura.md); cómo se resuelven los permisos, en
[autenticacion-y-permisos.md](./autenticacion-y-permisos.md).

Inventario a 11-oct-2026: 91 `+page.svelte` (uno nunca se pinta, ver
[Redirecciones](#redirecciones)), 2 `+page@public.svelte` y 6 rutas que
redirigen.

## Cómo leer las tablas

**Módulo.** El guardia de `/dashboard` no mira la página sino el primer
segmento después de `/dashboard`: `/dashboard/nomina/primas/canvas` exige
`nomina`. Lo hacen igual [hooks.server.ts](../src/hooks.server.ts) (cargas
completas) y [dashboard/+layout.svelte](../src/routes/dashboard/+layout.svelte)
(navegación de cliente), con `checkAccess` de
[permissions.ts](../src/lib/config/permissions.ts). Los canvas tienen además el
guardia de su `+layout@.svelte`, que puede pedir otro módulo; en ese caso la
tabla indica los dos. Qué áreas tienen cada módulo y con qué nivel está en
[autenticacion-y-permisos.md](./autenticacion-y-permisos.md#mapa-de-permisos).
La entrada del menú lateral de cada módulo sale de
[menu.ts](../src/lib/config/menu.ts).

**API.** Carpetas de `backend-cotransmeq/src/modules/` a cuyas rutas llama la
página, directamente o a través de su cliente de `src/lib/api/`. Se nombran los
módulos principales, no los catálogos que solo llenan un selector (municipios,
conductores básicos…). La referencia de endpoints de cada módulo está en
`backend-cotransmeq/docs/api/<modulo>.md`; la correspondencia entre archivos de
`src/lib/api/` y módulos, en [cliente-api.md](./cliente-api.md).

## Dashboard (`/dashboard/**`)

Todas exigen sesión administrativa. Las que no están en el menú se marcan.

### Inicio, perfil y equipo

| Ruta | Pantalla | Módulo | API |
|---|---|---|---|
| `/dashboard` | Panel de inicio: el backend decide qué secciones ve el usuario (operaciones, HSEQ, talento humano, contabilidad, facturación, mantenimiento) y el periodo vive en la URL. | Ninguno: basta la sesión (`dashboard` es `general`). | `dashboard` |
| `/dashboard/actividad` | Registro de actividad del equipo con filtros por persona, módulo, acción, área y fechas. Fuera del menú. | `actividad` (general) | `actividad` |
| `/dashboard/perfil` | Mi perfil: datos de contacto, firma, sesión actual, contraseña, enlace de la app móvil y conexiones con Claude o ChatGPT (tokens del MCP). Fuera del menú. | `perfil` (siempre accesible) | `auth`, `app-usuarios`, `mcp` |
| `/dashboard/usuarios` | «Equipo»: usuarios, sesiones, invitaciones y la pestaña de permisos (`bonos-planilla`). | `usuarios` | `usuarios`, `sesiones`, `invitaciones` |
| `/dashboard/directorio` | Pantalla huérfana: presencia, invitaciones y alta manual, lo mismo que cubre «Equipo». Fuera del menú; su propio código pide no añadirle funciones. | `directorio` | `usuarios`, `invitaciones` |

### Flota, conductores y operación

| Ruta | Pantalla | Módulo | API |
|---|---|---|---|
| `/dashboard/flota` | Directorio de vehículos: ocultos, papelera, acciones masivas, detalle con documentos. | `flota` | `vehiculos`, `vehiculos-documentos` |
| `/dashboard/mantenimiento` | Planes preventivos, órdenes de trabajo y novedades de los preoperacionales. | `mantenimiento` | `mantenimiento` |
| `/dashboard/combustible` | Tanqueos y rendimiento en km por galón. | `combustible` | `combustible` |
| `/dashboard/conductores` | Directorio de conductores; el alta y la edición van en modal. | `conductores` | `conductores` |
| `/dashboard/conductores/[id]` | Ficha del conductor con sus documentos. | `conductores` | `conductores`, `conductores-documentos`, `viaticos` |
| `/dashboard/conductores/recorridos` | Canvas de recorridos (Univer): un libro por corte, una hoja por conductor, una fila por recorrido; alimenta bonos y pernoctes. Se abre desde Conductores. | Servidor: `conductores`. Canvas: `recorridos`. Marcar bonos exige además `bonos-planilla`. | `recorridos-canvas`, `dias-laborados`, `liquidaciones` (configuraciones de liquidación) |
| `/dashboard/servicios` | Servicios en lista, calendario o canvas; alta y edición en modal, ticket. | `servicios` | `servicios` |
| `/dashboard/servicios/[id]` | Detalle del servicio con mapa (Mapbox y estaciones Distracom), ejecución del conductor y enlace para compartir. | `servicios` | `servicios` |
| `/dashboard/recargos` | Planillas de recargos del mes, con la importación de planillas desde la base de Transmeralda (vista previa, alta de vehículos y empresas que falten, sincronización de conductores). | `recargos` | `recargos` (rutas `importar-desde-transmeralda`), `liquidaciones` (vista previa de recargos) |
| `/dashboard/recargos/configuracion` | Configuración de salarios para recargos. | `recargos` | `recargos` |
| `/dashboard/viaticos` | Anticipos a conductores, su legalización y los gastos de la empresa. | `viaticos` | `viaticos` |
| `/dashboard/solicitudes` | Bandeja de las solicitudes del formulario público de la landing, con radicado y prioridad. | `solicitudes` | `solicitudes-web` |
| `/dashboard/extractos` | Extractos de contrato (FUEC) y catálogo de contratantes. | `extractos` | `extractos` |

### Clientes, terceros y cumplimiento

| Ruta | Pantalla | Módulo | API |
|---|---|---|---|
| `/dashboard/clientes` | Directorio de clientes; alta y edición en modal. | `clientes` | `clientes` |
| `/dashboard/clientes/[id]` | Perfil del cliente con sus tarifas. | `clientes` | `clientes`, `liquidaciones-servicios` (tarifas) |
| `/dashboard/terceros` | Directorio de terceros (propietarios, proveedores). | `terceros` | `terceros` |
| `/dashboard/certificados` | Certificados tributarios por tercero: carga, envío y visor. | `certificados` | `certificados-tributarios` |
| `/dashboard/sarlaft` | Bandeja de formularios SARLAFT + PTEE (aquí con códigos `GC-FR-04`, `GC-FR-05`, `GC-FR-06`…; ver [sarlaft.ts](../src/lib/api/sarlaft.ts)). | `sarlaft` | `formularios-sarlaft` |
| `/dashboard/sarlaft/[id]` | Revisión de un formulario SARLAFT. | `sarlaft` | `formularios-sarlaft` |

### HSEQ y formularios

| Ruta | Pantalla | Módulo | API |
|---|---|---|---|
| `/dashboard/asistencias` | Formularios de asistencia (eventos y capacitaciones). | `asistencias` | `asistencias` |
| `/dashboard/asistencias/[id]/respuestas` | Firmas recibidas en un formulario de asistencia. | `asistencias` | `asistencias` |
| `/dashboard/acciones-correctivas` | Tablero de acciones correctivas y preventivas. | `acciones-correctivas` | `acciones-correctivas` |
| `/dashboard/acciones-correctivas/crear` | Alta de una acción. | `acciones-correctivas` | `acciones-correctivas` |
| `/dashboard/acciones-correctivas/[id]` | Detalle de una acción. | `acciones-correctivas` | `acciones-correctivas` |
| `/dashboard/acciones-correctivas/editar/[id]` | Edición de una acción. | `acciones-correctivas` | `acciones-correctivas` |
| `/dashboard/incidentes` | Accidentes, incidentes y casi accidentes, con plazos e indicadores. | `incidentes` | `incidentes` |
| `/dashboard/incidentes/[id]` | Detalle: reporte, investigación (Res. 1401 de 2007) y acciones. | `incidentes` | `incidentes`, `viaticos` |
| `/dashboard/evaluaciones` | Evaluaciones de conductores. | `evaluaciones` | `evaluaciones` |
| `/dashboard/evaluaciones/crear` | Crear una evaluación. | `evaluaciones` | `evaluaciones` |
| `/dashboard/evaluaciones/[id]` | Detalle con resultados y exportación a PDF o ZIP. | `evaluaciones` | `evaluaciones` |
| `/dashboard/evaluaciones/[id]/editar` | Editar una evaluación. | `evaluaciones` | `evaluaciones` |
| `/dashboard/salidas-nc` | Registro de salidas no conformes (ISO 9001, 8.7). | `salidas-nc` | `salidas-nc` |
| `/dashboard/formularios` | Formularios dinámicos: catálogo, explorador de envíos (`?vista=envios`) y lo asignado al usuario. | `formularios` | `formularios-dinamicos` |
| `/dashboard/formularios/[formId]` | Un formato: versiones, asignaciones y sus envíos. | `formularios` | `formularios-dinamicos` |
| `/dashboard/formularios/[formId]/editar/[versionId]` | Constructor de una versión. | `formularios` | `formularios-dinamicos` |
| `/dashboard/formularios/[formId]/preview/[versionId]` | Vista previa a varios anchos de pantalla. | `formularios` | `formularios-dinamicos` |
| `/dashboard/formularios/asignaciones` | Asignaciones de formularios. | `formularios` | `formularios-dinamicos` |
| `/dashboard/formularios/envios/[submissionId]` | Detalle de un envío y su documento imprimible. | `formularios` | `formularios-dinamicos` |
| `/dashboard/mis-formularios` | Formularios asignados al usuario. | `mis-formularios` (general) | `formularios-dinamicos` |
| `/dashboard/mis-formularios/[assignmentId]` | Diligenciar una asignación, con autoguardado en el servidor cada 2 s. | `mis-formularios` | `formularios-dinamicos` |

Los formularios dinámicos tienen su documentación propia en
[formularios-dinamicos/](./formularios-dinamicos/README_ARQUITECTURA.md) y la
declaración SARLAFT en
[sarlaft-declaracion-empresa-transporte/](./sarlaft-declaracion-empresa-transporte/README.md).

### Nómina y liquidaciones

| Ruta | Pantalla | Módulo | API |
|---|---|---|---|
| `/dashboard/nomina/canvas` | Canvas de nómina (Univer): una hoja por conductor del periodo, desprendibles y envíos. Es la entrada «Nómina» del menú. | `nomina` | `nomina-canvas`, `liquidaciones` |
| `/dashboard/nomina/primas/canvas` | Primas: crear, editar, previsualizar y enviar (tablas, sin motor Univer). | `nomina` | `primas` |
| `/dashboard/nomina/analisis/canvas` | Análisis de nómina, solo consulta, con gráficas. | `nomina` | `nomina-canvas` |
| `/dashboard/nomina/agregar` | Nueva liquidación de nómina en formulario. | `nomina` | `liquidaciones` |
| `/dashboard/nomina/editar/[id]` | Editar una liquidación de nómina. | `nomina` | `liquidaciones` |
| `/dashboard/liquidaciones-servicios` | Listado de liquidaciones de servicios (la capa anterior al canvas): facturar, revertir, operadoras, trazabilidad. Es la entrada «Liq. Servicios» del menú. | `liquidaciones-servicios` | `liquidaciones-servicios`, `facturacion-liquidaciones`, `cartera`, `operadoras` |
| `/dashboard/liquidaciones-servicios/canvas` | Canvas del historial de liquidaciones de servicios. | `liquidaciones-servicios` | `liquidaciones-servicios`, `facturacion-liquidaciones` |
| `/dashboard/liquidaciones-servicios/nueva` | Nueva liquidación de servicios (`LiquidacionEditor`). | `liquidaciones-servicios` | `liquidaciones-servicios` |
| `/dashboard/liquidaciones-servicios/[id]` | Detalle de una liquidación de servicios. | `liquidaciones-servicios` | `liquidaciones-servicios` |
| `/dashboard/liquidaciones-servicios/editar/[id]` | Edición de una liquidación de servicios. | `liquidaciones-servicios` | `liquidaciones-servicios` |
| `/dashboard/cartera` | Cuentas por cobrar de las facturas de servicios, abonos y edades. | `cartera` | `cartera` |
| `/dashboard/liquidaciones-terceros/canvas` | Cierres finales del periodo: una hoja por par placa-propietario. Destino de «Liq. Terceros». | `liquidaciones-terceros` | `liquidaciones-terceros`, `liquidaciones-terceros-descuentos`, `liquidaciones-terceros-snapshots`, `liquidaciones-terceros-envios`, `liquidaciones-terceros-pagos`, `canvas-anotaciones` |
| `/dashboard/liquidaciones-terceros/adicionales/canvas` | Adicionales de los cierres, por año. Se abre desde el «Ir a…» del canvas de cierres. | Servidor: `liquidaciones-terceros`. Canvas: `liquidaciones-terceros-adicionales`. | `liquidaciones-terceros-adicionales`, `liquidaciones-terceros-adicionales-snapshots`, `canvas-anotaciones` |
| `/dashboard/liquidaciones-terceros/ingresos/canvas` | Ingresos por cliente (hojas del GAF-FR-11). Su título y sus comentarios todavía dicen «Ingresos Transmeralda». | `liquidaciones-terceros` | `liquidaciones-terceros-ingresos`, `canvas-anotaciones` |
| `/dashboard/liquidaciones-terceros/ocasional/canvas` | Liquidaciones ocasionales, por año. | `liquidaciones-terceros` | `liquidaciones-terceros-ocasional`, `liquidaciones-terceros-ocasional-snapshots`, `canvas-anotaciones` |
| `/dashboard/liquidaciones-terceros/[id]` | Vista previa de un cierre, con chat, recordatorios y resumen de pago. | `liquidaciones-terceros` | `liquidaciones-terceros`, `liquidaciones-chat`, `liquidaciones-terceros-pagos` |
| `/dashboard/liquidaciones-terceros/ocasional/[id]` | Vista previa de una liquidación ocasional. | `liquidaciones-terceros` | `liquidaciones-terceros-ocasional` |

Los canvas comparten motor y reglas: ver [canvas-univer.md](./canvas-univer.md).
Los `<title>` de los canvas de cierres, ocasional e ingresos terminan en
«· Transmeralda»: la marca no se tradujo al migrarlos. El comentario de la
entrada «Liq. Servicios» en `menu.ts` dice que entra directo al canvas, pero su
`href` es el listado `/dashboard/liquidaciones-servicios`, que enlaza al canvas.

## Redirecciones

Rutas que ya no tienen pantalla y se conservan porque hay enlaces repartidos
(correos, marcadores). Son un `+page.ts` con `redirect()`.

| Ruta | Va a | Detalle |
|---|---|---|
| `/dashboard/nomina` | `/dashboard/nomina/canvas` | 307; conserva `anio`, `mes` y `desde`. |
| `/dashboard/liquidaciones-terceros` | `/dashboard/liquidaciones-terceros/<canvas>?anio=&mes=` | 307. El periodo por defecto se calcula en hora de Bogotá (el `load` corre en UTC en el servidor y en hora local en el navegador). `?tab=` elige el canvas (`mensual` y `ocasional` → ocasional, `adicionales`, `ingresos`; el resto, cierres). |
| `/dashboard/formularios/envios` | `/dashboard/formularios?vista=envios&…` | 308; conserva los filtros de la consulta. Aquí la carpeta conserva además el `+page.svelte` del antiguo explorador de envíos, que nunca se pinta porque el `load` redirige antes: es código muerto. |
| `/dashboard/sesiones` | `/dashboard/usuarios?tab=sesiones` | 307; traduce `q` a `qSesion` y `estado` a `sesion`. |
| `/dashboard/clientes/agregar` | `/dashboard/clientes?nuevo=1` | 307; el alta es un modal del listado. |
| `/dashboard/conductores/agregar` | `/dashboard/conductores?nuevo=1` | 307; igual que clientes. |

Queda además `dashboard/acciones-correctivas/+page.svelte.bak`, que SvelteKit
ignora.

## Portal del conductor (`/public/portal/**`)

Sin guardia de servidor ni módulos: la sesión es el token del enlace mágico y
cada página la comprueba en el navegador (sin sesión, el layout muestra el
login). El funcionamiento sin red está en
[portal-del-conductor.md](./portal-del-conductor.md).

| Ruta | Pantalla | API |
|---|---|---|
| `/public/portal` | Login del portal: pide la cédula, manda el enlace mágico y valida `?token=`. Con sesión, redirige a formularios (o a desprendibles si el enlace trae `desprendible`, `prima` o `tab`). | `conductor-portal` |
| `/public/portal/formularios` | Asignaciones del conductor e historial de envíos confirmado por el servidor. | `formularios-dinamicos` (rutas `/api/conductor-portal/formularios`) |
| `/public/portal/formularios/[assignmentId]` | Diligenciar un formulario: el borrador vive en IndexedDB y el envío sale por la outbox. | `formularios-dinamicos` |
| `/public/portal/formularios/envios/[id]` | Recibo de un envío. | `formularios-dinamicos` |
| `/public/portal/formularios/envios/[id]/documento` | Documento imprimible del envío (`+page@public`: sin barra ni menú). | `formularios-dinamicos` |
| `/public/portal/servicios` | Servicios asignados al conductor. | `conductor-portal` |
| `/public/portal/servicios/[id]` | Detalle del servicio con mapa e inicio de la ejecución. | `conductor-portal` |
| `/public/portal/dias-laborados` | Registro diario de recorridos y adjuntos. | `conductor-portal` |
| `/public/portal/viaticos` | Viáticos del conductor, solo consulta (reportar gastos va por la app móvil). | `viaticos` |
| `/public/portal/desprendibles` | «Pagos»: desprendibles y primas, con firma. | `conductor-portal` |
| `/public/portal/desprendibles/imprimir/[id]` | No es una pantalla: la abre Puppeteer desde el backend con un token de 180 s, genera el PDF con el mismo constructor del canvas de nómina y lo deja en `window.__desprendible` (`+page@public`). | `conductor-portal` |

## Páginas públicas sueltas

Sin sesión administrativa. Las que están bajo `/public/` no renderizan en el
servidor; las demás sí.

| Ruta | Pantalla | API |
|---|---|---|
| `/` | No pinta nada propio: con sesión va a `/dashboard`; en un dispositivo marcado como de conductor, a `/public/portal`; si no, a `/login`. Es el `start_url` de la PWA. | — |
| `/login` | Login administrativo; `/login?admin=1` lo fuerza en un dispositivo de conductor. | `auth` |
| `/recuperar-password` | Pedir el enlace de recuperación de contraseña. | Rutas propias `/api/auth/recuperar-password*`, que llaman a `auth` |
| `/recuperar-password/[token]` | Elegir la contraseña nueva desde el enlace del correo. | Ídem |
| `/invite/[token]` | Aceptar una invitación al equipo y elegir contraseña. | `invitaciones` |
| `/asistencia/[token]` | Firmar la asistencia a un evento. | `asistencias` (rutas `/api/public/asistencias`) |
| `/evaluaciones/[id]` | Responder una evaluación. | `evaluaciones` (rutas públicas) |
| `/public/abrir-app` | Puente del correo a la app móvil: abre `cotransmeq://portal?token=` o `cotransmeq://admin?codigo=`. | — |
| `/public/certificados` | Portal de certificados tributarios para terceros: pide la identificación, manda un enlace y lo valida (`?token=`). | `certificados-tributarios` |
| `/public/certificados/[nit]` | Certificados de un NIT, por tipo y año. | `certificados-tributarios` |
| `/public/extracto/[codigo]` | Validación pública de un extracto de contrato: el destino del QR impreso. | `extractos` |
| `/public/servicio/[token]` | Servicio compartido por enlace, con mapa. | `servicios` (`/api/servicios/public/:token`) |
| `/public/inducciones` | Inducción de visitantes (HSEQ-FR-66) con firma. | `inducciones` |
| `/public/desprendible/[token]` | Ver y firmar un desprendible por token. No encontré en el código actual quién genera este enlace. | `liquidaciones` (`/api/desprendible-firma`) |
| `/public/documento/[token]` | Ver y firmar un desprendible compartido. Tampoco encontré quién genera el enlace. | `documentos` (`/api/desprendible/compartido`) |
| `/public/desprendible` | **Suelta.** Genera un PDF de desprendible a partir de `?data=<JSON en base64>`; nadie en el código construye ese enlace. | — |
| `/public/dias-laborados` | **Prototipo suelto** de reporte diario: guarda todo en `localStorage` (`cotransmeq_conductor_token`, `cotransmeq_registros_*`) y no llama a la API. El backend todavía tiene un correo (`EmailService.sendMagicLink`, módulo `dias-laborados`) que enlaza aquí con `?token=`, y la página lo ignora. El registro real es `/public/portal/dias-laborados`. | — |
| `/presentacion` | **Suelta.** Página de presentación de la plataforma, sin datos ni sesión. | — |
| `/test-municipios` | **De prueba.** Ejercita el store de municipios. Queda fuera de `/dashboard`, así que no tiene guardia de servidor. | `municipios` |

## Al añadir una pantalla

- Si es del dashboard, el primer segmento tiene que ser un módulo de
  `permissions.ts` (en los dos mapas, front y backend) y, si va al menú, una
  entrada en `menu.ts` y en el espejo del asistente del backend
  (`modules/asistente/modulos.ts`).
- Si necesita el viewport entero, cuelga de un `+layout@.svelte` con
  `UniverAuthGuard` (ver [arquitectura.md](./arquitectura.md#los-canvas-escapan-del-layout-del-dashboard)).
- Si es pública, va bajo `/public/` para no heredar `authStore.init()`.
- Los logotipos se llaman distinto que en el gemelo (`logo_nombre.webp`…): una
  ruta de imagen copiada de Transmeralda no da error, deja un hueco. Ver
  [AGENTS.md](../AGENTS.md).
- Las reglas de maquetación están en [componentes-y-estilos.md](./componentes-y-estilos.md).
- Actualiza esta tabla.

## Diferencias con Transmeralda

- `ingreso-svelte` no tiene el `+page.svelte` muerto de
  `dashboard/formularios/envios`.
- `/dashboard/recargos`: Transmeralda tiene historial de cambios y subida de
  planilla en lugar de la importación desde Transmeralda.
- Varias páginas públicas y del portal (`/asistencia/[token]`,
  `/public/inducciones`, `/public/portal/desprendibles`,
  `/public/portal/dias-laborados`, `/public/dias-laborados`) y algunas del
  dashboard (`acciones-correctivas/[id]`, `formularios/envios/[submissionId]`,
  `recargos`) tienen en Transmeralda un rediseño o cambios que no están aquí:
  no son copias exactas. Mira el `diff` antes de replicar un cambio.
- Allí el modal de ticket de servicios tiene una versión simplificada que no se
  replica en este repo.
- Los formularios SARLAFT de Transmeralda usan los códigos `SLFT-PTEE-FR-0X`.

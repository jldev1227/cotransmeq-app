# Frontend, constructor y offline-first

## Rutas

### Dashboard

```text
/dashboard/formularios                         catálogo
/dashboard/formularios/crear                   constructor nuevo
/dashboard/formularios/[formId]                resumen, versiones, asignaciones, envíos
/dashboard/formularios/[formId]/editar/[id]    constructor de versión draft
/dashboard/formularios/[formId]/preview/[id]   preview responsive
/dashboard/formularios/asignaciones             listado global
/dashboard/formularios/envios                   explorador de envíos
/dashboard/formularios/envios/[submissionId]    detalle inmutable
```

### Portal

```text
/public/portal/formularios                      disponibles, hoy, borradores e historial
/public/portal/formularios/[assignmentId]       runner mobile-first
/public/portal/formularios/envios/[id]          recibo de envío solo lectura
```

El login `/public/portal/+page.svelte` redirige por defecto a `/public/portal/formularios`; los deep links existentes de desprendible/prima conservan prioridad.

## Constructor por cards

Layout desktop en tres zonas:

1. **Paleta izquierda**: búsqueda y categorías de utilidades.
2. **Canvas central**: cards de secciones y campos reordenables.
3. **Inspector derecho**: etiqueta, ayuda, required, opciones, validación, reglas y preview.

En móvil/tablet la paleta e inspector son drawers; el canvas ocupa todo el ancho. La accesibilidad incluye botones “mover arriba/abajo”, no depende solo de drag.

Componentes sugeridos:

```text
FormBuilderShell.svelte
FieldPalette.svelte
SectionCard.svelte
FieldCard.svelte
FieldInspector.svelte
OptionsEditor.svelte
RuleBuilder.svelte
AssignmentEditor.svelte
FormRenderer.svelte
FieldRenderer.svelte
RepeatableGroupRenderer.svelte
SyncStatus.svelte
```

Estado del builder:

- Store local normalizado por IDs, con historial undo/redo máximo 50 acciones.
- `svelte-dnd-action` emite `consider` solo para preview y `finalize` para persistir orden local.
- Autosave debounce 800 ms sobre versión draft, con `revision` y `clientMutationId`.
- Ante `REVISION_CONFLICT`, detener autosave, ofrecer recargar o duplicar; nunca sobrescribir silenciosamente.
- Preview usa exactamente `FormRenderer`, no una segunda implementación visual.

## Diseño visual

Seguir tokens ya presentes en `src/app.css` y el portal:

- Base cálida `#FAF7F2`, surface blanca, charcoal y acento esmeralda.
- Fraunces para títulos, Inter/Inter Tight para cuerpo y JetBrains Mono para metadata/códigos.
- Cards con borde sutil, sombra baja y foco esmeralda; evitar gradientes decorativos fuera de acciones primarias.
- Touch targets mínimos 44 px; campos en una columna hasta 768 px.
- Barra inferior sticky en runner con progreso, “Guardar borrador” y “Enviar”.
- Estado offline/pending/failed siempre visible con texto e icono, nunca solo color.
- Respetar `prefers-reduced-motion`, navegación por teclado y mensajes asociados mediante `aria-describedby`.

## IndexedDB

No usar `localStorage` para formularios o blobs. Crear base `transmeralda_forms_v1` con stores:

| Store | Key | Contenido |
|---|---|---|
| `definitions` | `versionId` | definición publicada, ETag, fetchedAt |
| `assignments` | `assignmentId` | tarjeta de acceso y estado conocido |
| `drafts` | `clientSubmissionId` | contexto, respuestas, progreso, timestamps |
| `attachments` | `clientAttachmentId` | Blob, hash, MIME, fieldId, upload state, `serverId`, `uploadUrl` + `uploadChecksum` |
| `outbox` | `operationId` | operación, dependencias, intento, nextAttemptAt |
| `receipts` | `clientSubmissionId` | submissionId, submittedAt, respuesta resumida |
| `meta` | string | schemaVersion, installationId, lastSyncAt |

Usar una capa de repositorio tipada; el resto de UI no llama IndexedDB directamente. La versión del esquema local es independiente de versiones de formularios.

### Persistencia de borrador

- Guardado local inmediato con debounce 250 ms después de cada cambio.
- `updatedAt` monotónico y cálculo de progreso sin contar campos ocultos/no requeridos.
- Backup servidor opcional cada 30 s cuando hay red; nunca bloquea la captura.
- Al abrir: preferir draft local más reciente; si existe backup servidor más nuevo, mostrar elección explícita.
- Al enviar y recibir recibo, eliminar draft y blobs asociados solo después de confirmar que no quedan operaciones dependientes.

### Cuota y adjuntos

- Consultar `navigator.storage.estimate()` y solicitar `navigator.storage.persist()` tras el primer borrador con adjuntos.
- Comprimir fotos antes de almacenar: orientación corregida, lado máximo configurable (por defecto 1920 px), calidad razonable y conservación del original solo si el formulario lo exige.
- Límites iniciales: foto 10 MB antes de compresión, archivo 25 MB, máximo definido por campo y máximo 100 MB por borrador.
- Si falta cuota, conservar respuestas de texto y bloquear nueva evidencia con mensaje accionable; nunca descartar silenciosamente.

### Subida de adjuntos y checksum

La cabecera del `PUT` a S3 no es opcional:

```
Content-Type: <mimeType>
x-amz-checksum-sha256: <el `checksumSha256` que devolvió attachments/init>
```

Ese valor se guarda en `uploadChecksum` **junto a** `uploadUrl`, porque va firmado
dentro de ella y caduca con ella: reusar el checksum de una firma con otra produce
un `403` que parece un problema de credenciales y no lo es. Cuando la URL se
invalida, se borran las dos.

El cliente **no** convierte hex a base64 por su cuenta. Lo hace el backend y lo
devuelve listo; hacerlo aquí invita al error de mandar el base64 del texto
hexadecimal, que S3 rechaza sin explicar la causa.

Dos fallos distintos del `PUT`, y se tratan distinto:

| Respuesta de S3 | Código propio | Tratamiento |
|---|---|---|
| `403` | `UPLOAD_URL_EXPIRED` | Reintentable. Se borra `uploadUrl`/`uploadChecksum` y el reintento pasa por `init`. |
| `400 BadDigest` | `UPLOAD_CHECKSUM_REJECTED` | **No** reintentable. Los bytes locales no producen el hash declarado: el adjunto se marca `FAILED` y hay que recapturar la evidencia. |

`ATTACHMENT_MISSING` del servidor sí es reintentable aunque sea un `422`: significa
que aún hay evidencia subiendo, no que el conductor deba corregir algo.

## Outbox y sincronización

Cada operación tiene:

```ts
type OutboxOperation = {
  operationId: string;
  type:
    | 'BACKUP_DRAFT'
    | 'INIT_ATTACHMENT'
    | 'UPLOAD_ATTACHMENT'
    | 'COMPLETE_ATTACHMENT'
    | 'DISCARD_ATTACHMENT'
    | 'SUBMIT';
  aggregateId: string;
  dependsOn: string[];
  payload: unknown;
  state: 'PENDING' | 'RUNNING' | 'RETRY' | 'BLOCKED';
  attempts: number;
  nextAttemptAt: string;
  lastError?: { code: string; message: string; retryable: boolean };
};
```

Algoritmo:

1. Tomar una operación elegible con lease local para evitar dos pestañas sincronizando lo mismo.
2. Confirmar sesión y red real.
3. Ejecutar dependencias de adjuntos antes de `SUBMIT`, incluidos los
   `DISCARD_ATTACHMENT` pendientes del mismo envío: el servidor rechaza un envío
   que no declare toda la evidencia que tiene guardada.
4. En éxito, guardar receipt y retirar operación.
5. En `401`, pausar y solicitar nuevo magic link conservando datos.
6. En red/408/429/5xx, backoff con jitter: 1 s, 2 s, 4 s, 8 s, 30 s, máximo 5 min.
7. En 4xx de validación, marcar `BLOCKED`, abrir resumen de campos y permitir corregir mientras no exista envío servidor.
8. Si el servidor confirma envío previo por idempotencia, tratarlo como éxito.

Coordinar pestañas mediante `BroadcastChannel('transmeralda-forms-sync')`; fallback a lease en IndexedDB. Socket y eventos `online`, `visibilitychange` y `focus` solo despiertan el worker.

## Service worker y caché

Crear `src/service-worker.ts` usando APIs nativas de SvelteKit:

- **Cache-first**: build assets, fuentes, logo e iconos versionados.
- **Stale-while-revalidate**: shell del portal.
- **Network-first con fallback IndexedDB**: lista/definiciones; la respuesta sensible no se guarda en Cache Storage.
- No interceptar mutaciones para simular éxito. Las controla la outbox.
- Limpiar caches antiguas en `activate`, con nombre que incluya versión de build.
- No cachear URLs firmadas S3 ni tokens en query string.

## Validación y envío

- Validación incremental al salir del campo y validación completa al enviar.
- Scroll/focus al primer error y resumen accesible de errores.
- Backend repite las reglas de required, tipo, rango, opciones, visibilidad, repetición y adjuntos.
- Botón Enviar muestra confirmación explícita: “Después de enviar no podrás editar”.
- Durante envío se mantiene habilitado el cierre/navegación porque la outbox conserva el trabajo.
- Receipt final muestra código, fecha/hora, formulario/versión y estado sincronizado.

## Casos límite

- La versión cacheada fue archivada: conservar draft y bloquear envío hasta reconciliar; ofrecer iniciar versión vigente si existe.
- La asignación expiró offline: el servidor decide; no borrar borrador rechazado.
- Magic link expiró: conservar todo y reanudar tras login.
- Dos dispositivos envían el mismo período: el segundo recibe `SUBMISSION_LIMIT_REACHED`; conservar como copia local exportable hasta decisión del usuario.
- Cambio de vehículo invalida respuestas dependientes: pedir confirmación antes de limpiar esos campos.
- Cierre durante upload: reanudar por adjunto y hash; no duplicar objetos ni submissions.
- Quitar una evidencia ya subida: se encola `DISCARD_ATTACHMENT` con el
  `serverId`, se retiran de la cola las operaciones de subida de ese adjunto y el
  `SUBMIT` pasa a depender del descarte. Sin eso el envío quedaría rechazado con
  `ATTACHMENT_NOT_DECLARED`.


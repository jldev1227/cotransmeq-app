# Contrato REST y Socket.IO

## Convenciones

- Respuesta exitosa: `{ "success": true, "data": ..., "meta"?: ... }`.
- Error: `{ "success": false, "error": { "code": "...", "message": "...", "details"?: ... } }`.
- Listas: `page`, `limit` (máximo 100), `search`, `sort`, filtros y `meta.total/totalPages`.
- Fechas/hora en ISO-8601; `business_date` en `YYYY-MM-DD` calculado con `America/Bogota`.
- Concurrencia administrativa: `revision` o ETag en borradores; actualización obsoleta responde `409 REVISION_CONFLICT`.
- Mutaciones de envío requieren `client_submission_id`; no se reintentan ciegamente desde Axios.
- La identidad se obtiene del JWT. IDs de conductor/usuario en payload nunca autorizan una acción.

## DTO canónico de definición

```ts
type FormDefinitionDto = {
  id: string;
  code: string;
  slug: string;
  name: string;
  description: string | null;
  activeVersion: FormVersionSummaryDto | null;
  draftVersion: FormVersionSummaryDto | null;
  createdAt: string;
  updatedAt: string;
};

type FormVersionDto = {
  id: string;
  formId: string;
  versionNumber: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  title: string;
  description: string | null;
  instructions: string | null;
  settings: Record<string, unknown>;
  revision: number;
  sections: FormSectionDto[];
};

type FormSectionDto = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  sortOrder: number;
  fields: FormFieldDto[];
};

type FormFieldDto = {
  id: string;
  key: string;
  parentFieldId: string | null;
  type: FieldType;
  label: string;
  helpText: string | null;
  placeholder: string | null;
  required: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
  validation: Record<string, unknown>;
  visibilityRule: Rule | null;
  defaultValue: unknown;
  options: FormOptionDto[];
  children: FormFieldDto[];
};
```

La API devuelve camelCase aunque Prisma use snake_case. Los adaptadores viven en el módulo backend.

## API administrativa

Todas requieren `authMiddleware` y permiso `formularios`.

### Catálogo y versiones

| Método | Ruta | Resultado |
|---|---|---|
| `GET` | `/api/formularios` | Lista con estado, versión activa, borrador, asignaciones y envíos |
| `POST` | `/api/formularios` | Crea formulario y versión 1 `DRAFT` |
| `GET` | `/api/formularios/:formId` | Resumen y versiones |
| `PATCH` | `/api/formularios/:formId` | Metadatos del formulario lógico |
| `DELETE` | `/api/formularios/:formId` | Soft delete solo si no tiene asignaciones activas |
| `POST` | `/api/formularios/:formId/restore` | Restaura soft delete |
| `GET` | `/api/formularios/:formId/versions/:versionId` | Definición completa |
| `PUT` | `/api/formularios/:formId/versions/:versionId` | Reemplaza agregado draft en transacción |
| `POST` | `/api/formularios/:formId/versions/:versionId/clone` | Nueva versión draft |
| `POST` | `/api/formularios/:formId/versions/:versionId/publish` | Valida y publica |
| `POST` | `/api/formularios/:formId/versions/:versionId/archive` | Archiva versión publicada |
| `POST` | `/api/formularios/:formId/versions/:versionId/validate` | Errores/advertencias sin persistir |
| `POST` | `/api/formularios/:formId/duplicate` | Nuevo formulario lógico desde snapshot |

`PUT version` acepta el árbol completo, `revision` y `clientMutationId`. La transacción hace upsert por IDs, verifica pertenencia, elimina únicamente nodos ausentes del draft y aumenta `revision`. No se reutiliza la estrategia legacy que borra opciones/respuestas de versiones publicadas.

### Plantillas de cards

| Método | Ruta |
|---|---|
| `GET/POST` | `/api/form-field-templates` |
| `PATCH/DELETE` | `/api/form-field-templates/:id` |

### Asignaciones

| Método | Ruta | Notas |
|---|---|---|
| `GET/POST` | `/api/formularios/asignaciones` | Crear exige versión publicada y al menos un target |
| `GET/PATCH` | `/api/formularios/asignaciones/:id` | Cambio de audiencia/vigencia sin alterar envíos |
| `POST` | `/api/formularios/asignaciones/:id/pause` | Detiene nuevos diligenciamientos |
| `POST` | `/api/formularios/asignaciones/:id/resume` | Reactiva dentro de vigencia |
| `POST` | `/api/formularios/asignaciones/:id/close` | Cierre terminal |

Payload:

```json
{
  "versionId": "uuid",
  "name": "Preoperacional camionetas diario",
  "frequency": "DAILY",
  "limitPolicy": "ONE_PER_CONTEXT",
  "startsAt": "2026-08-20T05:00:00.000Z",
  "endsAt": null,
  "targets": [
    { "type": "ALL_CONDUCTORS" }
  ],
  "contextSchema": {
    "vehicleId": { "required": true }
  },
  "settings": { "allowOffline": true }
}
```

### Envíos administrativos

| Método | Ruta |
|---|---|
| `GET` | `/api/formularios/submissions` |
| `GET` | `/api/formularios/submissions/:id` |
| `POST` | `/api/formularios/submissions/:id/void` |
| `GET` | `/api/formularios/submissions/export.csv` |

Filtros: `formId`, `versionId`, `assignmentId`, `conductorId`, `vehicleId`, `status`, `businessDateFrom`, `businessDateTo`, `search`. El detalle incluye definición versionada, respuestas ordenadas, URLs firmadas de adjuntos y eventos.

## API del Portal del Conductor

Vive dentro del registro protegido de `conductorPortalRoutes` o un submódulo que reutiliza el mismo middleware.

| Método | Ruta | Semántica |
|---|---|---|
| `GET` | `/api/conductor-portal/formularios` | Asignaciones accesibles, estado de hoy y borradores |
| `GET` | `/api/conductor-portal/formularios/:assignmentId` | Definición publicada + ETag + contexto requerido |
| `GET` | `/api/conductor-portal/formularios/submissions` | Historial propio paginado |
| `GET` | `/api/conductor-portal/formularios/submissions/:id` | Solo envío del conductor autenticado |
| `PUT` | `/api/conductor-portal/formularios/drafts/:clientSubmissionId` | Backup opcional de borrador sin adjuntos binarios |
| `DELETE` | `/api/conductor-portal/formularios/drafts/:clientSubmissionId` | Descarta draft propio |
| `POST` | `/api/conductor-portal/formularios/submissions` | Valida y finaliza idempotentemente |
| `POST` | `/api/conductor-portal/formularios/attachments/init` | Reserva metadata y URL firmada (con checksum) |
| `POST` | `/api/conductor-portal/formularios/attachments/:id/complete` | Verifica contra S3 y marca uploaded |
| `DELETE` | `/api/conductor-portal/formularios/attachments/:id` | Descarta evidencia del borrador |

Respuesta de lista:

```json
{
  "success": true,
  "data": [
    {
      "assignmentId": "uuid",
      "formId": "uuid",
      "versionId": "uuid",
      "code": "HSEQ-FR-08",
      "title": "Preoperacional de vehículos",
      "frequency": "DAILY",
      "dueState": "AVAILABLE",
      "submittedToday": 0,
      "draft": { "clientSubmissionId": "uuid", "updatedAt": "...", "progress": 42 },
      "allowOffline": true,
      "requiresContext": ["vehicleId"]
    }
  ],
  "meta": { "today": "2026-08-19", "submittedToday": 3, "pending": 2 }
}
```

Payload de envío:

```json
{
  "clientSubmissionId": "uuid",
  "assignmentId": "uuid",
  "versionId": "uuid",
  "context": { "vehicleId": "uuid" },
  "startedAt": "2026-08-19T13:00:00.000Z",
  "completedAt": "2026-08-19T13:18:00.000Z",
  "answers": [
    { "fieldId": "uuid", "value": "C" },
    { "fieldId": "uuid", "occurrenceId": "uuid", "rowIndex": 0, "value": "Cambiar manguera" }
  ],
  "attachments": [
    { "clientAttachmentId": "uuid", "fieldId": "uuid", "kind": "PHOTO", "sha256": "..." }
  ],
  "device": { "installationId": "uuid", "appVersion": "...", "offlineCreated": true }
}
```

## Contrato de integridad de los adjuntos

El SHA-256 lo comprueba **S3 sobre los bytes que guardó**, no el cliente contra sí
mismo. Tres pasos, y cada uno tiene una responsabilidad distinta:

**1. `POST attachments/init`** — el navegador manda el hash en hexadecimal:

```json
{ "clientAttachmentId": "uuid", "fieldId": "uuid", "kind": "PHOTO",
  "mimeType": "image/jpeg", "byteSize": 184320, "sha256": "<64 hex>" }
```

La respuesta trae la URL firmada y el mismo hash ya convertido:

```json
{ "attachmentId": "uuid", "uploadUrl": "https://…", "alreadyUploaded": false,
  "objectKey": "formularios-dinamicos/…", "checksumSha256": "<44 chars base64>" }
```

`checksumSha256` es el **base64 de los 32 bytes crudos** del digest, y lo deriva el
backend a propósito: el error habitual es enviar el base64 del *texto* hexadecimal
(88 caracteres) y S3 lo rechaza con un mensaje que no dice por qué. Es `null`
cuando `FORMS_S3_NATIVE_CHECKSUM=false`.

**2. `PUT` a la URL firmada** — el navegador repite ese valor tal cual:

```
Content-Type: image/jpeg
x-amz-checksum-sha256: <el checksumSha256 de la respuesta>
```

El checksum va **dentro de la firma**. Omitirlo o alterarlo da `403` (firma
inválida). Enviarlo con bytes que no lo producen da `400 BadDigest` y **S3 no
guarda el objeto**. Aquí es donde se cierra la puerta.

**3. `POST attachments/:id/complete`** — el backend hace `HeadObject` con
`ChecksumMode: ENABLED` y compara lo que S3 devuelve contra el hash persistido en
`init`. Si el proveedor no expone checksum nativo, descarga el objeto y lo hashea
en streaming (con tope de tamaño). La respuesta declara cuál de los dos caminos se
usó:

```json
{ "attachmentId": "uuid", "status": "UPLOADED", "alreadyUploaded": false,
  "verifiedBy": "native-checksum" }
```

`verifiedBy` es `native-checksum`, `streaming-hash` o `previous` (reintento de algo
ya verificado, que no vuelve a escribir nada). Cualquier rechazo deja el adjunto en
`FAILED` —y esa marca **se commitea**— para que el fallo quede registrado.

`DELETE attachments/:id` retira evidencia del borrador. Es idempotente
(`{ discarded, alreadyGone }`) y solo funciona mientras el envío sigue `DRAFT`.

## Inmutabilidad y conjunto de evidencia

Todas las operaciones de adjunto bloquean la fila del envío
(`SELECT … FOR UPDATE`) y **releen el estado** dentro de la transacción. Sobre un
envío `SUBMITTED` o `VOIDED`, `init`, `complete` y `DELETE` responden `409
SUBMISSION_IMMUTABLE`. La única excepción es el reintento de `complete` sobre un
adjunto ya `UPLOADED`: devuelve `verifiedBy: "previous"` en vez de un error,
porque la operación ya había salido bien.

El envío exige además que el conjunto declarado **coincida** con el guardado:

| Situación en el servidor | Respuesta | Qué debe hacer el cliente |
|---|---|---|
| Adjunto `PENDING`/`FAILED` en el borrador | `422 ATTACHMENT_MISSING` | Esperar: la cadena de subida sigue en cola. Es reintentable. |
| Adjunto `UPLOADED` que el payload no declara | `422 ATTACHMENT_NOT_DECLARED` | Declararlo o descartarlo con `DELETE`. |
| `clientAttachmentId` reusado con otros metadatos | `409 ATTACHMENT_CONFLICT` | Usar un id nuevo o descartar el anterior. |

Secuencia final: iniciar/subir adjuntos pendientes, completar adjuntos, descartar
lo que el conductor haya quitado, POST submission. Si se corta después de crear el envío, repetir el mismo POST. `409` se reserva para límite real, versión no vigente o contexto duplicado; la repetición idempotente devuelve `200` con `idempotentReplay: true`.

## Códigos de error mínimos

- `FORM_NOT_FOUND`, `VERSION_NOT_FOUND`, `ASSIGNMENT_NOT_FOUND`
- `VERSION_IMMUTABLE`, `VERSION_NOT_PUBLISHED`, `REVISION_CONFLICT`
- `FORM_DEFINITION_INVALID`, `FIELD_RULE_CYCLE`, `FIELD_VALUE_INVALID`
- `ASSIGNMENT_NOT_AVAILABLE`, `ASSIGNMENT_TARGET_DENIED`, `SUBMISSION_LIMIT_REACHED`
- `SUBMISSION_IMMUTABLE`, `SUBMISSION_ALREADY_VOIDED`
- `ATTACHMENT_MISSING`, `ATTACHMENT_HASH_MISMATCH`, `ATTACHMENT_TOO_LARGE`
- `ATTACHMENT_CONFLICT` (409), `ATTACHMENT_NOT_DECLARED` (422)
- `IDEMPOTENCY_PAYLOAD_MISMATCH`

## Socket.IO

Sockets aceleran actualización; HTTP sigue siendo la autoridad.

### Autenticación y rooms

- Extender `SocketUser` con `tipo?: string` y `cedula?: string`.
- `portalSocket` envía `portalSession.token` en `handshake.auth.token`.
- `forms:join` no acepta identidad arbitraria. Backend deriva conductor del token y une a `conductor:{id}:forms`.
- Dashboard autenticado se une a `forms:admin` solo con permiso.

### Eventos servidor -> cliente

| Evento | Destino | Uso |
|---|---|---|
| `forms:assignment.changed` | conductor/forms admin | Invalidar listado |
| `forms:version.published` | forms admin/targets | Invalidar definición/ETag |
| `forms:submission.accepted` | conductor | Confirmar ID/fecha tras sync |
| `forms:submission.voided` | conductor/admin | Actualizar historial |
| `forms:attachment.ready` | conductor | Continuar outbox si el procesamiento fue asíncrono |

Payloads llevan `eventId`, `occurredAt`, IDs afectados y `revision`; no incluyen definiciones completas ni respuestas sensibles.

### Reconexión

- Reintento Socket.IO con backoff y jitter, sin máximo definitivo mientras exista sesión válida.
- Al reconectar: volver a `forms:join`, ejecutar GET condicional del listado y despertar la outbox.
- `navigator.onLine` solo es señal; el sincronizador confirma conectividad mediante petición real.
- Deduplicar eventos por `eventId` en memoria y tratar siempre el GET como reconciliación final.


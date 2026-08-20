# Correcciones requeridas después de la auditoría de cierre

## Propósito

Este documento describe las brechas encontradas después de implementar las seis fases de formularios dinámicos. Su objetivo es guiar una corrección puntual del vertical slice existente; no autoriza un rediseño general del módulo ni cambios en funcionalidades ajenas.

El cierre se considera **condicionado** hasta corregir y probar estos tres puntos:

1. serialización de los límites de envío por clave lógica;
2. verificación real del SHA-256 del objeto almacenado en S3;
3. inmutabilidad efectiva de los adjuntos después de `SUBMITTED`.

## Reglas de trabajo obligatorias

- Leer y respetar el `AGENTS.md` del workspace antes de modificar archivos.
- No ejecutar migraciones, `db push`, `db pull`, Prisma Studio ni conexiones directas a la base.
- No aplicar el SQL pendiente de formularios dinámicos.
- No cargar las semillas HSEQ.
- No ejecutar lint, typecheck o checks globales salvo solicitud expresa del usuario.
- Se permiten pruebas específicas del módulo que no se conecten a una base real.
- Preservar los cambios ajenos que ya existen en el worktree, especialmente los relacionados con `liquidaciones-terceros-*`, builders y componentes de preview.
- No aprovechar este fix para reformatear o reorganizar archivos no relacionados.
- Si una corrección exige modificar el esquema, detenerse y documentar la necesidad. La solución preferida para estas brechas debe quedar en servicios, transacciones, S3 y pruebas, sin una migración adicional.

## Archivos principales

Backend:

- `backend-nest/src/modules/formularios-dinamicos/formularios-portal.service.ts`
- `backend-nest/src/config/aws.ts`
- `backend-nest/tests/` o las suites específicas de formularios dinámicos

Frontend, solamente si se implementa el checksum nativo de S3:

- `ingreso-svelte/src/lib/api/formularios-portal.ts`
- `ingreso-svelte/src/lib/offline/forms-media.ts`
- `ingreso-svelte/src/lib/offline/forms-sync.ts`
- tipos relacionados con adjuntos, si es necesario

Documentación que debe permanecer coherente:

- `ingreso-svelte/docs/formularios-dinamicos/README_API_SOCKET.md`
- `ingreso-svelte/docs/formularios-dinamicos/README_FRONTEND_OFFLINE.md`
- `ingreso-svelte/docs/formularios-dinamicos/README_OPERACION.md`

---

## FIX-01 — límites de envío seguros bajo concurrencia

### Problema

En `enviarSubmission`, la transacción obtiene un `pg_advisory_xact_lock` derivado únicamente de `clientSubmissionId` y después ejecuta `verificarLimite`.

Ese bloqueo protege correctamente dos reintentos del **mismo** envío idempotente, pero no protege dos envíos diferentes que compiten por el mismo límite de negocio. Por ejemplo:

- mismo `assignmentId`;
- mismo conductor;
- mismo día o periodo;
- mismo vehículo cuando aplica `ONE_PER_CONTEXT`;
- dos `clientSubmissionId` distintos, creados por dos pestañas o dispositivos.

Cada transacción obtiene un lock diferente. Las dos pueden consultar antes de que la otra confirme, concluir que no existe un envío y crear dos registros `SUBMITTED`.

Esto afecta:

- `ONE_PER_PERIOD`;
- `ONE_PER_CONTEXT`;
- frecuencia `ONCE`, incluso cuando `limit_policy` sea `UNLIMITED`.

### Resultado esperado

Para una misma clave lógica de límite, solamente una transacción puede ejecutar a la vez la secuencia:

1. consultar envíos existentes;
2. decidir si el límite está disponible;
3. crear o finalizar el submission.

Los reintentos del mismo `clientSubmissionId` deben conservar la idempotencia actual.

### Solución recomendada

Mantener el lock actual por `clientSubmissionId` y añadir un segundo advisory lock transaccional para la clave de límite.

Construir una representación canónica y estable, por ejemplo:

```text
forms-limit:v1:<assignmentId>:<conductorId>:<policy>:<periodKey>:<contextKey>
```

Donde:

- para `ONE_PER_PERIOD`, `contextKey` debe ser un valor fijo;
- para `ONE_PER_CONTEXT`, `contextKey` debe incluir el vehículo u otra dimensión que realmente use `verificarLimite`;
- para `ONCE`, `periodKey` debe conservar el valor canónico `ONCE`;
- para `UNLIMITED` que no sea `ONCE`, no es necesario adquirir el lock de límite.

La clave debe pasar por el helper de hash que produce el `bigint` usado por PostgreSQL. No concatenar valores ambiguos sin separadores ni usar `JSON.stringify` sobre objetos sin canonicalización.

El orden de adquisición debe ser siempre el mismo para evitar deadlocks. Orden recomendado dentro de la transacción:

1. lock de idempotencia por `clientSubmissionId`;
2. recomprobación del submission idempotente;
3. lock lógico del límite, cuando aplique;
4. `verificarLimite`;
5. escritura del envío, respuestas, adjuntos y evento.

Si se decide adquirir ambos locks siempre, ordenar sus claves numéricamente antes de bloquear. No introducir un lock global para todos los formularios: degradaría la concurrencia de assignments y conductores independientes.

### Defensa adicional opcional

Una constraint única puede ser una segunda barrera, pero `ONE_PER_CONTEXT`, los `VOIDED` y las políticas configurables vuelven compleja una única restricción declarativa. No añadir índices o constraints apresuradamente. El advisory lock lógico es el fix preferido para este alcance.

### Pruebas mínimas

Agregar pruebas de integración del servicio con una transacción/adapter que reproduzca concurrencia; un mock puramente secuencial no demuestra el fix.

Casos obligatorios:

1. Dos POST concurrentes con `clientSubmissionId` diferentes para `ONE_PER_PERIOD`: uno finaliza y el otro recibe `SUBMISSION_LIMIT_REACHED`.
2. Dos POST concurrentes para `ONE_PER_CONTEXT`, mismo vehículo: solamente uno finaliza.
3. Dos POST concurrentes para `ONE_PER_CONTEXT`, vehículos diferentes: ambos pueden finalizar.
4. Dos POST concurrentes con frecuencia `ONCE`: solamente uno finaliza.
5. Dos reintentos con el mismo `clientSubmissionId` y el mismo payload: uno crea y el otro obtiene replay idempotente.
6. Mismo `clientSubmissionId` con payload diferente: se conserva el rechazo por conflicto de idempotencia.

No afirmar que la carrera quedó cubierta si la prueba no ejecuta realmente las dos operaciones de forma solapada.

---

## FIX-02 — verificación real del SHA-256 almacenado en S3

### Problema

El cliente calcula un SHA-256 del blob y lo envía a `attachments/init`. Luego vuelve a enviar el mismo valor a `attachments/:id/complete`.

Actualmente el backend:

- guarda el hash declarado por el cliente;
- compara en `complete` el nuevo valor declarado contra el valor declarado en `init`;
- ejecuta `HeadObject` para comprobar existencia y tamaño;
- no compara el hash con los bytes que S3 almacenó.

Por tanto, la comparación actual es cliente contra cliente. Un objeto distinto, pero con el mismo tamaño, puede aceptarse si el cliente repite el hash original. El comentario que afirma que un cambio de archivo se detecta no es correcto.

### Resultado esperado

El backend solo debe marcar un adjunto como `UPLOADED` cuando el checksum SHA-256 confirmado por S3 coincida con el checksum calculado localmente antes de la subida.

### Solución recomendada: checksum nativo de S3

Usar `ChecksumSHA256` de `PutObject`.

Flujo propuesto:

1. El navegador continúa calculando SHA-256 sobre el blob final, después de cualquier compresión.
2. Convertir el digest al formato que exige S3 para `x-amz-checksum-sha256`: base64 de los 32 bytes del digest, no base64 del texto hexadecimal.
3. `attachments/init` puede seguir recibiendo el hash hexadecimal para almacenamiento y diagnóstico, pero debe poder derivar o recibir también el checksum base64 de forma validada.
4. `getS3UploadUrl` debe incluir `ChecksumSHA256` en `PutObjectCommand` para que forme parte de la firma.
5. `subirBinario` debe enviar exactamente la cabecera `x-amz-checksum-sha256` firmada, además de `Content-Type`.
6. `headS3Object` debe solicitar checksums mediante `ChecksumMode: 'ENABLED'` y retornar `ChecksumSHA256`.
7. `completarAdjunto` debe comparar el checksum devuelto por S3 con el esperado usando una comparación exacta.
8. Solo después de esa comparación puede cambiar el estado a `UPLOADED`.

Firma conceptual:

```ts
getS3UploadUrl(key, contentType, contentLength, checksumSha256Base64, expiresIn)
```

La respuesta de `attachments/init` debería incluir el checksum que el frontend debe enviar o conservarlo localmente de forma inequívoca. Actualizar los tipos sin duplicar dos fuentes de verdad.

### Consideraciones importantes

- `ETag` no sustituye SHA-256. Puede representar MD5 en algunos uploads y cambia con multipart o cifrado.
- Metadata personalizada como `x-amz-meta-sha256` tampoco prueba integridad: seguiría siendo un valor aportado por el cliente.
- Firmar `ContentLength` o comprobar el tamaño no prueba que los bytes sean los esperados.
- Verificar el checksum descargando el objeto en el backend es una alternativa correcta, pero consume red y memoria. Solo usarla si la infraestructura S3 compatible no expone checksums nativos.
- Si el proveedor S3 configurado no soporta `ChecksumSHA256`, documentar la incompatibilidad y aplicar la alternativa de lectura en streaming con hash incremental. No cargar el archivo completo en memoria.

### Idempotencia de `attachments/init`

Cuando ya existe un `clientAttachmentId` en estado `PENDING` o `FAILED`, comparar los metadatos del nuevo intento con los persistidos:

- `submission_id`;
- `kind`;
- `mime_type`;
- `byte_size`;
- `sha256`;
- campo y ocurrencia asociados.

Si difieren, no generar silenciosamente una URL firmada para parámetros nuevos sobre una fila que conserva parámetros anteriores. Rechazar con un error estable de conflicto o exigir un `clientAttachmentId` nuevo.

### Pruebas mínimas

1. Objeto existente, mismo tamaño y checksum correcto: se marca `UPLOADED`.
2. Objeto existente, mismo tamaño y checksum incorrecto: se rechaza y no se marca `UPLOADED`.
3. Tamaño incorrecto: se conserva el rechazo actual.
4. Objeto inexistente: se conserva `ATTACHMENT_MISSING`.
5. Reintento de `init` con los mismos metadatos: devuelve una URL nueva para el mismo objeto.
6. Reintento de `init` con el mismo `clientAttachmentId` y hash/tamaño/tipo diferente: devuelve conflicto.
7. URL expirada: la outbox solicita otra URL y vuelve a enviar el mismo checksum.
8. Confirmar que el test no simula el checksum esperado copiándolo directamente del request; debe modelar el valor retornado por S3.

---

## FIX-03 — inmutabilidad efectiva de adjuntos después del envío

### Problema

`iniciarAdjunto` comprueba que el submission esté en `DRAFT`, pero la lectura y la creación del adjunto no están serializadas con `enviarSubmission`.

Además, `completarAdjunto` consulta el status del submission, pero no rechaza explícitamente estados `SUBMITTED` o `VOIDED`. Esto permite escenarios como:

1. se inicia un adjunto mientras el submission es borrador;
2. se entrega el formulario sin esperar ese adjunto o sin declararlo;
3. posteriormente `complete` marca el adjunto como `UPLOADED` y crea un evento sobre el submission ya entregado.

También existe una carrera en la que `iniciarAdjunto` lee `DRAFT`, el submit confirma y, después, `iniciarAdjunto` crea la fila.

Esto contradice la regla publicada: un `SUBMITTED` no admite modificación de respuestas ni adjuntos.

### Resultado esperado

Después del commit que cambia el submission a `SUBMITTED`, ninguna operación puede:

- crear un adjunto nuevo para ese submission;
- reemplazar sus metadatos;
- marcar un adjunto pendiente como `UPLOADED`;
- enlazarlo a otra respuesta;
- generar un evento de adjunto como si aún fuera editable.

Los replays idempotentes del submission solamente deben devolver el resultado existente.

### Solución recomendada

Coordinar `iniciarAdjunto`, `completarAdjunto` y `enviarSubmission` con el mismo mecanismo de exclusión sobre el submission.

Opción preferida:

1. Ejecutar inicio y complete dentro de transacciones cortas.
2. Bloquear la fila de `form_submissions` con `SELECT ... FOR UPDATE` antes de decidir según `status`.
3. Releer `status` después de obtener el lock.
4. Exigir `DRAFT` para crear o modificar adjuntos.
5. En `enviarSubmission`, bloquear esa misma fila cuando ya existe el borrador y antes de finalizarlo.
6. Mantener un orden único de locks entre fila de submission, idempotencia y límite lógico para evitar deadlocks. Documentar el orden junto al código.

Si Prisma no permite expresar el lock directamente, usar `$queryRaw` parametrizado solamente para `SELECT ... FOR UPDATE` dentro de la transacción. No usar SQL destructivo ni ejecutar nada contra una base desde el agente.

### Adjuntos no declarados

Antes de finalizar el submission, definir y aplicar una política explícita para adjuntos del borrador que no aparecen en `input.attachments`.

Política recomendada para evitar evidencia ambigua:

- el conjunto de adjuntos `UPLOADED` pertenecientes al submission debe coincidir con el conjunto declarado por el payload final;
- si existe un adjunto `PENDING`/`FAILED`, rechazar el submit con un error recuperable mientras el cliente todavía lo considere parte del borrador;
- si el usuario eliminó deliberadamente un adjunto local, debe existir un flujo claro para descartarlo antes del submit y limpiar el objeto de S3 mediante un mecanismo seguro/lifecycle, no incorporarlo silenciosamente;
- nunca completar o adjuntar evidencia después de `SUBMITTED`.

No borrar objetos de S3 como parte improvisada de este fix. Si hace falta limpieza, documentar una tarea separada o usar una política lifecycle para el prefijo de objetos huérfanos.

### Pruebas mínimas

1. `init` sobre `DRAFT`: permitido.
2. `init` sobre `SUBMITTED` y `VOIDED`: `SUBMISSION_IMMUTABLE`.
3. `complete` sobre `DRAFT`: permitido cuando objeto, tamaño y checksum son válidos.
4. `complete` sobre `SUBMITTED` y `VOIDED`: `SUBMISSION_IMMUTABLE` sin cambiar attachment ni crear evento.
5. Carrera `init` contra `submit`: después de finalizar, no aparece un adjunto nuevo.
6. Carrera `complete` contra `submit`: solamente puede ganar un orden consistente; nunca se modifica un submission después de quedar `SUBMITTED`.
7. Submission con adjunto pendiente o no declarado: se aplica la política definida y el resultado es determinista.
8. Replay idempotente después de `SUBMITTED`: no vuelve a escribir respuestas, adjuntos ni eventos.

---

## Orden recomendado de implementación

1. Escribir primero las pruebas de reproducción para las tres brechas.
2. Definir y documentar el orden global de locks.
3. Implementar FIX-03, porque establece la coordinación transaccional del submission.
4. Implementar FIX-01 sobre ese mismo orden de locks.
5. Implementar FIX-02 coordinando backend, frontend y mocks de S3.
6. Ejecutar únicamente las suites específicas de formularios dinámicos y las pruebas nuevas.
7. Revisar manualmente el diff completo de ambos repositorios.
8. Actualizar la documentación operativa/API si cambió el contrato del checksum o los errores retornados.

## Contrato de errores sugerido

Reutilizar códigos existentes siempre que representen correctamente el caso:

- `SUBMISSION_LIMIT_REACHED`: límite lógico ganado por otra transacción.
- `SUBMISSION_IMMUTABLE`: intento de iniciar o completar adjuntos después de `DRAFT`.
- `ATTACHMENT_HASH_MISMATCH`: S3 reporta un checksum diferente.
- `ATTACHMENT_MISSING`: el objeto no existe o está incompleto.
- `ATTACHMENT_CONFLICT`: opcional para reutilizar un `clientAttachmentId` con metadatos diferentes.

Los errores por checksum, inmutabilidad o conflicto de metadatos no deben tratarse como reintentos infinitos en la outbox. Una URL expirada o una pérdida de red sí debe continuar siendo reintentable.

## Criterios de aceptación del fix

El trabajo puede cerrarse cuando:

- existe serialización por clave lógica de límite y no solo por idempotency key;
- una prueba concurrente demuestra que dos UUID diferentes no saltan el límite;
- S3 confirma el SHA-256 de los bytes almacenados;
- el frontend envía el checksum requerido por la URL firmada;
- `init` idempotente rechaza metadatos incompatibles;
- inicio y complete de adjuntos exigen `DRAFT` bajo lock;
- ninguna operación posterior modifica adjuntos de un `SUBMITTED` o `VOIDED`;
- las pruebas específicas nuevas pasan sin conexión a una base real de producción/staging;
- la documentación describe el contrato final real, sin afirmar verificaciones que no existen;
- no se aplicó SQL, no se cargaron seeds y no se mezclaron cambios ajenos.

## Formato del cierre que debe entregar Claude

Claude debe responder con:

1. archivos modificados;
2. explicación breve de la solución aplicada a cada FIX;
3. orden de locks definitivo;
4. contrato final del checksum entre navegador, API y S3;
5. pruebas añadidas y resultados obtenidos;
6. validaciones no ejecutadas;
7. confirmación explícita de que no ejecutó SQL, migraciones, seeds ni conexiones a la base;
8. riesgos o limitaciones que continúen abiertas.

No declarar nuevamente completo el vertical slice si alguna de las tres brechas queda solamente documentada, simulada o cubierta por una prueba secuencial.

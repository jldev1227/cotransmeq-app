# Operación y rollback — formularios dinámicos

Qué hacer cuando algo va mal en producción. Escrito para la persona que está de
guardia, no para quien escribió el módulo.

## La regla que gobierna todo

**Nunca se borran históricos.** Un envío `SUBMITTED` es un documento con valor
legal: es la prueba de que un conductor verificó un vehículo antes de salir. El
rollback de este módulo es siempre **dejar de pedir** algo, nunca **borrar** lo que
ya se pidió.

Concretamente: `DELETE` no existe como herramienta de operación. Lo que existe es
pausar asignaciones, archivar versiones y anular envíos con motivo.

---

## Escenarios y su rollback

### «Publicamos un formulario con un error y los conductores ya lo están usando»

No se edita la versión publicada — es inmutable por diseño y el `PUT` responde
`409 VERSION_IMMUTABLE`. La secuencia es:

1. **Pausar la asignación** desde `/dashboard/formularios/asignaciones` o desde el
   resumen del formulario. El formulario desaparece de la lista de los conductores
   de inmediato; los borradores que tengan a medias se conservan en su teléfono.
2. **Clonar la versión** (`POST .../clone`), corregir en el borrador y publicar la
   nueva.
3. **Crear una asignación nueva** contra la versión corregida y **cerrar** la
   anterior.

Lo que NO se hace: cambiar la versión de la asignación existente. La API no lo
permite, y por un motivo concreto: los envíos ya hechos apuntan a la versión de la
asignación, y moverla haría que un envío contra la v2 pareciera hecho contra la v3,
con preguntas que no existían.

### «Los conductores están enviando duplicados»

Primero comprobar si son duplicados de verdad:

```
GET /api/formularios/metricas
```

- `idempotentReplays` alto es **normal**: es la outbox reintentando y el servidor
  reconociendo el mismo envío. No se crearon duplicados.
- `idempotencyMismatches` distinto de cero **sí es un problema**: algún cliente
  está reusando un `client_submission_id` con otro contenido. Buscar en los logs
  `forms:submission.idempotency-mismatch` y el `installationId` del dispositivo.

Si hay duplicados reales en la base, se **anulan** con motivo (`POST
.../submissions/:id/void`). Anular conserva todas las respuestas y adjuntos, y
registra quién lo hizo y por qué. No se borran.

### «Un conductor perdió el teléfono con una inspección a medias»

Si el backup del borrador llegó al servidor, sus respuestas de texto están en un
envío `DRAFT`. Los **adjuntos no**: el backup no sube binarios a propósito, para no
consumir los datos del conductor con fotos que nadie ha pedido. Las fotos se
perdieron con el teléfono.

No hay forma de «restaurar» el borrador a otro dispositivo en v1. El conductor
vuelve a diligenciar.

### «Un conductor no puede enviar: dice que falta declarar evidencia»

Error `ATTACHMENT_NOT_DECLARED`. El servidor tiene un adjunto `UPLOADED` de ese
borrador que el envío no lista. Pasa cuando el conductor quitó una foto en un
dispositivo o sesión donde el descarte no llegó a encolarse.

Se resuelve desde la app: volver a quitar y poner la evidencia del campo afectado
encola `DISCARD_ATTACHMENT` y libera el envío. No hay que tocar nada en el
servidor. El detalle del error trae los `attachmentId` implicados.

`ATTACHMENT_MISSING` es otra cosa y **no** requiere intervención: hay evidencia
todavía subiendo y el envío se reintenta solo.

### «Los adjuntos fallan la verificación de integridad»

Error `ATTACHMENT_HASH_MISMATCH` en `complete`, con el adjunto quedando `FAILED`.
Significa que los bytes almacenados en S3 no producen el hash que el dispositivo
declaró. Por orden de probabilidad:

1. **El bucket no impone el checksum.** Buscar en los logs
   `forms-s3-sin-checksum-nativo`: si aparece, el bucket no devuelve
   `ChecksumSHA256` y la verificación está cayendo al plan B (descargar y hashear).
   Funciona, pero cuesta red y delata una configuración vieja. En un envío normal,
   el evento `ATTACHMENT_ATTACHED` lleva `verifiedBy: "native-checksum"`; si lleva
   `"streaming-hash"`, es este caso.
2. **El archivo se corrompió en el dispositivo** entre la captura y la subida. El
   conductor recaptura la evidencia; el adjunto `FAILED` no se reutiliza.

`FORMS_S3_NATIVE_CHECKSUM=false` desactiva la firma del checksum en la URL (para
proveedores compatibles-S3 que la rechazan), pero **no** desactiva la verificación:
el backend sigue comprobando contra el objeto almacenado.

### «El almacenamiento del teléfono se llenó»

El runner conserva las respuestas de texto y bloquea solo la evidencia nueva, con
un mensaje accionable. Nunca descarta lo escrito.

Qué hacer: que el conductor **envíe** los formularios pendientes con señal. Al
recibir el recibo, la outbox borra el borrador y sus blobs — pero solo cuando no
queda ninguna operación de ese envío en cola, para no dejar un envío sin su
evidencia.

### «Hay envíos atascados en la outbox»

El chip de sincronización del portal muestra el estado y la antigüedad del más
viejo. Los estados y qué significan:

| Estado | Significado | Acción |
|---|---|---|
| `Sin conexión` | No hay red real (se comprueba con una petición, no con `navigator.onLine`) | Buscar señal. Los datos están a salvo. |
| `Sesión vencida` | El magic link caducó | Solicitar un enlace nuevo. La outbox reanuda donde quedó. |
| `Necesita corrección` | El servidor rechazó por validación (`4xx`) | Abrir el formulario: el borrador queda editable con el detalle del error. |
| `Necesita corrección` con `ATTACHMENT_NOT_DECLARED` | Hay evidencia guardada que el envío no declara | Quitar y volver a poner la foto del campo señalado. |
| `Necesita corrección` con `UPLOAD_CHECKSUM_REJECTED` | S3 rechazó los bytes por no coincidir con su huella | Recapturar esa evidencia. Reintentar no sirve. |
| `Pendiente de enviar` | En cola con backoff | Esperar, o pulsar «Intentar ahora». |

Un `4xx` de validación **no se reintenta**: mil reintentos darían mil veces el
mismo error y gastarían los datos del conductor.

### «Publicamos una versión que no debía existir»

Si **no tiene asignaciones**: archivarla (`POST .../archive`). Archivar impide
asignaciones y envíos nuevos y conserva la consulta histórica.

Si **tiene asignaciones**: primero cerrarlas. El backend rechaza archivar una
versión con asignaciones vivas (`FORM_HAS_ACTIVE_ASSIGNMENTS`) precisamente para
que no quede una asignación apuntando a algo inutilizable.

### «Queremos retirar un formulario entero»

1. Cerrar todas sus asignaciones.
2. Archivar sus versiones publicadas.
3. Archivar el formulario (`DELETE /api/formularios/:formId` — es borrado
   **lógico**, pone `deleted_at`).

Los envíos históricos siguen consultables en el explorador. Para volver a ponerlo
en marcha: `POST /api/formularios/:formId/restore`.

### «Hay que desmontar el módulo entero»

Solo tiene sentido **antes de que exista el primer envío real**. El SQL de rollback
está al final de
`backend-nest/prisma/migrations/19-08-2026-formularios-dinamicos/migration.sql`,
comentado y en orden de dependencia.

Con envíos ya registrados, desmontar significa destruir documentos con valor legal.
En ese caso el rollback es funcional: cerrar asignaciones, archivar versiones y
retirar la entrada del sidebar.

---

## Diagnóstico

### «A un conductor no le aparece un formulario»

Por orden de probabilidad:

1. **La asignación está pausada o cerrada.** El portal solo muestra `ACTIVE`.
2. **La vigencia venció o no ha empezado.** El listado de asignaciones marca las
   dos situaciones con un aviso explícito: una asignación `ACTIVE` con
   `endsAt` pasado no le aparece a nadie aunque el estado diga «Activa».
3. **El target no lo alcanza.** Los targets admitidos son `ALL_CONDUCTORS`,
   `CONDUCTOR`, `VEHICLE` (alcanza al conductor asignado a ese vehículo) y `SEDE`
   (por `sede_trabajo` del conductor). Un target `GROUP` **no resuelve conductores
   en v1**: solo sirve para agrupar en la administración.
4. **Ya lo entregó en este período.** Con `ONE_PER_PERIOD` o frecuencia `ONCE`, la
   tarjeta pasa a «Ya entregado».
5. **La versión está archivada.** El portal solo sirve versiones `PUBLISHED`.

Para confirmarlo desde el servidor, buscar en los logs
`forms:assignment.target-denied` con el `actor_id` del conductor.

### «El autosave del builder da conflicto»

`REVISION_CONFLICT` significa que otra pestaña —u otra persona— guardó el mismo
borrador. El builder **detiene** el autosave y ofrece dos salidas: recargar
(descarta lo local) o duplicar en una versión nueva (conserva ambos trabajos).

Nunca sobrescribe en silencio. Si el contador `revisionConflicts` sube de forma
constante, probablemente alguien tiene el builder abierto en dos pestañas.

### Métricas disponibles

```
GET /api/formularios/metricas     (permiso `formularios`, nivel read)
```

**Son contadores del proceso, no de la instalación**: se reinician al reiniciar el
servidor, y la respuesta lo declara en `scope: "process"`. Una caída del contador
significa un reinicio, no una caída del tráfico.

| Contador | Qué vigilar |
|---|---|
| `submissionsAccepted` | Volumen normal de operación. |
| `idempotentReplays` | Alto es sano (la outbox reintenta y no duplica). |
| `idempotencyMismatches` | **Cualquier valor > 0 es un bug de cliente.** |
| `limitReached` | Si sube mucho, revisar si la política de límite es la correcta. |
| `validationRejections` | Si sube tras publicar una versión, la versión pide algo imposible. |
| `attachmentFailures` | Fotos que no llegaron a S3 o que no pasaron la verificación de integridad. Revisar credenciales, cuota y el aviso `forms-s3-sin-checksum-nativo`. |
| `revisionConflicts` | Pestañas duplicadas del builder. |
| `targetDenied` | Targets mal configurados. |
| `sanitizedTexts` | Textos que llegaron con caracteres invisibles. Investigar el origen. |

Latencias `p50`/`p95` de `submit`, `listPortal` y `saveVersion`, en ventana
deslizante de 500 muestras.

### Logs

Todos llevan las mismas claves, así que un envío se puede seguir de principio a
fin:

```
request_id, actor_id, actor_type, form_id, version_id,
assignment_id, submission_id, client_submission_id
```

Prefijos: `forms:submission.*`, `forms:attachment.*`, `forms:version.*`,
`forms:assignment.*`, `forms:admin.query`.

`forms:admin.query` registra **toda** consulta administrativa de envíos (lista,
detalle y export CSV) con sus filtros y el número de resultados. Los envíos
contienen datos de salud, fatiga y firmas: saber quién consultó qué es parte del
control de acceso, no un extra.

---

## Lo que el módulo NO hace (y hay que saberlo)

- **`GROUP` no resuelve conductores.** Un target `GROUP` no le aparece a nadie en
  v1; existe para agrupar en la administración.
- **El tratamiento administrativo de FR-07 y FR-42 no está implementado.** Esos
  campos van con `config.editableBy: ['USER']` y el runner del conductor los omite,
  pero no hay pantalla para diligenciarlos. Es una fase futura, prevista en la
  especificación.
- **`ALL_CONDUCTORS` no emite eventos de socket por conductor.** Emitir a miles de
  rooms en cada cambio no escala; ese caso lo cubre el room admin más la
  reconciliación por GET que el portal hace al reconectar. El conductor ve el
  cambio al abrir la app o al recuperar el foco, no al instante.
- **El backup del borrador no lleva adjuntos.** Es deliberado: subir las fotos en
  cada autosave consumiría los datos del conductor.
- **Descartar un adjunto borra la fila, no el objeto de S3.** Limpiar S3 dentro de
  una transacción que puede hacer rollback sería una operación destructiva
  improvisada. Los objetos huérfanos del prefijo `formularios-dinamicos/` se
  retiran con una **política de ciclo de vida del bucket, que está pendiente de
  configurar**. Cada descarte deja su `object_key` en el log
  (`forms-attachment-discarded`) para poder auditar esa limpieza.
- **El export CSV se corta en 5.000 filas** y lo registra en el log y en el propio
  archivo. Para más, acotar por fechas.
- **Sin `versionId` el CSV solo trae la cabecera** de cada envío. Formularios
  distintos no comparten preguntas, y mezclarlas produciría un archivo ilegible.

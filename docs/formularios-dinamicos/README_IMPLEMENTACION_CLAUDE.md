# Guía de implementación para Claude

## Mandatos del repositorio

1. Leer `AGENTS.md` antes de modificar.
2. No ejecutar typecheck, lint ni comandos equivalentes salvo solicitud explícita del usuario.
3. No ejecutar ni sugerir Prisma migrate, db push, db pull, Prisma Studio o conexiones PSQL/DB.
4. Para schema: editar ambos Prisma schemas, ejecutar únicamente `prisma format`, `prisma validate`, `prisma generate`, y crear SQL manual completo.
5. Entregar al usuario el SQL completo, orden de ejecución y consultas de verificación. No afirmar que la base quedó migrada.
6. Mantener compatibilidad con evaluaciones, asistencias y portal existentes; no reutilizar sus tablas para el nuevo módulo.

## Secuencia de trabajo

### Fase 1 — Dominio y esquema

- Agregar modelos Prisma equivalentes a [README_DATABASE.md](README_DATABASE.md) en ambos schemas.
- Crear migración SQL manual con tablas, restricciones e índices.
- Crear tipos compartidos de definición, reglas, asignaciones, submissions y errores.
- Implementar validador puro: claves únicas, estructura padre/hijo, options, ciclos, reglas y límites.
- No añadir todavía rutas visibles ni cargar semillas.

Salida: schemas coherentes, SQL manual y pruebas unitarias del validador sin base externa.

### Fase 2 — Backend administrativo

- Crear módulo `formularios-dinamicos` con schemas Zod, service/repository y transacciones.
- Implementar CRUD lógico, agregado draft, clone, validate, publish/archive y plantillas.
- Implementar asignaciones y queries paginadas de submissions.
- Registrar rutas con `authMiddleware` y permiso server-side; no depender del guard frontend.
- Emitir eventos Socket.IO solo después de commit.

Salida: contrato administrativo de [README_API_SOCKET.md](README_API_SOCKET.md).

### Fase 3 — Constructor dashboard

- Agregar permiso/ruta/sidebar.
- Construir catálogo, builder de tres paneles, inspector, rule builder, preview y asignador.
- Reutilizar `svelte-dnd-action`; incluir botones de orden accesibles.
- Autosave con revisión optimista y manejo explícito de conflicto.
- Construir explorador/detalle inmutable de envíos.

Salida: HSEQ puede crear y publicar un formulario pequeño de extremo a extremo.

### Fase 4 — Portal y offline

- Agregar nav “Formularios” al layout del portal y ajustar redirect del login sin romper deep links.
- Implementar lista, runner y recibo con `FormRenderer` compartido.
- Implementar IndexedDB, borradores, blobs, outbox, BroadcastChannel y service worker.
- Crear socket manager del portal con token correcto, resubscribe y reconciliación GET.
- Implementar adjuntos por URL firmada y envío idempotente.

Salida: un formulario se completa en modo avión, sobrevive recarga y sincroniza una sola vez.

### Fase 5 — Semillas

- Crear factories y 13 definiciones siguiendo [README_SEEDS_HSEQ.md](README_SEEDS_HSEQ.md).
- Añadir validador offline de semillas y reporte legible de warnings.
- Mantener todas en DRAFT y sin assignments.
- Generar un inventario final de secciones, fields, options y reglas por código para revisión HSEQ.

Salida: artefactos de semilla revisables; el agente no los carga en una DB.

### Fase 6 — Endurecimiento

- Límites de payload/adjuntos, autorización por target, sanitización y auditoría.
- ETag/cache headers privados, queries selectivas y paginación.
- Métricas/logs de sync e idempotencia.
- Accesibilidad, cuota de almacenamiento, sesiones expiradas y conflicto multidispositivo.
- Documentar rollback funcional: pausar assignments/archivar versión; no borrar históricos.

## Orden recomendado de entregas

No construir los 13 formularios antes de estabilizar el vertical slice. Orden:

1. Formulario mínimo manual: texto + C/NC/NA + observación condicional + firma.
2. Publicación/asignación a un conductor.
3. Runner online y submission inmutable.
4. IndexedDB/outbox offline.
5. Foto/firma y reanudación.
6. Matrix/repeatable group.
7. HSEQ-FR-22 como primera semilla representativa.
8. HSEQ-FR-08/09 por volumen y reglas.
9. Restantes semillas.

## Pruebas y aceptación

### Dominio/backend

- No permite editar versión publicada.
- Clonar conserva claves/config pero crea versión/IDs propios.
- Publicación rechaza keys duplicadas, reglas cíclicas, option inválida y grupo mal formado.
- Assignment fuera de target/vigencia devuelve acceso denegado.
- `ONE_PER_CONTEXT` impide segundo preoperacional del mismo período/conductor/vehículo.
- Dos POST simultáneos con mismo `client_submission_id` crean un solo envío y devuelven el mismo ID.
- Payload diferente con mismo idempotency ID devuelve `IDEMPOTENCY_PAYLOAD_MISMATCH`.
- Submitted rechaza modificación de respuestas/adjuntos.
- Void conserva respuestas y registra actor/motivo.
- Consulta del portal nunca devuelve envíos de otro conductor.

### Builder

- Drag, teclado, duplicar, borrar, undo/redo y orden persisten correctamente.
- Dos pestañas detectan conflicto de revisión.
- Preview y runner renderizan los mismos tipos y reglas.
- Publicar muestra warnings y bloquea errores.
- Mobile 320 px no presenta overflow horizontal ni acciones inaccesibles.

### Offline/sync

- Definición cacheada abre en modo avión.
- Borrador sobrevive recarga/cierre y preserva blobs.
- Reconexión sube adjuntos antes del submission.
- Corte en cada paso reanuda sin duplicar adjunto/envío.
- 401 pausa sin borrar y reanuda después de autenticar.
- 4xx de validación queda bloqueado y editable con detalle.
- Dos pestañas no procesan simultáneamente la misma operación.
- Falta de cuota no borra texto ni borradores anteriores.

### Semillas

- Cada código es único y toda semilla valida sin DB.
- Las matrices impresas por fechas se convierten en historial, no en columnas duplicadas.
- FR-07 no duplica su copia de impresión.
- FR-42 usa la hoja “Formato” completa.
- Todas quedan DRAFT, sin targets ni publicación.

## Revisión manual obligatoria

Al terminar cada fase, revisar manualmente el diff y los flujos tocados. No ejecutar checks rutinarios prohibidos. Para schema sí seguir el flujo seguro de Prisma permitido por `AGENTS.md`. En el cierre, listar archivos cambiados, validaciones realizadas, validaciones no ejecutadas y cualquier SQL que el usuario deba aplicar manualmente.

## Definición de terminado

La funcionalidad no está terminada solo por dibujar el builder. Debe existir un vertical slice con versión inmutable, assignment autorizado, runner mobile, borrador local, adjunto, submission idempotente, consulta administrativa, auditoría y manejo de reconexión. Ningún seed se considera listo para producción hasta aprobación HSEQ y ejecución manual del SQL por el usuario.


# Arquitectura de formularios dinámicos

## 1. Límites del dominio

El módulo nuevo se llama `formularios-dinamicos` y no amplía las tablas legacy `Evaluacion`, `Pregunta`, `Opcion`, `Resultado` y `Respuesta`. Esas tablas califican evaluaciones y su actualización actual puede eliminar preguntas/respuestas; no satisfacen versionado inmutable, asignaciones, matrices repetibles, offline ni evidencias.

Subdominios:

1. **Catálogo**: formulario lógico, versiones, secciones, campos, opciones, reglas y plantillas reutilizables.
2. **Publicación**: ciclo `DRAFT -> PUBLISHED -> ARCHIVED`, clonación de versiones y snapshot inmutable.
3. **Asignación**: audiencia, vigencia, recurrencia, límites y contexto (conductor/vehículo/sede/grupo).
4. **Diligenciamiento**: borrador, respuestas tipadas, repeticiones, adjuntos, firma y envío final.
5. **Sincronización**: IndexedDB, outbox idempotente, subida de adjuntos y reconciliación.
6. **Consulta**: lista del conductor, conteos diarios, historial y explorador administrativo.
7. **Auditoría**: eventos de definición, publicación, asignación, envío, anulación y sincronización.

## 2. Agregados e invariantes

### Formulario y versión

- `form` es la identidad estable: código HSEQ, slug, nombre y propietario funcional.
- `form_version` contiene una revisión completa. Solo `DRAFT` acepta cambios.
- `PUBLISHED` requiere al menos una sección y un campo diligenciable, claves únicas, reglas válidas y asignaciones referenciando esa versión.
- Publicar bloquea estructuralmente la versión. `PUT` sobre publicada responde `409 VERSION_IMMUTABLE`.
- “Editar” una versión publicada ejecuta `POST /versions/:id/clone`, incrementa `version_number` y crea borrador.
- Archivar evita nuevas asignaciones/envíos, pero conserva consulta histórica.

### Cards y utilidades

- La paleta define tipos, no registros globales compartidos. Cada drag crea un `field` independiente con `key`, etiqueta, ayuda, obligatoriedad, configuración y reglas.
- `field_template` guarda cards configuradas para reutilización. Insertarla copia su snapshot; editar la plantilla no cambia formularios existentes.
- Secciones y campos tienen `sort_order` entero espaciado (100, 200, 300). Al soltar se renumera la colección en una sola transacción.
- `parent_field_id` modela grupos/tablas repetibles; sus hijos definen columnas. No se almacenan grids de Excel como UI rígida.

### Asignación y recurrencia

- Una asignación apunta a una versión publicada exacta.
- Targets admitidos: `ALL_CONDUCTORS`, `CONDUCTOR`, `VEHICLE`, `SEDE`, `GROUP`.
- Frecuencia: `ON_DEMAND`, `ONCE`, `DAILY`, `WEEKLY`, `MONTHLY`, `PER_SERVICE`.
- Política de límite: `UNLIMITED`, `ONE_PER_PERIOD`, `ONE_PER_CONTEXT`.
- La zona de negocio es `America/Bogota`; `business_date` se calcula en servidor y evita que UTC altere el conteo diario.
- Para preoperacionales, el contexto obligatorio incluye vehículo y la clave de unicidad lógica es asignación + conductor + vehículo + período.

### Envío

- Estados persistidos: `DRAFT`, `SUBMITTED`, `VOIDED`. `SYNCING`/`FAILED` son estados locales de la outbox, no del servidor.
- `SUBMITTED` es terminal e inmutable. Solo un administrador autorizado puede crear un evento `VOIDED`; nunca reabre el registro.
- Una corrección crea un nuevo envío con `supersedes_submission_id` y conserva ambos.
- Cada envío guarda `client_submission_id` UUID generado en el dispositivo. Es único y hace idempotente el POST.
- Respuestas referencian `field_id` de la misma `form_version_id`. Campos repetibles comparten `occurrence_id` y `row_index`.
- Opciones seleccionadas se normalizan en `form_answer_option`; valores complejos controlados pueden usar `value_json`.

## 3. Tipos de campo v1

| Tipo | Valor | Usos de las fuentes |
|---|---|---|
| `SHORT_TEXT` | texto | placa, sede, cargo, marca |
| `LONG_TEXT` | texto | observaciones, descripción de falla |
| `INTEGER` / `DECIMAL` | número | cantidad, kilómetros, horas de sueño |
| `DATE` / `TIME` / `DATETIME` | temporal | inspección, vencimiento, cierre |
| `SINGLE_CHOICE` | opción | C/NC/NA, B/M/R, criticidad |
| `MULTIPLE_CHOICE` | opciones | clases, elementos, categorías |
| `BOOLEAN` | booleano | sí/no |
| `SIGNATURE` | adjunto + metadata | quien inspecciona/entrega/recibe |
| `PHOTO` / `FILE` | adjunto | registro visual, evidencia |
| `LOCATION` | JSON geográfico | lugar opcional con GPS |
| `INFO` | sin respuesta | instrucciones, declaraciones |
| `REPEATABLE_GROUP` | ocurrencias hijas | acciones, hallazgos, inventarios |
| `MATRIX` | respuestas hijas | listas C/NC/NA o inspecciones periódicas |
| `LOOKUP` | UUID + snapshot | conductor, vehículo, servicio |
| `CALCULATED` | valor derivado | totales/porcentajes; fórmula declarativa segura |

`config_json` contiene propiedades específicas (mínimo/máximo, precisión, captura GPS, cantidad de fotos, orientación, columnas). `validation_json` contiene reglas declarativas. No se evalúa JavaScript almacenado en base de datos.

## 4. Reglas condicionales

Formato canónico:

```json
{
  "version": 1,
  "all": [
    { "fieldKey": "estado", "operator": "equals", "value": "NC" }
  ],
  "effect": { "action": "require", "targetFieldKey": "observacion" }
}
```

Operadores v1: `equals`, `notEquals`, `in`, `notIn`, `exists`, `gt`, `gte`, `lt`, `lte`. Efectos: `show`, `hide`, `require`, `disable`. Se valida ausencia de ciclos antes de publicar. Backend y frontend comparten tipos y casos de prueba; el backend vuelve a validar todo al enviar.

## 5. Integración con el repositorio

### Backend

- Nuevo módulo `backend-nest/src/modules/formularios-dinamicos/` con routes, schemas Zod, controller, service, repository y gateway.
- Registro en `backend-nest/src/app.ts` con prefijo `/api`.
- Extensión de socket auth para conservar `tipo` y aceptar rooms de conductor resueltas por token, no por IDs enviados por cliente.
- Reutilizar S3/presigned URLs y validaciones de MIME/tamaño; no guardar base64 en PostgreSQL.

### Frontend

- CRUD en `src/routes/dashboard/formularios` y componentes en `src/lib/components/formularios`.
- Portal en `src/routes/public/portal/formularios` y detalle `/[assignmentId]`.
- API tipada en `src/lib/api/formularios.ts`, almacenamiento local en `src/lib/offline/forms-db.ts` y sincronizador en `src/lib/offline/forms-sync.ts`.
- Agregar permiso `formularios`: acceso full para `administracion` y `hseq`, lectura de envíos para `operaciones` si se aprueba en producto.
- Añadir entrada “Formularios” al sidebar del dashboard y bottom/sidebar del portal.

## 6. Observabilidad y seguridad

- Logs estructurados: `request_id`, `actor_id`, `actor_type`, `form_id`, `version_id`, `assignment_id`, `submission_id`, `client_submission_id`.
- Métricas: latencia de listado/envío, envíos idempotentes repetidos, profundidad y edad de outbox reportada, fallos de adjuntos y conflictos de versión.
- Nunca confiar en `conductor_id`, `created_by` o targets enviados como identidad. Se derivan del JWT.
- Sanitizar textos, limitar JSON, cantidad de respuestas, filas repetibles y adjuntos.
- Las definiciones publicadas pueden cachearse como privadas con ETag; nunca cachear respuestas de otro conductor en Cache Storage compartida.


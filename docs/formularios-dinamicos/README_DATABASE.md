# Modelo de datos y SQL manual

## Regla operativa

Este documento propone el esquema. Claude debe actualizar `backend-nest/prisma/schema.prisma` y `backend-nest/prisma/schema.production.prisma`, crear una migración manual `backend-nest/prisma/migrations/19-08-2026-formularios-dinamicos/migration.sql`, y limitarse a `prisma format`, `prisma validate` y `prisma generate`.

**No debe leer `DATABASE_URL`, abrir PSQL, ejecutar migraciones, `db push`, `db pull`, Prisma Studio ni conectarse a ninguna base.** El usuario copiará y ejecutará el SQL cuando lo considere seguro.

## Relaciones principales

```text
form_definitions 1--N form_versions 1--N form_sections 1--N form_fields
                                           form_fields 1--N form_field_options
                                           form_fields 1--N form_fields (parent)
form_versions 1--N form_assignments 1--N form_assignment_targets
form_assignments 1--N form_submissions 1--N form_answers N--M form_field_options
                                      form_submissions 1--N form_attachments
                                      form_submissions 1--N form_submission_events
form_field_templates (biblioteca independiente; se copia al insertar)
```

## SQL propuesto

El SQL usa enums de texto con `CHECK` para facilitar futuras extensiones sin alterar tipos enum de PostgreSQL.

```sql
BEGIN;

CREATE TABLE form_definitions (
  id UUID PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  owner_area VARCHAR(80) NOT NULL DEFAULT 'hseq',
  created_by_id UUID NOT NULL REFERENCES users(id),
  updated_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ(6),
  CONSTRAINT uq_form_definitions_code UNIQUE (code),
  CONSTRAINT uq_form_definitions_slug UNIQUE (slug)
);

CREATE TABLE form_versions (
  id UUID PRIMARY KEY,
  form_id UUID NOT NULL REFERENCES form_definitions(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  title VARCHAR(255) NOT NULL,
  description TEXT,
  instructions TEXT,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by_id UUID NOT NULL REFERENCES users(id),
  published_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ(6),
  archived_at TIMESTAMPTZ(6),
  CONSTRAINT ck_form_versions_status CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  CONSTRAINT ck_form_versions_number CHECK (version_number > 0),
  CONSTRAINT ck_form_versions_revision CHECK (revision > 0),
  CONSTRAINT uq_form_versions_number UNIQUE (form_id, version_number)
);

CREATE TABLE form_sections (
  id UUID PRIMARY KEY,
  version_id UUID NOT NULL REFERENCES form_versions(id) ON DELETE CASCADE,
  key VARCHAR(120) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_form_sections_key UNIQUE (version_id, key),
  CONSTRAINT uq_form_sections_order UNIQUE (version_id, sort_order)
);

CREATE TABLE form_fields (
  id UUID PRIMARY KEY,
  version_id UUID NOT NULL REFERENCES form_versions(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES form_sections(id) ON DELETE CASCADE,
  parent_field_id UUID REFERENCES form_fields(id) ON DELETE CASCADE,
  key VARCHAR(120) NOT NULL,
  type VARCHAR(40) NOT NULL,
  label VARCHAR(500) NOT NULL,
  help_text TEXT,
  placeholder VARCHAR(500),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility_rule_json JSONB,
  default_value_json JSONB,
  CONSTRAINT ck_form_fields_type CHECK (type IN (
    'SHORT_TEXT','LONG_TEXT','INTEGER','DECIMAL','DATE','TIME','DATETIME',
    'SINGLE_CHOICE','MULTIPLE_CHOICE','BOOLEAN','SIGNATURE','PHOTO','FILE',
    'LOCATION','INFO','REPEATABLE_GROUP','MATRIX','LOOKUP','CALCULATED'
  )),
  CONSTRAINT uq_form_fields_key UNIQUE (version_id, key),
  CONSTRAINT uq_form_fields_order UNIQUE (section_id, parent_field_id, sort_order)
);

CREATE TABLE form_field_options (
  id UUID PRIMARY KEY,
  field_id UUID NOT NULL REFERENCES form_fields(id) ON DELETE CASCADE,
  value VARCHAR(120) NOT NULL,
  label VARCHAR(255) NOT NULL,
  color VARCHAR(20),
  score DECIMAL(12,2),
  sort_order INTEGER NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_form_field_options_value UNIQUE (field_id, value),
  CONSTRAINT uq_form_field_options_order UNIQUE (field_id, sort_order)
);

CREATE TABLE form_field_templates (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  field_type VARCHAR(40) NOT NULL,
  template_json JSONB NOT NULL,
  owner_area VARCHAR(80),
  is_global BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ(6)
);

CREATE TABLE form_assignments (
  id UUID PRIMARY KEY,
  version_id UUID NOT NULL REFERENCES form_versions(id),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  frequency VARCHAR(30) NOT NULL DEFAULT 'ON_DEMAND',
  limit_policy VARCHAR(30) NOT NULL DEFAULT 'UNLIMITED',
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Bogota',
  starts_at TIMESTAMPTZ(6),
  ends_at TIMESTAMPTZ(6),
  context_schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ(6),
  CONSTRAINT ck_form_assignments_status CHECK (status IN ('ACTIVE','PAUSED','CLOSED')),
  CONSTRAINT ck_form_assignments_frequency CHECK (frequency IN ('ON_DEMAND','ONCE','DAILY','WEEKLY','MONTHLY','PER_SERVICE')),
  CONSTRAINT ck_form_assignments_limit CHECK (limit_policy IN ('UNLIMITED','ONE_PER_PERIOD','ONE_PER_CONTEXT')),
  CONSTRAINT ck_form_assignments_dates CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE form_assignment_targets (
  id UUID PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES form_assignments(id) ON DELETE CASCADE,
  target_type VARCHAR(30) NOT NULL,
  conductor_id UUID REFERENCES conductores(id),
  vehicle_id UUID REFERENCES vehiculos(id),
  sede VARCHAR(80),
  group_key VARCHAR(120),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_form_assignment_targets_type CHECK (target_type IN ('ALL_CONDUCTORS','CONDUCTOR','VEHICLE','SEDE','GROUP')),
  CONSTRAINT ck_form_assignment_targets_value CHECK (
    (target_type = 'ALL_CONDUCTORS' AND conductor_id IS NULL AND vehicle_id IS NULL AND sede IS NULL AND group_key IS NULL) OR
    (target_type = 'CONDUCTOR' AND conductor_id IS NOT NULL AND vehicle_id IS NULL AND sede IS NULL AND group_key IS NULL) OR
    (target_type = 'VEHICLE' AND conductor_id IS NULL AND vehicle_id IS NOT NULL AND sede IS NULL AND group_key IS NULL) OR
    (target_type = 'SEDE' AND conductor_id IS NULL AND vehicle_id IS NULL AND sede IS NOT NULL AND group_key IS NULL) OR
    (target_type = 'GROUP' AND conductor_id IS NULL AND vehicle_id IS NULL AND sede IS NULL AND group_key IS NOT NULL)
  )
);

CREATE TABLE form_submissions (
  id UUID PRIMARY KEY,
  client_submission_id UUID NOT NULL,
  assignment_id UUID NOT NULL REFERENCES form_assignments(id),
  version_id UUID NOT NULL REFERENCES form_versions(id),
  conductor_id UUID NOT NULL REFERENCES conductores(id),
  vehicle_id UUID REFERENCES vehiculos(id),
  service_id UUID REFERENCES servicios(id),
  supersedes_submission_id UUID REFERENCES form_submissions(id),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  business_date DATE NOT NULL,
  period_key VARCHAR(80),
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  device_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ(6),
  voided_at TIMESTAMPTZ(6),
  voided_by_id UUID REFERENCES users(id),
  void_reason TEXT,
  CONSTRAINT uq_form_submissions_client UNIQUE (client_submission_id),
  CONSTRAINT ck_form_submissions_status CHECK (status IN ('DRAFT','SUBMITTED','VOIDED')),
  CONSTRAINT ck_form_submissions_terminal CHECK (
    (status = 'DRAFT' AND submitted_at IS NULL AND voided_at IS NULL) OR
    (status = 'SUBMITTED' AND submitted_at IS NOT NULL AND voided_at IS NULL) OR
    (status = 'VOIDED' AND submitted_at IS NOT NULL AND voided_at IS NOT NULL AND voided_by_id IS NOT NULL)
  )
);

CREATE TABLE form_answers (
  id UUID PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES form_fields(id),
  occurrence_id UUID,
  row_index INTEGER,
  value_text TEXT,
  value_decimal DECIMAL(18,6),
  value_boolean BOOLEAN,
  value_date DATE,
  value_datetime TIMESTAMPTZ(6),
  value_json JSONB,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_form_answers_row CHECK (row_index IS NULL OR row_index >= 0),
  CONSTRAINT ck_form_answers_single_scalar CHECK (
    num_nonnulls(value_text, value_decimal, value_boolean, value_date, value_datetime, value_json) <= 1
  )
);

CREATE UNIQUE INDEX uq_form_answers_scalar
  ON form_answers (submission_id, field_id)
  WHERE occurrence_id IS NULL;
CREATE UNIQUE INDEX uq_form_answers_occurrence
  ON form_answers (submission_id, field_id, occurrence_id)
  WHERE occurrence_id IS NOT NULL;

CREATE UNIQUE INDEX uq_form_fields_top_order
  ON form_fields (section_id, sort_order)
  WHERE parent_field_id IS NULL;

CREATE TABLE form_answer_options (
  answer_id UUID NOT NULL REFERENCES form_answers(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES form_field_options(id),
  PRIMARY KEY (answer_id, option_id)
);

CREATE TABLE form_attachments (
  id UUID PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  answer_id UUID REFERENCES form_answers(id) ON DELETE CASCADE,
  client_attachment_id UUID NOT NULL,
  kind VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  object_key VARCHAR(1024),
  original_name VARCHAR(255),
  mime_type VARCHAR(150) NOT NULL,
  byte_size BIGINT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  uploaded_at TIMESTAMPTZ(6),
  CONSTRAINT uq_form_attachments_client UNIQUE (client_attachment_id),
  CONSTRAINT ck_form_attachments_kind CHECK (kind IN ('PHOTO','FILE','SIGNATURE')),
  CONSTRAINT ck_form_attachments_status CHECK (status IN ('PENDING','UPLOADED','FAILED')),
  CONSTRAINT ck_form_attachments_size CHECK (byte_size > 0)
);

CREATE TABLE form_submission_events (
  id UUID PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  actor_type VARCHAR(20) NOT NULL,
  actor_id UUID,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_form_submission_events_actor CHECK (actor_type IN ('CONDUCTOR','USER','SYSTEM'))
);

CREATE INDEX idx_form_definitions_active ON form_definitions (updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_form_versions_form_status ON form_versions (form_id, status, version_number DESC);
CREATE INDEX idx_form_sections_version_order ON form_sections (version_id, sort_order);
CREATE INDEX idx_form_fields_version_section_order ON form_fields (version_id, section_id, sort_order);
CREATE INDEX idx_form_fields_parent_order ON form_fields (parent_field_id, sort_order) WHERE parent_field_id IS NOT NULL;
CREATE INDEX idx_form_assignments_active_window ON form_assignments (status, starts_at, ends_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_form_assignment_targets_conductor ON form_assignment_targets (conductor_id, assignment_id) WHERE conductor_id IS NOT NULL;
CREATE INDEX idx_form_assignment_targets_vehicle ON form_assignment_targets (vehicle_id, assignment_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_form_assignment_targets_sede ON form_assignment_targets (sede, assignment_id) WHERE sede IS NOT NULL;
CREATE INDEX idx_form_submissions_portal ON form_submissions (conductor_id, business_date DESC, status);
CREATE INDEX idx_form_submissions_admin ON form_submissions (assignment_id, submitted_at DESC) WHERE status = 'SUBMITTED';
CREATE INDEX idx_form_submissions_version ON form_submissions (version_id, submitted_at DESC);
CREATE INDEX idx_form_submissions_vehicle ON form_submissions (vehicle_id, business_date DESC) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_form_answers_submission ON form_answers (submission_id);
CREATE INDEX idx_form_answers_field ON form_answers (field_id);
CREATE INDEX idx_form_attachments_pending ON form_attachments (status, created_at) WHERE status <> 'UPLOADED';
CREATE INDEX idx_form_events_submission_time ON form_submission_events (submission_id, created_at);

COMMIT;
```

## Restricciones que implementa el servicio

Algunas invariantes cruzan muchas tablas y se mantienen en transacciones de aplicación:

- La sección/campo/opción pertenece a la versión del agregado modificado.
- Solo se modifica una versión `DRAFT`.
- Una asignación solo usa versión `PUBLISHED`.
- Cada respuesta usa un field de la misma versión del envío.
- Solo `MATRIX`/`REPEATABLE_GROUP` admite ocurrencias.
- Un `SUBMITTED` no acepta `UPDATE`/`DELETE` de respuestas o adjuntos.
- La política `ONE_PER_PERIOD`/`ONE_PER_CONTEXT` se confirma con transacción y bloqueo lógico; `client_submission_id` cubre reintentos de red.

## Prisma

Mapear tablas con nombres en minúscula mediante `@@map`. Mantener UUID como `@db.Uuid`, textos limitados con `@db.VarChar`, decimales con `@db.Decimal`, y timestamps con `@db.Timestamptz(6)`. Agregar relaciones a `usuarios`, `conductores`, `vehiculos` y `servicio` con nombres explícitos para evitar colisiones.

## Verificación manual posterior

Estas consultas son de solo lectura y las ejecuta el usuario después de aplicar el SQL:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'form_%'
ORDER BY table_name;

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name LIKE 'form_%'
ORDER BY table_name, ordinal_position;

SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public' AND tablename LIKE 'form_%'
ORDER BY tablename, indexname;

SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid::regclass::text LIKE 'form_%'
ORDER BY conrelid::regclass::text, conname;
```

# Inventario y semillas HSEQ

## Fuente y criterio

Fuente: `/Users/julianlopez/Downloads/documentos_transmeralda.zip`, inspeccionado el 19-08-2026. Contiene 13 libros Excel. Las hojas “Control de Cambios” son metadata documental, no preguntas. Los textos se conservan fielmente en el primer borrador, incluyendo términos que HSEQ debe corregir antes de publicar.

Cuando el nombre del archivo y el encabezado interno discrepan, `source_metadata` conserva ambos y el encabezado interno se considera la revisión documental de origen. La `version_number` del motor dinámico empieza en 1 porque representa otra línea de versionado.

Formato de metadata por semilla:

```json
{
  "sourceFile": "...xlsx",
  "sourceCode": "HSEQ-FR-08",
  "sourceRevision": "6",
  "sourceDate": "2025-07-16",
  "importedAt": "2026-08-19",
  "importStatus": "DRAFT_REQUIRES_HSEQ_REVIEW"
}
```

## Inventario

| Código | Formulario | Estructura dinámica recomendada | Frecuencia sugerida |
|---|---|---|---|
| HSEQ-FR-56 | Acta de entrega/recibo de tractocamión | datos vehículo, checklist B/M/R, botiquín, fotos, observaciones, inventario repetible, firmas entrega/recibe | `ONCE`, por entrega y vehículo |
| HSEQ-FR-43 | Inspección ambiental | inspector/sede, secciones ambientales, matriz C/NC/NA + recomendación, firma | `MONTHLY`, por sede |
| HSEQ-FR-17 | Inspección férula/camilla | checklist C/NC/NA + observación, hallazgos/acciones | `MONTHLY`, por vehículo/sede |
| HSEQ-FR-21 | Inspección productos químicos | checklist C/NC, observaciones, plan de acción repetible y firma | `MONTHLY`, por sede |
| HSEQ-FR-04 | Inspección extintores | datos del extintor, checklist C/NC/NA, condiciones de seguridad repetibles | `MONTHLY`, por activo/vehículo |
| HSEQ-FR-40 | Inspección de residuos | inspector/sede, checklist SI/NO/NA, observaciones y firma | `MONTHLY`, por sede |
| HSEQ-FR-42 | PQRSAF | tipo, requirente, descripción, tratamiento, cierre y firma | `ON_DEMAND`, ilimitado |
| HSEQ-FR-33 | Tarjeta de observación | datos del observador, descripción, correctivos, catálogo de actos/condiciones y reconocimiento | `ON_DEMAND`, ilimitado |
| HSEQ-FR-22 | Inspección kit de derrames | datos inspección, inventario completo/incompleto/cantidad faltante, observaciones, acciones | `MONTHLY`, por vehículo/sede |
| HSEQ-FR-09 | Preoperacional buses/busetas/microbuses | vehículo/documentos, checklist diario por secciones, salud/fatiga, EPP, combustible/KM, novedades, firma/fotos | `DAILY`, uno por conductor+vehículo+fecha |
| HSEQ-FR-08 | Preoperacional automóviles/camperos/camionetas | igual patrón preoperacional ajustado a clase, propiedad cliente y revisión final | `DAILY`, uno por conductor+vehículo+fecha |
| HSEQ-FR-07 | Reporte de falla | activo/recurso, clase, descripción, criticidad, análisis, solución y tres actores/firma | `ON_DEMAND`, ilimitado |
| HSEQ-FR-05 | Inspección de botiquín | inventario con cantidad/vencimiento/B-M-C/R, reposiciones, ubicación, inspector y firma | `MONTHLY`, por vehículo/sede |

Las frecuencias son defaults editables y no generan asignaciones activas al importar.

## Patrones reutilizables

Crear plantillas de cards independientes antes de transcribir los formularios:

1. `estado_c_nc_na`: `SINGLE_CHOICE` con Cumple/No cumple/No aplica.
2. `estado_si_no_na`: `SINGLE_CHOICE` con Sí/No/No aplica.
3. `estado_b_m_r`: `SINGLE_CHOICE` con Bueno/Malo/Regular.
4. `estado_b_m_cr`: Bueno/Malo/Cambiar-Reemplazar.
5. `hallazgo_plan_accion`: grupo repetible con descripción, medida/actividad, responsable, cargo, recursos y fecha.
6. `identificacion_inspector`: nombre, cargo, sede/lugar, fecha y firma.
7. `contexto_vehiculo`: lookup vehículo con snapshot de placa, marca, clase y modelo.
8. `evidencia_fotografica`: foto múltiple con descripción opcional.
9. `declaracion_firma`: bloque informativo + firma + nombre/documento autocompletado.

Insertar una plantilla siempre copia sus fields/options/config; no se vincula en vivo.

## Desglose de semillas

### HSEQ-FR-08 y HSEQ-FR-09 — preoperacionales

Secciones comunes:

1. Información y documentos del vehículo.
2. Motor, fluidos y batería.
3. Llantas/rines y exterior.
4. Cabina; HSEQ-FR-09 añade zona de pasajeros.
5. Tablero/testigos, luces y pruebas.
6. Limpieza, herramientas, kit carretera, botiquín, extintor, EPP.
7. Salud y fatiga: horas de sueño/descanso, síntomas, medicamentos, alergias y pausas.
8. Combustible, kilometraje y FUEC.
9. Verificación durante desplazamiento, propiedad del cliente y revisión final.
10. Novedades, registro visual y firma.

Cada ítem de inspección es una card/matrix con estado `B/M/NA` y observación condicional requerida cuando `M`. Las siete columnas de fecha del Excel no se importan como siete columnas: cada diligenciamiento representa un día y conserva historial por submission.

### HSEQ-FR-56 — entrega/recibo

- Contexto de sede, fecha, vehículo, kilometraje, propietario y documentos.
- Checklists por motor, luces, llantas, tablero, pruebas, cabina, exterior y limpieza.
- Inventario de botiquín con cantidad/estado y herramientas en grupo repetible.
- Registro visual multiphoto y nueve observaciones iniciales representadas como grupo repetible, no nueve campos rígidos.
- Dos firmas independientes: entrega y recibe.

### HSEQ-FR-43 y HSEQ-FR-40 — ambiente/residuos

- FR-43 agrupa impactos/generalidades, residuos sólidos, residuos líquidos, vertimientos y químicos. Cada pregunta usa C/NC/NA; `NC` exige recomendación.
- FR-40 contiene diez parámetros de aprovechamiento, energía, agua y residuos. Cada `NO` exige observación/acción.
- Las seis inspecciones paralelas impresas del Excel se convierten en envíos mensuales independientes.

### HSEQ-FR-04, 17, 21 y 22 — equipos/insumos

- FR-04 añade datos del extintor (ubicación, capacidad, carga, vencimiento, anillo y número) antes del checklist.
- FR-17 usa checklist de ubicación, señalización, arnés/riatas y estado físico de camilla, con hallazgos.
- FR-21 contiene 12 criterios de almacenamiento/manipulación de químicos y plan de acción.
- FR-22 inventaría 11 elementos de kit, cantidad esperada, completo/incompleto y cantidad faltante.

Las columnas repetidas por fechas impresas se convierten en submissions; no se duplican campos por mes.

### HSEQ-FR-05 — botiquín

- Grupo de aproximadamente 33 elementos con unidad, cantidad existente, vencimiento y estado B/M/C-R.
- Reposición/cambio se captura como grupo repetible asociado al elemento.
- Ubicación/sede o placa, inspector, fecha y firma.
- La repetición horizontal de seis inspecciones del libro se normaliza como historial de envíos.

### HSEQ-FR-07 — reporte de falla

- Fecha/hora y consecutivo servidor.
- Recurso propio/alquilado y clase: vehículo/equipo/herramienta/infraestructura/otro.
- Nombre, marca, serie/código, descripción y evidencia.
- Criticidad `ALTO/MODERADO/LEVE` con textos del documento como ayuda.
- Análisis de causa y posibles soluciones/recursos.
- Firmas/fechas de quien reporta, líder y Administración/Compras.

El duplicado impreso en la misma hoja no genera dos formularios.

### HSEQ-FR-42 — PQRSAF

Tomar la hoja “Formato” más completa: petición, queja, reclamo, sugerencia, apelación, felicitación y servicio no conforme. Incluye tipo de requirente, empresa/NIT, datos personales, categoría, involucrados, detalle, tratamiento, concepto de cierre, fecha y firma.

El tratamiento/cierre puede ser diligenciado administrativamente en una fase futura. En v1 se modelan fields con permisos de rol en `config_json` (`editableBy: ['USER']` o `['CONDUCTOR']`), aunque el runner inicial solo presenta campos del conductor.

### HSEQ-FR-33 — tarjeta de observación

Secciones de descripción, correctivos propuestos, actos/condiciones subestándar, actos/condiciones seguras y condición de salud. El catálogo jerárquico (normas/procedimientos, EPP, emergencias, señalización, cargas, seguridad vial, químicos, aguas, orden/aseo, residuos, reconocimientos y otros) se representa como opciones agrupadas, no como decenas de booleanos visualmente inconexos.

## Artefactos de semilla

Crear un archivo JSON/TypeScript por código en `backend-nest/prisma/seeds/formularios-hseq/`, más un índice que valide claves, tipos, opciones y reglas sin conectarse a la base. Cada semilla debe:

- tener IDs determinísticos UUIDv5 o claves estables;
- ser idempotente por `code + sourceRevision`;
- crear `DRAFT`, nunca `PUBLISHED`;
- no crear assignment targets;
- registrar `source_metadata` y warnings de transcripción;
- compartir factories de patrones, pero materializar fields independientes.

No ejecutar el seed desde el agente. La carga real queda en manos del usuario después de revisar SQL/esquema y contenido HSEQ.

## Checklist HSEQ previo a publicar

- Confirmar código, revisión y fecha contra el encabezado del archivo.
- Corregir ortografía sin cambiar el sentido normativo.
- Definir required, NA permitido y observaciones obligatorias por estado negativo.
- Confirmar frecuencia, target, vehículo/sede y ventana de vigencia.
- Revisar datos personales, firma, fotos y retención.
- Verificar límites y mensajes de criticidad.
- Probar en teléfono pequeño y modo avión.
- Firmar aprobación funcional fuera del sistema antes de activar assignments.


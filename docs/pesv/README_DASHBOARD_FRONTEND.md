# Dashboard frontend PESV

## Objetivo

Reemplazar la pantalla concentrada en estadísticas y modales manuales por un centro de trabajo
orientado a cumplimiento. `src/routes/dashboard/pesv/+page.svelte` queda como orquestador; las
vistas, tablas, indicadores, evidencias y diálogos viven en componentes separados.

## Navegación

1. **Resumen:** cumplimiento global/por fase, alertas críticas y pendientes del usuario.
2. **24 pasos:** matriz normativa con estado, responsable, plazo y evidencias.
3. **Indicadores:** las 13 fichas, tendencia, meta, fórmula y procedencia.
4. **Operación segura:** jornada, velocidad, inspecciones, siniestros y desplazamientos.
5. **Documentos:** vencimientos y faltantes por conductor, vehículo, tercero y contrato.
6. **Plan anual:** listado/calendario de actividades, metas, programas y soportes.
7. **Contratos/FUEC:** cobertura por servicio y enlaces a Extractos.

La URL conserva `vista`, `anio`, `trimestre`, `mes`, `estado`, `area`, `responsable`, `q` y
`pagina`. Los valores por defecto no se escriben. Búsqueda, back/forward, recarga y enlaces
compartidos usan el núcleo común de listados.

## Componentes previstos

- Encabezado de ciclo y selector de periodo.
- `ResumenCumplimiento`, `MatrizPasos`, `DetallePaso` y `BandejaEvidencias`.
- `TarjetaIndicador`, `DetalleIndicador` y `CoberturaDatos`.
- Tablas de operación, documentos y cobertura FUEC.
- Plan anual con listado y calendario reutilizando la funcionalidad actual.
- Modales de evidencia, revisión, riesgo, meta, siniestro y evento manual autorizado.

## Comportamiento

- Cada tarjeta muestra valor, meta, periodo, tendencia y estado textual además del color.
- `SIN_DATOS` explica insumos ausentes y ofrece un enlace para corregirlos.
- Un paso no muestra `CUMPLE` si tiene soporte obligatorio pendiente, rechazado o vencido.
- El detalle de indicador muestra fórmula y registros incluidos/excluidos.
- Las acciones se adaptan al nivel de permiso recibido por API; la UI no sustituye la
  autorización del servidor.
- HSEQ dispone de bandeja de revisión; un aportante ve sus pendientes, pero no puede aprobar.
- No se vuelve a ofrecer registro manual de preoperacional cuando Formularios es la fuente.

## Diseño y accesibilidad

- Svelte 5 con runes y TypeScript sin `any` en contratos nuevos.
- Página a ancho completo, rejillas fluidas y tablas con scroll local.
- Estados expresados con icono, color y texto.
- Foco visible, navegación por teclado, diálogos accesibles y objetivos táctiles de 44 px.
- Gráficos siempre acompañados por valor o tabla accesible.
- Carga independiente por vista y skeletons que no bloquean toda la ruta.

## Integraciones visibles

Los enlaces profundos deben conservar entidad y periodo al navegar a Flota, Conductores,
Servicios, Formularios/Envíos, Asistencias, Evaluaciones, Acciones Correctivas, Terceros y
Extractos. Al volver, la URL restaura el contexto PESV.


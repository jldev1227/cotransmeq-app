# Fichas individuales

Las fichas de conductor, vehículo, cliente y tercero se consultan en páginas individuales:

- `/dashboard/conductores/:id`
- `/dashboard/flota/:id`
- `/dashboard/clientes/:id`
- `/dashboard/terceros/:id`

Los listados navegan a estas páginas al seleccionar una fila o la acción de ver detalles.
La presentación sigue el patrón de perfil de Segispro, sin portada: cabecera de identidad,
pestañas subrayadas y una distribución de introducción lateral con contenido principal.
La ficha abre en **Actividad y analítica** para mostrar el resumen operativo sin un paso
adicional. Permite consultar el período por mes, semana o rango de fechas y avisa de forma
explícita cuando el período no tiene movimientos.

Los indicadores vienen de `/api/analitica-individual/:tipo/:id`; el navegador no suma
registros contables. `servicios_desplazamientos` aplica una regla única para conductor,
vehículo y cliente: si una planilla tiene `servicio_id`, ambos representan el mismo
movimiento. Las planillas sin servicio y los servicios sin planilla sí cuentan por separado.
El conteo de preoperacionales reconoce el propósito PESV y los formularios históricos cuyo
nombre indica preoperacional. Los envíos del período enlazan a su detalle. Los FUEC vigentes
del conductor, vehículo y cliente enlazan al extracto; el conteo de FUEC vencidos del
conductor corresponde al período consultado. Si un vehículo no tiene FUEC vigente,
muestra sus cinco extractos más recientes. El conductor puede abrir los FUEC vencidos
del período desde la ficha.

## Contenido por entidad

- Conductor: jornadas por estado, días registrados y sin registro, kilometraje, horas,
  nómina, recargos, bonificaciones, formularios, preoperacionales, asistencias, evaluaciones,
  mantenimientos y FUEC vigente o último FUEC vencido.
- Vehículo: servicios, kilometraje, rotación de conductores, días y órdenes de mantenimiento,
  formularios, preoperacionales, actas de entrega, recargos y documentos vencidos, próximos
  a vencer o sin fecha de vigencia.
- Cliente: servicios/desplazamientos, planillas, tramos, kilometraje, recargos, datos faltantes,
  sede principal, frecuencia semanal, zonas frecuentes y mapa Mapbox con hotspots por municipio.
  El mapa usa el estilo Mapbox Outdoors, igual que el detalle individual del servicio. Los mapas de clientes y servicios se muestran en vista plana, sin inclinación ni giro.
  Las líneas entre origen y destino son azules (`#2563eb`); los puntos de frecuencia conservan el verde.
  Los hotspots usan coordenadas exactas del servicio y, cuando faltan, el centro del municipio.
  El selector superior Período/Histórico controla las métricas, zonas y mapa a la vez.
  Al cambiar las fechas vuelve a la vista del período.
- Tercero: datos faltantes, notas, vehículos afiliados y cierres finales del período.

La URL conserva la pestaña con `tab` y el filtro con `periodo=mes|semana|rango`.
`fecha=AAAA-MM-DD` fija el mes o la semana; `desde` y `hasta` fijan un rango.
`vista=historico` abre toda la actividad histórica del cliente; los enlaces antiguos
con `mapa=historico` siguen funcionando. Estas opciones permiten
recargar, compartir el enlace y usar Atrás/Adelante sin perder la selección.

Los cambios de propietario corresponden a la afiliación vigente del vehículo. Las
liquidaciones y cierres ya generados conservan sus propios snapshots y relaciones históricas.
La ficha del vehículo permite vincular un tercero propietario mediante
`tercero_propietario_id` desde **Editar vehículo**; el nombre y la identificación siguen
siendo el snapshot visible.

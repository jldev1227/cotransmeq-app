import type { AccionCorrectivaPreventiva, EstadisticasAcciones } from '$lib/api/acciones-correctivas';

export const estadisticas: EstadisticasAcciones = {
	total: 47,
	por_estado: { 'En Proceso': 18, Cumplidas: 22, Vencidas: 7 },
	por_tipo: { CORRECTIVA: 30, PREVENTIVA: 12, MEJORA: 5 },
	por_riesgo: { ALTO: 15, MEDIO: 20, BAJO: 12 },
	proximas_vencer: 5
};

export const acciones: AccionCorrectivaPreventiva[] = [
	{
		id: 'ac-001',
		accion_numero: 'A26_01',
		descripcion_hallazgo:
			'No se realizó calibración de equipos de medición en el área de producción según programa establecido',
		tipo_accion_ejecutar: 'CORRECTIVA',
		estado_accion: 'En Proceso',
		valoracion_riesgo: 'ALTO',
		tipo_hallazgo_detectado: 'NC Mayor',
		lugar_sede: 'Planta Principal',
		proceso_origen_hallazgo: 'Producción',
		fecha_identificacion_hallazgo: '2025-11-15',
		fecha_limite_cierre_accion: '2026-02-15',
		fecha_limite_evaluacion_eficacia: '2026-04-15',
		responsable_ejecucion: 'Carlos Mendoza',
		causas: [
			{ orden: 1, analisis_causa: '', estado_seguimiento: 'Cumplida', fecha_limite_implementacion: '2025-12-20' },
			{ orden: 2, analisis_causa: '', estado_seguimiento: 'Cumplida', fecha_limite_implementacion: '2026-01-10' },
			{ orden: 3, analisis_causa: '', estado_seguimiento: 'En Proceso', fecha_limite_implementacion: '2026-02-01' },
			{ orden: 4, analisis_causa: '', estado_seguimiento: 'Vencida', fecha_limite_implementacion: '2026-01-15' },
			{ orden: 5, analisis_causa: '', estado_seguimiento: 'Cumplida', fecha_limite_implementacion: '2026-01-25' }
		],
		seguimientos_correccion: [{ fecha_seguimiento: '2026-01-20', estado_accion: 'En Proceso' }],
		estado_global: 'EN_PROCESO',
		created_at: '2025-11-16T08:00:00Z',
		updated_at: '2025-11-16T08:00:00Z',
		creado_por_id: 'admin'
	},
	{
		id: 'ac-002',
		accion_numero: 'A26_02',
		descripcion_hallazgo:
			'Documentación desactualizada en procedimiento de gestión de residuos peligrosos',
		tipo_accion_ejecutar: 'PREVENTIVA',
		estado_accion: 'Cumplidas',
		valoracion_riesgo: 'MEDIO',
		tipo_hallazgo_detectado: 'Observación',
		lugar_sede: 'Sede Norte',
		proceso_origen_hallazgo: 'Gestión Ambiental',
		fecha_identificacion_hallazgo: '2025-10-20',
		fecha_limite_cierre_accion: '2026-01-20',
		fecha_limite_evaluacion_eficacia: '2026-03-20',
		responsable_ejecucion: 'Ana Rodríguez',
		causas: [
			{ orden: 1, analisis_causa: '', estado_seguimiento: 'Cumplida', fecha_limite_implementacion: '2025-11-30' },
			{ orden: 2, analisis_causa: '', estado_seguimiento: 'Cumplida', fecha_limite_implementacion: '2025-12-15' }
		],
		seguimientos_correccion: [{ fecha_seguimiento: '2026-01-10', estado_accion: 'Cerrada' }],
		estado_global: 'CUMPLIDA',
		created_at: '2025-10-21T10:30:00Z',
		updated_at: '2025-10-21T10:30:00Z',
		creado_por_id: 'admin'
	},
	{
		id: 'ac-003',
		accion_numero: 'A26_03',
		descripcion_hallazgo: 'Falta de señalización en áreas de riesgo eléctrico del edificio B',
		tipo_accion_ejecutar: 'CORRECTIVA',
		estado_accion: 'Vencidas',
		valoracion_riesgo: 'ALTO',
		tipo_hallazgo_detectado: 'NC Menor',
		lugar_sede: 'Edificio B',
		proceso_origen_hallazgo: 'Mantenimiento',
		fecha_identificacion_hallazgo: '2025-09-05',
		fecha_limite_cierre_accion: '2025-12-05',
		fecha_limite_evaluacion_eficacia: '2026-02-05',
		responsable_ejecucion: 'Pedro Sánchez',
		causas: [
			{ orden: 1, analisis_causa: '', estado_seguimiento: 'Vencida', fecha_limite_implementacion: '2025-10-15' },
			{ orden: 2, analisis_causa: '', estado_seguimiento: 'En Proceso', fecha_limite_implementacion: '2026-01-30' },
			{ orden: 3, analisis_causa: '', estado_seguimiento: 'Vencida', fecha_limite_implementacion: '2025-11-01' }
		],
		seguimientos_correccion: [{ fecha_seguimiento: '2025-12-01', estado_accion: 'Vencida' }],
		estado_global: 'VENCIDA',
		created_at: '2025-09-06T14:00:00Z',
		updated_at: '2025-09-06T14:00:00Z',
		creado_por_id: 'admin'
	},
	{
		id: 'ac-004',
		accion_numero: 'A26_04',
		descripcion_hallazgo:
			'Incumplimiento en registros de limpieza de zona de almacenamiento temporal',
		tipo_accion_ejecutar: 'CORRECTIVA',
		estado_accion: 'Vencidas',
		valoracion_riesgo: 'MEDIO',
		tipo_hallazgo_detectado: 'NC Menor',
		lugar_sede: 'Bodega Central',
		proceso_origen_hallazgo: 'Logística',
		fecha_identificacion_hallazgo: '2025-11-01',
		fecha_limite_cierre_accion: '2026-01-10',
		fecha_limite_evaluacion_eficacia: '2026-03-10',
		responsable_ejecucion: 'Luis Torres',
		causas: [
			{ orden: 1, analisis_causa: '', estado_seguimiento: 'Vencida', fecha_limite_implementacion: '2025-12-01' },
			{ orden: 2, analisis_causa: '', estado_seguimiento: 'Vencida', fecha_limite_implementacion: '2025-12-20' }
		],
		seguimientos_correccion: [{ fecha_seguimiento: '2026-01-05', estado_accion: 'Vencida' }],
		estado_global: 'VENCIDA',
		created_at: '2025-11-02T09:00:00Z',
		updated_at: '2025-11-02T09:00:00Z',
		creado_por_id: 'admin'
	},
	{
		id: 'ac-005',
		accion_numero: 'A26_05',
		descripcion_hallazgo:
			'Plan de capacitación en seguridad sin evidencia de ejecución en el último trimestre',
		tipo_accion_ejecutar: 'PREVENTIVA',
		estado_accion: 'En Proceso',
		valoracion_riesgo: 'BAJO',
		tipo_hallazgo_detectado: 'Observación',
		lugar_sede: 'Recursos Humanos',
		proceso_origen_hallazgo: 'RRHH',
		fecha_identificacion_hallazgo: '2025-12-01',
		fecha_limite_cierre_accion: '2026-03-20',
		fecha_limite_evaluacion_eficacia: '2026-05-20',
		responsable_ejecucion: 'María García',
		causas: [
			{ orden: 1, analisis_causa: '', estado_seguimiento: 'Cumplida', fecha_limite_implementacion: '2026-01-15' },
			{ orden: 2, analisis_causa: '', estado_seguimiento: 'En Proceso', fecha_limite_implementacion: '2026-02-20' },
			{ orden: 3, analisis_causa: '', estado_seguimiento: 'En Proceso', fecha_limite_implementacion: '2026-03-10' }
		],
		seguimientos_correccion: [{ fecha_seguimiento: '2026-02-01', estado_accion: 'En Proceso' }],
		estado_global: 'EN_PROCESO',
		created_at: '2025-12-02T11:00:00Z',
		updated_at: '2025-12-02T11:00:00Z',
		creado_por_id: 'admin'
	},
	{
		id: 'ac-006',
		accion_numero: 'A26_06',
		descripcion_hallazgo:
			'Oportunidad de mejora en sistema de trazabilidad de materias primas',
		tipo_accion_ejecutar: 'MEJORA',
		estado_accion: 'Cumplidas',
		valoracion_riesgo: 'BAJO',
		tipo_hallazgo_detectado: 'Oportunidad de Mejora',
		lugar_sede: 'Planta Principal',
		proceso_origen_hallazgo: 'Calidad',
		fecha_identificacion_hallazgo: '2025-10-10',
		fecha_limite_cierre_accion: '2026-02-28',
		fecha_limite_evaluacion_eficacia: '2026-04-28',
		responsable_ejecucion: 'Jimena Vargas',
		causas: [
			{ orden: 1, analisis_causa: '', estado_seguimiento: 'Cumplida', fecha_limite_implementacion: '2025-11-15' },
			{ orden: 2, analisis_causa: '', estado_seguimiento: 'Cumplida', fecha_limite_implementacion: '2025-12-10' },
			{ orden: 3, analisis_causa: '', estado_seguimiento: 'Cumplida', fecha_limite_implementacion: '2026-01-20' }
		],
		seguimientos_correccion: [{ fecha_seguimiento: '2026-02-10', estado_accion: 'Cerrada' }],
		estado_global: 'CUMPLIDA',
		created_at: '2025-10-11T13:00:00Z',
		updated_at: '2025-10-11T13:00:00Z',
		creado_por_id: 'admin'
	}
];

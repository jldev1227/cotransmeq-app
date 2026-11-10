/** Proyección de una versión guardada a las tablas de la hoja activa. */
export type SnapshotScope =
	'cierres' | 'adicionales' | 'ocasional' | 'nomina' | 'recorridos' | 'ingresos';
export type SeccionSnapshot = { titulo: string; columnas: string[]; filas: Array<Array<unknown>> };

const filas = (items: any[], campos: Array<[string, string]>): SeccionSnapshot => ({
	titulo: '',
	columnas: campos.map(([titulo]) => titulo),
	filas: items.map((item) => campos.map(([, clave]) => item?.[clave] ?? null))
});

export function seccionesSnapshot(
	scope: SnapshotScope,
	payload: Record<string, any> | null,
	placa?: string | null,
	conductorId?: string | null,
	hoja?: string | null
): SeccionSnapshot[] {
	if (!payload) return [];
	const mismaPlaca = (f: any) =>
		!placa || String(f?.placa ?? f?.vehiculo_placa ?? '').toUpperCase() === placa.toUpperCase();
	if (scope === 'cierres') {
		const items = filas(payload.items_detalle ?? [], [
			['Cliente', 'cliente'],
			['Servicio', 'consecutivo'],
			['Placa', 'placa'],
			['Recorrido', 'recorrido'],
			['Fechas', 'fechas'],
			['Cantidad', 'cantidad'],
			['Facturado', 'total_facturado'],
			['A liquidar', 'valor_liquidar']
		]);
		const conceptos = filas(payload.conceptos ?? [], [
			['Tipo', 'tipo'],
			['Concepto', 'concepto'],
			['Días', 'dias'],
			['Valor unitario', 'valor_unitario'],
			['Total', 'valor_total']
		]);
		return [
			{ ...items, titulo: 'Servicios' },
			{ ...conceptos, titulo: 'Conceptos' },
			{
				titulo: 'Cierre',
				columnas: ['Estado', 'Valor a liquidar', 'Total a pagar'],
				filas: [[payload.estado, payload.totales?.valor_liquidar, payload.totales?.total_pagar]]
			}
		];
	}
	if (scope === 'nomina') {
		const hoja = (payload.hojas ?? []).find(
			(h: any) => !conductorId || h.conductorId === conductorId
		);
		if (!hoja) return [];
		return [
			{
				titulo: hoja.nombre ?? 'Conductor',
				columnas: ['Estado', 'Horas', 'Neto'],
				filas: [[hoja.estado, hoja.totalHorasMes, hoja.totales?.sueldoTotal]]
			},
			{
				...filas(hoja.devengos ?? [], [
					['Concepto', 'nombre'],
					['Cantidad', 'cantidad'],
					['Valor', 'valor']
				]),
				titulo: 'Devengos'
			},
			{
				...filas(hoja.deducciones ?? [], [
					['Concepto', 'nombre'],
					['Cantidad', 'cantidad'],
					['Valor', 'valor']
				]),
				titulo: 'Deducciones'
			},
			{
				...filas(hoja.dias ?? [], [
					['Fecha', 'fecha'],
					['Inicio', 'horaInicio'],
					['Fin', 'horaFin'],
					['Horas', 'totalHoras'],
					['Disponibilidad', 'disponibilidad']
				]),
				titulo: 'Días y planillas'
			}
		];
	}
	if (scope === 'recorridos') {
		const hoja = (payload.hojas ?? []).find(
			(h: any) => !conductorId || h.conductor_id === conductorId
		);
		if (!hoja) return [];
		return [
			{
				...filas((hoja.filas ?? []).filter(mismaPlaca), [
					['Fecha', 'fecha'],
					['Placa', 'vehiculo_placa'],
					['Cliente', 'cliente_nombre'],
					['Inicio', 'hora_inicio'],
					['Fin', 'hora_fin'],
					['Descripción', 'descripcion'],
					['Km inicial', 'km_inicial'],
					['Km final', 'km_final']
				]),
				titulo: `${hoja.nombre ?? ''} ${hoja.apellido ?? ''}`.trim() || 'Recorridos'
			}
		];
	}
	if (scope === 'adicionales') {
		return [
			{
				...filas((payload.filas ?? []).filter(mismaPlaca), [
					['Placa', 'placa'],
					['Cliente', 'cliente'],
					['Recorrido', 'recorrido'],
					['Fechas', 'fechas'],
					['Cantidad', 'cantidad'],
					['Valor unitario', 'valor_unitario'],
					['Administración', 'valor_admin'],
					['A liquidar', 'valor_liquidar']
				]),
				titulo: 'Adicionales'
			}
		];
	}
	if (scope === 'ingresos') {
		const adicionales = hoja === 'ADICIONALES';
		const marcadas = new Set(
			(payload.estado?.filas ?? [])
				.filter((f: any) => f.incluir_adicional === true)
				.map((f: any) => f.liquidacion_tercero_id)
		);
		const visibles = (payload.filas ?? []).filter((f: any) =>
			adicionales ? f.origen === 'ADICIONAL' || marcadas.has(f.id) : f.origen !== 'ADICIONAL'
		);
		return [
			{
				...filas(visibles, [
					['Placa', 'placa'],
					['Cliente', 'cliente_nombre'],
					['Recorrido', 'recorrido'],
					['Fechas', 'fechas'],
					['Cantidad', 'cantidad'],
					['Facturado', 'total_facturado'],
					['Ingreso empresa', 'ingreso_empresa']
				]),
				titulo: adicionales ? 'Adicionales' : 'Ingresos cliente'
			},
			{
				...filas(
					(payload.estado?.conceptos ?? []).filter((f: any) => !hoja || f.hoja === hoja),
					[
						['Concepto', 'concepto'],
						['Valor', 'valor']
					]
				),
				titulo: 'Conceptos'
			}
		];
	}
	return [
		{
			...filas((payload.items ?? []).filter(mismaPlaca), [
				['Placa', 'placa'],
				['Cliente', 'cliente_nombre'],
				['Servicio', 'consecutivo'],
				['Recorrido', 'recorrido'],
				['Facturado', 'total_facturado'],
				['A liquidar', 'valor_liquidar']
			]),
			titulo: 'Servicios ocasionales'
		},
		{
			...filas((payload.adicionales ?? []).filter(mismaPlaca), [
				['Placa', 'placa'],
				['Cliente', 'cliente'],
				['Recorrido', 'recorrido'],
				['Valor', 'valor_liquidar']
			]),
			titulo: 'Adicionales ocasionales'
		},
		{
			...filas(
				(payload.conceptos ?? []).filter((c: any) => !placa || c.placa_aplicada === placa),
				[
					['Concepto', 'concepto'],
					['Días', 'dias'],
					['Total', 'valor_total']
				]
			),
			titulo: 'Conceptos ocasionales'
		}
	];
}

<script lang="ts">
	import { fly, fade, scale } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { toast } from 'svelte-sonner';
	import { diasLaboradosAPI, type TipoDia, type SegmentoPatron } from '$lib/api/apiClient';
	import TimePicker from '$lib/components/TimePicker.svelte';
	import Autocomplete from '$lib/components/Autocomplete.svelte';

	export interface SegmentoExistente {
		id: string;
		cliente_id: string | null;
		cliente_nombre: string | null;
		vehiculo_id: string | null;
		vehiculo_placa: string | null;
		hora_inicio: string | null;
		hora_fin: string | null;
		horas_conducidas: number | null;
		km_inicial: number | null;
		km_final: number | null;
		pernocte: boolean;
		inicio_dia_siguiente?: boolean;
		fin_dia_siguiente?: boolean;
		observaciones: string | null;
	}

	type Props = {
		open: boolean;
		registroId: string | null;
		fecha: string;
		tipoInicial: TipoDia;
		observacionesIniciales: string | null;
		conductorLabel: string;
		/** Si el día ya tiene segmentos, se pasan para pre-rellenar el form. */
		segmentoInicial?: SegmentoExistente | null;
		/**
		 * Vehículo guardado del día, si ya era de MANTENIMIENTO. Sin esto, abrir
		 * y guardar un día de taller borraría la placa que ya tenía.
		 */
		mantenimientoInicial?: { vehiculo_id: string | null; vehiculo_placa: string | null } | null;
		onclose: () => void;
		onsaved?: () => void;
	};

	let {
		open,
		registroId,
		fecha,
		tipoInicial,
		observacionesIniciales,
		conductorLabel,
		segmentoInicial = null,
		mantenimientoInicial = null,
		onclose,
		onsaved
	}: Props = $props();

	// Modelo idéntico al portal del conductor
	interface SegmentoForm {
		id: string;
		cliente_id: string | null;
		cliente_nombre: string | null;
		vehiculo_id: string | null;
		vehiculo_placa: string;
		hora_inicio: string;
		hora_fin: string;
		inicio_dia_siguiente: boolean;
		fin_dia_siguiente: boolean;
		horas_conducidas: number;
		km_inicial: number | null;
		km_final: number | null;
		pernocte: boolean;
		observaciones: string | null;
	}

	function uid(): string {
		return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
	}

	function tramoVacio(): SegmentoForm {
		return {
			id: uid(),
			cliente_id: null,
			cliente_nombre: null,
			vehiculo_id: null,
			vehiculo_placa: '',
			hora_inicio: '',
			hora_fin: '',
			inicio_dia_siguiente: false,
			fin_dia_siguiente: false,
			horas_conducidas: 0,
			km_inicial: null,
			km_final: null,
			pernocte: false,
			observaciones: null
		};
	}

	// ── Estado: metadata del día (modelo portal) ──
	let form: {
		tipo?: TipoDia;
		observaciones?: string | null;
		mantenimiento_vehiculo_id?: string | null;
		mantenimiento_vehiculo_placa?: string | null;
	} = $state({});
	let tramos: SegmentoForm[] = $state([tramoVacio()]);
	let tramoExpandido: number | null = $state(0);

	// ── Catálogos (mismas llamadas que el portal) ──
	let clientes = $state<Array<{ id: string; nombre: string }>>([]);
	let vehiculos = $state<Array<{ id: string; placa: string; marca?: string }>>([]);
	let loadingCatalogos = $state<boolean>(false);

	function cargarCatalogos() {
		loadingCatalogos = true;
		Promise.all([
			diasLaboradosAPI.listarClientes().catch(() => ({ data: { data: [] } })),
			diasLaboradosAPI.listarVehiculos().catch(() => ({ data: { data: [] } }))
		])
			.then(([rC, rV]) => {
				clientes = (rC.data?.data ?? []) as any;
				vehiculos = (rV.data?.data ?? []) as any;
			})
			.finally(() => {
				loadingCatalogos = false;
			});
	}

	function hidratar() {
		form = {
			tipo: tipoInicial,
			observaciones: observacionesIniciales ?? '',
			mantenimiento_vehiculo_id: mantenimientoInicial?.vehiculo_id ?? null,
			mantenimiento_vehiculo_placa: mantenimientoInicial?.vehiculo_placa ?? null
		};
		if (segmentoInicial) {
			tramos = [
				{
					id: uid(),
					cliente_id: segmentoInicial.cliente_id ?? null,
					cliente_nombre: segmentoInicial.cliente_nombre ?? null,
					vehiculo_id: segmentoInicial.vehiculo_id ?? null,
					vehiculo_placa: segmentoInicial.vehiculo_placa ?? '',
					hora_inicio: segmentoInicial.hora_inicio ?? '',
					hora_fin: segmentoInicial.hora_fin ?? '',
					inicio_dia_siguiente: segmentoInicial.inicio_dia_siguiente ?? false,
					fin_dia_siguiente: segmentoInicial.fin_dia_siguiente ?? false,
					horas_conducidas: Number(segmentoInicial.horas_conducidas) || 0,
					km_inicial: segmentoInicial.km_inicial ?? null,
					km_final: segmentoInicial.km_final ?? null,
					pernocte: segmentoInicial.pernocte ?? false,
					observaciones: segmentoInicial.observaciones ?? null
				}
			];
		} else {
			tramos = [tramoVacio()];
		}
		tramoExpandido = 0;
	}

	$effect(() => {
		if (open) {
			hidratar();
			if (clientes.length === 0 && vehiculos.length === 0) cargarCatalogos();
		}
	});

	function agregarTramo() {
		const nuevo: SegmentoForm = tramoVacio();
		tramos = [...tramos, nuevo];
		tramoExpandido = tramos.length - 1;
	}

	function eliminarTramo(idx: number) {
		if (tramos.length === 1) {
			tramos = [tramoVacio()];
		} else {
			tramos = tramos.filter((_, i) => i !== idx);
		}
		tramoExpandido = null;
	}

	function horasTramo(t: SegmentoForm): number | null {
		if (!t.hora_inicio || !t.hora_fin) return null;
		const toMins = (h: string, next: boolean) =>
			h.split(':').reduce((a, v) => a * 60 + Number(v), 0) + (next ? 24 * 60 : 0);
		const mins = toMins(t.hora_fin, !!t.fin_dia_siguiente) - toMins(t.hora_inicio, !!t.inicio_dia_siguiente);
		return mins > 0 ? +(mins / 60).toFixed(1) : null;
	}

	const esLaborado = $derived(form.tipo === 'LABORADO');
	const esMantenimiento = $derived(form.tipo === 'MANTENIMIENTO');
	const tipoActual = $derived(
		form.tipo
			? (TIPOS.find((t) => t.value === form.tipo) ?? TIPOS[0])
			: TIPOS[0]
	);
	const totalHorasTramos = $derived(
		tramos.reduce((s, t) => s + (Number(t.horas_conducidas) || 0), 0)
	);

	// Derived reactivo (no función) — FIX del Invalid Date
	// La fecha puede llegar como 'YYYY-MM-DD' o como ISO datetime
	// 'YYYY-MM-DDTHH:MM:SS.sssZ' (lo que devuelve el backend).
	// Normalizamos a la parte de fecha antes de parsear.
	const fechaLegible = $derived.by(() => {
		if (!fecha) return '—';
		const soloFecha = String(fecha).split('T')[0];
		const [y, m, d] = soloFecha.split('-').map(Number);
		if (!y || !m || !d || Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return '—';
		return new Date(y, m - 1, d).toLocaleDateString('es-CO', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
	});

	const TIPOS: { value: TipoDia; label: string; color: string; icon: string }[] = [
		{ value: 'LABORADO', label: 'Día Laborado', color: '#ea580c', icon: '🚛' },
		{ value: 'DISPONIBLE', label: 'Disponible', color: '#2563eb', icon: '✅' },
		{ value: 'DESCANSO', label: 'Descanso', color: '#d97706', icon: '🌙' },
		{ value: 'MANTENIMIENTO', label: 'Mantenimiento', color: '#dc2626', icon: '🔧' }
	];

	const clienteOptions = $derived(clientes.map((c) => ({ id: c.id, label: c.nombre })));
	const vehiculoOptions = $derived(
		vehiculos.map((v) => ({ id: v.id, label: v.placa, placa: v.placa }))
	);

	let guardando = $state<boolean>(false);
	let errorMsg = $state<string>('');

	function validar(): string | null {
		// Misma regla que el portal y que el zod del backend: un día de taller
		// sin placa no identifica el vehículo intervenido.
		if (esMantenimiento && !form.mantenimiento_vehiculo_placa) {
			return 'Indica la placa del vehículo que estuvo en mantenimiento';
		}
		if (esLaborado) {
			if (tramos.length === 0) return 'LABORADO requiere al menos un tramo';
			for (let i = 0; i < tramos.length; i++) {
				const t = tramos[i];
				if (!t.vehiculo_placa) return `Tramo ${i + 1}: indica la placa`;
				if (!t.hora_inicio) return `Tramo ${i + 1}: hora de inicio`;
				if (!t.hora_fin) return `Tramo ${i + 1}: hora de fin`;
				if (!t.horas_conducidas || Number(t.horas_conducidas) <= 0) {
					return `Tramo ${i + 1}: horas conducidas`;
				}
				const toMins = (h: string, next: boolean) =>
					h.split(':').reduce((a, v) => a * 60 + Number(v), 0) + (next ? 24 * 60 : 0);
				const inicioMins = toMins(t.hora_inicio, !!t.inicio_dia_siguiente);
				const finMins = toMins(t.hora_fin, !!t.fin_dia_siguiente);
				if (finMins <= inicioMins) {
					return `Tramo ${i + 1}: la hora fin debe ser posterior a la inicio (usa el +1 si cruza medianoche)`;
				}
			}
		}
		return null;
	}

	async function guardar() {
		if (!registroId) return;
		const err = validar();
		if (err) {
			errorMsg = err;
			return;
		}
		errorMsg = '';
		guardando = true;
		try {
			const payload: {
				tipo: TipoDia;
				observaciones: string | null;
				mantenimiento_vehiculo_id: string | null;
				mantenimiento_vehiculo_placa: string | null;
				segmento?: Partial<SegmentoPatron> | null;
			} = {
				tipo: (form.tipo as TipoDia) ?? 'DESCANSO',
				observaciones: (form.observaciones as string | null) || null,
				// En null para los demás tipos: un día que deja de ser
				// mantenimiento no puede conservar la placa pegada.
				mantenimiento_vehiculo_id: esMantenimiento ? form.mantenimiento_vehiculo_id || null : null,
				mantenimiento_vehiculo_placa: esMantenimiento
					? form.mantenimiento_vehiculo_placa || null
					: null
			};
			// Solo LABORADO envía segmento
			if (esLaborado && tramos.length > 0) {
				const t = tramos[0];
				payload.segmento = {
					cliente_id: t.cliente_id,
					cliente_nombre: t.cliente_nombre,
					vehiculo_id: t.vehiculo_id,
					vehiculo_placa: t.vehiculo_placa,
					hora_inicio: t.hora_inicio,
					hora_fin: t.hora_fin,
					inicio_dia_siguiente: t.inicio_dia_siguiente === true,
					fin_dia_siguiente: t.fin_dia_siguiente === true,
					horas_conducidas: Number(t.horas_conducidas) || 0,
					km_inicial: t.km_inicial != null && String(t.km_inicial) !== '' ? Number(t.km_inicial) : null,
					km_final: t.km_final != null && String(t.km_final) !== '' ? Number(t.km_final) : null,
					pernocte: t.pernocte === true,
					observaciones: t.observaciones || null
				};
			}
			const res = await diasLaboradosAPI.editarRegistro(registroId, payload);
			if (res.data?.success) {
				toast.success('Día actualizado');
				onsaved?.();
				onclose();
			} else {
				errorMsg = res.data?.message || 'No se pudo actualizar';
			}
		} catch (err: any) {
			errorMsg = err?.response?.data?.message || err?.message || 'Error al guardar';
		} finally {
			guardando = false;
		}
	}

	function handleEscape(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) onclose();
	}

	$effect(() => {
		if (!browser) return;
		if (open) {
			document.addEventListener('keydown', handleEscape);
			return () => document.removeEventListener('keydown', handleEscape);
		}
	});
</script>

{#if open && registroId}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		style="background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(4px);"
		onclick={onclose}
		role="dialog"
		aria-modal="true"
		aria-labelledby="modal-editar-registro-title"
		tabindex="-1"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			role="document"
			in:fly={{ y: 12, duration: 280 }}
			out:scale={{ duration: 150, start: 0.98 }}
		>
			<!-- Header -->
			<header
				class="flex flex-shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-5 py-4"
				style="background: linear-gradient(135deg, #f0fdf4, #d1fae5);"
			>
				<div class="flex items-start gap-3">
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
						style="background: linear-gradient(135deg, #ea580c, #c2410c); box-shadow: 0 4px 12px rgba(249, 115, 22,0.25);"
					>
						<svg
							class="h-5 w-5 text-white"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
							/>
						</svg>
					</div>
					<div class="min-w-0">
						<p
							class="font-mono text-[10px] font-semibold uppercase tracking-wider"
							style="color: #c2410c;"
						>
							Editar día
						</p>
						<h2
							id="modal-editar-registro-title"
							class="font-display text-lg capitalize"
							style="color: var(--bg-charcoal); font-weight: 500;"
						>
							{fechaLegible}
						</h2>
						<p class="mt-0.5 text-[11px]" style="color: var(--text-muted);">
							{conductorLabel}
						</p>
					</div>
				</div>
				<button
					type="button"
					onclick={onclose}
					class="apple-transition flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-gray-700"
					aria-label="Cerrar"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</header>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto px-5 py-4">
				<!-- Tipo de jornada (mismo grid que el portal) -->
				<p
					class="mb-2 text-[10px] font-semibold uppercase tracking-wide"
					style="color: var(--text-muted);"
				>
					Tipo de jornada
				</p>
				<div class="tipo-grid">
					{#each TIPOS as t (t.value)}
						<button
							type="button"
							class="tipo-btn"
							class:selected={form.tipo === t.value}
							style={form.tipo === t.value ? `--tcolor:${t.color}` : ''}
							onclick={() => {
								form.tipo = t.value;
								errorMsg = '';
							}}
						>
							<span class="tipo-icon">{t.icon}</span>
							<span class="tipo-label">{t.label}</span>
						</button>
					{/each}
				</div>

				<!-- Vehículo intervenido: mismo buscador de placa que los tramos -->
				{#if esMantenimiento}
					<div class="form-section">
						<div class="form-section-title">🔧 Vehículo en mantenimiento</div>
						<div class="field">
							<label class="field-label" for="mant-placa-admin">
								Placa vehículo <span class="req">*</span>
							</label>
							<Autocomplete
								options={vehiculoOptions}
								inputId="mant-placa-admin"
								value={form.mantenimiento_vehiculo_id || ''}
								placeholder={form.mantenimiento_vehiculo_placa || '🔍 Buscar placa...'}
								on:select={(e) => {
									form.mantenimiento_vehiculo_id = e.detail.id;
									form.mantenimiento_vehiculo_placa = e.detail.placa || e.detail.label;
									errorMsg = '';
								}}
								on:clear={() => {
									form.mantenimiento_vehiculo_id = null;
									form.mantenimiento_vehiculo_placa = null;
								}}
							/>
							{#if form.mantenimiento_vehiculo_placa}
								<p class="field-hint">🚚 {form.mantenimiento_vehiculo_placa}</p>
							{:else}
								<p class="field-hint field-hint--req">
									Obligatorio: sin la placa no se sabe qué vehículo estuvo en taller.
								</p>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Tramos (misma estructura que el portal: tramo-card expandible) -->
				{#if esLaborado}
					<div class="form-section">
						<div class="form-section-title">
							🚚 Tramos del día
							<span class="tramos-meta">{tramos.length} {tramos.length === 1 ? 'tramo' : 'tramos'} · {totalHorasTramos}h</span>
						</div>

						<div class="tramos-list">
							{#each tramos as t, i (t.id)}
								{@const expandido = tramoExpandido === i}
								{@const hrs = horasTramo(t)}
								<div class="tramo-card" class:expandido>
									<button
										type="button"
										class="tramo-header"
										onclick={() => (tramoExpandido = expandido ? null : i)}
									>
										<span class="tramo-num">{i + 1}</span>
										<div class="tramo-resumen">
											{#if t.vehiculo_placa}
												<span class="tramo-tag vehiculo">🚚 {t.vehiculo_placa}</span>
											{:else}
												<span class="tramo-tag muted">Sin vehículo</span>
											{/if}
											{#if t.cliente_nombre}
												<span class="tramo-tag cliente">🏢 {t.cliente_nombre}</span>
											{:else}
												<span class="tramo-tag muted">Sin cliente</span>
											{/if}
											{#if t.hora_inicio && t.hora_fin}
												<span class="tramo-tag hora">
													🕐 {t.hora_inicio}{#if t.inicio_dia_siguiente}<sup class="dia-sig-sup">+1</sup>{/if}–{t.hora_fin}{#if t.fin_dia_siguiente}<sup class="dia-sig-sup">+1</sup>{/if}
												</span>
											{/if}
											{#if t.horas_conducidas > 0}
												<span class="tramo-tag horas">{t.horas_conducidas}h</span>
											{/if}
										</div>
										<span class="tramo-toggle">{expandido ? '▾' : '▸'}</span>
									</button>

									{#if expandido}
										<div class="tramo-body">
											<div class="field-row">
												<div class="field">
													<label class="field-label" for="hi-{t.id}">Hora inicio</label>
													<TimePicker
														id="hi-{t.id}"
														bind:value={t.hora_inicio}
														bind:dayOffset={t.inicio_dia_siguiente}
														placeholder="Inicio"
													/>
												</div>
												<div class="field">
													<label class="field-label" for="hf-{t.id}">Hora fin</label>
													<TimePicker
														id="hf-{t.id}"
														bind:value={t.hora_fin}
														bind:dayOffset={t.fin_dia_siguiente}
														placeholder="Fin"
													/>
												</div>
											</div>
											{#if hrs !== null}
												<p class="field-hint">⏱ Duración: <strong>{hrs} h</strong></p>
											{/if}
											<div class="field" style="margin-top:.65rem">
												<label class="field-label" for="hc-{t.id}">Horas conducidas</label>
												<input
													id="hc-{t.id}"
													type="number"
													min="0"
													max="24"
													step="0.5"
													class="field-input"
													bind:value={t.horas_conducidas}
													placeholder="Ej: 4"
												/>
											</div>

											<!-- KM inicial / final + Pernocte -->
											<div class="field-row" style="margin-top:.65rem">
												<div class="field">
													<label class="field-label" for="kmi-{t.id}">KM inicial</label>
													<input
														id="kmi-{t.id}"
														type="number"
														min="0"
														step="1"
														inputmode="numeric"
														class="field-input"
														bind:value={t.km_inicial}
														placeholder="Ej: 98402"
													/>
												</div>
												<div class="field">
													<label class="field-label" for="kmf-{t.id}">KM final</label>
													<input
														id="kmf-{t.id}"
														type="number"
														min="0"
														step="1"
														inputmode="numeric"
														class="field-input"
														bind:value={t.km_final}
														placeholder="Ej: 98490"
													/>
												</div>
											</div>
											{#if t.km_inicial != null && t.km_final != null && Number(t.km_final) >= Number(t.km_inicial)}
												{@const kmRecorrido = Number(t.km_final) - Number(t.km_inicial)}
												<p class="field-hint" style="color:#1d4ed8">
													📏 Recorrido: <strong>{kmRecorrido} km</strong>
												</p>
											{/if}

											<label class="pernocte-toggle">
												<input
													type="checkbox"
													bind:checked={t.pernocte}
												/>
												<span>🌙 Pernocté (requirió pasar la noche fuera)</span>
											</label>

											<!-- Cliente -->
											<div class="field" style="margin-top:.65rem">
												<label class="field-label" for="cli-{t.id}">Cliente</label>
												<Autocomplete
													inputId="cli-{t.id}"
													options={clienteOptions}
													value={t.cliente_id || ''}
													placeholder={t.cliente_nombre || '🔍 Buscar cliente...'}
													on:select={(e) => {
														t.cliente_id = e.detail.id;
														t.cliente_nombre = e.detail.label;
													}}
													on:clear={() => {
														t.cliente_id = null;
														t.cliente_nombre = null;
													}}
												/>
											</div>

											<!-- Placa -->
											<div class="field" style="margin-top:.65rem">
												<label class="field-label" for="veh-{t.id}">Placa vehículo</label>
												<Autocomplete
													inputId="veh-{t.id}"
													options={vehiculoOptions}
													value={t.vehiculo_id || ''}
													placeholder={t.vehiculo_placa || '🔍 Buscar placa...'}
													on:select={(e) => {
														t.vehiculo_id = e.detail.id;
														t.vehiculo_placa = e.detail.placa || e.detail.label;
													}}
													on:clear={() => {
														t.vehiculo_id = null;
														t.vehiculo_placa = '';
													}}
												/>
											</div>

											<!-- Observaciones del tramo -->
											<div class="field" style="margin-top:.65rem">
												<label class="field-label" for="obs-{t.id}">Observaciones del tramo</label>
												<textarea
													id="obs-{t.id}"
													class="field-input field-textarea"
													bind:value={t.observaciones}
													rows="2"
													placeholder="Notas del tramo…"
												></textarea>
											</div>

											<div class="tramo-acciones">
												<button
													type="button"
													class="btn-tramo-del"
													onclick={() => eliminarTramo(i)}
												>
													🗑 Eliminar tramo
												</button>
											</div>
										</div>
									{/if}
								</div>
							{/each}
						</div>

						<button class="btn-tramo-add" type="button" onclick={agregarTramo}>
							<span class="plus">+</span> Agregar otro tramo (cambio de cliente/vehículo)
						</button>
					</div>
				{/if}

				<!-- Observaciones del día (siempre visible) -->
				{#if form.tipo}
					<div class="field" style="margin-top:1rem">
						<label class="field-label" for="modal-registro-obs">
							Observaciones
							{#if form.tipo === 'DESCANSO' || form.tipo === 'MANTENIMIENTO'}
								<span style="color:var(--text-very-muted,#9ca3af);font-weight:400">(recomendadas)</span>
							{:else}
								<span style="color:var(--text-very-muted,#9ca3af);font-weight:400">(opcional)</span>
							{/if}
						</label>
						<textarea
							id="modal-registro-obs"
							class="field-input field-textarea"
							bind:value={form.observaciones}
							placeholder={form.tipo === 'DESCANSO'
								? 'Motivo del descanso (vacaciones, personal, etc.)'
								: form.tipo === 'MANTENIMIENTO'
									? 'Detalle del mantenimiento realizado'
									: 'Notas del día…'}
							rows="2"
						></textarea>
					</div>
				{/if}

				{#if errorMsg}
					<div class="form-error">⚠ {errorMsg}</div>
				{/if}
			</div>

			<!-- Footer -->
			<footer
				class="flex flex-shrink-0 items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3"
			>
				<button
					type="button"
					onclick={onclose}
					class="apple-transition rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
				>
					Cancelar
				</button>
				<button
					type="button"
					onclick={guardar}
					disabled={guardando || !form.tipo}
					class="apple-transition inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
					style="background: linear-gradient(135deg, #ea580c, #c2410c); box-shadow: 0 2px 6px rgba(249, 115, 22,0.25);"
				>
					{#if guardando}
						<svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
							<path d="M4 12a8 8 0 018-8v0" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
						</svg>
						Guardando…
					{:else}
						<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
						</svg>
						Guardar cambios
					{/if}
				</button>
			</footer>
		</div>
	</div>
{/if}

<style>
	/* ── Tipo (mismas clases que el portal) ── */
	.tipo-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
	}
	.tipo-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		border: 2px solid #e2e8f0;
		background: white;
		color: #0f172a;
		cursor: pointer;
		transition: all 0.15s;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.tipo-btn.selected {
		border-color: var(--tcolor);
		background: color-mix(in srgb, var(--tcolor) 8%, transparent);
		color: var(--tcolor);
	}
	.tipo-icon {
		font-size: 1.1rem;
	}
	.tipo-label {
		font-size: 0.8rem;
	}

	/* ── Form section (portal) ── */
	.form-section {
		margin-top: 1rem;
	}
	.form-section-title {
		font-weight: 700;
		font-size: 0.82rem;
		color: #0f172a;
		margin-bottom: 0.5rem;
	}

	/* ── Tramos (idéntico al portal) ── */
	.tramos-meta {
		font-size: 0.7rem;
		font-weight: 600;
		color: #94a3b8;
		margin-left: 0.5rem;
		text-transform: none;
	}
	.tramos-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.tramo-card {
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		background: white;
		overflow: hidden;
		transition: border-color 0.15s;
	}
	.tramo-card.expandido {
		border-color: #ea580c;
		box-shadow: 0 0 0 1px rgba(234, 88, 12, 0.1);
	}
	.tramo-header {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0.75rem;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}
	.tramo-header:hover {
		background: #f8fafc;
	}
	.tramo-num {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: #ea580c;
		color: white;
		font-size: 0.75rem;
		font-weight: 800;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.tramo-resumen {
		flex: 1;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		min-width: 0;
	}
	.tramo-tag {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.2rem 0.5rem;
		border-radius: 6px;
		background: #f1f5f9;
		color: #475569;
		white-space: nowrap;
	}
	.tramo-tag.vehiculo {
		background: #dbeafe;
		color: #1e40af;
	}
	.tramo-tag.cliente {
		background: #d1fae5;
		color: #c2410c;
	}
	.tramo-tag.hora {
		background: #fef3c7;
		color: #92400e;
	}
	.tramo-tag.horas {
		background: #ede9fe;
		color: #6d28d9;
	}
	.tramo-tag.muted {
		background: #f1f5f9;
		color: #94a3b8;
		font-style: italic;
	}
	.dia-sig-sup {
		color: #f59e0b;
		font-weight: 800;
		font-size: 0.55rem;
		margin-left: 1px;
		vertical-align: super;
		line-height: 1;
	}
	.tramo-toggle {
		color: #94a3b8;
		font-size: 0.85rem;
		flex-shrink: 0;
	}
	.tramo-body {
		padding: 0.85rem 0.75rem;
		border-top: 1px dashed #e2e8f0;
		background: #f8fafc;
	}
	.tramo-acciones {
		margin-top: 0.65rem;
		display: flex;
		justify-content: flex-end;
	}
	.btn-tramo-del {
		font-size: 0.72rem;
		color: #dc2626;
		background: white;
		border: 1px solid #fca5a5;
		padding: 0.35rem 0.65rem;
		border-radius: 6px;
		cursor: pointer;
		font-weight: 600;
		font-family: inherit;
	}
	.btn-tramo-del:hover {
		background: #fef2f2;
	}
	.btn-tramo-add {
		width: 100%;
		margin-top: 0.4rem;
		padding: 0.65rem;
		border: 1.5px dashed #ea580c;
		background: rgba(234, 88, 12, 0.04);
		color: #c2410c;
		font-size: 0.82rem;
		font-weight: 700;
		border-radius: 10px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		font-family: inherit;
		transition: all 0.15s;
	}
	.btn-tramo-add:hover {
		background: rgba(234, 88, 12, 0.1);
		border-style: solid;
	}
	.btn-tramo-add .plus {
		font-size: 1.1rem;
		font-weight: 800;
	}

	/* ── Fields (portal) ── */
	.field-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.field {
		display: flex;
		flex-direction: column;
	}
	.field-label {
		font-size: 0.72rem;
		font-weight: 600;
		color: #475569;
		margin-bottom: 0.25rem;
		text-transform: uppercase;
	}
	.field-input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.55rem 0.7rem;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		font-size: 0.9rem;
		background: white;
		color: #0f172a;
		outline: none;
		font-family: inherit;
	}
	.field-input:focus {
		border-color: #ea580c;
		box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.1);
	}
	.field-textarea {
		resize: vertical;
		min-height: 50px;
	}
	.field-hint {
		font-size: 0.78rem;
		color: #ea580c;
		margin: 0.3rem 0 0;
	}
	/* El campo obligatorio se marca antes de intentar guardar. */
	.field-hint--req {
		color: #b45309;
	}
	.req {
		color: #dc2626;
		font-weight: 700;
	}
	.form-error {
		margin-top: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: #fef2f2;
		border: 1px solid #fca5a5;
		border-radius: 8px;
		font-size: 0.82rem;
		color: #dc2626;
		font-weight: 600;
	}

	/* ── Pernocte toggle (portal) ── */
	.pernocte-toggle {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-top: 0.7rem;
		padding: 0.55rem 0.7rem;
		background: #fff7ed;
		border: 1px solid #fed7aa;
		border-radius: 8px;
		font-size: 0.82rem;
		font-weight: 600;
		color: #c2410c;
		cursor: pointer;
		user-select: none;
	}
	.pernocte-toggle input[type='checkbox'] {
		width: 18px;
		height: 18px;
		accent-color: #c2410c;
		cursor: pointer;
	}
</style>

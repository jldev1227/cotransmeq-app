<script lang="ts">
	/**
	 * Alta y edición de un formulario de asistencia.
	 *
	 * Usa el mismo cascarón que los formularios de directorio (`ModalEntidad`):
	 * encabezado de marca, pie con las acciones, Escape/fondo y el aviso de
	 * cambios sin guardar. Antes era un modal propio con clases de Tailwind y
	 * validaba con toasts; ahora cada campo marca su propio error.
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ModalEntidad from '$lib/components/directorio/ModalEntidad.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import {
		asistenciasAPI,
		type CreateFormularioInput,
		type FormularioAsistencia,
		type TipoEvento
	} from '$lib/api/asistencias';
	import { TIPOS_EVENTO } from '$lib/asistencias/eventos';

	interface Props {
		open: boolean;
		/** Formulario a editar; `null` crea uno nuevo. */
		formulario?: FormularioAsistencia | null;
		oncerrar: () => void;
		onguardado?: (formulario: FormularioAsistencia) => void;
	}

	let { open, formulario = null, oncerrar, onguardado }: Props = $props();

	const TABS = [{ id: 'evento', label: 'Evento' }];

	interface Form {
		tematica: string;
		objetivo: string;
		fecha: string;
		hora_inicio: string;
		hora_finalizacion: string;
		tipo_evento: TipoEvento;
		tipo_evento_otro: string;
		lugar_sede: string;
		nombre_instructor: string;
		observaciones: string;
	}

	const hoy = () => new Date().toISOString().split('T')[0];

	function desde(f: FormularioAsistencia | null): Form {
		return {
			tematica: f?.tematica ?? '',
			objetivo: f?.objetivo ?? '',
			fecha: f?.fecha ? f.fecha.split('T')[0] : hoy(),
			hora_inicio: f?.hora_inicio ?? '',
			hora_finalizacion: f?.hora_finalizacion ?? '',
			tipo_evento: f?.tipo_evento ?? 'capacitacion',
			tipo_evento_otro: f?.tipo_evento_otro ?? '',
			lugar_sede: f?.lugar_sede ?? '',
			nombre_instructor: f?.nombre_instructor ?? '',
			observaciones: f?.observaciones ?? ''
		};
	}

	let form = $state<Form>(desde(null));
	let inicial = $state('');
	let errores = $state<Partial<Record<keyof Form, string>>>({});
	let guardando = $state(false);
	let tab = $state('evento');

	/// Cada apertura parte del formulario recibido (o de uno vacío) y guarda
	/// la foto inicial para saber si hay cambios sin guardar.
	$effect(() => {
		if (!open) return;
		const f = formulario;
		untrack(() => {
			form = desde(f);
			inicial = JSON.stringify(form);
			errores = {};
		});
	});

	const editando = $derived(!!formulario);
	const sucio = $derived(JSON.stringify(form) !== inicial);
	const inv = (k: keyof Form) => (errores[k] ? 'true' : undefined);

	function validar(): boolean {
		const e: Partial<Record<keyof Form, string>> = {};
		if (!form.tematica.trim()) e.tematica = 'Escribe la temática del evento.';
		if (!form.fecha) e.fecha = 'La fecha es obligatoria.';
		if (form.tipo_evento === 'otro' && !form.tipo_evento_otro.trim()) {
			e.tipo_evento_otro = 'Indica qué tipo de evento es.';
		}
		if (form.hora_inicio && form.hora_finalizacion && form.hora_finalizacion <= form.hora_inicio) {
			e.hora_finalizacion = 'Debe ser posterior a la hora de inicio.';
		}
		errores = e;
		return Object.keys(e).length === 0;
	}

	async function guardar() {
		if (!validar()) return;
		guardando = true;
		try {
			const data: CreateFormularioInput = {
				tematica: form.tematica.trim(),
				objetivo: form.objetivo.trim() || undefined,
				fecha: new Date(form.fecha).toISOString(),
				hora_inicio: form.hora_inicio || undefined,
				hora_finalizacion: form.hora_finalizacion || undefined,
				tipo_evento: form.tipo_evento,
				tipo_evento_otro: form.tipo_evento === 'otro' ? form.tipo_evento_otro.trim() : undefined,
				lugar_sede: form.lugar_sede.trim() || undefined,
				nombre_instructor: form.nombre_instructor.trim() || undefined,
				observaciones: form.observaciones.trim() || undefined
			};
			const guardado = formulario
				? await asistenciasAPI.actualizarFormulario(formulario.id, data)
				: await asistenciasAPI.crearFormulario(data);
			toast.success(formulario ? 'Formulario actualizado' : 'Formulario creado');
			onguardado?.(guardado);
			oncerrar();
		} catch (error: any) {
			toast.error(error?.message || 'No se pudo guardar el formulario');
		} finally {
			guardando = false;
		}
	}
</script>

<ModalEntidad
	{open}
	eyebrow={editando ? 'EDITAR ASISTENCIA' : 'NUEVA ASISTENCIA'}
	title={editando ? form.tematica || 'Formulario de asistencia' : 'Nuevo formulario de asistencia'}
	subtitle={editando
		? 'Los asistentes que ya firmaron no se ven afectados.'
		: 'Los campos con * son obligatorios. El enlace para firmar se genera al crearlo.'}
	tabs={TABS}
	bind:tabActiva={tab}
	erroresPorTab={{ evento: Object.keys(errores).length }}
	{guardando}
	{sucio}
	textoGuardar={editando ? 'Guardar cambios' : 'Crear formulario'}
	onguardar={guardar}
	{oncerrar}
>
	{#snippet children()}
		<div class="de-grid">
			<Campo id="as-tematica" label="Temática del evento" requerido error={errores.tematica} completo>
				<input
					id="as-tematica"
					class="de-input"
					placeholder="Ej. Seguridad y salud en el trabajo"
					bind:value={form.tematica}
					aria-invalid={inv('tematica')}
					disabled={guardando}
				/>
			</Campo>

			<Campo id="as-tipo" label="Tipo de evento" requerido>
				<select id="as-tipo" class="de-input" bind:value={form.tipo_evento} disabled={guardando}>
					{#each TIPOS_EVENTO as t (t.value)}
						<option value={t.value}>{t.label}</option>
					{/each}
				</select>
			</Campo>

			<Campo id="as-fecha" label="Fecha" requerido error={errores.fecha}>
				<input
					id="as-fecha"
					type="date"
					class="de-input"
					bind:value={form.fecha}
					aria-invalid={inv('fecha')}
					disabled={guardando}
				/>
			</Campo>

			{#if form.tipo_evento === 'otro'}
				<Campo
					id="as-tipo-otro"
					label="¿Qué tipo de evento?"
					requerido
					error={errores.tipo_evento_otro}
					completo
				>
					<input
						id="as-tipo-otro"
						class="de-input"
						placeholder="Ej. Simulacro de evacuación"
						bind:value={form.tipo_evento_otro}
						aria-invalid={inv('tipo_evento_otro')}
						disabled={guardando}
					/>
				</Campo>
			{/if}

			<Campo id="as-hora-inicio" label="Hora de inicio">
				<input
					id="as-hora-inicio"
					type="time"
					class="de-input"
					bind:value={form.hora_inicio}
					disabled={guardando}
				/>
			</Campo>

			<Campo id="as-hora-fin" label="Hora de finalización" error={errores.hora_finalizacion}>
				<input
					id="as-hora-fin"
					type="time"
					class="de-input"
					bind:value={form.hora_finalizacion}
					aria-invalid={inv('hora_finalizacion')}
					disabled={guardando}
				/>
			</Campo>

			<Campo id="as-lugar" label="Lugar o sede">
				<input
					id="as-lugar"
					class="de-input"
					placeholder="Ej. Sede Yopal, virtual…"
					bind:value={form.lugar_sede}
					disabled={guardando}
				/>
			</Campo>

			<Campo id="as-instructor" label="Instructor o facilitador">
				<input
					id="as-instructor"
					class="de-input"
					placeholder="Ej. Juan Pérez · ARL Sura"
					bind:value={form.nombre_instructor}
					disabled={guardando}
				/>
			</Campo>

			<Campo id="as-objetivo" label="Objetivo" completo ayuda="Se muestra a los asistentes antes de firmar.">
				<textarea
					id="as-objetivo"
					class="de-input"
					rows="3"
					placeholder="Propósito del evento…"
					bind:value={form.objetivo}
					disabled={guardando}
				></textarea>
			</Campo>

			<Campo id="as-observaciones" label="Observaciones" completo>
				<textarea
					id="as-observaciones"
					class="de-input"
					rows="2"
					placeholder="Comentarios internos sobre el evento…"
					bind:value={form.observaciones}
					disabled={guardando}
				></textarea>
			</Campo>
		</div>
	{/snippet}
</ModalEntidad>

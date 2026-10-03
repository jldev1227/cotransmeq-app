<!--
	Duplicar un formulario en uno nuevo (así se saca el FR-09 del FR-08).

	Reemplaza los dos `prompt()` que pedían código y nombre: un prompt no valida,
	no deja ver el error del servidor junto al campo que lo causó y en móvil es
	una caja del sistema que no se parece en nada a la app.

	Qué copia el backend (`duplicarFormulario`): el árbol de la versión publicada
	más reciente —o del borrador si no hay ninguna publicada— como borrador v1 de
	un formulario nuevo, con su descripción y su área. Asignaciones y registros
	no viajan: son del formulario de origen.
-->
<script lang="ts">
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import { formulariosAPI, FormApiError } from '$lib/api/formularios';
	import type { FormDefinitionDto } from '$lib/formularios/types';

	interface Props {
		open: boolean;
		form: Pick<FormDefinitionDto, 'id' | 'code' | 'name'>;
		oncerrar: () => void;
		/** Se espera antes de soltar el botón: ahí va el toast y la navegación. */
		onduplicado: (nuevo: FormDefinitionDto) => void | Promise<void>;
	}

	let { open, form, oncerrar, onduplicado }: Props = $props();

	/// La misma regla que `formCodeSchema` del backend (2–50 caracteres, empieza
	/// por letra o número, luego letras, números, «.», «_» y «-»), ya en
	/// mayúsculas porque el backend también las normaliza.
	const CODIGO_VALIDO = /^[A-Z0-9][A-Z0-9._-]*$/;
	/// Lo que usan todos los formatos existentes (HSEQ-FR-04 … HSEQ-FR-56). Solo
	/// orienta: el backend admite otros códigos y HSEQ puede necesitarlos.
	const CODIGO_HABITUAL = /^HSEQ-[A-Z]{2,4}-\d{2,3}$/;

	const idForm = `dup-form-${Math.random().toString(36).slice(2, 8)}`;

	let codigo = $state('');
	let nombre = $state('');
	let guardando = $state(false);
	let intentado = $state(false);
	let tocado = $state({ codigo: false, nombre: false });
	let errorServidor = $state<{ codigo?: string; nombre?: string }>({});
	let inputCodigo = $state<HTMLInputElement | null>(null);

	/// Cada apertura arranca limpia: el modal vive montado para que su salida
	/// anime, así que el estado de la vez anterior seguiría ahí.
	$effect(() => {
		if (!open) return;
		codigo = '';
		nombre = `${form.name} (copia)`;
		intentado = false;
		tocado = { codigo: false, nombre: false };
		errorServidor = {};
		const t = setTimeout(() => inputCodigo?.focus(), 60);
		return () => clearTimeout(t);
	});

	/// Guiones no separables: «HSEQ-FR-09» no debe partirse en dos renglones.
	const codigoSinCorte = $derived(form.code.replace(/-/g, '\u2011'));

	const codigoNormalizado = $derived(codigo.trim().toUpperCase());

	const errorCodigoLocal = $derived.by(() => {
		const c = codigoNormalizado;
		if (!c) return 'Escribe el código HSEQ del formulario nuevo.';
		if (c.length < 2 || c.length > 50) return 'Debe tener entre 2 y 50 caracteres.';
		if (!CODIGO_VALIDO.test(c))
			return 'Solo letras, números, «.», «_» y «-», sin espacios (ej.: HSEQ\u2011FR\u201109).';
		if (c === form.code.toUpperCase())
			return 'Es el código de este formulario: el nuevo necesita uno propio.';
		return '';
	});

	const errorNombreLocal = $derived.by(() => {
		const n = nombre.trim();
		if (!n) return 'Escribe el nombre del formulario nuevo.';
		if (n.length > 255) return 'Máximo 255 caracteres.';
		return '';
	});

	const errorCodigo = $derived(
		errorServidor.codigo ?? (intentado || tocado.codigo ? errorCodigoLocal : '')
	);
	const errorNombre = $derived(
		errorServidor.nombre ?? (intentado || tocado.nombre ? errorNombreLocal : '')
	);

	const ayudaCodigo = $derived(
		codigoNormalizado && !errorCodigoLocal && !CODIGO_HABITUAL.test(codigoNormalizado)
			? 'No sigue el formato habitual HSEQ-FR-NN. Puedes continuar si es intencional.'
			: 'Formato HSEQ-FR-NN. Debe ser único en el catálogo.'
	);

	function onInputCodigo(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		/// Mayúsculas al escribir, conservando el cursor: es como lo guardará el
		/// backend y así no hay sorpresa al ver el formulario creado.
		const pos = el.selectionStart;
		codigo = el.value.toUpperCase();
		el.value = codigo;
		if (pos != null) el.setSelectionRange(pos, pos);
		errorServidor = { ...errorServidor, codigo: undefined };
	}

	async function enviar(e: SubmitEvent) {
		e.preventDefault();
		if (guardando) return;
		intentado = true;
		errorServidor = {};
		if (errorCodigoLocal) {
			inputCodigo?.focus();
			return;
		}
		if (errorNombreLocal) return;

		codigo = codigoNormalizado;
		guardando = true;
		try {
			const nuevo = await formulariosAPI.duplicar(form.id, {
				code: codigoNormalizado,
				name: nombre.trim()
			});
			await onduplicado(nuevo);
		} catch (err) {
			if (err instanceof FormApiError && err.code === 'FORM_CODE_TAKEN') {
				/// El backend compara código Y slug, y el slug sale del nombre: el
				/// choque puede venir de cualquiera de los dos.
				errorServidor = {
					codigo: 'Ya existe un formulario con ese código (o con un nombre equivalente).'
				};
				inputCodigo?.focus();
			} else if (err instanceof FormApiError && err.validationErrors.length > 0) {
				const porCampo: { codigo?: string; nombre?: string } = {};
				for (const issue of err.validationErrors) {
					if (issue.path === 'code') porCampo.codigo ??= issue.message;
					else if (issue.path === 'name') porCampo.nombre ??= issue.message;
				}
				if (porCampo.codigo || porCampo.nombre) errorServidor = porCampo;
				else errorServidor = { codigo: err.message };
			} else {
				errorServidor = {
					codigo: err instanceof Error ? err.message : 'No se pudo duplicar el formulario.'
				};
			}
		} finally {
			guardando = false;
		}
	}
</script>

<ModalBase
	{open}
	tamano="sm"
	eyebrow="Duplicar formulario"
	title={`Nuevo formulario desde ${codigoSinCorte}`}
	subtitle="Copia la estructura más reciente en un formulario nuevo e independiente, con sus propias versiones."
	bloqueado={guardando}
	cerrarAlFondo={!guardando}
	{oncerrar}
>
	<form id={idForm} class="dup" novalidate onsubmit={enviar}>
		<Campo
			id="{idForm}-codigo"
			label="Código HSEQ"
			requerido
			error={errorCodigo}
			ayuda={ayudaCodigo}
		>
			<input
				bind:this={inputCodigo}
				id="{idForm}-codigo"
				class="dup-input dup-input--codigo"
				type="text"
				value={codigo}
				placeholder="HSEQ-FR-09"
				maxlength="50"
				autocomplete="off"
				autocapitalize="characters"
				spellcheck="false"
				disabled={guardando}
				aria-invalid={errorCodigo ? 'true' : undefined}
				aria-describedby={errorCodigo ? `${idForm}-codigo-error` : undefined}
				oninput={onInputCodigo}
				onblur={() => {
					tocado.codigo = true;
					codigo = codigoNormalizado;
				}}
			/>
		</Campo>

		<Campo id="{idForm}-nombre" label="Nombre" requerido error={errorNombre}>
			<input
				id="{idForm}-nombre"
				class="dup-input"
				type="text"
				bind:value={nombre}
				maxlength="255"
				autocomplete="off"
				disabled={guardando}
				aria-invalid={errorNombre ? 'true' : undefined}
				aria-describedby={errorNombre ? `${idForm}-nombre-error` : undefined}
				oninput={() => (errorServidor = { ...errorServidor, nombre: undefined })}
				onblur={() => (tocado.nombre = true)}
			/>
		</Campo>

		<p class="dup-nota">
			Se copia la versión publicada más reciente (o el borrador, si no hay ninguna publicada) como
			borrador v1. Las asignaciones y los registros se quedan en {form.code}.
		</p>
	</form>

	{#snippet pie()}
		<button type="button" class="btn-secondary" disabled={guardando} onclick={oncerrar}>
			Cancelar
		</button>
		<button type="submit" form={idForm} class="btn-primary" disabled={guardando}>
			{#if guardando}<span class="dup-spinner" aria-hidden="true"
				></span>Duplicando…{:else}Duplicar{/if}
		</button>
	{/snippet}
</ModalBase>

<style>
	.dup {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	/* Mismo control que `.de-input` de los modales de directorio. */
	.dup-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.dup-input--codigo {
		font-weight: 700;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
	}
	.dup-input::placeholder {
		color: var(--text-very-muted);
		font-weight: 400;
		opacity: 1;
	}
	.dup-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.dup-input[aria-invalid='true'] {
		border-color: #dc2626;
		background: #fff8f7;
	}
	.dup-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
	}

	.dup-nota {
		margin: 0;
		padding: 10px 12px;
		border-radius: 12px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		color: var(--text-muted);
		font-size: 12.5px;
		line-height: 1.5;
	}

	.dup-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.4);
		border-top-color: #fff;
		border-radius: 999px;
		animation: dup-giro 0.7s linear infinite;
	}
	@keyframes dup-giro {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dup-spinner {
			animation-duration: 2s;
		}
	}
</style>

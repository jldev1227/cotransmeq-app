<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Check, Loader2 } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import PermisosRutasPicker from '$lib/components/permisos/PermisosRutasPicker.svelte';
	import FormularioUsuario from './FormularioUsuario.svelte';
	import SelectorAreas from './SelectorAreas.svelte';
	import { usuariosAPI, type Usuario } from '$lib/api/usuarios';
	import type { AccessLevel } from '$lib/config/permissions';
	import { OPCIONES_VINCULACION } from '$lib/config/personal';

	/**
	 * Editar un miembro del equipo: datos, áreas y permisos por ruta.
	 *
	 * Sale de la página de Usuarios con el mismo contenido y la misma llamada
	 * (`PUT /api/usuarios/:id`). Quien lo abre recibe el usuario actualizado
	 * por `onguardado` y lo cambia en su lista.
	 */
	interface Props {
		open: boolean;
		usuario: Usuario | null;
		oncerrar: () => void;
		onguardado: (usuario: Usuario) => void;
	}

	let { open, usuario, oncerrar, onguardado }: Props = $props();

	const idForm = `editar-usuario-${Math.random().toString(36).slice(2, 8)}`;

	let usuarioId = $state('');
	let rol = $state('usuario');
	let nombre = $state('');
	let correo = $state('');
	let telefono = $state('');
	let tipoVinculacion = $state('por_definir');
	let areas = $state<string[]>([]);
	/// Lista blanca por ruta del usuario editado. `null` = manda el área.
	let permisosRutas = $state<Record<string, AccessLevel> | null>(null);
	let guardando = $state(false);
	/// Cuenta las aperturas para remontar el editor de permisos: lee su valor
	/// UNA vez al montar, y sin remontarlo mostraría los permisos del usuario
	/// abierto antes.
	let apertura = $state(0);

	/// Se rellena al abrir y no al montar: el modal queda montado (para que
	/// `ModalBase` anime la salida) y cada apertura parte del usuario elegido.
	/// `.pre` para que el formulario ya tenga los datos cuando se pinte.
	$effect.pre(() => {
		if (!open || !usuario) return;
		const u = usuario;
		untrack(() => {
			usuarioId = u.id;
			rol = u.role ?? 'usuario';
			nombre = u.nombre;
			correo = u.correo;
			telefono = u.telefono || '';
			tipoVinculacion = u.tipo_vinculacion ?? 'por_definir';
			areas = Array.isArray(u.area) ? [...u.area] : u.area ? [u.area as string] : [];
			permisosRutas = u.permisos_rutas ?? null;
			apertura += 1;
		});
	});

	async function guardar() {
		if (!usuarioId) return;
		guardando = true;
		try {
			const actualizado = await usuariosAPI.actualizar(usuarioId, {
				nombre,
				correo,
				telefono,
				tipo_vinculacion: tipoVinculacion,
				area: areas,
				// `{}` y `null` significan lo mismo («manda el área»); se normaliza
				// para no dejar objetos vacíos que luego cueste distinguir.
				permisos_rutas:
					permisosRutas && Object.keys(permisosRutas).length > 0 ? permisosRutas : null
			});
			onguardado(actualizado);
			toast.success(`${nombre} actualizado correctamente`);
			oncerrar();
		} catch (err: any) {
			toast.error(err?.response?.data?.error || 'Error al actualizar usuario');
		} finally {
			guardando = false;
		}
	}
</script>

<!-- `lg`: el editor de permisos por ruta es una tabla de módulo × nivel y a
     menos ancho sus filas se parten en dos líneas. -->
<ModalBase
	{open}
	tamano="lg"
	eyebrow="Editar miembro"
	title="Editar usuario"
	cerrarAlFondo={false}
	bloqueado={guardando}
	{oncerrar}
>
	<FormularioUsuario id={idForm} onenviar={guardar}>
		<Campo id="{idForm}-nombre" label="Nombre completo">
			<input id="{idForm}-nombre" type="text" bind:value={nombre} required class="uf-input" />
		</Campo>
		<div class="uf-fila">
			<Campo id="{idForm}-correo" label="Correo">
				<input id="{idForm}-correo" type="email" bind:value={correo} required class="uf-input" />
			</Campo>
			<Campo id="{idForm}-telefono" label="Teléfono">
				<input
					id="{idForm}-telefono"
					type="tel"
					bind:value={telefono}
					class="uf-input"
					placeholder="3001234567"
				/>
			</Campo>
		</div>
		<Campo id="{idForm}-vinculacion" label="Tipo de vinculación">
			<select id="{idForm}-vinculacion" class="uf-input" bind:value={tipoVinculacion}>
				{#each OPCIONES_VINCULACION as opcion (opcion.value)}<option value={opcion.value}>{opcion.label}</option>{/each}
			</select>
		</Campo>
		<SelectorAreas seleccion={areas} onCambiar={(a) => (areas = a)} />
		<div class="uf-bloque">
			<span class="uf-etiqueta">Permisos por ruta</span>
			{#key apertura}
				<PermisosRutasPicker
					idPrefix="editar"
					{areas}
					role={rol}
					valor={permisosRutas}
					onchange={(v) => (permisosRutas = v)}
				/>
			{/key}
		</div>
	</FormularioUsuario>

	{#snippet pie()}
		<button type="button" class="btn-secondary" disabled={guardando} onclick={oncerrar}>
			Cancelar
		</button>
		<button type="submit" form={idForm} class="btn-primary" disabled={guardando}>
			{#if guardando}
				<Loader2 class="animate-spin" aria-hidden="true" />
				Guardando…
			{:else}
				<Check strokeWidth={2} aria-hidden="true" />
				Guardar cambios
			{/if}
		</button>
	{/snippet}
</ModalBase>

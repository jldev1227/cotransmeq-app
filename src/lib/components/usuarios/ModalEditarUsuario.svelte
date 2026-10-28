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
	let areas = $state<string[]>([]);
	/// Lista blanca por ruta del usuario editado. `null` = manda el área.
	let permisosRutas = $state<Record<string, AccessLevel> | null>(null);
	let guardando = $state(false);
	let password = $state('');
	let confirmarPassword = $state('');
	let cambiandoPassword = $state(false);
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
			areas = Array.isArray(u.area) ? [...u.area] : u.area ? [u.area as string] : [];
			permisosRutas = u.permisos_rutas ?? null;
			password = '';
			confirmarPassword = '';
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

	async function cambiarPassword() {
		if (!usuarioId || cambiandoPassword) return;
		if (
			password.length < 8 ||
			password.length > 72 ||
			!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(password) ||
			!/\d/.test(password)
		) {
			toast.error('Usa al menos 8 caracteres e incluye una letra y un número');
			return;
		}
		if (password !== confirmarPassword) {
			toast.error('Las contraseñas no coinciden');
			return;
		}

		cambiandoPassword = true;
		try {
			await usuariosAPI.cambiarPassword(usuarioId, password);
			password = '';
			confirmarPassword = '';
			toast.success(`Contraseña actualizada para ${nombre}. Se cerraron sus sesiones activas.`);
		} catch (err: any) {
			toast.error(err?.response?.data?.error || 'No se pudo cambiar la contraseña');
		} finally {
			cambiandoPassword = false;
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
	bloqueado={guardando || cambiandoPassword}
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
	<section class="password-panel" aria-labelledby="password-title">
		<div class="password-heading">
			<div>
				<h3 id="password-title">Acceso a la cuenta</h3>
				<p>Al guardar, se cerrarán las sesiones activas de esta persona.</p>
			</div>
		</div>
		<div class="uf-fila">
			<Campo id="{idForm}-password" label="Nueva contraseña">
				<input
					id="{idForm}-password"
					type="password"
					bind:value={password}
					class="uf-input"
					autocomplete="new-password"
					minlength="8"
					maxlength="72"
					placeholder="Mínimo 8 caracteres"
				/>
			</Campo>
			<Campo id="{idForm}-confirmar-password" label="Confirmar contraseña">
				<input
					id="{idForm}-confirmar-password"
					type="password"
					bind:value={confirmarPassword}
					class="uf-input"
					autocomplete="new-password"
					maxlength="72"
					placeholder="Repite la nueva contraseña"
				/>
			</Campo>
		</div>
		<p class="password-hint">
			Debe incluir al menos una letra y un número. No se muestra ni se recupera después de
			guardarla.
		</p>
	</section>

	{#snippet pie()}
		<button
			type="button"
			class="btn-secondary"
			disabled={guardando || cambiandoPassword}
			onclick={oncerrar}
		>
			Cancelar
		</button>
		<button
			type="button"
			class="btn-secondary"
			disabled={guardando || cambiandoPassword || !password || !confirmarPassword}
			onclick={cambiarPassword}
		>
			{#if cambiandoPassword}<Loader2 class="animate-spin" aria-hidden="true" /> Cambiando…{:else}Cambiar
				contraseña{/if}
		</button>
		<button
			type="submit"
			form={idForm}
			class="btn-primary"
			disabled={guardando || cambiandoPassword}
		>
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

<style>
	.password-panel {
		margin-top: 1.25rem;
		padding: 1rem;
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		background: var(--bg-surface);
	}
	.password-heading h3 {
		margin: 0;
		color: var(--text-primary);
		font-size: 0.95rem;
		font-weight: 700;
	}
	.password-heading p,
	.password-hint {
		margin: 0.25rem 0 0;
		color: var(--text-secondary);
		font-size: 0.8rem;
		line-height: 1.5;
	}
	.password-panel :global(.uf-fila) {
		margin-top: 0.9rem;
	}
	.password-panel :global(.uf-input) {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
	}
	.password-hint {
		margin-top: 0.65rem;
	}
</style>

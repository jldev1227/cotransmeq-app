<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Loader2, Plus } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import FormularioUsuario from './FormularioUsuario.svelte';
	import SelectorAreas from './SelectorAreas.svelte';
	import { apiClient } from '$lib/api/apiClient';

	/**
	 * Alta manual: la cuenta queda creada y lista, con la contraseña que
	 * escribe quien la crea.
	 *
	 * Alternativa a la invitación: en vez de mandar un correo y esperar a que
	 * la persona elija su contraseña, se la crea aquí ya lista. Hace falta
	 * para quien no tiene correo corporativo, para quien tiene que poder
	 * entrar hoy, y para no depender de que un correo no caiga en spam.
	 *
	 * Va contra `POST /api/usuarios`, que ya existía en el backend (con
	 * `authMiddleware + requireAdmin`) pero no tenía ninguna pantalla que lo
	 * usara: el alta manual solo se podía hacer con curl.
	 */
	interface Props {
		open: boolean;
		oncerrar: () => void;
		/** Tras crear: la página recarga su lista. */
		oncreado: () => void;
	}

	let { open, oncerrar, oncreado }: Props = $props();

	/**
	 * Roles que ofrece el alta manual. Son los valores del enum
	 * `enum_users_role` del backend; el label es solo para leerlos.
	 *
	 * El rol NO reemplaza a las áreas: quien decide a qué módulos entra
	 * alguien es `area` (y, si se afina, `permisos_rutas`). Aquí se elige
	 * porque `POST /api/usuarios` lo acepta y su default —`usuario`— no
	 * siempre es el que toca.
	 */
	const ROLES: Array<{ value: string; label: string }> = [
		{ value: 'usuario', label: 'Usuario' },
		{ value: 'admin', label: 'Administrador' },
		{ value: 'liquidador', label: 'Liquidador' },
		{ value: 'facturador', label: 'Facturador' },
		{ value: 'aprobador', label: 'Aprobador' },
		{ value: 'gestor_flota', label: 'Gestor de flota' },
		{ value: 'gestor_nomina', label: 'Gestor de nómina' },
		{ value: 'gestor_servicio', label: 'Gestor de servicios' },
		{ value: 'gestor_planillas', label: 'Gestor de planillas' },
		{ value: 'kilometraje', label: 'Kilometraje' },
		{ value: 'consulta', label: 'Consulta' }
	];

	const idForm = `nuevo-usuario-${Math.random().toString(36).slice(2, 8)}`;

	let creando = $state(false);
	let nombre = $state('');
	let correo = $state('');
	let password = $state('');
	let passwordConfirm = $state('');
	let telefono = $state('');
	let cargo = $state('');
	let role = $state('usuario');
	let areas = $state<string[]>([]);
	let verPassword = $state(false);
	let error = $state('');

	/// Cada apertura empieza en blanco: el modal sigue montado entre una y otra
	/// y no debe quedar a la vista la contraseña del alta anterior.
	$effect.pre(() => {
		if (!open) return;
		untrack(() => {
			nombre = '';
			correo = '';
			password = '';
			passwordConfirm = '';
			telefono = '';
			cargo = '';
			role = 'usuario';
			areas = [];
			verPassword = false;
			error = '';
		});
	});

	async function crear() {
		error = '';

		// Las mismas reglas que aplica `createUsuarioSchema` en el backend. Se
		// repiten aquí para avisar sin ir y volver, no para sustituirlo: el
		// backend las vuelve a aplicar porque esta pantalla no es la única
		// forma de llegar a la ruta.
		if (nombre.trim().length < 2) {
			error = 'El nombre debe tener al menos 2 caracteres';
			return;
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo.trim())) {
			error = 'Ingresa un correo electrónico válido';
			return;
		}
		if (password.length < 6) {
			error = 'La contraseña debe tener al menos 6 caracteres';
			return;
		}
		if (password !== passwordConfirm) {
			error = 'Las contraseñas no coinciden';
			return;
		}
		if (areas.length === 0) {
			error = 'Selecciona al menos un área';
			return;
		}

		try {
			creando = true;
			await apiClient.post('/api/usuarios', {
				nombre: nombre.trim(),
				correo: correo.trim().toLowerCase(),
				password,
				telefono: telefono.trim() || undefined,
				cargo: cargo.trim() || undefined,
				role,
				area: areas
			});
			toast.success(`Usuario ${nombre.trim()} creado`);
			oncerrar();
			oncreado();
		} catch (e: any) {
			// El 409 de correo duplicado trae el detalle en `message`; el 400 de
			// zod, en `error`. Sin este orden el duplicado sale como «Datos
			// inválidos», que no dice cuál es el problema.
			error =
				e?.response?.data?.message || e?.response?.data?.error || 'No se pudo crear el usuario';
		} finally {
			creando = false;
		}
	}
</script>

<ModalBase
	{open}
	tamano="md"
	eyebrow="Alta manual"
	title="Nuevo usuario"
	cerrarAlFondo={false}
	bloqueado={creando}
	{oncerrar}
>
	<FormularioUsuario id={idForm} onenviar={crear} {error}>
		<p class="uf-nota">
			La cuenta queda creada y lista para entrar con la contraseña que escribas aquí. No se envía
			ningún correo: díselo tú. Si prefieres que la elija esa persona, usa
			<strong>Invitar usuario</strong>.
		</p>

		<Campo id="{idForm}-nombre" label="Nombre completo" requerido>
			<input
				id="{idForm}-nombre"
				type="text"
				bind:value={nombre}
				class="uf-input"
				autocomplete="off"
				placeholder="Ej: María Fernanda Ríos"
			/>
		</Campo>

		<Campo id="{idForm}-correo" label="Correo electrónico" requerido>
			<input
				id="{idForm}-correo"
				type="email"
				bind:value={correo}
				class="uf-input"
				autocomplete="off"
				placeholder="usuario@empresa.com"
			/>
		</Campo>

		<div class="uf-fila">
			<Campo id="{idForm}-password" label="Contraseña" requerido>
				<input
					id="{idForm}-password"
					type={verPassword ? 'text' : 'password'}
					bind:value={password}
					class="uf-input"
					autocomplete="new-password"
					placeholder="Mínimo 6 caracteres"
				/>
			</Campo>
			<Campo id="{idForm}-password-2" label="Confirmar" requerido>
				<input
					id="{idForm}-password-2"
					type={verPassword ? 'text' : 'password'}
					bind:value={passwordConfirm}
					class="uf-input"
					autocomplete="new-password"
					placeholder="Repite la contraseña"
				/>
			</Campo>
		</div>
		<label class="uf-check">
			<input type="checkbox" bind:checked={verPassword} />
			Ver contraseña
		</label>

		<div class="uf-fila">
			<Campo id="{idForm}-telefono" label="Teléfono (opcional)">
				<input
					id="{idForm}-telefono"
					type="tel"
					bind:value={telefono}
					class="uf-input"
					placeholder="Ej: 320 000 0000"
				/>
			</Campo>
			<Campo id="{idForm}-cargo" label="Cargo (opcional)">
				<input
					id="{idForm}-cargo"
					type="text"
					bind:value={cargo}
					class="uf-input"
					placeholder="Ej: Coordinador de operaciones"
				/>
			</Campo>
		</div>

		<Campo id="{idForm}-role" label="Rol">
			<select id="{idForm}-role" bind:value={role} class="uf-input">
				{#each ROLES as r (r.value)}
					<option value={r.value}>{r.label}</option>
				{/each}
			</select>
		</Campo>

		<SelectorAreas seleccion={areas} onCambiar={(a) => (areas = a)} requerido />
	</FormularioUsuario>

	{#snippet pie()}
		<button type="button" class="btn-secondary" disabled={creando} onclick={oncerrar}>
			Cancelar
		</button>
		<button type="submit" form={idForm} class="btn-primary" disabled={creando}>
			{#if creando}
				<Loader2 class="animate-spin" aria-hidden="true" />
				Creando…
			{:else}
				<Plus strokeWidth={2} aria-hidden="true" />
				Crear usuario
			{/if}
		</button>
	{/snippet}
</ModalBase>

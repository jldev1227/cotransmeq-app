<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fade, fly, slide } from 'svelte/transition';
	import { clientesAPI } from '$lib/api/apiClient';

	// Constante para TipoCliente
	const TipoCliente = {
		EMPRESA: 'EMPRESA',
		PERSONA_NATURAL: 'PERSONA_NATURAL'
	} as const;

	type TipoCliente = (typeof TipoCliente)[keyof typeof TipoCliente];

	interface Servicio {
		id: string;
		origen_especifico: string;
		destino_especifico: string;
		fecha_realizacion: string;
		estado: string;
		valor: string;
		conductores?: {
			id: string;
			nombre: string;
			apellido: string;
			telefono: string;
		} | null;
		vehiculos?: {
			id: string;
			placa: string;
			marca: string;
			modelo: string;
		} | null;
		municipios_servicio_origen_idTomunicipios?: {
			id: string;
			nombre_municipio: string;
			nombre_departamento: string;
		};
		municipios_servicio_destino_idTomunicipios?: {
			id: string;
			nombre_municipio: string;
			nombre_departamento: string;
		};
	}

	interface Cliente {
		id: string;
		nit: string;
		nombre: string;
		representante: string | null;
		cedula: string | null;
		telefono: string;
		direccion: string;
		correo: string | null;
		requiere_osi: boolean;
		paga_recargos: boolean;
		tipo: TipoCliente;
		createdAt: string;
		updatedAt: string;
		deletedAt?: string | null;
		servicio?: Servicio[];
		_count?: {
			recargos: number;
			pernotes: number;
			servicio: number;
		};
	}

	// Estado
	let cliente: Cliente | null = null;
	let isLoading = true;
	let isEditing = false;
	let error: string | null = null;
	let activeTab: 'info' | 'servicios' | 'actividad' = 'info';
	let editForm: Partial<Cliente> = {};

	// Obtener ID del cliente de la URL
	$: clienteId = $page.params.id;

	onMount(() => {
		loadCliente();
	});

	async function loadCliente() {
		isLoading = true;
		error = null;

		try {
			const response = await clientesAPI.getById(clienteId);

			if (response.data && response.data.success) {
				cliente = response.data.data;
				editForm = { ...cliente };
			} else {
				// Datos de ejemplo para desarrollo
				cliente = {
					id: clienteId,
					nit: '900123456-1',
					nombre: 'Transportes del Valle S.A.S.',
					representante: 'Juan Carlos Pérez',
					cedula: null,
					telefono: '3201234567',
					direccion: 'Calle 15 #23-45, Valle del Cauca',
					correo: 'gerencia@transportesvalle.com',
					requiere_osi: true,
					paga_recargos: true,
					tipo: TipoCliente.EMPRESA,
					createdAt: '2024-01-15T10:30:00Z',
					updatedAt: '2024-01-15T10:30:00Z',
					_count: {
						recargos: 45,
						pernotes: 12,
						servicio: 34
					}
				};
				editForm = { ...cliente };
			}
		} catch (err: any) {
			console.error('Error cargando cliente:', err);
			error = err.message || 'Error al cargar el cliente';
		} finally {
			isLoading = false;
		}
	}

	function toggleEdit() {
		if (isEditing) {
			// Cancelar edición
			editForm = { ...cliente! };
		}
		isEditing = !isEditing;
	}

	async function saveChanges() {
		try {
			// Aquí iría la llamada a la API para guardar los cambios
			// await clientesAPI.update(clienteId, editForm);

			// Por ahora, solo actualizamos localmente
			cliente = { ...cliente!, ...editForm } as Cliente;
			isEditing = false;

			// Mostrar notificación de éxito
			alert('Cliente actualizado exitosamente');
		} catch (err: any) {
			console.error('Error guardando cambios:', err);
			error = err.message || 'Error al guardar los cambios';
		}
	}

	function getTipoColor(tipo: TipoCliente) {
		return tipo === TipoCliente.EMPRESA
			? 'bg-blue-100 text-blue-800'
			: 'bg-orange-100 text-orange-800';
	}

	function formatDate(dateString: string) {
		return new Date(dateString).toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function getEstadoServicioColor(estado: string) {
		const colores = {
			solicitado: 'bg-yellow-100 text-yellow-800 border-yellow-200',
			en_curso: 'bg-blue-100 text-blue-800 border-blue-200',
			planificado: 'bg-purple-100 text-purple-800 border-purple-200',
			realizado: 'bg-orange-100 text-orange-800 border-orange-200',
			cancelado: 'bg-red-100 text-red-800 border-red-200'
		};
		return colores[estado as keyof typeof colores] || 'bg-gray-100 text-gray-800 border-gray-200';
	}

	function getEstadoServicioLabel(estado: string) {
		const labels = {
			solicitado: 'Solicitado',
			en_curso: 'En Curso',
			planificado: 'Planificado',
			realizado: 'Realizado',
			cancelado: 'Cancelado'
		};
		return labels[estado as keyof typeof labels] || estado;
	}
</script>

<svelte:head>
	<title>{cliente?.nombre || 'Cargando...'} - Perfil Cliente</title>
</svelte:head>

{#if isLoading}
	<div class="flex min-h-screen items-center justify-center">
		<div class="text-center">
			<div
				class="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"
			></div>
			<p class="text-gray-600">Cargando perfil del cliente...</p>
		</div>
	</div>
{:else if error}
	<div class="p-6">
		<div class="glass rounded-2xl border border-red-200/50 bg-red-50/30 p-8 text-center">
			<h3 class="mb-2 text-lg font-semibold text-gray-900">Error</h3>
			<p class="mb-6 text-gray-600">{error}</p>
			<button
				on:click={() => goto('/dashboard/clientes')}
				class="apple-transition rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-3 font-semibold text-white shadow-lg hover:shadow-xl"
			>
				Volver a Clientes
			</button>
		</div>
	</div>
{:else if cliente}
	<div class="min-h-screen bg-gray-50">
		<!-- Header con información del cliente -->
		<div class="relative" in:fade={{ duration: 400 }}>
			<!-- Contenedor del perfil -->
			<div class="mx-auto max-w-7xl px-3 py-3 sm:px-4 lg:px-6">
				<!-- Header Card -->
				<div class="glass rounded-xl border border-white/50 bg-white/90 p-4 backdrop-blur-lg">
					<div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
						<!-- Avatar e Info Básica -->
						<div class="flex flex-col items-center gap-3 sm:flex-row">
							<!-- Avatar -->
							<div
								class="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-white bg-gradient-to-br from-orange-500 to-amber-600 shadow-lg"
							>
								{#if cliente.tipo === TipoCliente.EMPRESA}
									<svg
										class="h-10 w-10 text-white"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="1.5"
											d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
										/>
									</svg>
								{:else}
									<svg
										class="h-10 w-10 text-white"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="1.5"
											d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
										/>
									</svg>
								{/if}
							</div>

							<!-- Info -->
							<div>
								<h1 class="text-xl font-bold text-gray-900">{cliente.nombre}</h1>
								<div class="mt-1 flex flex-wrap items-center gap-2">
									<span
										class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold {getTipoColor(
											cliente.tipo
										)}"
									>
										{cliente.tipo === TipoCliente.EMPRESA ? '🏢 Empresa' : '👤 Persona Natural'}
									</span>
									<span class="text-xs text-gray-600">NIT: {cliente.nit}</span>
									{#if cliente.requiere_osi}
										<span
											class="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700"
										>
											OSI
										</span>
									{/if}
									{#if cliente.paga_recargos}
										<span
											class="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700"
										>
											Recargos
										</span>
									{/if}
								</div>
							</div>
						</div>

						<!-- Botones de Acción -->
						<div class="flex gap-2">
							{#if isEditing}
								<button
									on:click={toggleEdit}
									class="apple-transition rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
								>
									Cancelar
								</button>
								<button
									on:click={saveChanges}
									class="apple-transition rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:shadow-xl"
								>
									Guardar
								</button>
							{:else}
								<button
									on:click={() => goto('/dashboard/clientes')}
									class="apple-transition rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
								>
									← Volver
								</button>
								<button
									on:click={toggleEdit}
									class="apple-transition rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:shadow-xl"
								>
									✏️ Editar
								</button>
							{/if}
						</div>
					</div>
				</div>

				<!-- Tabs Navigation -->
				<div class="mt-3" in:fly={{ y: 20, duration: 400, delay: 200 }}>
					<div class="glass rounded-xl border border-white/50 bg-white/90 p-1.5 backdrop-blur-lg">
						<div class="flex gap-1.5">
							<button
								on:click={() => (activeTab = 'info')}
								class="apple-transition flex-1 rounded-lg px-4 py-2 text-sm font-semibold {activeTab ===
								'info'
									? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-md'
									: 'text-gray-600 hover:bg-gray-100'}"
							>
								📋 Información
							</button>
							<button
								on:click={() => (activeTab = 'servicios')}
								class="apple-transition flex-1 rounded-lg px-4 py-2 text-sm font-semibold {activeTab ===
								'servicios'
									? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-md'
									: 'text-gray-600 hover:bg-gray-100'}"
							>
								🚛 Servicios ({cliente._count?.servicio || 0})
							</button>
							<button
								on:click={() => (activeTab = 'actividad')}
								class="apple-transition flex-1 rounded-lg px-4 py-2 text-sm font-semibold {activeTab ===
								'actividad'
									? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-md'
									: 'text-gray-600 hover:bg-gray-100'}"
							>
								📊 Actividad
							</button>
						</div>
					</div>
				</div>

				<!-- Tab Content -->
				<div class="mt-3 pb-4">
					{#if activeTab === 'info'}
						<div
							class="grid grid-cols-1 gap-3 lg:grid-cols-3"
							in:fly={{ y: 20, duration: 400, delay: 300 }}
						>
							<!-- Columna Principal - Información Detallada -->
							<div class="lg:col-span-2">
								<div class="glass space-y-4 rounded-xl border border-white/50 bg-white/90 p-4">
									<h2 class="text-base font-bold text-gray-900">Información del Cliente</h2>

									{#if isEditing}
										<!-- Formulario de Edición -->
										<div class="space-y-3">
											<div>
												<label class="mb-1 block text-xs font-medium text-gray-700">
													Nombre Completo / Razón Social
												</label>
												<input
													type="text"
													bind:value={editForm.nombre}
													class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
												/>
											</div>

											<div class="grid gap-3 sm:grid-cols-2">
												<div>
													<label class="mb-1 block text-xs font-medium text-gray-700">NIT</label>
													<input
														type="text"
														bind:value={editForm.nit}
														class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
													/>
												</div>

												{#if cliente.tipo === TipoCliente.PERSONA_NATURAL}
													<div>
														<label class="mb-1 block text-xs font-medium text-gray-700"
															>Cédula</label
														>
														<input
															type="text"
															bind:value={editForm.cedula}
															class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
														/>
													</div>
												{/if}
											</div>

											{#if cliente.tipo === TipoCliente.EMPRESA}
												<div>
													<label class="mb-1 block text-xs font-medium text-gray-700">
														Representante Legal
													</label>
													<input
														type="text"
														bind:value={editForm.representante}
														class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
													/>
												</div>
											{/if}

											<div class="grid gap-3 sm:grid-cols-2">
												<div>
													<label class="mb-1 block text-xs font-medium text-gray-700"
														>Teléfono</label
													>
													<input
														type="text"
														bind:value={editForm.telefono}
														class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
													/>
												</div>

												<div>
													<label class="mb-1 block text-xs font-medium text-gray-700">Correo</label>
													<input
														type="email"
														bind:value={editForm.correo}
														class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
													/>
												</div>
											</div>

											<div>
												<label class="mb-1 block text-xs font-medium text-gray-700">Dirección</label
												>
												<textarea
													bind:value={editForm.direccion}
													rows="2"
													class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
												></textarea>
											</div>

											<div class="grid gap-3 sm:grid-cols-2">
												<div class="flex items-center gap-2">
													<input
														type="checkbox"
														id="requiere_osi"
														bind:checked={editForm.requiere_osi}
														class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
													/>
													<label for="requiere_osi" class="text-xs font-medium text-gray-700">
														Requiere OSI
													</label>
												</div>

												<div class="flex items-center gap-2">
													<input
														type="checkbox"
														id="paga_recargos"
														bind:checked={editForm.paga_recargos}
														class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
													/>
													<label for="paga_recargos" class="text-xs font-medium text-gray-700">
														Paga Recargos
													</label>
												</div>
											</div>
										</div>
									{:else}
										<!-- Vista de Información -->
										<div class="space-y-3">
											<div class="flex items-start gap-2 rounded-lg bg-gray-50 p-3">
												<svg
													class="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
													/>
												</svg>
												<div class="flex-1">
													<p class="text-xs font-medium text-gray-500">
														{cliente.tipo === TipoCliente.EMPRESA
															? 'Representante Legal'
															: 'Nombre Completo'}
													</p>
													<p class="mt-0.5 text-sm text-gray-900">
														{cliente.representante || cliente.nombre}
													</p>
												</div>
											</div>

											{#if cliente.cedula}
												<div class="flex items-start gap-2 rounded-lg bg-gray-50 p-3">
													<svg
														class="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2"
														/>
													</svg>
													<div class="flex-1">
														<p class="text-xs font-medium text-gray-500">Cédula</p>
														<p class="mt-0.5 text-sm text-gray-900">{cliente.cedula}</p>
													</div>
												</div>
											{/if}

											<div class="flex items-start gap-2 rounded-lg bg-gray-50 p-3">
												<svg
													class="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21L6.374 11.5l8.25 8.25 2.113-3.85a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V20.72a2 2 0 01-2 2h-1.28C10.5 22.72 1.28 13.5 1.28 2.72V1.44a2 2 0 012-2H6.5z"
													/>
												</svg>
												<div class="flex-1">
													<p class="text-xs font-medium text-gray-500">Teléfono</p>
													<p class="mt-0.5 text-sm text-gray-900">{cliente.telefono}</p>
												</div>
											</div>

											<div class="flex items-start gap-2 rounded-lg bg-gray-50 p-3">
												<svg
													class="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M3 8l7.89 7.89a2 2 0 002.83 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
													/>
												</svg>
												<div class="flex-1">
													<p class="text-xs font-medium text-gray-500">Correo Electrónico</p>
													<p class="mt-0.5 text-sm text-gray-900">
														{cliente.correo || 'No registrado'}
													</p>
												</div>
											</div>

											<div class="flex items-start gap-2 rounded-lg bg-gray-50 p-3">
												<svg
													class="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
													/>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
													/>
												</svg>
												<div class="flex-1">
													<p class="text-xs font-medium text-gray-500">Dirección</p>
													<p class="mt-0.5 text-sm text-gray-900">{cliente.direccion}</p>
												</div>
											</div>
										</div>
									{/if}
								</div>
							</div>

							<!-- Columna Lateral - Estadísticas y Detalles -->
							<div class="space-y-4">
								<!-- Estadísticas -->
								<div class="glass rounded-xl border border-white/50 bg-white/90 p-4">
									<h3 class="mb-3 text-sm font-bold text-gray-900">Estadísticas</h3>
									<div class="space-y-3">
										<div class="rounded-lg bg-orange-50 p-3">
											<div class="flex items-center justify-between">
												<span class="text-xs text-gray-600">Servicios</span>
												<span class="text-xl font-bold text-orange-600">
													{cliente._count?.servicio || 0}
												</span>
											</div>
										</div>
										<div class="rounded-lg bg-purple-50 p-3">
											<div class="flex items-center justify-between">
												<span class="text-xs text-gray-600">Recargos</span>
												<span class="text-xl font-bold text-purple-600">
													{cliente._count?.recargos || 0}
												</span>
											</div>
										</div>
									</div>
								</div>

								<!-- Información Adicional -->
								<div class="glass rounded-xl border border-white/50 bg-white/90 p-4">
									<h3 class="mb-3 text-sm font-bold text-gray-900">Detalles</h3>
									<div class="space-y-2 text-xs">
										<div class="flex justify-between">
											<span class="text-gray-600">Cliente desde</span>
											<span class="font-medium text-gray-900">
												{new Date(cliente.createdAt).toLocaleDateString('es-CO', {
													year: 'numeric',
													month: 'short',
													day: 'numeric'
												})}
											</span>
										</div>
										<div class="flex justify-between">
											<span class="text-gray-600">Actualizado</span>
											<span class="font-medium text-gray-900">
												{new Date(cliente.updatedAt).toLocaleDateString('es-CO', {
													year: 'numeric',
													month: 'short',
													day: 'numeric'
												})}
											</span>
										</div>
										<div class="flex justify-between">
											<span class="text-gray-600">ID</span>
											<span class="font-mono text-xs text-gray-900">{cliente.id}</span>
										</div>
									</div>
								</div>
							</div>
						</div>
					{:else if activeTab === 'servicios'}
						<div
							class="glass rounded-xl border border-white/50 bg-white/90 p-4"
							in:fly={{ y: 20, duration: 400, delay: 300 }}
						>
							<div class="mb-4 flex items-center justify-between">
								<h2 class="text-base font-bold text-gray-900">Servicios del Cliente</h2>
								<span class="text-xs text-gray-600">
									{cliente._count?.servicio || 0} servicios totales
								</span>
							</div>

							{#if cliente.servicio && cliente.servicio.length > 0}
								<div class="space-y-3">
									{#each cliente.servicio as servicio (servicio.id)}
										<div
											class="glass rounded-lg border border-gray-200/50 p-3 transition-all hover:shadow-md"
											in:fly={{ y: 10, duration: 300 }}
										>
											<!-- Header: Estado y Fecha -->
											<div class="mb-2 flex items-start justify-between">
												<span
													class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold {getEstadoServicioColor(
														servicio.estado
													)}"
												>
													{getEstadoServicioLabel(servicio.estado)}
												</span>
												<span class="text-xs text-gray-500">
													{new Date(servicio.fecha_realizacion).toLocaleDateString('es-CO', {
														day: '2-digit',
														month: 'short',
														year: 'numeric'
													})}
												</span>
											</div>

											<!-- Origen → Destino -->
											<div class="mb-3 flex items-center gap-2 text-sm">
												<div class="flex items-center gap-1 text-gray-700">
													<svg
														class="h-4 w-4 shrink-0 text-orange-600"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
														/>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
														/>
													</svg>
													<span class="font-medium">
														{servicio.municipios_servicio_origen_idTomunicipios?.nombre_municipio ||
															'Origen'}
													</span>
												</div>

												<svg
													class="h-4 w-4 shrink-0 text-gray-400"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M13 7l5 5m0 0l-5 5m5-5H6"
													/>
												</svg>

												<div class="flex items-center gap-1 text-gray-700">
													<svg
														class="h-4 w-4 shrink-0 text-amber-600"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
														/>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
														/>
													</svg>
													<span class="font-medium">
														{servicio.municipios_servicio_destino_idTomunicipios
															?.nombre_municipio || 'Destino'}
													</span>
												</div>
											</div>

											<!-- Conductor y Vehículo -->
											<div class="flex items-center gap-4 text-xs text-gray-600">
												{#if servicio.conductores}
													<div class="flex items-center gap-1.5">
														<svg
															class="h-3.5 w-3.5 shrink-0 text-gray-400"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
															/>
														</svg>
														<span>
															{servicio.conductores.nombre}
															{servicio.conductores.apellido}
														</span>
													</div>
												{/if}

												{#if servicio.vehiculos}
													<div class="flex items-center gap-1.5">
														<svg
															class="h-3.5 w-3.5 shrink-0 text-gray-400"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
															/>
														</svg>
														<span class="font-medium">{servicio.vehiculos.placa}</span>
														<span class="text-gray-400">•</span>
														<span>
															{servicio.vehiculos.marca}
															{servicio.vehiculos.modelo}
														</span>
													</div>
												{/if}
											</div>

											<!-- Ver más -->
											<div class="mt-2 border-t border-gray-100 pt-2">
												<button
													on:click={() => goto(`/dashboard/servicios/${servicio.id}`)}
													class="text-xs font-medium text-orange-600 hover:text-orange-700"
												>
													Ver detalles →
												</button>
											</div>
										</div>
									{/each}
								</div>

								{#if (cliente._count?.servicio || 0) > 5}
									<div class="mt-4 text-center">
										<button
											on:click={() => goto(`/dashboard/servicios?clienteId=${cliente.id}`)}
											class="text-sm font-medium text-gray-600 hover:text-orange-600"
										>
											Ver todos los {cliente._count?.servicio} servicios →
										</button>
									</div>
								{/if}
							{:else}
								<div class="py-8 text-center">
									<svg
										class="mx-auto h-12 w-12 text-gray-400"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="1"
											d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
										/>
									</svg>
									<p class="mt-3 text-sm text-gray-600">No hay servicios registrados</p>
								</div>
							{/if}
						</div>
					{:else if activeTab === 'actividad'}
						<div
							class="glass rounded-xl border border-white/50 bg-white/90 p-4"
							in:fly={{ y: 20, duration: 400, delay: 300 }}
						>
							<h2 class="mb-4 text-base font-bold text-gray-900">Historial de Actividad</h2>
							<div class="py-8 text-center">
								<svg
									class="mx-auto h-12 w-12 text-gray-400"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1"
										d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
								<p class="mt-3 text-sm text-gray-600">
									Historial de actividad próximamente disponible
								</p>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

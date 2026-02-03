<script lang="ts">
	import StatCard from './StatCard.svelte';
	import { fade, fly } from 'svelte/transition';

	const dashboardStats = [
		{
			title: 'Vehículos Activos',
			value: 45,
			subtitle: 'En servicio',
			icon: 'truck',
			trend: 'up' as const,
			trendValue: '+5.2%',
			color: 'orange' as const
		},
		{
			title: 'Conductores',
			value: 127,
			subtitle: 'Registrados',
			icon: 'users',
			trend: 'up' as const,
			trendValue: '+2.1%',
			color: 'blue' as const
		},
		{
			title: 'Rutas Completadas',
			value: 1842,
			subtitle: 'Este mes',
			icon: 'chart',
			trend: 'up' as const,
			trendValue: '+12.5%',
			color: 'purple' as const
		},
		{
			title: 'Ingresos',
			value: '$45,230',
			subtitle: 'Este mes',
			icon: 'money',
			trend: 'up' as const,
			trendValue: '+8.3%',
			color: 'orange' as const
		}
	];

	const recentActivity = [
		{
			id: 1,
			type: 'vehicle_start',
			message: 'Vehículo TM-001 inició ruta Centro-Norte',
			time: '2 min ago',
			icon: 'truck',
			color: 'orange'
		},
		{
			id: 2,
			type: 'driver_login',
			message: 'Juan Pérez inició sesión',
			time: '15 min ago',
			icon: 'users',
			color: 'blue'
		},
		{
			id: 3,
			type: 'route_complete',
			message: 'Ruta Sur-Este completada exitosamente',
			time: '32 min ago',
			icon: 'chart',
			color: 'purple'
		},
		{
			id: 4,
			type: 'maintenance',
			message: 'TM-005 necesita mantenimiento',
			time: '1 hora ago',
			icon: 'warning',
			color: 'orange'
		}
	];

	function getActivityIcon(iconName: string) {
		const icons = {
			truck: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />`,
			users: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1z" />`,
			chart: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2z" />`,
			warning: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />`
		};
		return icons[iconName as keyof typeof icons] || icons.chart;
	}

	function getActivityColorClasses(color: string) {
		const colors = {
			orange: 'from-orange-400 to-orange-600',
			blue: 'from-blue-400 to-blue-600',
			purple: 'from-purple-400 to-purple-600',
			orange: 'from-orange-400 to-orange-600'
		};
		return colors[color as keyof typeof colors] || colors.orange;
	}
</script>

<div class="space-y-6 p-6">
	<!-- Page Header -->
	<div class="mb-8" in:fade={{ duration: 600, delay: 100 }}>
		<h1 class="mb-2 text-2xl font-bold text-gray-900">Dashboard General</h1>
		<p class="text-gray-600">Resumen de actividades y estadísticas del sistema</p>
	</div>

	<!-- Stats Grid -->
	<div class="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
		{#each dashboardStats as stat, index}
			<StatCard
				title={stat.title}
				value={stat.value}
				subtitle={stat.subtitle}
				icon={stat.icon}
				trend={stat.trend}
				trendValue={stat.trendValue}
				color={stat.color}
				delay={index * 100 + 200}
			/>
		{/each}
	</div>

	<!-- Content Grid -->
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
		<!-- Recent Activity -->
		<div
			class="glass rounded-2xl border border-gray-200/50 p-6 lg:col-span-2"
			in:fly={{ y: 20, duration: 600, delay: 600 }}
		>
			<div class="mb-6 flex items-center justify-between">
				<h2 class="text-lg font-semibold text-gray-900">Actividad Reciente</h2>
				<button
					class="apple-transition text-sm font-medium text-orange-600 hover:text-orange-700"
				>
					Ver todo
				</button>
			</div>

			<div class="space-y-4">
				{#each recentActivity as activity, index}
					<div
						class="apple-transition group flex items-start space-x-4 rounded-xl p-4 hover:bg-gray-50/80"
						in:fade={{ duration: 400, delay: 700 + index * 100 }}
					>
						<div
							class="h-10 w-10 flex-shrink-0 bg-gradient-to-br {getActivityColorClasses(
								activity.color
							)} soft-shadow apple-transition flex items-center justify-center rounded-xl group-hover:scale-105"
						>
							<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								{@html getActivityIcon(activity.icon)}
							</svg>
						</div>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium text-gray-900">{activity.message}</p>
							<p class="mt-1 text-xs text-gray-500">{activity.time}</p>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Quick Actions -->
		<div
			class="glass rounded-2xl border border-gray-200/50 p-6"
			in:fly={{ y: 20, duration: 600, delay: 800 }}
		>
			<h2 class="mb-6 text-lg font-semibold text-gray-900">Acciones Rápidas</h2>

			<div class="space-y-3">
				<button
					class="apple-hover apple-transition soft-shadow flex w-full items-center justify-between rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 p-4 text-white"
				>
					<span class="font-medium">Nuevo Conductor</span>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 6v6m0 0v6m0-6h6m-6 0H6"
						/>
					</svg>
				</button>

				<button
					class="apple-transition flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-4 text-gray-700 hover:border-orange-200 hover:bg-orange-50"
				>
					<span class="font-medium">Registrar Vehículo</span>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M8 9l4-4 4 4m0 6l-4 4-4-4"
						/>
					</svg>
				</button>

				<button
					class="apple-transition flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-4 text-gray-700 hover:border-orange-200 hover:bg-orange-50"
				>
					<span class="font-medium">Nueva Ruta</span>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
						/>
					</svg>
				</button>

				<button
					class="apple-transition flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-4 text-gray-700 hover:border-orange-200 hover:bg-orange-50"
				>
					<span class="font-medium">Ver Reportes</span>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
						/>
					</svg>
				</button>
			</div>
		</div>
	</div>

	<!-- Charts Section (Placeholder for future implementation) -->
	<div
		class="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2"
		in:fly={{ y: 20, duration: 600, delay: 1000 }}
	>
		<div class="glass rounded-2xl border border-gray-200/50 p-6">
			<h3 class="mb-4 text-lg font-semibold text-gray-900">Rendimiento Mensual</h3>
			<div
				class="flex h-64 items-center justify-center rounded-xl bg-gradient-to-br from-orange-50 to-orange-100/50"
			>
				<p class="text-sm text-gray-500">Gráfico de rendimiento aquí</p>
			</div>
		</div>

		<div class="glass rounded-2xl border border-gray-200/50 p-6">
			<h3 class="mb-4 text-lg font-semibold text-gray-900">Distribución de Rutas</h3>
			<div
				class="flex h-64 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-blue-100/50"
			>
				<p class="text-sm text-gray-500">Gráfico de rutas aquí</p>
			</div>
		</div>
	</div>
</div>

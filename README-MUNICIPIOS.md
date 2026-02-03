# Store de Municipios - Documentación

## 📋 Descripción

Sistema de gestión de municipios integrado con el backend NestJS. Proporciona carga, caché, búsqueda y filtrado de municipios colombianos con sus departamentos.

## 🏗️ Arquitectura

### Backend (NestJS)

**Endpoint Base:** `/api/municipios`

#### Endpoints Disponibles:

1. **GET `/api/municipios`**
   - Lista todos los municipios ordenados por departamento y nombre
   - Respuesta: Array de municipios

2. **GET `/api/municipios/buscar`**
   - Búsqueda con filtros y paginación
   - Query params:
     - `nombre`: Nombre del municipio (opcional)
     - `departamento`: Nombre del departamento (opcional)
     - `tipo`: "Municipio" | "Área no municipalizada" (opcional)
     - `codigo_departamento`: Código numérico (opcional)
     - `page`: Página actual (default: 1)
     - `limit`: Items por página (default: 20, max: 100)
   - Respuesta: `{ municipios: [], pagination: { page, limit, total, totalPages } }`

3. **GET `/api/municipios/departamento/:codigoDepartamento`**
   - Obtiene todos los municipios de un departamento
   - Respuesta: Array de municipios

4. **GET `/api/municipios/:id`**
   - Obtiene un municipio específico por ID
   - Respuesta: Objeto municipio

### Frontend (Svelte)

**Store:** `/lib/stores/municipios.ts`

#### Estructura del Estado:

```typescript
interface MunicipiosState {
	municipios: Municipio[];
	municipiosPorDepartamento: Record<number, Municipio[]>;
	loading: boolean;
	error: string | null;
	lastFetch: number | null;
}
```

#### Tipo Municipio:

```typescript
interface Municipio {
	id: string;
	codigo_municipio: number;
	nombre_municipio: string;
	nombre_departamento: string;
	codigo_departamento: number;
	tipo?: string;
	latitud?: number;
	longitud?: number;
}
```

## 🚀 Uso

### Cargar Municipios

```typescript
import { municipios } from '$lib/stores/municipios';

// Cargar todos los municipios (con caché de 10 minutos)
await municipios.cargarTodos();

// Forzar recarga
await municipios.cargarTodos(true);
```

### Filtrar por Departamento

```typescript
// Cargar municipios de un departamento específico
const munsDepartamento = await municipios.cargarPorDepartamento(5); // Antioquia

// O usar el store derivado
import { getMunicipiosPorDepartamento } from '$lib/stores/municipios';
const antioquia = getMunicipiosPorDepartamento(5);
```

### Buscar Municipios

```typescript
// Búsqueda simple por nombre
const result = await municipios.buscar({
	nombre: 'Medellín'
});

// Búsqueda avanzada
const result = await municipios.buscar({
	departamento: 'Antioquia',
	tipo: 'Municipio',
	page: 1,
	limit: 50
});
```

### Obtener Municipio por ID

```typescript
const municipio = await municipios.obtenerPorId('uuid-del-municipio');
```

## 📊 Stores Derivados

### `municipiosOptions`

Formatea los municipios para uso en componentes `<select>` o `svelte-select`:

```typescript
import { municipiosOptions } from '$lib/stores/municipios';

$: options = $municipiosOptions;
// [{ value: 'uuid', label: 'Medellín, Antioquia' }, ...]
```

### `departamentos`

Lista única de departamentos ordenados alfabéticamente:

```typescript
import { departamentos } from '$lib/stores/municipios';

$: depts = $departamentos;
// [{ codigo: 5, nombre: 'Antioquia' }, ...]
```

### `departamentosOptions`

Formatea los departamentos para componentes de selección:

```typescript
import { departamentosOptions } from '$lib/stores/municipios';

$: options = $departamentosOptions;
// [{ value: 5, label: 'Antioquia' }, ...]
```

## 🎯 Ejemplo Completo

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { municipios, municipiosOptions, departamentosOptions } from '$lib/stores/municipios';

	let selectedDepartamento: number | null = null;
	let selectedMunicipio: string | null = null;

	onMount(async () => {
		// Cargar todos los municipios al iniciar
		await municipios.cargarTodos();
	});

	async function handleDepartamentoChange() {
		if (selectedDepartamento) {
			// Cargar municipios específicos del departamento
			await municipios.cargarPorDepartamento(selectedDepartamento);
		}
	}
</script>

<div>
	<!-- Selector de departamento -->
	<select bind:value={selectedDepartamento} on:change={handleDepartamentoChange}>
		<option value={null}>Seleccionar departamento</option>
		{#each $departamentosOptions as dept}
			<option value={dept.value}>{dept.label}</option>
		{/each}
	</select>

	<!-- Selector de municipio -->
	<select bind:value={selectedMunicipio}>
		<option value={null}>Seleccionar municipio</option>
		{#each $municipiosOptions as mun}
			<option value={mun.value}>{mun.label}</option>
		{/each}
	</select>
</div>
```

## 🔄 Integración con ModalFormServicio

El modal de formulario de servicios ya está integrado con el store de municipios:

```svelte
<script lang="ts">
	import { municipios, municipiosOptions } from '$lib/stores/municipios';

	async function loadData() {
		await Promise.all([recursos.cargarTodos(), municipios.cargarTodos()]);
	}

	$: municipioOptions = $municipiosOptions;
</script>

<ModalSelectCliente
	isOpen={mostrarModalSelectOrigen}
	items={municipioOptions}
	selectedValue={selectedOriginMun}
	title="Seleccionar Municipio de Origen"
	icon="location"
	onSelect={(value) => (selectedOriginMun = value)}
/>
```

## ⚡ Optimizaciones

### Caché Inteligente

- **Duración:** 10 minutos (municipios cambian raramente)
- **Automático:** No recarga si los datos son recientes
- **Forzado:** Usar `force=true` para recargar

### Agrupación por Departamento

Los municipios se agrupan automáticamente por código de departamento en el estado:

```typescript
municipiosPorDepartamento: {
  5: [/* municipios de Antioquia */],
  11: [/* municipios de Bogotá D.C. */],
  // ...
}
```

### Búsqueda Optimizada

El backend usa Prisma con:

- Ordenamiento por departamento y municipio
- Búsqueda case-insensitive
- Paginación eficiente
- Count paralelo para total de resultados

## 🧪 Página de Prueba

Visita `/test-municipios` para probar todas las funcionalidades:

- Ver total de municipios y departamentos
- Buscar municipios por nombre
- Filtrar por departamento
- Ver lista completa
- Estadísticas en tiempo real

## 📝 Notas Importantes

1. **Cache Duration:** Los municipios tienen un cache de 10 minutos vs 5 minutos de otros recursos (cambian menos frecuentemente)

2. **Ordenamiento:** Siempre ordenados alfabéticamente por departamento y luego por municipio

3. **Formato:** El label en los options incluye departamento: `"Municipio, Departamento"`

4. **Lazy Loading:** Los municipios por departamento se cargan solo cuando se necesitan

5. **Error Handling:** Todos los métodos tienen manejo de errores con logs descriptivos

## 🔧 Mantenimiento

### Actualizar Datos

```typescript
// Limpiar caché y recargar
municipios.limpiar();
await municipios.cargarTodos(true);
```

### Debugging

Los métodos incluyen logs detallados:

- `🔄` Cargando datos
- `✅` Operación exitosa
- `❌` Error ocurrido

Ver consola del navegador para seguimiento.

## 🌐 API Backend

Para más detalles del backend, ver:

- `/backend-nest/src/modules/municipios/municipios.service.ts`
- `/backend-nest/src/modules/municipios/municipios.controller.ts`
- `/backend-nest/src/modules/municipios/municipios.routes.ts`

---

**Última actualización:** 20 de diciembre de 2025

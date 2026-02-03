# Módulo de Recargos - SvelteKit Implementation Guide

## ✅ Archivos Creados

### 1. Tipos TypeScript

- ✅ `src/lib/types/recargos.ts` - Definiciones de tipos completas

### 2. API Client

- ✅ `src/lib/api/recargos.ts` - Cliente HTTP para comunicación con backend

### 3. Store de Svelte

- ✅ `src/lib/stores/recargos.ts` - Gestión de estado reactivo

## 🚧 Pendientes de Crear

### 4. Página Principal del Canvas

**Archivo**: `src/routes/dashboard/recargos/+page.svelte`

**Funcionalidad**:

- Tabla/canvas con scroll horizontal para días del mes
- Filtros por: conductor, vehículo, empresa, estado, número planilla
- Navegación de mes/año
- Botones de acciones: crear, editar, eliminar, liquidar, duplicar
- Selección múltiple de filas
- Copiar filas a Excel (formato con comas)
- Totales por columna (HED, HEN, HEFD, HEFN, RN, RD)
- Estados visuales con colores

**Estructura**:

```svelte
<script lang="ts">
	import { recargosStore } from '$lib/stores/recargos';
	import { onMount } from 'svelte';

	// State para filtros, búsqueda, paginación
	// Funciones para manejar acciones
	// Lógica de selección múltiple
</script>

<!-- Header con filtros y navegación mes/año -->
<!-- Botones de acciones -->
<!-- Tabla horizontal scrollable con días del mes -->
<!-- Modales -->
```

### 5. Modal Crear/Editar Recargo

**Archivo**: `src/lib/components/modals/ModalFormRecargo.svelte`

**Campos**:

- Selector de conductor (autocompletable)
- Selector de vehículo (autocompletable)
- Selector de empresa (dropdown)
- Mes y año (selectores)
- Número de planilla (opcional, input)
- Upload de archivo PDF/imagen
- Observaciones (textarea)
- Tabla de días laborales:
  - Día (número)
  - Hora inicio (decimal 0-24)
  - Hora fin (decimal 0-24)
  - Es festivo (checkbox)
  - Observaciones día (input)
  - Botón eliminar día

**Validaciones**:

- Conductor requerido
- Vehículo requerido
- Empresa requerida
- Al menos un día laboral
- Horas válidas (0-24)
- Hora fin > hora inicio (o manejo de cruce de medianoche)

### 6. Modal Visualizar Recargo

**Archivo**: `src/lib/components/modals/ModalVisualizarRecargo.svelte`

**Secciones**:

- Header con info básica (conductor, vehículo, empresa, planilla)
- Estado y fechas
- Archivo adjunto (link de descarga si existe)
- Tabla de días laborales con totales calculados
- Sección de recargos totales:
  - Total Horas Trabajadas
  - HED (Horas Extra Diurnas)
  - HEN (Horas Extra Nocturnas)
  - HEFD (Horas Extra Festivas Diurnas)
  - HEFN (Horas Extra Festivas Nocturnas)
  - RN (Recargo Nocturno)
  - RD (Recargo Dominical/Festivo)
- Historial de cambios (versiones)
- Botones: Editar, Liquidar, Duplicar, Eliminar

### 7. Componente Tabla Canvas

**Archivo**: `src/lib/components/TablaRecargosCanvas.svelte`

**Características**:

- Scroll horizontal para días (1-31)
- Columnas fijas: empresa, planilla, vehículo, conductor
- Columnas dinámicas por día del mes
- Columnas de totales: total_horas, promedio, HED, HEN, HEFD, HEFN, RN, RD
- Sticky headers
- Domingos resaltados (fondo diferente)
- Festivos resaltados
- Celdas editables inline (opcional)
- Tooltips con detalles al hover
- Colores por estado

### 8. Filtros Avanzados

**Archivo**: `src/lib/components/FiltrosRecargos.svelte`

**Filtros**:

- Búsqueda por texto (conductor, vehículo, número planilla)
- Multiselect conductores
- Multiselect vehículos
- Multiselect empresas
- Multiselect estados
- Rango de fechas
- Botón limpiar filtros
- Botón aplicar filtros

### 9. Componente Navegación Mes/Año

**Archivo**: `src/lib/components/DateNavigationRecargos.svelte`

**Funcionalidad**:

- Selector de mes (dropdown o pills)
- Selector de año (dropdown)
- Botones anterior/siguiente mes
- Botón "Hoy" (volver al mes actual)
- Display del mes/año seleccionado

### 10. Utilidades de Cálculo

**Archivo**: `src/lib/utils/recargosCalculos.ts`

**Funciones**:

```typescript
// Calcular días en mes
export function getDaysInMonth(mes: number, año: number): number;

// Verificar si es domingo
export function esDomingo(dia: number, mes: number, año: number): boolean;

// Verificar si es festivo
export function esDiaFestivo(dia: number, diasFestivos: number[]): boolean;

// Calcular horas trabajadas
export function calcularHorasTrabajadas(horaInicio: number, horaFin: number): number;

// Calcular HED (Hora Extra Diurna)
export function calcularHED(
	dia: number,
	mes: number,
	año: number,
	totalHoras: number,
	diasFestivos: number[]
): number;

// Calcular HEN (Hora Extra Nocturna)
export function calcularHEN(
	dia: number,
	mes: number,
	año: number,
	horaFin: number,
	totalHoras: number,
	diasFestivos: number[]
): number;

// Calcular HEFD
export function calcularHEFD(
	dia: number,
	mes: number,
	año: number,
	totalHoras: number,
	diasFestivos: number[]
): number;

// Calcular HEFN
export function calcularHEFN(
	dia: number,
	mes: number,
	año: number,
	horaFin: number,
	totalHoras: number,
	diasFestivos: number[]
): number;

// Calcular Recargo Nocturno
export function calcularRecargoNocturno(horaInicio: number, horaFin: number): number;

// Calcular Recargo Dominical
export function calcularRecargoDominical(
	dia: number,
	mes: number,
	año: number,
	totalHoras: number,
	diasFestivos: number[]
): number;

// Calcular todos los recargos de un día
export function calcularRecargos(params: {
	dia: number;
	mes: number;
	año: number;
	horaInicio: number;
	horaFin: number;
	diasFestivos: number[];
}): RecargosCalculados;
```

### 11. Helpers de Formato

**Archivo**: `src/lib/utils/formatters.ts`

```typescript
// Formatear horas decimales a HH:MM
export function formatearHoraDecimal(hora: number): string;

// Convertir HH:MM a decimal
export function convertirHoraADecimal(hora: string): number;

// Formatear valor monetario
export function formatearCOP(valor: number): string;

// Obtener label de estado
export function getEstadoLabel(estado: string): string;

// Obtener color de estado
export function getEstadoColor(estado: string): string;

// Formatear número planilla con prefijo TM-
export function formatearNumeroPlanilla(numero: string): string;
```

## 📊 Lógica de Cálculo de Recargos

### Constantes

```typescript
const HORAS_LIMITE = {
	JORNADA_NORMAL: 10, // 10 horas (no 8!)
	INICIO_NOCTURNO: 21, // 21:00 (9 PM)
	FIN_NOCTURNO: 6 // 06:00 (6 AM)
};
```

### Fórmulas del Backend (Basadas en Excel)

#### HED (Hora Extra Diurna)

```
SI es domingo O festivo → HED = 0
SI NO:
  SI total_horas > 10 → HED = total_horas - 10 - HEN
  SI NO → HED = 0
```

#### HEN (Hora Extra Nocturna)

```
SI es domingo O festivo → HEN = 0
SI NO:
  SI total_horas > 10 Y hora_fin > 21 → HEN = hora_fin - 21
  SI NO → HEN = 0
```

#### HEFD (Hora Extra Festiva Diurna)

```
SI es domingo O festivo:
  SI total_horas > 10 → HEFD = total_horas - 10 - HEFN
  SI NO → HEFD = 0
SI NO → HEFD = 0
```

#### HEFN (Hora Extra Festiva Nocturna)

```
SI es domingo O festivo:
  SI total_horas > 10 Y hora_fin > 21 → HEFN = hora_fin - 21
  SI NO → HEFN = 0
SI NO → HEFN = 0
```

#### RN (Recargo Nocturno)

```
recargo = 0

SI hora_inicio < 6:
  recargo += 6 - hora_inicio

SI hora_fin > 21:
  SI hora_inicio > 21:
    recargo += hora_fin - hora_inicio
  SI NO:
    recargo += hora_fin - 21

RN = recargo
```

#### RD (Recargo Dominical/Festivo)

```
SI es domingo O festivo:
  SI total_horas <= 10 → RD = total_horas
  SI total_horas > 10 → RD = 10
SI NO → RD = 0
```

## 🎨 Diseño Visual

### Colores de Estado

```typescript
const estadoColores = {
	pendiente: {
		bg: 'bg-amber-50',
		border: 'border-amber-200',
		text: 'text-amber-800',
		badge: 'bg-amber-500'
	},
	liquidada: {
		bg: 'bg-orange-50',
		border: 'border-orange-200',
		text: 'text-orange-800',
		badge: 'bg-orange-500'
	},
	facturada: {
		bg: 'bg-blue-50',
		border: 'border-blue-200',
		text: 'text-blue-800',
		badge: 'bg-blue-500'
	}
};
```

### Estilos de Tabla Canvas

- Header sticky con `position: sticky; top: 0; z-index: 10`
- Columnas fijas con `position: sticky; left: 0`
- Scroll horizontal suave
- Bordes sutiles entre celdas
- Hover row completo
- Selección con checkbox visual
- Domingos con `bg-red-50`
- Festivos con `bg-purple-50`

## 🔌 Integración con Backend

### Endpoints Usados

```
GET    /api/recargos                    - Obtener recargos canvas
GET    /api/recargos/:id                - Obtener recargo por ID
POST   /api/recargos                    - Crear recargo (FormData)
PUT    /api/recargos/:id                - Actualizar recargo
DELETE /api/recargos/:id                - Eliminar recargo
POST   /api/recargos/:id/liquidar       - Liquidar recargo
POST   /api/recargos/:id/duplicar       - Duplicar recargo
GET    /api/recargos/:id/historial      - Historial de cambios
GET    /api/recargos/stats/resumen      - Estadísticas
GET    /api/tipos-recargo               - Tipos de recargo activos
```

## 🔐 Permisos por Rol

### Rol: kilometraje

- ✅ Ver recargos
- ✅ Ver detalles
- ❌ Crear nuevos
- ✅ Editar campo kilometraje SOLO
- ❌ Eliminar
- ❌ Liquidar

### Rol: consulta

- ✅ Ver recargos
- ✅ Ver detalles
- ❌ Crear
- ❌ Editar
- ❌ Eliminar
- ❌ Liquidar

### Rol: admin/operador

- ✅ Todas las acciones

## 📝 Checklist de Implementación

- [x] Tipos TypeScript definidos
- [x] API client creado
- [x] Store de Svelte configurado
- [ ] Página principal canvas
- [ ] Modal crear/editar
- [ ] Modal visualizar
- [ ] Componente tabla canvas
- [ ] Componente filtros
- [ ] Navegación mes/año
- [ ] Utilidades de cálculo
- [ ] Helpers de formato
- [ ] Validaciones de formulario
- [ ] Manejo de permisos por rol
- [ ] Testing de cálculos
- [ ] Responsive design
- [ ] Socket.io updates (opcional)

## 🚀 Próximos Pasos

1. **Crear página principal** con estructura básica
2. **Implementar tabla canvas** con scroll horizontal
3. **Agregar modal de creación** con formulario completo
4. **Implementar cálculos** según fórmulas backend
5. **Agregar filtros** y búsqueda
6. **Integrar permisos** por rol
7. **Testing exhaustivo** de todos los casos edge
8. **Optimización** de performance

## 💡 Notas Importantes

- **Horas decimales**: 6.5 = 6:30, 21.75 = 21:45
- **Jornada normal**: 10 horas (no 8)
- **Cruce de medianoche**: Si hora_fin < hora_inicio, sumar 24
- **Festivos**: Array de números [1, 25, ...] días del mes
- **Domingos**: Calcular dinámicamente con `getDay() === 0`
- **Validación backend**: El cálculo real se hace en backend, frontend solo muestra
- **Versionamiento**: Cada cambio crea historial automático

---

**Autor**: Sistema de Gestión Cotransmeq
**Fecha**: 19 de enero de 2026

# Módulo de Servicios - Cotransmeq

## 🎨 Características

- ✅ **Diseño Glassmorphism** con gradientes orange
- ✅ **Transiciones Apple-style** suaves y elegantes
- ✅ **Actualización en tiempo real** vía Socket.IO
- ✅ **Mapa interactivo** con Mapbox GL
- ✅ **Tracking en tiempo real** de vehículos
- ✅ **Componentes reutilizables** y modulares
- ✅ **TypeScript** completo con tipos seguros
- ✅ **Responsive design** para móviles y desktop

## 📁 Estructura del Módulo

```
src/
├── lib/
│   ├── types/
│   │   └── servicios.ts              # Interfaces y tipos
│   ├── stores/
│   │   └── servicios.ts              # Store con CRUD y Socket.IO
│   └── components/
│       └── servicios/
│           ├── ServicioCard.svelte   # Tarjeta de servicio
│           ├── FiltrosDrawer.svelte  # Panel de filtros
│           └── ModalServicio.svelte  # Modal crear/editar
└── routes/
    └── dashboard/
        └── servicios/
            ├── +page.svelte          # Lista de servicios
            └── [id]/
                └── +page.svelte      # Detalle con mapa
```

## ⚙️ Configuración

### 1. Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto con el siguiente contenido:

```bash
# Mapbox (requerido para los mapas)
# Obtén tu token en: https://www.mapbox.com/
VITE_MAPBOX_ACCESS_TOKEN=tu_token_aqui

# API Backend
VITE_API_URL=http://localhost:3000/api
VITE_SOCKET_URL=http://localhost:3000
```

### 2. Instalar Dependencias

El proyecto ya tiene instaladas las dependencias necesarias:

- `mapbox-gl`: Para los mapas interactivos
- `socket.io-client`: Para actualizaciones en tiempo real

Si necesitas reinstalar:

```bash
npm install
```

### 3. Configurar el Backend

Asegúrate de que tu backend exponga los siguientes endpoints:

**Servicios:**

- `GET /api/servicios` - Listar servicios
- `GET /api/servicios/:id` - Obtener un servicio
- `POST /api/servicios` - Crear servicio
- `PUT /api/servicios/:id` - Actualizar servicio
- `PATCH /api/servicios/:id/estado` - Actualizar estado

**Catálogos:**

- `GET /api/municipios` - Listar municipios
- `GET /api/conductores` - Listar conductores
- `GET /api/vehiculos` - Listar vehículos
- `GET /api/clientes` - Listar clientes

**Socket.IO Events:**

- `servicio:creado` - Nuevo servicio
- `servicio:actualizado` - Servicio modificado
- `servicio:estado-actualizado` - Estado cambiado
- `vehiculo:posicion-actualizada` - Tracking en tiempo real

## 🚀 Uso

### Iniciar el Desarrollo

```bash
npm run dev
```

Luego navega a: `http://localhost:5173/dashboard/servicios`

### Build para Producción

```bash
npm run build
npm run preview
```

## 📊 Características del Store

El store `serviciosStore` proporciona:

```typescript
// Obtener servicios con filtros
await serviciosStore.obtenerServicios({
	estado: 'en_curso',
	page: 1,
	limit: 20
});

// Crear un servicio
await serviciosStore.crearServicio({
	cliente_id: 'uuid',
	origen_id: 'uuid',
	destino_id: 'uuid',
	valor: 50000,
	proposito_servicio: 'ocasional'
});

// Actualizar estado
await serviciosStore.actualizarEstado(servicioId, 'en_curso');

// Configurar Socket.IO para updates en tiempo real
serviciosStore.configurarSocket(socket);
```

## 🗺️ Mapbox

### Funcionalidades del Mapa

1. **Marcadores personalizados** para origen y destino
2. **Ruta optimizada** usando Mapbox Directions API
3. **Popups informativos** al hacer clic
4. **Controles de navegación** (zoom, rotación)
5. **Diseño responsive** que se adapta al contenedor

### Personalización

Para cambiar el estilo del mapa, edita en `[id]/+page.svelte`:

```typescript
map = new mapboxgl.Map({
	container: mapContainer,
	style: 'mapbox://styles/mapbox/outdoors-v12', // Cambiar aquí
	center: [lng, lat],
	zoom: 12
});
```

Estilos disponibles:

- `mapbox://styles/mapbox/streets-v12`
- `mapbox://styles/mapbox/outdoors-v12`
- `mapbox://styles/mapbox/light-v11`
- `mapbox://styles/mapbox/dark-v11`
- `mapbox://styles/mapbox/satellite-v9`

## 🎨 Sistema de Diseño

### Colores Principales

```css
--orange-50: #ecfdf5 --orange-400: #34d399 --orange-500: #10b981 --orange-600: #059669
	--orange-700: #047857;
```

### Clases Personalizadas

```css
.glass - Efecto glassmorphism
.soft-shadow - Sombra suave
.apple-transition - Transición estilo Apple
.orange-glow - Brillo orange
.input-glow - Brillo en inputs
```

### Animaciones

Usando transiciones de Svelte:

- `fade` - Aparición/desaparición
- `fly` - Deslizamiento
- `scale` - Escalado
- `slide` - Deslizamiento vertical

## 📱 Responsive Design

El módulo está optimizado para:

- 📱 **Móviles** (< 640px)
- 📱 **Tablets** (640px - 1024px)
- 💻 **Desktop** (> 1024px)

## 🔧 Troubleshooting

### El mapa no se muestra

1. Verifica que `VITE_MAPBOX_ACCESS_TOKEN` esté configurado
2. Revisa la consola del navegador para errores
3. Asegúrate de que las coordenadas sean válidas

### Socket.IO no conecta

1. Verifica que `VITE_SOCKET_URL` apunte al backend correcto
2. Asegúrate de que el backend tenga Socket.IO configurado
3. Revisa los logs del servidor

### Errores de TypeScript

1. Ejecuta `npm run check` para ver todos los errores
2. Asegúrate de que los tipos en `servicios.ts` coincidan con tu backend

## 📝 Próximas Mejoras

- [ ] Agregar filtros avanzados por rango de precios
- [ ] Implementar exportación a PDF/Excel
- [ ] Agregar gráficos y estadísticas
- [ ] Sistema de notificaciones push
- [ ] Modo oscuro completo
- [ ] PWA para uso offline

## 🤝 Contribuir

Para agregar nuevas funcionalidades:

1. Crea los tipos en `lib/types/servicios.ts`
2. Añade la lógica en `lib/stores/servicios.ts`
3. Crea componentes en `lib/components/servicios/`
4. Utiliza el sistema de diseño existente

## 📄 Licencia

Este módulo es parte del proyecto Cotransmeq.

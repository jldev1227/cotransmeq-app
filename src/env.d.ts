/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_MAPBOX_ACCESS_TOKEN: string;
	readonly VITE_GOOGLE_MAPS_API_KEY: string;
	readonly VITE_AWS_LOCATION_API_KEY: string;
	readonly VITE_AWS_LOCATION_PLACE_INDEX: string;
	readonly VITE_AWS_REGION: string;
	readonly VITE_AWS_ACCESS_KEY_ID: string;
	readonly VITE_AWS_SECRET_ACCESS_KEY: string;
	readonly VITE_WIALON_API_TOKEN: string;
	readonly VITE_API_URL: string;
	readonly VITE_SOCKET_URL: string;
	readonly VITE_AUTH_SYSTEM: string;
	readonly VITE_EMPRESAS_SYSTEM: string;
	readonly VITE_CONDUCTORES_SYSTEM: string;
	readonly VITE_FLOTA_SYSTEM: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

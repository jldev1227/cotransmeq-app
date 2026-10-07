import { apiClient } from './apiClient';

/** Enlace de acceso a la app móvil del usuario administrativo (ver backend `app-usuarios`). */
export interface EnlaceAppMovil {
	id: string;
	creado: string;
	vence: string;
	ultimo_uso: string | null;
	usos: number;
}

export interface EnlaceAppMovilCreado extends EnlaceAppMovil {
	/** Solo llega al generarlo: el backend guarda el hash del código, no el código. */
	url: string;
}

export async function estadoEnlaceApp(): Promise<{ habilitado: boolean; enlace: EnlaceAppMovil | null }> {
	const res = await apiClient.get('/api/app-usuarios/enlace');
	return res.data.data;
}

export async function generarEnlaceApp(): Promise<EnlaceAppMovilCreado> {
	const res = await apiClient.post('/api/app-usuarios/enlace');
	return res.data.data;
}

export async function revocarEnlaceApp(): Promise<void> {
	await apiClient.delete('/api/app-usuarios/enlace');
}

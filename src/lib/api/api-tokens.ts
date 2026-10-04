import { browser } from '$app/environment';
import { apiClient } from './apiClient';

export interface ConexionClaude {
	id: string;
	nombre: string;
	prefijo: string;
	createdAt: string;
	lastUsedAt: string | null;
}

export interface ConexionCreada extends ConexionClaude {
	/** Valor completo: el backend solo lo devuelve al crearla. */
	token: string;
}

const API_BASE = browser
	? (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000'
	: 'http://localhost:4000';

/** Endpoint MCP al que se conecta Claude. */
export const URL_MCP = `${API_BASE.replace(/\/$/, '')}/api/mcp`;

/** Nombre del servidor en `claude mcp add`. */
export const NOMBRE_MCP = 'cotransmeq';

export async function listarConexiones(): Promise<ConexionClaude[]> {
	const res = await apiClient.get('/api/api-tokens');
	return res.data;
}

export async function crearConexion(nombre: string): Promise<ConexionCreada> {
	const res = await apiClient.post('/api/api-tokens', { nombre });
	return res.data;
}

export async function revocarConexion(id: string): Promise<void> {
	await apiClient.delete(`/api/api-tokens/${id}`);
}

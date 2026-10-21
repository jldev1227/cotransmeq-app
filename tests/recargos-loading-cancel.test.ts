import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CanceledError,
	type AxiosAdapter,
	type AxiosResponse,
	type InternalAxiosRequestConfig
} from 'axios';
import { get } from 'svelte/store';
import { apiClient } from '$lib/api/apiClient';
import { recargosStore } from '$lib/stores/recargos';

vi.mock('svelte-sonner', () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn()
	}
}));

type PeticionPendiente = {
	config: InternalAxiosRequestConfig;
	resolver: (response: AxiosResponse) => void;
};

const peticiones: PeticionPendiente[] = [];
const adaptadorOriginal = apiClient.defaults.adapter;

const adaptadorDiferido: AxiosAdapter = (config) =>
	new Promise((resolve, reject) => {
		peticiones.push({
			config,
			resolver: (response) => resolve(response)
		});

		const cancelar = () => reject(new CanceledError('Petición cancelada', config));
		if (config.signal?.aborted) cancelar();
		else config.signal?.addEventListener?.('abort', cancelar, { once: true });
	});

function responder(peticion: PeticionPendiente) {
	peticion.resolver({
		data: {
			data: [],
			pagination: { page: 1, limit: 200, total: 0, totalPages: 0 },
			meta: { total_valor_pagar: 0 }
		},
		status: 200,
		statusText: 'OK',
		headers: {},
		config: peticion.config
	});
}

describe('carga de recargos con solicitudes cancelables', () => {
	beforeEach(() => {
		peticiones.length = 0;
		recargosStore.reset();
		apiClient.defaults.adapter = adaptadorDiferido;
	});

	afterEach(() => {
		recargosStore.reset();
		apiClient.defaults.adapter = adaptadorOriginal;
	});

	it('una recarga nueva no hereda la promesa cancelada de la anterior', async () => {
		const recargaAnterior = recargosStore.fetchRecargos();
		await vi.waitFor(() => expect(peticiones).toHaveLength(1));

		const recargaVigente = recargosStore.fetchRecargos();
		await vi.waitFor(() => expect(peticiones).toHaveLength(2));

		expect(peticiones[0].config.signal?.aborted).toBe(true);

		responder(peticiones[1]);
		await Promise.all([recargaAnterior, recargaVigente]);

		expect(get(recargosStore).loading).toBe(false);
		expect(get(recargosStore).error).toBeNull();
	});
});

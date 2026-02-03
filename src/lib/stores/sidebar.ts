import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const SIDEBAR_STORAGE_KEY = 'transmeralda_sidebar_collapsed';

// Función para cargar el estado inicial desde localStorage
function loadInitialState(): boolean {
	if (browser) {
		const savedState = localStorage.getItem(SIDEBAR_STORAGE_KEY);
		if (savedState !== null) {
			return savedState === 'true';
		}
	}
	return false; // Por defecto expandido
}

// Crear el store con el estado inicial
function createSidebarStore() {
	const { subscribe, set, update } = writable<boolean>(loadInitialState());

	return {
		subscribe,
		toggle: () => {
			update((collapsed) => {
				const newState = !collapsed;
				// Guardar en localStorage
				if (browser) {
					localStorage.setItem(SIDEBAR_STORAGE_KEY, String(newState));
				}
				return newState;
			});
		},
		set: (value: boolean) => {
			// Guardar en localStorage
			if (browser) {
				localStorage.setItem(SIDEBAR_STORAGE_KEY, String(value));
			}
			set(value);
		},
		collapse: () => {
			if (browser) {
				localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
			}
			set(true);
		},
		expand: () => {
			if (browser) {
				localStorage.setItem(SIDEBAR_STORAGE_KEY, 'false');
			}
			set(false);
		}
	};
}

export const sidebarStore = createSidebarStore();

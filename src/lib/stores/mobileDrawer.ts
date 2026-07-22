import { writable } from 'svelte/store';

function createMobileDrawerStore() {
	const { subscribe, set, update } = writable<boolean>(false);

	return {
		subscribe,
		open: () => set(true),
		close: () => set(false),
		toggle: () => update((v) => !v)
	};
}

export const mobileDrawerStore = createMobileDrawerStore();

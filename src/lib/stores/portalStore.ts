import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'transmeralda_portal_token';

export interface PortalSession {
  token: string;
  conductor: {
    id: string;
    nombre: string;
    apellido: string;
    numero_identificacion: string;
    email?: string;
  };
  expiresAt: string; // ISO date
}

function createPortalStore() {
  // Restore from localStorage
  let initial: PortalSession | null = null;
  if (browser) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PortalSession;
        if (new Date(parsed.expiresAt) > new Date()) {
          initial = parsed;
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const { subscribe, set, update } = writable<PortalSession | null>(initial);

  return {
    subscribe,
    login(session: PortalSession) {
      if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      set(session);
    },
    logout() {
      if (browser) localStorage.removeItem(STORAGE_KEY);
      set(null);
    },
    set,
    update
  };
}

export const portalSession = createPortalStore();

export const isAuthenticated = derived(portalSession, ($s) => !!$s);

export const conductorNombre = derived(portalSession, ($s) =>
  $s ? `${$s.conductor.nombre} ${$s.conductor.apellido}` : ''
);

export const conductorCedula = derived(portalSession, ($s) =>
  $s ? $s.conductor.numero_identificacion : ''
);

export const diasRestantes = derived(portalSession, ($s) => {
  if (!$s) return 0;
  return Math.max(0, Math.ceil((new Date($s.expiresAt).getTime() - Date.now()) / 86400000));
});

/** Helper para obtener API base URL */
export function getApiBase(): string {
  if (!browser) return '';
  const API = (import.meta.env.VITE_API_URL as string) || '';
  return API.endsWith('/') ? API.slice(0, -1) : API;
}

/** Helper para hacer fetch autenticado */
export async function portalFetch(path: string, options: RequestInit = {}) {
  const session = get(portalSession);
  const token = session?.token || '';
  
  const base = getApiBase();
  const res = await fetch(`${base}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const json = await res.json();
  if (!res.ok) throw { status: res.status, ...json };
  return json;
}

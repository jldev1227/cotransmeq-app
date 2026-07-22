/**
 * Concatena clases condicionales sin dependencias externas.
 * Uso: cn('base', condition && 'extra', { 'active': isActive })
 */
export type ClassValue =
	| string
	| number
	| null
	| undefined
	| false
	| Record<string, boolean | null | undefined>
	| ClassValue[];

export function cn(...inputs: ClassValue[]): string {
	const out: string[] = [];

	for (const input of inputs) {
		if (!input) continue;
		if (typeof input === 'string' || typeof input === 'number') {
			out.push(String(input));
		} else if (Array.isArray(input)) {
			const inner = cn(...input);
			if (inner) out.push(inner);
		} else if (typeof input === 'object') {
			for (const key of Object.keys(input)) {
				if (input[key]) out.push(key);
			}
		}
	}

	return out.join(' ');
}

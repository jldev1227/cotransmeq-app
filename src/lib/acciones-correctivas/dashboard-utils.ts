export function formatDate(dateStr: string): string {
	if (!dateStr || dateStr === 'undefined' || dateStr === 'null') return '';
	const [y, m, d] = dateStr.split('-');
	if (!y || !m || !d) return '';
	return `${d}/${y.slice(2)}`;
}

export function isUrgent(dateStr: string): boolean {
	const d = new Date(dateStr);
	const now = new Date();
	return d < now || d.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000;
}

export function getInitials(name: string): string {
	return name
		.split(' ')
		.slice(0, 2)
		.map((n) => n[0])
		.join('')
		.toUpperCase();
}

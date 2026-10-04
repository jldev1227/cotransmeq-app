/**
 * Markdown mínimo para las respuestas del asistente: párrafos, negrita,
 * código en línea, listas, tablas y enlaces. Todo el texto se escapa antes de
 * dar formato, y solo se generan enlaces a rutas internas (que empiezan por
 * "/"): el contenido viene de un LLM y no debe poder inyectar HTML ni mandar al
 * usuario a otro sitio.
 */

function escapar(t: string): string {
	return t
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Sin cursiva con `*`: los campos obligatorios de los formularios llevan
 * asterisco ("Cliente *") y se convertían en cursivas que se comían el texto.
 */
function enLinea(t: string): string {
	return escapar(t)
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, texto: string, url: string) => {
			// La URL ya está escapada; solo rutas internas y sin "//" (protocol-relative).
			if (!url.startsWith('/') || url.startsWith('//')) return texto;
			return `<a href="${url}" data-interno>${texto}</a>`;
		})
		// Rutas internas sueltas («/dashboard/servicios/…»): el modelo a veces las
		// escribe sin formato markdown aunque el prompt se lo pida. Se vuelven
		// enlace igual; la que ya está dentro de un <a> no se toca.
		.replace(/(^|[\s(])(\/dashboard\/[^\s)<]*[^\s)<.,;:])/g, (_m, antes: string, ruta: string) => {
			return `${antes}<a href="${ruta}" data-interno>${ruta}</a>`;
		});
}

const ES_FILA_TABLA = /^\s*\|.*\|\s*$/;
const ES_SEPARADOR_TABLA = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function celdas(linea: string): string[] {
	return linea
		.trim()
		.replace(/^\||\|$/g, '')
		.split('|')
		.map((c) => c.trim());
}

export function markdownAHtml(md: string): string {
	const lineas = md.replace(/\r\n/g, '\n').split('\n');
	const salida: string[] = [];
	let i = 0;

	while (i < lineas.length) {
		const linea = lineas[i];

		if (!linea.trim()) {
			i++;
			continue;
		}

		// Tabla: fila de encabezado + separador + filas.
		if (ES_FILA_TABLA.test(linea) && ES_SEPARADOR_TABLA.test(lineas[i + 1] ?? '')) {
			const cabecera = celdas(linea);
			i += 2;
			const filas: string[][] = [];
			while (i < lineas.length && ES_FILA_TABLA.test(lineas[i])) {
				filas.push(celdas(lineas[i]));
				i++;
			}
			salida.push(
				`<table><thead><tr>${cabecera.map((c) => `<th>${enLinea(c)}</th>`).join('')}</tr></thead><tbody>${filas
					.map((f) => `<tr>${f.map((c) => `<td>${enLinea(c)}</td>`).join('')}</tr>`)
					.join('')}</tbody></table>`
			);
			continue;
		}

		const lista = /^\s*([-*]|\d+[.)])\s+/;
		if (lista.test(linea)) {
			const ordenada = /^\s*\d/.test(linea);
			const items: string[] = [];
			while (i < lineas.length && lista.test(lineas[i])) {
				items.push(`<li>${enLinea(lineas[i].replace(lista, ''))}</li>`);
				i++;
			}
			const tag = ordenada ? 'ol' : 'ul';
			salida.push(`<${tag}>${items.join('')}</${tag}>`);
			continue;
		}

		const titulo = /^#{1,6}\s+(.*)$/.exec(linea);
		if (titulo) {
			salida.push(`<h4>${enLinea(titulo[1])}</h4>`);
			i++;
			continue;
		}

		const parrafo: string[] = [];
		while (
			i < lineas.length &&
			lineas[i].trim() &&
			!lista.test(lineas[i]) &&
			!/^#{1,6}\s/.test(lineas[i]) &&
			!ES_FILA_TABLA.test(lineas[i])
		) {
			parrafo.push(enLinea(lineas[i]));
			i++;
		}
		salida.push(`<p>${parrafo.join('<br>')}</p>`);
	}

	return salida.join('');
}

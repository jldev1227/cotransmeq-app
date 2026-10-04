import { describe, expect, it } from 'vitest';
import { markdownAHtml } from '$lib/utils/markdown-asistente';

describe('markdownAHtml', () => {
	it('escapa HTML del modelo antes de dar formato', () => {
		expect(markdownAHtml('Hola <script>alert(1)</script>')).toBe(
			'<p>Hola &lt;script&gt;alert(1)&lt;/script&gt;</p>'
		);
	});

	it('solo genera enlaces a rutas internas', () => {
		expect(markdownAHtml('[Servicios](/dashboard/servicios)')).toBe(
			'<p><a href="/dashboard/servicios" data-interno>Servicios</a></p>'
		);
		expect(markdownAHtml('[malo](https://evil.test)')).toBe('<p>malo</p>');
		expect(markdownAHtml('[malo](//evil.test)')).toBe('<p>malo</p>');
	});

	it('vuelve enlace una ruta interna suelta sin tocar las que ya lo son', () => {
		expect(markdownAHtml('Ver (/dashboard/flota?placa=ABC123).')).toBe(
			'<p>Ver (<a href="/dashboard/flota?placa=ABC123" data-interno>/dashboard/flota?placa=ABC123</a>).</p>'
		);
		expect(markdownAHtml('[Flota](/dashboard/flota)')).toBe(
			'<p><a href="/dashboard/flota" data-interno>Flota</a></p>'
		);
	});

	it('convierte negrita y código, pero no cursiva con asterisco', () => {
		expect(markdownAHtml('Campo **Cliente** * y `placa` *obligatorio*')).toBe(
			'<p>Campo <strong>Cliente</strong> * y <code>placa</code> *obligatorio*</p>'
		);
	});

	it('arma listas y tablas', () => {
		expect(markdownAHtml('- uno\n- dos')).toBe('<ul><li>uno</li><li>dos</li></ul>');
		expect(markdownAHtml('1. uno\n2. dos')).toBe('<ol><li>uno</li><li>dos</li></ol>');
		expect(markdownAHtml('| Placa | Estado |\n|---|---|\n| ABC123 | disponible |')).toBe(
			'<table><thead><tr><th>Placa</th><th>Estado</th></tr></thead><tbody><tr><td>ABC123</td><td>disponible</td></tr></tbody></table>'
		);
	});

	it('separa párrafos y títulos', () => {
		expect(markdownAHtml('# Resumen\n\nlínea 1\nlínea 2')).toBe(
			'<h4>Resumen</h4><p>línea 1<br>línea 2</p>'
		);
	});
});

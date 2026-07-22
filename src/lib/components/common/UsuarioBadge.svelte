<script lang="ts">
	export let nombre: string;
	export let correo: string = '';
	export let size: 'sm' | 'md' = 'sm';

	$: initials = nombre
		.split(' ')
		.map((n) => n[0])
		.slice(0, 2)
		.join('')
		.toUpperCase();

	$: colors = [
		'bg-orange-100 text-orange-700',
		'bg-blue-100 text-blue-700',
		'bg-violet-100 text-violet-700',
		'bg-amber-100 text-amber-700',
		'bg-rose-100 text-rose-700',
		'bg-teal-100 text-teal-700',
	];
	$: colorIdx = nombre.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
	$: avatarBg = colors[colorIdx];
</script>

<span class="inline-flex items-center gap-1.5">
	<span
		class="inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold {avatarBg}"
		class:h-6={size === 'md'}
		class:w-6={size === 'md'}
		class:text-[10px]={size === 'md'}
		title={correo || nombre}
	>
		{initials}
	</span>
	<span class="text-xs text-gray-700 truncate max-w-[100px]">{nombre}</span>
</span>

<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '$lib/application/application-ui.css';
	import { onMount } from 'svelte';
	import { startTheme } from '$lib/application/theme';
  import {restoreLanguage,locale} from '$lib/i18n/language';

	let { children } = $props();
	let viewportHeight = $state<string | undefined>();
	onMount(() => {
		const stopTheme = startTheme();
    try{restoreLanguage(localStorage);}catch{restoreLanguage();}
    const stopLanguage=locale.subscribe(value=>document.documentElement.lang=value);
		const viewport = window.visualViewport;
		const resize = () => {
			// Do not resize the layout while the user is deliberately pinch-zooming.
			viewportHeight = viewport && Math.abs(viewport.scale - 1) < 0.01 ? `${viewport.height}px` : undefined;
		};
		resize();
		viewport?.addEventListener('resize', resize);
		window.addEventListener('resize', resize);
		return () => { stopTheme(); stopLanguage(); viewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); };
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<main class="app-viewport" style:--app-height={viewportHeight}>
	{@render children()}
</main>

<style>
	:global(html) { width:100%; height:100%; overscroll-behavior:none; -webkit-text-size-adjust:100%; text-size-adjust:100%; }
	:global(body) { margin:0; width:100%; height:100%; overflow:hidden; }
	:global(*), :global(*::before), :global(*::after) { box-sizing:border-box; }
	.app-viewport { height:var(--app-height, 100vh); height:var(--app-height, 100dvh); width:100%; min-width:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior:none; padding:max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); }
	@media(max-width:700px) { .app-viewport { padding:max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); } }
	:global(input), :global(textarea), :global(select) { max-width:100%; min-width:0; }
	:global(img), :global(video), :global(canvas), :global(audio) { max-width:100%; }
	:global(dialog) { max-width:calc(100vw - 24px); max-height:calc(var(--app-height, 100dvh) - 24px); overflow:auto; overscroll-behavior:contain; }
	:global(pre), :global(code) { overflow-wrap:anywhere; }
	@media (pointer:coarse) {
		/* Safari zooms editable controls with small fonts. Keep pinch zoom enabled. */
		:global(input:not([type='checkbox']):not([type='radio'])), :global(textarea), :global(select) { font-size:16px; }
		:global(button) { touch-action:manipulation; }
	}
</style>

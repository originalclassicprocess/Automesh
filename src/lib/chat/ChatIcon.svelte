<script lang="ts">
  let { name }: { name: 'copy' | 'qr' | 'phone' | 'hangup' | 'mic-off' | 'shield' | 'microphone' | 'network' | 'send' | 'select' | 'forward' | 'download' | 'share' | 'reply' | 'chat' | 'info' | 'play' | 'stop' | 'previous' | 'next' | 'queue' | 'repeat' | 'repeat-one' | 'order-up' | 'order-down' | 'shuffle' | 'volume' | 'muted' | 'trash' | 'node' | 'close' | 'emoji' | 'attachment' | 'search' | 'radio' } = $props();
</script>
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  {#if name === 'copy'}
    <rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" />
  {:else if name === 'qr'}
    <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM21 12v3M12 3v3M12 12h3M12 18v3" />
  {:else if name === 'attachment'}
    <path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10M6 15l8-8" />
  {:else if name === 'emoji'}
    <circle cx="12" cy="12" r="9" /><path d="M8 14a4 4 0 0 0 8 0M8 9h.01M16 9h.01" />
  {:else if name === 'search'}
    <circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" />
  {:else if name === 'phone'}
    <path d="M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2C10 21 3 14 3 5a2 2 0 0 1 2-2Z" />
  {:else if name === 'hangup'}
    <path d="M3 15v-4c5-5 13-5 18 0v4h-5v-4a12 12 0 0 0-8 0v4H3Z" />
  {:else if name === 'shield'}
    <path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6l8-3Z" /><path d="m8 12 3 3 5-6" />
  {:else if name === 'mic-off'}
    <path d="M9 5V4a3 3 0 0 1 6 0v7M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3m-4 0h8M3 3l18 18" />
  {:else if name === 'microphone'}
    <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
  {:else if name === 'radio'}
    <path d="M8 20h8M10 20l2-10 2 10M7 14a7 7 0 0 1 0-10m10 10a7 7 0 0 0 0-10M4 17a11 11 0 0 1 0-16m16 16a11 11 0 0 0 0-16" /><circle cx="12" cy="8" r="1.7" />
  {:else if name === 'network'}
    <path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0" /><circle cx="12" cy="20" r=".7" fill="currentColor" />
  {:else if name === 'send'}
    <path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3" />
  {:else if name === 'select'}
    <rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 3 3 5-6" />
  {:else if name === 'forward'}
    <path d="m14 4 7 7-7 7V13C7 13 4 16 3 20V15C3 9 7 7 14 7V4Z" />
  {:else if name === 'download'}
    <path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" />
  {:else if name === 'share'}
    <path d="M12 16V3m-5 5 5-5 5 5M5 12v9h14v-9" />
  {:else if name === 'reply'}
    <path d="m9 4-6 6 6 6M3 10h10a8 8 0 0 1 8 8v2" />
  {:else if name === 'chat'}
    <path d="M5 3h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9l-6 3V5a2 2 0 0 1 2-2ZM7 8h10M7 12h7" />
  {:else if name === 'info'}
    <circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7" r=".8" fill="currentColor" />
  {:else if name === 'play'}
    <path d="m8 4 12 8-12 8V4Z" fill="currentColor" stroke="none" />
  {:else if name === 'stop'}
    <rect x="5" y="5" width="14" height="14" rx="1" fill="currentColor" stroke="none" />
  {:else if name === 'previous'}
    <path d="M5 5v14m14-14L7 12l12 7V5Z" />
  {:else if name === 'next'}
    <path d="M19 5v14M5 5l12 7-12 7V5Z" />
  {:else if name === 'queue'}
    <path d="M4 5h16M4 10h16M4 15h8m3-1 6 4-6 4v-8Z" />
  {:else if name === 'repeat' || name === 'repeat-one'}
    <path d="M20 10a8 8 0 0 0-14-4L3 9m0-5v5h5M4 14a8 8 0 0 0 14 4l3-3m0 5v-5h-5" />
    {#if name === 'repeat-one'}<path d="m10 10 2-1v6m-2 0h4" />{/if}
  {:else if name === 'order-down'}
    <path d="M12 4v16m-6-6 6 6 6-6" />
  {:else if name === 'order-up'}
    <path d="M12 20V4m-6 6 6-6 6 6" />
  {:else if name === 'shuffle'}
    <path d="M3 6h2c6 0 8 12 14 12h2m-4-4 4 4-4 4M3 18h2c2 0 4-2 5-4m4-4c2-3 3-4 5-4h2m-4-4 4 4-4 4" />
  {:else if name === 'volume' || name === 'muted'}
    <path d="M3 9h4l5-4v14l-5-4H3V9Z" />
    {#if name === 'muted'}<path d="m16 9 6 6m0-6-6 6" />{:else}<path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />{/if}
  {:else if name === 'trash'}
    <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
  {:else if name === 'node'}
    <rect x="4" y="3" width="16" height="7" rx="2" /><rect x="4" y="14" width="16" height="7" rx="2" /><path d="M8 6.5h.01M8 17.5h.01M12 10v4" />
  {:else}
    <path d="m6 6 12 12M6 18 18 6" />
  {/if}
</svg>

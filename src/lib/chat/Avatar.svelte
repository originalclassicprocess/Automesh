<script lang="ts">
  import { identiconFor } from '$lib/addressing/identicon';
  let { accountId, photo = '', size = 32, alt = '' }: { accountId: string; photo?: string; size?: number; alt?: string } = $props();
  let failed = $state('');
  let source = $derived(photo && failed !== photo ? photo : '');
</script>
<img src={source || identiconFor(accountId)} {alt} width={size} height={size} class:photo={!!source}
  onerror={() => { failed = photo; }} />
<style>
  img { flex-shrink:0; vertical-align:middle; image-rendering:pixelated; }
  img.photo { border-radius:24%; object-fit:cover; image-rendering:auto; }
</style>

<script lang="ts">
  import {page} from '$app/state';
  import InterfacePreview from '$lib/application/InterfacePreview.svelte';
</script>
<InterfacePreview standalone={!page.url.searchParams.has('layout')} />

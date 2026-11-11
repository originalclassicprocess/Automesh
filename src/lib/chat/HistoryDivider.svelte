<script lang="ts">
 import {tr as i18n,locale} from '$lib/i18n/language';
 let {timestamp,unread=false}:{timestamp?:number;unread?:boolean}=$props();
</script>
<div class="divider" role="separator"><span>{unread?$i18n.text('Непрочитанные сообщения'):new Date(timestamp!).toLocaleDateString($locale,{day:'numeric',month:'long',year:'numeric'})}</span></div>
<style>.divider{display:flex;align-items:center;gap:10px;margin:12px 0;font-size:11px;color:var(--muted);clear:both}.divider::before,.divider::after{content:'';height:1px;background:var(--line);flex:1}.divider span{flex-shrink:0}</style>

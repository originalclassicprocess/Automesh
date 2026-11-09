<script lang="ts">
  let {label,count,tone='neutral',active=false,controls,onToggle}:
    {label:string;count:number;tone?:'neutral'|'success'|'warning'|'danger';active?:boolean;controls?:string;onToggle():void}=$props();
</script>
<button type="button" class="category" class:active class:empty={!count} aria-expanded={active} aria-controls={controls} onclick={onToggle}>
  <span class="dot" class:success={count>0&&tone==='success'} class:warning={count>0&&tone==='warning'} class:danger={count>0&&tone==='danger'} aria-hidden="true"></span>
  {label}<strong>{count}</strong>
</button>
<style>
  .category{display:flex;align-items:center;gap:7px;min-height:38px;padding:8px 10px;border:1px solid var(--line);border-radius:16px;background:var(--surface-alt);font-size:13px;color:var(--text);cursor:pointer}
  .category strong{font-variant-numeric:tabular-nums}.category.empty{color:var(--muted)}.category.active{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
  .dot{flex:0 0 7px;width:7px;height:7px;border-radius:50%;background:var(--line-strong)}.dot.success{background:var(--success)}.dot.danger{background:var(--danger)}.dot.warning{background:var(--warning)}
</style>

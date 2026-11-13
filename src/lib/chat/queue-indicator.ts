export type QueueIndicatorState={kind:'quota'|'expired'|'retrying'|'stopped'|'errors'|'canceling'|'stored'|'transmitting'|'empty'|'unknown';count:number;tone:'danger'|'warning'|'success'|'muted';label:string};
export const queueCount=(state:QueueIndicatorState,compact=false)=>state.kind==='unknown'?'?':compact&&state.count>99?'99+':String(state.count);
export function queueIndicatorStates({stopped,expired=0,retrying=0,errors,canceling,stored,transmitting,quota,unknown=false}:{stopped:number;expired?:number;retrying?:number;errors:number;canceling:number;stored:number;transmitting:number;quota?:{count:number;label:string};unknown?:boolean}):QueueIndicatorState[]{
  const values:QueueIndicatorState[]=[{kind:'expired',count:expired,tone:'danger',label:'Нода удалила по сроку'},
    {kind:'errors',count:errors,tone:'danger',label:'Отправки требуют действия'},
    {kind:'canceling',count:canceling,tone:'warning',label:'Ждём подтверждения отмены'},
    {kind:'transmitting',count:transmitting,tone:'warning',label:'Загружаем на ноду'},
    {kind:'retrying',count:retrying,tone:'warning',label:'Ожидают автоматического повтора'},
    {kind:'stored',count:stored,tone:'success',label:'Сохранено на ноде, ожидает получения'},
    {kind:'stopped',count:stopped,tone:'muted',label:'Отменено вами'}];
  if(quota)values.unshift({kind:'quota',count:quota.count,tone:'danger',label:quota.label});
  if(unknown)values.splice(quota?6:5,0,{kind:'unknown',count:0,tone:'muted',label:'Очередь ноды не проверена'});
  const active=values.filter(v=>v.kind==='unknown'||Number.isFinite(v.count)&&v.count>0);
  return active.length?active:[{kind:'empty',count:0,tone:'muted',label:'Очередь пуста'}];
}

// Forwarding follows conversations, never contact insertion or transport-control traffic.
export function forwardActivity(messages: readonly {timestamp:number;details?:{edit?:unknown;reaction?:unknown;pin?:unknown}}[]):number {
  for(let i=messages.length-1;i>=0;i--){
    const message=messages[i];
    if(!message.details?.edit&&!message.details?.reaction&&!message.details?.pin)return message.timestamp;
  }
  return 0;
}
export function recentForwardTargets<T extends {activity:number}>(targets:readonly T[]):T[]{
  return [...targets].sort((a,b)=>b.activity-a.activity);
}

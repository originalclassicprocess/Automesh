// Firmware/Bluetooth names are display data only, including emoji. Never use a
// human name for selecting a board: the node number/device permission identifies it.
export function radioBoardName(value: unknown): string {
  let name='';
  for(const point of (typeof value==='string'?value:'').replace(/[\u0000-\u001f\u007f]/g,'').trim()) {
    if(name.length+point.length>32)break;
    name+=point;
  }
  return name;
}
export function automaticBoardName(name:string|undefined,shortName:string|undefined,deviceName:string|undefined,node:number):string {
  return radioBoardName(name)||radioBoardName(shortName)||radioBoardName(deviceName)||`Meshtastic !${node.toString(16).padStart(8,'0')}`;
}

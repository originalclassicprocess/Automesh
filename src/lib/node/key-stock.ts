import type {KeySource} from './courier-crypto';
export type RemoteKeyStock=KeySource & {status:'ready'|'empty'|'unavailable';available?:number;checkedAt:number};
export function currentKeyStock(source:KeySource|undefined,stock:RemoteKeyStock|undefined,now:number):RemoteKeyStock|undefined {
  if(!source||!stock||source.url!==stock.url||source.nodeId!==stock.nodeId||stock.checkedAt>now+5000||now-stock.checkedAt>45000)return;
  return stock;
}

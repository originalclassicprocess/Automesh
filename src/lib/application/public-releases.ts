export const appRepository = 'originalclassicprocess/Automesh';
export const nodeRepository = 'originalclassicprocess/automesh-nodes';
export const projectLinks = {
  app: `https://github.com/${appRepository}`,
  nodes: `https://github.com/${nodeRepository}`,
  history: `https://github.com/${appRepository}/blob/main/HISTORY.md`,
  issues: `https://github.com/${appRepository}/issues`,
  license: `https://github.com/${appRepository}/blob/main/LICENSE`
} as const;
export type PublicRelease = { version:string; tag:string; commit:string; url:string;
  assets:{name:string;url:string;bytes:number;sha256:string}[] };
const repositories = new Set([appRepository, nodeRepository]);
export function parsePublicRelease(repository:string, raw:unknown):PublicRelease {
  if (!repositories.has(repository) || !raw || typeof raw!=='object' || Array.isArray(raw)) throw Error('invalid_public_release');
  const value=raw as Record<string,unknown>;
  if (value.draft!==false || typeof value.tag_name!=='string' || !/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value.tag_name) ||
      typeof value.target_commitish!=='string' || !/^[a-f0-9]{40}$/.test(value.target_commitish) ||
      value.html_url!==`https://github.com/${repository}/releases/tag/${value.tag_name}` ||
      !Array.isArray(value.assets) || value.assets.length>40) throw Error('invalid_public_release');
  const assets:PublicRelease['assets']=[];
  for (const entry of value.assets) {
    if (!entry || typeof entry!=='object' || Array.isArray(entry)) throw Error('invalid_public_release');
    const asset=entry as Record<string,unknown>;
    // Ignore unrelated assets, but never accept an operator-provided host/path.
    if (typeof asset.name!=='string' || !/^[A-Za-z0-9_.-]{1,140}$/.test(asset.name) ||
        asset.browser_download_url!==`https://github.com/${repository}/releases/download/${value.tag_name}/${asset.name}` ||
        !Number.isSafeInteger(asset.size) || (asset.size as number)<1 || (asset.size as number)>256*1024*1024 ||
        typeof asset.digest!=='string' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw Error('invalid_public_release');
    if (assets.some(a=>a.name===asset.name)) throw Error('invalid_public_release');
    assets.push({name:asset.name,url:asset.browser_download_url as string,bytes:asset.size as number,sha256:asset.digest.slice(7)});
  }
  return {version:value.tag_name.slice(1),tag:value.tag_name,commit:value.target_commitish,url:value.html_url as string,assets};
}
export async function fetchPublicRelease(repository:string, signal:AbortSignal, request:typeof fetch=fetch, tag?:string):Promise<PublicRelease> {
  if (!repositories.has(repository) || tag!==undefined&&!/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tag)) throw Error('invalid_public_release');
  signal.throwIfAborted();
  const path=tag ? `tags/${tag}` : 'latest';
  const response=await request(`https://api.github.com/repos/${repository}/releases/${path}`,{
    signal,cache:'no-store',redirect:'error',credentials:'omit',headers:{Accept:'application/vnd.github+json'}
  });
  if (!response.ok || !response.body) throw Error('public_release_unavailable');
  const reader=response.body.getReader(), chunks:Uint8Array[]=[];let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256*1024)throw Error('invalid_public_release');chunks.push(value);}
    signal.throwIfAborted();const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('invalid_public_release');}
    return parsePublicRelease(repository,raw);
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}

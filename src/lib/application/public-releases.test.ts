import {describe,it,expect} from 'vitest';
import {parsePublicRelease,fetchPublicRelease,appRepository} from './public-releases';
const tag='v0.5.3', asset={name:'Automesh-App-0.5.3-update.tar.gz',size:100000,digest:'sha256:'+'a'.repeat(64),
  browser_download_url:`https://github.com/${appRepository}/releases/download/${tag}/Automesh-App-0.5.3-update.tar.gz`};
const release={draft:false,tag_name:tag,target_commitish:'a'.repeat(40),html_url:`https://github.com/${appRepository}/releases/tag/${tag}`,assets:[asset]};
describe('public release trust boundary',()=>{
 it('accepts exact public commit, tag and immutable asset only',()=>{
  expect(parsePublicRelease(appRepository,release).commit).toBe('a'.repeat(40));
  for(const patch of [{draft:true},{tag_name:'latest'},{target_commitish:'main'},{html_url:'https://evil.test'},{assets:[asset,asset]},
   {assets:[{...asset,browser_download_url:asset.browser_download_url+'?token=x'}]},{assets:[{...asset,digest:''}]},{assets:[{...asset,size:1e12}]}])
   expect(()=>parsePublicRelease(appRepository,{...release,...patch})).toThrow('invalid_public_release');
  expect(()=>parsePublicRelease('evil/repo',release)).toThrow();
 });
 it('keeps version comparison explicit, unauthenticated and cancelable',async()=>{
  let requested='';const controller=new AbortController();
  const result=await fetchPublicRelease(appRepository,controller.signal,async(url,options)=>{
   requested=String(url);expect(options).toMatchObject({credentials:'omit',redirect:'error',cache:'no-store'});return Response.json(release);
  },tag);
  expect(requested).toBe(`https://api.github.com/repos/${appRepository}/releases/tags/v0.5.3`);expect(result.version).toBe('0.5.3');
  controller.abort();await expect(fetchPublicRelease(appRepository,controller.signal,async()=>Response.json(release))).rejects.toThrow();
 });
});

import{afterEach,describe,it,expect,vi}from'vitest';
import{env,AutoConfig}from'@huggingface/transformers';
import{portableModelEnvironment}from'./portable-policy';
import{DEFAULT_PORTABLE_MODEL,PORTABLE_MODELS,portableRequiredFiles}from'./portable-models';
const model=DEFAULT_PORTABLE_MODEL,original={...env};
afterEach(()=>Object.assign(env,original));
describe('pinned browser model policy against the installed SDK',()=>{
 it('loads a cached pinned config even when SDK discovery defaults to main and inference is local-only',async()=>{
  const request=vi.fn<typeof fetch>(),configUrl=portableRequiredFiles(model)[0],seen:string[]=[];
  Object.assign(env,portableModelEnvironment(model,false,request),{useBrowserCache:false,useFSCache:false,useCustomCache:true,customCache:{
   match:async(url:string)=>{seen.push(url);return url===configUrl?new Response(JSON.stringify({model_type:'llama'})):undefined;},put:async()=>{},
  }});
  const result=await AutoConfig.from_pretrained(PORTABLE_MODELS[model].repo,{local_files_only:true});
  expect(result.model_type).toBe('llama');expect(seen).toContain(configUrl);expect(request).not.toHaveBeenCalled();
 });
 it('does not fall back to a remote download when cached config is missing',async()=>{
  const request=vi.fn<typeof fetch>();
  Object.assign(env,portableModelEnvironment(model,false,request),{useBrowserCache:false,useFSCache:false,useCustomCache:true,customCache:{match:async()=>undefined,put:async()=>{}}});
  await expect(AutoConfig.from_pretrained(PORTABLE_MODELS[model].repo,{local_files_only:true})).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
 });
 it('preserves only bounded Range metadata and never forwards authorization, cookies or a body',async()=>{
  const request=vi.fn<typeof fetch>(async()=>new Response('x')),policy=portableModelEnvironment(model,true,request),url=portableRequiredFiles(model)[0];
  await policy.fetch(url,{headers:{Range:'bytes=0-0',Authorization:'test-only-key',Cookie:'test-only-cookie'},body:'test-only-prompt',method:'POST',credentials:'include'});
  const [actual,init]=request.mock.calls[0];expect(String(actual)).toBe(url);expect(init?.method).toBe('GET');expect(init?.body).toBeUndefined();expect(init?.credentials).toBe('omit');
  expect([...new Headers(init?.headers)]).toEqual([['range','bytes=0-0']]);
  for(const denied of[url.replace(PORTABLE_MODELS[model].revision,'main'),'https://other.example/file.onnx','/models/config.json'])await expect(policy.fetch(denied)).rejects.toThrow('agent_model_download_not_allowed');
  expect(request).toHaveBeenCalledTimes(1);
 });
});

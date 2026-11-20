import{PORTABLE_MODELS,modelAssetUrlAllowed,type PortableModelId}from'./portable-models';

// Some SDK discovery helpers omit revision/local_files_only. Pin the template
// itself and enforce the download boundary at the final fetch, including on misses.
export function portableModelEnvironment(model:PortableModelId,download:boolean,request:typeof fetch=fetch){
 return{
  allowLocalModels:!download,allowRemoteModels:download,
  remoteHost:'https://huggingface.co/',remotePathTemplate:`{model}/resolve/${PORTABLE_MODELS[model].revision}/`,
  fetch:async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=new URL(input instanceof Request?input.url:input.toString(),'https://invalid.local/');
   if(!download||!modelAssetUrlAllowed(model,url))throw Error('agent_model_download_not_allowed');
   const headers=new Headers(),range=new Headers(init?.headers).get('Range');
   if(range&&/^bytes=\d+-\d*$/.test(range))headers.set('Range',range);
   return request(url,{method:'GET',headers,credentials:'omit',referrerPolicy:'no-referrer',redirect:'follow',signal:init?.signal});
  },
 };
}

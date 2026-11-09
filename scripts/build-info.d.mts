export type BuildInfo = {schema:number;version:string;buildVersion:string;repository:string;commit:string|null;dirty:boolean;
  source:'github-actions'|'local';workflow:string|null;runId:string|null;website:string|null};
export const appRepository:string;
export function buildInformation(root?:string,env?:Record<string,string|undefined>):BuildInfo;
export function buildInformationPlugin():import('vite').Plugin;

declare module 'virtual:automesh-build' {
  export const buildInfo:{schema:number;version:string;buildVersion:string;repository:string;commit:string|null;dirty:boolean;
    source:'github-actions'|'local';workflow:string|null;runId:string|null;website:string|null};
}

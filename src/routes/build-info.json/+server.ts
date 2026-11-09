import { json } from '@sveltejs/kit';
import { buildInfo } from 'virtual:automesh-build';
export const GET=()=>json(buildInfo,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

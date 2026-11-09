import { writable } from 'svelte/store';
export type ThemeMode = 'system'|'light'|'dark';
export const THEME_KEY = 'automesh-ui-theme-v1';
export const themeMode = writable<ThemeMode>('system');
export const isThemeMode = (mode:unknown):mode is ThemeMode => mode === 'system'||mode === 'light'||mode === 'dark';
export function readTheme(storage:Pick<Storage,'getItem'>):ThemeMode {
  try {const value=storage.getItem(THEME_KEY);return isThemeMode(value)?value:'system';} catch {return 'system';}
}
export function saveTheme(mode:ThemeMode,storage:Pick<Storage,'setItem'>):boolean {
  if (!isThemeMode(mode)) return false;
  try {storage.setItem(THEME_KEY,mode);return true;}catch{return false;}
}
function apply(mode:ThemeMode) { document.documentElement.dataset.theme=mode;themeMode.set(mode); }
export function chooseTheme(mode:ThemeMode):boolean {
  if (!isThemeMode(mode)) return false;
  apply(mode);try{return saveTheme(mode,localStorage);}catch{return false;}
}
export function startTheme():()=>void {
  // Only a non-sensitive device-wide preference, independent of login/backups.
  try{apply(readTheme(localStorage));}catch{apply('system');}
  const changed=(event:StorageEvent)=>{
    if(event.key===THEME_KEY||event.key===null){try{apply(readTheme(localStorage));}catch{apply('system');}}
  };
  window.addEventListener('storage',changed);
  return ()=>window.removeEventListener('storage',changed);
}

import {expect,it,vi} from 'vitest';
import {readTheme,saveTheme,THEME_KEY} from './theme';
it('stores only a device-wide allowlisted preference and survives unavailable storage',()=>{
  const setItem=vi.fn();expect(saveTheme('dark',{setItem})).toBe(true);expect(setItem).toHaveBeenCalledWith(THEME_KEY,'dark');
  expect(readTheme({getItem:()=> 'dark'})).toBe('dark');
  for(const value of [null,'unknown','https://remote.test/'])expect(readTheme({getItem:()=>value})).toBe('system');
  expect(readTheme({getItem:()=>{throw Error('blocked');}})).toBe('system');
  expect(saveTheme('light',{setItem:()=>{throw Error('blocked');}})).toBe(false);
});

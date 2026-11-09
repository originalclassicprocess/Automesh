import {describe,it,expect} from 'vitest';
import {checkArchiveListing} from '../scripts/download-app-release.mjs';
describe('GitHub app release extraction boundary',()=>{
 it('accepts regular package files and directories',()=>{
  expect(()=>checkArchiveListing('./\n./app.cjs\n./build/\n./build/client/_app/version.json\n','drwxr-xr-x root/root ./\n-rw-r--r-- root/root ./app.cjs\n')).not.toThrow();
 });
 it.each(['/tmp/key','./../outside','./build/../../outside','C:\\outside','./build//outside'])('rejects unsafe archive path %s',name=>{
  expect(()=>checkArchiveListing(name+'\n','-rw-r--r-- file\n')).toThrow();
 });
 it.each(['l','h','b','c','p'])('rejects link or special-file entries %s',type=>{
  expect(()=>checkArchiveListing('./app.cjs\n',type+'rwxrwxrwx ./app.cjs\n')).toThrow();
 });
});

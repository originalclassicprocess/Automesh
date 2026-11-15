import { build } from 'vite';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
// Bundle the push implementation into the release's private server directory.
// Updating the site must not install/change cPanel's managed runtime modules.
export async function bundleNotifications(destination) {
  const root=resolve(import.meta.dirname,'..');
  await build({root,configFile:false,publicDir:false,ssr:{noExternal:true},logLevel:'warn',build:{
    ssr:join(root,'server/notifications.js'),outDir:join(destination,'server'),emptyOutDir:false,minify:false,
    rolldownOptions:{output:{entryFileNames:'notifications.js',codeSplitting:false,
      banner:'// Includes web-push 3.6.7 (MPL-2.0), copyright 2015 Marco Castelluccio.\n// Corresponding source and license: docs/third-party-licenses/web-push-3.6.7/.\n// Automesh notification source and build recipe are in the public Automesh repository.'}},
  }});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==3)throw Error('Supply an isolated release directory');
  await bundleNotifications(resolve(process.argv[2]));
}

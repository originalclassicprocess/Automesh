// Import the existing scalar AND public coordinates. Private-only EC PKCS8 is
// rejected by some browsers. HPKE and the saved/wire key formats stay intact.
export async function importP256Private(secret:Uint8Array,publicKey:string):Promise<CryptoKey>{
  if(secret.length!==32||!/^04[a-f0-9]{128}$/.test(publicKey))throw Error('courier_key_import_failed');
  const publicBytes=Uint8Array.from(publicKey.slice(2).match(/../g)!,v=>parseInt(v,16));
  const encoded=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  try{
    return await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',d:encoded(secret),
      x:encoded(publicBytes.subarray(0,32)),y:encoded(publicBytes.subarray(32)),ext:true,key_ops:['deriveBits']},
      {name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  }catch{throw Error('courier_key_import_failed');}
}

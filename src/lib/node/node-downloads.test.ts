import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import NodeDownloads from './NodeDownloads.svelte';
import { parseNodeDownload, fetchNodeDownload, fetchNodeDownloads } from './node-downloads';
import { packageRepository, packageWorkflow } from '../application/package-provenance.js';
const publicRelease = {draft:false,tag_name:'v0.4.17',target_commitish:'a'.repeat(40),html_url:'https://github.com/originalclassicprocess/automesh-nodes/releases/tag/v0.4.17',
 assets:['Automesh-Node-Setup.exe','Automesh-Node-Linux-x64.tar.gz','Automesh-Server-Node-0.4.17-cPanel.tar.gz'].map(name=>({name,size:35*1024*1024,digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://github.com/originalclassicprocess/automesh-nodes/releases/download/v0.4.17/'+name}))};
const windows = { version: '0.4.1', bytes: 35 * 1024 * 1024, sha256: 'a'.repeat(64), signed: false, url: '/downloads/Automesh-Node-Setup.exe' };
describe('separate node downloads', () => {
  it('uses fixed local artifacts, not URLs provided by an operator', () => {
    expect(parseNodeDownload('windows', { ...windows, injected: 'discard' })).toEqual(windows);
    for (const url of ['https://evil.test/node.exe', '//evil.test/node.exe', '/downloads/../secret', windows.url + '?token=x']) {
      expect(() => parseNodeDownload('windows', { ...windows, url })).toThrow('invalid_download');
    }
    expect(() => parseNodeDownload('linux', windows)).toThrow();
    expect(parseNodeDownload('linux', { ...windows, platform: 'linux-x64', url: '/downloads/Automesh-Node-Linux-x64.tar.gz' }).url).toContain('Linux');
  });
  it('rejects invalid size, hash, version and signature flag', () => {
    for (const patch of [{ bytes: -1 }, { bytes: 300 * 1024 * 1024 }, { bytes: 1.5 }, { sha256: 'broken' }, { version: '<script>' }, { signed: 'yes' }]) {
      expect(() => parseNodeDownload('windows', { ...windows, ...patch })).toThrow();
    }
  });
  it('accepts a GitHub reference but not an operator-controlled repository or verification badge', () => {
    const provenance = { type: 'github-actions', repository: packageRepository, workflow: packageWorkflow,
      ref: 'refs/heads/main', commit: 'a'.repeat(40), runId: '12345', bundleUrl: windows.url + '.sigstore.json' };
    const result = parseNodeDownload('windows', { ...windows, provenance: { ...provenance, verified: true } });
    expect(result.provenance).toEqual(provenance); expect(result.signed).toBe(false);
    expect(() => parseNodeDownload('windows', { ...windows, provenance: { ...provenance, repository: 'evil/repo' } })).toThrow();
  });
  it('caps even an undeclared/chunked manifest and sanitizes malformed JSON', async () => {
    const signal = new AbortController().signal;
    await expect(fetchNodeDownload('windows', signal, async () => new Response('x'.repeat(256*1024+1)))).rejects.toThrow('invalid_public_release');
    await expect(fetchNodeDownload('windows', signal, async () => new Response('private malformed data'))).rejects.toThrow('invalid_public_release');
    await expect(fetchNodeDownload('windows', signal, async () => new Response('', { status: 404 }))).rejects.toThrow('public_release_unavailable');
  });
  it('does not follow redirects or attach session credentials, and honors cancellation', async () => {
    let options: RequestInit | undefined;
    const controller = new AbortController();
    const result = await fetchNodeDownload('windows', controller.signal, async (_url, init) => { options = init; return Response.json(publicRelease); });
    expect(result.version).toBe('0.4.17'); expect(result.url).toBe(publicRelease.assets[0].browser_download_url); expect(options).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' });
    controller.abort();
    await expect(fetchNodeDownload('windows', controller.signal, async () => Response.json(publicRelease))).rejects.toThrow();
  });
  it('loads all three editions with one public request', async () => {
    let count=0; const result=await fetchNodeDownloads(new AbortController().signal,async()=>{count++;return Response.json(publicRelease);});
    expect(count).toBe(1);expect(Object.keys(result)).toEqual(['windows','linux','server']);
    expect(result.server?.fileName).toContain('Server-Node');
  });
  it('shows both platforms and limitations without pretending a build exists', () => {
    const html = render(NodeDownloads).body;
    expect(html).toContain('Windows · x64'); expect(html).toContain('Linux · x64');
    expect(html).toContain('настроить HTTPS'); expect(html).not.toContain('href="/downloads/');
  });
});

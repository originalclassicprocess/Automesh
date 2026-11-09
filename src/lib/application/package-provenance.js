// Distribution/UI policy, not the portable node protocol. Trust is pinned in
// application code, never supplied by a download site.
export const packageRepository = 'originalclassicprocess/automesh-nodes';
export const packageWorkflow = `${packageRepository}/.github/workflows/release.yml`;
export const packageRef = 'refs/heads/main';
export const packageArtifacts = {
  windows: { file: 'Automesh-Node-Setup.exe', manifest: 'node-release.json' },
  linux: { file: 'Automesh-Node-Linux-x64.tar.gz', manifest: 'node-linux-release.json' }
};

/** @param {'windows' | 'linux'} platform @param {unknown} raw */
export function parsePackageProvenance(platform, raw) {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_provenance');
  const value = /** @type {Record<string, unknown>} */ (raw);
  const bundleUrl = `/downloads/${packageArtifacts[platform].file}.sigstore.json`;
  if (value.type !== 'github-actions' || value.repository !== packageRepository ||
      value.workflow !== packageWorkflow || value.ref !== packageRef ||
      typeof value.commit !== 'string' || !/^[a-f0-9]{40}$/.test(value.commit) ||
      typeof value.runId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value.runId) ||
      value.bundleUrl !== bundleUrl) throw new Error('invalid_provenance');
  // This is a reference, NOT cryptographic verification of a downloaded file.
  return { type: 'github-actions', repository: packageRepository, workflow: packageWorkflow,
    ref: packageRef, commit: value.commit, runId: value.runId, bundleUrl };
}

/** @param {string} file @param {string | undefined} [commit] */
export function packageVerificationArgs(file, commit) {
  if (typeof file !== 'string' || !file || file.includes('\0') || file.startsWith('-')) throw new Error('invalid_file');
  if (commit !== undefined && !/^[a-f0-9]{40}$/.test(commit)) throw new Error('invalid_commit');
  return ['attestation', 'verify', file, '--hostname', 'github.com', '--repo', packageRepository,
    '--signer-workflow', packageWorkflow, '--source-ref', packageRef,
    '--cert-oidc-issuer', 'https://token.actions.githubusercontent.com',
    '--predicate-type', 'https://slsa.dev/provenance/v1', '--deny-self-hosted-runners',
    ...(commit ? ['--source-digest', commit, '--signer-digest', commit] : []), '--format', 'json'];
}

/** @param {'windows' | 'linux'} platform @param {string | undefined} [commit] */
export function packageVerificationCommand(platform, commit) {
  // Fixed filenames and validated hex only; safe to copy into either shell.
  return 'gh ' + packageVerificationArgs('./' + packageArtifacts[platform].file, commit).join(' ');
}

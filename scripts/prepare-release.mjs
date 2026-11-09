import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { buildInformation } from './build-info.mjs';

const root = resolve(import.meta.dirname, '..');
const build = join(root, 'build');
if (!existsSync(join(build, 'handler.js'))) throw new Error('Build the Node application first');
const version = JSON.parse(readFileSync(join(build, 'client/_app/version.json'), 'utf8')).version;
const args = process.argv.slice(2);
const options = new Map();
const priorArguments = [];
for (let i = 0; i < args.length; i += 2) {
  if (!['--previous-release', '--output'].includes(args[i]) || !args[i + 1] || args[i] === '--output' && options.has(args[i]))
    throw new Error('Usage: prepare-release.mjs [--previous-release <directory>] [--output .release/<new-directory>]');
  if (args[i] === '--previous-release') priorArguments.push(args[i + 1]);
  else options.set(args[i], args[i + 1]);
}
const previousReleases = [], previousVersions = [];
for (const value of priorArguments) {
  const previousRelease = resolve(root, value);
  const within = relative(join(root, '.release'), previousRelease);
  if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('Previous release must be inside .release');
  const previousVersion = JSON.parse(readFileSync(join(previousRelease, 'build/client/_app/version.json'), 'utf8')).version;
  if (!existsSync(join(previousRelease, 'build/client/_app/immutable'))) throw new Error('Previous release assets missing');
  previousReleases.push(previousRelease); previousVersions.push(previousVersion);
}
// New directory per run: never overwrite/delete a previous usable release.
const destination = options.has('--output') ? resolve(root, options.get('--output')) : join(root, '.release', `automesh-${Date.now()}`);
const withinOutput = relative(join(root, '.release'), destination);
if (!/^automesh-[a-z0-9-]+$/.test(withinOutput) || isAbsolute(withinOutput) || existsSync(destination))
  throw new Error('Output must be a new automesh-* directory directly inside .release');
mkdirSync(join(root, '.release'), { recursive: true });
mkdirSync(destination);
const copy = path => {
  const target = join(destination, path); mkdirSync(resolve(target, '..'), { recursive: true });
  cpSync(join(root, path), target, { recursive: true });
};
copy('build'); copy('app.cjs'); copy('LICENSE'); copy('.env.example'); copy('docs/DEPLOYMENT.md'); copy('docs/UPDATES.md'); copy('docs/CHAT_UX_CHECKLIST.md'); copy('CHANGELOG.md'); copy('HISTORY.md'); copy('docs/PUBLIC_SOURCE_PREVIEW.md');
copy('THIRD_PARTY_NOTICES.md'); copy('README.md'); copy('README.ru.md'); copy('SECURITY.md'); copy('CONTRIBUTING.md');
copy('docs/ARCHITECTURE.md'); copy('docs/PUBLIC_RELEASE_PLAN.md');
copy('docs/PUBLIC_READINESS_2026-11-08.md');
copy('docs/DEPENDENCY_LICENSE_REVIEW.md'); copy('docs/DEPENDENCY_SECURITY_2026-11-08.md');
copy('docs/third-party-licenses');
copy('docs/AUDIT_2026-10-02.md'); copy('docs/online-e2ee-v1.md');
copy('docs/STORAGE_MEDIA_CHECKLIST.md');
copy('docs/CHAT_ACTIONS_CHECKLIST.md');
copy('docs/CHAT_UI_ITERATION.md');
copy('docs/COMPACT_CHAT_REVIEW.md');
copy('docs/HOME_NODE.md');
copy('docs/NODE_0_1_8.md');
copy('docs/ATTACHMENT_QUEUE.md');
copy('docs/COURIER.md');
copy('docs/COURIER_ROUTES_V1.md'); copy('docs/DELIVERY_RELIABILITY.md'); copy('docs/RECIPIENT_DELIVERY_0_4_6.md'); copy('docs/BROWSER_RECEIVE_0_4_7.md'); copy('docs/DELIVERY_STATUS_0_4_8.md'); copy('docs/PROFILE_UI_0_4_9.md');
copy('docs/CHAT_UI_0_4_10.md');
copy('docs/LORA_FIRST_LINK.md'); copy('docs/LORA_ACCOUNT_TEST.md'); copy('docs/LORA_BLUETOOTH_TEST.md');
copy('docs/LORA_CONTACT_EXCHANGE.md');
copy('docs/LORA_BLUETOOTH_STABILITY.md'); copy('docs/MESHTASTIC_CHANNELS.md');
copy('docs/TRANSLATIONS.md'); copy('docs/TRANSLATION_TEST_0_4_11.md');
copy('docs/UI_COPY_REVIEW_2026_10.md'); copy('docs/UI_LOCALIZATION_2026_10.md');
copy('docs/CORE_V1.md'); copy('docs/CORE_API.md'); copy('docs/CORE_RELEASE_CHECKLIST.md');
copy('docs/CORE_DURABLE_STATE.md'); copy('docs/CORE_BROWSER_CHECKLIST.md'); copy('docs/PROFILES_PRIVACY_CONTRACT.md'); copy('docs/PROFILES_V1.md'); copy('docs/PROFILES_RELEASE_CHECKLIST.md');
copy('docs/PROFILE_CHAT_SWITCHING.md');
copy('docs/PROFILE_PRESETS.md');
copy('docs/SIMPLE_PROFILES.md');
copy('docs/STRONG_PASSWORD_RELEASE.md');
copy('docs/CHAT_MEDIA.md');
copy('docs/MEDIA_VIEWER.md');
copy('docs/IMAGE_PRIVACY_DELIVERY.md'); copy('docs/PHOTO_AVATARS.md'); copy('docs/CHAT_POLISH_LOCAL.md'); copy('docs/VOICE_MESSAGES.md');
copy('docs/THIRD_PARTY_MEDIA_NOTICES.md');
copy('docs/NETWORK_DELIVERY_AUDIT_2026-10-07.md');
copy('docs/NODE_CORE_STAGE12.md');
copy('docs/SETTINGS_MAP_2026-10-10.md'); copy('docs/SETTINGS_CLEANUP_2026-10-10.md');
copy('docs/RECEIVE_RECOVERY_2026-10-10.md'); copy('docs/SETTINGS_DESIGN_2026-10-10.md');
copy('docs/RECEIVE_QUEUE_2026-10-11.md'); copy('docs/VOICE_CALLS_STAGE1.md');
copy('docs/SECURITY_AUDIT_2026-10-12.md'); copy('docs/NODE_DOWNLOADS_2026-10-12.md');
copy('docs/PACKAGE_PROVENANCE_2026-10-12.md');
copy('docs/FULL_BACKUP_V1.md'); copy('docs/DEVICE_ENROLLMENT_NEXT.md');
copy('docs/DEVICE_LINKING.md');
copy('docs/ACCOUNT_DEVICE_STATES.md');
copy('docs/NETWORK_RECOVERY_2026-10-20.md');
copy('docs/PRIMARY_DELIVERY_2026-10-20.md');
copy('docs/UI_POLISH_2026-10-20.md');
copy('docs/CHAT_UX_AND_EPHEMERAL.md');
copy('docs/DATA_BACKUP_V1.md');
copy('docs/DEVICE_REPLICATION_STAGE.md');
copy('docs/DEVICE_HISTORY_TRANSFER.md');
copy('docs/CLEAN_START.md'); copy('docs/VERIFY_RELEASE.md');
writeFileSync(join(destination, 'docs/build-info.json'), JSON.stringify(buildInformation(root), null, 2) + '\n');
// Retain only immutable resources, never the old HTML/worker/server. Existing
// current assets win; old tabs can still load their own hashed modules.
for (const previousRelease of previousReleases) cpSync(join(previousRelease, 'build/client/_app/immutable'),
  join(destination, 'build/client/_app/immutable'), { recursive: true, force: false });
for (const path of ['server/app.js', 'server/application.js', 'server/device-pairing.js', 'server/signaling.js', 'server/limits.js',
  'src/lib/addressing/account-id.js', 'src/lib/addressing/bech32m.js', 'src/lib/transport/registration-proof.js', 'src/lib/node/courier-protocol.js', 'src/lib/node/attachment-protocol.js']) copy(path);
// Thin compatibility entries above resolve to the single shared implementation.
// Site hosting needs only signaling + the wire contract, not node queues/admin.
for (const path of ['nodes/LICENSE', 'nodes/packages/protocol/src', 'nodes/packages/deployment/src', 'nodes/packages/runtime/src/signaling.js', 'nodes/packages/runtime/src/limits.js']) copy(path);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
pkg.scripts = { start: 'node server/app.js' }; delete pkg.devDependencies;
pkg.engines = { node: '>=22.12.0' };
writeFileSync(join(destination, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
delete lock.packages[''].devDependencies;
lock.packages[''].engines = pkg.engines;
writeFileSync(join(destination, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
function files(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = prefix + entry.name;
    return entry.isDirectory() ? files(join(directory, entry.name), path + '/') : [path];
  });
}
const manifest = files(destination).map(path => ({ path,
  sha256: createHash('sha256').update(readFileSync(join(destination, path))).digest('hex') }));
writeFileSync(join(destination, 'release-manifest.json'), JSON.stringify({ version,
  ...(previousVersions.length ? { retainedAssetVersions: [...new Set(previousVersions)] } : {}), files: manifest }, null, 2) + '\n');
console.log(`Release prepared (not uploaded): ${destination}`);
console.log(`Version: ${version}; files: ${manifest.length}. See docs/DEPLOYMENT.md.`);

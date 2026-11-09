"""Package the private local plugin without credentials or dependencies."""
import json
import re
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
plugin = root / 'plugins' / 'automesh-notifier'
manifest = json.loads((plugin / 'plugin.json').read_text(encoding='utf-8'))
assert manifest['name'] == plugin.name
assert len(manifest['extensions']['com.openai']['interface']['shortDescription']) <= 30
assert (plugin / 'dist' / 'browser.js').is_file()
assert (plugin / 'dist' / 'identity.mjs').is_file()
output = root / '.release' / f'automesh-notifier-{manifest["version"]}.zip'
output.parent.mkdir(parents=True, exist_ok=True)
excluded = {'node_modules', '.data', '.test-data', '.git', '__pycache__'}
files = {'plugin.json', 'mcp.json', 'package.json', 'package-lock.json',
         'README.md', 'THIRD_PARTY_NOTICES.md', '.gitignore'}
directories = {'browser', 'dist', 'hooks', 'server', 'skills', 'tests'}
standalone_marketplace = {
    'name': 'mesh-autonomy-local',
    'interface': {'displayName': 'Automesh Notifications'},
    'plugins': [{
        'name': plugin.name,
        'source': {'source': 'local', 'path': './'},
        'policy': {'installation': 'AVAILABLE', 'authentication': 'ON_INSTALL'},
        'category': 'Productivity',
    }],
}
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
    for path in sorted(plugin.rglob('*')):
        relative = path.relative_to(plugin)
        if path.is_symlink() or not path.is_file() or excluded.intersection(relative.parts):
            continue
        if relative.parts[0] not in directories and str(relative) not in files:
            raise RuntimeError('Unexpected file in plugin package: ' + str(relative))
        if path.suffix in {'.dpapi', '.tmp', '.automesh'} or path.name in {'config.json', 'outbox.lock'} or path.name.startswith('.env'):
            raise RuntimeError('Unexpected secret/configuration file in plugin package')
        content = path.read_text(encoding='utf-8')
        if re.search(r'(?i)\b[A-Z]:[\\/]|C:[\\/]+Users|mesh1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{40}', content):
            raise RuntimeError('Personal path or literal account address in plugin package: ' + str(relative))
        archive.write(path, Path(plugin.name) / relative)
    archive.writestr(plugin.name + '/.agents/plugins/marketplace.json',
                     json.dumps(standalone_marketplace, indent=2))
with ZipFile(output) as archive:
    names = archive.namelist()
    assert all(name.startswith(plugin.name + '/') for name in names)
    assert not any('node_modules/' in name or '.dpapi' in name for name in names)
    assert json.loads(archive.read(plugin.name + '/plugin.json'))['version'] == manifest['version']
    assert plugin.name + '/dist/browser.js' in names
    assert plugin.name + '/server/mcp.mjs' in names
    assert plugin.name + '/server/install.mjs' in names
    assert plugin.name + '/THIRD_PARTY_NOTICES.md' in names
    assert json.loads(archive.read(plugin.name + '/.agents/plugins/marketplace.json'))['plugins'][0]['source']['path'] == './'
    print(json.dumps({'archive': str(output), 'files': len(names), 'bytes': output.stat().st_size}))

"""Verify the shareable ZIP can run without its source tree or node_modules."""
import json
from pathlib import Path
import subprocess
import tempfile
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'plugins/automesh-notifier/plugin.json').read_text())['version']
archive = root / '.release' / f'automesh-notifier-{version}.zip'
# TemporaryDirectory's cleanup is confined to this explicitly named workspace
# directory. No user data or installed plugin cache is removed.
with tempfile.TemporaryDirectory(prefix='notifier-share-check-', dir=root / '.release') as temporary:
    destination = Path(temporary).resolve()
    assert destination.is_relative_to((root / '.release').resolve())
    with ZipFile(archive) as bundle:
        for entry in bundle.namelist():
            assert (destination / entry).resolve().is_relative_to(destination)
        bundle.extractall(destination)
    plugin = destination / 'automesh-notifier'
    assert not (plugin / 'node_modules').exists()
    assert not (plugin / 'config.json').exists()
    assert not (plugin / 'sender.dpapi').exists()
    result = subprocess.run(['node', str(plugin / 'server/cli.mjs'), 'probe'],
                            capture_output=True, text=True, check=True, timeout=50)
    connection = json.loads(result.stdout)
    assert connection['registered'] is True
    assert connection['transport'] == 'connected'
    print(json.dumps({'standaloneArchive': True, 'registered': True, 'sourceDirectoryRequired': False}))

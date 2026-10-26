"""Build the explicit AstrBot adapter file set, without SDKs or private profiles."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True)
args = parser.parse_args()
output = Path(args.out).resolve()
if output.suffix != '.zip':
    parser.error('output must be a new .zip file')
if output.exists():
    parser.error('output already exists; preserve it and choose another path')
source = root / 'adapters/astrbot'
contents = {}
for name in ['main.py', 'core_client.py', 'metadata.yaml', '_conf_schema.json', 'README.md', 'LICENSE']:
    file = root / name if name == 'LICENSE' else source / name
    if file.is_symlink() or not file.is_file():
        parser.error('expected regular source file: ' + name)
    contents[name] = file.read_bytes()
version_match = re.search(r'^version: ([a-zA-Z0-9.\-]+)\r?$', contents['metadata.yaml'].decode('utf-8'), re.M)
if version_match is None:
    parser.error('metadata.yaml must contain a valid version')
version = version_match.group(1)
manifest = {'schemaVersion': 1, 'package': 'astrbot_plugin_memory_continuity', 'version': version,
            'files': [{'path': name, 'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()}
                      for name, value in sorted(contents.items())]}
contents['SOURCE-MANIFEST.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, value in sorted(contents.items()):
        item = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
        item.compress_type = zipfile.ZIP_DEFLATED
        item.external_attr = 0o100644 << 16
        archive.writestr(item, value)
payload = buffer.getvalue()
output.parent.mkdir(parents=True, exist_ok=True)
with output.open('xb') as handle:
    handle.write(payload)
    handle.flush()
    os.fsync(handle.fileno())
print(json.dumps({'package': manifest['package'], 'version': version, 'path': str(output),
                  'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}, ensure_ascii=False))

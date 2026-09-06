export const sandboxPath =
  '/opt/r2cloud/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
export const bunIntegrity =
  '9/E/UXOTpSo3YsV5g+FhtTd/qTpiWoKuxS12cqtuYA1ssu9fRAoPQnipFgGyck3tWO63iUdxBiygq+kELFawng==';
export const installBun = String.raw`
import base64, hashlib, io, pathlib, tarfile, urllib.request
url = 'https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-1.4.2.tgz'
with urllib.request.urlopen(url, timeout=60) as response:
    content = response.read(64 * 1024 * 1024 + 1)
if len(content) > 64 * 1024 * 1024:
    raise RuntimeError('Runtime package exceeds the download limit')
if base64.b64encode(hashlib.sha512(content).digest()).decode() != '${bunIntegrity}':
    raise RuntimeError('Runtime integrity check failed')
with tarfile.open(fileobj=io.BytesIO(content), mode='r:gz') as archive:
    member = archive.getmember('package/bin/bun')
    if not member.isfile() or member.size > 96 * 1024 * 1024:
        raise RuntimeError('Invalid runtime binary')
    root = pathlib.Path('/opt/r2cloud/bin')
    root.mkdir(parents=True, mode=0o755, exist_ok=True)
    binary = root / 'bun'
    binary.write_bytes(archive.extractfile(member).read())
    binary.chmod(0o755)
`;

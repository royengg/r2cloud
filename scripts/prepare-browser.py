"""Adapt the already-installed ARM64 Chromium for this project's test environment.
Copies only executables, patches their ELF interpreter locally, and links read-only
resources. Does not download anything or change snap/system files.
"""
import os, shutil, struct
from pathlib import Path
root = Path(__file__).resolve().parent.parent
source = Path('/snap/chromium/current/usr/lib/chromium-browser')
dest = root / '.local/browser'
assert shutil.disk_usage(root).free > 21 * 1024**3, 'Keep at least 20 GiB free'
dest.mkdir(parents=True, exist_ok=True)
interpreter = b'/snap/core24/current/lib/ld-linux-aarch64.so.1\0'
for name in ['chrome', 'chrome_crashpad_handler']:
    target = dest / name
    shutil.copyfile(source / name, target)
    with target.open('r+b') as f:
        header = f.read(64)
        assert header[:5] == b'\x7fELF\x02' and struct.unpack_from('<H', header, 18)[0] == 183
        offset = struct.unpack_from('<Q', header, 32)[0]
        size, count = struct.unpack_from('<HH', header, 54)
        for i in range(count):
            f.seek(offset + i * size)
            ph = bytearray(f.read(size))
            if struct.unpack_from('<I', ph)[0] == 3:
                f.seek(0, 2); end = f.tell(); f.write(interpreter)
                struct.pack_into('<Q', ph, 8, end)
                struct.pack_into('<QQ', ph, 32, len(interpreter), len(interpreter))
                f.seek(offset + i * size); f.write(ph); break
        else: raise RuntimeError('ELF interpreter not found')
    target.chmod(0o700)
for name in ['icudtl.dat', 'resources.pak', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'locales', 'v8_context_snapshot.bin', 'libEGL.so', 'libGLESv2.so', 'libvk_swiftshader.so', 'vk_swiftshader_icd.json']:
    target = dest / name
    if target.is_symlink(): target.unlink()
    if not target.exists() and (source / name).exists(): target.symlink_to(source / name)
print('Project-private browser ready; system files unchanged.')

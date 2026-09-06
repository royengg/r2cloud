import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
export class CredentialVault {
  private key: Buffer;
  constructor(
    private root: string,
    key: string,
  ) {
    if (!isAbsolute(root) || !/^[a-f0-9]{64}$/.test(key))
      throw new Error('A private vault directory and a 32-byte encryption key are required.');
    this.key = Buffer.from(key, 'hex');
  }
  private path(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid credential identity.');
    return join(this.root, id + '.sealed');
  }
  async put(id: string, content: Buffer) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(id));
    const ciphertext = Buffer.concat([cipher.update(content), cipher.final()]);
    const path = this.path(id);
    const temp = path + '.' + randomBytes(8).toString('hex');
    try {
      await writeFile(temp, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
  }
  async read(id: string) {
    const data = await readFile(this.path(id));
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
  }
  async remove(id: string) {
    await rm(this.path(id), { force: true });
  }
}

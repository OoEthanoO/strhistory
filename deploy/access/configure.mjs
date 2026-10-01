// Read the code on stdin, not in command-line arguments or a committed file.
// Re-running rotates the session key and invalidates every existing session.
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const code = input.trim();
if (!code || code.length > 128) throw new Error('Provide an access code on stdin');
const salt = randomBytes(16).toString('hex');
const target = process.argv[2];
if (!target) throw new Error('Provide the private configuration path');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify({
  origin: 'https://history.ethanyanxu.com', salt,
  codeHash: scryptSync(code, salt, 64).toString('hex'),
  sessionKey: randomBytes(32).toString('hex'),
}, null, 2), { mode: 0o600 });
console.log('Access configuration saved; no plaintext code retained.');

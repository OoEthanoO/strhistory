// Run on the home server after restricting the private directory's ACL.
// Generates a separate teacher code; reports it once, never stores plaintext.
import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
const root = process.argv[2];
if (!root) throw new Error('Supply the site root, outside the repository.');
const target = join(root, 'private/admin.json');
if (existsSync(target)) throw new Error('Admin configuration already exists. Refusing to rotate it implicitly.');
const settings = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8').replace(/^\uFEFF/, ''));
const code = randomBytes(18).toString('base64url');
const salt = randomBytes(16).toString('hex');
writeFileSync(target, JSON.stringify({
  origin: 'https://strhistory.ca', salt, codeHash: scryptSync(code, salt, 64).toString('hex'), sessionKey: randomBytes(32).toString('hex'),
  siteRoot: root, repo: join(root, 'authoring/repo'), data: join(root, 'private/admin-data'),
  sshKey: join(root, 'private/admin-git'), knownHosts: join(root, 'private/admin-known-hosts'),
  node: settings.node, git: settings.git, npmCli: join(dirname(settings.node), 'node_modules/npm/bin/npm-cli.js'),
}, null, 2), { mode: 0o600, flag: 'wx' });
console.log(`Admin access code (save privately): ${code}`);

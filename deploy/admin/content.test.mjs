import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createContentTools, contentPath } from './content.mjs';
import { collections } from './collections.mjs';
const tools = await createContentTools(process.cwd());
test('only fixed content collections and safe filenames can be edited', () => {
  assert.equal(contentPath('topics', 'test-note'), 'src/content/topics/test-note.mdx');
  assert.equal(contentPath('snapshots', '-500'), 'src/content/snapshots/-500.md');
  for (const [collection, slug] of [['topics', '../../private/admin'], ['topics', 'CON'], ['topics', 'foo%2fbar'], ['topics', 'a:b'], ['topics', 'file.js'], ['topics', 'UPPER'], ['__proto__', 'x'], ['constructor', 'x'], ['snapshots', '../1789']]) assert.throws(() => contentPath(collection, slug));
});
test('teacher edits cannot execute MDX, raw HTML, unsafe URLs or load private files', async () => {
  const fields = { title: 'Safe title', summary: 'Safe summary' };
  for (const body of ['import fs from "node:fs"\n\nHello', 'export const a = 1', '{process.env}', '<Term {...process.env}>x</Term>', '<Term id={process.env}>x</Term>', '<script>alert(1)</script>', '<iframe src="https://evil.test" />', '<a href="javascript:alert(1)">x</a>', '[x](javascript:alert%281%29)', '[x](java&#x73;cript:alert%281%29)', '![x](../../private/admin.json)', '![x](http://127.0.0.1:4310/health)', '<Callout onclick="alert(1)">x</Callout>']) await assert.rejects(tools.validate('topics', fields, body), body);
  await assert.rejects(tools.validate('teachers', { name: 'x', photo: '../../private/admin.json' }, ''));
  await assert.rejects(tools.validate('topics', { title: 'x', layout: '../../code.js' }, ''));
  await assert.rejects(tools.validate('news', fields, '<script>alert(1)</script>'));
  await assert.rejects(tools.validate('topics', fields, '<a href="java&#x73;cript:alert(1)">x</a>'));
  const tree = await tools.validate('topics', fields, '<Recall q="What changed?">**Answer** with a <Term id="term">term</Term>.</Recall>');
  assert.match(tools.preview(tree, { term: { definition: '<script>no</script>', significance: 'Why it matters' } }), /&lt;script&gt;/);
  assert.match(tools.preview(tree), /<details>/);
});
test('all existing editable entries pass the safety policy and YAML round-trips', async () => {
  for (const [collection, spec] of Object.entries(collections)) {
    const dir = `src/content/${collection}`;
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.' + spec.extension) || file.startsWith('_')) continue;
      const original = await readFile(`${dir}/${file}`, 'utf8');
      const parsed = tools.parse(original);
      await tools.validate(collection, parsed.fields, parsed.body).catch((e) => { throw new Error(`${collection}/${file}: ${e.message}`); });
      assert.deepEqual(tools.parse(tools.serialize(parsed.fields, parsed.body)).fields, parsed.fields);
    }
  }
});

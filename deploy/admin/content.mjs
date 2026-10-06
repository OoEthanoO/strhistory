import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { collections } from './collections.mjs';

export function contentPath(collection, slug) {
  if (!Object.hasOwn(collections, collection) || typeof slug !== 'string' || slug.length > 100 ||
      !(collection === 'snapshots' ? /^-?[1-9][0-9]{0,5}$/ : /^[a-z0-9]+(?:-[a-z0-9]+)*$/).test(slug) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(slug)) throw new Error('Choose a valid, lowercase URL name.');
  return `src/content/${collection}/${slug}.${collections[collection].extension}`;
}
export const components = {
  Term: ['id'], Q: ['by', 'date', 'source', 'note'],
  KeyQuote: ['by', 'role', 'date', 'source', 'analysis'], Callout: ['type', 'title'],
  Perspective: ['historian', 'work', 'year', 'school'], Chronology: ['title'], Event: ['date'], Recall: ['q'],
  br: [], em: [], strong: [], sub: [], sup: [], p: [], ul: [], ol: [], li: [], blockquote: [], a: ['href', 'title'],
};
const escape = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function safeUrl(url, image = false) {
  if (typeof url !== 'string' || /[\u0000-\u0020\\]/.test(url) || url.startsWith('//')) throw new Error('Use a normal HTTPS link or a site-relative link.');
  if (!/^(https?:\/\/|mailto:|\/(?!\/)|\.{1,2}\/|#)/i.test(url) && /[:&]/.test(url)) throw new Error('Use an HTTPS link or a site-relative link.');
  const parsed = new URL(url, 'https://strhistory.ca');
  if (!['https:', 'http:', ...(image ? [] : ['mailto:'])].includes(parsed.protocol)) throw new Error('That link protocol is not allowed.');
  // Build-time image loading must never read arbitrary paths or local services.
  if (image && !/^\/[a-zA-Z0-9/_-]+\.(png|jpe?g|webp|gif|avif)$/.test(url)) throw new Error('Images must use an existing /public image URL, such as /images/photo.jpg.');
}
export async function createContentTools(repo) {
  const require = createRequire(join(repo, 'package.json'));
  const yaml = require('js-yaml');
  // Use exactly the Markdown parser installed by Astro's MDX integration.
  // Resolve through its declared dependency chain; no extra parser dependency.
  const mdxRequire = createRequire(require.resolve('@astrojs/mdx'));
  const markdownRequire = createRequire(mdxRequire.resolve('@astrojs/markdown-satteri'));
  const parser = await import(pathToFileURL(markdownRequire.resolve('satteri')).href);
  function parse(source) {
    const match = source.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
    if (!match) throw new Error('This entry needs YAML frontmatter.');
    const fields = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Frontmatter must be a field mapping.');
    return { fields, body: match[2].replace(/^\n/, '') };
  }
  function serialize(fields, body) {
    return `---\n${yaml.dump(fields, { schema: yaml.JSON_SCHEMA, lineWidth: -1, noRefs: true, quotingType: "'" })}---\n\n${body.trim()}\n`;
  }
  async function validate(collection, fields, body) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || typeof body !== 'string') throw new Error('Invalid content.');
    const allowed = new Set(collections[collection].fields.map((f) => f.name.split('.')[0]));
    for (const field of ['snapshot', 'borderYear', 'photo', 'photoAlt', 'image', 'imageAlt']) allowed.add(field);
    for (const key of Object.keys(fields)) if (!allowed.has(key)) throw new Error(`Unsupported field: ${key}`);
    for (const key of ['photo', 'image']) if (fields[key] && !/^\.\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif|avif)$/.test(fields[key])) throw new Error(`${key} must name an existing image beside this entry.`);
    // Parse, inspect, and render the syntax tree. Never evaluate submitted MDX.
    const tree = await (collections[collection].extension === 'mdx' ? parser.mdxToMdast(body) : parser.markdownToMdast(body));
    function visit(node) {
      if (['mdxjsEsm', 'mdxFlowExpression', 'mdxTextExpression', 'html'].includes(node.type)) throw new Error('Scripts, imports, expressions and raw HTML are not allowed. Use Markdown and the study-note components.');
      if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
        if (!Object.hasOwn(components, node.name)) throw new Error(`Unsupported component: ${node.name ?? 'fragment'}`);
        for (const attr of node.attributes ?? []) {
          if (attr.type !== 'mdxJsxAttribute' || !components[node.name].includes(attr.name) || typeof attr.value !== 'string') throw new Error(`Use quoted text attributes on ${node.name}.`);
          if (attr.name === 'href') safeUrl(attr.value);
        }
      }
      if (node.url != null) safeUrl(node.url, node.type === 'image');
      if (node.type === 'imageReference') throw new Error('Use an inline image with a /public image URL.');
      for (const child of node.children ?? []) visit(child);
    }
    visit(tree);
    return tree;
  }
  function preview(tree, glossary = {}) {
    const definitions = new Map();
    function collect(n) { if (n.type === 'definition') definitions.set(n.identifier, n.url); for (const c of n.children ?? []) collect(c); }
    collect(tree);
    function render(n) {
      const children = () => (n.children ?? []).map(render).join('');
      const tag = (name) => `<${name}>${children()}</${name}>`;
      switch (n.type) {
        case 'root': return children();
        case 'text': return escape(n.value);
        case 'paragraph': return tag('p');
        case 'heading': return tag(`h${Math.min(6, Math.max(1, n.depth))}`);
        case 'strong': return tag('strong');
        case 'emphasis': return tag('em');
        case 'delete': return tag('del');
        case 'inlineCode': return `<code>${escape(n.value)}</code>`;
        case 'code': return `<pre><code>${escape(n.value)}</code></pre>`;
        case 'blockquote': return tag('blockquote');
        case 'list': return tag(n.ordered ? 'ol' : 'ul');
        case 'listItem': return tag('li');
        case 'break': return '<br />';
        case 'thematicBreak': return '<hr />';
        case 'link': return `<a href="${escape(n.url)}" target="_blank" rel="noopener noreferrer">${children()}</a>`;
        case 'linkReference': return `<a href="${escape(definitions.get(n.identifier) ?? '#')}" target="_blank" rel="noopener noreferrer">${children()}</a>`;
        case 'image': return `<p>[Image: ${escape(n.alt)}]</p>`;
        case 'table': return `<table>${children()}</table>`;
        case 'tableRow': return tag('tr');
        case 'tableCell': return tag('td');
        case 'definition': return '';
        case 'mdxJsxFlowElement': case 'mdxJsxTextElement': {
          const a = Object.fromEntries(n.attributes.map((x) => [x.name, x.value]));
          if (n.name === 'a') return `<a href="${escape(a.href)}" target="_blank" rel="noopener noreferrer">${children()}</a>`;
          if (n.name === 'Term') {
            const term = glossary[a.id];
            return `<details class="term"><summary>${children()}</summary><p>${escape(term?.definition ?? 'Term not found — add it to the glossary before publishing.')}</p><p>${escape(term?.significance)}</p></details>`;
          }
          if (n.name === 'Recall') return `<details><summary>${escape(a.q)}</summary>${children()}</details>`;
          if (n.name === 'KeyQuote' || n.name === 'Q') return `<blockquote class="quote">${children()}<footer>${escape([a.by, a.date, a.source].filter(Boolean).join(' · '))}</footer>${a.analysis || a.note ? `<details><summary>Why it matters</summary><p>${escape(a.analysis || a.note)}</p></details>` : ''}</blockquote>`;
          if (n.name === 'Perspective') return `<aside><strong>${escape(a.historian)}</strong> · ${escape(a.work)} (${escape(a.year)})${children()}</aside>`;
          if (n.name === 'Callout') return `<aside><strong>${escape(a.title || a.type)}</strong>${children()}</aside>`;
          if (n.name === 'Chronology') return `<section><h3>${escape(a.title || 'Chronology')}</h3>${children()}</section>`;
          if (n.name === 'Event') return `<div><strong>${escape(a.date)}</strong> ${children()}</div>`;
          return n.name === 'br' ? '<br />' : tag(n.name);
        }
        default: return children();
      }
    }
    return render(tree);
  }
  return { parse, serialize, validate, preview };
}

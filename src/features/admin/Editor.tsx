import { useEffect, useRef, useState } from 'react';
import { collections as definitions } from '../../../deploy/admin/collections.mjs';
import './admin.css';
type Field = { name: string; label: string; type: string; options?: string[]; collection?: string };
type Spec = { label: string; singular: string; fields: Field[]; defaults: Record<string, unknown>; body: string };
const collections = definitions as Record<string, Spec>;
type Entry = { collection: string; slug: string; fields: Record<string, any>; body: string; revision: string | null; draftVersion: string | null; hasDraft: boolean; savedAt?: string; changedUpstream?: boolean };
type Summary = { collection: string; slug: string; title: string; hasDraft: boolean; unpublished: boolean };
type Job = { id: string; collection: string; slug: string; phase: string; message: string; detail?: string; sha?: string };
async function api(path: string, data?: unknown) {
  const response = await fetch('/admin/api/' + path, { cache: 'no-store', ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
  if (response.status === 401) { location.assign('/admin/login'); throw new Error('Your teacher session has ended.'); }
  const value = await response.json().catch(() => ({ error: 'The editor is temporarily unavailable. Your saved drafts are safe.' }));
  if (!response.ok) throw new Error(value.error || 'The request could not be completed.');
  return value;
}
const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function previewDocument(title: string, html: string, dark: boolean) {
  const style = getComputedStyle(document.documentElement);
  const tokens = ['paper', 'ink', 'ink-2', 'rule', 'accent', 'highlight', 'term'].map((key) => `--${key}:${style.getPropertyValue('--' + key)};`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>:root{${tokens}color-scheme:${dark ? 'dark' : 'light'}}body{font:18px/1.65 Georgia,serif;background:var(--paper);color:var(--ink);max-width:68ch;margin:auto;padding:24px}h1,h2,h3{line-height:1.2}h1{font-size:32px}h2{font-size:25px;margin-top:32px}a{color:var(--accent)}details,aside,blockquote{padding:12px 18px;border:1px solid var(--rule);border-radius:10px;margin:16px 0}summary{cursor:pointer}.quote{background:var(--highlight)}.term{border-color:var(--term)}footer{font-size:14px;color:var(--ink-2);margin-top:10px}pre{overflow:auto}table{border-collapse:collapse}td{padding:8px;border:1px solid var(--rule)}</style></head><body><h1>${esc(title)}</h1>${html}</body></html>`;
}
const snippets: Record<string, string> = {
  Heading: '\n## New section\n\n', Bold: '**important words**', List: '\n- First point\n- Second point\n',
  'Key term': '<Term id="term-slug">key term</Term>',
  Quotation: '\n<KeyQuote by="Named author" date="Date" source="Published source" analysis="Why it matters">Verbatim quotation.</KeyQuote>\n',
  'Self-test': '\n<Recall q="Your question?">The answer.</Recall>\n',
  Callout: '\n<Callout type="context" title="Context">Add the context.</Callout>\n',
  Historian: '\n<Perspective historian="Historian" work="Published work" year="Year">Their interpretation.</Perspective>\n',
};
export default function Editor() {
  const [entries, setEntries] = useState<Summary[]>([]);
  const [collection, setCollection] = useState('topics');
  const [query, setQuery] = useState('');
  const [entry, setEntry] = useState<Entry | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('Loading the library…');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [live, setLive] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const activeJob = job && ['validating', 'publishing'].includes(job.phase);
  const blocked = !!busy || !!activeJob;
  const reload = async () => { const data = await api('entries'); setEntries(data.entries); };
  const act = async (label: string, action: () => Promise<void>) => { setBusy(label); setError(''); setNotice(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(''); } };
  useEffect(() => { void act('Loading the library…', async () => { const status = await api('status'); setJob(status.job); setLive(status.live); if (!status.job || !['validating', 'publishing'].includes(status.job.phase)) await reload(); }); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (!job || job.phase === 'failed') return;
    let attempts = 0;
    const timer = setInterval(async () => {
      try {
        const data = await api('status'); setLive(data.live);
        if (data.job?.phase !== job.phase) {
          setJob(data.job);
          if (['published', 'failed'].includes(data.job?.phase)) {
            await reload();
            if (data.job.phase === 'published' && entry && entry.collection === data.job.collection && entry.slug === data.job.slug) {
              const fresh = await api(`entry?collection=${encodeURIComponent(entry.collection)}&slug=${encodeURIComponent(entry.slug)}`); setEntry(fresh); setDirty(false);
            }
          }
        }
        if (++attempts > 100 || (data.live && data.live === data.job?.sha)) clearInterval(timer);
      } catch { /* A service restart during deployment is temporary. Keep the draft on screen. */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [job?.id, job?.phase]);
  const canLeave = () => !dirty || window.confirm('Leave these unsaved changes? Saved drafts will be kept.');
  const open = (item: Summary) => { if (!canLeave()) return; void act('Opening entry…', async () => { setEntry(await api(`entry?collection=${item.collection}&slug=${item.slug}`)); setDirty(false); setPreview(''); }); };
  const newEntry = () => {
    if (!canLeave()) return;
    const spec = collections[collection]; const fields = structuredClone(spec.defaults);
    if ('date' in fields) fields.date = new Date().toISOString().slice(0, 10);
    setEntry({ collection, slug: '', fields, body: spec.body, revision: null, draftVersion: null, hasDraft: false }); setDirty(true); setPreview(''); setError(''); setNotice('');
  };
  const changeField = (name: string, value: unknown) => {
    if (!entry) return;
    const fields = structuredClone(entry.fields); const parts = name.split('.');
    if (parts.length === 2) { fields[parts[0]] ??= {}; fields[parts[0]][parts[1]] = value; }
    else fields[name] = value;
    if (value === '' && ['shortTitle', 'updated', 'email', 'when', 'quote', 'code'].includes(name)) delete fields[name];
    setEntry({ ...entry, fields }); setDirty(true); setPreview('');
  };
  const save = async () => { const saved = await api('draft', entry); setEntry(saved); setDirty(false); await reload(); return saved as Entry; };
  const title = entry ? String(entry.fields.title ?? entry.fields.name ?? entry.fields.term ?? 'New entry') : '';
  const shown = entries.filter((item) => item.collection === collection && `${item.title} ${item.slug}`.toLowerCase().includes(query.toLowerCase()));
  const input = (field: Field) => {
    const value = field.name.split('.').reduce((o: any, p) => o?.[p], entry?.fields);
    const id = 'field-' + field.name;
    if (field.type === 'boolean') return <label className="admin-check" key={id}><input id={id} type="checkbox" checked={value ?? false} onChange={(e) => changeField(field.name, e.target.checked)} />{field.label}</label>;
    return <label className={'admin-field ' + (['textarea', 'lines', 'assessment'].includes(field.type) ? 'wide' : '')} key={id} htmlFor={id}><span>{field.label}</span>{
      field.type === 'textarea' || field.type === 'lines' ? <textarea id={id} rows={3} value={field.type === 'lines' ? (value ?? []).join('\n') : value ?? ''} onChange={(e) => changeField(field.name, field.type === 'lines' ? e.target.value.split('\n') : e.target.value)} /> :
      field.type === 'select' || field.type === 'reference' || field.type === 'references' ? <><select id={id} multiple={field.type === 'references'} value={value ?? (field.type === 'references' ? [] : '')} onChange={(e) => changeField(field.name, field.type === 'references' ? [...e.target.selectedOptions].map((o) => o.value) : e.target.value)}>
        {field.type === 'reference' && <option value="">Choose a unit</option>}
        {field.options?.map((v) => <option key={v}>{v}</option>)}
        {field.collection && entries.filter((e) => e.collection === field.collection).map((e) => <option key={e.slug} value={e.slug}>{e.title}</option>)}
      </select>{field.type === 'references' && <small>Use Ctrl / ⌘ to select more than one.</small>}</> :
      field.type === 'assessment' ? <div className="assessment-fields">{(value ?? []).map((row: Record<string, string>, i: number) => <div className="assessment-row" key={i}>{['component', 'weight', 'detail'].map((key) => <input key={key} aria-label={`Assessment ${i + 1} ${key}`} placeholder={key} value={row[key] ?? ''} onChange={(e) => changeField(field.name, value.map((r: Record<string, string>, n: number) => n === i ? { ...r, [key]: e.target.value } : r))} />)}<button type="button" onClick={() => changeField(field.name, value.filter((_: unknown, n: number) => n !== i))}>Remove component {i + 1}</button></div>)}<button type="button" onClick={() => changeField(field.name, [...(value ?? []), { component: '', weight: '', detail: '' }])}>+ Add component</button></div> :
      <input id={id} type={['number', 'date', 'email'].includes(field.type) ? field.type : 'text'} step={field.type === 'number' ? 'any' : undefined} value={value ?? ''} onChange={(e) => changeField(field.name, field.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)} />
    }</label>;
  };
  return <div className="admin-shell container">
    <header className="admin-heading"><div><p className="eyebrow">TEACHER WORKSPACE</p><h1>The content desk.</h1><p>Make a change. Check the details. Share it with your students.</p></div><button className="admin-secondary" disabled={blocked} onClick={() => { if (canLeave()) void act('Signing out…', async () => { await api('logout', {}); location.assign('/admin/login'); }); }}>Sign out</button></header>
    <div className="admin-message" aria-live="polite">{busy || notice || (dirty ? 'Unsaved changes' : entry?.savedAt ? `Draft saved ${new Date(entry.savedAt).toLocaleString()}` : 'Drafts stay private until you publish.')}</div>
    {error && <div className="admin-error" role="alert">{error}</div>}
    {job && <section className={'admin-job ' + job.phase} aria-live="polite"><strong>{job.phase === 'published' && live === job.sha ? 'Live on the website.' : job.message}</strong>{job.detail && <details><summary>See validation details</summary><pre>{job.detail}</pre></details>}{job.sha && <a href={`https://github.com/OoEthanoO/strhistory/commit/${job.sha}`} target="_blank" rel="noreferrer">View published revision ↗</a>}</section>}
    <div className="admin-layout"><aside className="admin-library" aria-label="Content library">
      <label htmlFor="admin-collection">Collection</label><select id="admin-collection" disabled={blocked} value={collection} onChange={(e) => { if (canLeave()) { setCollection(e.target.value); setEntry(null); setDirty(false); setQuery(''); setPreview(''); } }}>{Object.entries(collections).map(([key, spec]) => <option key={key} value={key}>{spec.label}</option>)}</select>
      <label className="visually-hidden" htmlFor="admin-search">Search entries</label><input id="admin-search" type="search" placeholder="Search entries…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="admin-library-actions"><span>{shown.length} entries</span><button disabled={blocked} onClick={newEntry}>+ Add new</button></div>
      <ul className="admin-entry-list">{shown.map((item) => <li key={item.slug}><button disabled={blocked} aria-current={entry?.slug === item.slug && entry.collection === collection ? 'true' : undefined} onClick={() => open(item)}><span>{item.title}</span>{(item.hasDraft || item.unpublished) && <small>{item.hasDraft ? 'Saved draft' : 'Unpublished'}</small>}</button></li>)}</ul>
      {!shown.length && !busy && <p className="admin-muted">No entries match this search.</p>}
      <button disabled={blocked} className="admin-refresh" onClick={() => void act('Refreshing…', reload)}>Refresh library</button>
    </aside><section className="admin-work" aria-label="Content editor">
      {!entry ? <div className="admin-empty"><span aria-hidden="true">✎</span><h2>Every good lesson starts somewhere.</h2><p>Choose an entry to edit, or add a new one. Your changes are saved as a draft before they reach the website.</p></div> : <>
        <div className="admin-editor-heading"><div><p className="eyebrow">{collections[entry.collection].singular}</p><h2>{title}</h2></div><span className="admin-status">{dirty ? 'Editing' : entry.hasDraft ? 'Draft' : 'Published'}</span></div>
        {entry.changedUpstream && <p className="admin-error">The published entry has changed since this draft began. Copy your changes, discard this draft, and reload the current entry before publishing.</p>}
        <fieldset disabled={blocked} className="admin-editor-fields">
          <label className="admin-field wide">{entry.collection === 'snapshots' ? 'Year filename (e.g. 1789 or -500)' : 'URL name'}<input value={entry.slug} readOnly={entry.revision !== null || entry.draftVersion !== null} placeholder={entry.collection === 'snapshots' ? '1789' : 'lowercase-words-with-hyphens'} onChange={(e) => { setEntry({ ...entry, slug: e.target.value }); setDirty(true); }} /><small>The name stays fixed after saving, so existing links keep working.</small></label>
          {collections[entry.collection].fields.map(input)}
        </fieldset>
        <div className="admin-body-heading"><h3>Page text</h3><span>Markdown{['topics', 'guides'].includes(entry.collection) ? ' + study-note components' : ''}</span></div>
        <div className="admin-toolbar" aria-label="Insert formatting">{Object.entries(snippets).filter(([label]) => ['topics', 'guides'].includes(entry.collection) || ['Heading', 'Bold', 'List'].includes(label)).map(([label, snippet]) => <button disabled={blocked} key={label} onClick={() => { const textarea = bodyRef.current!; const start = textarea.selectionStart; const end = textarea.selectionEnd; setEntry({ ...entry, body: entry.body.slice(0, start) + snippet + entry.body.slice(end) }); setDirty(true); setPreview(''); requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start, start + snippet.length); }); }}>{label}</button>)}</div>
        <label className="visually-hidden" htmlFor="admin-body">Page text</label><textarea className="admin-body" id="admin-body" ref={bodyRef} disabled={blocked} spellCheck value={entry.body} onChange={(e) => { setEntry({ ...entry, body: e.target.value }); setDirty(true); setPreview(''); }} />
        <details className="admin-writing-help"><summary>Writing and publishing guidance</summary><p>Use ## for section headings, **bold**, and - for lists. Insert study components with the buttons, then replace their sample words. Key-term IDs match glossary URL names.</p><p>Quotations must be verbatim and attributed. Name real works when discussing historians. Keep sample profiles labelled until their details are confirmed.</p><p>Save draft keeps a private working copy. Publish validates the entry and builds the site before sharing it. “Keep unpublished” keeps a note or news post out of the student site even after it is committed.</p></details>
        <div className="admin-actions"><button className="btn btn--primary" disabled={blocked || !entry.slug} onClick={() => void act('Saving draft…', async () => { await save(); setNotice('Draft saved. The live site is unchanged.'); })}>Save draft</button><button disabled={blocked || !entry.slug} onClick={() => void act('Preparing preview…', async () => { const result = await api('preview', entry); setPreview(previewDocument(title, result.html, getComputedStyle(document.documentElement).colorScheme === 'dark')); })}>Preview</button><button className="admin-publish" disabled={blocked || !entry.slug} onClick={() => void act('Preparing to publish…', async () => { const saved = dirty || !entry.draftVersion ? await save() : entry; setJob(await api('publish', { collection: saved.collection, slug: saved.slug, draftVersion: saved.draftVersion })); })}>Publish changes ↗</button>
          {entry.hasDraft && <button className="admin-discard" disabled={blocked} onClick={() => { if (window.confirm('Discard this saved draft and any unsaved changes? The published entry will stay as it is.')) void act('Discarding draft…', async () => { await api('discard', entry); setEntry(null); setDirty(false); setPreview(''); await reload(); setNotice('Draft discarded.'); }); }}>Discard draft</button>}
        </div>
        {preview && <section className="admin-preview"><h3>Reading preview</h3><p className="admin-muted">Check your text and interactive study components. The published page uses the site’s full layout.</p><iframe title="Content preview" sandbox="" srcDoc={preview} /></section>}
      </>}
    </section></div>
  </div>;
}

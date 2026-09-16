// Client Notion. Gira solo nel service worker: da lì host_permissions bypassa
// il CORS, che da una pagina bloccherebbe ogni chiamata.

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28'; // la 2025-09-03 sposta le query sui data source

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ponytail: coda seriale a ~3 req/s, il limite documentato di Notion. Se il
// sync diventa lento su corsi grandi, serve un token bucket con parallelismo.
let chain = Promise.resolve();

export function call(token, path, opts = {}) {
  const run = () => sleep(350).then(() => request(token, path, opts));
  chain = chain.then(run, run);
  return chain;
}

async function request(token, path, { method = 'GET', body } = {}) {
  const form = body instanceof FormData;
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': VERSION,
      ...(form ? {} : { 'Content-Type': 'application/json' }), // FormData: boundary automatico
    },
    body: form ? body : body && JSON.stringify(body),
  });
  if (res.status === 429) {
    await sleep((Number(res.headers.get('retry-after')) || 1) * 1000);
    return request(token, path, { method, body });
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`Notion ${res.status}: ${json.message ?? ''}`);
  return json;
}

const SCHEMA = {
  Nome: { title: {} },
  Corso: { select: {} },
  Sezione: { rich_text: {} },
  'N. sezione': { number: {} },
  Tipo: { select: {} },
  Virtuale: { url: {} },
  cmid: { rich_text: {} },
  Revisione: { rich_text: {} },
  File: { files: {} },
  // status non è creabile via API, quindi select
  Stato: {
    select: { options: [{ name: 'Da vedere' }, { name: 'In corso' }, { name: 'Fatto' }] },
  },
};

export async function createDatabase(token, parentPageId, title) {
  return call(token, '/databases', {
    method: 'POST',
    body: {
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: title } }],
      properties: SCHEMA,
    },
  });
}

const plain = (p) => (p?.rich_text ?? []).map((t) => t.plain_text).join('');

/** Mappa cmid → riga esistente, per deduplicare. */
export async function rowsByCmid(token, dbId) {
  const map = new Map();
  let cursor;
  do {
    const page = await call(token, `/databases/${dbId}/query`, {
      method: 'POST',
      body: { page_size: 100, start_cursor: cursor },
    });
    for (const row of page.results) {
      const cmid = plain(row.properties.cmid);
      if (cmid) {
        map.set(cmid, {
          id: row.id,
          rev: plain(row.properties.Revisione),
          hasFile: (row.properties.File?.files ?? []).length > 0,
        });
      }
    }
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return map;
}

const EXT_KIND = { pdf: 'pdf', ppt: 'slide', pptx: 'slide', doc: 'doc', docx: 'doc', zip: 'zip' };

export function kind(module, filename) {
  const ext = filename?.split('.').pop()?.toLowerCase();
  return EXT_KIND[ext] ?? module ?? 'altro';
}

export function props({ name, section, sectionNumber, module, url, cmid, course, rev, filename }) {
  const txt = (v) => [{ type: 'text', text: { content: String(v ?? '').slice(0, 2000) } }];
  // le opzioni select non possono contenere virgole
  const opt = (v) => (v ? { name: String(v).replace(/,/g, ' ').slice(0, 100) } : null);
  return {
    Nome: { title: txt(name) },
    Corso: { select: opt(course) },
    Sezione: { rich_text: txt(section) },
    'N. sezione': { number: sectionNumber ?? null },
    Tipo: { select: opt(kind(module, filename)) },
    Virtuale: { url },
    cmid: { rich_text: txt(cmid) },
    Revisione: { rich_text: txt(rev) },
  };
}

export const createRow = (token, dbId, properties) =>
  call(token, '/pages', { method: 'POST', body: { parent: { database_id: dbId }, properties } });

export const updateRow = (token, pageId, properties) =>
  call(token, `/pages/${pageId}`, { method: 'PATCH', body: { properties } });

/** Scarica il file da Virtuale e lo allega alla riga. false se supera il limite. */
export async function attach(token, pageId, file, maxBytes) {
  if (file.size && file.size > maxBytes) return false;
  const blob = await (await fetch(file.url, { credentials: 'include' })).blob();
  if (blob.size > maxBytes) return false;

  const upload = await call(token, '/file_uploads', {
    method: 'POST',
    body: { filename: file.filename, content_type: blob.type || 'application/octet-stream' },
  });

  const form = new FormData();
  form.append('file', blob, file.filename);
  await call(token, `/file_uploads/${upload.id}/send`, { method: 'POST', body: form });

  await updateRow(token, pageId, {
    File: {
      files: [{ type: 'file_upload', file_upload: { id: upload.id }, name: file.filename }],
    },
  });
  return true;
}

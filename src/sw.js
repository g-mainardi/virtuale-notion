import * as moodle from './moodle.js';
import * as notion from './notion.js';

// Sostituisci con l'URL del tuo Cloudflare Worker (vedi worker/README nel PLAN).
const WORKER = 'https://virtuale-notion.<tuo-subdomain>.workers.dev';

const DEFAULT_MAX_MB = 5; // limite per file dei workspace Notion Free

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const handlers = {
    status: () => chrome.storage.local.get(['ws', 'dbId', 'maxMb']),
    login: () => login(),
    useToken: () => saveToken(msg.token),
    setup: () => setup(msg.pageUrl, msg.title),
    settings: () => chrome.storage.local.set({ maxMb: msg.maxMb }),
    sync: () => sync(msg.courseid, msg.courseName, progressTo(sender.tab?.id)),
  };
  const handler = handlers[msg.type];
  if (!handler) return;
  handler()
    .then((data) => reply({ ok: true, ...data }))
    .catch((e) => reply({ ok: false, error: e.message }));
  return true; // risposta asincrona
});

const progressTo = (tabId) => (text, done = false) => {
  if (tabId) chrome.tabs.sendMessage(tabId, { type: 'progress', text, done }).catch(() => {});
};

async function login() {
  const state = crypto.randomUUID();
  const redirect = await chrome.identity.launchWebAuthFlow({
    url: `${WORKER}/start?state=${state}`,
    interactive: true,
  });
  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  if (params.get('state') !== state) throw new Error('state OAuth non corrispondente');
  const token = params.get('token');
  if (!token) throw new Error(params.get('error') ?? 'nessun token ricevuto');
  const ws = params.get('ws') ?? 'Notion';
  await chrome.storage.local.set({ token, ws });
  return { ws };
}

async function saveToken(token) {
  if (!token) throw new Error('token vuoto');
  await chrome.storage.local.set({ token, ws: 'integrazione interna' });
  return { ws: 'integrazione interna' };
}

/** Gli ID Notion sono gli ultimi 32 esadecimali dell'URL della pagina. */
function pageIdFrom(url) {
  const id = String(url).match(/([0-9a-f]{32})(?:\?|#|$)/i)?.[1];
  if (!id) throw new Error('URL Notion non valido: incolla il link di una pagina');
  return id;
}

async function setup(pageUrl, title) {
  const { token } = await chrome.storage.local.get('token');
  if (!token) throw new Error('Collega prima Notion');
  const db = await notion.createDatabase(token, pageIdFrom(pageUrl), title || 'Virtuale');
  await chrome.storage.local.set({ dbId: db.id, dbUrl: db.url });
  return { dbId: db.id, dbUrl: db.url };
}

async function sync(courseid, courseName, progress) {
  const { token, dbId, maxMb = DEFAULT_MAX_MB } = await chrome.storage.local.get([
    'token',
    'dbId',
    'maxMb',
  ]);
  if (!token) throw new Error('Collega Notion dal popup');
  if (!dbId) throw new Error('Crea il database dal popup');
  const maxBytes = maxMb * 1024 * 1024;

  progress('Leggo Virtuale…');
  const { items } = await moodle.courseTree(courseid);
  const files = await moodle.mapPool(items, 4, (item) =>
    item.module === 'resource' ? moodle.resolveFile(item.cmid).catch(() => null) : null,
  );

  progress('Leggo Notion…');
  const existing = await notion.rowsByCmid(token, dbId);

  const stats = { creati: 0, aggiornati: 0, invariati: 0, allegati: 0, troppoGrandi: 0 };
  for (const [i, item] of items.entries()) {
    const file = files[i];
    const rev = file ? `${file.rev}|${file.modified}` : '-';
    const row = existing.get(item.cmid);
    progress(`${i + 1}/${items.length} · ${item.name.slice(0, 32)}`);

    if (row && row.rev === rev && (!file || row.hasFile)) {
      stats.invariati++;
      continue;
    }

    const properties = notion.props({ ...item, course: courseName, rev, filename: file?.filename });
    let pageId;
    if (row) {
      await notion.updateRow(token, row.id, properties);
      pageId = row.id;
      stats.aggiornati++;
    } else {
      pageId = (await notion.createRow(token, dbId, properties)).id;
      stats.creati++;
    }

    if (file) {
      // un allegato fallito non deve fermare il sync: il link a Virtuale resta
      const done = await notion.attach(token, pageId, file, maxBytes).catch(() => false);
      done ? stats.allegati++ : stats.troppoGrandi++;
    }
  }

  const summary = `${stats.creati} nuovi · ${stats.aggiornati} aggiornati · ${stats.invariati} invariati`;
  progress(summary, true);
  return { stats, summary };
}

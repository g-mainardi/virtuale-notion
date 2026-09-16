// Accesso a Virtuale (Moodle 4.5). Le fetch partono dal service worker, che con
// host_permissions manda da solo il cookie MoodleSession: nessuna gestione
// manuale delle credenziali.

const ROOT = 'https://virtuale.unibo.it';

let cachedSesskey = null;

/** Il sesskey sta in M.cfg di qualsiasi pagina Moodle. */
export async function sesskey(force = false) {
  if (cachedSesskey && !force) return cachedSesskey;
  const html = await (await fetch(`${ROOT}/my/`, { credentials: 'include' })).text();
  const m = html.match(/"sesskey":"(\w+)"/);
  if (!m) throw new Error('Sessione Virtuale non trovata: fai login su virtuale.unibo.it');
  return (cachedSesskey = m[1]);
}

async function ajax(methodname, args) {
  const post = async (key) => {
    const res = await fetch(`${ROOT}/lib/ajax/service.php?sesskey=${key}&info=${methodname}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ index: 0, methodname, args }]),
    });
    if (!res.ok) throw new Error(`Virtuale ha risposto ${res.status}`);
    return (await res.json())[0];
  };

  let out = await post(await sesskey());
  if (out.error) out = await post(await sesskey(true)); // sesskey scaduto: un solo retry
  if (out.error) throw new Error(out.exception?.message ?? `errore su ${methodname}`);
  return out.data;
}

export async function courses() {
  const d = await ajax('core_course_get_enrolled_courses_by_timeline_classification', {
    offset: 0,
    limit: 0,
    classification: 'all',
    sort: 'fullname',
  });
  return d.courses.map((c) => ({ id: c.id, name: c.fullname }));
}

/** Normalizza lo state del courseformat in una lista piatta di moduli. */
export function parseState(state) {
  const sections = new Map(state.section.map((s) => [String(s.id), s]));
  const items = state.cm
    .filter((cm) => cm.uservisible && cm.visible)
    .map((cm) => ({
      cmid: String(cm.id),
      name: cm.name,
      module: cm.module,
      url: cm.url,
      sectionNumber: cm.sectionnumber,
      section: sections.get(String(cm.sectionid))?.title ?? '',
    }))
    .sort((a, b) => a.sectionNumber - b.sectionNumber);
  return { statekey: state.course.statekey, items };
}

export async function courseTree(courseid) {
  return parseState(JSON.parse(await ajax('core_courseformat_get_state', { courseid })));
}

/**
 * mod_resource risponde 303 verso pluginfile.php. `redirect: 'manual'` darebbe
 * una risposta opaca senza header, quindi si segue il redirect e si legge
 * response.url.
 */
export async function resolveFile(cmid) {
  const res = await fetch(`${ROOT}/mod/resource/view.php?id=${cmid}&redirect=1`, {
    method: 'HEAD',
    credentials: 'include',
  });
  if (!res.ok || !res.url.includes('/pluginfile.php/')) return null;
  return {
    url: res.url,
    filename: decodeURIComponent(res.url.split('/').pop()),
    rev: res.url.match(/\/content\/(\d+)\//)?.[1] ?? '0',
    size: Number(res.headers.get('content-length')) || 0, // assente su alcune risposte
    modified: res.headers.get('last-modified') ?? '',
  };
}

/** Esegue fn su items con al massimo n richieste in volo. */
export async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseState, mapPool } from '../src/moodle.js';
import { kind, props } from '../src/notion.js';

// forma reale restituita da core_courseformat_get_state (Moodle 4.5)
const state = {
  course: { id: '71033', statekey: '1789505941_1789551442' },
  section: [
    { id: '729350', number: 0, title: 'Introduzione' },
    { id: '729351', number: 1, title: '1 - Introduzione al Corso' },
  ],
  cm: [
    {
      id: '2257195',
      name: 'Slide lezione 1',
      sectionid: '729351',
      sectionnumber: 1,
      module: 'resource',
      url: 'https://virtuale.unibo.it/mod/resource/view.php?id=2257195',
      uservisible: true,
      visible: true,
    },
    {
      id: '1989110',
      name: 'Avvisi',
      sectionid: '729350',
      sectionnumber: 0,
      module: 'forum',
      url: 'https://virtuale.unibo.it/mod/forum/view.php?id=1989110',
      uservisible: true,
      visible: true,
    },
    {
      id: '999',
      name: 'Bozza nascosta',
      sectionid: '729351',
      sectionnumber: 1,
      module: 'resource',
      url: 'x',
      uservisible: false,
      visible: false,
    },
  ],
};

test('parseState: ordina per sezione, scarta i moduli non visibili', () => {
  const { items, statekey } = parseState(state);
  assert.equal(statekey, '1789505941_1789551442');
  assert.deepEqual(
    items.map((i) => i.cmid),
    ['1989110', '2257195'],
  );
  assert.equal(items[1].section, '1 - Introduzione al Corso');
  assert.equal(items[1].module, 'resource');
});

test('kind: estensione del file, altrimenti il modulo Moodle', () => {
  assert.equal(kind('resource', 'lezione 1.pdf'), 'pdf');
  assert.equal(kind('resource', 'LEZIONE.PPTX'), 'slide');
  assert.equal(kind('forum', undefined), 'forum');
});

test('props: cmid come chiave di dedup, virgole fuori dai select', () => {
  const p = props({
    name: 'Slide',
    section: 'S1',
    sectionNumber: 1,
    module: 'resource',
    url: 'https://x',
    cmid: '2257195',
    course: 'Project, Management',
    rev: '1|Wed, 04 Feb 2026 20:55:25 GMT',
    filename: 'a.pdf',
  });
  assert.equal(p.cmid.rich_text[0].text.content, '2257195');
  assert.equal(p.Corso.select.name, 'Project  Management');
  assert.equal(p.Tipo.select.name, 'pdf');
  assert.equal(p['N. sezione'].number, 1);
});

test('mapPool: preserva l’ordine con concorrenza limitata', async () => {
  const out = await mapPool([3, 1, 2], 2, async (n) => {
    await new Promise((r) => setTimeout(r, n * 10));
    return n * 2;
  });
  assert.deepEqual(out, [6, 2, 4]);
});

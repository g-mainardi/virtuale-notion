const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function say(text, isError = false) {
  $('msg').textContent = text;
  $('msg').className = isError ? 'err' : '';
}

async function run(msg, onOk) {
  say('…');
  const res = await send(msg);
  res?.ok ? (say(''), onOk?.(res)) : say(res?.error ?? 'errore', true);
  return res;
}

async function refresh() {
  const { ws, dbId, dbUrl, maxMb = 5 } = await send({ type: 'status' });
  $('account').textContent = ws ? `collegato a ${ws}` : 'non collegato';
  $('db').textContent = dbId ? `database pronto${dbUrl ? '' : ''}` : 'nessun database';
  $('max').value = maxMb;
}

$('login').onclick = () => run({ type: 'login' }, refresh);

$('token').onchange = (e) => run({ type: 'useToken', token: e.target.value.trim() }, refresh);

$('create').onclick = () =>
  run({ type: 'setup', pageUrl: $('page').value.trim(), title: 'Virtuale' }, refresh);

$('max').onchange = (e) => send({ type: 'settings', maxMb: Number(e.target.value) });

refresh();

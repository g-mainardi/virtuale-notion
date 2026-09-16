// Bottone di sync sulla pagina del corso. Nessuna chiamata di rete qui: il
// service worker fa tutto (CORS di Notion).

const courseid = Number(new URL(location.href).searchParams.get('id'));
const IDLE = 'Sync su Notion';

if (courseid) {
  const btn = document.createElement('button');
  btn.textContent = IDLE;
  btn.className = 'btn btn-secondary ms-2';
  btn.style.verticalAlign = 'middle';

  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = 'Avvio…';
    const courseName = document.title.replace(/^Corso:\s*/, '').replace(/\s*\|.*$/, '');
    chrome.runtime.sendMessage({ type: 'sync', courseid, courseName }, (res) => {
      if (!res?.ok) reset(`Errore: ${res?.error ?? 'nessuna risposta'}`);
    });
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== 'progress') return;
    msg.done ? reset(msg.text) : (btn.textContent = msg.text);
  });

  const reset = (text) => {
    btn.textContent = text;
    btn.disabled = false;
    setTimeout(() => (btn.textContent = IDLE), 8000);
  };

  const host =
    document.querySelector('.page-context-header') ??
    document.querySelector('.page-header-headings') ??
    document.body;
  host.append(btn);
}

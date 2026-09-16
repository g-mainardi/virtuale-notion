# Virtuale → Notion — piano MVP

Estensione Chrome che replica un corso di [Virtuale](https://virtuale.unibo.it)
(Moodle 4.5, UniBo) dentro un database Notion: una riga per documento, con file
allegato e sync incrementale.

## Ricognizione (verificata sul campo, 2026-09-16)

Su `https://virtuale.unibo.it/course/view.php?id=71033`:

| Cosa | Esito |
|---|---|
| `core_course_get_contents` via `/lib/ajax/service.php` | ❌ `servicenotavailable` |
| `core_courseformat_get_state` | ✅ albero completo del corso |
| `core_course_get_enrolled_courses_by_timeline_classification` | ✅ elenco corsi iscritti |
| `/login/token.php` (token app mobile) | ⚠️ risponde, ma il login è SSO Shibboleth → inutile |

`core_courseformat_get_state` restituisce in una sola chiamata:

```json
{"course":{"id":"71033","numsections":13,"statekey":"1789505941_1789551442"},
 "section":[{"id":"729351","number":1,"title":"1 - Introduzione al Corso","cmlist":["2257195"]}],
 "cm":[{"id":"2257195","name":"1 - Introduzione al Corso - Ver.2.8","sectionid":"729351",
        "sectionnumber":1,"module":"resource","plugin":"mod_resource","uservisible":true,
        "url":"https://virtuale.unibo.it/mod/resource/view.php?id=2257195"}]}
```

Niente scraping HTML per l'indice. Serve solo il `sesskey`, che si estrae con
una regex su `M.cfg` di qualsiasi pagina Moodle.

**Risoluzione del file**: `mod/resource/view.php?id=<cmid>&redirect=1` risponde
`303` verso `pluginfile.php/<ctx>/mod_resource/content/<rev>/<nome>.pdf`, con
`Last-Modified` e `Content-Type` sulla risposta finale. In `fetch` non si può
usare `redirect: "manual"` (risposta opaca, header illeggibili): si segue il
redirect con `HEAD` e si legge `response.url`.

`<rev>` è la revisione del file, incrementata quando il docente ricarica.
`rev + Last-Modified` è la chiave del sync incrementale.

**Cookie**: mai gestito a mano. Con `host_permissions` su `virtuale.unibo.it` le
fetch dal service worker mandano `MoodleSession` da sole. In sviluppo locale,
`chrome.cookies.get({url, name: "MoodleSession"})`; il permesso `cookies` non va
chiesto in produzione, allunga solo la review dello store.

## Architettura

```
content.js   bottone "Sync su Notion" su /course/view.php
sw.js        orchestrazione: nessun traffico di rete altrove
moodle.js    ajax Moodle + risoluzione file
notion.js    client API, coda con rate limit
popup        login Notion, creazione database, impostazioni
worker/      Cloudflare Worker: custodisce il client_secret OAuth
```

Tutto il traffico verso `api.notion.com` **deve** stare nel service worker: da
lì `host_permissions` bypassa il CORS, mentre da una pagina o da un content
script Notion rifiuta le richieste.

## Schema del database

| Proprietà | Tipo | Note |
|---|---|---|
| Nome | title | nome del modulo Moodle |
| Corso | select | |
| Sezione | rich_text | |
| N. sezione | number | ordinamento |
| Tipo | select | pdf / slide / doc / link / forum … |
| Virtuale | url | `view.php?id=<cmid>` |
| cmid | rich_text | **chiave di dedup** |
| Revisione | rich_text | `<rev>\|<Last-Modified>` |
| File | files | PDF allegato |
| Stato | select | Da vedere / In corso / Fatto |

`Stato` è un `select` e non uno `status`: l'API Notion non sa creare proprietà
di tipo status.

## OAuth

Il Worker esiste solo per custodire il `client_secret`. Nessun dato utente ci
transita, nessuno storage.

```
estensione   chrome.identity.launchWebAuthFlow(WORKER/start?state=<nonce>)
Notion       consenso → redirect_uri = WORKER/callback (fisso, registrato)
worker       POST /v1/oauth/token con Basic(id:secret)
             → 302 su https://<ext-id>.chromiumapp.org/notion#token=…
estensione   verifica lo state, salva in chrome.storage.local
```

L'**extension ID deve essere stabile** prima di registrare l'integrazione:
serve `key` nel manifest o una pubblicazione unlisted, altrimenti in sviluppo
l'ID cambia e il redirect URI non combacia più.

Fallback sempre disponibile: incollare nel popup il token di un'integrazione
interna. Sblocca lo sviluppo durante la review dell'app Notion.

## Limiti noti

- **5 MB per file** sui workspace Notion Free. Sopra soglia si salta l'allegato
  e resta il link a Virtuale. Da verificare se il piano Education con la mail
  `@studio.unibo.it` alza la soglia.
- Rate limit Notion ~3 req/s: coda seriale con retry su 429.
- `Notion-Version: 2022-06-28`. La 2025-09-03 sposta le query sui data source;
  migrazione rimandata, non serve per l'MVP.

## Fuori scope

Conversione PDF → blocchi Notion, sync automatico in background, altri atenei
Moodle, compiti e quiz, Firefox.

## Pubblicazione

Nome e icone senza riferimenti a UniBo, disclaimer "non affiliato
all'Università di Bologna", privacy policy di una pagina (nessun dato lascia il
browser se non verso Notion). La review del Chrome Web Store è il rischio di
schedule più alto: pubblicare presto una versione unlisted.

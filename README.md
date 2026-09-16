# Virtuale → Notion

Estensione Chrome che replica i documenti di un corso
[Virtuale](https://virtuale.unibo.it) in un database Notion: una riga per
documento, PDF allegato, sync incrementale.

> Progetto indipendente, **non affiliato all'Università di Bologna**.

## Come funziona

Virtuale è Moodle 4.5, quindi niente scraping HTML: una chiamata a
`core_courseformat_get_state` restituisce l'albero completo del corso (sezioni,
moduli, URL). Il file vero si ottiene seguendo il `303` di
`mod/resource/view.php?id=<cmid>&redirect=1` fino a `pluginfile.php`.

La sessione Moodle non viene mai gestita a mano: con `host_permissions` il
service worker manda il cookie da solo.

Dettagli di progetto e vincoli: [PLAN.md](PLAN.md).

## Installazione (sviluppo)

1. `chrome://extensions` → Modalità sviluppatore → Carica estensione non pacchettizzata → questa cartella.
2. Apri il popup e incolla il token di un'[integrazione interna Notion](https://www.notion.so/my-integrations)
   (per l'OAuth pubblico vedi sotto). Condividi con l'integrazione la pagina che
   farà da contenitore.
3. Incolla l'URL di quella pagina e premi **Crea database**.
4. Vai su una pagina corso di Virtuale e premi **Sync su Notion**.

## OAuth pubblico

Il `client_secret` non può stare in un'estensione, quindi lo custodisce un
Cloudflare Worker:

```bash
cd worker
npx wrangler deploy
npx wrangler secret put NOTION_CLIENT_SECRET
```

Poi compila `NOTION_CLIENT_ID`, `REDIRECT_URI` ed `EXT_REDIRECT` in
`wrangler.toml`, e l'URL del worker in `src/sw.js`.

L'extension ID deve essere **stabile** prima di registrare il redirect URI su
Notion: aggiungi `key` al manifest o pubblica una versione unlisted, altrimenti
in sviluppo l'ID cambia a ogni ricaricamento e l'OAuth si rompe.

## Test

```bash
npm test
```

## Limiti noti

- **5 MB per file** sui workspace Notion Free: sopra soglia l'allegato viene
  saltato e resta il link a Virtuale (soglia regolabile nel popup).
- Solo risorse `mod_resource`. Compiti, quiz e cartelle non sono gestiti.
- Niente conversione PDF → blocchi Notion: il PDF viene allegato così com'è.

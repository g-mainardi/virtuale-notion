// Custodisce il client_secret OAuth di Notion, che non può stare dentro
// un'estensione. Nessuno storage, nessun dato utente conservato.
//
// Variabili: NOTION_CLIENT_ID, NOTION_CLIENT_SECRET (secret), REDIRECT_URI
// (questo worker, /callback), EXT_REDIRECT (https://<ext-id>.chromiumapp.org/notion)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const state = url.searchParams.get('state') ?? '';

    if (url.pathname === '/start') {
      const auth = new URL('https://api.notion.com/v1/oauth/authorize');
      auth.search = new URLSearchParams({
        client_id: env.NOTION_CLIENT_ID,
        redirect_uri: env.REDIRECT_URI,
        response_type: 'code',
        owner: 'user',
        state,
      });
      return Response.redirect(auth.toString(), 302);
    }

    if (url.pathname === '/callback') {
      const back = (params) =>
        Response.redirect(`${env.EXT_REDIRECT}#${new URLSearchParams({ ...params, state })}`, 302);

      const code = url.searchParams.get('code');
      if (!code) return back({ error: url.searchParams.get('error') ?? 'consenso negato' });

      const res = await fetch('https://api.notion.com/v1/oauth/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          redirect_uri: env.REDIRECT_URI,
        }),
      });
      const data = await res.json();
      if (!res.ok) return back({ error: data.error ?? `token ${res.status}` });

      // ponytail: il token viaggia nel fragment, quindi non finisce nei log del
      // server ma resta visibile nella URL. Se serve di più: restituire un code
      // monouso con TTL 60s che l'estensione scambia via POST.
      return back({ token: data.access_token, ws: data.workspace_name ?? '' });
    }

    return new Response('virtuale-notion oauth worker', { status: 200 });
  },
};

/**
 * FONTPLUS Font Checker - Cloudflare Worker
 * URLを受け取り、FONTPLUSフォントの使用状況を返すAPI
 *
 * デプロイ: Cloudflare Dashboard → Workers → Create → このコードを貼り付け
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'POST only' }, 405);
    }

    try {
      const { urls } = await request.json();
      if (!Array.isArray(urls) || urls.length === 0) {
        return jsonResponse({ error: 'urls array required' }, 400);
      }

      // Limit to 50 URLs per request
      const limitedUrls = urls.slice(0, 50);
      const results = await Promise.all(limitedUrls.map(checkUrl));
      return jsonResponse({ results });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }
};

async function checkUrl(url) {
  url = url.trim();
  if (!url.startsWith('http')) url = 'https://' + url;

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FontChecker/1.0)' },
      redirect: 'follow',
    });
    const html = await resp.text();

    // Extract page title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;

    // Find FONTPLUS CSS links
    const fpCodes = [...html.matchAll(/https:\/\/fonts\.fontplus\.dev\/v1\/css\/([a-zA-Z0-9]+)/g)]
      .map(m => m[1]);

    if (fpCodes.length === 0) {
      return { url, title, hasFontPlus: false, fontplusFonts: [] };
    }

    // Fetch FONTPLUS CSS and extract font names + weights
    const fontplusFonts = [];
    for (const code of [...new Set(fpCodes)]) {
      try {
        const fpResp = await fetch(`https://fonts.fontplus.dev/v1/css/${code}`, {
          headers: { 'Referer': url, 'Origin': new URL(url).origin },
        });
        const css = await fpResp.text();

        const fontWeights = {};
        for (const match of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
          const body = match[1];
          const ff = body.match(/font-family\s*:\s*['"]([^'"]+)/);
          const fw = body.match(/font-weight\s*:\s*(\d+)/);
          if (ff) {
            const name = ff[1];
            const weight = fw ? parseInt(fw[1]) : 400;
            if (!fontWeights[name]) fontWeights[name] = new Set();
            fontWeights[name].add(weight);
          }
        }

        for (const [name, weights] of Object.entries(fontWeights)) {
          fontplusFonts.push({
            name,
            weights: [...weights].sort((a, b) => a - b),
          });
        }
      } catch (e) {
        // Skip if FONTPLUS CSS fails
      }
    }

    return { url, title, hasFontPlus: fontplusFonts.length > 0, fontplusFonts };
  } catch (e) {
    return { url, title: url, error: e.message, hasFontPlus: false, fontplusFonts: [] };
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

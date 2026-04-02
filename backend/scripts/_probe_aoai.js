require('dotenv').config();

const endpoint = String(process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
const key = process.env.AZURE_OPENAI_KEY;

const versions = ['2024-02-15-preview', '2024-06-01', '2024-10-21', '2025-04-14'];
const models = ['we-gpt-4o-mini', 'we-gpt-4.1', 'we-gpt-4o'];

function payload() {
  return JSON.stringify({
    messages: [
      { role: 'system', content: 'Return JSON only.' },
      { role: 'user', content: '{"ok":true}' },
    ],
    temperature: 0,
    max_tokens: 20,
    response_format: { type: 'json_object' },
  });
}

async function main() {
  for (const m of models) {
    for (const v of versions) {
      const url = `${endpoint}/openai/deployments/${m}/chat/completions?api-version=${v}`;
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'api-key': key,
          },
          body: payload(),
        });
        const t = await r.text();
        console.log(JSON.stringify({ model: m, api: v, status: r.status, body: t.slice(0, 160) }));
      } catch (e) {
        console.log(JSON.stringify({ model: m, api: v, error: e.message }));
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

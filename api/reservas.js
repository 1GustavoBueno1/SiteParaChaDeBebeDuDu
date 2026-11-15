const { put, list, head } = require('@vercel/blob');
const categorias = require('./_presentes.json');

const PREFIXO = 'reservas/';
const itensPorId = new Map();
for (const c of categorias) for (const i of c.itens) itensPorId.set(i.id, i);

async function lerReservas() {
  const blobs = [];
  let cursor;
  do {
    const r = await list({ prefix: PREFIXO, limit: 1000, cursor });
    blobs.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);

  const reservas = {};
  await Promise.all(
    blobs.map(async (b) => {
      try {
        const resp = await fetch(b.url, { cache: 'no-store' });
        if (!resp.ok) return;
        const dados = await resp.json();
        if (itensPorId.has(dados.id)) reservas[dados.id] = dados;
      } catch (_) { /* ignora blob ilegível */ }
    })
  );
  return reservas;
}

function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 10000) reject(new Error('grande')); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    if (req.method === 'GET') {
      const reservas = await lerReservas();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).end(JSON.stringify({ categorias, reservas }));
    }

    if (req.method === 'POST') {
      let corpo;
      try { corpo = await lerCorpo(req); } catch (_) {
        return res.status(400).end(JSON.stringify({ erro: 'Pedido inválido.' }));
      }
      const id = String(corpo.id || '');
      const nome = String(corpo.nome || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const forma = corpo.forma === 'pix' ? 'pix' : 'presente';
      const item = itensPorId.get(id);
      if (!item) return res.status(400).end(JSON.stringify({ erro: 'Presente não encontrado.' }));
      if (nome.length < 2) return res.status(400).end(JSON.stringify({ erro: 'Informe seu nome.' }));

      const reserva = { id, item: item.nome, nome, forma, data: new Date().toISOString() };
      try {
        await put(PREFIXO + id + '.json', JSON.stringify(reserva), {
          access: 'public',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
        });
      } catch (e) {
        let existe = /already exists|overwrite/i.test(String(e && e.message));
        if (!existe) { try { await head(PREFIXO + id + '.json'); existe = true; } catch (_) {} }
        if (existe) {
          return res.status(409).end(JSON.stringify({ erro: 'Este presente acabou de ser escolhido por outra pessoa.' }));
        }
        throw e;
      }
      return res.status(201).end(JSON.stringify({ ok: true, reserva }));
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end(JSON.stringify({ erro: 'Método não permitido.' }));
  } catch (e) {
    console.error(e);
    return res.status(500).end(JSON.stringify({ erro: 'Não foi possível concluir agora. Tente novamente em instantes.' }));
  }
};

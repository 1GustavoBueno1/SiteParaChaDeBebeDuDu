const { put, list, head, del } = require('@vercel/blob');
const crypto = require('crypto');

const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
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
        const versao = new Date(b.uploadedAt).getTime() || Date.now();
        const resp = await fetch(b.url + '?v=' + versao, { cache: 'no-store' });
        if (!resp.ok) return;
        const dados = await resp.json();
        // LIMPEZA TEMPORÁRIA: remove a reserva de teste criada durante a verificação do site
        if (dados.id === 'chocalhos' && dados.nome === 'Teste Dois' && dados.data === '2026-11-15T21:16:12.434Z') {
          await del(b.url);
          return;
        }
        if (itensPorId.has(dados.id)) {
          const { tokenHash, ...publico } = dados;
          reservas[dados.id] = publico;
        }
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
      const token = crypto.randomBytes(24).toString('hex');
      try {
        await put(PREFIXO + id + '.json', JSON.stringify({ ...reserva, tokenHash: hash(token) }), {
          access: 'public',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
        });
      } catch (e) {
        let existe = /already exists|overwrite/i.test(String(e && e.message));
        if (!existe) { try { await head(PREFIXO + id + '.json'); existe = true; } catch (_) {} }
        if (existe) {
          return res.status(409).end(JSON.stringify({ erro: 'Este presente acabou de ser escolhido por outra pessoa.' }));
        }
        throw e;
      }
      return res.status(201).end(JSON.stringify({ ok: true, reserva, token }));
    }

    if (req.method === 'DELETE') {
      let corpo;
      try { corpo = await lerCorpo(req); } catch (_) {
        return res.status(400).end(JSON.stringify({ erro: 'Pedido inválido.' }));
      }
      const id = String(corpo.id || '');
      const token = String(corpo.token || '');
      if (!itensPorId.has(id) || !token) return res.status(400).end(JSON.stringify({ erro: 'Pedido inválido.' }));
      let info;
      try { info = await head(PREFIXO + id + '.json'); } catch (_) {
        return res.status(404).end(JSON.stringify({ erro: 'Esta escolha não existe mais.' }));
      }
      const atual = await (await fetch(info.url + '?v=' + Date.now(), { cache: 'no-store' })).json();
      if (!atual.tokenHash || atual.tokenHash !== hash(token)) {
        return res.status(403).end(JSON.stringify({ erro: 'Só quem fez a escolha pode desfazê-la, no mesmo aparelho.' }));
      }
      await del(info.url);
      return res.status(200).end(JSON.stringify({ ok: true }));
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).end(JSON.stringify({ erro: 'Método não permitido.' }));
  } catch (e) {
    console.error(e);
    return res.status(500).end(JSON.stringify({ erro: 'Não foi possível concluir agora. Tente novamente em instantes.' }));
  }
};

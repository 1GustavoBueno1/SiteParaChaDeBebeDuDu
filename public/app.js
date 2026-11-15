(function () {
  'use strict';

  var CFG = window.CONFIG_CHA || {};
  var PIX = CFG.pix || {};
  var ICONES = ['👕', '🛁', '🍼', '🧺', '🚼', '🧸', '💡'];

  var estado = { categorias: [], reservas: {}, filtro: 'todos', busca: '', itemAtual: null };

  var $ = function (id) { return document.getElementById(id); };
  var lista = $('lista'), modal = $('modal'), form = $('form'), sucesso = $('sucesso');

  $('pais').textContent = CFG.pais || '';

  function normalizar(t) {
    return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function lerTokens() {
    try { return JSON.parse(localStorage.getItem('cha-tokens') || '{}') || {}; } catch (_) { return {}; }
  }
  function salvarToken(id, token) {
    var t = lerTokens();
    if (token) t[id] = token; else delete t[id];
    try { localStorage.setItem('cha-tokens', JSON.stringify(t)); } catch (_) {}
  }

  function desfazer(item, botao) {
    var token = lerTokens()[item.id];
    if (!token) return;
    if (!window.confirm('Desfazer sua escolha de "' + item.nome + '"? O item volta a ficar disponível.')) return;
    botao.disabled = true; botao.textContent = 'Desfazendo…';
    fetch('/api/reservas', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, token: token })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { r: r, d: d }; }); })
      .then(function (x) {
        if (x.r.ok || x.r.status === 404) {
          salvarToken(item.id, null);
          delete estado.reservas[item.id];
          render();
          aviso('Escolha desfeita. O item está disponível novamente.');
        } else {
          aviso(x.d.erro || 'Não foi possível desfazer agora.');
          botao.disabled = false; botao.textContent = 'Desfazer minha escolha';
        }
      })
      .catch(function () {
        aviso('Sem conexão. Tente novamente.');
        botao.disabled = false; botao.textContent = 'Desfazer minha escolha';
      });
  }

  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  }

  function aviso(msg) {
    var a = $('aviso');
    a.textContent = msg;
    a.classList.add('visivel');
    clearTimeout(aviso._t);
    aviso._t = setTimeout(function () { a.classList.remove('visivel'); }, 3200);
  }

  function atualizarContador() {
    var total = 0, escolhidos = 0;
    estado.categorias.forEach(function (c) {
      c.itens.forEach(function (i) { total++; if (estado.reservas[i.id]) escolhidos++; });
    });
    $('contador').textContent = escolhidos + ' de ' + total + ' presentes já escolhidos';
    $('barra').style.width = (total ? (escolhidos / total) * 100 : 0) + '%';
  }

  function render() {
    lista.innerHTML = '';
    var termo = normalizar(estado.busca.trim());
    var algum = false;

    estado.categorias.forEach(function (cat, idx) {
      var itens = cat.itens.filter(function (i) {
        var r = estado.reservas[i.id];
        if (estado.filtro === 'disponiveis' && r) return false;
        if (estado.filtro === 'escolhidos' && !r) return false;
        if (termo && normalizar(i.nome).indexOf(termo) === -1) return false;
        return true;
      });
      if (!itens.length) return;
      algum = true;

      var sec = el('section', 'categoria');
      sec.id = 'cat-' + idx;
      var cab = el('header', 'categoria-cab');
      cab.appendChild(el('span', 'categoria-icone', ICONES[idx] || '💙'));
      var h = el('h2', null, cat.nome);
      cab.appendChild(h);
      var livres = cat.itens.filter(function (i) { return !estado.reservas[i.id]; }).length;
      cab.appendChild(el('span', 'categoria-qtd', livres + ' de ' + cat.itens.length + ' disponíveis'));
      sec.appendChild(cab);

      var grade = el('ul', 'grade');
      itens.forEach(function (item) {
        var r = estado.reservas[item.id];
        var li = el('li', 'cartao' + (r ? ' escolhido' : ''));
        li.appendChild(el('p', 'cartao-nome', item.nome));
        if (r) {
          var selo = el('p', 'selo');
          selo.appendChild(el('span', 'selo-icone', r.forma === 'pix' ? '💠' : '🎁'));
          var txt = el('span');
          txt.appendChild(document.createTextNode('Escolhido por '));
          txt.appendChild(el('strong', null, r.nome));
          txt.appendChild(document.createTextNode(r.forma === 'pix' ? ' · via Pix' : ' · presente'));
          selo.appendChild(txt);
          li.appendChild(selo);
          if (lerTokens()[item.id]) {
            var d = el('button', 'desfazer', 'Desfazer minha escolha');
            d.type = 'button';
            d.addEventListener('click', function () { desfazer(item, d); });
            li.appendChild(d);
          }
        } else {
          var b = el('button', 'botao pequeno', 'Escolher este presente');
          b.type = 'button';
          b.addEventListener('click', function () { abrir(item); });
          li.appendChild(b);
        }
        grade.appendChild(li);
      });
      sec.appendChild(grade);
      lista.appendChild(sec);
    });

    if (!algum) {
      lista.appendChild(el('p', 'vazio', estado.categorias.length ? 'Nenhum presente encontrado com esse filtro.' : ''));
    }
    atualizarContador();
  }

  function renderAtalhos() {
    var box = $('atalhos');
    box.innerHTML = '';
    estado.categorias.forEach(function (cat, idx) {
      var a = el('a', 'atalho', (ICONES[idx] || '') + ' ' + cat.nome.split(' – ')[0]);
      a.href = '#cat-' + idx;
      box.appendChild(a);
    });
  }

  function carregar(silencioso) {
    return fetch('/api/reservas', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) {
        var primeira = !estado.categorias.length;
        estado.categorias = d.categorias || [];
        estado.reservas = d.reservas || {};
        if (primeira) renderAtalhos();
        render();
      })
      .catch(function () {
        if (!silencioso) $('contador').textContent = 'Não foi possível carregar a lista. Atualize a página.';
      });
  }

  // ---- Modal ----
  function abrir(item) {
    estado.itemAtual = item;
    $('modal-item').textContent = item.nome;
    $('erro').textContent = '';
    form.classList.remove('oculto');
    sucesso.classList.add('oculto');
    form.querySelector('input[value="presente"]').checked = true;
    try { $('nome').value = localStorage.getItem('cha-nome') || ''; } catch (_) {}
    $('confirmar').disabled = false;
    $('confirmar').textContent = 'Confirmar escolha';
    if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
    setTimeout(function () { $('nome').focus(); }, 50);
  }

  function fechar() {
    if (typeof modal.close === 'function') modal.close(); else modal.removeAttribute('open');
  }

  $('fechar').addEventListener('click', fechar);
  Array.prototype.forEach.call(document.querySelectorAll('[data-fechar]'), function (b) {
    b.addEventListener('click', fechar);
  });
  modal.addEventListener('click', function (e) { if (e.target === modal) fechar(); });

  function mostrarSucesso(nome, forma, item) {
    form.classList.add('oculto');
    sucesso.classList.remove('oculto');
    $('sucesso-nome').textContent = nome.split(' ')[0];
    var pixBloco = $('pix-bloco');
    if (forma === 'pix') {
      $('sucesso-texto').textContent = '"' + item + '" ficou registrado no seu nome como contribuição via Pix.';
      if (PIX.chave) {
        $('pix-tipo-rotulo').textContent = PIX.tipo ? 'Chave (' + PIX.tipo + ')' : 'Chave';
        $('pix-chave').textContent = PIX.chave;
        $('pix-titular').textContent = PIX.titular || '';
        pixBloco.classList.remove('oculto');
      } else {
        pixBloco.classList.add('oculto');
      }
    } else {
      $('sucesso-texto').textContent = '"' + item + '" ficou reservado no seu nome. O Pedro agradece! 💙';
      pixBloco.classList.add('oculto');
    }
  }

  $('copiar').addEventListener('click', function () {
    var chave = PIX.chave || '';
    var ok = function () { aviso('Chave Pix copiada!'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(chave).then(ok, function () { copiarAntigo(chave) && ok(); });
    } else if (copiarAntigo(chave)) { ok(); }
  });

  function copiarAntigo(texto) {
    var t = document.createElement('textarea');
    t.value = texto; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    var r = false; try { r = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(t);
    return r;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var item = estado.itemAtual;
    var nome = $('nome').value.trim().replace(/\s+/g, ' ');
    var forma = form.querySelector('input[name="forma"]:checked').value;
    if (nome.length < 2) { $('erro').textContent = 'Por favor, informe seu nome.'; $('nome').focus(); return; }

    var botao = $('confirmar');
    botao.disabled = true; botao.textContent = 'Salvando…'; $('erro').textContent = '';

    fetch('/api/reservas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, nome: nome, forma: forma })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { r: r, d: d }; }); })
      .then(function (x) {
        if (x.r.ok) {
          try { localStorage.setItem('cha-nome', nome); } catch (_) {}
          estado.reservas[item.id] = x.d.reserva;
          if (x.d.token) salvarToken(item.id, x.d.token);
          render();
          mostrarSucesso(nome, forma, item.nome);
        } else {
          $('erro').textContent = x.d.erro || 'Não foi possível salvar. Tente novamente.';
          botao.disabled = false; botao.textContent = 'Confirmar escolha';
          if (x.r.status === 409) carregar(true);
        }
      })
      .catch(function () {
        $('erro').textContent = 'Sem conexão. Verifique a internet e tente novamente.';
        botao.disabled = false; botao.textContent = 'Confirmar escolha';
      });
  });

  // ---- Filtros ----
  Array.prototype.forEach.call(document.querySelectorAll('.filtro'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.filtro'), function (x) { x.classList.remove('ativo'); });
      b.classList.add('ativo');
      estado.filtro = b.getAttribute('data-filtro');
      render();
    });
  });
  $('busca').addEventListener('input', function (e) { estado.busca = e.target.value; render(); });

  carregar(false);
  // Atualiza a lista periodicamente para mostrar escolhas de outros convidados
  setInterval(function () { if (!document.hidden && !modal.open) carregar(true); }, 30000);
})();

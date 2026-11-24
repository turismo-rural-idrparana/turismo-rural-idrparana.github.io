// URL do web app do Apps Script (Implantar > Nova implantação > App da Web).
const API_URL = 'https://script.google.com/macros/s/AKfycbyJNnCCVhWHW_PxHPbMKDsy-VSVwgJET-47v9Ub1eBkDCETU7k5YWgXqjKwHd04IdXY/exec';

const ROTAS = [
  { nome: 'Rota do Queijo', cor: 'linear-gradient(135deg,#e9c46a,#b4622d)',
    texto: 'Queijarias artesanais e propriedades leiteiras abertas à visitação.' },
  { nome: 'Rota da Uva e do Vinho', cor: 'linear-gradient(135deg,#7b2d43,#3c1a2a)',
    texto: 'Vinícolas, parreirais e colheita nas regiões produtoras do Paraná.' },
  { nome: 'Rota da Erva-Mate', cor: 'linear-gradient(135deg,#6b8f4e,#1f3d2b)',
    texto: 'Ervais nativos, barbaquás e a cultura do chimarrão no sul do estado.' },
];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Number(n || 0).toLocaleString('pt-BR');
const ROTULO = { producao: 'Confirmada', previsto: 'Prevista', cancelado: 'Cancelada' };
let eventos = [];

async function api(params) {
  if (!API_URL) throw new Error('Backend ainda não configurado.');
  const r = await fetch(API_URL + '?' + new URLSearchParams(params));
  const j = await r.json();
  if (!j.ok) throw new Error(j.erro);
  return j.dados;
}

async function postar(corpo) {
  // text/plain evita o preflight CORS, que o Apps Script não responde.
  const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(corpo) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.erro);
  return j.dados;
}

function isoDeBr(s) { const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s).slice(0, 10); }
function km(m) { const n = Number(String(m).replace(',', '.')); if (!n) return ''; return (n > 200 ? n / 1000 : n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km'; }
function vagas(v) { const n = Number(v); return n && n < 99999 ? num(n) : ''; }
function cidade(e) { return String(e.localizacao || '').replace(/ - Brasil$/, ''); }
function abertas(e) {
  const hoje = new Date().toISOString().slice(0, 10);
  return e.status === 'producao' && (!e.evento_data_inicio_inscricoes || e.evento_data_inicio_inscricoes <= hoje)
    && (!e.evento_data_termino_inscricoes || hoje <= e.evento_data_termino_inscricoes);
}

function renderLista() {
  const reg = $('#f-regiao').value, st = $('#f-status').value, q = $('#f-busca').value.trim().toLowerCase();
  const vis = eventos.filter(e => (!reg || e.regiao_idr === reg) && (!st || e.status === st)
    && (!q || (e.nome + ' ' + e.localizacao).toLowerCase().includes(q)))
    .sort((a, b) => isoDeBr(a.data).localeCompare(isoDeBr(b.data)));
  const conf = vis.filter(e => e.status === 'producao');
  $('#kpis').innerHTML = `
    <div class="kpi"><b>${num(conf.length)}</b><span>caminhadas confirmadas</span></div>
    <div class="kpi"><b>${num(conf.reduce((s, e) => s + Number(e.inscritos || 0), 0))}</b><span>inscritos</span></div>
    <div class="kpi"><b>${num(new Set(conf.map(cidade)).size)}</b><span>municípios</span></div>`;
  $('#lista').innerHTML = vis.length ? vis.map(e => `
    <button class="card" data-id="${esc(e.evento_id)}">
      <div class="data">${esc(e.data)}${e.hora_inicio_ev ? ' · ' + esc(e.hora_inicio_ev) : ''}</div>
      <h3>${esc(e.nome)}</h3>
      <div class="meta">${esc(cidade(e))}${km(e.evento_distancia_total) ? ' · ' + esc(km(e.evento_distancia_total)) : ''}</div>
      <span class="tag ${esc(e.status)}">${abertas(e) ? 'Inscrições abertas' : ROTULO[e.status] || esc(e.status)}</span>
    </button>`).join('') : '<p class="aviso">Nenhum evento com esses filtros.</p>';
}

async function carregarAno(ano) {
  $('#lista').innerHTML = '<p class="aviso">Carregando…</p>';
  try {
    eventos = await api({ acao: 'eventos', ano });
    const regs = [...new Set(eventos.map(e => e.regiao_idr).filter(Boolean))].sort();
    $('#f-regiao').innerHTML = '<option value="">Todas as regiões</option>' + regs.map(r => `<option>${esc(r)}</option>`).join('');
    renderLista();
  } catch (err) {
    $('#lista').innerHTML = `<p class="aviso">${esc(err.message)}</p>`;
  }
}

async function abrirEvento(id) {
  const ano = $('#f-ano').value;
  const corpo = $('#dlg-corpo');
  corpo.innerHTML = '<p>Carregando…</p>';
  $('#dlg').showModal();
  try {
    const e = await api({ acao: 'evento', ano, id });
    const linhas = [
      ['Data', e.data + (e.hora_inicio_ev ? ' às ' + e.hora_inicio_ev : '')],
      ['Local', cidade(e)], ['Ponto de encontro', e.evento_logradouro],
      ['Distância', km(e.evento_distancia_total)],
      ['Duração média', e.evento_tempo_medio_duracao], ['Vagas', vagas(e.evento_numero_maximo_inscritos)],
      ['Esforço', e.cief_id__txt], ['Piso', e.cct_id__txt], ['Idade mínima', e.evento_idade_minima_entrada],
    ].filter(([, v]) => v && v !== '0' && v !== '00');
    corpo.innerHTML = `
      <button class="fechar" aria-label="Fechar">×</button>
      <h2>${esc(e.nome)}</h2>
      <span class="tag ${esc(e.status)}">${ROTULO[e.status] || esc(e.status)}</span>
      ${e.evento_cancelamento_motivo && e.status === 'cancelado' ? `<p>${esc(e.evento_cancelamento_motivo)}</p>` : ''}
      <dl>${linhas.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${e.evento_como_chegar ? `<h3>Como chegar</h3><p class="texto">${esc(e.evento_como_chegar)}</p>` : ''}
      ${e.evento_observacao ? `<h3>Observações</h3><p class="texto">${esc(e.evento_observacao)}</p>` : ''}
      ${abertas(e) ? ficha(e) : ''}`;
    const form = corpo.querySelector('form');
    if (form) form.addEventListener('submit', ev => enviarFicha(ev, e, ano));
  } catch (err) {
    corpo.innerHTML = `<button class="fechar" aria-label="Fechar">×</button><p class="aviso">${esc(err.message)}</p>`;
  }
}

function ficha(e) {
  return `<h3>Inscrição</h3>
  <form class="ficha">
    <label class="inteira">Nome completo<input name="nome" required minlength="3" maxlength="120" autocomplete="name"></label>
    <label>E-mail<input name="email" type="email" required autocomplete="email"></label>
    <label>Celular (com DDD)<input name="telefone" type="tel" required autocomplete="tel"></label>
    <label>Nascimento<input name="nascimento" type="date" required></label>
    <label>CPF${e.evento_campo_documento_cpf_obrigatorio === 'sim' ? '' : ' (opcional)'}<input name="documento" inputmode="numeric" ${e.evento_campo_documento_cpf_obrigatorio === 'sim' ? 'required' : ''}></label>
    <label>Cidade<input name="cidade" required autocomplete="address-level2"></label>
    <label>UF<input name="uf" required maxlength="2" value="PR"></label>
    ${e.evento_termo_visitante ? `<details class="inteira"><summary>${esc(e.evento_titulo_do_termo || 'Termo de responsabilidade')}</summary><p class="texto">${esc(e.evento_termo_visitante)}</p></details>` : ''}
    <label class="chk inteira"><input type="checkbox" name="aceite_termo" required> Li e aceito o termo do evento e autorizo o uso dos meus dados para a organização desta caminhada (LGPD).</label>
    <label class="chk inteira"><input type="checkbox" name="receber"> Quero receber avisos de outras caminhadas.</label>
    <div class="inteira"><button class="prim" type="submit">Confirmar inscrição</button><div class="msg" role="status"></div></div>
  </form>`;
}

async function enviarFicha(ev, e, ano) {
  ev.preventDefault();
  const f = ev.target, msg = f.querySelector('.msg'), bt = f.querySelector('button');
  const d = Object.fromEntries(new FormData(f));
  bt.disabled = true; msg.className = 'msg'; msg.textContent = 'Enviando…';
  try {
    const r = await postar({ acao: 'inscrever', ano, evento_id: e.evento_id, ...d,
      aceite_termo: f.aceite_termo.checked, receber: f.receber.checked });
    msg.className = 'msg ok';
    msg.textContent = `Inscrição nº ${r.numero} confirmada. Até ${r.data}!`;
    f.querySelectorAll('input').forEach(i => (i.disabled = true));
  } catch (err) {
    msg.className = 'msg erro'; msg.textContent = err.message; bt.disabled = false;
  }
}

function renderRotas() {
  $('#rotas-lista').innerHTML = ROTAS.map(r => `
    <article class="rota"><div class="faixa" style="background:${r.cor}"></div>
    <div class="corpo"><div class="breve">Em breve</div><h3>${esc(r.nome)}</h3><p>${esc(r.texto)}</p></div></article>`).join('');
}

async function iniciar() {
  renderRotas();
  ['#f-regiao', '#f-status'].forEach(s => $(s).addEventListener('change', renderLista));
  $('#f-busca').addEventListener('input', renderLista);
  $('#f-ano').addEventListener('change', ev => carregarAno(ev.target.value));
  $('#lista').addEventListener('click', ev => { const c = ev.target.closest('.card'); if (c) abrirEvento(c.dataset.id); });
  $('#dlg').addEventListener('click', ev => { if (ev.target.id === 'dlg' || ev.target.closest('.fechar')) $('#dlg').close(); });
  try {
    const anos = await api({ acao: 'anos' });
    const atual = String(new Date().getFullYear());
    $('#f-ano').innerHTML = anos.map(a => `<option ${String(a) === atual ? 'selected' : ''}>${a}</option>`).join('');
    await carregarAno($('#f-ano').value);
  } catch (err) {
    $('#lista').innerHTML = `<p class="aviso">${esc(err.message)}</p>`;
  }
}

iniciar();

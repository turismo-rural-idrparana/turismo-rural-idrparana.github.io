// Área do gestor: lista de inscritos, check-in, inscrição na mesa e CSV.
// Usa o mesmo web app do site (API_URL em app.js; repetido aqui para não carregar o site inteiro).
const API_URL = 'https://script.google.com/macros/s/AKfycbyJNnCCVhWHW_PxHPbMKDsy-VSVwgJET-47v9Ub1eBkDCETU7k5YWgXqjKwHd04IdXY/exec';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A sessão fica só nesta aba (sessionStorage) e some ao fechar.
let sessao = JSON.parse(sessionStorage.getItem('gestor') || 'null');
let inscritos = [];

async function chamar(acao, extra = {}) {
  let j;
  try {
    const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ acao, ...sessao, ...extra }) });
    j = await r.json();
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Tente novamente.');
  }
  if (!j.ok) throw new Error(j.erro);
  return j.dados;
}

function aviso(el, texto, tipo = '') { const m = $(el); m.className = 'msg ' + tipo; m.textContent = texto; }

async function entrar(ev) {
  ev?.preventDefault();
  if (ev) sessao = Object.fromEntries(new FormData(ev.target));
  aviso('#m-entrar', 'Entrando…');
  try {
    const e = await chamar('gestor_entrar');
    sessionStorage.setItem('gestor', JSON.stringify(sessao));
    $('#ev-nome').textContent = e.nome;
    $('#ev-meta').textContent = [e.data, String(e.localizacao || '').replace(/ - Brasil$/, ''), e.status].filter(Boolean).join(' · ');
    $('#entrar').hidden = true; $('#painel').hidden = false;
    await carregar();
  } catch (err) {
    sessionStorage.removeItem('gestor');
    aviso('#m-entrar', err.message, 'erro');
  }
}

async function carregar() {
  aviso('#m-lista', 'Carregando inscritos…');
  try {
    inscritos = await chamar('gestor_inscritos');
    aviso('#m-lista', '');
    render();
  } catch (err) { aviso('#m-lista', err.message, 'erro'); }
}

function render() {
  const q = $('#busca').value.trim().toLowerCase(), f = $('#filtro').value;
  const chegou = i => Boolean(i.chegou) && !/^n(ao|ão)?$/i.test(i.chegou);
  const vis = inscritos.filter(i => (!q || [i.numero, i.nome, i.cidade, i.email].join(' ').toLowerCase().includes(q))
    && (!f || (f === 'sim') === chegou(i)));
  const total = inscritos.length, cheg = inscritos.filter(chegou).length;
  $('#kpis').innerHTML = `<div><b>${total}</b>inscritos</div><div><b>${cheg}</b>chegaram</div><div><b>${total - cheg}</b>faltam</div>`;
  $('#corpo').innerHTML = vis.map(i => `<tr>
    <td>${esc(i.numero)}</td><td>${esc(i.nome)}</td><td>${esc(i.cidade)}</td><td>${esc(i.nascimento)}</td>
    <td>${esc(i.telefone)}</td><td>${esc(i.data_inscricao)}</td>
    <td class="chk">${i.origem === 'ecobooking' ? esc(i.chegou || '-')
      : `<button class="${chegou(i) ? 'sec' : ''}" data-num="${esc(i.numero)}" data-desfazer="${chegou(i) ? 1 : ''}">${chegou(i) ? 'Desfazer' : 'Chegou'}</button> ${esc(i.chegou)}`}</td>
  </tr>`).join('') || '<tr><td colspan="7">Nenhum inscrito.</td></tr>';
}

async function checkin(bt) {
  bt.disabled = true;
  try {
    const r = await chamar('gestor_checkin', { numero: bt.dataset.num, desfazer: Boolean(bt.dataset.desfazer) });
    inscritos = inscritos.map(i => i.origem !== 'ecobooking' && String(i.numero) === String(r.numero) ? { ...i, chegou: r.chegou } : i);
    render();
  } catch (err) { aviso('#m-lista', err.message, 'erro'); bt.disabled = false; }
}

async function mesa(ev) {
  ev.preventDefault();
  const f = ev.target, d = Object.fromEntries(new FormData(f));
  aviso('#m-mesa', 'Inscrevendo…');
  try {
    const r = await chamar('gestor_inscrever_mesa', { ...d, aceite_termo: f.aceite_termo.checked });
    aviso('#m-mesa', `Inscrição nº ${r.numero} feita e chegada marcada.`, 'ok');
    f.reset(); f.uf.value = 'PR';
    await carregar();
  } catch (err) { aviso('#m-mesa', err.message, 'erro'); }
}

function baixarCsv() {
  const cols = ['origem', 'numero', 'nome', 'email', 'telefone', 'whatsapp', 'documento', 'nascimento', 'cidade', 'data_inscricao', 'chegou'];
  const cel = v => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(';'), ...inscritos.map(i => cols.map(c => cel(i[c])).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); // BOM: Excel lê os acentos
  a.download = `inscritos_${sessao.ano}_${sessao.evento_id}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#f-entrar').addEventListener('submit', entrar);
$('#f-mesa').addEventListener('submit', mesa);
$('#busca').addEventListener('input', render);
$('#filtro').addEventListener('change', render);
$('#b-csv').addEventListener('click', baixarCsv);
$('#b-atualizar').addEventListener('click', carregar);
$('#corpo').addEventListener('click', ev => { const b = ev.target.closest('button[data-num]'); if (b) checkin(b); });
if (sessao) entrar();

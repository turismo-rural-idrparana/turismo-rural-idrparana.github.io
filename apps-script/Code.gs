/**
 * Backend do Turismo Rural IDR-Paraná (Caminhadas na Natureza).
 *
 * Dados: uma planilha por ano dentro da pasta FOLDER_ID (Script Properties),
 * com nome "Caminhadas IDR - AAAA". Aba "eventos" = cadastro do evento,
 * aba "inscricoes" = inscrições (criada na primeira inscrição).
 * As planilhas NÃO são compartilhadas: o web app roda como o dono e só
 * devolve os campos públicos. Dados pessoais nunca saem pelo doGet.
 */

const PREFIXO = 'Caminhadas IDR - ';
const TZ = 'America/Sao_Paulo';
const STATUS_PUBLICOS = ['producao', 'previsto', 'cancelado'];

// Campos que vão na listagem (leve) e no detalhe (completo). O resto é privado.
const CAMPOS_LISTA = [
  'evento_id', 'ano', 'nome', 'localizacao', 'regiao_idr', 'data', 'status',
  'inscritos', 'evento_numero_maximo_inscritos', 'evento_distancia_total',
  'evento_tempo_medio_duracao', 'evento_data_inicio_inscricoes',
  'evento_data_termino_inscricoes', 'hora_inicio_ev'
];
const CAMPOS_DETALHE = CAMPOS_LISTA.concat([
  'evento_logradouro', 'evento_cep', 'evento_latitude_1', 'evento_longitude_1',
  'evento_wikiloc', 'evento_home_page', 'evento_youtube', 'evento_como_chegar',
  'evento_observacao', 'evento_idade_minima_entrada', 'evento_termo_menor_idade_anos',
  'evento_titulo_do_termo', 'evento_termo_visitante', 'evento_obrigatorio_aprovar_normas',
  'cct_id__txt', 'cief_id__txt', 'cop_id__txt', 'csm_id__txt',
  'evento_cancelamento_motivo', 'evento_campo_documento_cpf_obrigatorio', 'hora_fim_ev',
  'data_inicio_ev', 'data_fim_ev', 'hora_termino_inscricoes'
]);

const COLUNAS_INSCRICAO = [
  'numero', 'evento_id', 'data_inscricao', 'nome', 'email', 'telefone', 'documento',
  'nascimento', 'cidade', 'uf', 'aceite_termo', 'receber_novidades', 'origem', 'chegou_em'
];

// ---------- HTTP ----------

function doGet(e) {
  const p = (e && e.parameter) || {};
  return responder(() => {
    if (p.acao === 'anos') return anos();
    if (p.acao === 'eventos') return eventos(exigirAno(p.ano));
    if (p.acao === 'evento') return evento(exigirAno(p.ano), String(p.id || ''));
    throw new Error('Ação inválida.');
  });
}

function doPost(e) {
  return responder(() => {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.acao === 'inscrever') return inscrever(d);
    throw new Error('Ação inválida.');
  });
}

function responder(fn) {
  let corpo;
  try {
    corpo = { ok: true, dados: fn(), erro: null };
  } catch (err) {
    console.error(err);
    corpo = { ok: false, dados: null, erro: err.message || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(corpo))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- Leitura ----------

function planilhas() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('planilhas');
  if (hit) return JSON.parse(hit);
  const pasta = DriveApp.getFolderById(propriedade('FOLDER_ID'));
  const mapa = {};
  const it = pasta.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) {
    const f = it.next();
    const m = f.getName().match(/^Caminhadas IDR - (\d{4})$/);
    if (m) mapa[m[1]] = f.getId();
  }
  cache.put('planilhas', JSON.stringify(mapa), 21600);
  return mapa;
}

function anos() {
  return Object.keys(planilhas()).map(Number).sort((a, b) => b - a);
}

function lerEventos(ano) {
  const id = planilhas()[ano];
  if (!id) throw new Error('Não há dados para ' + ano + '.');
  const aba = SpreadsheetApp.openById(id).getSheetByName('eventos');
  const [cab, ...linhas] = aba.getDataRange().getDisplayValues();
  return linhas.map(l => Object.fromEntries(cab.map((c, i) => [c, l[i]])));
}

function eventos(ano) {
  const chave = 'ev_' + ano;
  const cache = CacheService.getScriptCache();
  const hit = cache.get(chave);
  if (hit) return JSON.parse(hit);
  const lista = lerEventos(ano)
    .filter(e => STATUS_PUBLICOS.includes(e.status))
    .map(e => escolher(e, CAMPOS_LISTA));
  const s = JSON.stringify(lista);
  if (s.length < 95000) cache.put(chave, s, 600); // limite de 100 KB por chave
  return lista;
}

function evento(ano, id) {
  const e = lerEventos(ano).find(x => String(x.evento_id) === id && STATUS_PUBLICOS.includes(x.status));
  if (!e) throw new Error('Evento não encontrado.');
  return escolher(e, CAMPOS_DETALHE);
}

// ---------- Inscrição ----------

function inscrever(d) {
  const ano = exigirAno(d.ano);
  const f = validarFicha(d);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const plan = SpreadsheetApp.openById(planilhas()[ano]);
    const ev = lerEventos(ano).find(x => String(x.evento_id) === String(d.evento_id));
    if (!ev) throw new Error('Evento não encontrado.');
    conferirRegrasDoEvento(ev, f);

    const aba = plan.getSheetByName('inscricoes') || criarAbaInscricoes(plan);
    const regs = aba.getLastRow() > 1
      ? aba.getRange(2, 1, aba.getLastRow() - 1, COLUNAS_INSCRICAO.length).getValues() : [];
    const doEvento = regs.filter(r => String(r[1]) === String(ev.evento_id));

    const max = Number(ev.evento_numero_maximo_inscritos) || 0;
    if (max && doEvento.length >= max) throw new Error('Vagas esgotadas.');
    if (doEvento.some(r => String(r[4]).toLowerCase() === f.email)) {
      throw new Error('Este e-mail já está inscrito neste evento.');
    }

    const numero = doEvento.length + 1;
    aba.appendRow([numero, ev.evento_id, new Date(), f.nome, f.email, f.telefone, f.documento,
      f.nascimento, f.cidade, f.uf, 'sim', f.receber ? 'sim' : 'nao', 'site', '']);
    return { numero, evento: ev.nome, data: ev.data };
  } finally {
    lock.releaseLock();
  }
}

function validarFicha(d) {
  // Prefixo ' impede que texto começando com = + - @ vire fórmula na planilha.
  const t = v => String(v == null ? '' : v).trim().replace(/^([=+\-@])/, "'$1");
  const f = {
    nome: t(d.nome), email: t(d.email).toLowerCase(), telefone: t(d.telefone).replace(/\D/g, ''),
    documento: t(d.documento).replace(/\D/g, ''), nascimento: t(d.nascimento),
    cidade: t(d.cidade), uf: t(d.uf).toUpperCase().slice(0, 2), receber: d.receber === true
  };
  if (f.nome.length < 3 || f.nome.length > 120) throw new Error('Informe o nome completo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) throw new Error('E-mail inválido.');
  if (f.telefone.length < 10 || f.telefone.length > 13) throw new Error('Telefone inválido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.nascimento)) throw new Error('Data de nascimento inválida.');
  if (!f.cidade || f.uf.length !== 2) throw new Error('Informe cidade e UF.');
  if (d.aceite_termo !== true) throw new Error('É preciso aceitar o termo do evento.');
  return f;
}

function conferirRegrasDoEvento(ev, f) {
  if (ev.status !== 'producao') throw new Error('Inscrições indisponíveis para este evento.');
  const hoje = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const ini = paraIso(ev.evento_data_inicio_inscricoes);
  const fim = paraIso(ev.evento_data_termino_inscricoes);
  if (ini && hoje < ini) throw new Error('As inscrições ainda não abriram.');
  if (fim && hoje > fim) throw new Error('As inscrições estão encerradas.');
  if (ev.evento_campo_documento_cpf_obrigatorio === 'sim' && f.documento.length !== 11) {
    throw new Error('CPF obrigatório para este evento.');
  }
  const minima = Number(ev.evento_idade_minima_entrada) || 0;
  if (minima && idade(f.nascimento) < minima) {
    throw new Error('Idade mínima para este evento: ' + minima + ' anos.');
  }
}

function criarAbaInscricoes(plan) {
  const aba = plan.insertSheet('inscricoes');
  aba.appendRow(COLUNAS_INSCRICAO);
  aba.setFrozenRows(1);
  return aba;
}

// ---------- Utilitários ----------

function escolher(o, campos) {
  return Object.fromEntries(campos.filter(c => c in o).map(c => [c, o[c]]));
}

function exigirAno(v) {
  const a = String(v || '');
  if (!/^\d{4}$/.test(a)) throw new Error('Ano inválido.');
  return a;
}

function paraIso(s) {
  s = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
}

function idade(iso) {
  const n = new Date(iso + 'T12:00:00');
  const h = new Date();
  let a = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--;
  return a;
}

// Padrões; uma Script Property com o mesmo nome tem prioridade.
const PADRAO = { FOLDER_ID: '1cGgAmHXh9XKUQURz8KtBDvuvkbkpF7oj' };

function propriedade(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k) || PADRAO[k];
  if (!v) throw new Error('Configuração ausente: ' + k);
  return v;
}

/** Rodar no editor depois de importar planilhas novas. */
function limparCache() {
  CacheService.getScriptCache().removeAll(['planilhas'].concat(anos().map(a => 'ev_' + a)));
}

/** Autoteste rápido no editor (Executar > testes). */
function testes() {
  console.assert(paraIso('26/01/2025') === '2025-01-26', 'paraIso br');
  console.assert(paraIso('2025-01-26') === '2025-01-26', 'paraIso iso');
  console.assert(escolher({ a: 1, b: 2 }, ['a']).b === undefined, 'escolher');
  let erro = '';
  try { validarFicha({ nome: 'Ana Souza', email: 'x', telefone: '41999999999', nascimento: '1990-01-01', cidade: 'Curitiba', uf: 'PR', aceite_termo: true }); } catch (e) { erro = e.message; }
  console.assert(erro === 'E-mail inválido.', 'validarFicha email');
  console.log('testes ok; anos:', anos());
}

/**
 * Backend do Turismo Rural IDR-Paraná (Caminhadas na Natureza).
 *
 * Pasta FOLDER_ID no Drive:
 *  - "Caminhadas IDR - AAAA" (uma por ano), abas:
 *      eventos               cadastro (inclui senha_gestor, privada)
 *      inscricoes            inscrições feitas neste sistema (criada na primeira)
 *  - "Caminhadas IDR - AAAA - inscritos N": histórico do Ecobooking em partes
 *    (aba inscricoes_ecobooking, cada evento inteiro numa parte; somente leitura)
 *  - subpasta "Respostas da ficha (Ecobooking)": arquivo, não lido pelo backend
 *  - "Caminhadas IDR - config", aba config (chave | valor): senha_admin.
 * As planilhas não são compartilhadas; o web app roda como o dono e só devolve
 * campos públicos, ou dados de inscritos para quem tem a senha do evento.
 */

const TZ = 'America/Sao_Paulo';
const STATUS_PUBLICOS = ['producao', 'previsto', 'cancelado'];
const PADRAO = { FOLDER_ID: '1cGgAmHXh9XKUQURz8KtBDvuvkbkpF7oj' };
const MAX_FALHAS = 8;

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
const COL = Object.fromEntries(COLUNAS_INSCRICAO.map((c, i) => [c, i]));

// ---------- HTTP ----------

function doGet(e) {
  const p = (e && e.parameter) || {};
  return responder(() => {
    if (p.acao === 'anos') return anos();
    if (p.acao === 'config') return { inscricoes_site: inscricoesSiteLigadas() };
    if (p.acao === 'eventos') return eventos(exigirAno(p.ano));
    if (p.acao === 'evento') return evento(exigirAno(p.ano), String(p.id || ''));
    throw new Error('Ação inválida.');
  });
}

function doPost(e) {
  return responder(() => {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.acao === 'inscrever') return inscrever(d, 'site');
    const acoesGestor = {
      gestor_entrar: gestorEntrar,
      gestor_inscritos: gestorInscritos,
      gestor_checkin: gestorCheckin,
      gestor_inscrever_mesa: d2 => inscrever(d2, 'mesa'),
    };
    const fn = acoesGestor[d.acao];
    if (!fn) throw new Error('Ação inválida.');
    autenticar(d);
    return fn(d);
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

// ---------- Planilhas ----------

/** Mapa das planilhas da pasta (cache de 10 min; `forcar` relê a pasta). */
function planilhas(forcar) {
  const cache = CacheService.getScriptCache();
  const hit = forcar ? null : cache.get('planilhas_v5');
  if (hit) return JSON.parse(hit);
  const it = DriveApp.getFolderById(propriedade('FOLDER_ID')).getFilesByType(MimeType.GOOGLE_SHEETS);
  // mapa: { '2025': id, 'config': id, 'insc_2025': [ids das partes do histórico] }
  const mapa = {};
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue; // a pasta também lista o que está na lixeira
    const m = f.getName().match(/^Caminhadas IDR - (\d{4}|config)(?: - inscritos \d+)?$/);
    if (!m) continue;
    if (/ - inscritos \d+$/.test(f.getName())) {
      (mapa['insc_' + m[1]] = mapa['insc_' + m[1]] || []).push(f.getId());
    } else {
      mapa[m[1]] = f.getId();
    }
  }
  if (Object.keys(mapa).length) cache.put('planilhas_v5', JSON.stringify(mapa), 600);
  return mapa;
}

/** Linhas históricas (Ecobooking) do evento, procurando em todas as partes do ano. */
function historicoDoEvento(ano, id) {
  const partes = planilhas()['insc_' + ano] || [];
  for (const pid of partes) {
    const linhas = linhasDoEvento(SpreadsheetApp.openById(pid).getSheetByName('inscricoes_ecobooking'), 1, id);
    if (linhas.length) return linhas; // um evento fica inteiro numa só parte
  }
  return [];
}

function abrirAno(ano) {
  // Ano ausente do cache pode ser planilha recém-criada: relê a pasta uma vez.
  const id = planilhas()[ano] || planilhas(true)[ano];
  if (!id) throw new Error('Não há dados para ' + ano + '.');
  return SpreadsheetApp.openById(id);
}

function anos() {
  return Object.keys(planilhas()).filter(k => /^\d{4}$/.test(k)).map(Number).sort((a, b) => b - a);
}

function paraObjetos(valores) {
  const [cab, ...linhas] = valores;
  return linhas.map(l => Object.fromEntries(cab.map((c, i) => [c, l[i]])));
}

function lerEventos(ano) {
  return paraObjetos(abrirAno(ano).getSheetByName('eventos').getDataRange().getDisplayValues());
}

function acharEvento(ano, id) {
  const ev = lerEventos(ano).find(x => String(x.evento_id) === String(id));
  if (!ev) throw new Error('Evento não encontrado.');
  return ev;
}

/** Linhas de uma aba cujo evento_id (coluna indicada) é igual ao pedido. */
function linhasDoEvento(aba, colunaId, id) {
  if (!aba || aba.getLastRow() < 2) return [];
  const cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getDisplayValues()[0];
  const linhas = aba.getRange(2, colunaId, aba.getLastRow() - 1, 1)
    .createTextFinder(String(id)).matchEntireCell(true).findAll().map(r => r.getRow());
  if (!linhas.length) return [];
  // Uma leitura só do bloco [primeira, última]; o histórico vem ordenado por evento.
  const ini = Math.min(...linhas), fim = Math.max(...linhas);
  const bloco = aba.getRange(ini, 1, fim - ini + 1, cab.length).getDisplayValues();
  return bloco.map((v, i) => Object.assign({ _linha: ini + i }, Object.fromEntries(cab.map((c, j) => [c, v[j]]))))
    .filter(o => String(o[cab[colunaId - 1]]) === String(id));
}

// ---------- Público ----------

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
  const e = acharEvento(ano, id);
  if (!STATUS_PUBLICOS.includes(e.status)) throw new Error('Evento não encontrado.');
  return escolher(e, CAMPOS_DETALHE);
}

// ---------- Inscrição (site e mesa) ----------

function inscrever(d, origem) {
  const ano = exigirAno(d.ano);
  // Até a virada oficial, as inscrições públicas seguem no Ecobooking (config inscricoes_site = sim liga).
  if (origem === 'site' && !inscricoesSiteLigadas()) {
    throw new Error('As inscrições ainda são feitas pelo sistema atual (caminhadas.info).');
  }
  const f = validarFicha(d);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const plan = abrirAno(ano);
    const ev = acharEvento(ano, d.evento_id);
    conferirRegrasDoEvento(ev, f, origem);

    const aba = plan.getSheetByName('inscricoes') || criarAbaInscricoes(plan);
    const doEvento = linhasDoEvento(aba, COL.evento_id + 1, ev.evento_id);
    const max = Number(ev.evento_numero_maximo_inscritos) || 0;
    if (max && doEvento.length >= max) throw new Error('Vagas esgotadas.');
    if (doEvento.some(r => String(r.email).toLowerCase() === f.email)) {
      throw new Error('Este e-mail já está inscrito neste evento.');
    }

    const numero = doEvento.reduce((m, r) => Math.max(m, Number(r.numero) || 0), 0) + 1;
    const agora = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    aba.appendRow([numero, String(ev.evento_id), agora, f.nome, f.email, f.telefone, f.documento,
      f.nascimento, f.cidade, f.uf, 'sim', f.receber ? 'sim' : 'nao', origem,
      origem === 'mesa' ? agora : '']);
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

function conferirRegrasDoEvento(ev, f, origem) {
  if (ev.status !== 'producao') throw new Error('Inscrições indisponíveis para este evento.');
  if (origem !== 'mesa') { // na mesa, o período de inscrição pela internet não vale
    const hoje = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
    const ini = paraIso(ev.evento_data_inicio_inscricoes);
    const fim = paraIso(ev.evento_data_termino_inscricoes);
    if (ini && hoje < ini) throw new Error('As inscrições ainda não abriram.');
    if (fim && hoje > fim) throw new Error('As inscrições estão encerradas.');
  }
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
  aba.getRange('A:Z').setNumberFormat('@'); // tudo texto: preserva zeros de CPF/telefone
  return aba;
}

// ---------- Gestor ----------

function autenticar(d) {
  const ano = exigirAno(d.ano);
  const id = String(d.evento_id || '');
  const chave = 'falha_' + ano + '_' + id;
  const cache = CacheService.getScriptCache();
  const falhas = Number(cache.get(chave) || 0);
  if (falhas >= MAX_FALHAS) throw new Error('Muitas tentativas. Aguarde 15 minutos.');
  const senha = String(d.senha || '');
  const ev = acharEvento(ano, id);
  const ok = senha.length >= 6 && (senha === String(ev.senha_gestor || '') || senha === senhaAdmin());
  if (!ok) {
    cache.put(chave, String(falhas + 1), 900);
    throw new Error('Evento ou senha incorretos.');
  }
}

/** Valor de uma chave da aba config ('' se não existir). */
function valorConfig(chave) {
  const id = planilhas().config;
  if (!id) return '';
  const linhas = SpreadsheetApp.openById(id).getSheetByName('config').getDataRange().getDisplayValues();
  const l = linhas.find(r => r[0] === chave);
  return l ? String(l[1]).trim() : '';
}

function senhaAdmin() {
  return valorConfig('senha_admin');
}

function inscricoesSiteLigadas() {
  return valorConfig('inscricoes_site').toLowerCase() === 'sim';
}

function gestorEntrar(d) {
  return escolher(acharEvento(d.ano, d.evento_id), CAMPOS_DETALHE);
}

function gestorInscritos(d) {
  const plan = abrirAno(d.ano);
  const id = String(d.evento_id);
  const novos = linhasDoEvento(plan.getSheetByName('inscricoes'), COL.evento_id + 1, id).map(r => ({
    origem: r.origem, numero: r.numero, nome: r.nome, email: r.email, telefone: r.telefone,
    whatsapp: '', documento: r.documento, nascimento: r.nascimento, cidade: r.cidade + (r.uf ? '/' + r.uf : ''),
    data_inscricao: r.data_inscricao, chegou: r.chegou_em,
  }));
  const antigos = historicoDoEvento(d.ano, id).map(r => ({
    origem: 'ecobooking', numero: r.inscricao, nome: r.nome, email: r.email, telefone: r.telefone,
    whatsapp: r.whatsapp, documento: r.documento, nascimento: r.nascimento, cidade: r.cidade,
    data_inscricao: r.data_inscricao, chegou: r.chegou,
  }));
  return novos.concat(antigos);
}

function gestorCheckin(d) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const aba = abrirAno(d.ano).getSheetByName('inscricoes');
    const r = linhasDoEvento(aba, COL.evento_id + 1, String(d.evento_id))
      .find(x => String(x.numero) === String(d.numero));
    if (!r) throw new Error('Inscrição ' + d.numero + ' não encontrada neste evento.');
    const valor = d.desfazer ? '' : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    aba.getRange(r._linha, COL.chegou_em + 1).setValue(valor);
    return { numero: r.numero, chegou: valor };
  } finally {
    lock.releaseLock();
  }
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

function propriedade(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k) || PADRAO[k];
  if (!v) throw new Error('Configuração ausente: ' + k);
  return v;
}

/** Rodar no editor depois de importar ou renomear planilhas. */
function limparCache() {
  const c = CacheService.getScriptCache();
  c.remove('planilhas_v5');
  c.removeAll(anos().map(a => 'ev_' + a));
}

function afirmar(cond, msg) {
  if (!cond) throw new Error('Falhou: ' + msg);
}

/** Autoteste no editor (Executar > testes). */
function testes() {
  afirmar(paraIso('26/01/2025') === '2025-01-26', 'paraIso br');
  afirmar(paraIso('2025-01-26') === '2025-01-26', 'paraIso iso');
  afirmar(!('b' in escolher({ a: 1, b: 2 }, ['a'])), 'escolher');
  const ficha = { nome: 'Ana Souza', email: 'ana@exemplo.com', telefone: '(41) 99999-9999',
    nascimento: '1990-01-01', cidade: 'São José dos Pinhais', uf: 'pr', aceite_termo: true };
  afirmar(validarFicha(ficha).uf === 'PR', 'validarFicha uf');
  afirmar(validarFicha(Object.assign({}, ficha, { nome: '=HYPERLINK("x")' })).nome.startsWith("'="), 'anti-fórmula');
  let erro = '';
  try { validarFicha(Object.assign({}, ficha, { email: 'x' })); } catch (e) { erro = e.message; }
  afirmar(erro === 'E-mail inválido.', 'validarFicha email');
  limparCache();
  console.log('testes ok; anos:', anos());
}

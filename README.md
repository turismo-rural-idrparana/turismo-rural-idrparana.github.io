# Turismo Rural IDR-Paraná

Site estático (GitHub Pages): https://turismo-rural-idrparana.github.io/

- `index.html`, `app.js`: site público. Seção **Caminhadas na Natureza** (eventos por ano, filtros,
  detalhe e inscrição) e **Rotas turísticas** (Queijo, Uva e Vinho, Erva-Mate; conteúdo provisório).
- `gestor.html`, `gestor.js`: área do gestor do evento (senha por evento ou senha de administrador):
  lista de inscritos (novos + histórico do Ecobooking), check-in, inscrição na mesa e CSV.
- `apps-script/`: backend (Google Apps Script, web app, roda como o dono das planilhas).

## Dados (pasta do Drive, não compartilhada)

| Arquivo | Conteúdo |
|---|---|
| `Caminhadas IDR - AAAA` | aba `eventos` (cadastro + `senha_gestor`) e `inscricoes` (novas, criada na 1ª inscrição) |
| `Caminhadas IDR - AAAA - inscritos N` | histórico do Ecobooking em partes (cada evento inteiro numa parte) |
| `Caminhadas IDR - config` | `config` (senha_admin), `cidades` (cidade → região IDR), `cidades_bloqueadas` |
| subpasta `Respostas da ficha (Ecobooking)` | respostas da ficha por pessoa (dado de saúde, só arquivo) |

Só campos públicos saem pelo `doGet`. Dados de inscritos exigem a senha do evento ou a de administrador;
8 senhas erradas bloqueiam o evento por 15 minutos.

## Operação

- Novo evento: acrescentar uma linha na aba `eventos` do ano (status `producao` para abrir inscrições,
  datas `evento_data_inicio_inscricoes`/`evento_data_termino_inscricoes` em AAAA-MM-DD, `senha_gestor` com 10+ caracteres).
- Ano novo: criar a planilha `Caminhadas IDR - AAAA` com a aba `eventos` e o mesmo cabeçalho.
- Depois de criar/renomear planilhas, rodar `limparCache` no editor (ou esperar 10 min).
- Deploy: `cd apps-script && clasp push && clasp update-deployment <id>`. Autoteste: rodar `testes` no editor.

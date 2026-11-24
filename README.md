# Turismo Rural IDR-Paraná

Site estático (GitHub Pages) com a seção **Caminhadas na Natureza** e as **Rotas turísticas**
(Queijo, Uva e Vinho, Erva-Mate; conteúdo provisório).

- `index.html`, `app.js`: front-end, sem build.
- `apps-script/`: backend (Google Apps Script, web app). Lê uma planilha por ano
  (`Caminhadas IDR - AAAA`, aba `eventos`) numa pasta do Drive e grava inscrições na aba `inscricoes`.
  Só campos públicos saem pelo `doGet`; as planilhas não são compartilhadas.

Deploy do backend: `cd apps-script && clasp push && clasp update-deployment <id>`.
Depois de importar planilhas novas, rodar `limparCache` no editor.

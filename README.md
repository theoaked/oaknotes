# OakNotes

Página estática (GitHub Pages) que lista, navega, exibe e permite baixar todos
os arquivos `.md` guardados na pasta [`notes/`](notes/) deste repositório.

Não há build: tudo roda no navegador, lendo a árvore do repositório pela API do
GitHub e o conteúdo dos arquivos via `raw.githubusercontent.com`.

## Recursos

- 📁 Navegação por pastas e arquivos (espelha a estrutura de `notes/`)
- 🔎 Busca por **nome** (instantânea) e por **conteúdo** dos arquivos
- 📝 Renderização de Markdown (GFM): tabelas, tarefas, realce de código
- 📊 Diagramas **Mermaid**
- 🧭 Sumário (TOC) por documento, com rolagem ativa
- ⬇️ **Download** do `.md` original
- 🌗 Tema claro/escuro com alternância (segue a preferência do sistema)

## Como ativar o GitHub Pages

> O repositório precisa ser **público** (a API e o `raw` anônimos exigem isso).

1. Faça commit e push destes arquivos para o branch `main`.
2. No GitHub: **Settings → Pages**.
3. Em **Build and deployment → Source**, escolha **Deploy from a branch**.
4. Selecione o branch **`main`** e a pasta **`/ (root)`**. Salve.
5. Aguarde alguns minutos. O site ficará em
   `https://theoaked.github.io/oaknotes/`.

## Adicionando notas

Basta criar arquivos `.md` (e subpastas) dentro de `notes/`. Eles aparecem
automaticamente na próxima vez que a página for carregada.

## Configuração (opcional)

O app detecta `owner`/`repo` pela URL do Pages. Para usar em outro repositório
ou customizar, defina antes de `assets/app.js` em `index.html`:

```html
<script>
  window.OAKNOTES_CONFIG = {
    owner: "theoaked",
    repo: "oaknotes",
    branch: "main",
    notesDir: "notes",
  };
</script>
```

## Limitações

- A **listagem** da árvore usa a API do GitHub, limitada a **60 requisições/hora
  por IP** para acesso anônimo (1 requisição por carregamento da página). O
  conteúdo dos arquivos vem do `raw`, sem esse limite.
- Funciona apenas com repositório **público**.

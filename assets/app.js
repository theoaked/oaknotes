/* OakNotes — navegador estático de Markdown sobre a API/raw do GitHub.
 * Sem build: roda inteiramente no navegador.
 *
 * Para usar este app em outro repositório, basta sobrescrever a config
 * definindo, ANTES de carregar este script:
 *   window.OAKNOTES_CONFIG = { owner, repo, branch, notesDir };
 */
(function () {
  "use strict";

  // ----------------------------------------------------------------- Config
  const CONFIG = (function () {
    const o = window.OAKNOTES_CONFIG || {};
    let owner = o.owner;
    let repo = o.repo;
    const host = location.hostname;

    // Em GitHub Pages a URL é {owner}.github.io/{repo}/...
    if (!owner && host.endsWith(".github.io")) owner = host.split(".")[0];
    if (!repo) {
      const seg = location.pathname.split("/").filter(Boolean);
      repo = seg.length ? seg[0] : owner ? owner + ".github.io" : "";
    }
    return {
      owner: owner || "theoaked",
      repo: repo || "oaknotes",
      branch: o.branch || "main",
      notesDir: (o.notesDir || "notes").replace(/^\/+|\/+$/g, ""),
    };
  })();

  const API_TREE = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/git/trees/${CONFIG.branch}?recursive=1`;
  const rawUrl = (path) =>
    `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;

  // ----------------------------------------------------------------- DOM refs
  const $ = (sel) => document.querySelector(sel);
  const el = {
    tree: $("#tree"),
    view: $("#view"),
    toc: $("#toc"),
    search: $("#search-input"),
    contentBtn: $("#content-search-btn"),
    themeToggle: $("#theme-toggle"),
    sidebarToggle: $("#sidebar-toggle"),
    overlay: $("#overlay"),
    repoLink: $("#repo-link"),
  };
  el.repoLink.href = `https://github.com/${CONFIG.owner}/${CONFIG.repo}`;

  // ----------------------------------------------------------------- State
  let FILES = []; // [{ path, name, dir }]
  let TREE = null; // estrutura aninhada para a sidebar
  const rawCache = new Map(); // path -> texto do arquivo
  let contentSearch = false;

  // ----------------------------------------------------------------- Tema
  (function initTheme() {
    const saved = localStorage.getItem("oaknotes-theme");
    applyTheme(saved || "auto");
    el.themeToggle.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      const next = effectiveTheme(cur) === "dark" ? "light" : "dark";
      localStorage.setItem("oaknotes-theme", next);
      applyTheme(next);
      if (window.mermaid) renderMermaidIn(el.view); // re-tema dos diagramas
    });
    if (window.matchMedia) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", () => {
          if ((localStorage.getItem("oaknotes-theme") || "auto") === "auto")
            applyTheme("auto");
        });
    }
  })();

  function effectiveTheme(mode) {
    if (mode === "dark" || mode === "light") return mode;
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  function applyTheme(mode) {
    const eff = effectiveTheme(mode);
    document.documentElement.setAttribute("data-theme", eff);
    const light = document.getElementById("hljs-light");
    const dark = document.getElementById("hljs-dark");
    if (light && dark) {
      light.disabled = eff === "dark";
      dark.disabled = eff !== "dark";
    }
    if (window.mermaid) {
      mermaid.initialize({
        startOnLoad: false,
        theme: eff === "dark" ? "dark" : "default",
        securityLevel: "strict",
      });
    }
  }

  // ----------------------------------------------------------------- Markdown
  marked.setOptions({ gfm: true, breaks: false });
  const renderer = new marked.Renderer();
  const usedSlugs = new Map();

  function slugify(text) {
    let base = String(text)
      .toLowerCase()
      .trim()
      .replace(/[^\wÀ-ſ\- ]/g, "")
      .replace(/\s+/g, "-");
    if (!base) base = "secao";
    const n = usedSlugs.get(base) || 0;
    usedSlugs.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  }

  renderer.heading = function (text, level, raw) {
    const id = slugify(raw || text);
    return `<h${level} id="${id}"><a class="anchor" href="#" data-anchor="${id}" aria-hidden="true">#</a>${text}</h${level}>\n`;
  };
  renderer.code = function (code, infostring) {
    const lang = (infostring || "").trim().split(/\s+/)[0];
    if (lang === "mermaid") {
      return `<div class="mermaid">${escapeHtml(code)}</div>`;
    }
    let out;
    if (lang && window.hljs && hljs.getLanguage(lang)) {
      out = hljs.highlight(code, { language: lang }).value;
    } else if (window.hljs) {
      out = hljs.highlightAuto(code).value;
    } else {
      out = escapeHtml(code);
    }
    return `<pre><code class="hljs language-${escapeHtml(lang || "")}">${out}</code></pre>\n`;
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderMarkdown(md, filePath) {
    usedSlugs.clear();
    const dirty = marked.parse(md, { renderer });
    const clean = DOMPurify.sanitize(dirty, {
      ADD_ATTR: ["data-anchor", "target", "id", "class"],
      ADD_TAGS: ["svg", "path", "g", "line", "rect", "circle", "text", "polygon"],
    });
    const wrap = document.createElement("div");
    wrap.className = "markdown";
    wrap.innerHTML = clean;
    rewriteLinks(wrap, filePath);
    return wrap;
  }

  // Reescreve caminhos relativos: imagens -> raw; links .md -> rota interna.
  function rewriteLinks(root, filePath) {
    const baseDir = filePath.includes("/")
      ? filePath.slice(0, filePath.lastIndexOf("/"))
      : "";
    const resolve = (rel) => {
      const parts = (baseDir ? baseDir.split("/") : []).concat(
        rel.split("/")
      );
      const stack = [];
      for (const p of parts) {
        if (p === "" || p === ".") continue;
        if (p === "..") stack.pop();
        else stack.push(p);
      }
      return stack.join("/");
    };
    const isExternal = (h) => /^([a-z]+:)?\/\//i.test(h) || /^(mailto:|tel:|data:)/i.test(h);

    root.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      if (!src || isExternal(src) || src.startsWith("#")) return;
      img.setAttribute("src", rawUrl(src.startsWith("/") ? src.slice(1) : resolve(src)));
    });

    root.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#")) {
        // Âncora para cabeçalho no mesmo documento
        a.dataset.anchor = href.slice(1);
        a.setAttribute("href", "#");
        return;
      }
      if (isExternal(href)) {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener");
        return;
      }
      const [pathPart, hashPart] = href.split("#");
      const resolved = resolve(pathPart.startsWith("/") ? pathPart.slice(1) : pathPart);
      if (/\.md$/i.test(resolved)) {
        a.setAttribute("href", "#/" + encodeURI(resolved) + (hashPart ? "::" + hashPart : ""));
      } else {
        a.setAttribute("href", rawUrl(resolved));
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener");
      }
    });
  }

  function renderMermaidIn(scope) {
    if (!window.mermaid) return;
    const nodes = scope.querySelectorAll(".mermaid");
    if (!nodes.length) return;
    nodes.forEach((n) => {
      if (n.dataset.src === undefined) n.dataset.src = n.textContent;
      n.removeAttribute("data-processed");
      n.innerHTML = n.dataset.src;
    });
    try {
      mermaid.run({ nodes });
    } catch (e) {
      /* diagrama inválido: deixa o texto bruto */
    }
  }

  // ----------------------------------------------------------------- Data
  async function loadTree() {
    showStatus("Carregando lista de arquivos…", true);
    let data;
    try {
      const res = await fetch(API_TREE, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (res.status === 403) {
        throw new Error(
          "Limite de requisições da API do GitHub atingido (60/h por IP). Tente novamente mais tarde."
        );
      }
      if (res.status === 404) {
        throw new Error(
          `Não foi possível ler a árvore de "${CONFIG.owner}/${CONFIG.repo}" no branch "${CONFIG.branch}". Confira se o repositório é público e o branch existe.`
        );
      }
      if (!res.ok) throw new Error("Falha ao consultar a API do GitHub (HTTP " + res.status + ").");
      data = await res.json();
    } catch (err) {
      showError(err.message);
      return;
    }

    const prefix = CONFIG.notesDir ? CONFIG.notesDir + "/" : "";
    FILES = (data.tree || [])
      .filter(
        (n) =>
          n.type === "blob" &&
          /\.md$/i.test(n.path) &&
          (prefix === "" || n.path.startsWith(prefix))
      )
      .map((n) => ({
        path: n.path,
        name: n.path.split("/").pop(),
        dir: n.path.split("/").slice(0, -1).join("/"),
      }))
      .sort((a, b) => a.path.localeCompare(b.path, "pt"));

    TREE = buildTree(FILES);
    renderSidebar();
    route(); // abre o que estiver no hash, ou a home
  }

  function buildTree(files) {
    const root = { name: CONFIG.notesDir || "(raiz)", dirs: new Map(), files: [] };
    for (const f of files) {
      const rel = CONFIG.notesDir
        ? f.path.slice(CONFIG.notesDir.length + 1)
        : f.path;
      const parts = rel.split("/");
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        if (!node.dirs.has(seg))
          node.dirs.set(seg, { name: seg, dirs: new Map(), files: [] });
        node = node.dirs.get(seg);
      }
      node.files.push(f);
    }
    return root;
  }

  // ----------------------------------------------------------------- Sidebar
  function renderSidebar() {
    el.tree.innerHTML = "";
    if (!FILES.length) {
      el.tree.innerHTML = `<div class="empty">Nenhum arquivo <code>.md</code> encontrado em <code>${CONFIG.notesDir}/</code>.</div>`;
      return;
    }
    el.tree.appendChild(renderNode(TREE, true));
    highlightActive();
  }

  function renderNode(node, isRoot) {
    const frag = document.createDocumentFragment();

    // Subpastas (ordenadas)
    const dirs = [...node.dirs.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "pt")
    );
    for (const dir of dirs) {
      const details = document.createElement("details");
      details.open = true;
      const summary = document.createElement("summary");
      summary.innerHTML = `<span class="folder-name">${escapeHtml(dir.name)}</span>`;
      details.appendChild(summary);
      const group = document.createElement("div");
      group.className = "group";
      group.appendChild(renderNode(dir, false));
      details.appendChild(group);
      frag.appendChild(details);
    }

    // Arquivos
    for (const f of node.files) {
      const a = document.createElement("a");
      a.className = "file";
      a.href = "#/" + encodeURI(f.path);
      a.textContent = f.name;
      a.dataset.path = f.path;
      a.title = f.name;
      frag.appendChild(a);
    }
    return frag;
  }

  function highlightActive() {
    const current = parseHash().file;
    el.tree.querySelectorAll("a.file").forEach((a) => {
      a.classList.toggle("active", a.dataset.path === current);
    });
  }

  // Filtro por nome na sidebar (instantâneo)
  function filterTree(query) {
    const q = query.trim().toLowerCase();
    const files = el.tree.querySelectorAll("a.file");
    if (!q) {
      files.forEach((a) => a.classList.remove("hidden"));
      el.tree.querySelectorAll("details").forEach((d) => {
        d.classList.remove("hidden");
        d.open = true;
      });
      return;
    }
    files.forEach((a) => {
      const match = a.dataset.path.toLowerCase().includes(q);
      a.classList.toggle("hidden", !match);
    });
    // Mostra apenas pastas que contêm algum arquivo visível
    el.tree.querySelectorAll("details").forEach((d) => {
      const anyVisible = d.querySelector("a.file:not(.hidden)");
      d.classList.toggle("hidden", !anyVisible);
      if (anyVisible) d.open = true;
    });
  }

  // ----------------------------------------------------------------- Roteamento
  function parseHash() {
    let h = location.hash.replace(/^#\/?/, "");
    h = decodeURI(h);
    if (!h) return { file: null, anchor: null };
    const idx = h.indexOf("::");
    if (idx >= 0) return { file: h.slice(0, idx), anchor: h.slice(idx + 2) };
    return { file: h, anchor: null };
  }

  async function route() {
    const { file, anchor } = parseHash();
    if (!file) {
      renderHome();
      highlightActive();
      return;
    }
    await openFile(file, anchor);
    highlightActive();
  }

  // ----------------------------------------------------------------- Conteúdo
  async function fetchRaw(path) {
    if (rawCache.has(path)) return rawCache.get(path);
    const res = await fetch(rawUrl(path));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    rawCache.set(path, text);
    return text;
  }

  async function openFile(path, anchor) {
    closeSidebarMobile();
    showStatus("Carregando documento…", true);
    el.toc.innerHTML = "";
    let md;
    try {
      md = await fetchRaw(path);
    } catch (err) {
      showError(`Não foi possível carregar <code>${escapeHtml(path)}</code> (${escapeHtml(err.message)}).`);
      return;
    }

    el.view.innerHTML = "";
    el.view.appendChild(fileHeader(path));
    const body = renderMarkdown(md, path);
    el.view.appendChild(body);

    renderMermaidIn(body);
    buildToc(body);
    el.content.scrollTop = 0;
    window.scrollTo(0, 0);

    if (anchor) {
      const target = body.querySelector(CSS.escape ? "#" + CSS.escape(anchor) : `[id="${anchor}"]`);
      if (target) target.scrollIntoView();
    }
  }

  function fileHeader(path) {
    const head = document.createElement("div");
    head.className = "file-head";

    const left = document.createElement("div");
    const name = path.split("/").pop();
    left.innerHTML = `<div class="path">${escapeHtml(path)}</div><strong>${escapeHtml(name)}</strong>`;

    const actions = document.createElement("div");
    actions.className = "actions";

    const dl = document.createElement("button");
    dl.className = "btn primary";
    dl.innerHTML = "⭳ Baixar";
    dl.addEventListener("click", () => downloadFile(path));

    const ghBtn = document.createElement("a");
    ghBtn.className = "btn";
    ghBtn.href = `https://github.com/${CONFIG.owner}/${CONFIG.repo}/blob/${CONFIG.branch}/${path}`;
    ghBtn.target = "_blank";
    ghBtn.rel = "noopener";
    ghBtn.innerHTML = "GitHub ⧉";

    actions.appendChild(dl);
    actions.appendChild(ghBtn);
    head.appendChild(left);
    head.appendChild(actions);
    return head;
  }

  async function downloadFile(path) {
    try {
      const text = await fetchRaw(path);
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert("Falha ao baixar: " + err.message);
    }
  }

  // ----------------------------------------------------------------- TOC
  function buildToc(body) {
    const heads = body.querySelectorAll("h1, h2, h3, h4");
    el.toc.innerHTML = "";
    if (heads.length < 2) return;
    const title = document.createElement("div");
    title.className = "toc-title";
    title.textContent = "Nesta página";
    el.toc.appendChild(title);

    heads.forEach((h) => {
      const level = Number(h.tagName[1]);
      const a = document.createElement("a");
      a.href = "#";
      a.className = "lvl-" + level;
      a.textContent = h.textContent.replace(/^#/, "").trim();
      a.dataset.anchor = h.id;
      el.toc.appendChild(a);
    });
    setupScrollSpy(body);
  }

  let spyHandler = null;
  function setupScrollSpy(body) {
    if (spyHandler) window.removeEventListener("scroll", spyHandler, true);
    const links = [...el.toc.querySelectorAll("a")];
    const heads = links
      .map((a) => ({ a, h: body.querySelector('[id="' + a.dataset.anchor + '"]') }))
      .filter((x) => x.h);
    spyHandler = () => {
      const top = (document.querySelector(".topbar").offsetHeight || 52) + 20;
      let current = heads[0];
      for (const item of heads) {
        if (item.h.getBoundingClientRect().top <= top) current = item;
        else break;
      }
      links.forEach((a) => a.classList.toggle("active", current && a === current.a));
    };
    window.addEventListener("scroll", spyHandler, true);
    spyHandler();
  }

  // ----------------------------------------------------------------- Home
  function renderHome() {
    el.toc.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "home";
    const recent = FILES.slice(0, 12);
    wrap.innerHTML = `
      <h1>🌳 OakNotes</h1>
      <p>Navegador das notas em Markdown de <a href="https://github.com/${CONFIG.owner}/${CONFIG.repo}" target="_blank" rel="noopener"><code>${CONFIG.owner}/${CONFIG.repo}</code></a>.
      Selecione um arquivo na navegação à esquerda, use a busca acima, e baixe qualquer documento pelo botão <strong>Baixar</strong>.</p>
      <p style="color:var(--text-muted)"><strong>${FILES.length}</strong> arquivo(s) em <code>${CONFIG.notesDir}/</code>.</p>
      <div class="cards"></div>`;
    const cards = wrap.querySelector(".cards");
    recent.forEach((f) => {
      const a = document.createElement("a");
      a.className = "card";
      a.href = "#/" + encodeURI(f.path);
      a.innerHTML = `<strong>${escapeHtml(f.name)}</strong><div class="card-path">${escapeHtml(f.path)}</div>`;
      cards.appendChild(a);
    });
    el.view.innerHTML = "";
    el.view.appendChild(wrap);
  }

  // ----------------------------------------------------------------- Busca no conteúdo
  async function runContentSearch(query) {
    const q = query.trim();
    el.toc.innerHTML = "";
    if (q.length < 2) {
      el.view.innerHTML = `<div class="status">Digite ao menos 2 caracteres para buscar no conteúdo.</div>`;
      return;
    }
    showStatus(`Buscando “${escapeHtml(q)}” em ${FILES.length} arquivo(s)…`, true);

    const results = [];
    const ql = q.toLowerCase();
    // Busca sequencial com cache; raw não tem limite prático de taxa.
    await Promise.all(
      FILES.map(async (f) => {
        let text;
        try {
          text = await fetchRaw(f.path);
        } catch {
          return;
        }
        const nameHit = f.name.toLowerCase().includes(ql);
        const idx = text.toLowerCase().indexOf(ql);
        if (idx >= 0 || nameHit) {
          results.push({ file: f, snippet: idx >= 0 ? makeSnippet(text, idx, q.length) : "" });
        }
      })
    );

    results.sort((a, b) => a.file.path.localeCompare(b.file.path, "pt"));
    renderResults(q, results);
  }

  function makeSnippet(text, idx, len) {
    const start = Math.max(0, idx - 50);
    const end = Math.min(text.length, idx + len + 80);
    let s = (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
    return s;
  }

  function renderResults(query, results) {
    el.view.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "results";
    const h = document.createElement("p");
    h.style.color = "var(--text-muted)";
    h.innerHTML = `<strong>${results.length}</strong> resultado(s) para “${escapeHtml(query)}”.`;
    wrap.appendChild(h);

    if (!results.length) {
      const none = document.createElement("div");
      none.className = "status";
      none.textContent = "Nenhuma ocorrência encontrada.";
      wrap.appendChild(none);
    }

    results.forEach((r) => {
      const a = document.createElement("a");
      a.className = "result";
      a.href = "#/" + encodeURI(r.file.path);
      const snip = r.snippet ? highlight(r.snippet, query) : "<em>correspondência no nome do arquivo</em>";
      a.innerHTML =
        `<div class="r-name">${highlight(r.file.name, query)}</div>` +
        `<div class="r-path">${escapeHtml(r.file.path)}</div>` +
        `<div class="r-snippet">${snip}</div>`;
      wrap.appendChild(a);
    });
    el.view.innerHTML = "";
    el.view.appendChild(wrap);
  }

  function highlight(text, query) {
    const safe = escapeHtml(text);
    const q = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return safe.replace(new RegExp("(" + q + ")", "ig"), "<mark>$1</mark>");
  }

  // ----------------------------------------------------------------- UI helpers
  function showStatus(msg, spinner) {
    el.view.innerHTML = `<div class="status">${spinner ? '<div class="spinner"></div>' : ""}${msg}</div>`;
  }
  function showError(msg) {
    el.view.innerHTML = `<div class="status error">⚠ ${msg}</div>`;
  }

  function closeSidebarMobile() {
    document.body.classList.remove("sidebar-open");
    el.overlay.hidden = true;
  }

  // ----------------------------------------------------------------- Eventos
  let searchTimer = null;
  el.search.addEventListener("input", () => {
    const q = el.search.value;
    if (contentSearch) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runContentSearch(q), 350);
    } else {
      filterTree(q);
    }
  });
  el.search.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && contentSearch) {
      clearTimeout(searchTimer);
      runContentSearch(el.search.value);
    }
    if (e.key === "Escape") {
      el.search.value = "";
      filterTree("");
    }
  });

  el.contentBtn.addEventListener("click", () => {
    contentSearch = !contentSearch;
    el.contentBtn.classList.toggle("active", contentSearch);
    el.search.placeholder = contentSearch ? "Buscar no conteúdo… (Enter)" : "Buscar por nome…";
    if (contentSearch) {
      el.search.focus();
      if (el.search.value.trim().length >= 2) runContentSearch(el.search.value);
    } else {
      filterTree(el.search.value);
      route();
    }
  });

  // Delegação para âncoras (TOC, links internos, anchors de heading)
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-anchor]");
    if (a && el.view.contains(a) === false && !el.toc.contains(a) && !a.classList.contains("anchor")) return;
    if (a && a.dataset.anchor) {
      e.preventDefault();
      const id = a.dataset.anchor;
      const target = el.view.querySelector('[id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        const cur = parseHash().file;
        if (cur) history.replaceState(null, "", "#/" + encodeURI(cur) + "::" + id);
      }
    }
  });

  el.sidebarToggle.addEventListener("click", () => {
    const open = document.body.classList.toggle("sidebar-open");
    el.overlay.hidden = !open;
  });
  el.overlay.addEventListener("click", closeSidebarMobile);

  window.addEventListener("hashchange", route);

  // ----------------------------------------------------------------- Boot
  loadTree();
})();

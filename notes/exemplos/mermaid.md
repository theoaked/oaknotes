# Exemplo com Mermaid

Diagramas escritos em blocos ```` ```mermaid ```` são renderizados
automaticamente e seguem o tema (claro/escuro).

## Fluxograma

```mermaid
flowchart TD
    A[Abrir OakNotes] --> B{Buscar ou navegar?}
    B -->|Navegar| C[Escolher arquivo na árvore]
    B -->|Buscar| D[Digitar termo]
    D --> E[Filtrar por nome ou conteúdo]
    C --> F[Ler documento]
    E --> F
    F --> G[Baixar .md]
```

## Sequência

```mermaid
sequenceDiagram
    participant N as Navegador
    participant API as API do GitHub
    participant Raw as raw.githubusercontent
    N->>API: GET git/trees (1x)
    API-->>N: lista de arquivos
    N->>Raw: GET conteúdo do .md
    Raw-->>N: Markdown
```

Voltar para [a página inicial](../bem-vindo.md).

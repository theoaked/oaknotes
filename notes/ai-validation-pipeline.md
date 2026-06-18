# AI-Powered Change Validation Pipeline

A scalable architecture for validating software changes using LLMs — cross-referencing user stories, automated test results, and application/infrastructure code.

---

## Problem

When deploying software changes to production, engineers need to ensure that:
- The implemented code matches what was described in the user story
- Automated tests cover the acceptance criteria
- There are no obvious regression risks

Doing this manually is slow and error-prone at scale. This document describes how to automate it with LLMs efficiently — minimizing token usage and hallucination risk.

---

## High-Level Architecture

```
User Story + Code + Test Results
           │
  [Layer 0] Deterministic pre-processing (no LLM)
           │  - PR diff instead of full repository
           │  - only new or failed tests
           │  - relevant story fields only
           │
  [Layer 1] Specialized analysis (multiple focused prompts)
           │  - Prompt A: "Does the code implement what the story describes?"
           │  - Prompt B: "Do tests cover the acceptance criteria?"
           │  - Prompt C: "Are there regression risks in what was changed?"
           │
  [Layer 2] Synthesis (small prompt, structured input)
              - receives the 3 results as JSON
              - emits final verdict: APPROVED / REJECTED / INCONCLUSIVE
```

Each smaller prompt has focused context → less hallucination, fewer tokens, easier to debug.

---

## Context Reduction Strategies

### Code
- Use only the **PR diff** (`git diff main...branch`), never the full repository
- For large diffs (>500 lines), filter by files relevant to the story using keywords
- For IaC (Terraform, etc.), focus on created/modified resources only

### Tests
- Send only the execution summary + failed or new tests
- Skip full logs — include only the error message when a test fails

### User Story
- Extract only: `summary`, `description`, `acceptance_criteria`, `labels`, `components`
- Ignore comments, status history, and irrelevant custom fields

---

## When You Need the Full Repository

If context requires analyzing beyond the diff, use **RAG (Retrieval-Augmented Generation)** instead of sending the full repo to the model.

### How RAG Works

```
[Indexing — done once, updated incrementally]
Repository → chunking → embedding each chunk → store in vector store

[Query — done per evaluation]
User story → embedding → vector store returns relevant chunks → send to LLM
```

Think of it as a smart Ctrl+F — instead of exact word matching, it searches by **meaning and intent**.

### The Three Core Concepts

**Chunking** — splitting large files into smaller pieces
```
Large file
─────────────────────────
function login()    → chunk 1
function logout()   → chunk 2
function validate() → chunk 3
─────────────────────────
```

**Embedding** — converting text into numbers where similar meanings produce similar vectors
```
"validate client CPF"        → [0.82, 0.14, 0.91, ...]
"verify fiscal document"     → [0.81, 0.13, 0.89, ...]  ← similar
"configure database"         → [0.12, 0.77, 0.03, ...]  ← different
```

**Vector Store** — a database specialized in storing and querying these vectors by similarity

---

## Implementation

### Dependencies

```bash
pip install tree-sitter gitpython qdrant-client anthropic
```

### 1. Repository Indexing

```python
from git import Repo
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance, PointStruct
import anthropic
import uuid
import ast


client = QdrantClient("localhost", port=6333)
llm = anthropic.Anthropic()  # or your preferred provider


def chunk_python_file(filepath: str) -> list[dict]:
    chunks = []
    with open(filepath) as f:
        source = f.read()

    tree = ast.parse(source)

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            chunk_code = ast.get_source_segment(source, node)
            chunks.append({
                "content": chunk_code,
                "metadata": {
                    "file": filepath,
                    "name": node.name,
                    "line": node.lineno
                }
            })
    return chunks


def embed(text: str) -> list[float]:
    response = llm.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return response.data[0].embedding


def index_repository(repo_path: str):
    repo = Repo(repo_path)
    points = []

    client.create_collection(
        collection_name="repo_chunks",
        vectors_config=VectorParams(size=1536, distance=Distance.COSINE)
    )

    for item in repo.tree().traverse():
        if item.path.endswith(".py"):
            chunks = chunk_python_file(item.abspath)

            for chunk in chunks:
                vector = embed(chunk["content"])
                points.append(PointStruct(
                    id=str(uuid.uuid4()),
                    vector=vector,
                    payload=chunk["metadata"] | {"content": chunk["content"]}
                ))

    client.upsert(collection_name="repo_chunks", points=points)
    print(f"{len(points)} chunks indexed")
```

### 2. Incremental Updates (PR only)

```python
def update_chunks_from_pr(repo_path: str, branch: str):
    repo = Repo(repo_path)

    diff = repo.git.diff("main", branch, "--name-only")
    changed_files = diff.strip().split("\n")

    for filepath in changed_files:
        if not filepath.endswith(".py"):
            continue

        # remove stale chunks for this file
        client.delete(
            collection_name="repo_chunks",
            points_selector={"filter": {
                "must": [{"key": "file", "match": {"value": filepath}}]
            }}
        )

        # reindex with new version
        chunks = chunk_python_file(f"{repo_path}/{filepath}")
        points = [
            PointStruct(
                id=str(uuid.uuid4()),
                vector=embed(c["content"]),
                payload=c["metadata"] | {"content": c["content"]}
            )
            for c in chunks
        ]
        client.upsert(collection_name="repo_chunks", points=points)
```

### 3. Retrieval and LLM Evaluation

```python
def search_relevant_chunks(query: str, top_k: int = 8) -> list[str]:
    query_vector = embed(query)

    results = client.search(
        collection_name="repo_chunks",
        query_vector=query_vector,
        limit=top_k
    )

    return [r.payload["content"] for r in results]


def evaluate_story(story: dict, test_results: str) -> dict:
    query = f"{story['summary']} {story['acceptance_criteria']}"
    chunks = search_relevant_chunks(query, top_k=8)
    code_context = "\n\n---\n\n".join(chunks)

    prompt = f"""
You are a software quality auditor. Analyze ONLY the information provided below.
If there is insufficient evidence, return INCONCLUSIVE — never infer beyond what is in the context.

<thinking>
Reason step by step before emitting the final JSON.
</thinking>

## User Story
Title: {story['summary']}
Description: {story['description']}
Acceptance criteria: {story['acceptance_criteria']}

## Relevant code excerpts
{code_context}

## Test results
{test_results}

Return ONLY the JSON below, no additional text:
{{
  "verdict": "APPROVED|REJECTED|INCONCLUSIVE",
  "confidence": 0-100,
  "issues": ["list of found problems"],
  "missing_evidence": ["what was missing for a complete evaluation"]
}}
"""

    response = llm.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        temperature=0,
        messages=[{"role": "user", "content": prompt}]
    )

    import json
    return json.loads(response.content[0].text)
```

### 4. Full Pipeline

```python
def run_pipeline(repo_path: str, branch: str, story: dict) -> dict:
    test_results = fetch_test_results(branch)  # your integration

    update_chunks_from_pr(repo_path, branch)

    result = evaluate_story(story, test_results)

    save_log(branch, story["id"], result)

    return result
```

---

## Prompt Engineering Best Practices

### Force structured output

Never ask for free text. Always enforce a JSON schema:

```
Return ONLY the JSON below, no additional text:
{
  "verdict": "APPROVED|REJECTED|INCONCLUSIVE",
  "confidence": 0-100,
  "issues": [...],
  "missing_evidence": [...]
}
```

The `missing_evidence` field is critical — instead of hallucinating, the model declares what it doesn't know.

### Explicit grounding

```
Analyze ONLY the content below. Do not use external knowledge.
Every issue must cite the exact excerpt from the code or story that motivated it.
```

### Chain-of-thought

Ask the model to reason before committing to a verdict:

```
<thinking>
Reason step by step here before emitting the JSON.
</thinking>
```

The `<thinking>` block is discarded from the final output. The benefit is that the conclusion emerges from the reasoning, not the other way around.

### Temperature

Always use `temperature=0` for validation tasks. There is no benefit from creativity here.

---

## Model Selection by Layer

| Layer | Suggested model | Reason |
|---|---|---|
| Code and test analysis | Claude Opus (most capable) | Deep technical reasoning |
| Verdict synthesis | Claude Sonnet or equivalent | Input already structured, simpler task |
| Pre-triage (is the story well-formed?) | Claude Haiku or equivalent | Cheap, fast, objective task |

---

## RAG Quality: Avoiding Bad Retrieval

If retrieval fails, the model analyzes irrelevant code and misses critical context. Mitigations:

- **Hybrid search:** combine semantic search (embeddings) with lexical search (BM25) — code has very specific names that embeddings sometimes miss
- **Reranker:** after retrieving top-20 chunks, use a lightweight model to reorder and keep only top-5 before sending to the LLM
- **Structural metadata:** when indexing, add metadata like `module`, `component`, `layer` — use story labels/components to pre-filter before semantic search

---

## Caching and Deduplication

- **Prompt caching:** the system instruction part doesn't change between evaluations — with caching enabled, you only pay for the variable context input tokens
- **Content hashing:** if the same diff was already evaluated (pipeline rerun), return the cached result without calling the LLM
- **Incremental evaluation:** on PR updates, evaluate only files that changed since the last analysis

---

## Observability

Log for every evaluation:
- tokens consumed
- latency
- `confidence` score
- `verdict`

Monitor:
- High `INCONCLUSIVE` rate → context being sent is insufficient
- Evaluations with `confidence` between 60–80 → route to human review

Periodically sample human-reviewed cases to calibrate prompts.

---

## Project Structure

```
validator/
├── indexer.py        # chunking + embedding + upsert
├── retriever.py      # vector store query
├── evaluator.py      # prompt building + LLM call
├── pipeline.py       # orchestrates everything
└── llm_client.py     # LLM provider wrapper
```

---

## Summary

| Practice | Impact |
|---|---|
| Diff instead of full repo | ~80% reduction in code tokens |
| Layered pipeline | ~60% total token reduction, higher precision |
| JSON output with `missing_evidence` | Eliminates hallucination by omission |
| Temperature 0 + explicit grounding | Reduces output variability |
| Prompt/result caching | ~40% cost reduction on reruns |
| Powerful model only where needed | Balances cost vs quality |
| Incremental indexing | Scales to large repositories |

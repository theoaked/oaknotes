# Alternativas ao Claude Sonnet 4.6 (sem Anthropic)

**Contexto:** extração de requisitos funcionais de histórias do Jira + análise de cobertura por testes funcionais (código-fonte).
**Referência:** Sonnet 4.6 = US$3 / US$15 por 1M tokens (entrada/saída).
**Preços:** set/2026, sujeitos a mudança — confirmar antes de orçar.

## Candidatos

| Modelo | Preço (in/out) | Contexto | Prós | Contras |
|---|---|---|---|---|
| **GPT-6 Sol** (OpenAI) | $2 / $10 | ~1M | Mais barato que o Sonnet; JSON Schema estrito | Lançamento recente — confirmar disponibilidade |
| **GPT-5.6 Terra** (OpenAI) | $2 / $12 | ~1M | Estável, mesma faixa de qualidade | Tarifa maior acima de 272K tokens |
| **Gemini 3.1 Pro** (Google) | $2 / $12 | 1M | Ideal para suítes de teste grandes | Ainda em Preview; tarifa maior acima de 200K |
| **Gemini 3.8 Flash** (Google) | $0,75 / $3,75* | 1M | Muito barato; bom para extrair RFs | *Promo até 31/12/2026, depois $1,50 / $7,50 |
| **GPT-5.6 Luna / GPT-6 Luna** (OpenAI) | $0,20 / $1,20 · $0,10 / $0,50 | ~1M | Custo mínimo | Provavelmente fraco para cruzar RF × código |
| **Qwen3.8 Max** (Alibaba) | $2 / $6 | — | Forte em código, saída barata | Código enviado a provedor chinês |
| **GLM-5.3** (Z.AI) | $1,40 / $4,40 | — | Open-weight, pode ser self-hosted | Mesma questão de compliance se via API |
| **Kimi K3** (Moonshot) | $3 / $15 | — | Mesma faixa de preço do Sonnet | Sem ganho de custo; compliance |
| **DeepSeek V4.1 Flash** | $0,30 / $1,20 | — | Muito barato | Qualidade inferior para a tarefa; compliance |

## Recomendação

1. **Principal:** GPT-6 Sol (ou GPT-5.6 Terra).
2. **Repositórios grandes:** Gemini 3.1 Pro.
3. **Híbrido econômico:** Gemini 3.8 Flash para extrair RFs + modelo principal para a análise de cobertura.
4. **Open-weight:** só com self-hosting ou aprovação do jurídico.

## Antes de trocar

- Gabarito de 30–50 entregas já analisadas e revisadas.
- Medir precisão/recall por etapa — atenção ao falso "coberto".
- Adaptar prompts (tags XML → schema explícito; ajustar reasoning effort).
- Rodar 3–5× a mesma entrada para checar estabilidade.

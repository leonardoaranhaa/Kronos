# Plano de desenvolvimento — Kronos

Escrito em 27 de novembro de 2026, depois do levantamento do repositório.
Escopo inalterado: pesquisa, paper trading e leitura pública. Nenhuma ordem real.

## 1. Onde estamos

O projeto mediu, com uma régua séria (walk-forward com purga, Sharpe deflacionado, PBO, registro de 111 tentativas), quase tudo o que prometia:

| Pergunta | Resposta medida |
| --- | --- |
| O Kronos acerta a direção do BTC? | Não. 49–52% em 131–185 decisões, p > 0,27. M2, M3 e a regra atual reprovadas. |
| Aranha, crawler, futuros dão vantagem de direção? | Não. Todos reprovados ou inconclusivos. |
| Dá para prever o **tamanho** do movimento? | Sim, com HAR-RV: vence a vol recente nas seis células (BTC/ETH/SOL, 4h/24h). |
| Isso vira dinheiro como filtro ou tamanho de posição? | Ainda não. Todas as variantes reprovadas na régua de excesso sobre comprar e segurar. |
| O Kronos prevê o tamanho do movimento? | **Não sabemos.** O "aprovado" atual é um artefato (ver 2.1). |

Conclusão de dono: **a tese de direção está encerrada.** Não vamos gastar mais tentativas nisso sem uma fonte de informação nova. O único sinal real do projeto está em risco/volatilidade, e é para lá que o Kronos tem de provar que serve.

## 2. Problemas que precisam ser corrigidos antes de qualquer número novo

### 2.1 O baseline do Kronos-vol é degenerado (bug)

`server/volatility/kronos-vol.ts`: a "vol recente" é o quadrado de **um único** log-retorno de 6h, com piso `varianceFloor = 1e-12`. Quando o preço fica parado nessas 6h, a previsão é ~1e-12, o termo `realized / forecast` do QLIKE vai a 1e8 e a média estoura (1194,8 contra 0,99). O teste de Diebold-Mariano compara o Kronos com um espantalho. O veredito "aprovada" do Kronos-small tem de ser rebaixado para "não medido" até a correção.

### 2.2 O Kronos é amostrado com 4 caminhos

Variância amostral com n = 4 é ruído puro (erro relativo ~70%). A cobertura medida (57,7% no intervalo de 80%, 73,5% no de 95%) mostra que a dispersão é estreita demais. Qualquer conclusão sobre dispersão exige 30 amostras ou mais.

### 2.3 O holdout está queimado

O corte de 12 de agosto de 2026 já foi olhado por dezenas de tentativas. O DSR corrige parte disso, mas não substitui dado que ninguém viu. O único dado limpo que existe é **o futuro**. O plano usa um teste forward registrado (fase 4).

### 2.4 Pendências de engenharia

- PR #18 (futuros, substituto do #15) aberto.
- `npm run check` não foi rodado nesta sessão; precisa estar verde na branch antes de cada entrega.

## 3. Objetivo

Responder com um número publicado, até o fim do teste forward:

> **O Kronos-small acrescenta informação de risco que o HAR-RV não tem, e essa informação melhora o risco ajustado de uma carteira simulada?**

Se sim, ele entra no paper como medidor de risco. Se não, o resultado honesto é "o Kronos não agrega", o HAR-RV fica como ferramenta de risco e o Kronos sai do caminho de decisão. As duas respostas são entregas válidas.

## 4. Fases

Cada fase termina com um relatório em `reports/`, a tentativa no `trial-log.jsonl` e o protocolo congelado em código **antes** da conta.

### Fase 0 — Saneamento (≈ 1 semana)

1. Corrigir o baseline do Kronos-vol: vol recente = média dos quadrados dos retornos de 1h nas últimas 24h e 168h, escalada para 6h; adicionar HAR-RV no mesmo alvo de 6h como segundo baseline. Piso de variância realista (ex.: percentil 1 do treino), não 1e-12.
2. Teste de regressão: um caminho parado não pode explodir o QLIKE de nenhum baseline.
3. Rebaixar o veredito publicado do Kronos-small até a nova medição; registrar a correção no relatório.
4. Revisar e integrar ou fechar o PR #18.
5. `npm run check` verde; CI cobrindo `server/volatility`.

Saída: relatório de vol sem artefato; o número do Kronos (provavelmente pior) publicado.

### Fase 1 — Kronos como modelo de distribuição (≈ 2 semanas)

1. Worker com `sampleCount` configurável; medir 32 amostras por previsão (custo de CPU registrado no relatório).
2. Métricas de distribuição, não só de variância: CRPS, cobertura de 50/80/95%, PIT (histograma de calibração).
3. Recalibração simples e congelada no treino: fator de escala da dispersão e quantis conformais. Uma única variante, decidida antes.
4. Portão: QLIKE do Kronos recalibrado menor que o do **HAR-RV** no mesmo alvo de 6h, DM unilateral p < 0,05, ≥ 30 pontos sem sobreposição, em BTC, ETH e SOL.

### Fase 2 — O Kronos agrega ao HAR-RV? (≈ 1 semana)

1. Regressão de Mincer-Zarnowitz e teste de encompassing: HAR-RV + log-dispersão do Kronos.
2. Portão: coeficiente do Kronos significativo fora da amostra e QLIKE da combinação menor que o do HAR-RV sozinho (DM p < 0,05).
3. Se falhar aqui, o Kronos é aposentado da trilha de risco e as fases seguintes usam só o HAR-RV.

### Fase 3 — Uso econômico: vol targeting (≈ 1 semana)

Hipótese nova, registrada como tentativa nova: escalar a exposição de comprar e segurar para risco constante (alvo de vol anual fixado antes, alavancagem ≤ 1, custo de rebalanceamento cobrado).

A régua atual exige vencer comprar e segurar em retorno, o que vol targeting não promete. O portão desta fase é declarado antes e entra no código: **Sharpe maior que o de comprar e segurar, drawdown máximo menor, DSR ≥ 0,95 e PBO < 0,50.** Trocar o portão depois de ver o número é proibido; esta é a única troca, feita agora, por escrito.

### Fase 4 — Teste forward registrado (90 dias corridos)

1. Congelar no código, com hash, as estratégias que chegarem até aqui (no mínimo: comprar e segurar, vol targeting com HAR-RV, e vol targeting com a combinação, se a fase 2 passar).
2. Rodar no paper do servidor do Fly, gravando cada decisão com timestamp antes do candle seguinte.
3. Avaliar uma única vez, ao fim dos 90 dias, com o portão da fase 3. Nada é ajustado no meio.

### Fase 5 — Opcional: fine-tuning do Kronos

Só se a fase 1 mostrar habilidade de distribuição. O upstream tem rotina de fine-tuning; exige GPU e dados de cripto de 1h anteriores ao início do forward. Conferir antes as issues 307/422 (possível vazamento nos pesos publicados).

## 5. Regras que valem para todas as fases

- Protocolo e portão congelados em código antes da conta; cada execução gravada no `trial-log.jsonl`.
- Número ruim é publicado. Inconclusivo só por falta de dado.
- Orçamento de tentativas: no máximo 10 tentativas novas até o forward. Cada uma pesa no DSR.
- Sem pesquisa nova de direção sem fonte de informação nova e justificada por escrito.
- Sem chave de corretora, sem ordem real, sem mudança do modo público só de leitura.

## 6. Critérios de parada

- Fase 0 mostra o Kronos-vol pior que a vol recente corrigida → pular para a fase 3 só com HAR-RV.
- Fase 2 falha → Kronos fora da trilha de risco.
- Fase 4 reprova → publicar, manter a plataforma como ferramenta de pesquisa e leitura, e encerrar a busca de vantagem com este conjunto de dados.

## 7. Próximo passo imediato

Fase 0, item 1: corrigir o baseline em `server/volatility/kronos-vol.ts`, com teste de regressão.

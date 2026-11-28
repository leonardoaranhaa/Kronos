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

## 7. Estado — 28 de novembro de 2026

### Fase 0, itens 1 a 3: feitos

- Correção registrada como protocolo `kronos-vol-v2` (commit 5bda9e1, antes da conta). As tentativas da v1 seguem no registro.
- Testes novos: bloco parado não explode o QLIKE; o HAR do Kronos não vê o futuro; o portão exige vencer as duas referências.
- Relatório com data nova e manifesto de proveniência em `reports/kronos-vol-run.json` (hash dos candles, do cache, dos pesos, do upstream e do patch).
- Medido nesta máquina, CPU, 1.439 previsões, 1.409 pontos comparáveis:

| Previsão | QLIKE médio (menor é melhor) |
| --- | --- |
| HAR-RV de blocos de 6h | −8,289 |
| Vol realizada de 24h | −8,255 |
| Kronos-small, dispersão de 4 amostras | +1,281 |

**Kronos reprovado** (p de Diebold-Mariano = 1,00 contra as duas). O "aprovado" anterior era o defeito.

Diagnóstico, fora do registro de tentativas: a dispersão do Kronos ordena a vol (correlação de rank 0,32), mas é pequena demais (mediana 0,4× o realizado) e instável (razão de 0,05× a 2,1× entre os percentis 10 e 90). Mesmo com a melhor escala escolhida olhando o resultado (×12,6), o QLIKE fica em −7,44, ainda pior que o HAR-RV.

### O que isso muda

O critério de parada da Fase 0 disparou: o Kronos-vol perde para a vol recente corrigida. Pelo plano, a trilha de risco segue só com o HAR-RV (Fase 3).

Fica uma pergunta legítima em aberto: 4 amostras são poucas para medir dispersão (seção 2.2). Uma única rodada com 32 amostras custa cerca de 8× o tempo (≈ 30 h nesta máquina de 4 CPUs, menos com GPU). Ela só vale se for registrada antes, com o mesmo portão, e contada como tentativa.

### Pendente na Fase 0

- Item 4: PR #18 (futuros) está verde e é coerente com este plano; falta a revisão e o merge do dono.
- Item 5: `npm run check` verde nesta branch (testes, build, sintaxe do worker e do script de instalação).

## 8. Fases 3 e 4 — 28 de novembro de 2026

### Achado antes do código

O "tamanho pela vol (HAR-RV) em comprar e segurar" da vol-v1 já é o vol targeting da Fase 3: peso = mín(1, mediana das previsões do treino ÷ previsão de agora). Ele já tinha sido pontuado na janela 2024-11 a 2026-11, e os números foram vistos no levantamento, antes do critério novo. Julgar esse mesmo dado com o critério novo seria trocar a régua depois do resultado. Por isso a Fase 3 virou leitura retrospectiva, e a decisão passou inteira para o forward.

### Fase 3 — retrospectivo (não decide)

`npm run vol-target`, relatório em `reports/vol-target-latest.md`. Protocolo `vol-target-v1`, em `server/volatility/targeting.ts`.

| Célula | Sharpe | Sharpe segurar | Drawdown | Drawdown segurar | DSR | PBO |
| --- | --- | --- | --- | --- | --- | --- |
| BTC 4h | 0,07 | 0,69 | 27,4% | 29,3% | 0,250 | 0,056 |
| BTC 24h | 0,42 | 0,60 | 26,5% | 28,5% | 0,522 | 0,117 |
| ETH 4h | 0,44 | 0,63 | 35,2% | 38,0% | 0,410 | 0,171 |
| ETH 24h | 0,60 | 0,57 | 34,5% | 35,5% | 0,617 | 0,812 |
| SOL 4h | 0,71 | 0,78 | 31,8% | 37,6% | 0,629 | 0,124 |
| SOL 24h | 0,63 | 0,60 | 32,5% | 36,2% | 0,664 | 0,771 |

**Reprovado nas seis células.** O drawdown cai em todas, mas em 4 delas o Sharpe não passa o de comprar e segurar, e o DSR fica abaixo de 0,95 em todas (nas duas de 24h com Sharpe maior, ETH e SOL, o PBO também passa de 0,5). Os Sharpes recalculados aqui, com os dados baixados de novo, batem com os publicados pela vol-v1: o estudo anterior se reproduz.

### Fase 4 — forward congelado

- Mesma carteira, HAR reajustado a cada bloco só com blocos cujo rótulo já fechou (`expandingHarWeights`).
- Começa em 29/11/2026 00:00 UTC, depois do commit que congelou a regra.
- Leitura interina aos 90 dias (publicada, não decide). **Veredito aos 365 dias.** Mudança em relação à seção 4: 90 dias de retornos de 4h não separam do ruído uma diferença de Sharpe de alguns décimos. O ponto de 365 dias foi fixado antes de existir qualquer dado forward.
- Só arquivos públicos (`data.binance.vision`): candles diários e funding mensal. Um bloco só conta quando o funding do mês dele já foi publicado. Qualquer pessoa reconstrói o resultado; não depende de um gravador ao vivo nem do servidor do Fly.
- O DSR usa 6 tentativas (uma por célula); o PBO não entra, porque a carteira foi escolhida antes dos dados.
- Comandos: `npm run vol-target:import` e depois `npm run vol-target`.

### Expectativa honesta

O retrospectivo não dá motivo para otimismo: a regra perdeu para comprar e segurar no Sharpe em 4 de 6 células. O forward existe para que a resposta final venha de dado que ninguém viu, não porque se espera aprovação. Se reprovar, o critério de parada da seção 6 encerra a busca de vantagem com este conjunto de dados.

### Próximos marcos

- Início de dezembro: funding de novembro publicado; o forward passa a ter blocos.
- 27/02/2027: leitura interina.
- 29/11/2027: veredito.

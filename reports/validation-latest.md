# Validação offline

Simulação de pesquisa. Nenhuma ordem real foi enviada. Um número ruim continua publicado. Isto não é conselho de investimento.

Gerado em 2026-11-14T14:31:24.027Z. O registro de tentativas está em `reports/trial-log.jsonl`.

## Regra do veredito

**Aprovada** só quando o teste walk-forward, depois das taxas, passa de comprar e segurar, o Sharpe deflacionado fica em pelo menos 0,95, a probabilidade de backtest overfitting fica abaixo de 0,50, há pelo menos 30 observações de retorno e, se a estratégia emite direção, pelo menos 30 decisões independentes com p-valor abaixo de 0,05. Se emite P(alta), o Brier tem de ser melhor que a taxa-base.

**Reprovada** quando essa medição existe e a estratégia não passa. Perder para comprar e segurar no teste, com Sharpe calculado, reprova mesmo se o acerto ficar um pouco acima de 50% e mesmo se o DSR for quase zero. O mesmo vale se o treino também perdeu.

**Reprovada (provável sorte/overfit)** é o caso em que o ganho do treino não se repete no teste, o Sharpe do teste é positivo mas o deflacionado fica abaixo de 0,95, ou o PBO fica em 0,50 ou mais.

**Inconclusiva** só por falta de dados ou de amostra: sem modelo ou sem previsões, menos de 30 observações de retorno, ou uma série parada (nenhum trade, Sharpe inexistente). Um resultado econômico medido não fica inconclusivo.

O comando `npm run validate` mede Aranha e crawler. Para o Kronos, numa máquina com o worker Python e os pesos:

```bash
npm run validate -- --strategy kronos-m2
npm run validate -- --strategy kronos-m3
npm run validate -- --strategy kronos-rule
```

Cada um baixa BTCUSDT 1h, grava o cache de previsões e substitui só essa linha do relatório.

Os futuros públicos da Binance, depois do importador, entram com:

```bash
npm run futures:import
npm run validate -- --strategy futuros
```


## Vereditos

| Estratégia | Veredito | Excesso no teste | Sharpe | DSR | PBO | Acerto | IC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Kronos M2: regra escolhida na amostra | reprovada (provável sorte/overfit) | 7.58% | 1.41 | 0.234 | 0.020 | 49.62% (65/131) | 0.004 |
| Kronos M3: a mesma regra depois do RoPE | reprovada (provável sorte/overfit) | 8.27% | 1.60 | 0.260 | 0.017 | 48.85% (64/131) | -0.002 |
| Kronos: regra atual | reprovada (provável sorte/overfit) | 15.45% | 3.63 | 0.571 | 0.000 | 48.85% (64/131) | -0.002 |
| Aranha: análogos | reprovada | -7.41% | -3.68 | 0.010 | 0.002 | 53.62% (74/138) | 0.060 |
| Aranha: estruturas | inconclusiva | 15.43% | n/d | n/d | 0.002 | n/d | n/d |
| Aranha: persistência com filtro | reprovada | -19.95% | -6.31 | 0.000 | 0.002 | 46.25% (37/80) | -0.094 |
| Crawler: score | reprovada | -27.48% | -44.13 | 0.000 | 0.146 | 48.52% (82/169) | 0.004 |
| Crawler: momentum | reprovada | -30.83% | -47.23 | 0.000 | 0.146 | 38.46% (65/169) | -0.047 |
| Crawler: volume | reprovada | -28.42% | -44.70 | 0.000 | 0.146 | 21.33% (16/75) | -0.044 |
| Futuros BTCUSDT: logística | reprovada (provável sorte/overfit) | -28.43% | -1.64 | 0.017 | 0.076 | 48.72% (763/1566) | -0.012 |
| Futuros BTCUSDT: só direção | reprovada (provável sorte/overfit) | -52.70% | -3.16 | 0.000 | 0.076 | 48.72% (763/1566) | -0.012 |
| Futuros BTCUSDT: funding | reprovada (provável sorte/overfit) | -16.28% | -2.48 | 0.000 | 0.076 | 16.67% (1/6) | -0.053 |
| Futuros ETHUSDT: logística | reprovada (provável sorte/overfit) | -12.61% | 0.06 | 0.230 | 0.094 | 50.38% (789/1566) | -0.031 |
| Futuros ETHUSDT: só direção | reprovada | -48.75% | -2.08 | 0.005 | 0.094 | 50.38% (789/1566) | -0.031 |
| Futuros ETHUSDT: funding | reprovada (provável sorte/overfit) | -15.64% | -0.63 | 0.093 | 0.094 | 50.00% (25/50) | 0.008 |
| Futuros SOLUSDT: logística | reprovada (provável sorte/overfit) | -53.87% | -1.90 | 0.003 | 0.406 | 48.97% (760/1552) | -0.038 |
| Futuros SOLUSDT: só direção | reprovada (provável sorte/overfit) | -74.49% | -3.18 | 0.000 | 0.406 | 48.97% (760/1552) | -0.038 |
| Futuros SOLUSDT: funding | reprovada (provável sorte/overfit) | -23.97% | -0.10 | 0.116 | 0.406 | 50.92% (83/163) | 0.017 |

## Por estratégia

### Kronos M2: regra escolhida na amostra

**reprovada (provável sorte/overfit).** O Sharpe do teste é positivo, mas o Sharpe deflacionado pelo número de tentativas não chega a 0,95.

Regra congelada do M2 (long/short, 50 bps, sem filtro de média). O tokenizer fica em treino, como naquele estudo. O DSR conta as tentativas do registro, inclusive as 108 da grade, e a dispersão é o desvio-padrão dos Sharpes gravados linha a linha. O PBO desta corrida compara a regra com o último candle e com comprar e segurar.

- Retorno no teste: 4.49%. Comprar e segurar: -3.09%. Excesso: 7.58%. Excesso no treino do walk-forward: -20.06%.
- Sharpe anualizado: 1.41. Sharpe por período: 0.0521. Sharpe deflacionado: 0.234 (referência 0.1172, 111 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.020 em 12870 divisões.
- Acerto direcional: 49.62% em 131 decisões, 131 sem sobreposição. p-valor 0.5693 (binomial).
- IC: 0.004 (p=0.9700, n=131).
- Brier: 0.3440. Brier da taxa-base: 0.2500.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período 0.0152.
- Observações de retorno no teste: 131.

| P(alta) de | até | previsões | média prevista | frequência realizada |
| --- | --- | --- | --- | --- |
| 0% | 10% | 18 | 0.00% | 50.00% |
| 20% | 30% | 41 | 25.00% | 48.78% |
| 50% | 60% | 35 | 50.00% | 48.57% |
| 70% | 80% | 20 | 75.00% | 55.00% |
| 90% | 100% | 17 | 100.00% | 47.06% |

### Kronos M3: a mesma regra depois do RoPE

**reprovada (provável sorte/overfit).** O Sharpe do teste é positivo, mas o Sharpe deflacionado pelo número de tentativas não chega a 0,95.

A mesma regra do M2, com o tokenizer em eval e o patch de RoPE aplicado no checkout. Nenhuma combinação nova entra na grade. O PBO desta corrida compara a regra com o último candle e com comprar e segurar.

- Retorno no teste: 5.18%. Comprar e segurar: -3.09%. Excesso: 8.27%. Excesso no treino do walk-forward: -19.61%.
- Sharpe anualizado: 1.60. Sharpe por período: 0.0591. Sharpe deflacionado: 0.260 (referência 0.1172, 111 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.017 em 12870 divisões.
- Acerto direcional: 48.85% em 131 decisões, 131 sem sobreposição. p-valor 0.6366 (binomial).
- IC: -0.002 (p=0.9940, n=131).
- Brier: 0.3531. Brier da taxa-base: 0.2500.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período 0.0152.
- Observações de retorno no teste: 131.

| P(alta) de | até | previsões | média prevista | frequência realizada |
| --- | --- | --- | --- | --- |
| 0% | 10% | 25 | 0.00% | 48.00% |
| 20% | 30% | 33 | 25.00% | 54.55% |
| 50% | 60% | 33 | 50.00% | 42.42% |
| 70% | 80% | 23 | 75.00% | 52.17% |
| 90% | 100% | 17 | 100.00% | 52.94% |

### Kronos: regra atual

**reprovada (provável sorte/overfit).** O Sharpe do teste é positivo, mas o Sharpe deflacionado pelo número de tentativas não chega a 0,95.

Regra ao vivo: movimento mínimo de 30 bps, EMA9/EMA20 e bloqueio de RSI. O tokenizer fica em eval. O PBO desta corrida compara a regra com o último candle e com comprar e segurar.

- Retorno no teste: 12.36%. Comprar e segurar: -3.09%. Excesso: 15.45%. Excesso no treino do walk-forward: -18.56%.
- Sharpe anualizado: 3.63. Sharpe por período: 0.1344. Sharpe deflacionado: 0.571 (referência 0.1172, 111 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.000 em 12870 divisões.
- Acerto direcional: 48.85% em 131 decisões, 131 sem sobreposição. p-valor 0.6366 (binomial).
- IC: -0.002 (p=0.9940, n=131).
- Brier: 0.3531. Brier da taxa-base: 0.2500.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período 0.0623.
- Observações de retorno no teste: 131.

| P(alta) de | até | previsões | média prevista | frequência realizada |
| --- | --- | --- | --- | --- |
| 0% | 10% | 25 | 0.00% | 48.00% |
| 20% | 30% | 33 | 25.00% | 54.55% |
| 50% | 60% | 33 | 50.00% | 42.42% |
| 70% | 80% | 23 | 75.00% | 52.17% |
| 90% | 100% | 17 | 100.00% | 52.94% |

### Aranha: análogos

**reprovada.** Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. O Sharpe desta série não sustenta vantagem. Acerto perto ou acima de 50% não muda esse veredito.

Sinal dos trechos parecidos, com a regra fixa de mediana e taxa de acerto. P(alta) é a fração de análogos que subiu, só quando há vizinhos suficientes.

- Retorno no teste: -22.84%. Comprar e segurar: -15.43%. Excesso: -7.41%. Excesso no treino do walk-forward: -35.56%.
- Sharpe anualizado: -3.68. Sharpe por período: -0.1361. Sharpe deflacionado: 0.010 (referência 0.0587, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.002 em 12870 divisões.
- Acerto direcional: 53.62% em 138 decisões, 138 sem sobreposição. p-valor 0.2219 (binomial).
- IC: 0.060 (p=0.4960, n=138).
- Brier: 0.2903. Brier da taxa-base: 0.2481.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.1301.
- Observações de retorno no teste: 138.

| P(alta) de | até | previsões | média prevista | frequência realizada |
| --- | --- | --- | --- | --- |
| 20% | 30% | 9 | 25.00% | 33.33% |
| 30% | 40% | 18 | 37.50% | 38.89% |
| 50% | 60% | 33 | 50.00% | 54.55% |
| 60% | 70% | 40 | 62.50% | 42.50% |
| 70% | 80% | 27 | 75.00% | 55.56% |
| 80% | 90% | 10 | 87.50% | 30.00% |
| 90% | 100% | 1 | 100.00% | 0.00% |

### Aranha: estruturas

**inconclusiva.** A série de retornos não varia, então o Sharpe não existe. Ficar parado não é aprovação, mesmo quando comprar e segurar caiu no mesmo período.

Sinal do regime de 1h, bloqueado quando o gráfico de 5m rompe contra ele. Não produz probabilidade.

- Retorno no teste: 0.00%. Comprar e segurar: -15.43%. Excesso: 15.43%. Excesso no treino do walk-forward: -19.09%.
- Sharpe anualizado: n/d. Sharpe por período: n/d. Sharpe deflacionado: n/d (referência n/d, 3 tentativas, dispersão: n/d).
- PBO por CSCV: 0.002 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período n/d.
- Observações de retorno no teste: 138.

### Aranha: persistência com filtro

**reprovada.** Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. O Sharpe desta série não sustenta vantagem. Acerto perto ou acima de 50% não muda esse veredito.

Segue o último candle, exceto quando os análogos discordam. Não produz probabilidade.

- Retorno no teste: -35.38%. Comprar e segurar: -15.43%. Excesso: -19.95%. Excesso no treino do walk-forward: -39.49%.
- Sharpe anualizado: -6.31. Sharpe por período: -0.2335. Sharpe deflacionado: 0.000 (referência 0.0587, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.002 em 12870 divisões.
- Acerto direcional: 46.25% em 80 decisões, 80 sem sobreposição. p-valor 0.7830 (binomial).
- IC: -0.094 (p=0.3940, n=80).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.2106.
- Observações de retorno no teste: 138.

### Crawler: score

**reprovada.** Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. O Sharpe desta série não sustenta vantagem. Acerto perto ou acima de 50% não muda esse veredito.

Carteira igual das 3 moedas com maior score. O IC é a média do Spearman entre o score e o retorno das 12 velas seguintes, moeda a moeda.

- Retorno no teste: -39.19%. Comprar e segurar: -11.71%. Excesso: -27.48%. Excesso no treino do walk-forward: -22.26%.
- Sharpe anualizado: -44.13. Sharpe por período: -0.4714. Sharpe deflacionado: 0.000 (referência 0.0150, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.146 em 12870 divisões.
- Acerto direcional: 48.52% em 169 decisões, 169 sem sobreposição. p-valor 0.6777 (binomial).
- IC: 0.004 (p=0.7620, n=283).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.4471.
- Observações de retorno no teste: 169.

### Crawler: momentum

**reprovada.** Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. O Sharpe desta série não sustenta vantagem. Acerto perto ou acima de 50% não muda esse veredito.

A mesma carteira, ordenada só pelo retorno da última hora.

- Retorno no teste: -42.53%. Comprar e segurar: -11.71%. Excesso: -30.83%. Excesso no treino do walk-forward: -22.76%.
- Sharpe anualizado: -47.23. Sharpe por período: -0.5044. Sharpe deflacionado: 0.000 (referência 0.0150, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.146 em 12870 divisões.
- Acerto direcional: 38.46% em 169 decisões, 169 sem sobreposição. p-valor 0.9990 (binomial).
- IC: -0.047 (p=0.0080, n=283).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.4747.
- Observações de retorno no teste: 169.

### Crawler: volume

**reprovada.** Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. O Sharpe desta série não sustenta vantagem. Acerto perto ou acima de 50% não muda esse veredito.

A mesma carteira, ordenada só pelo volume anormal com o sinal da vela.

- Retorno no teste: -40.13%. Comprar e segurar: -11.71%. Excesso: -28.42%. Excesso no treino do walk-forward: -22.74%.
- Sharpe anualizado: -44.70. Sharpe por período: -0.4774. Sharpe deflacionado: 0.000 (referência 0.0150, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.146 em 12870 divisões.
- Acerto direcional: 21.33% em 75 decisões, 75 sem sobreposição. p-valor 1.0000 (binomial).
- IC: -0.044 (p=0.0240, n=203).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.4187.
- Observações de retorno no teste: 169.

### Futuros BTCUSDT: logística

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Compra só com P(alta) ≥ 0,55 e retorno previsto acima do custo de ida e volta. Vende no espelho. O restante fica zerado. Horizonte de 4 horas, sem sobreposição, em BTCUSDT perp 1h. Cada decisão usa só o que já tinha fechado. O modelo de cada bloco de teste não vê o rótulo desse bloco. Custo de ida e volta: 0.12% (taxa taker de 5 bps e slippage de 1 bp por lado). Comprar e segurar paga o funding do perp e uma ida e volta no período inteiro, não a cada bloco. Regra gravada em 2026-11-14T14:30:00.000Z, antes deste teste. P(alta) no teste interno: p10 0.442, mediana 0.505, p90 0.570. 1742 decisões ficaram só no treino inicial e não entram no placar. Posições diferentes de zero: 233 de 2612.

- Retorno no teste: -15.70%. Comprar e segurar: 12.74%. Excesso: -28.43%. Excesso no treino do walk-forward: 25.97%.
- Sharpe anualizado: -1.64. Sharpe por período: -0.0350. Sharpe deflacionado: 0.017 (referência 0.0139, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.076 em 12870 divisões.
- Acerto direcional: 48.72% em 1566 decisões, 1566 sem sobreposição. p-valor 0.8499 (binomial).
- IC: -0.012 (p=0.6000, n=1566).
- Brier: 0.2516. Brier da taxa-base: 0.2500.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0380.
- Observações de retorno no teste: 1566.

| P(alta) de | até | previsões | média prevista | frequência realizada |
| --- | --- | --- | --- | --- |
| 20% | 30% | 5 | 27.15% | 40.00% |
| 30% | 40% | 26 | 37.08% | 46.15% |
| 40% | 50% | 686 | 47.02% | 49.71% |
| 50% | 60% | 805 | 53.45% | 51.93% |
| 60% | 70% | 41 | 62.49% | 41.46% |
| 70% | 80% | 3 | 70.83% | 33.33% |

### Futuros BTCUSDT: só direção

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O mesmo modelo. Compra com P(alta) ≥ 0,55 e vende com P(alta) ≤ 0,45, sem exigir o tamanho previsto. Horizonte de 4 horas, sem sobreposição, em BTCUSDT perp 1h. Cada decisão usa só o que já tinha fechado. O modelo de cada bloco de teste não vê o rótulo desse bloco. Custo de ida e volta: 0.12% (taxa taker de 5 bps e slippage de 1 bp por lado). Comprar e segurar paga o funding do perp e uma ida e volta no período inteiro, não a cada bloco. Regra gravada em 2026-11-14T14:30:00.000Z, antes deste teste. P(alta) no teste interno: p10 0.442, mediana 0.505, p90 0.570. 1742 decisões ficaram só no treino inicial e não entram no placar. Posições diferentes de zero: 779 de 2612.

- Retorno no teste: -39.96%. Comprar e segurar: 12.74%. Excesso: -52.70%. Excesso no treino do walk-forward: 5.66%.
- Sharpe anualizado: -3.16. Sharpe por período: -0.0675. Sharpe deflacionado: 0.000 (referência 0.0139, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.076 em 12870 divisões.
- Acerto direcional: 48.72% em 1566 decisões, 1566 sem sobreposição. p-valor 0.8499 (binomial).
- IC: -0.012 (p=0.6000, n=1566).
- Brier: 0.2516. Brier da taxa-base: 0.2500.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0655.
- Observações de retorno no teste: 1566.

| P(alta) de | até | previsões | média prevista | frequência realizada |
| --- | --- | --- | --- | --- |
| 20% | 30% | 5 | 27.15% | 40.00% |
| 30% | 40% | 26 | 37.08% | 46.15% |
| 40% | 50% | 686 | 47.02% | 49.71% |
| 50% | 60% | 805 | 53.45% | 51.93% |
| 60% | 70% | 41 | 62.49% | 41.46% |
| 70% | 80% | 3 | 70.83% | 33.33% |

### Futuros BTCUSDT: funding

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Sem ajuste. Vende se o funding passa de 3 bps e compra se fica abaixo de −1 bp. É a regra de referência, não um modelo. Horizonte de 4 horas, sem sobreposição, em BTCUSDT perp 1h. Cada decisão usa só o que já tinha fechado. O modelo de cada bloco de teste não vê o rótulo desse bloco. Custo de ida e volta: 0.12% (taxa taker de 5 bps e slippage de 1 bp por lado). Comprar e segurar paga o funding do perp e uma ida e volta no período inteiro, não a cada bloco. Regra gravada em 2026-11-14T14:30:00.000Z, antes deste teste. P(alta) no teste interno: p10 0.442, mediana 0.505, p90 0.570. 1742 decisões ficaram só no treino inicial e não entram no placar. Posições diferentes de zero: 14 de 2612.

- Retorno no teste: -3.55%. Comprar e segurar: 12.74%. Excesso: -16.28%. Excesso no treino do walk-forward: 45.96%.
- Sharpe anualizado: -2.48. Sharpe por período: -0.0529. Sharpe deflacionado: 0.000 (referência 0.0139, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.076 em 12870 divisões.
- Acerto direcional: 16.67% em 6 decisões, 6 sem sobreposição. p-valor 0.9844 (binomial).
- IC: -0.053 (p=0.0280, n=1566).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período 0.0214.
- Observações de retorno no teste: 1566.

### Futuros ETHUSDT: logística

**reprovada (provável sorte/overfit).** O Sharpe do teste é positivo, mas o Sharpe deflacionado pelo número de tentativas não chega a 0,95.

Compra só com P(alta) ≥ 0,55 e retorno previsto acima do custo de ida e volta. Vende no espelho. O restante fica zerado. Horizonte de 4 horas, sem sobreposição, em ETHUSDT perp 1h. Cada decisão usa só o que já tinha fechado. O modelo de cada bloco de teste não vê o rótulo desse bloco. Custo de ida e volta: 0.12% (taxa taker de 5 bps e slippage de 1 bp por lado). Comprar e segurar paga o funding do perp e uma ida e volta no período inteiro, não a cada bloco. Regra gravada em 2026-11-14T14:30:00.000Z, antes deste teste. P(alta) no teste interno: p10 0.445, mediana 0.514, p90 0.571. 1741 decisões ficaram só no treino inicial e não entram no placar. Posições diferentes de zero: 548 de 2610.

- Retorno no teste: -0.48%. Comprar e segurar: 12.13%. Excesso: -12.61%. Excesso no treino do walk-forward: -1.49%.
- Sharpe anualizado: 0.06. Sharpe por período: 0.0013. Sharpe deflacionado: 0.230 (referência 0.0199, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.094 em 12870 divisões.
- Acerto direcional: 50.38% em 1566 decisões, 1566 sem sobreposição. p-valor 0.3905 (binomial).
- IC: -0.031 (p=0.2220, n=1566).
- Brier: 0.2508. Brier da taxa-base: 0.2499.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0335.
- Observações de retorno no teste: 1566.

| P(alta) de | até | previsões | média prevista | frequência realizada |
| --- | --- | --- | --- | --- |
| 30% | 40% | 9 | 35.77% | 55.56% |
| 40% | 50% | 521 | 48.03% | 52.02% |
| 50% | 60% | 1010 | 53.24% | 50.79% |
| 60% | 70% | 24 | 62.48% | 54.17% |
| 70% | 80% | 2 | 71.59% | 0.00% |

### Futuros ETHUSDT: só direção

**reprovada.** Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. O Sharpe desta série não sustenta vantagem. Acerto perto ou acima de 50% não muda esse veredito.

O mesmo modelo. Compra com P(alta) ≥ 0,55 e vende com P(alta) ≤ 0,45, sem exigir o tamanho previsto. Horizonte de 4 horas, sem sobreposição, em ETHUSDT perp 1h. Cada decisão usa só o que já tinha fechado. O modelo de cada bloco de teste não vê o rótulo desse bloco. Custo de ida e volta: 0.12% (taxa taker de 5 bps e slippage de 1 bp por lado). Comprar e segurar paga o funding do perp e uma ida e volta no período inteiro, não a cada bloco. Regra gravada em 2026-11-14T14:30:00.000Z, antes deste teste. P(alta) no teste interno: p10 0.445, mediana 0.514, p90 0.571. 1741 decisões ficaram só no treino inicial e não entram no placar. Posições diferentes de zero: 794 de 2610.

- Retorno no teste: -36.62%. Comprar e segurar: 12.13%. Excesso: -48.75%. Excesso no treino do walk-forward: -5.54%.
- Sharpe anualizado: -2.08. Sharpe por período: -0.0445. Sharpe deflacionado: 0.005 (referência 0.0199, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.094 em 12870 divisões.
- Acerto direcional: 50.38% em 1566 decisões, 1566 sem sobreposição. p-valor 0.3905 (binomial).
- IC: -0.031 (p=0.2220, n=1566).
- Brier: 0.2508. Brier da taxa-base: 0.2499.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0499.
- Observações de retorno no teste: 1566.

| P(alta) de | até | previsões | média prevista | frequência realizada |
| --- | --- | --- | --- | --- |
| 30% | 40% | 9 | 35.77% | 55.56% |
| 40% | 50% | 521 | 48.03% | 52.02% |
| 50% | 60% | 1010 | 53.24% | 50.79% |
| 60% | 70% | 24 | 62.48% | 54.17% |
| 70% | 80% | 2 | 71.59% | 0.00% |

### Futuros ETHUSDT: funding

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Sem ajuste. Vende se o funding passa de 3 bps e compra se fica abaixo de −1 bp. É a regra de referência, não um modelo. Horizonte de 4 horas, sem sobreposição, em ETHUSDT perp 1h. Cada decisão usa só o que já tinha fechado. O modelo de cada bloco de teste não vê o rótulo desse bloco. Custo de ida e volta: 0.12% (taxa taker de 5 bps e slippage de 1 bp por lado). Comprar e segurar paga o funding do perp e uma ida e volta no período inteiro, não a cada bloco. Regra gravada em 2026-11-14T14:30:00.000Z, antes deste teste. P(alta) no teste interno: p10 0.445, mediana 0.514, p90 0.571. 1741 decisões ficaram só no treino inicial e não entram no placar. Posições diferentes de zero: 64 de 2610.

- Retorno no teste: -3.51%. Comprar e segurar: 12.13%. Excesso: -15.64%. Excesso no treino do walk-forward: 47.96%.
- Sharpe anualizado: -0.63. Sharpe por período: -0.0134. Sharpe deflacionado: 0.093 (referência 0.0199, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.094 em 12870 divisões.
- Acerto direcional: 50.00% em 50 decisões, 50 sem sobreposição. p-valor 0.5561 (binomial).
- IC: 0.008 (p=0.7700, n=1566).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0165.
- Observações de retorno no teste: 1566.

### Futuros SOLUSDT: logística

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Compra só com P(alta) ≥ 0,55 e retorno previsto acima do custo de ida e volta. Vende no espelho. O restante fica zerado. Horizonte de 4 horas, sem sobreposição, em SOLUSDT perp 1h. Cada decisão usa só o que já tinha fechado. O modelo de cada bloco de teste não vê o rótulo desse bloco. Custo de ida e volta: 0.12% (taxa taker de 5 bps e slippage de 1 bp por lado). Comprar e segurar paga o funding do perp e uma ida e volta no período inteiro, não a cada bloco. Regra gravada em 2026-11-14T14:30:00.000Z, antes deste teste. P(alta) no teste interno: p10 0.443, mediana 0.504, p90 0.562. 1738 decisões ficaram só no treino inicial e não entram no placar. Posições diferentes de zero: 547 de 2607.

- Retorno no teste: -32.34%. Comprar e segurar: 21.53%. Excesso: -53.87%. Excesso no treino do walk-forward: 27.63%.
- Sharpe anualizado: -1.90. Sharpe por período: -0.0405. Sharpe deflacionado: 0.003 (referência 0.0281, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.406 em 12870 divisões.
- Acerto direcional: 48.97% em 1552 decisões, 1552 sem sobreposição. p-valor 0.7989 (binomial).
- IC: -0.038 (p=0.1100, n=1563).
- Brier: 0.2515. Brier da taxa-base: 0.2500.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0297.
- Observações de retorno no teste: 1563.

| P(alta) de | até | previsões | média prevista | frequência realizada |
| --- | --- | --- | --- | --- |
| 30% | 40% | 20 | 37.66% | 45.00% |
| 40% | 50% | 653 | 47.02% | 50.23% |
| 50% | 60% | 869 | 53.25% | 50.17% |
| 60% | 70% | 21 | 61.27% | 42.86% |

### Futuros SOLUSDT: só direção

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O mesmo modelo. Compra com P(alta) ≥ 0,55 e vende com P(alta) ≤ 0,45, sem exigir o tamanho previsto. Horizonte de 4 horas, sem sobreposição, em SOLUSDT perp 1h. Cada decisão usa só o que já tinha fechado. O modelo de cada bloco de teste não vê o rótulo desse bloco. Custo de ida e volta: 0.12% (taxa taker de 5 bps e slippage de 1 bp por lado). Comprar e segurar paga o funding do perp e uma ida e volta no período inteiro, não a cada bloco. Regra gravada em 2026-11-14T14:30:00.000Z, antes deste teste. P(alta) no teste interno: p10 0.443, mediana 0.504, p90 0.562. 1738 decisões ficaram só no treino inicial e não entram no placar. Posições diferentes de zero: 738 de 2607.

- Retorno no teste: -52.96%. Comprar e segurar: 21.53%. Excesso: -74.49%. Excesso no treino do walk-forward: 39.43%.
- Sharpe anualizado: -3.18. Sharpe por período: -0.0679. Sharpe deflacionado: 0.000 (referência 0.0281, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.406 em 12870 divisões.
- Acerto direcional: 48.97% em 1552 decisões, 1552 sem sobreposição. p-valor 0.7989 (binomial).
- IC: -0.038 (p=0.1100, n=1563).
- Brier: 0.2515. Brier da taxa-base: 0.2500.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0339.
- Observações de retorno no teste: 1563.

| P(alta) de | até | previsões | média prevista | frequência realizada |
| --- | --- | --- | --- | --- |
| 30% | 40% | 20 | 37.66% | 45.00% |
| 40% | 50% | 653 | 47.02% | 50.23% |
| 50% | 60% | 869 | 53.25% | 50.17% |
| 60% | 70% | 21 | 61.27% | 42.86% |

### Futuros SOLUSDT: funding

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Sem ajuste. Vende se o funding passa de 3 bps e compra se fica abaixo de −1 bp. É a regra de referência, não um modelo. Horizonte de 4 horas, sem sobreposição, em SOLUSDT perp 1h. Cada decisão usa só o que já tinha fechado. O modelo de cada bloco de teste não vê o rótulo desse bloco. Custo de ida e volta: 0.12% (taxa taker de 5 bps e slippage de 1 bp por lado). Comprar e segurar paga o funding do perp e uma ida e volta no período inteiro, não a cada bloco. Regra gravada em 2026-11-14T14:30:00.000Z, antes deste teste. P(alta) no teste interno: p10 0.443, mediana 0.504, p90 0.562. 1738 decisões ficaram só no treino inicial e não entram no placar. Posições diferentes de zero: 273 de 2607.

- Retorno no teste: -2.44%. Comprar e segurar: 21.53%. Excesso: -23.97%. Excesso no treino do walk-forward: 27.08%.
- Sharpe anualizado: -0.10. Sharpe por período: -0.0022. Sharpe deflacionado: 0.116 (referência 0.0281, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.406 em 12870 divisões.
- Acerto direcional: 50.92% em 163 decisões, 163 sem sobreposição. p-valor 0.4378 (binomial).
- IC: 0.017 (p=0.4920, n=1563).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0275.
- Observações de retorno no teste: 1563.

## Dados

- BTCUSDT 1h: 2880 candles, 2026-07-17T13:00:00.000Z a 2026-11-14T12:00:00.000Z. SHA-256 6953cf118db4c4091a07fbe21fc204ed0bf2d00868236bd6b8bab81c8d2bfd10. Fonte: https://data-api.binance.vision/api/v3/klines.
- BTCUSDT 1h: 2879 candles, 2026-07-17T14:00:00.000Z a 2026-11-14T12:00:00.000Z. SHA-256 7b78044c683cd74a201f0ba7cb9f7292fecd558521b7b5061b4d645eb0268715. Fonte: https://data-api.binance.vision/api/v3/klines.
- BTCUSDT 5m: 3455 candles, 2026-11-02T13:35:00.000Z a 2026-11-14T13:25:00.000Z. SHA-256 e4de4f70deb179cbe8047d5c6ae7973c89e06a58045624fdf0da6e1650b85059. Fonte: https://data-api.binance.vision/api/v3/klines.
- ETHUSDT 5m: 3456 candles, 2026-11-02T13:35:00.000Z a 2026-11-14T13:30:00.000Z. SHA-256 8d24167573daa50d4ee70a7d163181fb3710f37e502adbe870f4ea679f8d75ba. Fonte: https://data-api.binance.vision/api/v3/klines.
- BNBUSDT 5m: 3456 candles, 2026-11-02T13:35:00.000Z a 2026-11-14T13:30:00.000Z. SHA-256 9e60d4fd7cb1083d8f6593b352d656c585cce71c2ab77eaf397d37b057c413ff. Fonte: https://data-api.binance.vision/api/v3/klines.
- SOLUSDT 5m: 3456 candles, 2026-11-02T13:35:00.000Z a 2026-11-14T13:30:00.000Z. SHA-256 91234eedc214bd1193157760a9fb86b98c93cb90b86e6a20b513696f27cd8983. Fonte: https://data-api.binance.vision/api/v3/klines.
- XRPUSDT 5m: 3456 candles, 2026-11-02T13:35:00.000Z a 2026-11-14T13:30:00.000Z. SHA-256 6e50539d2ebca5ee8a36576e1240badd25b46752fd6dccfbceff2d822134d69d. Fonte: https://data-api.binance.vision/api/v3/klines.
- DOGEUSDT 5m: 3456 candles, 2026-11-02T13:35:00.000Z a 2026-11-14T13:30:00.000Z. SHA-256 6565aac24d3ace7b1c362891eabff8b68576747f16d89b059c9bfd92cf5405e6. Fonte: https://data-api.binance.vision/api/v3/klines.
- ADAUSDT 5m: 3456 candles, 2026-11-02T13:35:00.000Z a 2026-11-14T13:30:00.000Z. SHA-256 022730ec6addf6339d69ed2284f045c2ecae27b6f7cb674d0901bf883e40373c. Fonte: https://data-api.binance.vision/api/v3/klines.
- AVAXUSDT 5m: 3456 candles, 2026-11-02T13:35:00.000Z a 2026-11-14T13:30:00.000Z. SHA-256 f0114346d61b480a1b927e378bf2fd8847d98948b43a16b71788e75c074ab230. Fonte: https://data-api.binance.vision/api/v3/klines.
- LINKUSDT 5m: 3456 candles, 2026-11-02T13:35:00.000Z a 2026-11-14T13:30:00.000Z. SHA-256 b8bc7c2b40e535c366678d4e78b78086fad4f16a0395dc9426d557073f85ccc7. Fonte: https://data-api.binance.vision/api/v3/klines.
- DOTUSDT 5m: 3456 candles, 2026-11-02T13:35:00.000Z a 2026-11-14T13:30:00.000Z. SHA-256 6468e1259d09fcf6646c6edc258a0390a5c47c042914e16e743cbc4ba184a8dc. Fonte: https://data-api.binance.vision/api/v3/klines.
- LTCUSDT 5m: 3456 candles, 2026-11-02T13:35:00.000Z a 2026-11-14T13:30:00.000Z. SHA-256 55b2cb161a2e5286f3b4769ea2c40fbf32832d528016a42cabb87ad33cf8509d. Fonte: https://data-api.binance.vision/api/v3/klines.
- BCHUSDT 5m: 3456 candles, 2026-11-02T13:35:00.000Z a 2026-11-14T13:30:00.000Z. SHA-256 8f30e71ca36c0a9d56b82c2903e0c27fceb9638568a4153781c6c590c3bc2b6a. Fonte: https://data-api.binance.vision/api/v3/klines.
- BTCUSDT 1h: 17520 candles, 2024-11-01T00:00:00.000Z a 2026-10-31T23:00:00.000Z. SHA-256 c32d91c8daf3f39dcc7e3eaa57bac2a92244ad6a9dd6139c78639f929a8b795e. Fonte: https://data.binance.vision/data/futures/um.
- ETHUSDT 1h: 17520 candles, 2024-11-01T00:00:00.000Z a 2026-10-31T23:00:00.000Z. SHA-256 4bd296f48ed1db85dcc4544aaf24b20a8ca3bd2d7693319780fdc016f17ec2ec. Fonte: https://data.binance.vision/data/futures/um.
- SOLUSDT 1h: 17520 candles, 2024-11-01T00:00:00.000Z a 2026-10-31T23:00:00.000Z. SHA-256 0bafb5f4f96be6165b7d4326339eccb501b60a77684c059f772313597f91f9cc. Fonte: https://data.binance.vision/data/futures/um.

## Tentativas registradas

- kronos: 111
- aranha: 3
- crawler: 3
- futuros-btcusdt: 3
- futuros-ethusdt: 3
- futuros-solusdt: 3

## Notas

- Nenhuma ordem foi enviada. O módulo de execução legado não entra nesta conta.
- O Sharpe deflacionado segue Bailey e López de Prado. O PBO segue a validação cruzada simétrica combinatória de Bailey, Borwein, López de Prado e Zhu. O código é próprio; pypbo, que é AGPL, não é importado.
- Decisões cujo horizonte se sobrepõe não entram no teste binomial como se fossem independentes. O p-valor usado é o mais alto entre o binomial das decisões sem sobreposição e, quando há sobreposição, um bootstrap em blocos.
- No crawler, a carteira é reavaliada a cada 12 candles de 5 minutos e segurada por essas mesmas 12 velas. Janelas de 4h e 24h do estudo antigo se sobrepõem e não entram no veredito.
- Kronos M2: regra escolhida na amostra foi medido com o worker local. O cache fica em data/research-cache/.
- Kronos M3: a mesma regra depois do RoPE foi medido com o worker local. O cache fica em data/research-cache/.
- Kronos: regra atual foi medido com o worker local. O cache fica em data/research-cache/.
- O DSR do Kronos usa o desvio-padrão dos Sharpes gravados no registro, um por tentativa medida. A grade M2 soma 108 na contagem; aquelas combinações não têm Sharpe individual no arquivo antigo.
- Futuros: BTCUSDT 17520 candles de 1h, 2190 fundings, 210237 métricas, 17471 horas de livro. Dias sem métrica: 0. Dias sem livro: 1. aggTrades de 2026-10-29, 2026-10-30, 2026-10-31: 72 horas, diferença média absoluta do taker buy 0.006806 contratos da unidade base, máxima 0.129000.
- Futuros: sonda 200 https://data.binance.vision/data/futures/um/daily/metrics/BTCUSDT/BTCUSDT-metrics-2020-10-01.zip.
- Futuros: sonda 404 https://data.binance.vision/data/futures/um/daily/bookDepth/BTCUSDT/BTCUSDT-bookDepth-2022-12-01.zip (HTTP 404).
- Futuros: sonda 200 https://data.binance.vision/data/futures/um/daily/bookDepth/BTCUSDT/BTCUSDT-bookDepth-2023-03-01.zip.
- Futuros: sonda 404 https://data.binance.vision/data/futures/um/daily/liquidationSnapshot/BTCUSDT/BTCUSDT-liquidationSnapshot-2025-11-01.zip (HTTP 404).
- Futuros: sonda 451 https://fapi.binance.com/fapi/v1/allForceOrders?symbol=BTCUSDT&limit=1 (HTTP 451).
- Futuros: ETHUSDT 17520 candles de 1h, 2190 fundings, 210237 métricas, 17471 horas de livro. Dias sem métrica: 0. Dias sem livro: 1. aggTrades de 2026-10-29, 2026-10-30, 2026-10-31: 72 horas, diferença média absoluta do taker buy 0.303639 contratos da unidade base, máxima 10.931000.
- Futuros: SOLUSDT 17520 candles de 1h, 2190 fundings, 210237 métricas, 17447 horas de livro. Dias sem métrica: 0. Dias sem livro: 2. aggTrades de 2026-10-29, 2026-10-30, 2026-10-31: 72 horas, diferença média absoluta do taker buy 0.000000 contratos da unidade base, máxima 0.000000.
- Futuros: o modelo é regressão logística para a direção e ridge para o tamanho do retorno. LightGBM e CatBoost não entram, para o teste ficar determinístico e sem biblioteca nativa. As três regras foram gravadas antes do teste e nenhuma foi trocada depois.
- Futuros: liquidações não entram no modelo. O dump público diário não está em data.binance.vision. O coletor ao vivo tenta o websocket forceOrder e o REST allForceOrders, sem chave.
- Futuros: o CVD e o desequilíbrio de agressão usados no modelo vêm do taker buy/sell de cada candle de 1h, que é o agregado público das aggTrades. O livro entra como desequilíbrio de nocional a 1% do bookDepth. O OFI de melhor oferta é só do coletor ao vivo, porque o histórico tick a tick do book não foi baixado.
- Futuros: a janela congelada é 2024-11-01T00:00:00.000Z a 2026-11-01T00:00:00.000Z. Histórico anterior que a sonda achar não foi usado. Alongar a janela seria outro teste, com registro novo.

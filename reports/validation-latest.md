# Validação offline

Simulação de pesquisa. Nenhuma ordem real foi enviada. Um número ruim continua publicado. Isto não é conselho de investimento.

Gerado em 2026-11-14T13:27:09.094Z. O registro de tentativas está em `reports/trial-log.jsonl`.

Uma estratégia só fica **aprovada** com pelo menos 30 decisões independentes no teste walk-forward, retorno depois das taxas acima de comprar e segurar, Sharpe deflacionado de pelo menos 0,95 e probabilidade de backtest overfitting abaixo de 0,50. Se ela emite direção, o teste dependente também precisa ficar abaixo de 0,05. Se emite P(alta), o Brier precisa bater a taxa-base.

**Reprovada (provável sorte/overfit)** é um ganho que não se repetiu no teste, um Sharpe positivo que o número de tentativas esvazia, ou um menu cujo vencedor de um bloco perde no bloco complementar. O resto fica **inconclusiva**.

## Vereditos

| Estratégia | Veredito | Excesso no teste | Sharpe | DSR | PBO | Acerto | IC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Kronos M2: regra escolhida na amostra | inconclusiva | n/d | n/d | n/d | n/d | n/d | n/d |
| Kronos M3: a mesma regra depois do RoPE | inconclusiva | n/d | n/d | n/d | n/d | n/d | n/d |
| Kronos: regra atual | inconclusiva | n/d | n/d | n/d | n/d | n/d | n/d |
| Aranha: análogos | inconclusiva | -7.41% | -3.68 | 0.007 | 0.002 | 53.62% (74/138) | 0.060 |
| Aranha: estruturas | inconclusiva | 15.43% | n/d | n/d | 0.002 | n/d | n/d |
| Aranha: persistência com filtro | inconclusiva | -19.95% | -6.31 | 0.000 | 0.002 | 46.25% (37/80) | -0.094 |
| Crawler: score | inconclusiva | -28.46% | -46.69 | 0.000 | 0.013 | 46.43% (78/168) | -0.004 |
| Crawler: momentum | inconclusiva | -29.35% | -49.91 | 0.000 | 0.013 | 41.42% (70/169) | -0.044 |
| Crawler: volume | inconclusiva | -26.76% | -42.72 | 0.000 | 0.013 | 25.30% (21/83) | -0.014 |

## Por estratégia

### Kronos M2: regra escolhida na amostra

**inconclusiva.** Não há previsões em cache nem o modelo local para refazer o teste. Os números dos relatórios M2 e M3 não foram copiados para cá.

A grade de 108 combinações está no registro de tentativas, sem o Sharpe de cada uma.

Nenhum número novo foi calculado nesta corrida.

### Kronos M3: a mesma regra depois do RoPE

**inconclusiva.** Não há previsões em cache nem o modelo local para refazer o teste. Os números dos relatórios M2 e M3 não foram copiados para cá.

O M3 não buscou regra nova. Sem o mesmo snapshot e sem as previsões, a comparação antes/depois não foi refeita.

Nenhum número novo foi calculado nesta corrida.

### Kronos: regra atual

**inconclusiva.** Não há previsões em cache nem o modelo local para refazer o teste. Os números dos relatórios M2 e M3 não foram copiados para cá.

A regra atual usa a previsão do modelo, o filtro de média e o bloqueio de RSI. Sem previsão, não há o que validar.

Nenhum número novo foi calculado nesta corrida.

### Aranha: análogos

**inconclusiva.** Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. Não há aprovação e não há um ganho de amostra que o teste tenha derrubado.

Sinal dos trechos parecidos, com a regra fixa de mediana e taxa de acerto. P(alta) é a fração de análogos que subiu, só quando há vizinhos suficientes.

- Retorno no teste: -22.84%. Comprar e segurar: -15.43%. Excesso: -7.41%. Excesso no treino do walk-forward: -35.56%.
- Sharpe anualizado: -3.68. Sharpe por período: -0.1361. Sharpe deflacionado: 0.007 (referência 0.0718, 3 tentativas, dispersão: erro-padrao).
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

**inconclusiva.** Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. Não há aprovação e não há um ganho de amostra que o teste tenha derrubado.

Segue o último candle, exceto quando os análogos discordam. Não produz probabilidade.

- Retorno no teste: -35.38%. Comprar e segurar: -15.43%. Excesso: -19.95%. Excesso no treino do walk-forward: -39.49%.
- Sharpe anualizado: -6.31. Sharpe por período: -0.2335. Sharpe deflacionado: 0.000 (referência 0.0731, 3 tentativas, dispersão: erro-padrao).
- PBO por CSCV: 0.002 em 12870 divisões.
- Acerto direcional: 46.25% em 80 decisões, 80 sem sobreposição. p-valor 0.7830 (binomial).
- IC: -0.094 (p=0.3940, n=80).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.2106.
- Observações de retorno no teste: 138.

### Crawler: score

**inconclusiva.** Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. Não há aprovação e não há um ganho de amostra que o teste tenha derrubado.

Carteira igual das 3 moedas com maior score. O IC é a média do Spearman entre o score e o retorno das 12 velas seguintes, moeda a moeda.

- Retorno no teste: -40.14%. Comprar e segurar: -11.69%. Excesso: -28.46%. Excesso no treino do walk-forward: -26.08%.
- Sharpe anualizado: -46.69. Sharpe por período: -0.4987. Sharpe deflacionado: 0.000 (referência 0.0328, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.013 em 12870 divisões.
- Acerto direcional: 46.43% em 168 decisões, 168 sem sobreposição. p-valor 0.8421 (binomial).
- IC: -0.004 (p=0.8180, n=283).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.4617.
- Observações de retorno no teste: 169.

### Crawler: momentum

**inconclusiva.** Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. Não há aprovação e não há um ganho de amostra que o teste tenha derrubado.

A mesma carteira, ordenada só pelo retorno da última hora.

- Retorno no teste: -41.04%. Comprar e segurar: -11.69%. Excesso: -29.35%. Excesso no treino do walk-forward: -23.39%.
- Sharpe anualizado: -49.91. Sharpe por período: -0.5331. Sharpe deflacionado: 0.000 (referência 0.0328, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.013 em 12870 divisões.
- Acerto direcional: 41.42% em 169 decisões, 169 sem sobreposição. p-valor 0.9896 (binomial).
- IC: -0.044 (p=0.0220, n=283).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.4869.
- Observações de retorno no teste: 169.

### Crawler: volume

**inconclusiva.** Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. Não há aprovação e não há um ganho de amostra que o teste tenha derrubado.

A mesma carteira, ordenada só pelo volume anormal com o sinal da vela.

- Retorno no teste: -38.45%. Comprar e segurar: -11.69%. Excesso: -26.76%. Excesso no treino do walk-forward: -23.91%.
- Sharpe anualizado: -42.72. Sharpe por período: -0.4563. Sharpe deflacionado: 0.000 (referência 0.0328, 3 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.013 em 12870 divisões.
- Acerto direcional: 25.30% em 83 decisões, 83 sem sobreposição. p-valor 1.0000 (binomial).
- IC: -0.014 (p=0.4880, n=213).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.3781.
- Observações de retorno no teste: 169.

## Dados

- BTCUSDT 1h: 2879 candles, 2026-07-17T14:00:00.000Z a 2026-11-14T12:00:00.000Z. SHA-256 0921b2d3feafa78ae1bf839f9b916ee5efb9673dee88b5782e6a847db3d45790. Fonte: https://data-api.binance.vision/api/v3/klines.
- BTCUSDT 5m: 3455 candles, 2026-11-02T13:30:00.000Z a 2026-11-14T13:20:00.000Z. SHA-256 9026d47618ceb9949a10e95630224878c0db58b222bf3760ac2939976d9106ee. Fonte: https://data-api.binance.vision/api/v3/klines.
- ETHUSDT 5m: 3455 candles, 2026-11-02T13:30:00.000Z a 2026-11-14T13:20:00.000Z. SHA-256 513da9fad18a6d2b4d386584f2d8d1800f1e54fe0a9de96c4430c353cae63102. Fonte: https://data-api.binance.vision/api/v3/klines.
- BNBUSDT 5m: 3455 candles, 2026-11-02T13:30:00.000Z a 2026-11-14T13:20:00.000Z. SHA-256 f1416000763e03c67b2e6c14427896adcd95886603d786067b7ca02685faffd1. Fonte: https://data-api.binance.vision/api/v3/klines.
- SOLUSDT 5m: 3455 candles, 2026-11-02T13:30:00.000Z a 2026-11-14T13:20:00.000Z. SHA-256 68d72cec039f39e6cd6595fa78833b455d3b96584288f28629e477375a0756d9. Fonte: https://data-api.binance.vision/api/v3/klines.
- XRPUSDT 5m: 3455 candles, 2026-11-02T13:30:00.000Z a 2026-11-14T13:20:00.000Z. SHA-256 ab8320477ee569480b544960f7de8fcf35b986060b9d89bb949ce04f689b243d. Fonte: https://data-api.binance.vision/api/v3/klines.
- DOGEUSDT 5m: 3455 candles, 2026-11-02T13:30:00.000Z a 2026-11-14T13:20:00.000Z. SHA-256 ed7b5ac3f4234960ee376a6d52fcd9cadaf24e0dacd158dbc99d51154dcf5af2. Fonte: https://data-api.binance.vision/api/v3/klines.
- ADAUSDT 5m: 3455 candles, 2026-11-02T13:30:00.000Z a 2026-11-14T13:20:00.000Z. SHA-256 1f9a97e105239d5d85f66774c4dd72208c6f3e51ff55f4e4f47fe234748076f3. Fonte: https://data-api.binance.vision/api/v3/klines.
- AVAXUSDT 5m: 3455 candles, 2026-11-02T13:30:00.000Z a 2026-11-14T13:20:00.000Z. SHA-256 745c7cb66ea99cd8e26242bf47c8beb7d8c3c9587c4343e53a6365a6334419b9. Fonte: https://data-api.binance.vision/api/v3/klines.
- LINKUSDT 5m: 3455 candles, 2026-11-02T13:30:00.000Z a 2026-11-14T13:20:00.000Z. SHA-256 80eb25e2d1f518c5d63bb2df792f8572f92e182d0cbccff72b5dbf2883a6e37b. Fonte: https://data-api.binance.vision/api/v3/klines.
- DOTUSDT 5m: 3455 candles, 2026-11-02T13:30:00.000Z a 2026-11-14T13:20:00.000Z. SHA-256 6c2cec9d6e40f047a3cf260d9a96be55e241035c04d7125b93119ab04383bc3b. Fonte: https://data-api.binance.vision/api/v3/klines.
- LTCUSDT 5m: 3455 candles, 2026-11-02T13:30:00.000Z a 2026-11-14T13:20:00.000Z. SHA-256 82b5b265c44c99c84cc2cade9ad845b91e798139ad02adfa11270ed3cf564106. Fonte: https://data-api.binance.vision/api/v3/klines.
- BCHUSDT 5m: 3455 candles, 2026-11-02T13:30:00.000Z a 2026-11-14T13:20:00.000Z. SHA-256 dffa56c700e5596df87b8b483e14e679ab5e924610612d21b12e53b9f92791d4. Fonte: https://data-api.binance.vision/api/v3/klines.

## Tentativas registradas

- kronos: 108
- aranha: 3
- crawler: 3

## Notas

- Nenhuma ordem foi enviada. O módulo de execução legado não entra nesta conta.
- O Sharpe deflacionado segue Bailey e López de Prado. O PBO segue a validação cruzada simétrica combinatória de Bailey, Borwein, López de Prado e Zhu. O código é próprio; pypbo, que é AGPL, não é importado.
- Decisões cujo horizonte se sobrepõe não entram no teste binomial como se fossem independentes. O p-valor usado é o mais alto entre o binomial das decisões sem sobreposição e, quando há sobreposição, um bootstrap em blocos.
- A grade do Kronos M2 continua registrada como 108 tentativas. Os Sharpes daquela grade não foram arquivados, então esta corrida não inventa um DSR para o Kronos.
- No crawler, a carteira é reavaliada a cada 12 candles de 5 minutos e segurada por essas mesmas 12 velas. Janelas de 4h e 24h do estudo antigo se sobrepõem e não entram no veredito.

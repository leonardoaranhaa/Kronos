# Validação offline

Simulação de pesquisa. Nenhuma ordem real foi enviada. Um número ruim continua publicado. Isto não é conselho de investimento.

Gerado em 2026-11-14T13:45:30.602Z. O registro de tentativas está em `reports/trial-log.jsonl`.

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

## Vereditos

| Estratégia | Veredito | Excesso no teste | Sharpe | DSR | PBO | Acerto | IC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Kronos M2: regra escolhida na amostra | reprovada (provável sorte/overfit) | 7.58% | 1.41 | 0.024 | 0.020 | 49.62% (65/131) | 0.004 |
| Kronos M3: a mesma regra depois do RoPE | reprovada (provável sorte/overfit) | 8.27% | 1.60 | 0.028 | 0.017 | 48.85% (64/131) | -0.002 |
| Kronos: regra atual | reprovada (provável sorte/overfit) | 15.45% | 3.63 | 0.122 | 0.000 | 48.85% (64/131) | -0.002 |
| Aranha: análogos | reprovada | -7.41% | -3.68 | 0.007 | 0.002 | 53.62% (74/138) | 0.060 |
| Aranha: estruturas | inconclusiva | 15.43% | n/d | n/d | 0.002 | n/d | n/d |
| Aranha: persistência com filtro | reprovada | -19.95% | -6.31 | 0.000 | 0.002 | 46.25% (37/80) | -0.094 |
| Crawler: score | reprovada | -27.48% | -44.13 | 0.000 | 0.146 | 48.52% (82/169) | 0.004 |
| Crawler: momentum | reprovada | -30.83% | -47.23 | 0.000 | 0.146 | 38.46% (65/169) | -0.047 |
| Crawler: volume | reprovada | -28.42% | -44.70 | 0.000 | 0.146 | 21.33% (16/75) | -0.044 |

## Por estratégia

### Kronos M2: regra escolhida na amostra

**reprovada (provável sorte/overfit).** O Sharpe do teste é positivo, mas o Sharpe deflacionado pelo número de tentativas não chega a 0,95.

Regra congelada do M2 (long/short, 50 bps, sem filtro de média). O tokenizer fica em treino, como naquele estudo. O DSR usa as 108 tentativas da grade. O PBO desta corrida compara a regra com o último candle e com comprar e segurar.

- Retorno no teste: 4.49%. Comprar e segurar: -3.09%. Excesso: 7.58%. Excesso no treino do walk-forward: -20.06%.
- Sharpe anualizado: 1.41. Sharpe por período: 0.0521. Sharpe deflacionado: 0.024 (referência 0.2299, 108 tentativas, dispersão: erro-padrao).
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
- Sharpe anualizado: 1.60. Sharpe por período: 0.0591. Sharpe deflacionado: 0.028 (referência 0.2311, 109 tentativas, dispersão: erro-padrao).
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
- Sharpe anualizado: 3.63. Sharpe por período: 0.1344. Sharpe deflacionado: 0.122 (referência 0.2467, 110 tentativas, dispersão: erro-padrao).
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

**reprovada.** Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. O Sharpe desta série não sustenta vantagem. Acerto perto ou acima de 50% não muda esse veredito.

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

## Tentativas registradas

- kronos: 111
- aranha: 3
- crawler: 3

## Notas

- Nenhuma ordem foi enviada. O módulo de execução legado não entra nesta conta.
- O Sharpe deflacionado segue Bailey e López de Prado. O PBO segue a validação cruzada simétrica combinatória de Bailey, Borwein, López de Prado e Zhu. O código é próprio; pypbo, que é AGPL, não é importado.
- Decisões cujo horizonte se sobrepõe não entram no teste binomial como se fossem independentes. O p-valor usado é o mais alto entre o binomial das decisões sem sobreposição e, quando há sobreposição, um bootstrap em blocos.
- A grade do Kronos M2 continua registrada como 108 tentativas. Os Sharpes daquela grade não foram arquivados, então esta corrida não inventa um DSR para o Kronos.
- No crawler, a carteira é reavaliada a cada 12 candles de 5 minutos e segurada por essas mesmas 12 velas. Janelas de 4h e 24h do estudo antigo se sobrepõem e não entram no veredito.
- Kronos M2: regra escolhida na amostra foi medido com o worker local. O cache fica em data/research-cache/.
- Kronos M3: a mesma regra depois do RoPE foi medido com o worker local. O cache fica em data/research-cache/.
- Kronos: regra atual foi medido com o worker local. O cache fica em data/research-cache/.

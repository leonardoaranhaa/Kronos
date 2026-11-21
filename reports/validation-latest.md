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

O tamanho do movimento usa a mesma janela e os mesmos arquivos. O Kronos-small só entra na segunda linha, numa máquina com o worker e os pesos:

```bash
npm run validate -- --strategy vol
npm run validate -- --strategy kronos-vol
```

**Aprovada** (tamanho do movimento) só quando o HAR-RV, no teste walk-forward, tem QLIKE médio menor que a vol recente do mesmo horizonte e o p-valor unilateral de Diebold-Mariano fica abaixo de 0,05, nas seis células: BTC, ETH e SOL, em 4 horas e em 24 horas. Cada célula precisa de pelo menos 30 pontos sem sobreposição.

**Reprovada** quando essa medição existe e o HAR-RV não ganha em todas as seis. EWMA, GARCH e a regressão não mudam esse veredito; os números deles saem na tabela. MSE, correlação de rank e cobertura dos intervalos são publicados e não são o portão.

**Inconclusiva** quando falta a série, falta o modelo, ou alguma das seis células fica com menos de 30 pontos. Sem a conta, não há número.

**Aprovada** (filtro) só quando, nas mesmas seis células, ficar de fora com a vol prevista pelo HAR-RV acima do percentil 80 do treino reduz o drawdown máximo de comprar e segurar e ainda passa na régua já usada: excesso depois da taxa acima de zero, Sharpe deflacionado de pelo menos 0,95 e probabilidade de overfit abaixo de 0,50.

**Reprovada** quando a conta existe e alguma célula não reduz o drawdown, fica atrás de comprar e segurar, ou não passa no Sharpe deflacionado ou no PBO.

**Inconclusiva** quando não há série, não há funding para cobrar o custo, ou o teste não fecha 30 retornos. Ficar parado o tempo todo não é aprovação.

O Kronos-small não entra nas seis células. A previsão dele é a variância das amostras do caminho de 6 horas já congelado no protocolo de pesquisa, comparada com o quadrado do log-retorno nessas 6 horas.

**Aprovada** nessa célula só com QLIKE melhor que a vol recente e p-valor de Diebold-Mariano abaixo de 0,05, em pelo menos 30 pontos. Sem o worker e sem os pesos o veredito fica inconclusivo. O comando é `npm run validate -- --strategy kronos-vol`.

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
| BTCUSDT 4h: filtro de vol alta (vol recente) em comprar e segurar | reprovada | -37.94% | -0.91 | 0.068 | 0.056 | n/d | n/d |
| BTCUSDT 4h: filtro de vol alta (EWMA) em comprar e segurar | reprovada (provável sorte/overfit) | -28.22% | -0.40 | 0.141 | 0.056 | n/d | n/d |
| BTCUSDT 4h: filtro de vol alta (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -27.39% | -0.36 | 0.150 | 0.056 | n/d | n/d |
| BTCUSDT 4h: filtro de vol alta (GARCH(1,1)) em comprar e segurar | reprovada (provável sorte/overfit) | -36.30% | -0.81 | 0.079 | 0.056 | n/d | n/d |
| BTCUSDT 4h: filtro de vol alta (ridge com futuros) em comprar e segurar | reprovada (provável sorte/overfit) | -4.01% | 0.59 | 0.406 | 0.056 | n/d | n/d |
| BTCUSDT 4h: tamanho pela vol (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -39.40% | -1.26 | 0.038 | 0.056 | n/d | n/d |
| BTCUSDT 4h: tamanho pela vol (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -17.13% | 0.07 | 0.250 | 0.056 | n/d | n/d |
| BTCUSDT 4h: filtro de vol alta (HAR-RV) em a regra logística | reprovada (provável sorte/overfit) | -15.18% | 0.09 | 0.070 | 0.195 | n/d | n/d |
| BTCUSDT 4h: tamanho pela vol (HAR-RV) em a regra logística | reprovada (provável sorte/overfit) | -24.67% | -1.79 | 0.001 | 0.195 | n/d | n/d |
| BTCUSDT 4h: filtro de vol alta (HAR-RV) em a regra de direção | reprovada (provável sorte/overfit) | -48.45% | -3.55 | 0.000 | 0.195 | n/d | n/d |
| BTCUSDT 4h: tamanho pela vol (HAR-RV) em a regra de direção | reprovada (provável sorte/overfit) | -49.68% | -3.80 | 0.000 | 0.195 | n/d | n/d |
| BTCUSDT 4h: filtro de vol alta (HAR-RV) em a regra de funding | reprovada (provável sorte/overfit) | -17.45% | -1.84 | 0.000 | 0.195 | n/d | n/d |
| BTCUSDT 4h: tamanho pela vol (HAR-RV) em a regra de funding | reprovada (provável sorte/overfit) | -18.24% | -2.35 | 0.000 | 0.195 | n/d | n/d |
| BTCUSDT 24h: filtro de vol alta (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -1.98% | 0.55 | 0.565 | 0.117 | n/d | n/d |
| BTCUSDT 24h: filtro de vol alta (EWMA) em comprar e segurar | reprovada (provável sorte/overfit) | -1.44% | 0.58 | 0.573 | 0.117 | n/d | n/d |
| BTCUSDT 24h: filtro de vol alta (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -7.45% | 0.34 | 0.495 | 0.117 | n/d | n/d |
| BTCUSDT 24h: filtro de vol alta (GARCH(1,1)) em comprar e segurar | reprovada (provável sorte/overfit) | 2.05% | 0.69 | 0.610 | 0.117 | n/d | n/d |
| BTCUSDT 24h: filtro de vol alta (ridge com futuros) em comprar e segurar | reprovada (provável sorte/overfit) | 14.21% | 1.09 | 0.731 | 0.117 | n/d | n/d |
| BTCUSDT 24h: tamanho pela vol (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -6.95% | 0.37 | 0.503 | 0.117 | n/d | n/d |
| BTCUSDT 24h: tamanho pela vol (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -5.45% | 0.42 | 0.522 | 0.117 | n/d | n/d |
| ETHUSDT 4h: filtro de vol alta (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -41.03% | -0.60 | 0.134 | 0.171 | n/d | n/d |
| ETHUSDT 4h: filtro de vol alta (EWMA) em comprar e segurar | reprovada (provável sorte/overfit) | -27.29% | -0.13 | 0.240 | 0.171 | n/d | n/d |
| ETHUSDT 4h: filtro de vol alta (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -7.12% | 0.46 | 0.414 | 0.171 | n/d | n/d |
| ETHUSDT 4h: filtro de vol alta (GARCH(1,1)) em comprar e segurar | reprovada (provável sorte/overfit) | -32.01% | -0.28 | 0.202 | 0.171 | n/d | n/d |
| ETHUSDT 4h: filtro de vol alta (ridge com futuros) em comprar e segurar | reprovada (provável sorte/overfit) | -2.87% | 0.56 | 0.450 | 0.171 | n/d | n/d |
| ETHUSDT 4h: tamanho pela vol (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -38.19% | -0.64 | 0.128 | 0.171 | n/d | n/d |
| ETHUSDT 4h: tamanho pela vol (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -7.55% | 0.44 | 0.410 | 0.171 | n/d | n/d |
| ETHUSDT 4h: filtro de vol alta (HAR-RV) em a regra logística | reprovada (provável sorte/overfit) | -12.79% | 0.31 | 0.194 | 0.124 | n/d | n/d |
| ETHUSDT 4h: tamanho pela vol (HAR-RV) em a regra logística | reprovada (provável sorte/overfit) | -13.99% | 0.19 | 0.170 | 0.124 | n/d | n/d |
| ETHUSDT 4h: filtro de vol alta (HAR-RV) em a regra de direção | reprovada (provável sorte/overfit) | -44.85% | -1.95 | 0.003 | 0.124 | n/d | n/d |
| ETHUSDT 4h: tamanho pela vol (HAR-RV) em a regra de direção | reprovada (provável sorte/overfit) | -45.26% | -2.00 | 0.003 | 0.124 | n/d | n/d |
| ETHUSDT 4h: filtro de vol alta (HAR-RV) em a regra de funding | reprovada (provável sorte/overfit) | -17.43% | -0.45 | 0.069 | 0.124 | n/d | n/d |
| ETHUSDT 4h: tamanho pela vol (HAR-RV) em a regra de funding | reprovada (provável sorte/overfit) | -18.17% | -0.64 | 0.051 | 0.124 | n/d | n/d |
| ETHUSDT 24h: filtro de vol alta (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | 15.06% | 0.93 | 0.722 | 0.812 | n/d | n/d |
| ETHUSDT 24h: filtro de vol alta (EWMA) em comprar e segurar | reprovada (provável sorte/overfit) | -5.54% | 0.43 | 0.561 | 0.812 | n/d | n/d |
| ETHUSDT 24h: filtro de vol alta (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -3.59% | 0.48 | 0.578 | 0.812 | n/d | n/d |
| ETHUSDT 24h: filtro de vol alta (GARCH(1,1)) em comprar e segurar | reprovada (provável sorte/overfit) | 8.33% | 0.77 | 0.671 | 0.812 | n/d | n/d |
| ETHUSDT 24h: filtro de vol alta (ridge com futuros) em comprar e segurar | reprovada (provável sorte/overfit) | -0.51% | 0.56 | 0.603 | 0.812 | n/d | n/d |
| ETHUSDT 24h: tamanho pela vol (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | 7.81% | 0.77 | 0.672 | 0.812 | n/d | n/d |
| ETHUSDT 24h: tamanho pela vol (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | 1.19% | 0.60 | 0.617 | 0.812 | n/d | n/d |
| SOLUSDT 4h: filtro de vol alta (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -14.77% | 0.46 | 0.547 | 0.138 | n/d | n/d |
| SOLUSDT 4h: filtro de vol alta (EWMA) em comprar e segurar | reprovada (provável sorte/overfit) | -12.29% | 0.52 | 0.567 | 0.138 | n/d | n/d |
| SOLUSDT 4h: filtro de vol alta (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -0.90% | 0.77 | 0.647 | 0.138 | n/d | n/d |
| SOLUSDT 4h: filtro de vol alta (GARCH(1,1)) em comprar e segurar | reprovada (provável sorte/overfit) | -26.44% | 0.17 | 0.449 | 0.138 | n/d | n/d |
| SOLUSDT 4h: filtro de vol alta (ridge com futuros) em comprar e segurar | reprovada (provável sorte/overfit) | -5.29% | 0.68 | 0.618 | 0.138 | n/d | n/d |
| SOLUSDT 4h: tamanho pela vol (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -22.70% | 0.24 | 0.473 | 0.138 | n/d | n/d |
| SOLUSDT 4h: tamanho pela vol (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -3.75% | 0.71 | 0.629 | 0.138 | n/d | n/d |
| SOLUSDT 4h: filtro de vol alta (HAR-RV) em a regra logística | reprovada (provável sorte/overfit) | -61.85% | -2.31 | 0.000 | 0.818 | n/d | n/d |
| SOLUSDT 4h: tamanho pela vol (HAR-RV) em a regra logística | reprovada (provável sorte/overfit) | -59.56% | -2.19 | 0.000 | 0.818 | n/d | n/d |
| SOLUSDT 4h: filtro de vol alta (HAR-RV) em a regra de direção | reprovada (provável sorte/overfit) | -79.82% | -3.49 | 0.000 | 0.818 | n/d | n/d |
| SOLUSDT 4h: tamanho pela vol (HAR-RV) em a regra de direção | reprovada (provável sorte/overfit) | -78.01% | -3.43 | 0.000 | 0.818 | n/d | n/d |
| SOLUSDT 4h: filtro de vol alta (HAR-RV) em a regra de funding | reprovada (provável sorte/overfit) | -35.37% | -0.57 | 0.026 | 0.818 | n/d | n/d |
| SOLUSDT 4h: tamanho pela vol (HAR-RV) em a regra de funding | reprovada (provável sorte/overfit) | -32.88% | -0.35 | 0.039 | 0.818 | n/d | n/d |
| SOLUSDT 24h: filtro de vol alta (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -6.71% | 0.45 | 0.604 | 0.771 | n/d | n/d |
| SOLUSDT 24h: filtro de vol alta (EWMA) em comprar e segurar | reprovada (provável sorte/overfit) | -2.84% | 0.54 | 0.634 | 0.771 | n/d | n/d |
| SOLUSDT 24h: filtro de vol alta (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -0.79% | 0.59 | 0.649 | 0.771 | n/d | n/d |
| SOLUSDT 24h: filtro de vol alta (GARCH(1,1)) em comprar e segurar | reprovada (provável sorte/overfit) | -7.20% | 0.43 | 0.599 | 0.771 | n/d | n/d |
| SOLUSDT 24h: filtro de vol alta (ridge com futuros) em comprar e segurar | reprovada (provável sorte/overfit) | -0.46% | 0.60 | 0.652 | 0.771 | n/d | n/d |
| SOLUSDT 24h: tamanho pela vol (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | 2.91% | 0.68 | 0.678 | 0.771 | n/d | n/d |
| SOLUSDT 24h: tamanho pela vol (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | 1.18% | 0.63 | 0.664 | 0.771 | n/d | n/d |
| Kronos-small: dispersão como vol | inconclusiva | n/d | n/d | n/d | n/d | n/d | n/d |

## Tamanho do movimento

O modelo prevê o tamanho do movimento melhor que a vol recente. O HAR-RV teve QLIKE menor que a vol recente e Diebold-Mariano abaixo de 0,05 nas seis células. O filtro não reduz o risco sem custar retorno, ou não passa na régua. O filtro não passou. O drawdown ficou menor em 4 de 6 células. O excesso depois da taxa ficou positivo em 0 de 6. A régua inteira (excesso, Sharpe deflacionado e PBO) fechou em 0 de 6. Ficar parado não conta como aprovação. O Kronos-small fica inconclusivo até uma máquina com o worker e os pesos rodar `npm run validate -- --strategy kronos-vol`. Esta corrida não baixa peso e não inventa a dispersão.

### Regra desta pergunta

A habilidade compara a variância realizada das próximas horas com a previsão. O portão é o QLIKE contra a vol recente, com Diebold-Mariano unilateral.

O filtro primário fica zerado quando a previsão do HAR-RV passa do percentil 80 do treino. O dimensionamento e as regras antigas estão na tabela e entram no registro de tentativas.

| Moeda | Horizonte | Modelo | Pontos | QLIKE | QLIKE da vol recente | Diferença | p DM | MSE | Correlação | p da correlação | Cobertura 80% | Cobertura 95% |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 4h | naive | 2609 | -6.9158 | -6.9158 | 0.0000 | n/d | 0.00000004 | 0.416 | 0.0020 | 71.7% | 84.0% |
| BTCUSDT | 4h | ewma | 2609 | -8.4653 | -6.9158 | 1.5495 | <0,0001 | 0.00000003 | 0.406 | 0.0020 | 82.3% | 92.1% |
| BTCUSDT | 4h | har | 2609 | -8.5661 | -6.9158 | 1.6503 | <0,0001 | 0.00000002 | 0.420 | 0.0020 | 86.9% | 94.0% |
| BTCUSDT | 4h | garch | 2609 | -8.5478 | -6.9158 | 1.6320 | <0,0001 | 0.00000003 | 0.434 | 0.0020 | 87.4% | 94.6% |
| BTCUSDT | 4h | ridge | 2597 | -8.2390 | -6.9106 | 1.3284 | <0,0001 | 0.00000003 | 0.441 | 0.0020 | 74.0% | 86.8% |
| BTCUSDT | 24h | naive | 419 | -6.2695 | -6.2695 | 0.0000 | n/d | 0.00000036 | 0.394 | 0.0020 | 75.2% | 88.5% |
| BTCUSDT | 24h | ewma | 419 | -6.5793 | -6.2695 | 0.3098 | <0,0001 | 0.00000030 | 0.429 | 0.0020 | 77.1% | 90.5% |
| BTCUSDT | 24h | har | 419 | -6.7268 | -6.2695 | 0.4573 | <0,0001 | 0.00000025 | 0.470 | 0.0020 | 83.1% | 94.3% |
| BTCUSDT | 24h | garch | 419 | -6.6797 | -6.2695 | 0.4101 | <0,0001 | 0.00000027 | 0.443 | 0.0020 | 86.9% | 95.2% |
| BTCUSDT | 24h | ridge | 417 | -6.6311 | -6.2682 | 0.3628 | <0,0001 | 0.00000025 | 0.436 | 0.0020 | 78.2% | 90.6% |
| ETHUSDT | 4h | naive | 2609 | -5.5624 | -5.5624 | 0.0000 | n/d | 0.00000015 | 0.383 | 0.0020 | 72.1% | 84.4% |
| ETHUSDT | 4h | ewma | 2609 | -7.7455 | -5.5624 | 2.1831 | <0,0001 | 0.00000010 | 0.398 | 0.0020 | 83.1% | 91.6% |
| ETHUSDT | 4h | har | 2609 | -7.8260 | -5.5624 | 2.2636 | <0,0001 | 0.00000010 | 0.404 | 0.0020 | 88.6% | 95.0% |
| ETHUSDT | 4h | garch | 2609 | -7.8341 | -5.5624 | 2.2717 | <0,0001 | 0.00000010 | 0.410 | 0.0020 | 87.7% | 94.6% |
| ETHUSDT | 4h | ridge | 2594 | -7.5375 | -5.5624 | 1.9751 | <0,0001 | 0.00000010 | 0.432 | 0.0020 | 75.7% | 87.5% |
| ETHUSDT | 24h | naive | 419 | -5.5877 | -5.5877 | 0.0000 | n/d | 0.00000142 | 0.413 | 0.0020 | 75.7% | 86.2% |
| ETHUSDT | 24h | ewma | 419 | -5.8455 | -5.5877 | 0.2578 | <0,0001 | 0.00000131 | 0.446 | 0.0020 | 79.0% | 89.3% |
| ETHUSDT | 24h | har | 419 | -6.0017 | -5.5877 | 0.4140 | <0,0001 | 0.00000100 | 0.455 | 0.0020 | 88.8% | 96.2% |
| ETHUSDT | 24h | garch | 419 | -5.9622 | -5.5877 | 0.3745 | 0.0004 | 0.00000114 | 0.450 | 0.0020 | 88.8% | 95.7% |
| ETHUSDT | 24h | ridge | 417 | -5.9976 | -5.5890 | 0.4086 | <0,0001 | 0.00000091 | 0.444 | 0.0020 | 80.6% | 91.1% |
| SOLUSDT | 4h | naive | 2609 | -6.1308 | -6.1308 | 0.0000 | n/d | 0.00000019 | 0.347 | 0.0020 | 71.8% | 84.0% |
| SOLUSDT | 4h | ewma | 2609 | -7.5556 | -6.1308 | 1.4248 | <0,0001 | 0.00000012 | 0.405 | 0.0020 | 81.6% | 92.3% |
| SOLUSDT | 4h | har | 2609 | -7.6042 | -6.1308 | 1.4734 | <0,0001 | 0.00000011 | 0.412 | 0.0020 | 87.6% | 95.3% |
| SOLUSDT | 4h | garch | 2609 | -7.5723 | -6.1308 | 1.4415 | <0,0001 | 0.00000012 | 0.401 | 0.0020 | 88.4% | 95.5% |
| SOLUSDT | 4h | ridge | 2588 | -7.4444 | -6.1281 | 1.3163 | <0,0001 | 0.00000012 | 0.430 | 0.0020 | 75.5% | 88.4% |
| SOLUSDT | 24h | naive | 419 | -5.5223 | -5.5223 | 0.0000 | n/d | 0.00000149 | 0.434 | 0.0020 | 75.4% | 90.0% |
| SOLUSDT | 24h | ewma | 419 | -5.7322 | -5.5223 | 0.2099 | <0,0001 | 0.00000133 | 0.478 | 0.0020 | 78.3% | 92.6% |
| SOLUSDT | 24h | har | 419 | -5.8104 | -5.5223 | 0.2881 | <0,0001 | 0.00000115 | 0.493 | 0.0020 | 87.4% | 95.7% |
| SOLUSDT | 24h | garch | 419 | -5.7001 | -5.5223 | 0.1778 | 0.0132 | 0.00000157 | 0.443 | 0.0020 | 90.9% | 97.6% |
| SOLUSDT | 24h | ridge | 416 | -5.8393 | -5.5262 | 0.3132 | <0,0001 | 0.00000100 | 0.520 | 0.0020 | 82.2% | 93.5% |

| Uso | Veredito | Excesso | Sharpe | DSR | PBO | Drawdown | Drawdown de comprar e segurar |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT 4h: filtro de vol alta (vol recente) em comprar e segurar | reprovada | -37.94% | -0.91 | 0.068 | 0.056 | 40.44% | 29.31% |
| BTCUSDT 4h: filtro de vol alta (EWMA) em comprar e segurar | reprovada (provável sorte/overfit) | -28.22% | -0.40 | 0.141 | 0.056 | 29.28% | 29.31% |
| BTCUSDT 4h: filtro de vol alta (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -27.39% | -0.36 | 0.150 | 0.056 | 32.65% | 29.31% |
| BTCUSDT 4h: filtro de vol alta (GARCH(1,1)) em comprar e segurar | reprovada (provável sorte/overfit) | -36.30% | -0.81 | 0.079 | 0.056 | 35.33% | 29.31% |
| BTCUSDT 4h: filtro de vol alta (ridge com futuros) em comprar e segurar | reprovada (provável sorte/overfit) | -4.01% | 0.59 | 0.406 | 0.056 | 28.52% | 29.31% |
| BTCUSDT 4h: tamanho pela vol (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -39.40% | -1.26 | 0.038 | 0.056 | 35.72% | 29.31% |
| BTCUSDT 4h: tamanho pela vol (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -17.13% | 0.07 | 0.250 | 0.056 | 27.39% | 29.31% |
| BTCUSDT 4h: filtro de vol alta (HAR-RV) em a regra logística | reprovada (provável sorte/overfit) | -15.18% | 0.09 | 0.070 | 0.195 | 5.44% | 29.31% |
| BTCUSDT 4h: tamanho pela vol (HAR-RV) em a regra logística | reprovada (provável sorte/overfit) | -24.67% | -1.79 | 0.001 | 0.195 | 12.93% | 29.31% |
| BTCUSDT 4h: filtro de vol alta (HAR-RV) em a regra de direção | reprovada (provável sorte/overfit) | -48.45% | -3.55 | 0.000 | 0.195 | 37.18% | 29.31% |
| BTCUSDT 4h: tamanho pela vol (HAR-RV) em a regra de direção | reprovada (provável sorte/overfit) | -49.68% | -3.80 | 0.000 | 0.195 | 38.20% | 29.31% |
| BTCUSDT 4h: filtro de vol alta (HAR-RV) em a regra de funding | reprovada (provável sorte/overfit) | -17.45% | -1.84 | 0.000 | 0.195 | 2.02% | 29.31% |
| BTCUSDT 4h: tamanho pela vol (HAR-RV) em a regra de funding | reprovada (provável sorte/overfit) | -18.24% | -2.35 | 0.000 | 0.195 | 2.81% | 29.31% |
| BTCUSDT 24h: filtro de vol alta (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -1.98% | 0.55 | 0.565 | 0.117 | 19.29% | 28.52% |
| BTCUSDT 24h: filtro de vol alta (EWMA) em comprar e segurar | reprovada (provável sorte/overfit) | -1.44% | 0.58 | 0.573 | 0.117 | 22.81% | 28.52% |
| BTCUSDT 24h: filtro de vol alta (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -7.45% | 0.34 | 0.495 | 0.117 | 28.16% | 28.52% |
| BTCUSDT 24h: filtro de vol alta (GARCH(1,1)) em comprar e segurar | reprovada (provável sorte/overfit) | 2.05% | 0.69 | 0.610 | 0.117 | 22.95% | 28.52% |
| BTCUSDT 24h: filtro de vol alta (ridge com futuros) em comprar e segurar | reprovada (provável sorte/overfit) | 14.21% | 1.09 | 0.731 | 0.117 | 23.29% | 28.52% |
| BTCUSDT 24h: tamanho pela vol (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -6.95% | 0.37 | 0.503 | 0.117 | 21.84% | 28.52% |
| BTCUSDT 24h: tamanho pela vol (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -5.45% | 0.42 | 0.522 | 0.117 | 26.47% | 28.52% |
| ETHUSDT 4h: filtro de vol alta (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -41.03% | -0.60 | 0.134 | 0.171 | 44.21% | 38.02% |
| ETHUSDT 4h: filtro de vol alta (EWMA) em comprar e segurar | reprovada (provável sorte/overfit) | -27.29% | -0.13 | 0.240 | 0.171 | 34.56% | 38.02% |
| ETHUSDT 4h: filtro de vol alta (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -7.12% | 0.46 | 0.414 | 0.171 | 33.59% | 38.02% |
| ETHUSDT 4h: filtro de vol alta (GARCH(1,1)) em comprar e segurar | reprovada (provável sorte/overfit) | -32.01% | -0.28 | 0.202 | 0.171 | 42.09% | 38.02% |
| ETHUSDT 4h: filtro de vol alta (ridge com futuros) em comprar e segurar | reprovada (provável sorte/overfit) | -2.87% | 0.56 | 0.450 | 0.171 | 35.75% | 38.02% |
| ETHUSDT 4h: tamanho pela vol (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -38.19% | -0.64 | 0.128 | 0.171 | 43.69% | 38.02% |
| ETHUSDT 4h: tamanho pela vol (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -7.55% | 0.44 | 0.410 | 0.171 | 35.21% | 38.02% |
| ETHUSDT 4h: filtro de vol alta (HAR-RV) em a regra logística | reprovada (provável sorte/overfit) | -12.79% | 0.31 | 0.194 | 0.124 | 10.40% | 38.02% |
| ETHUSDT 4h: tamanho pela vol (HAR-RV) em a regra logística | reprovada (provável sorte/overfit) | -13.99% | 0.19 | 0.170 | 0.124 | 11.29% | 38.02% |
| ETHUSDT 4h: filtro de vol alta (HAR-RV) em a regra de direção | reprovada (provável sorte/overfit) | -44.85% | -1.95 | 0.003 | 0.124 | 35.21% | 38.02% |
| ETHUSDT 4h: tamanho pela vol (HAR-RV) em a regra de direção | reprovada (provável sorte/overfit) | -45.26% | -2.00 | 0.003 | 0.124 | 36.23% | 38.02% |
| ETHUSDT 4h: filtro de vol alta (HAR-RV) em a regra de funding | reprovada (provável sorte/overfit) | -17.43% | -0.45 | 0.069 | 0.124 | 7.75% | 38.02% |
| ETHUSDT 4h: tamanho pela vol (HAR-RV) em a regra de funding | reprovada (provável sorte/overfit) | -18.17% | -0.64 | 0.051 | 0.124 | 8.67% | 38.02% |
| ETHUSDT 24h: filtro de vol alta (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | 15.06% | 0.93 | 0.722 | 0.812 | 29.71% | 35.49% |
| ETHUSDT 24h: filtro de vol alta (EWMA) em comprar e segurar | reprovada (provável sorte/overfit) | -5.54% | 0.43 | 0.561 | 0.812 | 36.43% | 35.49% |
| ETHUSDT 24h: filtro de vol alta (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -3.59% | 0.48 | 0.578 | 0.812 | 38.56% | 35.49% |
| ETHUSDT 24h: filtro de vol alta (GARCH(1,1)) em comprar e segurar | reprovada (provável sorte/overfit) | 8.33% | 0.77 | 0.671 | 0.812 | 33.03% | 35.49% |
| ETHUSDT 24h: filtro de vol alta (ridge com futuros) em comprar e segurar | reprovada (provável sorte/overfit) | -0.51% | 0.56 | 0.603 | 0.812 | 33.16% | 35.49% |
| ETHUSDT 24h: tamanho pela vol (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | 7.81% | 0.77 | 0.672 | 0.812 | 29.96% | 35.49% |
| ETHUSDT 24h: tamanho pela vol (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | 1.19% | 0.60 | 0.617 | 0.812 | 34.45% | 35.49% |
| SOLUSDT 4h: filtro de vol alta (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -14.77% | 0.46 | 0.547 | 0.138 | 31.37% | 37.57% |
| SOLUSDT 4h: filtro de vol alta (EWMA) em comprar e segurar | reprovada (provável sorte/overfit) | -12.29% | 0.52 | 0.567 | 0.138 | 30.73% | 37.57% |
| SOLUSDT 4h: filtro de vol alta (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -0.90% | 0.77 | 0.647 | 0.138 | 30.36% | 37.57% |
| SOLUSDT 4h: filtro de vol alta (GARCH(1,1)) em comprar e segurar | reprovada (provável sorte/overfit) | -26.44% | 0.17 | 0.449 | 0.138 | 36.38% | 37.57% |
| SOLUSDT 4h: filtro de vol alta (ridge com futuros) em comprar e segurar | reprovada (provável sorte/overfit) | -5.29% | 0.68 | 0.618 | 0.138 | 32.53% | 37.57% |
| SOLUSDT 4h: tamanho pela vol (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -22.70% | 0.24 | 0.473 | 0.138 | 36.90% | 37.57% |
| SOLUSDT 4h: tamanho pela vol (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -3.75% | 0.71 | 0.629 | 0.138 | 31.77% | 37.57% |
| SOLUSDT 4h: filtro de vol alta (HAR-RV) em a regra logística | reprovada (provável sorte/overfit) | -61.85% | -2.31 | 0.000 | 0.818 | 39.24% | 37.57% |
| SOLUSDT 4h: tamanho pela vol (HAR-RV) em a regra logística | reprovada (provável sorte/overfit) | -59.56% | -2.19 | 0.000 | 0.818 | 36.29% | 37.57% |
| SOLUSDT 4h: filtro de vol alta (HAR-RV) em a regra de direção | reprovada (provável sorte/overfit) | -79.82% | -3.49 | 0.000 | 0.818 | 54.11% | 37.57% |
| SOLUSDT 4h: tamanho pela vol (HAR-RV) em a regra de direção | reprovada (provável sorte/overfit) | -78.01% | -3.43 | 0.000 | 0.818 | 51.87% | 37.57% |
| SOLUSDT 4h: filtro de vol alta (HAR-RV) em a regra de funding | reprovada (provável sorte/overfit) | -35.37% | -0.57 | 0.026 | 0.818 | 16.53% | 37.57% |
| SOLUSDT 4h: tamanho pela vol (HAR-RV) em a regra de funding | reprovada (provável sorte/overfit) | -32.88% | -0.35 | 0.039 | 0.818 | 16.66% | 37.57% |
| SOLUSDT 24h: filtro de vol alta (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | -6.71% | 0.45 | 0.604 | 0.771 | 33.10% | 36.16% |
| SOLUSDT 24h: filtro de vol alta (EWMA) em comprar e segurar | reprovada (provável sorte/overfit) | -2.84% | 0.54 | 0.634 | 0.771 | 33.59% | 36.16% |
| SOLUSDT 24h: filtro de vol alta (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | -0.79% | 0.59 | 0.649 | 0.771 | 33.10% | 36.16% |
| SOLUSDT 24h: filtro de vol alta (GARCH(1,1)) em comprar e segurar | reprovada (provável sorte/overfit) | -7.20% | 0.43 | 0.599 | 0.771 | 27.36% | 36.16% |
| SOLUSDT 24h: filtro de vol alta (ridge com futuros) em comprar e segurar | reprovada (provável sorte/overfit) | -0.46% | 0.60 | 0.652 | 0.771 | 35.44% | 36.16% |
| SOLUSDT 24h: tamanho pela vol (vol recente) em comprar e segurar | reprovada (provável sorte/overfit) | 2.91% | 0.68 | 0.678 | 0.771 | 29.57% | 36.16% |
| SOLUSDT 24h: tamanho pela vol (HAR-RV) em comprar e segurar | reprovada (provável sorte/overfit) | 1.18% | 0.63 | 0.664 | 0.771 | 32.49% | 36.16% |

Kronos-small: **inconclusiva.** O Kronos-small fica inconclusivo até uma máquina com o worker e os pesos rodar `npm run validate -- --strategy kronos-vol`. Esta corrida não baixa peso e não inventa a dispersão.


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

### BTCUSDT 4h: filtro de vol alta (vol recente) em comprar e segurar

**reprovada.** Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. O Sharpe desta série não sustenta vantagem. Acerto perto ou acima de 50% não muda esse veredito.

Fica zerado quando a variância prevista pelo vol recente passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 40.44%. Comprar e segurar no mesmo teste: 29.31%. O drawdown não caiu.

- Retorno no teste: -22.94%. Comprar e segurar: 15.00%. Excesso: -37.94%. Excesso no treino do walk-forward: -1.43%.
- Sharpe anualizado: -0.91. Sharpe por período: -0.0194. Sharpe deflacionado: 0.068 (referência 0.0186, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.056 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0366.
- Observações de retorno no teste: 1565.

### BTCUSDT 4h: filtro de vol alta (EWMA) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo EWMA passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 29.28%. Comprar e segurar no mesmo teste: 29.31%. O drawdown caiu.

- Retorno no teste: -13.22%. Comprar e segurar: 15.00%. Excesso: -28.22%. Excesso no treino do walk-forward: 12.01%.
- Sharpe anualizado: -0.40. Sharpe por período: -0.0086. Sharpe deflacionado: 0.141 (referência 0.0186, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.056 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0157.
- Observações de retorno no teste: 1565.

### BTCUSDT 4h: filtro de vol alta (HAR-RV) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 32.65%. Comprar e segurar no mesmo teste: 29.31%. O drawdown não caiu.

- Retorno no teste: -12.39%. Comprar e segurar: 15.00%. Excesso: -27.39%. Excesso no treino do walk-forward: 12.91%.
- Sharpe anualizado: -0.36. Sharpe por período: -0.0077. Sharpe deflacionado: 0.150 (referência 0.0186, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.056 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0136.
- Observações de retorno no teste: 1565.

### BTCUSDT 4h: filtro de vol alta (GARCH(1,1)) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo GARCH(1,1) passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 35.33%. Comprar e segurar no mesmo teste: 29.31%. O drawdown não caiu.

- Retorno no teste: -21.29%. Comprar e segurar: 15.00%. Excesso: -36.30%. Excesso no treino do walk-forward: 3.94%.
- Sharpe anualizado: -0.81. Sharpe por período: -0.0173. Sharpe deflacionado: 0.079 (referência 0.0186, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.056 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0256.
- Observações de retorno no teste: 1565.

### BTCUSDT 4h: filtro de vol alta (ridge com futuros) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo ridge com futuros passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 28.52%. Comprar e segurar no mesmo teste: 29.31%. O drawdown caiu.

- Retorno no teste: 10.99%. Comprar e segurar: 15.00%. Excesso: -4.01%. Excesso no treino do walk-forward: 7.52%.
- Sharpe anualizado: 0.59. Sharpe por período: 0.0126. Sharpe deflacionado: 0.406 (referência 0.0186, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.056 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0107.
- Observações de retorno no teste: 1565.

### BTCUSDT 4h: tamanho pela vol (vol recente) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o vol recente. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 35.72%. Comprar e segurar no mesmo teste: 29.31%. O drawdown não caiu.

- Retorno no teste: -24.40%. Comprar e segurar: 15.00%. Excesso: -39.40%. Excesso no treino do walk-forward: 1.53%.
- Sharpe anualizado: -1.26. Sharpe por período: -0.0269. Sharpe deflacionado: 0.038 (referência 0.0186, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.056 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0413.
- Observações de retorno no teste: 1565.

### BTCUSDT 4h: tamanho pela vol (HAR-RV) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 27.39%. Comprar e segurar no mesmo teste: 29.31%. O drawdown caiu.

- Retorno no teste: -2.13%. Comprar e segurar: 15.00%. Excesso: -17.13%. Excesso no treino do walk-forward: 9.00%.
- Sharpe anualizado: 0.07. Sharpe por período: 0.0015. Sharpe deflacionado: 0.250 (referência 0.0186, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.056 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0172.
- Observações de retorno no teste: 1565.

### BTCUSDT 4h: filtro de vol alta (HAR-RV) em a regra logística

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue a regra logística. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 5.44%. Comprar e segurar no mesmo teste: 29.31%. O drawdown caiu. A mesma regra sem o filtro teve retorno -17.36% nesse teste.

- Retorno no teste: 0.26%. Comprar e segurar: 15.44%. Excesso: -15.18%. Excesso no treino do walk-forward: 39.63%.
- Sharpe anualizado: 0.09. Sharpe por período: 0.0019. Sharpe deflacionado: 0.070 (referência 0.0392, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.195 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0140.
- Observações de retorno no teste: 1557.

### BTCUSDT 4h: tamanho pela vol (HAR-RV) em a regra logística

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue a regra logística. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 12.93%. Comprar e segurar no mesmo teste: 29.31%. O drawdown caiu. A mesma regra sem o filtro teve retorno -17.36% nesse teste.

- Retorno no teste: -9.23%. Comprar e segurar: 15.44%. Excesso: -24.67%. Excesso no treino do walk-forward: 36.92%.
- Sharpe anualizado: -1.79. Sharpe por período: -0.0383. Sharpe deflacionado: 0.001 (referência 0.0392, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.195 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0395.
- Observações de retorno no teste: 1557.

### BTCUSDT 4h: filtro de vol alta (HAR-RV) em a regra de direção

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue a regra de direção. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 37.18%. Comprar e segurar no mesmo teste: 29.31%. O drawdown não caiu. A mesma regra sem o filtro teve retorno -40.56% nesse teste.

- Retorno no teste: -33.01%. Comprar e segurar: 15.44%. Excesso: -48.45%. Excesso no treino do walk-forward: 24.14%.
- Sharpe anualizado: -3.55. Sharpe por período: -0.0759. Sharpe deflacionado: 0.000 (referência 0.0392, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.195 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0669.
- Observações de retorno no teste: 1557.

### BTCUSDT 4h: tamanho pela vol (HAR-RV) em a regra de direção

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue a regra de direção. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 38.20%. Comprar e segurar no mesmo teste: 29.31%. O drawdown não caiu. A mesma regra sem o filtro teve retorno -40.56% nesse teste.

- Retorno no teste: -34.24%. Comprar e segurar: 15.44%. Excesso: -49.68%. Excesso no treino do walk-forward: 19.07%.
- Sharpe anualizado: -3.80. Sharpe por período: -0.0812. Sharpe deflacionado: 0.000 (referência 0.0392, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.195 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0729.
- Observações de retorno no teste: 1557.

### BTCUSDT 4h: filtro de vol alta (HAR-RV) em a regra de funding

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue a regra de funding. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 2.02%. Comprar e segurar no mesmo teste: 29.31%. O drawdown caiu. A mesma regra sem o filtro teve retorno -3.55% nesse teste.

- Retorno no teste: -2.02%. Comprar e segurar: 15.44%. Excesso: -17.45%. Excesso no treino do walk-forward: 44.75%.
- Sharpe anualizado: -1.84. Sharpe por período: -0.0393. Sharpe deflacionado: 0.000 (referência 0.0392, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.195 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0275.
- Observações de retorno no teste: 1557.

### BTCUSDT 4h: tamanho pela vol (HAR-RV) em a regra de funding

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue a regra de funding. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 2.81%. Comprar e segurar no mesmo teste: 29.31%. O drawdown caiu. A mesma regra sem o filtro teve retorno -3.55% nesse teste.

- Retorno no teste: -2.80%. Comprar e segurar: 15.44%. Excesso: -18.24%. Excesso no treino do walk-forward: 45.07%.
- Sharpe anualizado: -2.35. Sharpe por período: -0.0501. Sharpe deflacionado: 0.000 (referência 0.0392, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.195 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período 0.0053.
- Observações de retorno no teste: 1557.

### BTCUSDT 24h: filtro de vol alta (vol recente) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo vol recente passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 19.29%. Comprar e segurar no mesmo teste: 28.52%. O drawdown caiu.

- Retorno no teste: 9.65%. Comprar e segurar: 11.62%. Excesso: -1.98%. Excesso no treino do walk-forward: 22.97%.
- Sharpe anualizado: 0.55. Sharpe por período: 0.0289. Sharpe deflacionado: 0.565 (referência 0.0187, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.117 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0035.
- Observações de retorno no teste: 251.

### BTCUSDT 24h: filtro de vol alta (EWMA) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo EWMA passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 22.81%. Comprar e segurar no mesmo teste: 28.52%. O drawdown caiu.

- Retorno no teste: 10.18%. Comprar e segurar: 11.62%. Excesso: -1.44%. Excesso no treino do walk-forward: 6.51%.
- Sharpe anualizado: 0.58. Sharpe por período: 0.0302. Sharpe deflacionado: 0.573 (referência 0.0187, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.117 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0310.
- Observações de retorno no teste: 251.

### BTCUSDT 24h: filtro de vol alta (HAR-RV) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 28.16%. Comprar e segurar no mesmo teste: 28.52%. O drawdown caiu.

- Retorno no teste: 4.17%. Comprar e segurar: 11.62%. Excesso: -7.45%. Excesso no treino do walk-forward: 7.27%.
- Sharpe anualizado: 0.34. Sharpe por período: 0.0180. Sharpe deflacionado: 0.495 (referência 0.0187, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.117 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0339.
- Observações de retorno no teste: 251.

### BTCUSDT 24h: filtro de vol alta (GARCH(1,1)) em comprar e segurar

**reprovada (provável sorte/overfit).** O Sharpe do teste é positivo, mas o Sharpe deflacionado pelo número de tentativas não chega a 0,95.

Fica zerado quando a variância prevista pelo GARCH(1,1) passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 22.95%. Comprar e segurar no mesmo teste: 28.52%. O drawdown caiu.

- Retorno no teste: 13.68%. Comprar e segurar: 11.62%. Excesso: 2.05%. Excesso no treino do walk-forward: 9.89%.
- Sharpe anualizado: 0.69. Sharpe por período: 0.0361. Sharpe deflacionado: 0.610 (referência 0.0187, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.117 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0229.
- Observações de retorno no teste: 251.

### BTCUSDT 24h: filtro de vol alta (ridge com futuros) em comprar e segurar

**reprovada (provável sorte/overfit).** O Sharpe do teste é positivo, mas o Sharpe deflacionado pelo número de tentativas não chega a 0,95.

Fica zerado quando a variância prevista pelo ridge com futuros passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 23.29%. Comprar e segurar no mesmo teste: 28.52%. O drawdown caiu.

- Retorno no teste: 25.84%. Comprar e segurar: 11.62%. Excesso: 14.21%. Excesso no treino do walk-forward: 15.11%.
- Sharpe anualizado: 1.09. Sharpe por período: 0.0569. Sharpe deflacionado: 0.731 (referência 0.0187, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.117 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0095.
- Observações de retorno no teste: 251.

### BTCUSDT 24h: tamanho pela vol (vol recente) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o vol recente. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 21.84%. Comprar e segurar no mesmo teste: 28.52%. O drawdown caiu.

- Retorno no teste: 4.67%. Comprar e segurar: 11.62%. Excesso: -6.95%. Excesso no treino do walk-forward: 15.90%.
- Sharpe anualizado: 0.37. Sharpe por período: 0.0191. Sharpe deflacionado: 0.503 (referência 0.0187, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.117 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0251.
- Observações de retorno no teste: 251.

### BTCUSDT 24h: tamanho pela vol (HAR-RV) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 26.47%. Comprar e segurar no mesmo teste: 28.52%. O drawdown caiu.

- Retorno no teste: 6.18%. Comprar e segurar: 11.62%. Excesso: -5.45%. Excesso no treino do walk-forward: 8.36%.
- Sharpe anualizado: 0.42. Sharpe por período: 0.0222. Sharpe deflacionado: 0.522 (referência 0.0187, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.117 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0397.
- Observações de retorno no teste: 251.

### ETHUSDT 4h: filtro de vol alta (vol recente) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo vol recente passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 44.21%. Comprar e segurar no mesmo teste: 38.02%. O drawdown não caiu.

- Retorno no teste: -26.27%. Comprar e segurar: 14.76%. Excesso: -41.03%. Excesso no treino do walk-forward: 2.50%.
- Sharpe anualizado: -0.60. Sharpe por período: -0.0129. Sharpe deflacionado: 0.134 (referência 0.0152, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.171 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0310.
- Observações de retorno no teste: 1565.

### ETHUSDT 4h: filtro de vol alta (EWMA) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo EWMA passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 34.56%. Comprar e segurar no mesmo teste: 38.02%. O drawdown caiu.

- Retorno no teste: -12.53%. Comprar e segurar: 14.76%. Excesso: -27.29%. Excesso no treino do walk-forward: 8.89%.
- Sharpe anualizado: -0.13. Sharpe por período: -0.0027. Sharpe deflacionado: 0.240 (referência 0.0152, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.171 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0242.
- Observações de retorno no teste: 1565.

### ETHUSDT 4h: filtro de vol alta (HAR-RV) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 33.59%. Comprar e segurar no mesmo teste: 38.02%. O drawdown caiu.

- Retorno no teste: 7.64%. Comprar e segurar: 14.76%. Excesso: -7.12%. Excesso no treino do walk-forward: 5.96%.
- Sharpe anualizado: 0.46. Sharpe por período: 0.0097. Sharpe deflacionado: 0.414 (referência 0.0152, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.171 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0181.
- Observações de retorno no teste: 1565.

### ETHUSDT 4h: filtro de vol alta (GARCH(1,1)) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo GARCH(1,1) passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 42.09%. Comprar e segurar no mesmo teste: 38.02%. O drawdown não caiu.

- Retorno no teste: -17.25%. Comprar e segurar: 14.76%. Excesso: -32.01%. Excesso no treino do walk-forward: 0.97%.
- Sharpe anualizado: -0.28. Sharpe por período: -0.0059. Sharpe deflacionado: 0.202 (referência 0.0152, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.171 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0266.
- Observações de retorno no teste: 1565.

### ETHUSDT 4h: filtro de vol alta (ridge com futuros) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo ridge com futuros passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 35.75%. Comprar e segurar no mesmo teste: 38.02%. O drawdown caiu.

- Retorno no teste: 11.89%. Comprar e segurar: 14.76%. Excesso: -2.87%. Excesso no treino do walk-forward: 4.79%.
- Sharpe anualizado: 0.56. Sharpe por período: 0.0120. Sharpe deflacionado: 0.450 (referência 0.0152, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.171 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0145.
- Observações de retorno no teste: 1565.

### ETHUSDT 4h: tamanho pela vol (vol recente) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o vol recente. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 43.69%. Comprar e segurar no mesmo teste: 38.02%. O drawdown não caiu.

- Retorno no teste: -23.44%. Comprar e segurar: 14.76%. Excesso: -38.19%. Excesso no treino do walk-forward: 2.14%.
- Sharpe anualizado: -0.64. Sharpe por período: -0.0136. Sharpe deflacionado: 0.128 (referência 0.0152, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.171 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0365.
- Observações de retorno no teste: 1565.

### ETHUSDT 4h: tamanho pela vol (HAR-RV) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 35.21%. Comprar e segurar no mesmo teste: 38.02%. O drawdown caiu.

- Retorno no teste: 7.20%. Comprar e segurar: 14.76%. Excesso: -7.55%. Excesso no treino do walk-forward: 6.49%.
- Sharpe anualizado: 0.44. Sharpe por período: 0.0095. Sharpe deflacionado: 0.410 (referência 0.0152, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.171 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0166.
- Observações de retorno no teste: 1565.

### ETHUSDT 4h: filtro de vol alta (HAR-RV) em a regra logística

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue a regra logística. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 10.40%. Comprar e segurar no mesmo teste: 38.02%. O drawdown caiu. A mesma regra sem o filtro teve retorno -0.47% nesse teste.

- Retorno no teste: 2.47%. Comprar e segurar: 15.26%. Excesso: -12.79%. Excesso no treino do walk-forward: 18.07%.
- Sharpe anualizado: 0.31. Sharpe por período: 0.0066. Sharpe deflacionado: 0.194 (referência 0.0280, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.124 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0375.
- Observações de retorno no teste: 1556.

### ETHUSDT 4h: tamanho pela vol (HAR-RV) em a regra logística

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue a regra logística. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 11.29%. Comprar e segurar no mesmo teste: 38.02%. O drawdown caiu. A mesma regra sem o filtro teve retorno -0.47% nesse teste.

- Retorno no teste: 1.26%. Comprar e segurar: 15.26%. Excesso: -13.99%. Excesso no treino do walk-forward: 10.85%.
- Sharpe anualizado: 0.19. Sharpe por período: 0.0041. Sharpe deflacionado: 0.170 (referência 0.0280, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.124 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0439.
- Observações de retorno no teste: 1556.

### ETHUSDT 4h: filtro de vol alta (HAR-RV) em a regra de direção

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue a regra de direção. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 35.21%. Comprar e segurar no mesmo teste: 38.02%. O drawdown caiu. A mesma regra sem o filtro teve retorno -36.14% nesse teste.

- Retorno no teste: -29.59%. Comprar e segurar: 15.26%. Excesso: -44.85%. Excesso no treino do walk-forward: 10.62%.
- Sharpe anualizado: -1.95. Sharpe por período: -0.0416. Sharpe deflacionado: 0.003 (referência 0.0280, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.124 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0465.
- Observações de retorno no teste: 1556.

### ETHUSDT 4h: tamanho pela vol (HAR-RV) em a regra de direção

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue a regra de direção. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 36.23%. Comprar e segurar no mesmo teste: 38.02%. O drawdown caiu. A mesma regra sem o filtro teve retorno -36.14% nesse teste.

- Retorno no teste: -30.01%. Comprar e segurar: 15.26%. Excesso: -45.26%. Excesso no treino do walk-forward: 5.99%.
- Sharpe anualizado: -2.00. Sharpe por período: -0.0426. Sharpe deflacionado: 0.003 (referência 0.0280, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.124 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0538.
- Observações de retorno no teste: 1556.

### ETHUSDT 4h: filtro de vol alta (HAR-RV) em a regra de funding

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue a regra de funding. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 7.75%. Comprar e segurar no mesmo teste: 38.02%. O drawdown caiu. A mesma regra sem o filtro teve retorno -3.57% nesse teste.

- Retorno no teste: -2.17%. Comprar e segurar: 15.26%. Excesso: -17.43%. Excesso no treino do walk-forward: 61.90%.
- Sharpe anualizado: -0.45. Sharpe por período: -0.0097. Sharpe deflacionado: 0.069 (referência 0.0280, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.124 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período 0.0229.
- Observações de retorno no teste: 1556.

### ETHUSDT 4h: tamanho pela vol (HAR-RV) em a regra de funding

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue a regra de funding. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 8.67%. Comprar e segurar no mesmo teste: 38.02%. O drawdown caiu. A mesma regra sem o filtro teve retorno -3.57% nesse teste.

- Retorno no teste: -2.91%. Comprar e segurar: 15.26%. Excesso: -18.17%. Excesso no treino do walk-forward: 58.56%.
- Sharpe anualizado: -0.64. Sharpe por período: -0.0137. Sharpe deflacionado: 0.051 (referência 0.0280, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.124 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0174.
- Observações de retorno no teste: 1556.

### ETHUSDT 24h: filtro de vol alta (vol recente) em comprar e segurar

**reprovada (provável sorte/overfit).** A probabilidade de backtest overfitting ficou em 0,50 ou mais: a configuração que ganha num pedaço tende a perder no pedaço complementar.

Fica zerado quando a variância prevista pelo vol recente passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 29.71%. Comprar e segurar no mesmo teste: 35.49%. O drawdown caiu.

- Retorno no teste: 27.22%. Comprar e segurar: 12.15%. Excesso: 15.06%. Excesso no treino do walk-forward: 4.13%.
- Sharpe anualizado: 0.93. Sharpe por período: 0.0488. Sharpe deflacionado: 0.722 (referência 0.0131, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.812 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0555.
- Observações de retorno no teste: 251.

### ETHUSDT 24h: filtro de vol alta (EWMA) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo EWMA passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 36.43%. Comprar e segurar no mesmo teste: 35.49%. O drawdown não caiu.

- Retorno no teste: 6.62%. Comprar e segurar: 12.15%. Excesso: -5.54%. Excesso no treino do walk-forward: 3.98%.
- Sharpe anualizado: 0.43. Sharpe por período: 0.0226. Sharpe deflacionado: 0.561 (referência 0.0131, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.812 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0561.
- Observações de retorno no teste: 251.

### ETHUSDT 24h: filtro de vol alta (HAR-RV) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 38.56%. Comprar e segurar no mesmo teste: 35.49%. O drawdown não caiu.

- Retorno no teste: 8.57%. Comprar e segurar: 12.15%. Excesso: -3.59%. Excesso no treino do walk-forward: 15.65%.
- Sharpe anualizado: 0.48. Sharpe por período: 0.0253. Sharpe deflacionado: 0.578 (referência 0.0131, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.812 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0379.
- Observações de retorno no teste: 251.

### ETHUSDT 24h: filtro de vol alta (GARCH(1,1)) em comprar e segurar

**reprovada (provável sorte/overfit).** A probabilidade de backtest overfitting ficou em 0,50 ou mais: a configuração que ganha num pedaço tende a perder no pedaço complementar.

Fica zerado quando a variância prevista pelo GARCH(1,1) passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 33.03%. Comprar e segurar no mesmo teste: 35.49%. O drawdown caiu.

- Retorno no teste: 20.49%. Comprar e segurar: 12.15%. Excesso: 8.33%. Excesso no treino do walk-forward: 8.68%.
- Sharpe anualizado: 0.77. Sharpe por período: 0.0402. Sharpe deflacionado: 0.671 (referência 0.0131, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.812 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0364.
- Observações de retorno no teste: 251.

### ETHUSDT 24h: filtro de vol alta (ridge com futuros) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo ridge com futuros passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 33.16%. Comprar e segurar no mesmo teste: 35.49%. O drawdown caiu.

- Retorno no teste: 11.64%. Comprar e segurar: 12.15%. Excesso: -0.51%. Excesso no treino do walk-forward: 14.89%.
- Sharpe anualizado: 0.56. Sharpe por período: 0.0293. Sharpe deflacionado: 0.603 (referência 0.0131, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.812 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0540.
- Observações de retorno no teste: 251.

### ETHUSDT 24h: tamanho pela vol (vol recente) em comprar e segurar

**reprovada (provável sorte/overfit).** A probabilidade de backtest overfitting ficou em 0,50 ou mais: a configuração que ganha num pedaço tende a perder no pedaço complementar.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o vol recente. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 29.96%. Comprar e segurar no mesmo teste: 35.49%. O drawdown caiu.

- Retorno no teste: 19.96%. Comprar e segurar: 12.15%. Excesso: 7.81%. Excesso no treino do walk-forward: 11.52%.
- Sharpe anualizado: 0.77. Sharpe por período: 0.0403. Sharpe deflacionado: 0.672 (referência 0.0131, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.812 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0540.
- Observações de retorno no teste: 251.

### ETHUSDT 24h: tamanho pela vol (HAR-RV) em comprar e segurar

**reprovada (provável sorte/overfit).** A probabilidade de backtest overfitting ficou em 0,50 ou mais: a configuração que ganha num pedaço tende a perder no pedaço complementar.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 34.45%. Comprar e segurar no mesmo teste: 35.49%. O drawdown caiu.

- Retorno no teste: 13.35%. Comprar e segurar: 12.15%. Excesso: 1.19%. Excesso no treino do walk-forward: 4.52%.
- Sharpe anualizado: 0.60. Sharpe por período: 0.0315. Sharpe deflacionado: 0.617 (referência 0.0131, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.812 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0635.
- Observações de retorno no teste: 251.

### SOLUSDT 4h: filtro de vol alta (vol recente) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo vol recente passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 31.37%. Comprar e segurar no mesmo teste: 37.57%. O drawdown caiu.

- Retorno no teste: 7.74%. Comprar e segurar: 22.51%. Excesso: -14.77%. Excesso no treino do walk-forward: 2.51%.
- Sharpe anualizado: 0.46. Sharpe por período: 0.0099. Sharpe deflacionado: 0.547 (referência 0.0069, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.138 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0184.
- Observações de retorno no teste: 1565.

### SOLUSDT 4h: filtro de vol alta (EWMA) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo EWMA passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 30.73%. Comprar e segurar no mesmo teste: 37.57%. O drawdown caiu.

- Retorno no teste: 10.22%. Comprar e segurar: 22.51%. Excesso: -12.29%. Excesso no treino do walk-forward: 15.44%.
- Sharpe anualizado: 0.52. Sharpe por período: 0.0111. Sharpe deflacionado: 0.567 (referência 0.0069, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.138 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0005.
- Observações de retorno no teste: 1565.

### SOLUSDT 4h: filtro de vol alta (HAR-RV) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 30.36%. Comprar e segurar no mesmo teste: 37.57%. O drawdown caiu.

- Retorno no teste: 21.62%. Comprar e segurar: 22.51%. Excesso: -0.90%. Excesso no treino do walk-forward: 25.93%.
- Sharpe anualizado: 0.77. Sharpe por período: 0.0164. Sharpe deflacionado: 0.647 (referência 0.0069, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.138 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período 0.0035.
- Observações de retorno no teste: 1565.

### SOLUSDT 4h: filtro de vol alta (GARCH(1,1)) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo GARCH(1,1) passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 36.38%. Comprar e segurar no mesmo teste: 37.57%. O drawdown caiu.

- Retorno no teste: -3.93%. Comprar e segurar: 22.51%. Excesso: -26.44%. Excesso no treino do walk-forward: 6.23%.
- Sharpe anualizado: 0.17. Sharpe por período: 0.0037. Sharpe deflacionado: 0.449 (referência 0.0069, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.138 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0086.
- Observações de retorno no teste: 1565.

### SOLUSDT 4h: filtro de vol alta (ridge com futuros) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo ridge com futuros passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 32.53%. Comprar e segurar no mesmo teste: 37.57%. O drawdown caiu.

- Retorno no teste: 17.22%. Comprar e segurar: 22.51%. Excesso: -5.29%. Excesso no treino do walk-forward: 10.86%.
- Sharpe anualizado: 0.68. Sharpe por período: 0.0145. Sharpe deflacionado: 0.618 (referência 0.0069, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.138 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0076.
- Observações de retorno no teste: 1565.

### SOLUSDT 4h: tamanho pela vol (vol recente) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o vol recente. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 36.90%. Comprar e segurar no mesmo teste: 37.57%. O drawdown caiu.

- Retorno no teste: -0.18%. Comprar e segurar: 22.51%. Excesso: -22.70%. Excesso no treino do walk-forward: 3.52%.
- Sharpe anualizado: 0.24. Sharpe por período: 0.0052. Sharpe deflacionado: 0.473 (referência 0.0069, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.138 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0220.
- Observações de retorno no teste: 1565.

### SOLUSDT 4h: tamanho pela vol (HAR-RV) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue comprar e segurar. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 31.77%. Comprar e segurar no mesmo teste: 37.57%. O drawdown caiu.

- Retorno no teste: 18.77%. Comprar e segurar: 22.51%. Excesso: -3.75%. Excesso no treino do walk-forward: 7.71%.
- Sharpe anualizado: 0.71. Sharpe por período: 0.0152. Sharpe deflacionado: 0.629 (referência 0.0069, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.138 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0072.
- Observações de retorno no teste: 1565.

### SOLUSDT 4h: filtro de vol alta (HAR-RV) em a regra logística

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue a regra logística. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 39.24%. Comprar e segurar no mesmo teste: 37.57%. O drawdown não caiu. A mesma regra sem o filtro teve retorno -31.89% nesse teste.

- Retorno no teste: -33.67%. Comprar e segurar: 28.18%. Excesso: -61.85%. Excesso no treino do walk-forward: 50.82%.
- Sharpe anualizado: -2.31. Sharpe por período: -0.0494. Sharpe deflacionado: 0.000 (referência 0.0376, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.818 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0286.
- Observações de retorno no teste: 1552.

### SOLUSDT 4h: tamanho pela vol (HAR-RV) em a regra logística

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue a regra logística. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 36.29%. Comprar e segurar no mesmo teste: 37.57%. O drawdown caiu. A mesma regra sem o filtro teve retorno -31.89% nesse teste.

- Retorno no teste: -31.39%. Comprar e segurar: 28.18%. Excesso: -59.56%. Excesso no treino do walk-forward: 40.41%.
- Sharpe anualizado: -2.19. Sharpe por período: -0.0468. Sharpe deflacionado: 0.000 (referência 0.0376, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.818 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0346.
- Observações de retorno no teste: 1552.

### SOLUSDT 4h: filtro de vol alta (HAR-RV) em a regra de direção

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue a regra de direção. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 54.11%. Comprar e segurar no mesmo teste: 37.57%. O drawdown não caiu. A mesma regra sem o filtro teve retorno -52.65% nesse teste.

- Retorno no teste: -51.64%. Comprar e segurar: 28.18%. Excesso: -79.82%. Excesso no treino do walk-forward: 56.26%.
- Sharpe anualizado: -3.49. Sharpe por período: -0.0746. Sharpe deflacionado: 0.000 (referência 0.0376, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.818 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0384.
- Observações de retorno no teste: 1552.

### SOLUSDT 4h: tamanho pela vol (HAR-RV) em a regra de direção

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue a regra de direção. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 51.87%. Comprar e segurar no mesmo teste: 37.57%. O drawdown não caiu. A mesma regra sem o filtro teve retorno -52.65% nesse teste.

- Retorno no teste: -49.84%. Comprar e segurar: 28.18%. Excesso: -78.01%. Excesso no treino do walk-forward: 50.02%.
- Sharpe anualizado: -3.43. Sharpe por período: -0.0732. Sharpe deflacionado: 0.000 (referência 0.0376, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.818 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0375.
- Observações de retorno no teste: 1552.

### SOLUSDT 4h: filtro de vol alta (HAR-RV) em a regra de funding

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue a regra de funding. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 16.53%. Comprar e segurar no mesmo teste: 37.57%. O drawdown caiu. A mesma regra sem o filtro teve retorno -4.00% nesse teste.

- Retorno no teste: -7.19%. Comprar e segurar: 28.18%. Excesso: -35.37%. Excesso no treino do walk-forward: 36.50%.
- Sharpe anualizado: -0.57. Sharpe por período: -0.0121. Sharpe deflacionado: 0.026 (referência 0.0376, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.818 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0282.
- Observações de retorno no teste: 1552.

### SOLUSDT 4h: tamanho pela vol (HAR-RV) em a regra de funding

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue a regra de funding. Horizonte de 4 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 16.66%. Comprar e segurar no mesmo teste: 37.57%. O drawdown caiu. A mesma regra sem o filtro teve retorno -4.00% nesse teste.

- Retorno no teste: -4.71%. Comprar e segurar: 28.18%. Excesso: -32.88%. Excesso no treino do walk-forward: 33.70%.
- Sharpe anualizado: -0.35. Sharpe por período: -0.0075. Sharpe deflacionado: 0.039 (referência 0.0376, 6 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.818 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0366.
- Observações de retorno no teste: 1552.

### SOLUSDT 24h: filtro de vol alta (vol recente) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo vol recente passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 33.10%. Comprar e segurar no mesmo teste: 36.16%. O drawdown caiu.

- Retorno no teste: 6.84%. Comprar e segurar: 13.55%. Excesso: -6.71%. Excesso no treino do walk-forward: 3.93%.
- Sharpe anualizado: 0.45. Sharpe por período: 0.0233. Sharpe deflacionado: 0.604 (referência 0.0068, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.771 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0416.
- Observações de retorno no teste: 251.

### SOLUSDT 24h: filtro de vol alta (EWMA) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo EWMA passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 33.59%. Comprar e segurar no mesmo teste: 36.16%. O drawdown caiu.

- Retorno no teste: 10.71%. Comprar e segurar: 13.55%. Excesso: -2.84%. Excesso no treino do walk-forward: 7.81%.
- Sharpe anualizado: 0.54. Sharpe por período: 0.0282. Sharpe deflacionado: 0.634 (referência 0.0068, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.771 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0282.
- Observações de retorno no teste: 251.

### SOLUSDT 24h: filtro de vol alta (HAR-RV) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo HAR-RV passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 33.10%. Comprar e segurar no mesmo teste: 36.16%. O drawdown caiu.

- Retorno no teste: 12.76%. Comprar e segurar: 13.55%. Excesso: -0.79%. Excesso no treino do walk-forward: 9.34%.
- Sharpe anualizado: 0.59. Sharpe por período: 0.0308. Sharpe deflacionado: 0.649 (referência 0.0068, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.771 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0382.
- Observações de retorno no teste: 251.

### SOLUSDT 24h: filtro de vol alta (GARCH(1,1)) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo GARCH(1,1) passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 27.36%. Comprar e segurar no mesmo teste: 36.16%. O drawdown caiu.

- Retorno no teste: 6.36%. Comprar e segurar: 13.55%. Excesso: -7.20%. Excesso no treino do walk-forward: 5.60%.
- Sharpe anualizado: 0.43. Sharpe por período: 0.0225. Sharpe deflacionado: 0.599 (referência 0.0068, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.771 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0290.
- Observações de retorno no teste: 251.

### SOLUSDT 24h: filtro de vol alta (ridge com futuros) em comprar e segurar

**reprovada (provável sorte/overfit).** O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.

Fica zerado quando a variância prevista pelo ridge com futuros passa do percentil 80 das previsões do treino daquele bloco. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 35.44%. Comprar e segurar no mesmo teste: 36.16%. O drawdown caiu.

- Retorno no teste: 13.10%. Comprar e segurar: 13.55%. Excesso: -0.46%. Excesso no treino do walk-forward: 7.44%.
- Sharpe anualizado: 0.60. Sharpe por período: 0.0312. Sharpe deflacionado: 0.652 (referência 0.0068, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.771 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0278.
- Observações de retorno no teste: 251.

### SOLUSDT 24h: tamanho pela vol (vol recente) em comprar e segurar

**reprovada (provável sorte/overfit).** A probabilidade de backtest overfitting ficou em 0,50 ou mais: a configuração que ganha num pedaço tende a perder no pedaço complementar.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o vol recente. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 29.57%. Comprar e segurar no mesmo teste: 36.16%. O drawdown caiu.

- Retorno no teste: 16.46%. Comprar e segurar: 13.55%. Excesso: 2.91%. Excesso no treino do walk-forward: 8.32%.
- Sharpe anualizado: 0.68. Sharpe por período: 0.0356. Sharpe deflacionado: 0.678 (referência 0.0068, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.771 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0337.
- Observações de retorno no teste: 251.

### SOLUSDT 24h: tamanho pela vol (HAR-RV) em comprar e segurar

**reprovada (provável sorte/overfit).** A probabilidade de backtest overfitting ficou em 0,50 ou mais: a configuração que ganha num pedaço tende a perder no pedaço complementar.

O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o HAR-RV. O resto segue comprar e segurar. Horizonte de 24 horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco. Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda. Registrado em 2026-11-21T22:40:00.000Z, antes deste teste. Drawdown máximo no teste: 32.49%. Comprar e segurar no mesmo teste: 36.16%. O drawdown caiu.

- Retorno no teste: 14.73%. Comprar e segurar: 13.55%. Excesso: 1.18%. Excesso no treino do walk-forward: 2.89%.
- Sharpe anualizado: 0.63. Sharpe por período: 0.0332. Sharpe deflacionado: 0.664 (referência 0.0068, 7 tentativas, dispersão: desvio-entre-tentativas).
- PBO por CSCV: 0.771 em 12870 divisões.
- Acerto direcional: n/d em 0 decisões, 0 sem sobreposição. p-valor n/d (binomial).
- IC: n/d (p=n/d, n=0).
- Brier: n/d. Brier da taxa-base: n/d.
- Walk-forward: 3 blocos de teste. CPCV com purga e embargo: 15 divisões, mediana do Sharpe por período -0.0424.
- Observações de retorno no teste: 251.

### Kronos-small: dispersão como vol

**inconclusiva.** O Kronos-small fica inconclusivo até uma máquina com o worker e os pesos rodar `npm run validate -- --strategy kronos-vol`. Esta corrida não baixa peso e não inventa a dispersão.

A previsão seria a variância dos log-retornos amostrados no caminho de 6 horas. O alvo é o quadrado do log-retorno nessas 6 horas. Sem o worker, esta linha não recebe número.

Nenhum número novo foi calculado nesta corrida.

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
- BTCUSDT 1h: 17520 candles, 2024-11-01T00:00:00.000Z a 2026-10-31T23:00:00.000Z. SHA-256 c32d91c8daf3f39dcc7e3eaa57bac2a92244ad6a9dd6139c78639f929a8b795e. Fonte: https://data.binance.vision/data/futures/um vol-v1.
- ETHUSDT 1h: 17520 candles, 2024-11-01T00:00:00.000Z a 2026-10-31T23:00:00.000Z. SHA-256 4bd296f48ed1db85dcc4544aaf24b20a8ca3bd2d7693319780fdc016f17ec2ec. Fonte: https://data.binance.vision/data/futures/um vol-v1.
- SOLUSDT 1h: 17520 candles, 2024-11-01T00:00:00.000Z a 2026-10-31T23:00:00.000Z. SHA-256 0bafb5f4f96be6165b7d4326339eccb501b60a77684c059f772313597f91f9cc. Fonte: https://data.binance.vision/data/futures/um vol-v1.

## Tentativas registradas

- kronos: 111
- aranha: 3
- crawler: 3
- futuros-btcusdt: 3
- futuros-ethusdt: 3
- futuros-solusdt: 3
- vol-habilidade: 30
- vol-btcusdt-4h: 7
- vol-btcusdt-4h-regras: 6
- vol-btcusdt-24h: 7
- vol-ethusdt-4h: 7
- vol-ethusdt-4h-regras: 6
- vol-ethusdt-24h: 7
- vol-solusdt-4h: 7
- vol-solusdt-4h-regras: 6
- vol-solusdt-24h: 7
- vol-kronos: 2

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
- Volatilidade: o alvo é a soma dos quadrados dos log-retornos horários das próximas N horas. O módulo do log-retorno do bloco entra na correlação e na cobertura. Nenhum dos dois é feature.
- Volatilidade: a regressão é ridge com funding, variação de open interest, taker e desequilíbrio do livro. LightGBM não entra, para o teste ficar determinístico e sem biblioteca nativa. Trocar por LightGBM seria outro teste.
- Volatilidade: o DSR de cada família conta os filtros registrados nela. A habilidade de previsão fica na família vol-habilidade e não entra nesse DSR, porque não é uma operação. As tentativas foram gravadas antes de ler o teste.
- Volatilidade: no comprar e segurar, a taxa incide só quando a posição muda. Nas regras antigas, a ida e volta cheia do estudo de direção continua sempre que a posição fica ligada.
- Volatilidade: a janela congelada é 2024-11-01T00:00:00.000Z a 2026-11-01T00:00:00.000Z. É a mesma do estudo de direção.

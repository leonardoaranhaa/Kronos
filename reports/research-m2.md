# Pesquisa M2 — o Kronos tem vantagem?

Este estudo pergunta se o Kronos-small acerta a direção melhor do que uma moeda e se alguma regra de operação, depois de taxas, fica melhor do que comprar e segurar. A resposta principal usa só BTCUSDT em candles de 1 hora, no período guardado desde 12 de agosto de 2026. A direção nesse período foi 51.9% (96/185, p=0.330). A configuração escolhida só com dados anteriores rendeu -0.95% fora da amostra. Comprar e segurar rendeu 12.00%. Na amostra de treino essa mesma regra tinha rendido 10.67%. Esse ganho não se repetiu fora da amostra. Nenhuma regra foi promovida para o paper. O padrão continua sendo a regra atual. Na amostra de treino foram comparadas 108 combinações, todas em BTCUSDT 1h. Fora da amostra a direção foi medida em 9 séries. O limite do teste principal é 0.05. Um p-valor pequeno numa série secundária, sozinho, não conta como descoberta. Um número negativo é um resultado. Ele não foi refeito para ficar bonito.

## Como a prova foi feita

- Dados públicos da Binance, sem chave. BTCUSDT, ETHUSDT e SOLUSDT. Intervalos de 5 minutos, 1 hora e 4 horas, a partir de 12 de novembro de 2025.
- O período fora da amostra começa em 12 de agosto de 2026. Ele foi marcado antes de olhar qualquer resultado. Decisões cujo futuro atravessa esse corte não entram no treino nem no teste.
- O treino olha só BTCUSDT de 1 hora, antes do corte, e escolhe uma combinação pelo Sharpe, com pelo menos 20 trades. As outras séries não escolhem regra.
- Amostragem fixa antes de ver o resultado. Contexto 256, 4 amostras por previsão. 5m: horizonte 12, uma decisão a cada 144 candles; 1h: horizonte 6, uma decisão a cada 12 candles; 4h: horizonte 6, uma decisão a cada 2 candles.
- Taxa de 0,1% e slippage de 0,05% por execução. A ordem simulada entra na abertura seguinte.
- A direção usa todos os pontos de decisão, não só os trades. O teste é binomial unilateral contra 50%.
- Combinações na amostra: 108. Testes de direção fora da amostra: 9. Alfa do teste principal: 0.05. Alfa de Bonferroni nas 9 séries: 0.0056.
- Regra escolhida: modo long_short, filtro de média desligado, movimento mínimo 50 bps, múltiplo de ATR 0, dispersão máxima 10000 bps.

## Direção fora da amostra

| Par | Intervalo | Acurácia | Acertos | p-valor | MAE |
| --- | --- | --- | --- | --- | --- |
| BTCUSDT | 5m | 55.68% | 103/185 | 0.0706 | 210.70 |
| BTCUSDT | 1h | 51.89% | 96/185 | 0.3296 | 557.48 |
| BTCUSDT | 4h | 52.36% | 144/275 | 0.2347 | 1566.22 |
| ETHUSDT | 5m | 52.43% | 97/185 | 0.2783 | 9.13 |
| ETHUSDT | 1h | 55.68% | 103/185 | 0.0706 | 23.23 |
| ETHUSDT | 4h | 57.45% | 158/275 | 0.0079 | 62.55 |
| SOLUSDT | 5m | 51.91% | 95/183 | 0.3287 | 0.48 |
| SOLUSDT | 1h | 57.07% | 105/184 | 0.0325 | 1.12 |
| SOLUSDT | 4h | 50.91% | 140/275 | 0.4047 | 3.27 |

## Operação simulada fora da amostra

| Par | Intervalo | Estratégia | Retorno | Drawdown | Acerto dos trades | Trades | Sharpe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 1h | regra-atual | -16.24% | 27.63% | 18.18% | 11 | -1.96 |
| BTCUSDT | 1h | regra-atual-so-compra | -10.41% | 12.31% | 0.00% | 5 | -2.69 |
| BTCUSDT | 1h | escolhida-na-amostra | -0.95% | 18.21% | 58.33% | 12 | 0.08 |
| BTCUSDT | 1h | comprar-e-segurar | 12.00% | 17.86% | 100.00% | 1 | 1.40 |
| BTCUSDT | 1h | ultimo-candle | -25.70% | 29.14% | 40.00% | 85 | -2.96 |
| BTCUSDT | 1h | aleatorio | -41.83% | 42.13% | 35.42% | 48 | -5.55 |
| BTCUSDT | 4h | regra-atual | -39.30% | 40.24% | 18.75% | 16 | -4.33 |
| BTCUSDT | 4h | regra-atual-so-compra | -13.52% | 15.68% | 12.50% | 8 | -3.34 |
| BTCUSDT | 4h | escolhida-na-amostra | -25.01% | 33.86% | 51.52% | 33 | -2.59 |
| BTCUSDT | 4h | comprar-e-segurar | 11.99% | 17.42% | 100.00% | 1 | 1.39 |
| BTCUSDT | 4h | ultimo-candle | -25.04% | 28.77% | 28.13% | 128 | -2.81 |
| BTCUSDT | 4h | aleatorio | -32.83% | 41.83% | 31.18% | 93 | -3.93 |
| BTCUSDT | 5m | regra-atual | 5.56% | 14.90% | 50.00% | 2 | 0.81 |
| BTCUSDT | 5m | regra-atual-so-compra | -1.74% | 12.25% | 0.00% | 1 | -0.08 |
| BTCUSDT | 5m | escolhida-na-amostra | -0.06% | 21.98% | 0.00% | 1 | 0.22 |
| BTCUSDT | 5m | comprar-e-segurar | 11.79% | 18.25% | 100.00% | 1 | 1.38 |
| BTCUSDT | 5m | ultimo-candle | -14.38% | 27.92% | 35.29% | 102 | -1.45 |
| BTCUSDT | 5m | aleatorio | -43.28% | 45.06% | 29.31% | 58 | -5.80 |
| ETHUSDT | 1h | regra-atual | -32.60% | 41.03% | 29.41% | 17 | -2.53 |
| ETHUSDT | 1h | regra-atual-so-compra | -10.54% | 18.53% | 37.50% | 8 | -1.07 |
| ETHUSDT | 1h | escolhida-na-amostra | -11.51% | 34.66% | 66.67% | 18 | -0.59 |
| ETHUSDT | 1h | comprar-e-segurar | 6.17% | 27.98% | 100.00% | 1 | 0.72 |
| ETHUSDT | 1h | ultimo-candle | -10.64% | 31.36% | 34.38% | 96 | -0.63 |
| ETHUSDT | 1h | aleatorio | -53.92% | 63.34% | 30.65% | 62 | -5.81 |
| ETHUSDT | 4h | regra-atual | 42.33% | 18.81% | 29.41% | 17 | 3.05 |
| ETHUSDT | 4h | regra-atual-so-compra | 25.73% | 12.12% | 25.00% | 8 | 2.59 |
| ETHUSDT | 4h | escolhida-na-amostra | -1.91% | 31.39% | 53.49% | 43 | 0.14 |
| ETHUSDT | 4h | comprar-e-segurar | 5.89% | 27.74% | 100.00% | 1 | 0.69 |
| ETHUSDT | 4h | ultimo-candle | -25.56% | 41.03% | 34.07% | 135 | -1.96 |
| ETHUSDT | 4h | aleatorio | -11.97% | 32.48% | 43.37% | 83 | -0.70 |
| ETHUSDT | 5m | regra-atual | 17.07% | 17.84% | 100.00% | 1 | 1.53 |
| ETHUSDT | 5m | regra-atual-so-compra | 0.00% | 0.00% | n/d | 0 | n/d |
| ETHUSDT | 5m | escolhida-na-amostra | -22.29% | 24.99% | 0.00% | 2 | -1.43 |
| ETHUSDT | 5m | comprar-e-segurar | 5.37% | 29.06% | 100.00% | 1 | 0.66 |
| ETHUSDT | 5m | ultimo-candle | -30.50% | 41.19% | 32.00% | 100 | -2.55 |
| ETHUSDT | 5m | aleatorio | 15.89% | 23.21% | 49.02% | 51 | 1.40 |
| SOLUSDT | 1h | regra-atual | -38.78% | 50.37% | 40.00% | 15 | -2.79 |
| SOLUSDT | 1h | regra-atual-so-compra | -13.53% | 21.11% | 57.14% | 7 | -1.71 |
| SOLUSDT | 1h | escolhida-na-amostra | -19.51% | 32.50% | 55.56% | 27 | -1.04 |
| SOLUSDT | 1h | comprar-e-segurar | 6.60% | 34.74% | 100.00% | 1 | 0.73 |
| SOLUSDT | 1h | ultimo-candle | -28.11% | 42.71% | 37.63% | 93 | -1.96 |
| SOLUSDT | 1h | aleatorio | -65.65% | 70.02% | 29.23% | 65 | -6.81 |
| SOLUSDT | 4h | regra-atual | 29.17% | 17.58% | 36.36% | 11 | 2.15 |
| SOLUSDT | 4h | regra-atual-so-compra | 20.01% | 21.26% | 33.33% | 6 | 1.92 |
| SOLUSDT | 4h | escolhida-na-amostra | -13.85% | 34.63% | 46.34% | 41 | -0.55 |
| SOLUSDT | 4h | comprar-e-segurar | 6.83% | 34.27% | 100.00% | 1 | 0.74 |
| SOLUSDT | 4h | ultimo-candle | -27.86% | 41.13% | 32.58% | 132 | -1.96 |
| SOLUSDT | 4h | aleatorio | -7.27% | 22.83% | 49.46% | 93 | -0.24 |
| SOLUSDT | 5m | regra-atual | 53.25% | 8.38% | 100.00% | 2 | 4.38 |
| SOLUSDT | 5m | regra-atual-so-compra | 16.59% | 8.38% | 100.00% | 1 | 2.20 |
| SOLUSDT | 5m | escolhida-na-amostra | -7.52% | 25.19% | 66.67% | 3 | -0.23 |
| SOLUSDT | 5m | comprar-e-segurar | 6.17% | 35.28% | 100.00% | 1 | 0.69 |
| SOLUSDT | 5m | ultimo-candle | -13.04% | 34.34% | 38.95% | 95 | -0.58 |
| SOLUSDT | 5m | aleatorio | -17.85% | 23.81% | 45.31% | 64 | -0.92 |

## Promoção para o paper

- O p-valor da direção foi 0.3296, acima de 0.05.
- Houve 12 trades fora da amostra; o mínimo é 15.
- O retorno -0.95% não superou comprar e segurar (12.00%).

## Limites

- Isto não é conselho de investimento e nenhuma ordem real foi enviada.
- O modelo não é consultado em todo candle. O intervalo entre decisões está na tabela de amostragem e existe para caber em CPU.
- Sharpe anualizado com retornos por candle e 365,25 dias. Ele fica instável quando há poucos trades.
- Venda a descoberto é simulada.
- Nove séries e 108 combinações de treino aumentam a chance de um acaso parecer um achado. Por isso só um teste principal pode habilitar uma estratégia nova.
- O alfa de Bonferroni para as nove direções é 0.05/9. Ele é um aviso, não o teste que decide a promoção.

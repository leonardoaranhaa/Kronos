# Aranha Digital — backtest do gráfico

Simulação de pesquisa. Nenhuma ordem real foi enviada. Um número ruim continua publicado.

A Aranha lê o gráfico. Esta página mede só essa leitura. A web fica de fora de propósito.

- Gerado em: 2026-11-12T17:10:20.278Z
- Par / intervalo: BTCUSDT 5m
- Candles: 16127
- Primeiro openTime: 1789665000000
- Último openTime: 1794502800000
- Arquivo: `data/normalized/BTCUSDT_5m_1789664956464_1794503356693_2026-11-12T17-09-19-346Z.jsonl`
- SHA-256 normalizado: `02905a42384e07ae5ae8a3938023f76135553cb466f1bd960e2226c2c6e3cfc4`
- Janela / horizonte / vizinhos / stride: 48 / 12 / 8 / 12
- Decisões: 1335

## Regras

- Análogos: compra se houver pelo menos 8 trechos, a mediana da hora seguinte for de pelo menos +10 bps e a taxa de alta for de pelo menos 55%. A venda é o espelho. Os números foram escolhidos antes de ver este resultado.
- Estruturas: segue a tendência de 1 hora, e fica de fora se o gráfico de 5 minutos acabou de romper para o lado contrário. A taxa histórica de cada padrão é só informada; ela não escolhe o padrão.
- Filtro de análogos, a parte que dá para medir: segura a compra do último candle quando os trechos parecidos estão claramente para baixo, e o contrário na venda. O filtro completo ao vivo também exige que o tom das notícias discorde. Aqui não há notícia ponto a ponto, então essa metade não entra na simulação.
- Taxa de 0.1% e slippage de 0.05% por execução. A posição usa 100% do caixa.
- A ordem simulada entra na abertura do candle seguinte. As estratégias da Aranha usam a trava diária de -2% e a pausa após 3 perdas. As baselines não usam a trava.
- Janela de comparação: 48 candles de 5 minutos. O horizonte medido dos análogos é 12 candles, cerca de 1 hora. Decisão a cada 12 candles.

## O que os trechos parecidos acertaram

Isto não é taxa de acerto de trade. É a mediana dos trechos parecidos contra o movimento real da hora seguinte, só quando havia pelo menos 8 trechos.

- Direção da mediana: 50.00% (661/1322)
- Erro absoluto médio da mediana: 27.0 bps
- Vezes em que o filtro de análogos segurou o último candle: 501 de 1335 decisões

## Negociação simulada

| Estratégia | Retorno | Drawdown máx. | Taxa de acerto | Trades | Sharpe | Taxas |
| --- | --- | --- | --- | --- | --- | --- |
| Análogos | -39.93% | 45.62% | 25.91% | 193 | -10.41 | 3038.15 |
| Estruturas | -21.86% | 27.91% | 21.13% | 71 | -4.79 | 1268.94 |
| Persistência com filtro de análogos | -58.11% | 59.91% | 17.92% | 307 | -18.08 | 4014.93 |
| Último candle | -87.40% | 87.50% | 15.70% | 656 | -33.59 | 5337.84 |
| Comprar e segurar | -6.57% | 18.25% | 0.00% | 1 | -1.08 | 19.34 |
| Aleatório | -73.70% | 74.14% | 25.65% | 460 | -22.21 | 5231.76 |

Sharpe usa o retorno por candle de 5 minutos, anualizado com 365,25 dias, no trecho entre a primeira decisão e o fim. Taxa de acerto é trades fechados com lucro dividido por trades fechados. A posição aberta no fim é encerrada no último fechamento.

## O que não foi medido

- Isto é uma simulação de pesquisa. Nenhuma ordem real foi enviada.
- A perna da web não entra neste backtest. Notícia histórica, ponto a ponto, não está disponível. Não foi inventado um sentimento do passado. Os snapshots ao vivo ficam em data/aranha/snapshots para uma avaliação futura.
- O filtro completo (análogos e sentimento juntos) está coberto por teste com exemplos fixos. A linha "Persistência com filtro de análogos" mede só a metade dos análogos.
- O sinal do modelo Kronos não foi refiltrado aqui. A estratégia padrão do Kronos continua igual, com o filtro desligado.
- Um trecho parecido só entra se a janela dele não cruza a janela de agora e se o que aconteceu depois já era conhecido naquele instante.
- Taxa de acerto dos padrões é a fração de casos passados em que o preço subiu no horizonte. Amostra pequena continua amostra pequena.
- Um resultado negativo ou fraco continua publicado. Este arquivo não foi refeito para melhorar o número.
- Um único par e uma única janela não dizem como isso se comporta em outros mercados.

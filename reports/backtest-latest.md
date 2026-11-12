# Backtest Kronos — pesquisa

Simulação de pesquisa. Nenhuma ordem real foi enviada. Um número ruim continua publicado.

- Gerado em: 2026-11-12T16:26:18.458Z
- Par / intervalo: BTCUSDT 5m
- Candles: 8063
- Primeiro openTime: 1792080900000
- Último openTime: 1794499500000
- Arquivo: `data/normalized/BTCUSDT_5m_1792080714288_1794499914571_2026-11-12T16-11-56-206Z.jsonl`
- SHA-256 normalizado: `7baca90f442936bdcb8ee70e2704c114dfe17ac803d12c0fb99f7c4b2b66cb5d`
- Modelo: NeoQuasar/Kronos-small
- Tokenizer: NeoQuasar/Kronos-Tokenizer-base
- Commit upstream: `67b630e67f6a18c9e9be918d9b4337c960db1e9a`
- Dispositivo: cpu
- Contexto / horizonte / stride: 400 / 5 / 12
- Decisões: 639
- Tempo de inferência: 169.2 s em 639 previsões

## Regras do sinal

- BUY quando a última previsão sobe pelo menos 30 bps, a EMA9 está acima da EMA20 e o RSI está abaixo de 70.
- SELL quando a última previsão cai pelo menos 30 bps, a EMA9 está abaixo da EMA20 e o RSI está acima de 30.
- Qualquer outro caso é HOLD. HOLD não altera a posição.
- Taxa de 0.1% e slippage de 0.05% por execução. A posição usa 100% do caixa disponível.
- O mínimo de movimento é um portão fixo, igual ao custo estimado de ida e volta. Ele não foi ajustado neste conjunto de dados.
- Uma ordem simulada é preenchida na abertura do candle seguinte. A previsão não entra no preço de execução.
- A estratégia Kronos também obedece a trava diária de -2% e a pausa após 3 perdas. As baselines não usam a trava, para continuar sendo baselines.

## Previsão

- Acurácia direcional no horizonte: 49.77% (318/639)
- MAE do preço previsto: 134.9127
- MAPE: 0.172%

## Negociação simulada

| Estratégia | Retorno | Drawdown máx. | Taxa de acerto | Trades | Sharpe | Taxas |
| --- | --- | --- | --- | --- | --- | --- |
| Kronos | -13.69% | 14.60% | 25.00% | 12 | -6.94 | 223.75 |
| Comprar e segurar | -11.80% | 15.94% | 0.00% | 1 | -4.57 | 18.82 |
| Último candle | -65.13% | 65.13% | 16.40% | 317 | -35.02 | 3873.62 |
| Aleatório | -54.91% | 55.31% | 18.88% | 233 | -27.29 | 3217.05 |

- Travas diárias disparadas na estratégia Kronos: 6
- Pausas por perdas seguidas: 0

Sharpe usa o retorno por candle de 5 minutos, anualizado com 365,25 dias, no trecho entre a primeira decisão e o fim. Taxa de acerto é trades fechados com lucro dividido por trades fechados. A posição que ainda estiver aberta é encerrada no último fechamento.

## Limites

- Isto é uma simulação de pesquisa. Nenhuma ordem real foi enviada.
- O modelo foi consultado a cada 12 candles de 5 minutos (cerca de 60 minutos), não em todo candle. Entre as decisões, a última posição simulada permanece aberta.
- A pausa de 30 minutos depois de 3 perdas pode não aparecer neste relatório quando o intervalo entre decisões é maior do que a pausa. A trava diária de -2% é avaliada em todo candle.
- O timeout de heartbeat do feed vale para o socket ao vivo. Ele não é reaplicado neste histórico, porque os candles de 5 minutos já passaram na auditoria de continuidade.
- Venda a descoberto aqui é simulada. Não há empréstimo, funding nem fila de ordem da corretora.
- Um resultado negativo ou fraco é um resultado válido. Este relatório não foi refeito para melhorar o número.
- Um único intervalo, um único par e uma única janela não dizem como o modelo se comporta em outros mercados.

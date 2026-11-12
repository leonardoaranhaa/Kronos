# Crawler — as moedas do topo rendem mais?

Simulação de pesquisa. Nenhuma ordem real foi enviada. Um número ruim continua publicado.

A pergunta: se, a cada hora, a gente comprasse as 3 moedas com maior score e comparasse com comprar todas as moedas da lista, o topo ganharia nas 1 hora, 4 horas e 24 horas seguintes?

- Gerado em: 2026-11-12T18:51:40.781Z
- Moedas: BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, AVAXUSDT, LINKUSDT, DOTUSDT, LTCUSDT, BCHUSDT
- Candles de 5 minutos usados: 72564
- Decisões: 476
- Primeiro openTime: 1792709700000
- Último openTime: 1794419700000
- Fórmulas comparadas: 3
- Taxa de ida e volta: 30 bps

## Resultado

### Score da Aranha

| Horizonte | Vezes | Top 3 líquido | Universo líquido | Diferença | Top 3 ganhou |
| --- | --- | --- | --- | --- | --- |
| 1 hora | 476 | -0.326% | -0.328% | 0.003% | 48.7% |
| 4 horas | 476 | -0.390% | -0.418% | 0.028% | 50.8% |
| 24 horas | 476 | -1.136% | -1.169% | 0.033% | 54.4% |

### Só o retorno da última hora

| Horizonte | Vezes | Top 3 líquido | Universo líquido | Diferença | Top 3 ganhou |
| --- | --- | --- | --- | --- | --- |
| 1 hora | 476 | -0.334% | -0.328% | -0.006% | 48.7% |
| 4 horas | 476 | -0.445% | -0.418% | -0.027% | 47.5% |
| 24 horas | 476 | -1.249% | -1.169% | -0.081% | 46.4% |

### Só o volume com direção

| Horizonte | Vezes | Top 3 líquido | Universo líquido | Diferença | Top 3 ganhou |
| --- | --- | --- | --- | --- | --- |
| 1 hora | 476 | -0.319% | -0.328% | 0.009% | 50.6% |
| 4 horas | 476 | -0.389% | -0.418% | 0.030% | 52.1% |
| 24 horas | 476 | -1.111% | -1.169% | 0.058% | 51.7% |

## Regras

- A cada hora, as moedas com barra naquele instante entram na conta.
- O score usa tendência de 1h e 4h, rompimento, volume, trechos parecidos, força contra o BTC, taker-buy e um desconto se a volatilidade está alta.
- As outras duas fórmulas são só o retorno da última hora, e o volume anormal com o sinal da vela.
- Compra as 3 primeiras em partes iguais. A comparação é a média de todas as moedas disponíveis naquela hora.
- O que acontece depois da hora da decisão não entra no score.

## O que não foi medido

- Isto é uma simulação de pesquisa. Nenhuma ordem real foi enviada.
- Foram comparadas 3 fórmulas, escritas antes de ver este arquivo. As três estão na tabela. Nenhuma foi apagada por ter ido mal.
- A lista de moedas é fixa (BTC, ETH, BNB, SOL, XRP, DOGE, ADA, AVAX, LINK, DOT, LTC, BCH). Não é o ranking de volume de hoje, para não escolher o passado com o que está grande agora.
- Cada lado paga 30 bps de ida e volta (0,1% de taxa e 0,05% de slippage em cada execução). A diferença entre o top 3 e o universo não muda com essa taxa, porque os dois pagam. O número líquido mostra se o top 3 ganhou dinheiro de verdade.
- A pressão de baleia neste estudo é a parcela de taker-buy dos candles da Binance. Não é a fita de negócios grandes nem a cadeia. Isso não estava disponível ponto a ponto sem um arquivo enorme.
- Transações on-chain não entram aqui. Elas passam a ser gravadas ao vivo em data/crawler, para um estudo futuro. Não foi inventado histórico de baleia na cadeia.
- O modelo Kronos não entra neste ranking. Ele é lento demais para todas as moedas.
- Um resultado fraco continua publicado.

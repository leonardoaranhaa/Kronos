# Vol targeting com HAR-RV (Fases 3 e 4)

Simulação de pesquisa. Nenhuma ordem real foi enviada. Um número ruim continua publicado. Isto não é conselho de investimento.

Gerado em 2026-11-28T09:35:03.473Z. Protocolo `vol-target-v1`, registrado em 2026-11-28T09:35:00.000Z.

## Regra

Comprado em BTC, ETH e SOL perpétuos, com peso = mín(1, mediana das previsões HAR-RV do treino ÷ previsão de agora). Taxa e slippage a cada mudança de peso; funding pago pelo comprado. Blocos de 4h e de 24h.

**Aprovada** só se, nas seis células: Sharpe anualizado acima do de comprar e segurar, drawdown máximo abaixo do de comprar e segurar, Sharpe deflacionado de pelo menos 0.95, pelo menos 30 retornos e, no retrospectivo, PBO abaixo de 0.5.

## Retrospectivo (2024-11 a 2026-11): não decide

Esta janela já foi pontuada com esta mesma carteira pela régua antiga (vol-v1), e os números foram vistos antes deste critério existir. Ler o mesmo dado com um critério novo não é teste. Os números saem aqui para registro.

Resultado retrospectivo: **reprovada**.

| Moeda | Horizonte | Veredito | Sharpe | Sharpe segurar | Drawdown | Drawdown segurar | Retorno | Retorno segurar | Peso médio | DSR | PBO | Retornos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 4h | reprovada | 0.07 | 0.69 | 27.39% | 29.31% | -2.13% | 15.00% | 0.88 | 0.250 | 0.056 | 1565 |
| BTCUSDT | 24h | reprovada | 0.42 | 0.60 | 26.47% | 28.52% | 6.18% | 11.62% | 0.89 | 0.522 | 0.117 | 251 |
| ETHUSDT | 4h | reprovada | 0.44 | 0.63 | 35.21% | 38.02% | 7.20% | 14.76% | 0.96 | 0.410 | 0.171 | 1565 |
| ETHUSDT | 24h | reprovada | 0.60 | 0.57 | 34.45% | 35.49% | 13.35% | 12.15% | 0.97 | 0.617 | 0.812 | 251 |
| SOLUSDT | 4h | reprovada | 0.71 | 0.78 | 31.77% | 37.57% | 18.77% | 22.51% | 0.96 | 0.629 | 0.138 | 1565 |
| SOLUSDT | 24h | reprovada | 0.63 | 0.60 | 32.49% | 36.16% | 14.73% | 13.55% | 0.96 | 0.664 | 0.771 | 251 |

- BTCUSDT 4h: Sharpe 0.07 não passa o de comprar e segurar (0.69); DSR 0.250 abaixo de 0.95. Sharpe da estratégia reproduzido (publicado 0.07).
- BTCUSDT 24h: Sharpe 0.42 não passa o de comprar e segurar (0.60); DSR 0.522 abaixo de 0.95. Sharpe da estratégia reproduzido (publicado 0.42).
- ETHUSDT 4h: Sharpe 0.44 não passa o de comprar e segurar (0.63); DSR 0.410 abaixo de 0.95. Sharpe da estratégia reproduzido (publicado 0.44).
- ETHUSDT 24h: DSR 0.617 abaixo de 0.95; PBO 0.812 não fica abaixo de 0.5. Sharpe da estratégia reproduzido (publicado 0.60).
- SOLUSDT 4h: Sharpe 0.71 não passa o de comprar e segurar (0.78); DSR 0.629 abaixo de 0.95. Sharpe da estratégia reproduzido (publicado 0.71).
- SOLUSDT 24h: DSR 0.664 abaixo de 0.95; PBO 0.771 não fica abaixo de 0.5. Sharpe da estratégia reproduzido (publicado 0.63).

## Forward: decide

Começa em 2026-11-29T00:00:00.000Z, depois do commit que congelou esta regra. O HAR é reajustado a cada bloco só com blocos cujo rótulo já fechou. Leitura interina aos 90 dias (publicada, não decide). Veredito final aos 365 dias. Só conta bloco com funding mensal já publicado em data.binance.vision. O DSR usa 6 tentativas (uma hipótese por célula) e o erro-padrão do Sharpe; o PBO não entra, porque a carteira foi escolhida antes dos dados.

Estado: **aguardando**.

| Moeda | Horizonte | Veredito | Sharpe | Sharpe segurar | Drawdown | Drawdown segurar | Retorno | Retorno segurar | Peso médio | DSR | PBO | Retornos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 4h | aguardando | n/d | n/d | n/d% | n/d% | n/d% | n/d% | n/d | n/d | n/d | 0 |
| BTCUSDT | 24h | aguardando | n/d | n/d | n/d% | n/d% | n/d% | n/d% | n/d | n/d | n/d | 0 |
| ETHUSDT | 4h | aguardando | n/d | n/d | n/d% | n/d% | n/d% | n/d% | n/d | n/d | n/d | 0 |
| ETHUSDT | 24h | aguardando | n/d | n/d | n/d% | n/d% | n/d% | n/d% | n/d | n/d | n/d | 0 |
| SOLUSDT | 4h | aguardando | n/d | n/d | n/d% | n/d% | n/d% | n/d% | n/d | n/d | n/d | 0 |
| SOLUSDT | 24h | aguardando | n/d | n/d | n/d% | n/d% | n/d% | n/d% | n/d | n/d | n/d | 0 |

- BTCUSDT 4h: Nenhum bloco de 4h fechado depois de 2026-11-29T00:00:00.000Z com funding publicado.
- BTCUSDT 24h: Nenhum bloco de 24h fechado depois de 2026-11-29T00:00:00.000Z com funding publicado.
- ETHUSDT 4h: Nenhum bloco de 4h fechado depois de 2026-11-29T00:00:00.000Z com funding publicado.
- ETHUSDT 24h: Nenhum bloco de 24h fechado depois de 2026-11-29T00:00:00.000Z com funding publicado.
- SOLUSDT 4h: Nenhum bloco de 4h fechado depois de 2026-11-29T00:00:00.000Z com funding publicado.
- SOLUSDT 24h: Nenhum bloco de 24h fechado depois de 2026-11-29T00:00:00.000Z com funding publicado.

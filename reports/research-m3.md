# Pesquisa M3 — correção do RoPE e a mesma prova

O modelo oficial continua no commit 67b630e. Por cima dele entrou um patch local, o conserto de RoPE do pull request 425, que ainda não foi mergeado. A regra de operação não foi escolhida de novo. É a mesma da pesquisa anterior: long/short, sem filtro de média, movimento mínimo de 50 bps, sem filtro de ATR e sem filtro de dispersão.

No BTCUSDT de 1 hora, depois de 12 de agosto de 2026, a direção era 51.89% (96/185, p=0.330) antes do patch e ficou 52.43% (97/185, p=0.278) depois. A regra congelada rendeu -0.95% antes e -10.87% depois. Comprar e segurar rendeu 12.00% antes e 12.00% depois.

Essa comparação deixa o tokenizer em modo de treino, como na pesquisa anterior, para a única mudança medida ser o RoPE. O worker normal agora coloca modelo e tokenizer em eval. Isso não entra nesta tabela. Nenhuma regra nova foi testada: a contagem de variantes desta etapa é zero.

Os pesos baixados do Hugging Face podem ser anteriores à correção de vazamento discutida nas issues 307 e 422. Este patch não troca esses pesos.

| | Antes (sem o patch) | Depois (RoPE #425) |
| --- | --- | --- |
| Acurácia direcional | 51.89% | 52.43% |
| p-valor contra 50% | 0.3296 | 0.2783 |
| MAE no fim do horizonte | 557.48 | 576.05 |
| Retorno da regra congelada | -0.95% | -10.87% |
| Trades | 12 | 10 |
| Drawdown da regra | n/d nesta coluna | 20.31% |
| Sharpe da regra | n/d nesta coluna | -1.04 |
| Comprar e segurar | 12.00% | 12.00% |

## Calibração de P(alta)

P(alta) é a fração das 4 amostras cujo preço final fica acima do fechamento da decisão. A tabela é só o período fora da amostra, no modelo já corrigido. Com 4 amostras os valores possíveis são 0, 0,25, 0,50, 0,75 e 1.

| P(alta) declarada | Previsões | Vezes em que o preço subiu |
| --- | --- | --- |
| 0% | 34 | 67.6% |
| 25% | 63 | 44.4% |
| 50% | 44 | 47.7% |
| 75% | 25 | 56.0% |
| 100% | 19 | 57.9% |

Uma P(alta) calibrada acompanharia a coluna da direita. Quando o modelo disse 0%, o preço ainda subiu na maioria desses casos. A probabilidade não está calibrada. Esta tabela não foi usada para escolher regra.

## O que mais mudou no worker

- Modelo e tokenizer ficam em eval no uso normal, como nos pull requests 382 e 407. O pull request 253 não foi aplicado.
- Várias séries do mesmo tamanho podem ir em um predict_batch. Nesta CPU, 3 janelas de 256 candles de 1 hora, horizonte 6, uma amostra: uma por vez levou 0,696 s, 0,725 s e 0,664 s (média 0,695 s). O lote levou 0,913 s, 0,577 s e 0,559 s (média 0,683 s). O lote só fica mais rápido depois da primeira chamada. Não é um ganho grande para três pares.
- A previsão pode devolver a banda de 10/50/90 e P(alta). O cache de amostras não usa o KV cache do pull request 393.

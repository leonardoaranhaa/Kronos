# Crypto Crawling

Plataforma local de pesquisa e paper trading. Ela estuda o modelo público [Kronos](https://github.com/shiyu-coder/Kronos) em candles de BTCUSDT, baixa dados públicos, pede uma previsão ao modelo oficial e transforma essa previsão em um sinal de **compra**, **venda** ou **manter**. O sinal pode ser simulado com taxas. Nada disso envia uma ordem. A leitura do gráfico fica com a Aranha.

Não há taxa de acerto prometida. O número antigo de 97,48% não foi medido: o script que o produzia sorteava vitórias. Esse script foi desligado. O resultado que vale é o arquivo gerado por `npm run backtest`.

## O que este programa faz

- Lê candles públicos da Binance, sem chave de API.
- Roda o modelo oficial `NeoQuasar/Kronos-small` com o tokenizer `NeoQuasar/Kronos-Tokenizer-base`.
- Mostra o preço, a previsão e o sinal num painel.
- Simula compras e vendas com taxa e slippage, e grava um registro local.
- Trava a simulação se o dia perde 2%, se acontecem 3 perdas seguidas, ou se o feed fica em silêncio.
- Compara o backtest com comprar-e-segurar, com “seguir o último candle” e com um sorteio de semente fixa.

## O que este programa não faz

- Não envia ordens.
- Não usa chave, segredo ou conta da corretora.
- Não opera sozinho com dinheiro real.
- O arquivo antigo `server/order_execution.ts` continua no repositório só como código legado. O servidor não o importa e os testes não o executam.

## Começar em uma máquina nova

É preciso Node.js 20 ou mais novo, Python 3.10 ou mais novo e git. No Debian ou Ubuntu, se o Python reclamar de ambiente virtual, instale antes: `sudo apt install python3-venv`.

```bash
git clone https://github.com/leonardoaranhaa/Kronos.git
cd Kronos
npm install
cp .env.example .env
bash scripts/setup-kronos.sh
```

O script cria a pasta `.venv`, instala o PyTorch de CPU e usa `pandas==2.2.3`. A versão 2.2.2 pedida pelo código original não tem pacote pronto para Python 3.13. Ele também grava no `.env` o caminho do Python da venv e `KRONOS_DEVICE=cpu`.

Para um teste curto, importe os candles recentes:

```bash
npm run import:binance
```

O comando imprime um manifesto. Se `quality.valid` for `true`, copie o `normalizedPath` para `HISTORICAL_DATA_PATH` no `.env`.

Para o backtest de algumas semanas, antes de importar defina um `START_TIME` em milissegundos. Quatro semanas de candles de 5 minutos são cerca de 8 mil linhas. Não use um arquivo cuja auditoria aponte buracos ou duplicatas.

Suba o painel:

```bash
npm run dev
```

Abra `http://localhost:5173`. O servidor de dados fica em `http://localhost:3000`. O aviso no topo do painel é parte do produto: pesquisa e simulação.

## Um comando para a checagem local

Sem internet, sem modelo e sem ordem:

```bash
npm run check
```

Isso roda os testes, o build, a sintaxe do worker Python e a sintaxe do script de instalação. É o mesmo tipo de checagem da integração contínua.

O backtest é outro comando, de propósito. Ele baixa ou lê o modelo e pode levar vários minutos:

```bash
npm run backtest
```

Ele grava `reports/backtest-latest.json` e `reports/backtest-latest.md`. O painel, na aba Backtest, lê o JSON. O relatório vale com o número que sair, inclusive se a estratégia perder para comprar e segurar.

A validação offline, com walk-forward, purga, Sharpe deflacionado e PBO, é outro comando. Ela também não envia ordem:

```bash
npm run validate
```

Isso mede a Aranha e o crawler e deixa o Kronos inconclusivo se o modelo não estiver na máquina. O veredito fica em `reports/validation-latest.md` e na aba Pesquisa. A regra exata está no topo desse relatório.

Para medir o Kronos num computador que já tenha o worker Python e os pesos (`bash scripts/setup-kronos.sh`), um comando por estratégia. Ele baixa BTCUSDT de 1 hora, grava o cache em `data/research-cache/` e troca só a linha correspondente do relatório. `KRONOS_VALIDATION_DAYS` muda a janela; o padrão é 120.

```bash
npm run validate -- --strategy kronos-m2
npm run validate -- --strategy kronos-m3
npm run validate -- --strategy kronos-rule
```

`KRONOS_VALIDATION_END_MS` (timestamp em milissegundos) congela o fim da janela, para que os três comandos leiam o mesmo snapshot.

Os futuros públicos da Binance (funding, open interest, long/short, taker e livro) usam outro comando, também sem chave e sem ordem:

```bash
npm run futures:import
npm run validate -- --strategy futuros
```

O importador lê `data.binance.vision`. Os arquivos vão para `data/futures`, ou para `$DATA_DIR/futures` quando `DATA_DIR` está definido (no Fly, `/data`). O coletor ao vivo sobe junto com o servidor e grava em `futures/live`. A regra do modelo fica em `server/futures/protocol.ts` e no `reports/trial-log.jsonl` antes da conta. A aba Pesquisa mostra o veredito. No gráfico, a camada Funding / OI é opcional e só visual.

`kronos-m2` deixa o tokenizer em treino, como no estudo antigo. `kronos-m3` e `kronos-rule` exigem o patch de RoPE já aplicado no checkout. `kronos-rule` é a regra ao vivo, com o bloqueio de RSI.

Cada tentativa medida grava o seu Sharpe por período em `reports/trial-log.jsonl`. O Sharpe deflacionado usa o desvio-padrão desses Sharpes. A grade de 108 combinações do M2 entra na contagem, mas o arquivo antigo não guardou o Sharpe de cada combinação, então ela não entra na dispersão. O erro-padrão do Sharpe só substitui essa dispersão quando há menos de dois Sharpes gravados.

## Regras do sinal

Tudo é calculado só com candles já fechados.

- A previsão de retorno é a distância, em pontos-base, entre o preço de agora e o último preço previsto.
- **Compra** se essa alta for de pelo menos 30 bps, a EMA de 9 estiver acima da EMA de 20, e o RSI de 14 estiver abaixo de 70.
- **Venda** se a queda for de pelo menos 30 bps, a EMA de 9 estiver abaixo da EMA de 20, e o RSI estiver acima de 30.
- **Manter** em qualquer outro caso. Manter não mexe na posição.
- 30 bps é o custo estimado de ida e volta: 0,1% de taxa e 0,05% de slippage de cada lado. Não foi ajustado para melhorar um resultado.
- A “força” mostrada no painel é uma escala visual de 0 a 100. Não é chance de ganho.

Na simulação, a ordem entra na abertura do candle seguinte, não no candle que gerou o sinal. Venda a descoberto é simulada: não há empréstimo na corretora.

## Trava de risco

- Perda de 2% em relação ao patrimônio do começo do dia UTC encerra a posição e bloqueia entradas novas até o dia seguinte.
- Três operações fechadas no prejuízo seguidas criam uma pausa de 30 minutos. Durante a pausa dá para sair, não para abrir outra ponta.
- Se o feed ao vivo ficar mais de 30 segundos sem mensagem, entradas novas ficam bloqueadas. Isso não é reaplicado no backtest histórico, porque a série já foi auditada.

O registro fica em `data/audit/paper.jsonl`. O estado da carteira simulada fica em `data/paper/state.json`. Os dois são locais e não vão para o git.

Telegram é opcional. Preencha `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` para receber um aviso. Sem os dois, nenhum aviso é enviado. A mensagem diz que nenhuma ordem real foi enviada.

## Pesquisa de vantagem

`npm run research:m3` repete só a prova principal (BTCUSDT 1h, corte de 12 de agosto de 2026) depois do patch de RoPE, sem escolher a regra de novo. O resultado fica em `reports/research-m3.md`.

`npm run research` repete o estudo do milestone 2. Ele precisa dos candles importados de BTCUSDT, ETHUSDT e SOLUSDT em 5m, 1h e 4h desde 12 de novembro de 2025, e do modelo oficial. As previsões ficam em cache em `data/research-cache/`, então uma segunda execução não refaz o que já foi calculado.

O corte fora da amostra é 12 de agosto de 2026 e está fixo no código. O treino só olha BTCUSDT de 1 hora antes desse corte. O resultado sai em `reports/research-m2.md`, com um resumo no começo e as tabelas em seguida. A aba Pesquisa do painel lê o mesmo relatório. Uma estratégia nova só fica disponível no paper se aquele teste principal passar; o padrão continua sendo a regra atual.

## Backtest

O modelo não é chamado em todo candle de 5 minutos. O padrão é uma decisão a cada 12 candles, cerca de uma hora, com 400 candles de contexto e horizonte de 5. Entre decisões, a última posição simulada continua aberta. O arquivo de relatório repete esse fato e traz acurácia direcional, erro absoluto médio, retorno, drawdown, taxa de acerto, número de trades e Sharpe.

As baselines usam as mesmas taxas. Só a estratégia do modelo usa a trava diária. Comprar e segurar não é interrompida por ela, senão deixaria de ser comprar e segurar.

## Aranha Digital

A Aranha lê o gráfico. Ela compara as últimas 48 velas de 5 minutos com trechos antigos do mesmo arquivo, monta 1 hora e 4 horas a partir desses candles, e marca suporte, resistência, tendência, rompimento, candles clássicos e volume anormal. Ao lado de cada padrão aparece o que veio depois, com a quantidade de casos. Isso funciona sem chave.

A web é apoio. Com `ANTHROPIC_API_KEY` vazio, o painel diz **LLM desligado** e usa uma lista fixa de palavras. Com a chave, o Claude (Anthropic) pode resumir as notícias e usar a busca da própria Anthropic. Um endpoint compatível com OpenAI fica como segunda opção. Não há chave no código.

O filtro que segura compra ou venda quando os trechos e as notícias discordam nasce desligado. A estratégia padrão do Kronos não muda.

O backtest da Aranha mede o gráfico, com as mesmas taxas do outro backtest. A web não entra nessa conta: notícia antiga, no instante certo, não está disponível. As coletas de agora em diante ficam em `data/aranha/snapshots`.

```bash
npm run backtest:aranha
```

O resultado vai para `reports/aranha-latest.md`. A aba Aranha do painel mostra o gráfico, os trechos, as notícias e esse relatório.

## Crawler

A aba Crawler olha várias moedas USDT de uma vez e ordena por um score explicado em português. O modelo Kronos, quando está pronto, só é chamado nas primeiras da lista. Baleias da Binance e transações grandes públicas aparecem na mesma aba. O estudo histórico é outro comando:

```bash
npm run backtest:crawler
```

Ele responde se o topo da lista rendeu mais que a média das moedas nas horas seguintes. A cadeia não entra nesse estudo.

## Teia no gráfico

Na aba Aranha, passar o mouse numa vela abre a teia. O clique fixa essa vela. A camada **Teia** liga e desliga um ponto pequeno nas velas que têm eventos gravados na janela anterior. A janela padrão é 30 minutos. Dá para trocar para 15 minutos, 1 hora ou 4 horas.

O centro do desenho é a vela. Os pontos ao redor são o que já estava gravado antes da abertura: baleias (negócio agregado de pelo menos US$ 100 mil), paredes do livro, transferências on-chain de BTC ou ETH, notícias, medo e ganância, e a posição no ranking. O tamanho do ponto segue o valor em dólar, quando o arquivo tem esse valor. O texto fixo do painel é: "Eventos próximos no tempo não provam causa." Não há nota de causalidade e não há sinal de compra ou venda. O volume da própria vela não entra na conta.

Se a janela não tem nada gravado, o painel diz "sem eventos gravados nessa janela". Se a vela é anterior ao primeiro arquivo, o painel diz que dados de antes do início da gravação não existem.

A leitura usa `data/crawler/whales.jsonl`, `data/crawler/onchain.jsonl`, os diários `rankings-*.jsonl` e `walls-*.jsonl`, e os snapshots em `data/aranha/snapshots`.

### Rota para a allowlist do proxy

O proxy público é só de leitura. A teia acrescenta uma rota GET, que precisa entrar na allowlist:

`GET /api/teia`

Não existe POST. A rota não grava arquivo, não calcula sinal e não envia ordem.

```
GET /api/teia?symbol=BTCUSDT&time=1763132400000&window=30m
GET /api/teia?symbol=BTCUSDT&from=1763128800000&to=1763136000000&window=30m&interval=5m
```

`symbol` é o par, por exemplo `BTCUSDT`. `time` é a abertura da vela, em milissegundos. A resposta dessa forma traz os eventos em `[time - janela, time)`. `window` aceita `15m`, `30m` (o padrão, se o parâmetro faltar), `1h` e `4h`.

Sem `time`, `from`, `to` e `interval` devolvem os marcadores: as aberturas de vela, dentro do intervalo, cuja janela anterior tem evento. `interval` aceita `1m`, `5m`, `15m`, `1h`, `4h` e `1d`.

## Extensão do Chrome

Há um painel lateral, só de leitura, para quem está numa aba da Binance ou do TradingView. A instalação em modo do desenvolvedor está em [extension/README.md](extension/README.md), em poucos passos. O arquivo zip sai com `bash scripts/pack-extension.sh`.

## Deploy no Fly.io

O deploy público fica em São Paulo (`gru`). A Binance bloqueia vários IPs dos Estados Unidos, então a máquina não pode subir em `iad` ou `ord`. Quem roda o `flyctl` é você, no seu computador. Este repositório não guarda token e não envia o deploy sozinho.

A imagem traz o painel, o servidor, o coletor da Aranha, o crawler e o worker do Kronos-small. O torch é só de CPU, para a imagem não levar CUDA. O patch `patches/kronos-rope-425.patch` entra no código do Kronos no build, como o `scripts/setup-kronos.sh` faz na máquina local. Os pesos (`NeoQuasar/Kronos-small` e o tokenizer) baixam no primeiro start e ficam em `/data/huggingface`, no volume. Os relatórios já commitados (pesquisa, backtest, Aranha e crawler) vão dentro da imagem, em `/app/reports`, que é de onde o painel lê. O volume guarda o que o coletor passa a gravar, não esses arquivos.

Um processo supervisor (`scripts/supervise.mjs`) sobe o servidor e sobe de novo se ele cair ou se `/api/health` parar de responder. A Aranha e o crawler nascem dentro desse servidor. Eles continuam gravando no volume. O que fica fechado é a porta pública: com `PUBLIC_READONLY=1` o servidor só aceita GET, HEAD e o WebSocket `/ws`. POST, PUT, PATCH e DELETE voltam 405. Caminhos de ordem ou admin voltam 403. Se existir chave de corretora no ambiente, o processo apaga essas variáveis ao subir. O módulo antigo de ordem não entra na imagem.

`/api/health` no modo público responde HTTP 200 assim que o processo está de pé, para a Fly não reiniciar a máquina enquanto o modelo baixa. O JSON continua com `ready: false` até o feed e o modelo estarem prontos.

A máquina sugerida é `shared-cpu-2x` com 2 GB. É o bastante para o Kronos-small em CPU na maior parte dos casos. Se uma previsão for morta por falta de memória, troque `memory` no `fly.toml` para `"4gb"`. Uma máquina dessa, ligada o tempo todo, fica em torno de US$ 15 a US$ 25 por mês, mais cerca de US$ 0,15 por GB do volume (10 GB ficam perto de US$ 1,50). O preço muda. A tabela oficial é [fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/).

O nome padrão do app é `crypto-crawling`. Se esse nome já existir, edite `app` no `fly.toml` antes dos comandos. O volume se chama `crawling_data` e só cabe em uma máquina.

```bash
fly launch --no-deploy --copy-config --name crypto-crawling --region gru --yes
fly volumes create crawling_data --region gru --size 10 --yes
fly scale count 1 --region gru
fly deploy
fly logs
```

`fly logs` mostra o que a máquina está imprimindo. `fly status` diz se ela está ligada. Não coloque `BINANCE_API_KEY` nem `BINANCE_API_SECRET` em `fly secrets`. Não são usadas e o modo público as descarta.

## Layout

```text
src/client/     painel
extension/      painel lateral do Chrome
server/         dados, modelo, sinal, paper e backtest
shared/         tipos
reports/        último backtest, quando você rodar o comando
docs/           plano de engenharia e setup dos dados
```

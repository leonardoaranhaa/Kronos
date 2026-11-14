# Kronos — pesquisa e paper

Ferramenta local para estudar o modelo público [Kronos](https://github.com/shiyu-coder/Kronos) em candles de BTCUSDT. Ela baixa dados públicos, pede uma previsão ao modelo oficial e transforma essa previsão em um sinal de **compra**, **venda** ou **manter**. O sinal pode ser simulado com taxas. Nada disso envia uma ordem.

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

## Layout

```text
src/client/     painel
server/         dados, modelo, sinal, paper e backtest
shared/         tipos
reports/        último backtest, quando você rodar o comando
docs/           plano de engenharia e setup dos dados
```

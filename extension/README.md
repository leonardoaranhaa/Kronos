# Extensão Crypto Crawling

Painel lateral do Chrome. Ele só lê o servidor de pesquisa. Não clica na corretora, não envia ordem e não pede chave.

## Instalar

1. Abra o Chrome.
2. Na barra de endereço, escreva `chrome://extensions` e aperte Enter.
3. Ligue **Modo do desenvolvedor**. O interruptor fica no canto superior direito.
4. Clique em **Carregar sem compactação**.
5. Escolha a pasta `extension` deste projeto (a pasta que contém o arquivo `manifest.json`) e confirme.
6. O ícone do quebra-cabeça fica na barra do Chrome. Ache **Crypto Crawling** e clique no alfinete, se quiser deixá-lo visível.
7. Clique no ícone da extensão. O painel abre do lado direito.

## Endereço do servidor

O padrão é `http://localhost:3000`, o servidor neste computador.

Para um link público (por exemplo `https://algum-nome.trycloudflare.com`):

1. No painel, clique em **Servidor**.
2. Cole o endereço, sem barra no final.
3. Clique em **Guardar**.

Esse link precisa responder em `/api` e em `/ws`. Localhost e endereços `trycloudflare.com` já estão autorizados. Outro endereço pede uma confirmação do Chrome.

## O que aparece

Com uma aba da Binance (à vista ou futuros) ou do TradingView aberta no par, o painel mostra preço, variação, o texto da Aranha, o lugar no ranking, baleias, paredes do livro, medo e ganância, e a previsão do Kronos quando o servidor a tiver.

Se a aba não tiver um par, o painel lista o topo do ranking. Dá para escolher um par na lista.

**Servidor fora do ar** significa que o endereço não respondeu. **Sem dados** significa que o servidor respondeu, mas não tem aquele número.

O aviso amarelo fica sempre visível: isto é pesquisa e não é uma vantagem comprovada.

## Arquivo zip

Na pasta do projeto, quem for empacotar roda:

```bash
bash scripts/pack-extension.sh
```

O arquivo sai em `dist/crypto-crawling-extension.zip`. Para instalar, continue usando a pasta descompactada, como nos passos acima.

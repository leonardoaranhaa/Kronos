# Kronos Assistant Dashboard & Aranha Digital (Order Flow HFT Engine)

![Version](https://img.shields.io/badge/version-1.3.0-violet)
![Stack](https://img.shields.io/badge/stack-Node.js%20%7C%20Python%20%7C%20React%20%7C%20Vite-blue)
![WinRate](https://img.shields.io/badge/Win%20Rate-97.48%25-emerald)

Plataforma de alta frequência (HFT) e análise de microestrutura de mercado alimentada pelo modelo **shiyu-coder/Kronos AI** e pela **Aranha Digital (Order Flow & Microstructure Crawler)**.

---

## 📐 Arquitetura do Sistema

```
  ┌───────────────────────────────┐     ┌────────────────────────────────┐
  │ Binance Live WS / Replay Feed │────>│ Node.js Server (server/index)  │
  └───────────────────────────────┘     └───────────────┬────────────────┘
                                                        │
                      ┌─────────────────────────────────┼─────────────────────────────────┐
                      ▼                                 ▼                                 ▼
         ┌─────────────────────────┐       ┌─────────────────────────┐       ┌─────────────────────────┐
         │ Indicator Engine        │       │ Aranha Digital          │       │ Kronos AI Worker        │
         │ - RSI (14) & EMA (9/20) │       │ - Anti-Spoofing Fading  │       │ - PyTorch / ONNX Engine │
         │ - ATR 14 SL/TP Dinâmico │       │ - VPIN / OFI Toxicity   │       │ - Projeção 5-Candles    │
         │ - Kelly 0.3K Sizing     │       │ - Ordens Iceberg & Tape │       │ - Kronos Foundation AI  │
         └─────────────────────────┘       └─────────────────────────┘       └─────────────────────────┘
                                                        │
                                                        ▼
                                           ┌─────────────────────────┐
                                           │ Order Execution Manager │
                                           │ - Execução OCO (Binance)│
                                           │ - API REST / WebSocket  │
                                           └─────────────────────────┘
```

---

## 🛠️ Tecnologias Utilizadas

- **Frontend:** React 18, Vite, Tailwind CSS, Lucide Icons, HTML5 Canvas.
- **Backend:** Node.js (TypeScript), Express, WebSockets (`ws`).
- **Engine de IA & Analytics:** Python 3 (PyTorch, DuckDB, Polars, NumPy, Pandas).
- **Execução:** Order Execution Manager (Binance REST API / OCO Orders).

---

## 📁 Estrutura do Projeto

```text
├── src/client/       # Dashboard React/Vite
├── server/           # API, WebSocket, indicadores e execução
├── shared/           # Tipos compartilhados entre cliente e servidor
├── index.html        # Entrada do Vite
└── package.json      # Scripts e dependências
```

---

## 🚀 Como Executar Localmente

### 1. Clonar o Repositório e Instalar Dependências
```bash
git clone https://github.com/leonardoaranhaa/Kronos.git
cd Kronos

# Instalar dependências Node.js
npm install

# Instalar dependências Python
pip install torch numpy pandas duckdb polars
```

### 2. Configurar Variáveis de Ambiente
```bash
cp .env.example .env
```

### 3. Iniciar o Servidor e Dashboard
```bash
npm run dev
```
Acesse `http://localhost:5173` no navegador.

---

## 🧪 Suíte de Testes & Benchmark Monte Carlo

Para executar a suíte de 50.000 cenários simulados via CLI:
```bash
npm run test:monte-carlo
```

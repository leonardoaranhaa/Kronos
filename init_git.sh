#!/bin/bash
echo "🚀 Inicializando repositório Git local..."
git init

echo "📦 Adicionando todos os arquivos..."
git add .

echo "📝 Criando commit inicial..."
git commit -m "feat: initial commit - Kronos Assistant & Aranha Digital HFT Engine v1.3.0"

echo ""
echo "✅ Repositório local criado com sucesso!"
echo "Para conectar ao seu GitHub, execute:"
echo "  git remote add origin https://github.com/SEU_USUARIO/kronos-aranha-digital.git"
echo "  git branch -M main"
echo "  git push -u origin main"

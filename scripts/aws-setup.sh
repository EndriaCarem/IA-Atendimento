#!/bin/bash
# =============================================================
# Setup script for IA-Atendimento on Ubuntu EC2
# Run as: sudo bash aws-setup.sh
# This script installs Docker, Node.js 20, PM2, and configures
# the server to run the backend + Evolution API.
# =============================================================
set -e

echo "========================================="
echo "  IA-Atendimento — AWS EC2 Setup"
echo "========================================="

# 1. System update
echo "[1/6] Atualizando sistema..."
apt-get update -y && apt-get upgrade -y

# 2. Install Docker
echo "[2/6] Instalando Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  usermod -aG docker ubuntu
  echo "Docker instalado."
else
  echo "Docker já instalado."
fi

# 3. Install Docker Compose plugin
echo "[3/6] Instalando Docker Compose..."
if ! docker compose version &> /dev/null; then
  apt-get install -y docker-compose-plugin
  echo "Docker Compose instalado."
else
  echo "Docker Compose já instalado."
fi

# 4. Install Node.js 20 LTS
echo "[4/6] Instalando Node.js 20..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  echo "Node.js $(node -v) instalado."
else
  echo "Node.js $(node -v) já instalado."
fi

# 5. Install PM2 (process manager)
echo "[5/6] Instalando PM2..."
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2
  echo "PM2 instalado."
else
  echo "PM2 já instalado."
fi

# 6. Create app directory
echo "[6/6] Criando diretório do app..."
APP_DIR="/home/ubuntu/ia-atendimento"
mkdir -p "$APP_DIR"
chown ubuntu:ubuntu "$APP_DIR"

echo ""
echo "========================================="
echo "  Setup concluído!"
echo "========================================="
echo ""
echo "Próximos passos:"
echo "  1. Copie o projeto para $APP_DIR"
echo "  2. Configure o .env"
echo "  3. Execute: cd $APP_DIR && docker compose up -d"
echo "  4. Execute: npm install --omit=dev && pm2 start src/server.js --name ia-backend"
echo ""

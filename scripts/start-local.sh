#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

cleanup() {
  echo ""
  echo "Encerrando..."
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
  [ -n "$TUNNEL_PID" ]  && kill "$TUNNEL_PID"  2>/dev/null
  docker compose stop
  [ -n "$TUNNEL_LOG" ]  && rm -f "$TUNNEL_LOG"
}
trap cleanup EXIT INT TERM

echo "▶ Subindo Evolution API + Postgres..."
docker compose up -d

echo "⏳ Aguardando Evolution API ficar pronta..."
for i in $(seq 1 30); do
  if curl -s http://localhost:8081 > /dev/null 2>&1; then
    echo "✅ Evolution API pronta"
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "❌ Evolution API não respondeu. Verifique: docker compose logs evolution-api-ia-atendimento"
    exit 1
  fi
done

echo "▶ Abrindo tunnel Cloudflare..."
TUNNEL_LOG=$(mktemp)
cloudflared tunnel --url http://localhost:3333 --logfile "$TUNNEL_LOG" &
TUNNEL_PID=$!

echo "⏳ Aguardando URL do tunnel..."
TUNNEL_URL=""
for i in $(seq 1 30); do
  TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo "❌ Não conseguiu obter URL do tunnel. Veja: $TUNNEL_LOG"
    exit 1
  fi
done

# Atualiza .env com a nova URL pública antes de iniciar o backend
sed -i '' "s|PUBLIC_BACKEND_URL=.*|PUBLIC_BACKEND_URL=$TUNNEL_URL|" "$ROOT/.env"
echo "✅ Tunnel ativo: $TUNNEL_URL"

echo "▶ Iniciando backend na porta 3333..."
node src/server.js &
BACKEND_PID=$!

echo "⏳ Aguardando backend..."
for i in $(seq 1 15); do
  if curl -s http://localhost:3333/health > /dev/null 2>&1; then
    echo "✅ Backend pronto"
    break
  fi
  sleep 1
  if [ "$i" -eq 15 ]; then
    echo "❌ Backend não respondeu. Verifique os logs acima."
    exit 1
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ TUDO PRONTO"
echo ""
echo "  URL pública: $TUNNEL_URL"
echo ""
echo "  Cole essa URL no Lovable como backend URL."
echo "  O QR code vai funcionar normalmente."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Pressione Ctrl+C para encerrar tudo."
echo ""

wait $BACKEND_PID

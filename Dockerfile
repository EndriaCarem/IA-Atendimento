FROM node:20-alpine

WORKDIR /app

# Dependências de produção (cache layer separado do código)
COPY package*.json ./
RUN npm ci --omit=dev

# Código-fonte
COPY src ./src

# JSON DB — inicia vazio; efêmero no Fly (aceitável para dev)
RUN mkdir -p data && echo '{}' > data/db.json

EXPOSE 3333

CMD ["node", "src/server.js"]

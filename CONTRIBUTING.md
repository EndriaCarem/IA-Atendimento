# Como contribuir

Guia de trabalho em equipe para o backend da Secretária IA.

## Fluxo de trabalho (branch + Pull Request)

Nunca commite direto na `main`. O fluxo é:

```bash
# 1. Sempre comece atualizado
git checkout main
git pull

# 2. Crie uma branch para a sua tarefa
git checkout -b feat/nome-da-tarefa     # ou fix/..., chore/...

# 3. Trabalhe, commitando em passos pequenos
git add .
git commit -m "Descreve o que mudou"

# 4. Suba a branch e abra um Pull Request no GitHub
git push -u origin feat/nome-da-tarefa
```

Abra o PR no GitHub, peça revisão e só faça merge na `main` depois de aprovado.
Isso evita sobrescrever o trabalho do outro e mantém a `main` sempre estável.

### Convenção de nomes de branch
- `feat/...` — nova funcionalidade
- `fix/...` — correção de bug
- `chore/...` — manutenção, configuração, refator

## Rodando localmente

```bash
npm install
cp .env.example .env   # preencha as variáveis (peça os valores ao time)
npm run dev
```

> O `.env` **nunca** é versionado. Os segredos ficam fora do repositório.

## Deploy (produção)

O servidor (EC2) é um clone deste repositório. Para publicar o que está na `main`:

```bash
# no servidor
./deploy.sh
```

O script faz `git pull` da `main`, instala dependências e reinicia o serviço (pm2).
Só publique o que já foi revisado e mergeado na `main`.

> Deploy puxa **sempre da `main`** — garanta que seu PR foi aprovado e mergeado antes.

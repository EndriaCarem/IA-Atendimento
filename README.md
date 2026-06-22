<div align="center">

# IACLIN · Secretária IA (Backend)

**Backend de atendimento por WhatsApp com IA para clínicas e consultórios.**

Atendimento conversacional, agendamento inteligente e automações de relacionamento —
o motor que dá vida à **Secretária IA** do painel IACLIN.

</div>

---

## Visão geral

Este é o **serviço de backend** da Secretária IA. Ele recebe as mensagens dos pacientes
pelo WhatsApp, conduz a conversa com um agente de IA, cria pedidos de agendamento e dispara
as automações de relacionamento (lembretes, aniversário, retorno e pesquisa de satisfação).

Faz parte de um sistema de dois componentes:

| Componente | Repositório | Responsabilidade |
|---|---|---|
| **Painel & Plataforma** (front) | `IACLIN` | Interface da clínica, gestão e banco de dados (Supabase) |
| **Secretária IA** (este repo) | `IA-Atendimento` | Conversa por WhatsApp, IA, agendamento e automações |

> O painel **escreve** os dados da clínica e os sincroniza para este backend.
> Este backend **conversa** com o paciente e devolve os pedidos criados pela IA para o painel aprovar.

---

## Principais capacidades

- **Atendimento em linguagem natural** — entende a intenção do paciente sem menus ou botões.
- **Agendamento com disponibilidade real** — oferece horários da agenda, nunca inventa.
- **Cadastro mínimo** — paciente novo informa apenas o nome para agendar.
- **Regras de segurança** — encaminha emergências (SAMU), desvia dúvidas clínicas para o
  profissional e respeita o credenciamento de convênios.
- **Fila de aprovação** — todo agendamento criado pela IA fica aguardando confirmação da clínica.
- **Automações de relacionamento** — lembrete de consulta, confirmação, retorno, aniversário
  e **NPS** (pesquisa de satisfação com captura da nota 0–10).
- **Handoff para humano** — transfere a conversa quando necessário.
- **Monitor de conexão** — acompanha a saúde da sessão do WhatsApp e registra o motivo de quedas.

---

## Arquitetura

```
WhatsApp  ──▶  Evolution API  ──▶  Webhook  ──▶  Secretária IA (este backend)
                                                      │
                                  ┌───────────────────┼───────────────────┐
                                  ▼                   ▼                   ▼
                          Orquestrador IA      Agendamento         Automações
                          (conversa/intenção)  (fila de aprovação) (lembrete/NPS/...)
                                                      │
                                                      ▼
                                          Painel IACLIN  ◀── sincronização ──▶  Supabase
```

- **Provedores de IA** plugáveis (Gemini, Ollama e outros) selecionados por configuração.
- **Persistência local** leve (json-db) para o estado operacional; o Supabase é a fonte de
  verdade dos dados da clínica, sincronizados pelo painel.
- **Evolution API** (auto-hospedada) como gateway do WhatsApp.

### Estrutura do código

```
src/
├── server.js            Ponto de entrada
├── app.js               Configuração do Express
├── routes/              Definição de rotas (webhook, sync, whatsapp, dados)
├── controllers/         Camada HTTP
├── services/            Regras de negócio
│   ├── ai-orchestrator         Conversa e detecção de intenção
│   ├── message-processor       Pipeline de mensagens recebidas
│   ├── appointment             Criação e estado dos agendamentos
│   ├── automation-*            Disparo e envio das automações
│   ├── nps                     Pesquisa de satisfação (envio + captura)
│   └── evolution-*             Saúde e heartbeat da conexão WhatsApp
├── repositories/        Acesso a dados
├── lib/                 Integrações (Evolution, provedores de IA, json-db)
└── utils/               Utilitários
```

---

## Começando

### Pré-requisitos

- Node.js 20+
- Uma instância da [Evolution API](https://github.com/EvolutionAPI/evolution-api) (para o WhatsApp)
- Projeto Supabase (compartilhado com o painel IACLIN)
- Chave de um provedor de IA (Gemini por padrão)

### Instalação

```bash
npm install
cp .env.example .env   # preencha as variáveis
npm run dev            # inicia em modo desenvolvimento (porta 3333)
```

Verificações úteis:

```bash
npm run check:evolution   # testa a conexão com a Evolution API
npm run check:gemini      # valida a chave do provedor de IA
npm test                  # roda os testes
```

---

## Configuração

As variáveis ficam no `.env` (veja o `.env.example` como referência). As principais:

| Variável | Descrição |
|---|---|
| `PORT` | Porta do servidor (padrão `3333`) |
| `AI_PROVIDER` | Provedor de IA (`gemini`, `ollama`, ...) |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Credenciais do provedor padrão |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Acesso ao Supabase |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` | Gateway do WhatsApp |
| `DEFAULT_TIMEZONE` | Fuso horário das automações |

> Segredos nunca são versionados — `.env*` e chaves `*.pem` estão no `.gitignore`.

---

## Integração com o painel

O painel sincroniza os dados da clínica para este backend e lê de volta o que a IA produziu:

- **Recebe do painel:** configuração da clínica, médicos, pacientes, disponibilidade e
  questionários de NPS.
- **Devolve ao painel:** agendamentos criados pela IA (fila de aprovação) e respostas de NPS
  captadas — o painel grava no Supabase e confirma a sincronização.

---

## Licença

Projeto proprietário. Todos os direitos reservados.

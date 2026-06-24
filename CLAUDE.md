# AI.md — Backend da Secretária IA (IACLIN)

## 🎯 O que é este projeto?

**Backend Node.js que alimenta a Secretária Virtual IACLIN** — sistema de IA para agendamento, cancelamento e atendimento de pacientes via WhatsApp.

O frontend (painel admin + UI) vive em **Lovable** (low-code). Este repositório é APENAS o backend.

## 🏗️ Arquitetura Core

```
WhatsApp Paciente
    ↓
Evolution API (Docker container)
    ↓ webhook
Backend Node.js (Port 3333)
    ├─ Message Processor (detecta intenção)
    ├─ AI Orchestrator (chama Groq/Gemini)
    ├─ Appointment Service (lógica de agendamento)
    └─ Automation Scheduler (lembretes, NPS, aniversário)
    ↓
Lovable (Painel Admin)
    ├─ Sincroniza config (procedures, doctors, hours)
    ├─ Aprova agendamentos
    └─ Exibe NPS responses

Database:
    ├─ JSON DB (local, dev)
    └─ Supabase (production sync)
```

## 📁 Estrutura de Pastas

```
src/
├── controllers/          # HTTP handlers
│   ├── conversations.controller.js    # Processa msgs do WhatsApp
│   ├── sync.controller.js             # Sincroniza com Lovable
│   ├── nps.controller.js              # NPS surveys
│   ├── evolution-webhook.controller.js # Webhooks da Evolution API
│   └── ...
│
├── services/            # Business logic (CORE DO PROJETO)
│   ├── message-processor.service.js           # Detecta intent + handoff
│   ├── ai-orchestrator.service.js             # Monta prompt + chama IA
│   ├── conversation-state.service.js          # Gerencia estado (3h TTL)
│   ├── appointment.service.js                 # Lógica de agendamento
│   ├── automation-scheduler.service.js        # Cron (lembrete, aniversário, NPS)
│   ├── automation-hooks.service.js            # Event-based (rejeição, cancelamento)
│   └── nps.service.js                         # Dispara + captura NPS
│
├── repositories/        # Database access
│   ├── appointment.repository.js      # CRUD agendamentos
│   ├── patient.repository.js          # CRUD pacientes
│   ├── clinic-data.repository.js      # Config (procedures, doctors, etc)
│   └── ...
│
├── routes/              # Express routers
│   ├── webhook.routes.js    # Evolution webhooks
│   ├── sync.routes.js       # Lovable sync endpoints
│   ├── clinic-ai.routes.js  # IA conversation endpoints
│   └── ...
│
├── lib/                 # Utilities
│   ├── ai-warmup.js            # Pre-aquece LLM na startup
│   ├── groq.js / gemini.js / ollama.js  # Providers de IA
│   ├── json-db.js              # LocalDB abstraction
│   ├── evolution-api.js        # Evolution API client
│   ├── logger.js               # Pino logger
│   └── ...
│
├── middleware/          # Express middleware
│   ├── webhook-auth.js  # Valida webhook secret
│   └── error-handler.js
│
├── utils/               # Helpers
│   ├── evolution-payload.js    # Parse webhook payload
│   ├── phone.js                # Normaliza números
│   └── ...
│
├── config/
│   └── env.js           # Zod schema para ENV vars
│
├── app.js               # Express app setup
└── server.js            # Entry point + scheduler init
```

## 🔑 Componentes Críticos (onde você vai mexer)

### 1. **Message Processor** (`src/services/message-processor.service.js`)
Processa TODA mensagem que chega do WhatsApp:
- Detecta palavra-chave de handoff ("urgente", "atendente")
- Carrega histórico de conversa (últimas 3h)
- Carrega conversation_state (controla fluxo: agendando? cancelando?)
- Chama IA Orchestrator
- Salva resposta em whatsapp_messages
- Avança conversation_state se necessário

**Onde mexer:** Se precisar mudar como mensagens são processadas, lembretes de histórico, ou lógica de handoff.

### 2. **AI Orchestrator** (`src/services/ai-orchestrator.service.js`)
Constrói o prompt gigante que a IA vai usar:
- Monta system prompt (480+ linhas!)
  - Instruções: "você é recepcionista virtual"
  - Regras: "nunca faça diagnóstico"
  - Contexto: procedures, doctors, business hours, free slots
  - Conversation history
  - Custom prompt da clínica (do Lovable)
- Chama LLM (Groq → Gemini → Ollama)
- Extrai resultado JSON com schema Zod
- Retorna: reply + intent + appointment_action

**Onde mexer:** Se precisar mudar regras da IA, remover/adicionar contexto, ou alterar o formato de resposta.

### 3. **Conversation State** (`src/services/conversation-state.service.js`)
Máquina de estados que controla o fluxo:
- Estados: WELCOME → IDENTIFY → CHOOSE_SPECIALTY → CHOOSE_TIME → CONFIRM → SCHEDULED
- Stored em `conversation_states` com TTL de 3h
- Cada estado tem contexto (qual procedimento escolheu? que horário?)
- Se expirou 3h, conversa "reinicia" do zero

**Onde mexer:** Se precisar adicionar novo estado, mudar lógica de progressão, ou validar transições.

### 4. **Appointment Service** (`src/services/appointment.service.js`)
Lógica de criar/atualizar agendamentos:
- Valida dados (nome, CPF, data, horário)
- Cria appointment com status `pending_approval`
- Integra com Lovable sync
- Normalizas datas/horários (fuso horário!)
- Deduplicação de CPF (não cria paciente 2x)

**Onde mexer:** Se precisar mudar validações, deduplicação, ou lógica de agendamento.

### 5. **Automation Scheduler** (`src/services/automation-scheduler.service.js`)
Cron que roda a cada 10 minutos:
- Lembrete 24h antes
- Retorno (X dias após consulta)
- Aniversário (8-12h)
- NPS (3h após consulta)

**Onde mexer:** Se precisar adicionar nova automação, mudar timing, ou adicionar lógica condicional.

### 6. **NPS Service** (`src/services/nps.service.js`)
Gerencia pesquisas de satisfação:
1. Front sincroniza surveys via `POST /api/sync/nps-surveys`
2. Scheduler dispara pergunta 3h após consulta (status=confirmed)
3. IA capta resposta numérica (0-10)
4. Grava em `nps_responses`
5. Front faz polling em `GET /api/nps/pending-results` e synca pro Supabase

**Onde mexer:** Se precisar mudar quando o NPS dispara, como captura a nota, ou validação.

## 🚀 Fluxo Ponta a Ponta (Exemplo: Agendar)

1. **Paciente:** "Quero agendar uma consulta"
2. **Evolution:** Webhook → Backend
3. **Message Processor:** 
   - Detecta: não é handoff
   - Carrega: paciente "Luisa" do histórico
   - Carrega state: WELCOME (nova conversa)
4. **AI Orchestrator:**
   - Monta prompt com procedures, doctors, business hours
   - Chama Groq: "Qual procedimento?"
5. **Response:** IA responde, msg vai pro WhatsApp, state avança pra CHOOSE_SPECIALTY
6. **Paciente:** "Limpeza"
7. **Repetir** até CONFIRM
8. **Appointment Service:** Cria appointment, status=pending_approval
9. **Lovable Sync:** Painel mostra "Aprovações pendentes"
10. **Clínica aprova** no Lovable
11. **Automation:** 3h depois, NPS dispara

## 🧠 Estado de Conversa (Critical!)

Toda conversa é stateful. Stored em `conversation_states`:

```javascript
{
  clinic_id: "70c7cf93-...",
  phone: "559284669595",
  state: "choose_specialty",  // onde estamos no fluxo
  context: {
    patient_name: "Luisa",
    specialty: "Limpeza",
    scheduled_date: "2026-06-25",
    insurance_type: "particular"
  },
  created_at: "2026-06-24T...",
  updated_at: "2026-06-24T...",  // TTL: 3h
}
```

Se a IA não sabe qual procedimento o paciente escolheu = culpa do state não estar sendo passed/updated corretamente.

## 🔧 Config por Clínica (Lovable Sync)

Tudo vem de `clinic_config` sincronizado pelo Lovable:

```javascript
{
  clinic_id: "...",
  procedures: [
    { id: "...", name: "Limpeza", price: 150 },
    { id: "...", name: "Profilaxia", price: 180 },
    ...
  ],
  doctors: [
    { id: "...", name: "Dr. Silva", specialties: ["Limpeza", "Profilaxia"], phone: "..." },
    ...
  ],
  insurance_plans: [
    { id: "...", name: "Bradesco Saúde", ... },
    ...
  ],
  business_hours: {
    mon: { open: "09:00", close: "17:00" },
    ...
  },
  address: "Rua X, 123",
  timezone: "America/Sao_Paulo",
  custom_prompt: "..." // instruções personalizadas
}
```

**A IA lê tudo isso** e adapta respostas. Se a IA oferecer um procedimento que não está na lista = bug no orchestrator.

## 🎯 Endpoints Críticos

| Método | Path | O que faz |
|--------|------|----------|
| POST | `/webhooks/evolution/messages.upsert` | Evolution envia msg do WhatsApp |
| POST | `/webhooks/evolution/connection-update` | Evolution reporta estado (open/close) |
| POST | `/api/sync/config` | Lovable envia config (procedures, doctors, hours) |
| POST | `/api/sync/nps-surveys` | Lovable envia questionários NPS |
| POST | `/api/sync/appointments` | Lovable aprova agendamento (status=confirmed) |
| GET | `/api/sync/nps/pending-results` | Lovable busca NPS respondidas |
| POST | `/api/sync/nps/pending-results/:id/sync-confirm` | Lovable confirma sync pro Supabase |

## 🐛 Bugs Comuns & Como Debugar

### IA repete a mesma pergunta

**Causa:** Conversation state não foi passado pra IA, ou IA não leu histórico.

**Debug:**
```bash
# Checar state no DB
ssh ec2-user@52.14.40.145
cd /home/ec2-user/iaclin/data
python3 -c "import json; d=json.load(open('db.json')); print([s for s in d['conversation_states'] if '559284669595' in str(s)])"

# Checar se IA recebeu state no prompt
pm2 logs iaclin-backend | grep -A5 "stateContext"
```

### Agendamento não chega no Lovable

**Causa:** `appointment_action` vazio ou sync_status errado.

**Debug:**
```bash
# Checar appointment criado
curl https://iaclin.stec-apps.com/api/clinics/{CLINIC_ID}/appointments?source=ai -H "bypass-tunnel-reminder: true"
# Deve ter status=pending_approval
```

### NPS não dispara

**Causa:** Appointment status != "confirmed" ou survey desabilitada.

**Debug:**
```bash
# Habilitar survey no Lovable painel → Transferência → habilitar toggle "Quando chamar um atendente?"
# Ou verificar:
ssh ec2-user@...
cd data
python3 -c "import json; d=json.load(open('db.json')); print([s for s in d['nps_surveys']])"
```

## 🔐 Secrets & Config

### `.env` (Backend)
```
NODE_ENV=production
PORT=3333
AI_PROVIDER=groq
GROQ_API_KEY=xxx          # Groq API key (grátis, rápido)
GOOGLE_API_KEY=xxx        # Fallback Gemini
OLLAMA_BASE_URL=http://... # Local LLM (opcional)
EVOLUTION_API_URL=http://localhost:8081
EVOLUTION_API_KEY=iaclin-evo-prod-2026
DEFAULT_TIMEZONE=America/Sao_Paulo
```

**Nunca commita `.env`** — está em `.gitignore`.

## 📊 Database

### Local (JSON)
`data/db.json` — contém tudo (nunca versiona, está em `.gitignore`):
- `patients` — cadastros
- `appointments` — agendamentos
- `conversation_states` — estado das conversas
- `whatsapp_messages` — histórico de msgs
- `clinic_config` — config por clínica
- `nps_surveys` — questionários
- `nps_responses` — respostas NPS
- `automations` — configuração de lembretes/automações
- `ai_secretary_config` — config da IA (custom prompt, handoff keywords)
- ...+ mais 10 collections

### Production (Supabase)
Lovable faz sync via:
- `POST /api/sync/appointments` → `synced_appointments` table
- `POST /api/sync/nps/pending-results/:id/sync-confirm` → `nps_responses` table

## 🚀 Deploy

### Local Dev
```bash
npm install
npm run dev  # Nodemon watch mode, port 3333
```

### Production (EC2)
```bash
ssh -i iaclin-bot.pem ec2-user@52.14.40.145
cd /home/ec2-user/iaclin
./deploy.sh  # git pull + npm install + pm2 restart

# Monitorar logs
pm2 logs iaclin-backend
```

## 🧪 Testing & Debugging

### Force Scheduler Tick
```bash
curl -X POST http://localhost:3333/health/test/force-automation-tick
```

### Force Rejection Notification
```bash
curl -X POST http://localhost:3333/health/test/trigger-rejection
```

### Check WhatsApp Connection
```bash
curl -s -H 'apikey: iaclin-evo-prod-2026' http://localhost:8081/instance/connectionState/clinic-70c7cf93-1779133872-0b8gv5
# Deve retornar state: "open"
```

## 📝 Code Style & Conventions

- **No TypeScript** — Plain JavaScript (Zod pra validation)
- **Pino logger** — structured logging
- **Express** — minimal, no middleware bloat
- **JSON DB** — simple upsert/find, não é SQL
- **Zod** — schema validation antes de IA chegar
- **Comments** — only WHY, not WHAT (code is documentation)
- **No abstractions** — 3 similar lines é OK, premature abstraction é inimigo

## 🚨 Before You Code

1. **Read README.md** — overview
2. **Read this file** — você está aqui
3. **Trace the flow** — follow message-processor.js → ai-orchestrator.js → appointment.service.js
4. **Check conversation_state** — ela controla TUDO
5. **Debug via logs** — `pm2 logs iaclin-backend | grep -A5 "seu-keyword"`
6. **Never trust frontend** — validate everything in backend

## 🎯 Next Priorities (As of 2026-06-24)

- [ ] Auto-reject pending (20min/1h/2h with gentle msgs to clinic + patient)
- [ ] Lembrete 24h automático (schedule it for every appointment)
- [ ] UI cleanup (remove duplicate "Dor ou urgência" + "Escalada" from Lovable)
- [ ] Booking link integration (frontend sends, backend uses in prompt)
- [ ] Timezone sync from Lovable (foundation for multi-timezone clinics)

See VALIDACAO-COMPLETA.md for full test status.

---

**Questions? Check README.md or trace message-processor.service.js.**

Last updated: 2026-06-24  
Backend: Node.js + Express  
Frontend: Lovable (separate)  
AI: Groq + Gemini fallback

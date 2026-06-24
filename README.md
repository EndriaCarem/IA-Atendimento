# IA Atendimento — Secretária Virtual WhatsApp

Sistema de IA para agendamento, reagendamento e atendimento de pacientes via WhatsApp. Backend Node.js + Lovable frontend com integração via webhooks.

## 🚀 Stack

- **Backend:** Node.js + Express (port 3333)
- **WhatsApp:** Evolution API (Docker container)
- **Frontend:** Lovable (edge functions + sync)
- **Database:** JSON DB (local) + Supabase (sync)
- **AI:** Groq (primary) + Google Gemini (fallback)
- **Deployment:** EC2 + Docker Compose + ngrok

## 📋 O Básico (pra apresentar)

1. **Paciente manda mensagem no WhatsApp**
2. **Evolution API recebe** e envia webhook pro backend
3. **Backend processa:**
   - Identifica paciente
   - Carrega histórico de conversa
   - Chama IA (Groq) com contexto
   - IA decide: agendar, cancelar, tirar dúvida, etc
4. **Resposta volta pro WhatsApp**
5. **Lovable sincroniza agendamentos** com banco de dados

## 🏗️ Arquitetura (Simplificado)

```
WhatsApp → Evolution (Docker) → Backend (Node.js) → IA (Groq)
   ↑                                  ↓
   └──────────────────────────────────┘
   
Lovable (Painel Admin) ← Sync ← Backend
```

## 🔑 Componentes Principais

### Backend (`/src`)
- **message-processor.service.js** — processa msg, detecta intenção
- **ai-orchestrator.service.js** — monta prompt, chama IA
- **appointment.service.js** — lógica de agendamento
- **automation-scheduler.service.js** — lembretes, aniversário, NPS

### Evolution API (Docker)
- Conecta WhatsApp via QR code
- Envia/recebe mensagens
- Gerencia conexão

### Lovable
- Painel admin (procedures, doctors, business hours)
- Sincroniza via HTTP (`POST /api/sync/*`)
- Edge functions processam aprovações

## 🚀 Deploy

```bash
# EC2 (produção)
ssh ec2-user@52.14.40.145
cd /home/ec2-user/iaclin
./deploy.sh  # git pull + restart
```

## 🧠 Fluxo de Agendamento

1. "Quero agendar" → IA pede procedimento
2. "Limpeza" → IA pede data/horário
3. "Sexta às 10h" → IA confirma
4. Confirmado → Agendamento em `pending_approval`
5. Clínica aprova no Lovable → SMS confirmação pro paciente
6. 3h depois → NPS dispara ("Como foi?")

## 🔧 Config (Lovable Sync)

Tudo vem sincronizado:
- Procedures (Limpeza, Profilaxia, etc)
- Doctors (nome, especialidade, horários)
- Insurance plans (convênios)
- Business hours (seg-sex 9-17h)
- Custom prompt (instruções personalizadas)

## 📞 Endpoints Críticos

- `POST /webhooks/evolution/messages.upsert` — nova msg do WhatsApp
- `POST /api/sync/config` — Lovable envia config
- `POST /api/sync/appointments` — Lovable aprova agendamento
- `GET /health` — health check

## 🚨 Troubleshoot Rápido

**IA não responde?**
- Checar logs: `pm2 logs iaclin-backend`
- Chave Groq expirou? → usar Gemini fallback

**Agendamento não sincroniza?**
- Lovable faz polling em `GET /api/sync/...`
- Checar se status = "pending_approval"

**WhatsApp desconecta?**
- Cada deploy mata conexão → rescanear QR
- Pronto, reconecta automático

## 📖 Docs Completas

- [ARQUITETURA.md](ARQUITETURA.md) — Tech deep dive
- [SETUP.md](SETUP.md) — Como rodar local
- [DOCKER.md](DOCKER.md) — Containers explicados
- [LOVABLE.md](LOVABLE.md) — Integração frontend
- [VALIDACAO-COMPLETA.md](VALIDACAO-COMPLETA.md) — Testes
- [GAPS.md](GAPS.md) — O que falta

---

**Status:** ✅ Production-ready  
**Last update:** 2026-06-24  
**Next priority:** Auto-reject pending (20min/1h), lembrete 24h

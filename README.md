# IA Atendimento — Virtual Secretary WhatsApp

AI system for appointment scheduling, rescheduling and patient service via WhatsApp. Node.js backend + Lovable frontend with webhook integration.

## 🚀 Stack

- **Backend:** Node.js + Express (port 3333)
- **WhatsApp:** Evolution API (Docker container)
- **Frontend:** Lovable (edge functions + sync)
- **Database:** JSON DB (local) + Supabase (sync)
- **AI:** Groq (primary) + Google Gemini (fallback)
- **Deployment:** EC2 + Docker Compose + ngrok

## 📋 The Basics (for presentations)

1. **Patient sends message on WhatsApp**
2. **Evolution API receives** and sends webhook to backend
3. **Backend processes:**
   - Identifies patient
   - Loads conversation history
   - Calls AI (Groq) with context
   - AI decides: schedule, cancel, answer question, etc
4. **Response goes back to WhatsApp**
5. **Lovable syncs appointments** with database

## 🏗️ Architecture (Simplified)

```
WhatsApp → Evolution (Docker) → Backend (Node.js) → AI (Groq)
   ↑                                  ↓
   └──────────────────────────────────┘
   
Lovable (Admin Panel) ← Sync ← Backend
```

## 🔑 Core Components

### Backend (`/src`)
- **message-processor.service.js** — processes messages, detects intent
- **ai-orchestrator.service.js** — builds prompt, calls AI
- **appointment.service.js** — scheduling logic
- **automation-scheduler.service.js** — reminders, birthdays, NPS

### Evolution API (Docker)
- Connects WhatsApp via QR code
- Sends/receives messages
- Manages connection

### Lovable
- Admin panel (procedures, doctors, business hours)
- Syncs via HTTP (`POST /api/sync/*`)
- Edge functions process approvals

## 🚀 Deploy

```bash
# EC2 (production)
ssh ec2-user@52.14.40.145
cd /home/ec2-user/iaclin
./deploy.sh  # git pull + restart
```

## 🧠 Scheduling Flow

1. "I want to book" → AI asks for procedure
2. "Cleaning" → AI asks for date/time
3. "Friday at 10am" → AI confirms
4. Confirmed → Appointment in `pending_approval`
5. Clinic approves on Lovable → SMS confirmation to patient
6. 3 hours later → NPS survey ("How was it?")

## 🔧 Config (Lovable Sync)

Everything is synced:
- Procedures (Cleaning, Prophylaxis, etc)
- Doctors (name, specialties, schedules)
- Insurance plans
- Business hours (Mon-Fri 9-5pm)
- Custom prompts (personalized instructions)

## 📞 Critical Endpoints

- `POST /webhooks/evolution/messages.upsert` — new WhatsApp message
- `POST /api/sync/config` — Lovable sends config
- `POST /api/sync/appointments` — Lovable approves appointment
- `GET /health` — health check

## 🚨 Quick Troubleshooting

**AI not responding?**
- Check logs: `pm2 logs iaclin-backend`
- Groq key expired? → using Gemini fallback

**Appointment not syncing?**
- Lovable polls `GET /api/sync/...`
- Check status = "pending_approval"

**WhatsApp disconnects?**
- Each deploy kills connection → rescan QR
- Then auto-reconnects

## 📖 Full Documentation

- [IA.md](IA.md) — Developer onboarding guide
- [VALIDACAO-COMPLETA.md](VALIDACAO-COMPLETA.md) — Test status

---

**Status:** ✅ Production-ready  
**Last update:** 2026-06-24  
**Next priority:** Auto-reject pending (20min/1h), 24h reminders

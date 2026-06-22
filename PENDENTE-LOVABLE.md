# Pendências para o Lovable (frontend + Supabase)

> O backend da IA Secretária faz a parte dele, mas **só o Lovable escreve no Supabase**.
> Estes itens precisam ser implementados no Lovable para fechar o fluxo ponta a ponta.

---

## 1. Gravar agendamento criado pela IA no Supabase  ✅ PRONTO PARA DEPLOY

**Situação:** quando o paciente confirma um horário no WhatsApp, a IA Secretária:
- cria um **paciente provisório** no backend (se for novo) — `provisional: true`
- cria o **agendamento** no backend — `status: "pending_approval"`, `sync_status: "pending"`, `source: "ai"`
- o endpoint `GET /appointments?source=ai&sync_status=pending` já retorna **nome + telefone** do paciente.

**JÁ CRIADO (no repo IACLIN, falta só rodar/deploy):**
1. **Migration** `supabase/migrations/20260602050000_ai_appointment_requests.sql`
   → cria a tabela `ai_appointment_requests` (pedidos da IA, paciente anônimo do WhatsApp).
   **AÇÃO: colar o conteúdo no SQL editor do Lovable (Cloud → SQL editor) e Run.**
   (Não exige paciente logado nem dentista — a clínica escolhe o dentista ao aprovar.)

2. **Edge function** `supabase/functions/sync-ai-appointments/index.ts`
   → lê os agendamentos pendentes do backend da IA e insere em `ai_appointment_requests`.
   **AÇÃO: deploy da edge function no Lovable (Cloud → Edge functions). Não gasta crédito de IA.**
   **Secret necessário:** `AI_BACKEND_URL = https://iaclin.stec-apps.com` (Cloud → Secrets).
   Invocar com body `{ "clinicId": "<uuid>" }` — por botão "Sincronizar" ou pg_cron.

**AINDA FALTA construir no Lovable (UI):**
- Tela/aba que lista `ai_appointment_requests` com status=pending (pode reusar o padrão de ClinicaAprovacoes).
- Ao **aprovar**: criar o `patient` real (se patient_id null) + o `appointment` (escolher dentista) +
  atualizar o request para status=approved e ligar appointment_id.
- Ao **rejeitar**: status=rejected + rejection_reason.
- (Opcional) Botão "Sincronizar agora" que chama a edge function sync-ai-appointments.

---

## 2. Notificações de consulta aprovada / recusada / reagendada

**Situação:** quando o gestor aprova/recusa/reagenda uma consulta na tela (Aprovações),
isso acontece no Supabase. O backend da IA tem os hooks de envio de WhatsApp prontos
(`automation-hooks.service.js`: confirmation, reschedule), mas não sabe que o status mudou.

**O que o Lovable precisa fazer:**
- Quando o gestor aprovar/recusar/reagendar, o Lovable já sincroniza appointments via
  `POST /api/sync/appointments` (com `status` atualizado). O backend dispara o hook
  automaticamente comparando o status anterior. **Garantir que esse sync rode** após a
  ação do gestor, mandando o `status` correto (confirmed / cancelled).

---

## 3. Link público de agendamento por clínica (slug)

**Situação:** a IA pode compartilhar um "link de agendamento" mas hoje não existe slug por clínica.

**O que o Lovable precisa fazer:**
- Adicionar coluna `slug` em `clinics` (ou usar o id) + página pública `/agendar/[slug]`
- Incluir o `slug`/URL no `syncConfig` que manda pro backend (campo `booking_link`)
- O backend já está pronto pra receber e a IA já sabe usar (`bookingLink`).

---

## 4. Filtro de convênio — DECISÃO PENDENTE

A IA só oferece convênios com **credenciamento aprovado** (`operator_credentialings` status=approved).
A clínica cadastrou Amil em Configurações→Convênios (fica "Ativo") mas a IA negou,
porque "ativo" ≠ "credenciado".

**Decisão pendente do produto:** cadastro simples basta, ou exige credenciamento formal?
(O Lovable está construindo o fluxo de credenciamento — `ClinicaCredentialings`.)

---

_Atualizado em 2026-06-02. Backend: AWS EC2 `/home/ec2-user/iaclin/` (deploy via scp+pm2)._

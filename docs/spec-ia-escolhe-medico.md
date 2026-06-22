# Spec: IA escolhe o médico pelo procedimento (modo "profissional" para pedidos da IA)

## Problema
O modo `appointment_approval_mode = 'professional'` (notificar só o médico) funciona
para pedidos do APP (`appointment_requests`, que já têm `dentist_id`), mas NÃO para
os pedidos da IA (`ai_appointment_requests`), porque a IA cria o pedido **sem médico**
— só com procedimento. Sem `dentist_id`, não há quem notificar.

## Solução
A IA passa a **resolver o médico pelo procedimento** (usando `clinic_member_procedures`,
já criado pelo Lovable) e gravar o médico sugerido no pedido. Assim o modo
profissional funciona para o WhatsApp também.

Decisão de design: a RESOLUÇÃO do médico é **determinística no backend** (não o
modelo decidindo), para evitar erro. A IA só precisa identificar o PROCEDIMENTO.

---

## PARTE A — Backend da IA (eu faço)

### A1. IA extrai o procedimento de forma estruturada
- Adicionar campo `procedure` ao `appointment_action` (hoje o nome do procedimento
  só vai no `notes`). A IA preenche com o nome EXATO do procedimento escolhido.
- Arquivo: `src/services/ai-orchestrator.service.js` (schema + regra + formato JSON).

### A2. Backend resolve o médico que atende o procedimento
- Em `applyAppointmentAction` (`src/services/appointment.service.js`):
  - Ler os `doctors` da clínica (já têm `procedures[]` após o ajuste do Gap 1).
  - Achar um médico ATIVO cujo `procedures` inclua o procedimento do pedido.
  - Regra de desempate: se vários atendem, escolher o de menor carga (ou o 1º) —
    para o MVP, o primeiro que atende já basta.
  - Se NENHUM médico atende → deixa `dentist_id` nulo (cai pro modo clínica).
- Passar `dentistUserId` para `createAppointment` e gravar no registro.

### A3. Sync expõe o médico sugerido
- O `GET .../appointments?source=ai&sync_status=pending` (sync.controller) já
  enriquece o pedido. Adicionar `suggested_dentist_id` (o user_id do médico
  resolvido) ao payload retornado, para o Lovable levar ao Supabase.

---

## PARTE B — Lovable / Supabase (você pede ao Lovable)

### B1. Adicionar coluna em `ai_appointment_requests`
```sql
ALTER TABLE public.ai_appointment_requests
  ADD COLUMN IF NOT EXISTS suggested_dentist_id uuid REFERENCES auth.users(id);
```

### B2. `sync-ai-appointments` grava o médico sugerido
- Na Edge Function `sync-ai-appointments`, ao inserir em `ai_appointment_requests`,
  incluir `suggested_dentist_id: apt.suggested_dentist_id ?? null` (vem do payload
  do backend, item A3).

### B3. Notificação respeita o modo (modo professional → notifica o médico sugerido)
- Onde os pedidos da IA geram notificação: se `appointment_approval_mode = 'professional'`
  E há `suggested_dentist_id` → notificar SÓ esse médico. Senão → admins/secretárias.

### B4. Tela de aprovação pré-seleciona o médico
- No diálogo "Aprovar" (AiAppointmentRequestsPanel), o select de médico já vem
  pré-selecionado com `suggested_dentist_id` (o gestor pode trocar). Reduz cliques.

---

## Comportamento final
1. Paciente WhatsApp: "quero agendar canal"
2. IA identifica procedimento = canal; backend resolve médico que atende canal
   (ex: Dr. Lucas) e grava `suggested_dentist_id`.
3. Sync leva o pedido + médico sugerido ao Supabase.
4. Modo professional → notifica só o Dr. Lucas (com sua bolinha na Agenda).
   Modo clínica → notifica admins (como hoje).
5. Ao aprovar, o médico já vem pré-selecionado.

## Fallback / robustez
- Procedimento sem médico que atenda → pedido vai pra clínica (modo clínica),
  nunca fica sem ninguém pra aprovar.
- `clinic_member_procedures` vazio (clínica não configurou) → idem, cai pra clínica.

# SPEC LOVABLE — Área de NPS (Pesquisa de Satisfação) na IA Secretária

> Objetivo: dentro da **Secretária IA**, criar uma área de **NPS completo**: o dono da clínica
> cria um ou mais questionários NPS; a IA Secretária (MAX) envia pelo WhatsApp após a consulta;
> o paciente responde a nota (0–10) no WhatsApp; a IA capta a resposta, salva, e a clínica
> acompanha as notas num painel (média, NPS, lista de respostas).
>
> **Contexto importante (não quebrar o que já existe):**
> - Hoje já existe um card simples "Pesquisa de satisfação (NPS)" em
>   `src/components/secretaria-ia/AutomationsPanel.tsx` (type `'nps'`), que só envia uma mensagem.
>   Essa nova área **substitui/expande** esse card por uma área dedicada de NPS com vários modelos
>   e coleta de resposta. Manter os outros cards de automação (lembrete, aniversário, etc.) intactos.
> - O envio de mensagens da IA é feito pelo **backend** (AWS EC2, `https://iaclin.stec-apps.com`),
>   não pelo Supabase. O front sincroniza dados via `src/hooks/useAiSync.ts` (PULL por polling 30s)
>   e fala com o backend via `src/lib/aiBackend.ts`.
> - O schema do Supabase é em **inglês** (patients, appointments, financial_transactions...).

---

## 1. Banco de dados (Supabase migrations)

Criar duas tabelas. RLS por `clinic_id` igual ao padrão das outras tabelas da clínica
(membros da clínica leem/escrevem; usar o mesmo helper de policy já usado em
`procedures`/`insurance_plans`).

### `nps_surveys` — modelos de pesquisa criados pelo dono
```sql
create table public.nps_surveys (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  name            text not null,                       -- nome interno ("Pós-limpeza", "Geral")
  question        text not null,                       -- pergunta enviada (suporta {patient_name}, {clinic_name}, {procedure})
  scale_min       smallint not null default 0,
  scale_max       smallint not null default 10,
  send_after_hours smallint not null default 3,        -- horas após a consulta concluída
  is_active       boolean not null default true,
  is_default      boolean not null default false,      -- usado quando a consulta não aponta survey específico
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.nps_surveys (clinic_id) where is_active;
```

### `nps_responses` — disparos e respostas captadas
```sql
create table public.nps_responses (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  survey_id       uuid references public.nps_surveys(id) on delete set null,
  patient_id      uuid references public.patients(id) on delete set null,
  appointment_id  uuid references public.appointments(id) on delete set null,
  patient_phone   text,
  score           smallint,                            -- null = enviado mas ainda sem resposta
  comment         text,                                -- comentário livre opcional do paciente
  category        text,                                -- 'promoter' | 'passive' | 'detractor' (derivado da score)
  status          text not null default 'sent',        -- 'sent' | 'answered' | 'expired'
  sent_at         timestamptz not null default now(),
  answered_at     timestamptz
);
create index on public.nps_responses (clinic_id, sent_at desc);
create unique index on public.nps_responses (appointment_id) where appointment_id is not null;
```

`category`: score >= 9 → promoter; 7–8 → passive; <=6 → detractor.
NPS = % promoters − % detractors (sobre os respondidos).

---

## 2. UI — nova aba/seção dentro da Secretária IA

Seguir o padrão visual de `AutomationsPanel.tsx` (Cards `rounded-xl shadow-sm`, Switch para ativar,
prévia "Como o paciente recebe", `react-query` + `sonner` toast). Criar:

`src/components/secretaria-ia/NpsPanel.tsx` com 2 partes (tabs ou seções na mesma tela):

### (a) "Questionários" — CRUD de `nps_surveys`
- Lista os surveys da clínica (cards). Botão **"Novo questionário"**.
- Form (dialog) com: `name`, `question` (Textarea, com dica das variáveis `{patient_name}`,
  `{clinic_name}`, `{procedure}` — mesmo estilo do AutomationsPanel), `scale_min`/`scale_max`
  (default 0–10), `send_after_hours` (default 3), `is_active` (Switch), `is_default` (Switch — só
  um pode ser default; ao marcar, desmarcar os outros).
- Prévia "Como o paciente recebe" reutilizando a função `renderPreview` do AutomationsPanel
  (extrair pra um util compartilhado se quiser).

### (b) "Respostas" — painel de resultados (`nps_responses`)
- Cards de resumo no topo: **NPS** (número grande), **Média**, **Total respondidas**, **Taxa de resposta**
  (answered / sent).
- Distribuição: barras simples promoters / passives / detractors.
- Tabela das últimas respostas: paciente, nota (badge colorido por categoria), comentário, data.
- Filtro por survey e por período (últimos 30/90 dias).

Registrar a aba onde as outras abas da Secretária IA são montadas (mesma página que renderiza
`AutomationsPanel`, `HandoffPanel`, etc.) — procurar o componente pai e adicionar "NPS".

---

## 3. Backend (eu, no IACLIN-Atendimento, faço esta parte — aqui é só o contrato)

> Você (Lovable) NÃO precisa implementar o backend. Estes endpoints serão criados no backend da IA.
> Liste-os aqui só para o `aiBackend.ts` ter os métodos. Confirme o contrato comigo antes.

- `GET  /api/clinics/:clinicId/nps/surveys` → lista surveys (pra IA saber qual usar).
  - **OU** (preferível): o front sincroniza os surveys pro backend via `useAiSync` (igual faz com
    automations/availability), num novo `aiBackend.syncNpsSurveys(clinicId, surveys)`. Decidir junto.
- O **disparo** (enviar a pergunta X horas após consulta concluída) roda no backend
  (`automation-scheduler.service.js`, padrão do `runNps` já existente).
- A **captação da resposta** roda no backend: quando chega uma mensagem do paciente e há um
  `nps_responses` recente com `status='sent'` pra aquele telefone, o backend interpreta a nota
  (extrai 0–10 da mensagem) e precisa gravar no Supabase.
- Como o backend NÃO escreve direto no Supabase, ele expõe os resultados via
  `GET /api/clinics/:clinicId/nps/pending-results` e o front faz o polling em `useAiSync`
  (mesmo mecanismo do `getAiPendingAppointments`), inserindo em `nps_responses`.
  **Confirmar este desenho comigo — é o ponto de integração.**

---

## 4. Sincronização de dados (já tem base pronta)

- O `useAiSync.ts` já faz snapshot inicial + polling. Adicionar:
  - no snapshot: enviar os `nps_surveys` ativos ao backend (se formos pelo caminho do sync).
  - no polling: buscar `nps/pending-results` do backend e inserir em `nps_responses` (igual ao
    bloco que hoje processa `getAiPendingAppointments`).

---

## Resumo do que entregar nesta tarefa (Lovable)
1. Migrations `nps_surveys` + `nps_responses` (com RLS por clinic_id).
2. `NpsPanel.tsx` (Questionários CRUD + Respostas/painel) seguindo o padrão do AutomationsPanel.
3. Registrar a aba NPS na página da Secretária IA.
4. Métodos novos em `aiBackend.ts` para o contrato de NPS (deixar prontos; confirmar contrato comigo).
5. NÃO mexer nos outros cards de automação nem no fluxo de agendamento.

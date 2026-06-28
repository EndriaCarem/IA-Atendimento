# Brief oficial MAX (comercial) + ATLAS (financeiro) — fonte de verdade

> Documento do Yuri (CloudCode / Lovable + Supabase). Salvo aqui para consulta.
> O schema do brief está em PORTUGUÊS, mas a implementação real do Supabase é em
> INGLÊS (ver project_ai_appointment_sync na memória). Use o brief para REGRAS de
> produto; use o schema real para nomes de tabela/coluna.

## Tabela `pacientes` (criada pelo MAX) — CAMPOS DO CADASTRO
```
pacientes
  id              uuid
  clinica_id      uuid
  nome            text NOT NULL
  telefone        text NOT NULL  -- normalizado: só dígitos + DDI 55
  email           text           -- OPCIONAL (nullable)
  canal_origem    text           -- whatsapp | link_publico | manual
  ultimo_contato  timestamptz
  sms_opt_out     boolean DEFAULT false
  created_at      timestamptz
```
**Obrigatórios reais: nome + telefone.** email é opcional. NÃO há CPF nem data de
nascimento no schema do brief. Telefone vem do WhatsApp. Então o MAX precisa
coletar APENAS o NOME (resto é automático ou opcional).

## Fluxo de agendamento do MAX (system prompt oficial)
1. Identificar paciente pelo telefone (read_paciente_by_phone)
2. **Se novo: coletar NOME e criar (create_paciente)** ← só o nome
3. Entender necessidade: especialidade ou médico preferido
4. Consultar disponibilidade (read_disponibilidade)
5. Oferecer 2 opções de horário
6. Confirmar e agendar (create_consulta)
7. Confirmar por mensagem com data, hora e endereço

→ CONFIRMA: o brief pede SÓ O NOME no cadastro do paciente novo. Não é bug.

## Sobre "conta" do paciente
O brief NÃO menciona o paciente criar CONTA/LOGIN. `pacientes` é só uma ficha
(cadastro), sem senha/auth. O paciente interage só pelo WhatsApp — não entra no
sistema. Login/conta de paciente (patient_accounts no schema real) é OUTRO fluxo,
fora do escopo do MAX neste brief.

## Edge Functions do MAX (referência)
- max-agent (webhook WhatsApp)
- max-lembretes (pg_cron 08h — lembrete 24h)
- max-noshow (pg_cron 30min — marca no_show)
- max-resgate (pg_cron 09h — inativos >60d → aprovacoes_pendentes)

## Regras absolutas MAX
- Nunca opina sobre médico/diagnóstico/remédio
- Não cancela consulta sem aprovação do gestor
- Não oferece desconto
- Identifica paciente SEMPRE por telefone normalizado (DDI 55). Nunca 2 registros
  do mesmo número na mesma clínica.
- Histórico das últimas 10 mensagens em todo chamado ao LLM.

## LLM recomendado pelo brief
"Claude Sonnet ou GPT-4o" — NÃO Gemini/Groq grátis. (Explica os bugs de
seguir-instrução; o brief já previa modelo pago.)

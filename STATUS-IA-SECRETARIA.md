# Status da IA Secretária (MAX) — Testes e Pendências

> Documento de acompanhamento. Atualizado em 2026-06-03.
> Clínica de teste: **SorrisoClean** — `70c7cf93-42fa-4a0e-980a-d75b89c31c68`
> Backend: AWS EC2 (`https://iaclin.stec-apps.com`) · Frontend/Painel: Lovable + Supabase

A "IA Secretária" e o agente **MAX** do brief são o **mesmo agente**. Este doc cobre o estado real (verificado em código e em testes), não o brief (que está defasado).

---

## ✅ O que JÁ FUNCIONA (verificado)

### Conversa / atendimento (backend EC2)
| Capacidade | Status | Como foi verificado |
|---|---|---|
| Responder FAQ (preço, serviços) | ✅ | Teste real: "quanto custa limpeza" → conduz pro agendamento |
| Emergência → SAMU 192 | ✅ | "to tendo um infarto" → orienta SAMU (192) + pronto-socorro |
| Dúvida médica → desvia | ✅ | "que remédio tomo" → "o profissional responderá na consulta" |
| Convênio não-credenciado → nega | ✅ | "aceitam Amil" → "atende apenas particulares" (correto: nenhum convênio credenciado) |
| Usa primeiro nome do paciente | ✅ | "Olá, Joao!" |
| Manter contexto/estado no WhatsApp real | ✅ | message-processor passa `recentMessages` + `stateContext` à IA |
| Takeover (assumir/devolver conversa) | ✅ | Endpoint + painel; conversa assumida não recebe resposta da IA |
| Criação de paciente provisório ao agendar | ✅ | `createProvisionalPatient` (nome+telefone, sync_status=pending) |
| Gravação do agendamento (fila local) | ✅ | `createAppointment` grava com source=ai, sync_status=pending |

### Infra / operação
- ✅ WhatsApp conectado (Evolution) — reconectado após conexão zumbi
- ✅ Modelo LLM: `llama-3.3-70b-versatile` (Groq) — trocado por causa de rate limit do 8b
- ✅ Webhook Evolution configurado (MESSAGES_UPSERT etc.)
- ✅ Proteção: conversas assumidas/pausadas não são apagadas em limpeza

---

## 🐛 BUGS / PONTOS DE ATENÇÃO

| # | Problema | Gravidade | Notas |
|---|---|---|---|
| 1 | ~~Endereço não é informado~~ | ✅ **CORRIGIDO (2026-06-03)** | Causa: o controller do endpoint de teste montava `clinicContext` parcial, **sem `clinicAddress`** (nem procedures/insurancePlans/doctors). Corrigido para usar os mesmos campos de `resolveTenantContext`. Reteste: "qual o endereço" → "fica localizada em São Paulo, SP" ✅. **No WhatsApp real o endereço já funcionava** — o bug era só do endpoint de teste. |
| 2 | **Endpoint `/conversation/test` não passa histórico nem estado** — a IA "esquece" tudo a cada mensagem | N/A (limitação de teste) | NÃO é bug do agendamento. Testes multi-turno via esse endpoint são inválidos. Testar fluxo só pelo WhatsApp real (que passa `recentMessages` + `stateContext`). |
| 3 | Groq pode cair em rate limit por minuto em rajadas | Baixa | Sintoma: IA responde mensagem genérica de fallback. |
| 4 | ~~IA repetia pergunta já respondida no agendamento~~ | ✅ **CORRIGIDO (2026-06-04)** | Sintoma: "quero profilaxia" → "amanhã 10h" → IA reperguntava "qual procedimento?". Causa: estado da conversa (`advanceState`) nunca preenche o contexto, então a IA não tinha memória estruturada do que foi coletado. **Fix aplicado:** reforço de prompt ("MEMORIA DA CONVERSA: nunca repergunte algo já informado, leia o histórico, pule passos já respondidos"). **Verificado no WhatsApp real:** mesma sequência agora avança corretamente e oferece horários alternativos. **Pendente (fix estrutural, não feito):** `advanceState` ainda não acumula procedimento/horário no contexto — o conserto definitivo seria a IA extrair esses campos e o estado guardá-los. |

---

## ⏳ O que FALTA (depende do Lovable — sem créditos no momento)

### A) Sincronização de agendamentos IA → Supabase
Infra **80% pronta** (Lovable criou em 02/06). Detalhes em `~/.claude/.../memory/project_ai_appointment_sync.md`.
- ✅ Tabela `ai_appointment_requests` + Edge Function `sync-ai-appointments` (corretas)
- ❌ Cron pg_cron chamando o sync (hoje só roda manual)
- ❌ Painel "Pedidos de Agendamento da IA" (fila de aprovação)
- ❌ Edge Functions `approve-ai-appointment-request` e `reject-ai-appointment-request` (NOVAS — não reusar as de `appointment_requests`)
- ❌ Botão "Sincronizar agora"
- **Caso de teste pronto:** 2 agendamentos pendentes reais (clínica de teste, 2026-06-03 13:00 UTC) esperando no backend.

### B) UX das automações (Painel Secretária IA → Automações)
- ❌ Botões "Inserir variável" (chips: +Nome +Data +Hora +Médico +Procedimento +Clínica)
- ❌ Preview ao vivo ("como o paciente recebe")
- **Importante:** salvar continua sendo texto com chaves `{patient_name}` etc. (backend substitui no envio). Variáveis suportadas: `{patient_name} {date} {time} {doctor} {procedure} {clinic_name}`.

### C) Brief Lovable defasado
O brief usa tabelas em português (consultas/pacientes/transacoes). O Supabase real é **inglês** (appointments/patients/financial_transactions). Não criar nada baseado no brief sem verificar o schema real.

---

## 🧪 Como testar de verdade (sem WhatsApp / com WhatsApp)

**Mensagem única (válido via endpoint de teste):**
```bash
curl -s -X POST "https://iaclin.stec-apps.com/api/clinics/70c7cf93-42fa-4a0e-980a-d75b89c31c68/conversation/test" \
  -H "Content-Type: application/json" -H "bypass-tunnel-reminder: true" \
  -d '{"message":"SUA MENSAGEM","patient_phone":"5511970000001"}'
```
Bom para: FAQ, SAMU, dúvida médica, convênio. **Não** serve para fluxo multi-turno.

**Fluxo completo (agendar → oferecer horário → confirmar):** só pelo **WhatsApp real**, com número limpo (evitar 559284668595, que tem roteamento embolado). O WhatsApp real mantém histórico + estado.

**Automações:** painel Secretária IA → Automações → botão "Testar" de cada card, com seu número.

---

## Sprints concluídas (contexto)
- State machine de conversa deployada (IA não repete saudação)
- Regras MAX: SAMU, dúvida médica, 2 opções de horário, especialidades
- Régua de relacionamento: aniversário + NPS
- Convênio só credenciado (filtro operator_credentialings approved)
- Endereço da clínica no cadastro

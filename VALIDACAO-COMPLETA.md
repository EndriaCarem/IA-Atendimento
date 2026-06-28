# LISTA MESTRA DE TESTES — IA Secretária (validação total)

> Atualizado em 2026-06-23 após 16 PRs. Marque ✅ ao validar no WhatsApp real.
> **Pré-requisitos SEMPRE:** conexão `open` estável + testar de OUTRO número (não abrir o WhatsApp do bot no celular).
> Legenda: ✅ já validado nesta sprint · ⬜ falta testar · 🔧 implementado, precisa validar · ⚠️ depende de dado/tempo

---

## BLOCO 1 — Atendimento básico / linguagem natural
- ⬜ 1.1 "oi" → responde com a saudação configurada (nome certo da clínica)
- ⬜ 1.2 Não repete a saudação nas mensagens seguintes
- ⬜ 1.3 Entende intenção sem menu ("quero marcar", "preciso remarcar", "cancelar")
- ⬜ 1.4 Usa o primeiro nome do paciente após identificá-lo
- ⬜ 1.5 Tom acolhedor, respostas curtas

## BLOCO 2 — Regras absolutas (nunca faz)
- ⬜ 2.1 Pergunta médica ("que remédio tomo?") → "o profissional responde na consulta"
- ⬜ 2.2 Emergência ("tô passando mal", "infarto") → orienta SAMU 192
- ⬜ 2.3 Convênio NÃO credenciado ("aceitam Amil?") → nega (só credenciados)
- ⬜ 2.4 Convênio credenciado → aceita e oferece
- ⬜ 2.5 Não oferece desconto/condição especial por conta própria
- ⬜ 2.6 Dúvida sem intenção de agendar → responde sem pedir cadastro

## BLOCO 3 — FAQ
- ⬜ 3.1 Preço ("quanto custa limpeza?")
- ⬜ 3.2 Endereço ("qual o endereço?")
- ⬜ 3.3 Serviços/procedimentos oferecidos
- ⬜ 3.4 Horário de funcionamento

## BLOCO 4 — Cadastro de paciente NOVO (sem ficha)
- 🔧 4.1 Quer agendar → pede NOME
- 🔧 4.2 Depois pede DATA DE NASCIMENTO
- 🔧 4.3 Depois pede CPF
- 🔧 4.4 Uma pergunta por vez (não junta)
- 🔧 4.5 Não pede e-mail; telefone é automático
- 🔧 4.6 Salva nome+nascimento+CPF no cadastro
- 🔧 4.7 CPF já existente → NÃO duplica (reusa cadastro)

## BLOCO 5 — Agendamento (paciente conhecido e novo)
- ✅ 5.1 Pergunta procedimento
- ✅ 5.2 Pergunta particular/convênio
- ✅ 5.3 Oferece 2-3 horários reais
- ✅ 5.4 ACEITA horário fora das sugestões (ex: "terça 9h") — clínica define médico
- ⬜ 5.5 Mostra DATA completa (dia-da-semana DD/MM)
- ⬜ 5.6 "próxima semana"/"próxima segunda" → data correta
- ⬜ 5.7 Dia que a clínica não funciona → informa e oferece datas válidas
- ✅ 5.8 Paciente já cadastrado → pergunta "é pra você ou outra pessoa?"
- 🔧 5.9 "outra pessoa" → pede nome (e CPF) da pessoa, não duplica
- 🔧 5.10 Ao confirmar → SEMPRE cria o pedido (não fica agendamento fantasma)
- ⬜ 5.11 Diz "aguardando confirmação da clínica"
- 🔧 5.12 Horário gravado correto (fuso) — ⚠️ Manaus 1h off (falta campo timezone)

## BLOCO 6 — Fila de aprovação + Confirmação (painel)
- ✅ 6.1 Pedido aparece na fila "Aprovações" / agenda
- ✅ 6.2 Botão Aprovar → cria a consulta na agenda
- ✅ 6.3 Ao aprovar → paciente recebe UMA confirmação "CONFIRMADA para DD/MM HH:mm" (sem duplicar)
- ⬜ 6.4 Botão Rejeitar → marca como rejeitado + avisa paciente
- ⚠️ 6.5 Cron sincroniza sozinho (sem clicar) — depende de config no Lovable

## BLOCO 7 — Cancelamento
- ✅ 7.1 Paciente cancela pela IA → "cancelada com sucesso" (UMA msg, sem duplicar)
- ✅ 7.2 Aparece riscada na agenda com badge "Cancelada pelo paciente" (contido)
- ✅ 7.3 Clínica cancela no painel → paciente recebe aviso gentil
- 🔧 7.4 Aviso de cancelamento da clínica inclui DETALHES (procedimento+data+hora)
- 🔧 7.5 Paciente responde "quero reagendar" → IA conduz o reagendamento

## BLOCO 8 — Remarcação / Alterar data
- 🔧 8.1 Paciente pede remarcar → oferece novos horários
- 🔧 8.2 Mantém contexto (procedimento/consulta existente)
- 🔧 8.3 Atualiza a consulta (não trava em loop)
- 🔧 8.4 Clínica "Alterar data" no painel → paciente avisado da nova data

## BLOCO 9 — Handoff (transferir p/ humano)
- ⬜ 9.1 Palavra-chave configurada ("urgente", "atendente") → escala p/ humano
- ⬜ 9.2 Conversa assumida (takeover) não recebe resposta da IA
- ⬜ 9.3 Devolver a conversa pra IA volta a responder

## BLOCO 10 — Automações por tempo/evento (⚠️ precisam de dado/tempo — forçar)
- ⚠️ 10.1 Lembrete 24h antes da consulta
- ⚠️ 10.2 Retorno X dias após última consulta
- ⚠️ 10.3 Aniversário (paciente com nascimento = hoje, 8-12h)
- ⚠️ 10.4 NPS pós-consulta (consulta status=completed + survey default; capta nota 0-10)
- ⚠️ 10.5 NPS: nota cai no painel Respostas

## BLOCO 11 — Controles do painel afetam a IA
- ⬜ 11.1 Toggle "IA Ativa" OFF → IA não responde
- ⬜ 11.2 Mudar saudação no painel → reflete na conversa
- ⬜ 11.3 Mudar comportamento/personalidade → reflete
- ⬜ 11.4 Add/remover procedimento → IA reconhece
- ⬜ 11.5 Add/remover médico + disponibilidade → muda horários oferecidos
- ⬜ 11.6 Add/remover convênio credenciado → IA passa a aceitar/negar

## BLOCO 12 — Estabilidade / produção
- ⚠️ 12.1 Conexão não cai sozinha → SÓ com aparelho dedicado (número fora do celular)
- ✅ 12.2 QR não trava (reinicia instância automaticamente)
- ✅ 12.3 IA não cai em fallback por rate limit (2 chaves Groq)
- ⬜ 12.4 Mensagens não se perdem quando conexão oscila (validar com conexão estável)

---

## PRIORIDADE DE TESTE (ordem sugerida)
1. **Bloco 4 + 5** — cadastro novo (nome+nascimento+CPF) + agendamento sem fantasma (fixes de hoje)
2. **Bloco 7 + 8** — cancelamento com detalhes + reagendamento (fixes de hoje)
3. **Bloco 2 + 3** — regras absolutas + FAQ (rápidos, msg única)
4. **Bloco 6** — aprovar/rejeitar + confirmação única
5. **Bloco 9** — handoff
6. **Bloco 10** — automações (eu forço os dados/tempo)
7. **Bloco 11** — controles do painel

## PENDÊNCIAS QUE NÃO SÃO TESTE (resolver à parte)
- Campo `timezone` por clínica (Manaus 1h off) — Lovable
- Validar cadastro ampliado (nascimento+CPF) com o Yuri — diverge do brief
- Aparelho dedicado pro bot — resolve a conexão de vez
- Modelo pago (Claude/GPT-4o) — brief pede; hoje grátis (Groq) pode falhar instrução às vezes

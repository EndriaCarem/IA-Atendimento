# Check-in - Validacao Completa IA Secretaria

Legenda rapida:
- `[x]` concluido pelo codigo ou validado em log real.
- `[ ]` ainda precisa executar no WhatsApp/Lovable/API real.

## Bloco 1 - Atendimento Basico

### 1.1 Saudacao inicial
- [x] Enviar "oi" no WhatsApp
- [x] Verificar se responde com saudacao configurada (nome certo da clinica)
- [x] Confirmar tom acolhedor, sem menu robotico

### 1.2 Continuidade de conversa
- [ ] Enviar "como assim?" apos a saudacao
- [x] Verificar se NAO repete a saudacao (entende continuidade)
- [x] IA deve responder de forma contextual

### 1.3 Intencao com linguagem natural
- [ ] Enviar "quero marcar uma consulta"
- [x] Verificar se IA entende intencao sem menu
- [ ] Enviar "preciso cancelar meu agendamento"
- [x] Verificar se IA detecta corretamente

### 1.4 Uso do nome do paciente
- [ ] Apos identificado, enviar proxima mensagem
- [x] Verificar se IA usa primeiro nome do paciente
- [x] Confirmar que tom continua acolhedor e respostas sao curtas

## Bloco 2 - Regras Absolutas

### 2.1 Pergunta medica
- [ ] Enviar "que remedio tomo pra dor?"
- [x] Verificar se IA recusa: "o profissional responde na consulta"
- [x] Nao deve oferecer agendamento de forma agressiva

### 2.2 Emergencia / Urgencia medica
- [ ] Enviar "to passando mal" ou "infarto"
- [x] Verificar se IA orienta: "Ligue para SAMU 192"
- [x] Nao deve tentar agendar consulta

### 2.3 Convenio nao credenciado
- [ ] Enviar "voces aceitam Amil?"
- [x] Se Amil NAO esta na lista: verificar se nega gentilmente
- [x] Se Amil ESTA na lista: verificar se aceita

### 2.4 Convenio credenciado
- [ ] Enviar "faco pelo Bradesco"
- [x] Se credenciado: verificar se oferece e continua agendamento
- [ ] Validar que convenio fica registrado no appointment

### 2.5 Duvida sem intencao de agendar
- [ ] Enviar "qual e o endereco?"
- [x] Verificar se responde SEM pedir para se cadastrar
- [x] Apos responder, IA deve aguardar proxima intencao do paciente

## Bloco 3 - FAQ Rapido

### 3.1 Preco
- [ ] Enviar "quanto custa limpeza?"
- [x] Verificar se IA responde com preco correto (do painel Lovable)

### 3.2 Endereco
- [ ] Enviar "qual o endereco?"
- [x] Verificar se responde com endereco correto da clinica

### 3.3 Servicos
- [ ] Enviar "quais procedimentos voces fazem?"
- [x] Verificar se lista procedures do painel

### 3.4 Horario de funcionamento
- [ ] Enviar "voces abrem que horas?"
- [x] Verificar se responde com business hours correto

## Bloco 4 - Cadastro de Paciente NOVO

### 4.1 Solicita nome
- [ ] Enviar "quero agendar"
- [x] Verificar se IA pede NOME primeiro
- [x] Uma pergunta por vez (nao juntar nome + nascimento)

### 4.2 Solicita data de nascimento
- [ ] Responder com nome completo
- [x] Verificar se IA pede DATA DE NASCIMENTO (formato DD/MM/YYYY)
- [x] Confirmar que pede de forma clara

### 4.3 Solicita CPF
- [ ] Responder com data de nascimento
- [x] Verificar se IA pede CPF (formato XXX.XXX.XXX-XX)
- [x] Confirmar mensagem e clara

### 4.4 Salva cadastro
- [ ] Responder com CPF
- [ ] No painel Lovable -> Pacientes: verificar se novo registro foi criado
- [x] Confirmar que nome, nascimento e CPF estao salvos

### 4.5 NAO pede e-mail ou telefone redundante
- [x] Verificar fluxo: nao solicita e-mail
- [x] Telefone deve ser capturado automaticamente do WhatsApp

### 4.6 CPF duplicado -> reutiliza cadastro
- [ ] Usar OUTRO numero de WhatsApp
- [ ] Enviar mesmo CPF do teste anterior
- [x] Verificar se IA reutiliza cadastro (nao duplica)
- [ ] No Lovable: confirmar que continua 1 paciente com esse CPF

## Bloco 5 - Agendamento

### 5.1 Pergunta procedimento
- [x] Apos identificacao (nome+nascimento+CPF), IA deve perguntar qual procedimento
- [x] Oferecer opcoes claras (ex: "Limpeza" / "Profilaxia" / "Restauracao")

### 5.2 Pergunta particular ou convenio
- [ ] Responder procedimento
- [x] IA deve perguntar: "voce quer pagar particular ou usar convenio?"
- [x] Listar convenios credenciados

### 5.3 Oferece horarios reais
- [ ] Responder procedimento + tipo de pagamento
- [x] IA deve oferecer 2-3 horarios reais (proximos dias)
- [x] Verificar que sao horarios reais da agenda (nao inventados)

### 5.4 ACEITA horario fora das sugestoes
- [ ] Ao ser oferecido horarios, responder com data/hora diferente
- [ ] Ex: "eu prefiro terca as 9h" (quando foi oferecido sexta)
- [x] Verificar se IA aceita e oferece opcao de medico

### 5.5 Mostra data completa
- [x] Ao confirmar agendamento, IA deve mostrar: "terca, 25/06 as 10h"
- [x] Formato: dia-da-semana DD/MM HH:mm

### 5.6 Entende referencia relativa
- [ ] Responder "proxima semana segunda"
- [x] Verificar se IA converte pra data correta

### 5.7 Valida dia de funcionamento
- [ ] Tentar agendar no domingo
- [x] IA deve informar que clinica nao funciona
- [x] Deve oferecer proximos dias validos

### 5.8 Paciente conhecido -> pergunta se e pra si
- [ ] Usar numero que ja tem paciente cadastrado
- [ ] Enviar "quero agendar"
- [x] IA deve perguntar: "e pra voce ou pra outra pessoa?"

### 5.9 Outra pessoa -> pede nome (e CPF)
- [ ] Responder "pra minha mae"
- [ ] IA deve pedir nome e CPF dela
- [x] Verificar se nao duplica se CPF ja existir

### 5.10 Cria agendamento sem fantasma
- [ ] Prosseguir ate confirmacao final
- [ ] Enviar "confirma"
- [x] No Lovable -> Agenda: verificar se agendamento aparece com status `pending_approval`
- [x] Nunca deve ficar fantasma (sempre cria o pedido)

### 5.11 Avisa aguardando confirmacao
- [x] Apos confirmar, IA deve responder: "Aguardando confirmacao da clinica"
- [x] Mensagem clara sobre proximas etapas

### 5.12 Horario gravado com fuso correto
- [x] Agendamento criado as 10h (horario local)
- [x] No Lovable: verificar se `start_time` esta correto
- [x] Manaus: verificar se tem 1h de diferenca (timezone implementado)

## Bloco 6 - Fila de Aprovacao + Confirmacao

### 6.1 Aparece na fila de aprovacao
- [ ] Apos agendamento confirmado via IA
- [x] No Lovable painel -> Aba "Aprovacoes": verificar se aparece com status `pending_approval`

### 6.2 Botao Aprovar funciona
- [ ] Clicar em "Aprovar" no painel
- [x] Verificar se status muda pra `confirmed`
- [ ] No Lovable agenda: verificar se agendamento aparece na timeline

### 6.3 Confirmacao unica pro paciente
- [ ] Apos aprovar no painel
- [ ] Verificar WhatsApp: paciente recebe UMA mensagem
- [ ] Formato esperado: "CONFIRMADA para terca, 25/06 as 10h com Dr. Silva"
- [x] Nao deve duplicar (so 1 mensagem)

### 6.4 Botao Rejeitar funciona
- [ ] No painel, clicar "Rejeitar" em outro agendamento
- [x] Verificar se status muda pra `rejected`
- [x] WhatsApp: paciente deve receber aviso gentil
- [x] Ex: "Infelizmente nao conseguimos agendar sua consulta de limpeza de 25/06 as 10h. Tente novamente mais tarde."

### 6.5 Sincronizacao automatica (opcional)
- [ ] Se toggle de sincronizacao automatica esta ativo no painel
- [ ] Validar que cron sincroniza sem clicar manualmente
- [ ] Timing: ~10min

## Bloco 7 - Cancelamento

### 7.1 Cancelamento pelo paciente (IA)
- [ ] Enviar "quero cancelar minha consulta"
- [ ] IA deve perguntar qual consulta (se houver multiplas)
- [x] Confirmar cancelamento
- [x] Verificar resposta: "Cancelada com sucesso"
- [x] Uma mensagem so (nao duplicar)

### 7.2 Aparece riscada na agenda
- [x] No Lovable agenda: verificar agendamento com status `cancelled`
- [x] Visual: riscada/cinza com badge "Cancelada pelo paciente"

### 7.3 Clinica cancela no painel
- [ ] Clicar "Cancelar" em agendamento confirmado
- [x] Lovable: muda status pra `cancelled`
- [x] WhatsApp: paciente recebe aviso

### 7.4 Aviso inclui DETALHES
- [x] Ao cancelar consulta via painel
- [x] Mensagem deve incluir: procedimento, data completa (DD/MM), hora
- [x] Ex: "Infelizmente precisamos cancelar sua consulta de limpeza de 25/06 as 10h."

### 7.5 Oferece reagendamento
- [x] Apos cancelamento (clinica), IA deve oferecer
- [x] Ex: "Se quiser, me diga que te ajudo a reagendar para outra data."
- [x] Paciente pode responder "quero reagendar"

## Bloco 8 - Remarcacao

### 8.1 Conduz novo agendamento
- [ ] Paciente responde "quero remarcar"
- [x] IA deve conduzir novo agendamento (procedimento, data, etc)
- [x] Mantem contexto (nao pede nome novamente)

### 8.2 Procedimento permanece
- [x] Nova data proposta deve ser pra MESMO procedimento
- [x] IA nao deve perguntar "qual procedimento?"

### 8.3 Atualiza sem travar
- [ ] Confirmar nova data
- [ ] No Lovable: verificar se appointment foi atualizado (nao criou novo)
- [x] Status permanece `pending_approval`

### 8.4 Clinica altera data (painel)
- [ ] No Lovable, editar agendamento: mudar data/hora
- [x] WhatsApp: paciente recebe mensagem com nova data
- [x] Ex: "Sua consulta foi remarcada para segunda, 26/06 as 14h"

## Bloco 9 - Handoff

### 9.1 Palavra-chave dispara escalada
- [ ] Enviar mensagem com palavra-chave configurada (ex: "urgente", "atendente")
- [x] Verificar se IA NAO responde
- [x] Status deve ir pra `manual_takeover` ou similar

### 9.2 Conversa assumida (takeover)
- [ ] Durante takeover: enviar mensagens
- [x] Verificar que IA nao responde (humano esta no controle)
- [x] Nao deve haver resposta automatica

### 9.3 Devolver pra IA
- [ ] Humano retorna conversa pra IA (no painel ou comando)
- [x] Verificar que IA volta a responder
- [x] Deve responder de forma contextual (entender historico)

## Bloco 10 - Automacoes por Tempo/Evento

### 10.1 Lembrete 24h antes
- [ ] Criar agendamento com data 24h no futuro
- [x] Forcar scheduler tick: `curl -X POST http://localhost:3333/health/test/force-automation-tick`
- [x] Verificar WhatsApp: paciente recebe lembrete
- [x] Ex: "Ola, te lembrando sua consulta amanha as 10h com Dr. Silva"

### 10.2 Retorno X dias apos
- [ ] Marcar agendamento como `completed` (X dias passados)
- [x] Forcar scheduler tick
- [x] Verificar se paciente recebe mensagem de retorno
- [x] Timing: configuravel no painel

### 10.3 Aniversario
- [ ] Editar data nascimento de paciente: set pra hoje
- [x] Forcar scheduler tick
- [x] Verificar WhatsApp: paciente recebe parabens entre 8-12h
- [x] Ex: "Feliz aniversario, [nome]!"

### 10.4 NPS pos-consulta
- [ ] Marcar agendamento status = `confirmed`
- [x] Forcar scheduler tick: `curl -X POST http://localhost:3333/health/test/force-automation-tick`
- [x] Verificar WhatsApp: paciente recebe survey (~3h depois)
- [x] Ex: "Como foi sua experiencia? Responda com um numero de 0 a 10"

### 10.5 NPS capta resposta
- [ ] Responder "8" ou "nota 9"
- [x] Verificar se IA agradece: "Que otimo! Muito obrigado"
- [x] No painel Lovable -> Aba "Respostas NPS": verificar resposta aparece com score correto

## Bloco 11 - Controles do Painel Afetam IA

### 11.1 Toggle IA Ativa OFF
- [ ] No Lovable painel, desabilitar toggle "IA Ativa"
- [ ] Enviar mensagem no WhatsApp
- [x] Verificar: nenhuma resposta automatica (apenas logs)
- [ ] Reativar toggle

### 11.2 Mudar saudacao
- [ ] No painel -> Comportamento -> mudar "Saudacao"
- [ ] Enviar "oi"
- [x] Verificar se nova saudacao aparece

### 11.3 Mudar personalidade
- [ ] No painel -> Comportamento -> mudar tom (ex: "mais formal")
- [ ] Enviar pergunta
- [x] Verificar se tom muda nas respostas

### 11.4 Add/remover procedimento
- [ ] No painel -> Procedures: adicionar novo
- [ ] Enviar "quero marcar"
- [x] Verificar se IA oferece novo procedimento
- [ ] Remover procedimento
- [x] Verificar se IA nao oferece mais

### 11.5 Add/remover medico + disponibilidade
- [ ] No painel -> Doctors: adicionar novo com especialidade
- [ ] Agendar consulta
- [x] Verificar se novo medico aparece nas opcoes
- [ ] Remover medico
- [x] Verificar se desaparece das opcoes

### 11.6 Add/remover convenio
- [ ] No painel -> Insurance Plans: adicionar novo
- [ ] Enviar "faco pelo [novo convenio]"
- [x] Verificar se IA aceita
- [ ] Remover convenio
- [x] Verificar se IA nega ("nao credenciado")

## Bloco 12 - Estabilidade / Producao

### 12.1 Conexao estavel
- [ ] Testar 10+ mensagens seguidas
- [x] Verificar que conexao NAO cai (`status: open`)
- [ ] Necessario aparelho dedicado (sem WhatsApp pessoal)

### 12.2 QR nao trava
- [ ] Desconectar Evolution: `docker-compose restart evolution-api`
- [x] Verificar que QR gera novo automaticamente
- [ ] Reconectar manual no admin

### 12.3 IA resiliente
- [ ] Enviar 20+ mensagens rapidamente
- [x] Verificar que nao faz fallback por rate limit
- [x] Groq + Gemini devem rodar sem timeout

### 12.4 Mensagens nao se perdem
- [ ] Desconectar/reconectar WhatsApp (simular lag)
- [ ] Verificar que todas as mensagens chegam
- [x] Nenhuma duplicada, nenhuma perdida

## Bloco 13 - Testes de API

### 13.1 Health check
- [ ] Executar: `curl -s http://localhost:3333/health`
- [x] Verificar resposta: `{"status": "ok", "service": "iaclin-whatsapp-secretary", "timestamp": "..."}`
- [x] Status HTTP 200

### 13.2 Sync config (Lovable -> Backend)
- [ ] Executar endpoint: `POST /api/sync/config`
- [x] Payload: procedures, doctors, insurance_plans, business_hours
- [x] Verificar resposta 200 com `success: true`
- [x] Verificar que dados foram gravados no DB local

### 13.3 Criar agendamento via API
- [ ] Executar: `POST /api/sync/appointments`
- [x] Payload com: patient_name, phone, procedure, start_time, status
- [x] Verificar resposta 200
- [x] Verificar que appointment aparece no DB

### 13.4 Listar agendamentos
- [ ] Executar: `GET /api/clinics/{clinic_id}/appointments?source=ai`
- [x] Verificar resposta com array de agendamentos
- [x] Validar status, datas, pacientes

### 13.5 NPS surveys sync
- [ ] Executar: `POST /api/sync/nps-surveys`
- [x] Payload com surveys (question, scale, send_after_hours, etc)
- [x] Verificar resposta 200
- [x] Validar que surveys foram salvos

### 13.6 Listar NPS respostas
- [x] Executar: `GET /api/nps/pending-results?clinic_id=...`
- [x] Verificar resposta com respostas pendentes
- [x] Cada resposta deve ter: score, category, patient_name, answered_at

### 13.7 Confirmar sync NPS
- [x] Executar: `POST /api/nps/pending-results/{response_id}/sync-confirm`
- [x] Payload com supabase_id
- [x] Verificar status muda pra `synced`

### 13.8 Webhook de mensagens
- [x] Executar: `POST /webhooks/evolution/messages.upsert`
- [x] Payload tipo Evolution API (message, sender, timestamp)
- [x] Verificar resposta 200
- [x] Verificar que mensagem foi processada (logs)

### 13.9 Erro de autenticacao
- [x] Executar qualquer endpoint SEM headers de auth
- [x] Verificar resposta 401 ou 403
- [x] Validar mensagem de erro apropriada

### 13.10 Rate limit (stress test)
- [ ] Enviar 100 requisicoes/segundo pra `/health`
- [ ] Verificar que backend nao cai
- [x] Validar que alguns requests sao throttled (429) ou queue'd
- [x] Servidor deve recuperar apos pico

## Bloco 14 - Multiplos Usuarios Simultaneos

### 14.1 2 pacientes simultaneos
- [ ] Numero 1: enviar "oi"
- [ ] Numero 2: enviar "oi" (antes de numero 1 terminar)
- [x] Verificar que ambos recebem saudacao
- [x] Cada um mantem conversacao independente

### 14.2 Concurrent agendamentos
- [ ] Numero 1: iniciar agendamento ("quero marcar")
- [ ] Numero 2: iniciar agendamento ao mesmo tempo
- [ ] Ambos completarem fluxo ate confirmar
- [x] No Lovable: verificar que SAO 2 agendamentos diferentes
- [x] Nenhum dado cruzado entre conversas

### 14.3 Isolamento de conversation_state
- [ ] Numero 1: escolher procedimento "Limpeza"
- [ ] Numero 2: escolher procedimento "Profilaxia"
- [x] Verificar que conversation_state e isolado por phone
- [x] Numero 1 continua oferecendo so "Limpeza"
- [x] Numero 2 continua oferecendo so "Profilaxia"

### 14.4 3+ usuarios simultaneos (stress)
- [ ] Abrir 3+ numeros de WhatsApp
- [ ] Todos enviarem "oi" no mesmo segundo
- [ ] Todos receberem resposta (sem perder nenhum)
- [ ] Verificar logs: nao ha erro de conexao/timeout

### 14.5 Mesmo paciente, multiplos devices
- [ ] Usar MESMO CPF/telefone em 2 devices (emulador + real)
- [ ] Enviar mensagem em ambos simultaneamente
- [x] Verificar que backend reconhece como mesmo paciente
- [ ] Historico deve estar disponivel em ambos (ou apenas ultimo vence)
- [ ] Documentar comportamento esperado

### 14.6 Handoff com multiplos usuarios
- [ ] Numero 1: agendando ("selecionando horario")
- [ ] Numero 2: enviando "urgente" (handoff simultaneo)
- [x] Verificar que:
  - Numero 1 continua com IA
  - Numero 2 fica em takeover
  - Nao ha cruzamento de contexto

### 14.7 Cancelamento simultaneo
- [ ] Numero 1: agendamento confirmado
- [ ] Numero 2: agendamento confirmado
- [ ] Ambos enviarem "cancelar" ao mesmo tempo
- [x] Verificar que ambos recebem confirmacao
- [x] Dois agendamentos aparecem cancelados (nao conflita)

### 14.8 NPS simultaneo
- [ ] Criar 3 agendamentos confirmados (numeros diferentes)
- [x] Forcar scheduler tick: `curl -X POST http://localhost:3333/health/test/force-automation-tick`
- [x] Verificar que todos 3 recebem NPS survey
- [ ] Todos 3 responderem "8", "9", "10"
- [x] Verificar que 3 respostas foram gravadas (nao sobrescreveu)

### 14.9 Carga no sync
- [ ] Lovable envia 5 updates de agendamentos simultaneos
- [x] `POST /api/sync/appointments` com batch de 5
- [x] Verificar que todos 5 foram processados
- [x] Nenhum perdido, nenhum duplicado

### 14.10 Conexao cai com multiplos usuarios
- [ ] 3 pacientes em conversa
- [ ] Multiplas sessoes de diferentes tipos de usuarios e clinicas, capacidade da API.
- [ ] Desconectar Evolution: `docker-compose restart evolution-api`
- [ ] Todos 3 tentam enviar mensagem durante reconexao
- [ ] Verificar que:
  - Mensagens nao sao perdidas
  - Nenhuma duplicada
  - Reconexao automatica funciona
  - Contexto de cada usuario preservado

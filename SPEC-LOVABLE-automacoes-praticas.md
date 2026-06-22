# Spec p/ Lovable — Automações práticas (médico só liga, sem escrever)

> Objetivo (pedido do Yuri / dono): o médico NÃO deve escrever mensagem nem ver
> código tipo `{patient_name}`. Cada automação já vem com uma mensagem pronta e
> boa. Ele só **liga/desliga**. Personalizar é opcional e escondido.
>
> Arquivo afetado: `src/components/secretaria-ia/AutomationsPanel.tsx`
> ⚠️ NÃO mudar o backend: o que é salvo continua sendo texto com `{patient_name}`
> etc. O backend substitui pelos dados reais no envio. Variáveis suportadas:
> `{patient_name} {date} {time} {doctor} {procedure} {clinic_name}`.

## Mudança 1 — Mensagem PRÉ-PREENCHIDA (não placeholder)

Hoje cada automação tem `placeholder` (texto cinza que some). Trocar para **valor
padrão real**: ao criar/abrir uma automação que ainda não tem `message_template`,
preencher com o texto padrão abaixo. Assim o médico não precisa escrever nada.

| Tipo | Mensagem padrão |
|---|---|
| appointment_reminder | `Olá {patient_name}, lembrete da sua consulta em {date} às {time}.` |
| confirmation | `Olá {patient_name}, sua consulta foi agendada para {date} às {time}.` |
| return | `Olá {patient_name}, já faz um tempo desde sua última visita à {clinic_name}. Que tal agendar um retorno?` |
| reschedule | `Olá {patient_name}, sua consulta foi cancelada. Quer reagendar?` |
| birthday | `Olá {patient_name}, a equipe da {clinic_name} deseja um feliz aniversário! 🎉` |
| nps | `Olá {patient_name}, como foi seu atendimento hoje? De 0 a 10, o quanto você recomendaria a {clinic_name}?` |

## Mudança 2 — Esconder o campo de texto por padrão

No card de cada automação:
- Por padrão, NÃO mostrar a textarea com os `{}`. Mostrar só:
  - Título + descrição
  - Toggle ligar/desligar
  - Uma **prévia amigável** (1 linha, cinza): "Mensagem automática pronta ✓"
    ou o texto renderizado com exemplo (ver Mudança 3).
- Um link/botão discreto **"Personalizar mensagem"** que, ao clicar, expande a
  textarea pra quem quiser editar (caso avançado). Fechado por padrão.

Resultado: o fluxo comum é só ligar o toggle e clicar Salvar. Zero escrita.

## Mudança 3 (opcional, recomendada) — Prévia "como o paciente recebe"

Em vez de mostrar `Olá {patient_name}...`, renderizar um exemplo real:
- `{patient_name}` → `Maria`
- `{date}` → data de exemplo (ex: `10/06/2026`)
- `{time}` → `10:00`
- `{clinic_name}` → nome real da clínica logada
- `{doctor}` → `Dr. Carlos` · `{procedure}` → `Limpeza`

Exibir numa bolha estilo WhatsApp: "Olá Maria, lembrete da sua consulta em
10/06/2026 às 10:00." Assim o médico entende o resultado sem ver os `{}`.

## Mudança 4 — Botão "Restaurar padrão"

Se o médico editou e quer voltar, um botão recoloca a mensagem padrão da tabela
acima.

## Mudança 5 — Aniversário é ESPECIAL: imagem + mensagem personalizada

O card de **aniversário** é exceção: aqui faz sentido a clínica personalizar (cartão).
Backend JÁ PRONTO: o envio aceita `image_url`/`media_url` na automação (envia
imagem com legenda via sendEvolutionMediaMessage). Falta a UI:

- **Anexar imagem**: campo de upload de imagem (ou colar URL) no card de aniversário.
  Salvar a URL/base64 no campo `image_url` (ou `media_url`) da automação.
  Mostrar preview da imagem anexada.
- **Mensagem editável** (aqui mantém a edição, mas prática): textarea visível com a
  mensagem padrão de aniversário, COM botões de inserir variável ([Nome] [Clínica])
  em vez de o médico digitar `{patient_name}` na mão. Prévia "como o paciente recebe"
  mostrando a imagem + texto renderizado.
- O backend envia: imagem (image_url) + legenda (a mensagem renderizada).

Resumo: aniversário = upload de imagem + mensagem editável com botões de variável.
As OUTRAS automações = mensagem pronta, só ligar (Mudanças 1-4).

## Resumo do comportamento final
- Abrir a aba Automações → cada card já tem mensagem pronta.
- Médico liga o toggle → Salvar. Pronto, funcionando.
- Quem quiser, clica "Personalizar" → edita → (opcional) usa botões de variável.
- O que vai pro banco continua sendo o texto com `{}` (backend depende disso).

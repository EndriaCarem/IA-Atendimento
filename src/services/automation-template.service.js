/**
 * Renderiza templates de automação substituindo variáveis pelos dados reais.
 *
 * Variáveis suportadas:
 *   {patient_name} {date} {time} {doctor} {procedure} {clinic_name}
 */

const TZ = "America/Sao_Paulo";

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: TZ,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function formatTime(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function firstName(fullName) {
  if (!fullName) return "";
  return String(fullName).trim().split(/\s+/)[0];
}

/**
 * @param {string} template - texto com {variáveis}
 * @param {object} ctx - { patient_name, start_time, doctor, procedure, clinic_name }
 */
export function renderAutomationTemplate(template, ctx = {}) {
  if (!template) return "";

  const vars = {
    patient_name: firstName(ctx.patient_name) || "tudo bem",
    date: formatDate(ctx.start_time),
    time: formatTime(ctx.start_time),
    doctor: ctx.doctor ?? "",
    procedure: ctx.procedure ?? "",
    clinic_name: ctx.clinic_name ?? "",
  };

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return key in vars ? vars[key] : match;
  });
}

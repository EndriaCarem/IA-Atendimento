import { env } from "../config/env.js";
import { dbInsert, dbFind, dbUpdate } from "../lib/json-db.js";

function mapAppointment(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    clinicId: record[env.COL_APPOINTMENT_CLINIC_ID],
    patientId: record[env.COL_APPOINTMENT_PATIENT_ID],
    scheduledAt: record[env.COL_APPOINTMENT_DATETIME],
    status: record[env.COL_APPOINTMENT_STATUS],
    notes: record[env.COL_APPOINTMENT_NOTES] ?? null,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null
  };
}

export async function createAppointment({ clinicId, patientId, scheduledAt, status, notes, procedure = null, suggestedDentistId = null }) {
  const payload = {
    [env.COL_APPOINTMENT_CLINIC_ID]: clinicId,
    [env.COL_APPOINTMENT_PATIENT_ID]: patientId,
    [env.COL_APPOINTMENT_DATETIME]: scheduledAt,
    start_time:  scheduledAt,   // alias esperado pelo Lovable ao fazer sync para o Supabase
    [env.COL_APPOINTMENT_STATUS]: status,
    [env.COL_APPOINTMENT_NOTES]: notes ?? null,
    procedure,                       // nome do procedimento escolhido
    suggested_dentist_id: suggestedDentistId, // médico que atende o procedimento (ou null)
    source:      "ai",
    sync_status: "pending",
  };

  const record = dbInsert(env.TABLE_APPOINTMENTS, payload);
  return mapAppointment(record);
}

export async function findMostRecentAppointmentByPatient(clinicId, patientId) {
  const records = dbFind(
    env.TABLE_APPOINTMENTS,
    (r) =>
      r[env.COL_APPOINTMENT_CLINIC_ID] === clinicId &&
      r[env.COL_APPOINTMENT_PATIENT_ID] === patientId
  );

  if (records.length === 0) {
    return null;
  }

  records.sort(
    (a, b) =>
      new Date(b[env.COL_APPOINTMENT_DATETIME]) -
      new Date(a[env.COL_APPOINTMENT_DATETIME])
  );

  return mapAppointment(records[0]);
}

export async function updateAppointmentById({ appointmentId, clinicId, scheduledAt, status, notes }) {
  const updates = {
    [env.COL_APPOINTMENT_STATUS]: status,
    sync_status: "pending",
  };

  if (scheduledAt) {
    updates[env.COL_APPOINTMENT_DATETIME] = scheduledAt;
  }

  if (typeof notes === "string") {
    updates[env.COL_APPOINTMENT_NOTES] = notes;
  }

  const record = dbUpdate(
    env.TABLE_APPOINTMENTS,
    (r) => r.id === appointmentId && r[env.COL_APPOINTMENT_CLINIC_ID] === clinicId,
    updates
  );

  return mapAppointment(record);
}

import { findInstanceByClinicId } from "../repositories/whatsapp-instance.repository.js";
import { getEvolutionConnectionState, getEvolutionOwnerNumber, pingEvolutionConnection } from "../lib/evolution-api.js";
import { logger } from "../lib/logger.js";

export async function whatsAppStatusController(req, res, next) {
  try {
    const { clinicId } = req.params;

    const mapping = await findInstanceByClinicId(clinicId);
    if (!mapping) {
      return res.status(200).json({
        connected: false,
        status: "not_configured",
        instance_name: null
      });
    }

    let state;
    try {
      const result = await getEvolutionConnectionState(mapping.instanceName);
      state = result?.instance?.state ?? "unknown";
    } catch (err) {
      logger.warn({ err, instanceName: mapping.instanceName }, "Could not fetch Evolution state");
      state = "unknown";
    }

    // O state da Evolution mente: reporta "open" mesmo após desconexão pelo
    // celular. Quando diz "open", VALIDAMOS ativamente com um sendPresence —
    // que falha ("Connection Closed") se a conexão real caiu.
    let connected = false;
    let status = state;
    if (state === "open") {
      const selfNumber = await getEvolutionOwnerNumber(mapping.instanceName);
      if (selfNumber) {
        const reallyConnected = await pingEvolutionConnection(mapping.instanceName, selfNumber);
        connected = reallyConnected;
        status = reallyConnected ? "open" : "disconnected";
      } else {
        // Sem ownerJid = nunca pareou de verdade.
        connected = false;
        status = "disconnected";
      }
    }

    return res.status(200).json({
      connected,
      status,
      instance_name: mapping.instanceName
    });
  } catch (error) {
    next(error);
  }
}

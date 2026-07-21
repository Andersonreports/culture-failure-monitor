import config from "../config.ts";
import type { FailureCategory } from "../types.ts";

export interface NotifyPayload {
  category: FailureCategory;
  orderId?: string;
  sampleId?: string;
  patientName?: string;
  hospitalName?: string;
  testName?: string;
  reason: string;
  notes?: string;
  reportedBy: string;
  timestamp: string;
  billImageLink: string;
  referenceImageLinks: string[];
}

export interface NotifyResult {
  ok: boolean;
  channel: string;
  message: string;
}

export async function notifyCoordinator(failure: NotifyPayload): Promise<NotifyResult> {
  console.log("[notifyService] notification stub - email is handled by Apps Script:", failure);
  if (!config.whatsapp.coordinatorNumber) {
    console.warn(
      "[notifyService] COORDINATOR_WHATSAPP_NUMBER not set - notification is log-only for now.",
    );
  }
  return { ok: true, channel: "stub", message: "Notifications handled outside the app." };
}

export default { notifyCoordinator };

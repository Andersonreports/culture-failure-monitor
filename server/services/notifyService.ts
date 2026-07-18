import config from "../config.ts";
import type { FailureCategory } from "../types.ts";

export interface NotifyPayload {
  category: FailureCategory;
  orderId?: string;
  sampleId?: string;
  patientName?: string;
  testMethodology?: string;
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

// WhatsApp send mechanism is on hold pending an IT decision (options discussed:
// click-to-send wa.me link / CallMeBot / official WhatsApp Business API). This
// is the single extension point to wire in whichever is chosen later - nothing
// else in the app needs to change.
export async function notifyCoordinator(failure: NotifyPayload): Promise<NotifyResult> {
  console.log("[notifyService] WhatsApp notification stub - would notify coordinator:", failure);
  if (!config.whatsapp.coordinatorNumber) {
    console.warn(
      "[notifyService] COORDINATOR_WHATSAPP_NUMBER not set - notification is log-only for now.",
    );
  }
  return { ok: true, channel: "stub", message: "WhatsApp notification not yet wired up." };
}

export default { notifyCoordinator };

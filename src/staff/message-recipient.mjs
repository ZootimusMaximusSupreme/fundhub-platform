// Narrowly identify internal texts that carry a client_id for context but are
// addressed to an active staff phone, and human setter texts addressed to leads.
export const STAFF_BOOKED_TEMPLATE = "SMS-S04C-STAFF-BOOKED";
export const STAFF_BOOKED_ROLES = Object.freeze(["owner", "setter"]);
const E164 = /^\+[1-9]\d{7,14}$/;

export function staffTextRecipient(message = {}) {
  if (message.channel !== "sms" || !E164.test(String(message.toAddress || ""))) return null;
  const ref = String(message.providerRef || "");
  if (message.templateKey === STAFF_BOOKED_TEMPLATE) {
    const match = /^workflow:SMS-S04C-STAFF-BOOKED:[^:]+:([^:]+)$/.exec(ref);
    return match ? { staffId: match[1], roles: STAFF_BOOKED_ROLES, requireBookedAlertSwitch: false } : null;
  }
  if (message.templateKey) return null;
  const alert = /^staff-alert:(lead|set|upcoming):.+:([^:]+)$/.exec(ref);
  if (alert) return {
    staffId: alert[2], roles: alert[1] === "lead" ? ["owner", "setter"] : ["owner", "closer"],
    requireBookedAlertSwitch: false
  };
  const closer = /^setter:.+:closer:([^:]+)$/.exec(ref);
  return closer ? { staffId: closer[1], roles: ["owner", "closer"], requireBookedAlertSwitch: false } : null;
}

export function isStaffText(message = {}) {
  return message.channel === "sms" && (
    message.templateKey === STAFF_BOOKED_TEMPLATE ||
    isImmediateStaffAlert(message) ||
    (!message.templateKey && /^setter:.+:closer:/.test(String(message.providerRef || "")))
  );
}

// These are operational alerts to the verified staff phone, not client texts.
export function isImmediateStaffAlert(message = {}) {
  return message.channel === "sms" && !message.templateKey &&
    /^staff-alert:(?:lead|set|upcoming):/.test(String(message.providerRef || ""));
}

export function isSetterLeadText(message = {}) {
  if (message.channel !== "sms" || !message.clientId) return false;
  const ref = String(message.providerRef || "");
  return ref.startsWith(`staff:setter-video:${message.clientId}:`) ||
    (ref.startsWith(`staff:setter-handoff:${message.clientId}:`) && ref.endsWith(":lead"));
}

export function usesSetterContactHours(message = {}) {
  return isStaffText(message) || isSetterLeadText(message);
}

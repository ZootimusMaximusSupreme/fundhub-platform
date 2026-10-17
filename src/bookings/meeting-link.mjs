// Only a real HTTPS meeting destination may become a call invite or Join Call
// action. A sign-in or booking page is a useful text fallback, not a meeting.
export function meetingDestination(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === "fundhub.ai" || host.endsWith(".fundhub.ai") ||
      host === "localhost" || host.endsWith(".local") ||
      /^\d+(?:\.\d+){3}$/.test(host)) return null;
  return { url: url.href, host: url.host };
}

export default { meetingDestination };

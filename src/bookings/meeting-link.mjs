// Only room-shaped links used by Fundhub may become a call invite or Join Call
// action. A sign-in or booking page is a useful text fallback, not a meeting.
export function meetingDestination(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "https:" || !url.hostname || url.port || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const googleMeetRoom = host === "meet.google.com" && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname);
  const zoomRoom = (host === "zoom.us" || /^us\d{2}web\.zoom\.us$/.test(host)) &&
    /^\/j\/\d{9,11}\/?$/.test(url.pathname);
  if (!googleMeetRoom && !zoomRoom) return null;
  return { url: url.href, host: url.host };
}

export default { meetingDestination };

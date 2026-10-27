// Shared name rules for Meet recording + transcript files in Drive.

export function meetTitleStem(name) {
  return String(name || "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/\s*[-–—]\s*(gemini\s+)?(notes|transcript|recording|recap).*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function looksLikeTranscriptName(name) {
  return /\b(transcript|gemini\s+notes)\b/i.test(String(name || ""));
}

export function looksLikeRecordingMime(mimeType) {
  const mime = String(mimeType || "").trim().toLowerCase();
  return mime.startsWith("video/") || mime.startsWith("audio/");
}

/** Google Meet file names only. Course / VSL / Screen Recording do not match. */
export function looksLikeMeetRecordingName(name) {
  const n = String(name || "");
  if (/screen[- ]?record/i.test(n)) return false;
  return /(google\s+)?meet(ing)?\s+recording|\bgoogle\s+meet\b|\bgmt\d{8}\b/i.test(n)
    || /\b\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+GMT\s*[+-]\s*\d{1,2}(?::?\d{2})?.*\brecording\b/i.test(n);
}

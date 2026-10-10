import Foundation

/// One block the prompter rolls. A cue (bullets mode) holds until Chris taps or
/// presses the remote.
struct Paragraph: Equatable {
    var text: String
    var cue: Bool
}

/// The words rules, ported from the web teleprompter
/// (public/app/teleprompter.js and teleprompter-edits.js on mm-teleprompter-v2)
/// so the phone and the dashboard read and save a script the same way.
enum ScriptText {

    /// v1's acronyms that stay plain even in CAPS.
    static let notCaps: Set<String> = ["LLC", "LLCS", "SBA", "FICO", "OPM", "ROI", "CEO", "NAICS", "USA", "US",
                                       "AI", "OK", "ID", "TV", "CTA", "VSL", "WPM"]

    /// CAPS words go bold, except the acronyms v1 lets through.
    static func isCaps(_ token: String) -> Bool {
        let letters = token.filter { $0.isLetter && $0.isASCII }
        return letters.count >= 2 && letters == letters.uppercased() && !notCaps.contains(letters)
    }

    static func nonEmptyParts(_ s: Script) -> [ScriptPart] {
        (s.parts ?? []).filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    /// Bullets mode: the parts roll, and each cue holds (spec §8.1).
    static func isBullets(_ s: Script) -> Bool {
        s.style == "bullets" && s.firstLineOnly != true && nonEmptyParts(s).contains { $0.kind == "cue" }
    }

    /// What the teleprompter rolls (the server's rule, teleprompterText in
    /// src/marketing/shoot-plan.mjs): the body, or only the hook for a
    /// first-line-only retake.
    static func rolledText(_ s: Script) -> String {
        guard s.firstLineOnly == true else { return s.body }
        if let hook = (s.parts ?? []).first(where: { $0.kind == "hook" && !$0.text.trimmed.isEmpty }) {
            return hook.text.trimmed
        }
        return splitBlocks(s.body).first ?? s.body
    }

    static func splitBlocks(_ text: String) -> [String] {
        let clean = text.replacingOccurrences(of: "\r", with: "")
        let pattern = try! NSRegularExpression(pattern: "\\n\\s*\\n")
        let ns = clean as NSString
        var out: [String] = []
        var last = 0
        for m in pattern.matches(in: clean, range: NSRange(location: 0, length: ns.length)) {
            out.append(ns.substring(with: NSRange(location: last, length: m.range.location - last)))
            last = m.range.location + m.range.length
        }
        out.append(ns.substring(from: last))
        return out.map { $0.trimmed }.filter { !$0.isEmpty }
    }

    /// The paragraphs to roll.
    static func paragraphs(_ s: Script) -> [Paragraph] {
        if isBullets(s) {
            return nonEmptyParts(s).map { Paragraph(text: $0.text.trimmed, cue: $0.kind == "cue") }
        }
        let text = s.firstLineOnly == true ? rolledText(s) : (s.teleprompterText ?? s.body)
        return splitBlocks(text).map { Paragraph(text: $0, cue: false) }
    }

    /// NAMING.md: `{Offer} Ad {n} — {angle} Take {k}.mp4`, or nil when a part is missing.
    static func takeFileName(offerWord: String?, adId: String?, angle: String?, takeNo: Int) -> String? {
        guard let offer = offerWord, !offer.isEmpty, let angle = angle, !angle.isEmpty,
              let ad = adId, !ad.isEmpty, ad.allSatisfy({ $0.isASCII && $0.isNumber }), takeNo >= 1 else { return nil }
        return "\(offer) Ad \(ad) — \(angle) Take \(takeNo).mp4"
    }

    /// The script after one Got it / Another take press, as the server counts it
    /// (applyMark in src/marketing/shoot-plan.mjs).
    static func afterMark(_ s: Script, gotIt: Bool) -> Script {
        var out = s
        out.takes = max(0, s.takes ?? 0) + 1
        out.gotIt = gotIt ? true : (s.gotIt ?? false)
        out.lastTakeFileName = s.takeFileName
        let next = max(1, s.takeNo ?? 1) + 1
        out.takeNo = next
        out.takeFileName = takeFileName(offerWord: s.offerWord, adId: s.adId, angle: s.angleName, takeNo: next)
        return out
    }

    // MARK: - Edit on the fly (port of applyEdit)

    struct EditResult: Equatable {
        var body: String
        /// nil = do not send parts (the server keeps or clears them itself).
        var parts: [ScriptPart]?
        var changed: Bool
    }

    /// Clean what the edit box holds: no \r, no spaces at line ends, no blank lines at either end.
    static func clean(_ text: String) -> String {
        text.replacingOccurrences(of: "\r", with: "")
            .components(separatedBy: "\n")
            .map { line -> String in
                var l = line
                while let last = l.last, last == " " || last == "\t" { l.removeLast() }
                return l
            }
            .joined(separator: "\n")
            .trimmed
    }

    /// Where each rolled paragraph sits in the body, found in order.
    static func locate(_ body: String, _ texts: [String]) -> [Range<String.Index>?] {
        var at = body.startIndex
        var out: [Range<String.Index>?] = []
        for t in texts {
            if t.isEmpty { out.append(nil); continue }
            if let r = body.range(of: t, range: at..<body.endIndex) {
                out.append(r)
                at = r.upperBound
            } else {
                out.append(nil)
            }
        }
        return out
    }

    /// Take a span out of the body and close the gap: a blank line stays a blank line.
    static func cut(_ body: String, _ spot: Range<String.Index>) -> String {
        let beforeRaw = String(body[body.startIndex..<spot.lowerBound])
        let afterRaw = String(body[spot.upperBound...])
        let before = beforeRaw.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression)
        let after = afterRaw.replacingOccurrences(of: "^\\s+", with: "", options: .regularExpression)
        if before.isEmpty || after.isEmpty { return before + after }
        let gapA = String(beforeRaw.dropFirst(before.count))
        let gapB = String(afterRaw.dropLast(after.count))
        let gaps = [gapA, gapB]
        let blank = gaps.contains { $0.range(of: "\\n[ \\t]*\\n", options: .regularExpression) != nil }
        let br = gaps.contains { $0.contains("\n") }
        return before + (blank ? "\n\n" : br ? "\n" : " ") + after
    }

    /// The parts after one paragraph changed (words mode). nil = could not be mapped.
    static func mapParts(_ input: [ScriptPart], old: String, next: String) -> [ScriptPart]? {
        var parts = input
        if let whole = parts.firstIndex(where: { $0.text.trimmed == old }) {
            if next.isEmpty { parts.remove(at: whole) } else { parts[whole].text = next }
            return parts
        }
        let touches = parts.contains { p in
            let t = p.text.trimmed
            return !t.isEmpty && (old.contains(t) || t.contains(old))
        }
        if !touches { return parts }
        let oldLines = old.components(separatedBy: "\n").map { $0.trimmed }
        let newLines = next.isEmpty ? [] : next.components(separatedBy: "\n").map { $0.trimmed }
        if oldLines.count > 1 && oldLines.count == newLines.count {
            var used = Set<Int>()
            for l in 0..<oldLines.count where oldLines[l] != newLines[l] {
                guard let hit = parts.indices.first(where: { !used.contains($0) && parts[$0].text.trimmed == oldLines[l] }) else {
                    return nil
                }
                used.insert(hit)
                parts[hit].text = newLines[l]
            }
            return parts
        }
        let holders = parts.indices.filter { parts[$0].text.contains(old) }
        if holders.count == 1 {
            let h = holders[0]
            if let r = parts[h].text.range(of: old) {
                parts[h].text = parts[h].text.replacingCharacters(in: r, with: next).trimmed
            }
            return parts
        }
        return nil
    }

    /// One paragraph of the rolled script changed. Returns the whole new script
    /// words to send to POST marketing/scripts/edit, or nil when there is no paragraph i.
    static func applyEdit(_ s: Script, paragraphs paras: [Paragraph], index i: Int, newText: String, bullets: Bool) -> EditResult? {
        guard i >= 0 && i < paras.count else { return nil }
        let body = s.body
        let old = paras[i].text
        let next = clean(newText)
        if next == old { return EditResult(body: body, parts: s.parts, changed: false) }
        var newBody = body
        if let spot = locate(body, paras.map { $0.text })[i] {
            newBody = next.isEmpty ? cut(body, spot) : body.replacingCharacters(in: spot, with: next)
        }
        var outParts: [ScriptPart]? = nil
        if var parts = s.parts, !parts.isEmpty {
            if bullets {
                var n = -1
                var k = -1
                for j in parts.indices where !parts[j].text.trimmed.isEmpty {
                    n += 1
                    if n == i { k = j; break }
                }
                if k >= 0 {
                    if next.isEmpty { parts.remove(at: k) } else { parts[k].text = next }
                    outParts = parts
                }
            } else {
                outParts = mapParts(parts, old: old, next: next)
            }
        }
        let changed = newBody != body || (outParts != nil && outParts != s.parts)
        return EditResult(body: newBody, parts: outParts, changed: changed)
    }

    /// A copy of the script with new words (what the phone shows while a save waits).
    static func withWords(_ s: Script, body: String, parts: [ScriptPart]?) -> Script {
        var out = s
        out.body = body
        out.parts = parts ?? (body == s.body ? s.parts : nil)
        out.teleprompterText = nil
        out.teleprompterText = rolledText(out)
        return out
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

import Foundation

/// SCREENSHOT AND TEST DEMO ONLY. Started with the launch argument
/// `-FundhubDemo` (never on Chris's phone unless that argument is passed from
/// Xcode). The shoot below is the made-up example in
/// docs/specs/marketing-machine-api.md §7.1 (GET marketing/shoot), word for
/// word: not a real script, not a real number. Nothing here talks to a server.
final class DemoTransport: Transport {
    private var answer: [String: Any]
    private var version: [String: Int] = [:]

    init() {
        answer = (try? JSONSerialization.jsonObject(with: Data(DemoTransport.shootJSON.utf8))) as? [String: Any] ?? [:]
    }

    func send(_ method: String, _ path: String, body: [String: Any]?) async -> HTTPResult {
        if path.hasPrefix("marketing/shoot/mark") {
            return ok(["marks": [:]])
        }
        if path.hasPrefix("marketing/shoot") {
            return ok(answer)
        }
        if path == "marketing/scripts/edit", let b = body, let id = b["id"] as? String {
            var shoot = answer["shoot"] as? [String: Any] ?? [:]
            var scripts = shoot["scripts"] as? [[String: Any]] ?? []
            guard let i = scripts.firstIndex(where: { ($0["id"] as? String) == id }) else {
                return HTTPResult(status: 404, data: try? JSONSerialization.data(withJSONObject: ["error": "not_found"]))
            }
            var s = scripts[i]
            let v = (s["version"] as? Int ?? 1) + 1
            s["id"] = "demo-\(UUID().uuidString.lowercased())"
            s["version"] = v
            s["body"] = b["body"]
            if let p = b["parts"] { s["parts"] = p }
            s["teleprompter_text"] = b["body"]
            scripts[i] = s
            shoot["scripts"] = scripts
            answer["shoot"] = shoot
            return ok(["script": s, "warnings": []])
        }
        return HTTPResult(status: 404, data: nil)
    }

    private func ok(_ obj: [String: Any]) -> HTTPResult {
        HTTPResult(status: 200, data: try? JSONSerialization.data(withJSONObject: obj))
    }

    static let shootJSON = #"""
{
 "shoot": {
  "id": "00000000-0000-4000-8000-000000000901",
  "shoot_date": "2026-10-13",
  "status": "filming",
  "scripts": [
   {
    "id": "00000000-0000-4000-8000-000000000101",
    "root_script_id": "00000000-0000-4000-8000-000000000101",
    "version": 1,
    "status": "locked",
    "ad_id": "91",
    "title": "Lenders read two files",
    "body": "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.\n\nthe personal file\nthe business file\nwhich one they read first\n\nWe check both before you apply anywhere.\n\nTap below and see what both files say today.",
    "parts": [
     {
      "kind": "hook",
      "text": "MOST lenders read TWO files before they say yes."
     },
     {
      "kind": "line2",
      "text": "If one is a mess, they never open the other."
     },
     {
      "kind": "cue",
      "text": "the personal file"
     },
     {
      "kind": "cue",
      "text": "the business file"
     },
     {
      "kind": "cue",
      "text": "which one they read first"
     },
     {
      "kind": "reveal",
      "text": "We check both before you apply anywhere."
     },
     {
      "kind": "cta",
      "text": "Tap below and see what both files say today."
     }
    ],
    "script_format": "standard",
    "style": "bullets",
    "funnel_key": "roadmap_147",
    "angle_key": "two-files",
    "hook_key": "two-files-lenders-read",
    "offer_key": "slo_roadmap",
    "lane": "uwiq",
    "batch_id": "00000000-0000-4000-8000-000000000301",
    "idea_id": "00000000-0000-4000-8000-000000000401",
    "source": "machine",
    "check_results": {
     "strict": {
      "passed": true,
      "rounds": 1,
      "failures": []
     },
     "judge": {
      "passed": true,
      "notes": []
     },
     "compliance": {
      "state": "passed",
      "reasons": []
     }
    },
    "flagged": false,
    "fix_note": null,
    "animation_plan": [
     {
      "anchor": {
       "cue": 1,
       "keyword": "personal"
      },
      "template": "FileItems",
      "props": {},
      "seconds": 2.5
     },
     {
      "anchor": {
       "cue": 3,
       "keyword": "first"
      },
      "template": "StepPath",
      "props": {},
      "seconds": 3
     }
    ],
    "meta_copy": {
     "primary_text": "Lenders read two files before they say yes. See what both of yours say before you apply.",
     "headline": "See both files first",
     "description": "Your Funding Roadmap",
     "cta_type": "LEARN_MORE"
    },
    "film_order": 1,
    "needs_retake": false,
    "locked_at": "2026-10-12T15:06:00.000Z",
    "locked_by": "00000000-0000-4000-8000-000000000002",
    "rejected_at": null,
    "rejected_reason": null,
    "filmed_at": null,
    "repo_path": "marketing/ads/scripts/machine/2026-W42/03-lenders-read-two-files.md",
    "repo_commit": "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d",
    "created_at": "2026-10-12T11:12:40.000Z",
    "updated_at": "2026-10-13T15:30:00.000Z",
    "angle_name": "Lenders read two files",
    "offer_word": "SLO",
    "take_no": 3,
    "take_file_name": "SLO Ad 91 — Lenders read two files Take 3.mp4",
    "take_name_problem": null,
    "last_take_file_name": "SLO Ad 91 — Lenders read two files Take 2.mp4",
    "takes": 2,
    "got_it": true,
    "first_line_only": false,
    "teleprompter_text": "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.\n\nthe personal file\nthe business file\nwhich one they read first\n\nWe check both before you apply anywhere.\n\nTap below and see what both files say today.",
    "words": 46,
    "read_seconds": 22
   },
   {
    "id": "00000000-0000-4000-8000-000000000201",
    "root_script_id": "00000000-0000-4000-8000-000000000201",
    "version": 1,
    "status": "locked",
    "ad_id": "92",
    "title": "Inquiries off first",
    "body": "Every hard pull you did not need is still sitting on your file.\n\nAnd lenders count them.",
    "parts": [
     {
      "kind": "hook",
      "text": "Every hard pull you did not need is still sitting on your file."
     },
     {
      "kind": "line2",
      "text": "And lenders count them."
     }
    ],
    "script_format": "sorting",
    "style": "words",
    "funnel_key": "book_call",
    "angle_key": "inquiries-off",
    "hook_key": "inquiries-off-hard-pulls",
    "offer_key": "funding_dfy",
    "lane": "sorting",
    "batch_id": "00000000-0000-4000-8000-000000000301",
    "idea_id": null,
    "source": "machine",
    "check_results": {
     "strict": {
      "passed": true,
      "rounds": 1,
      "failures": []
     },
     "judge": {
      "passed": true,
      "notes": []
     },
     "compliance": {
      "state": "passed",
      "reasons": []
     }
    },
    "flagged": false,
    "fix_note": null,
    "animation_plan": [
     {
      "anchor": {
       "phrase": "lenders count them"
      },
      "template": "InquiriesOff",
      "props": {},
      "seconds": 2.5
     }
    ],
    "meta_copy": {
     "primary_text": "Every hard pull you did not need is still on your file. Lenders count them.",
     "headline": "Lenders count your pulls",
     "description": "Book a call",
     "cta_type": "LEARN_MORE"
    },
    "film_order": 2,
    "needs_retake": false,
    "locked_at": "2026-10-12T15:09:00.000Z",
    "locked_by": "00000000-0000-4000-8000-000000000002",
    "rejected_at": null,
    "rejected_reason": null,
    "filmed_at": null,
    "repo_path": "marketing/ads/scripts/machine/2026-W42/04-inquiries-off-first.md",
    "repo_commit": "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d",
    "created_at": "2026-10-12T11:12:40.000Z",
    "updated_at": "2026-10-13T15:30:00.000Z",
    "angle_name": "Inquiries off first",
    "offer_word": null,
    "take_no": 1,
    "take_file_name": null,
    "take_name_problem": "The Funding, done-for-you offer has no file-name word yet (like SLO for the roadmap), so the file name is unknown.",
    "last_take_file_name": null,
    "takes": 0,
    "got_it": false,
    "first_line_only": false,
    "teleprompter_text": "Every hard pull you did not need is still sitting on your file.\n\nAnd lenders count them.",
    "words": 17,
    "read_seconds": 8
   }
  ]
 },
 "plan_candidates": [],
 "wpm": 150,
 "as_of": "2026-10-13T16:06:00.000Z"
}
"""#
}

/// Launch arguments the screenshot demo reads. Only used when -FundhubDemo is on.
enum DemoArgs {
    static func has(_ arg: String) -> Bool { ProcessInfo.processInfo.arguments.contains(arg) }
}

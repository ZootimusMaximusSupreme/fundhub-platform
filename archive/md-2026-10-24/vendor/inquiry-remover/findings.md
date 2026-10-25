# Inquiry Removal AI — Findings

## Retell AI Platform
- **API Base:** https://api.retellai.com
- **Create Agent:** POST /create-agent (needs response_engine + voice_id)
- **Create Call:** POST /v2/create-phone-call (needs from_number + to_number)
- **Auth:** Bearer token in Authorization header
- **Free tier:** $10 credits (~67-90 min), 20 concurrent calls, no phone numbers included
- **Cost:** ~$0.11-0.19/min (voice + LLM + telephony)
- **IVR/DTMF:** Native support via press_digit tool in agent config
- **Voice models:** ElevenLabs, Cartesia, OpenAI TTS — ElevenLabs most realistic
- **Max call duration:** 1 hour default (configurable)
- **Post-call analysis:** Can extract structured data from calls (hit_ivr, reached_human, etc.)
- **Webhooks:** call_started, call_ended, call_analyzed events
- **PII scrubbing:** Built-in for SSN, phone, email, name

## Experian IVR Flow (from Chris's SOP)
1. "Why are you calling?" → say "Dispute"
2. "Enroll in text alerts?" → say "No"
3. "Enter or say SSN" → say SSN
4. "Enter current zip code" → say zip
5. "Just a moment please" → wait
6. "New dispute or follow up?" → select (new)
7. "What do you want to dispute?" → say "Live Representative"
8. TRANSFER → HOLD (woman's voice describing Experian features)
9. LIVE REP → verify identity (full name, middle name)
10. "Reason for calling?" → "Speak to fraud department"
11. "Add fraud alert?" → "No"
12. HOLD again (up to 30 min) for fraud department
13. EITHER: AI finishes the call OR transfer to FundHub rep

## Key Requirements (from Chris)
- AI must sound human — rep should NOT know it's AI
- 10+ concurrent calls needed
- Agent needs full CRS data for identity verification
- Post-call automation must trigger next workflow steps
- Same-day inquiry removal is the business requirement (letters take 1-2 weeks)
- 2-3 week funding window, can't wait for mail disputes

## Existing Account State
- API Key: (in .env, not committed)
- Existing agent: "Patient Screening (from template)" — conversation flow type
- Phone numbers: +1(661)475-6926 (purchased 2026-03-14)

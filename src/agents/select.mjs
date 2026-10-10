// Agent selection — which registry row owns this inbound message.
//
// Order (owner-set; tiebreak added 2026-08-04 after ambiguous_agents left the
// shadow log empty in verification):
//   1. Skip if no client, or conversation is agent-halted.
//   2. conversations.agent_code if set and the agent is eligible.
//   3. Last outbound sender_agent_code on this conversation, if eligible.
//   4. Channel-compatible live|shadow messaging agents, with a deterministic
//      tiebreak when more than one matches:
//        live before shadow → sort_order ASC → created_at ASC → code ASC.
//      Zero matches → skip. Many matches → pick the winner (never invent a
//      second reply; never leave the operator with an empty shadow log).
//
// Eligible = status in (live, shadow), channel covers the inbound channel,
// agent_class = client_facing, channel is messaging (sms|email|sms_email),
// runtime !== 'bland' | 'ghl' (Bland = voice vendor; the CRM is out — owner 2026-08-15),
// and not an agent that answers on its own path (OWN_PATH_AGENT_CODES below).

const MESSAGING_CHANNELS = new Set(["sms", "email", "sms_email"]);
const RUNNING = new Set(["live", "shadow"]);

/* AGENTS THAT ANSWER ON THEIR OWN PATH, never through this runtime.
   FOS-01, the FinanceOS Money Helper (db/migrations/465), is a shadow sms
   agent with a prompt — exactly the shape the channel match below would pick
   for EVERY inbound text from EVERY client (no other messaging agent runs
   today), and this runtime would then answer with a plain model call and none
   of the helper's checks. It answers in its own thread through
   src/finance/money-agent-ai.mjs instead. */
export const OWN_PATH_AGENT_CODES = Object.freeze(["FOS-01"]);

export function channelCompatible(agentChannel, inboundChannel) {
  if (!agentChannel || !inboundChannel) return false;
  if (agentChannel === inboundChannel) return true;
  if (agentChannel === "sms_email" && (inboundChannel === "sms" || inboundChannel === "email")) {
    return true;
  }
  return false;
}

export function isEligibleAgent(agent, inboundChannel) {
  if (!agent) return false;
  if (OWN_PATH_AGENT_CODES.includes(String(agent.code || "").trim().toUpperCase())) return false;
  if (!RUNNING.has(agent.status)) return false;
  if (agent.agent_class && agent.agent_class !== "client_facing") return false;
  if (!MESSAGING_CHANNELS.has(agent.channel)) return false;
  if (agent.runtime === "bland" || agent.runtime === "ghl") return false;
  if (!channelCompatible(agent.channel, inboundChannel)) return false;
  // Draft prompts empty → cannot usefully reply.
  if (!agent.prompt || !String(agent.prompt).trim()) return false;
  return true;
}

/**
 * selectAgent(db, { orgId, clientId, channel, conversationId? })
 * → { agent, reason } | { agent: null, reason }
 */
export async function selectAgent(db, {
  orgId, clientId, channel, conversationId = null
} = {}) {
  if (!orgId || !clientId) {
    return { agent: null, reason: "no_client" };
  }
  if (!channel || (channel !== "sms" && channel !== "email")) {
    return { agent: null, reason: "unsupported_channel" };
  }

  let convo = null;
  if (conversationId) {
    const { rows } = await db.query(
      `SELECT id, agent_code, agent_halted_at, agent_halt_reason
         FROM conversations WHERE id = $1 AND org_id = $2`,
      [conversationId, orgId]
    );
    convo = rows[0] || null;
  } else {
    const { rows } = await db.query(
      `SELECT id, agent_code, agent_halted_at, agent_halt_reason
         FROM conversations
        WHERE org_id = $1 AND client_id = $2 AND channel = $3
          AND COALESCE(kind, 'client') = 'client'
        LIMIT 1`,
      [orgId, clientId, channel]
    );
    convo = rows[0] || null;
  }

  if (convo?.agent_halted_at) {
    return {
      agent: null,
      reason: "halted",
      detail: convo.agent_halt_reason || "thread halted",
      conversationId: convo.id
    };
  }

  const load = async (code) => {
    if (!code) return null;
    const { rows } = await db.query(
      `SELECT * FROM agents WHERE org_id = $1 AND code = $2`,
      [orgId, String(code).trim().toUpperCase()]
    );
    return rows[0] || null;
  };

  if (convo?.agent_code) {
    const a = await load(convo.agent_code);
    if (isEligibleAgent(a, channel)) {
      return { agent: a, reason: "conversation_assigned", conversationId: convo.id };
    }
  }

  const convoId = convo?.id || conversationId;
  if (convoId) {
    const { rows } = await db.query(
      `SELECT sender_agent_code
         FROM messages
        WHERE conversation_id = $1
          AND sender_kind = 'agent'
          AND sender_agent_code IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [convoId]
    );
    if (rows[0]?.sender_agent_code) {
      const a = await load(rows[0].sender_agent_code);
      if (isEligibleAgent(a, channel)) {
        return { agent: a, reason: "last_agent_sender", conversationId: convoId };
      }
    }
  }

  const { rows: candidates } = await db.query(
    `SELECT * FROM agents
      WHERE org_id = $1
        AND status IN ('live', 'shadow')
        AND agent_class = 'client_facing'
        AND channel IN ('sms', 'email', 'sms_email')
        AND COALESCE(runtime, '') <> 'bland'
        AND COALESCE(runtime, '') <> 'ghl'
        AND prompt IS NOT NULL AND btrim(prompt) <> ''`,
    [orgId]
  );

  const matched = candidates.filter((a) => isEligibleAgent(a, channel));
  if (matched.length === 0) {
    return { agent: null, reason: "no_eligible_agent", conversationId: convoId || null };
  }
  if (matched.length === 1) {
    return {
      agent: matched[0],
      reason: "sole_channel_match",
      conversationId: convoId || null
    };
  }

  // Deterministic tiebreak — live wins over shadow, then stable ordering.
  matched.sort((a, b) => {
    const liveRank = (s) => (s === "live" ? 0 : 1);
    const byStatus = liveRank(a.status) - liveRank(b.status);
    if (byStatus) return byStatus;
    const bySort = (Number(a.sort_order) || 100) - (Number(b.sort_order) || 100);
    if (bySort) return bySort;
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return String(a.code || "").localeCompare(String(b.code || ""));
  });

  return {
    agent: matched[0],
    reason: "tiebreak_channel_match",
    detail: matched.map((a) => a.code).join(","),
    conversationId: convoId || null
  };
}

export default selectAgent;

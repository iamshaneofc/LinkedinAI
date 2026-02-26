# Personalized Message Generation — Prompts Reference

This document describes the prompts used in the LinkedIn automation app to generate **personalized LinkedIn connection notes**, **follow-up messages**, and related content (Gmail drafts, email failover). All prompts aim for a natural, human-like tone and avoid generic or template-style wording.

---

## Quick reference: which prompt is which

| Message type | What it is | Prompt section | Method |
|--------------|------------|----------------|--------|
| **Dynamic message** | First touch: personalized connection note (per lead, per profile). The “main” AI-generated message when you connect. | § 2 Connection request | `generateConnectionRequest` |
| **Follow-up message** | Later messages in a sequence (after connection or previous step). Can use “what you already sent.” | § 3 Follow-up | `generateFollowUpMessage` |

---

## 1. Shared block: human-like writing rules

Used across **connection request**, **follow-up**, **Gmail draft**, and **email outreach** prompts. Defined in `backend/src/services/ai.service.js` as `HUMAN_WRITER_BLOCK`:

```text
CRITICAL — SOUND EFFORTLESS AND NATURAL:
- Do NOT default to "Hi [Name]," at the start. Vary your opening every time: start with a direct observation, a question, a single line that hooks, or dive straight in—like a DM or a note you'd actually send. Use their name only if it fits naturally (middle or end of message), or don't use it at all.
- You've read their profile. Reference SPECIFIC details (exact phrase from bio, concrete post topic, real role/company)—not "your expertise" or "your work."
- Sound like you're dropping them a note, not "reaching out" or "hoping to connect." Short sentences. Occasional fragment. No buildup, no formal outreach tone.
- NEVER use: "I recently came across", "Given your interest in", "Would you be interested in learning more", "It's impressive to see", "could provide valuable insights", "Your expertise would be a tremendous addition", "I'd love to connect" without a concrete reason first, "I hope this message finds you well", "I'd love to hear your thoughts" as a standalone closer.

STRUCTURE VARIETY (every message must be different):
- BANNED OPENINGS — do not start with: "That latest product update you shared", "The latest product update you shared", "That post you shared", "The post you shared", "Your recent post", "That [X] you shared", "The [X] you shared". Each message must have a UNIQUE first sentence—never reuse the same opener pattern.
- Vary your FIRST sentence: use a question, or a short observation (different wording every time), or a contrast, or a single detail that's specific to them. Invent a fresh opener for this person only.
- Vary your LAST sentence: don't always end with "Let me know if you're up for a chat" or "Would love to chat more" or "Thought it might be interesting for you". Mix: a question, a soft invite, an open-ended line, or a brief sign-off. Different structure and wording every time.
- Vary sentence length and rhythm: some messages use more short punchy sentences; others flow in longer lines. No two messages should feel like the same template.
```

---

## 2. Dynamic message prompt (connection request)

This is the prompt used to generate **dynamic messages**: the first, personalized LinkedIn connection note for each lead. Each message is generated from lead + enrichment (bio, interests, posts) and optional campaign context, so it’s unique per recipient.

**Used for:** First LinkedIn connection note (max ~300–600 chars depending on length option).

**Method:** `AIService.generateConnectionRequest(lead, enrichment, options)`

**Options:** `tone` (professional | friendly | casual | formal | warm), `length` (short | medium | long), `focus` (recent_post | company | role | mutual_connection | general), and optional `campaign` context.

**Prompt (template):**

```text
You're a real person sending a LinkedIn connection note. You know this profile—write something that could only be for THIS person. Sound natural. Not like a template or "outreach."

Lead: ${lead.full_name} | ${lead.title || 'N/A'} | ${lead.company || 'N/A'}${enrichmentContext}${campaignContext}
${HUMAN_WRITER_BLOCK}

OPENING (important): Do NOT start with "Hi [Name],". Do NOT start with "That/the latest product update you shared" or "That/the post you shared" or any "[That/The] [thing] you shared"—those make every message look the same. For THIS person only, pick ONE opening style and make the first sentence unique:
- Option A: Start with a question (about their work, their company, or something from their profile).
- Option B: Start with a one-line observation—but phrase it in a completely different way (e.g. reference their role, a line from their bio, or their company—not "the update you shared").
- Option C: Start with a short fragment or a contrast (e.g. "Supply chain at Cemex—tough space to innovate in." or "Pohang's been on my radar for a while.").
- Option D: Dive straight into one specific detail with unexpected wording.
Use their first name (${lead.first_name}) only if it fits naturally—or omit it. The goal is this message could never be confused with another: different first sentence, different flow, different last sentence.

CLOSING: Do not repeat the same closer every time. Vary: a question, a soft "if you're ever up for it", a one-word sign-off, or an open-ended line. No "Let me know if you're up for a chat" or "Would love to chat more" as default—pick something that fits this message only.

PERSONALIZATION: TONE ${toneInstructions[tone]} | LENGTH ${lengthInstructions[length]} | FOCUS ${focusInstructions[focus]}

RULES:
1. One CONCRETE detail from their profile (quote from bio, specific post topic, or real role/company). If you mention a post or "product update", do NOT start the message with it—weave it in later or open with something else (question, role, company, or a different angle).
2. Why them—in one or two sentences. Then a brief, low-key ask. No over-the-top closing. Last sentence must be different from generic "Let me know if you're up for a chat" / "Would love to chat more."
3. ${campaign ? 'Weave in campaign goal only if it fits naturally.' : ''}
4. NO emojis. Output the FULL message as the reader will see it—no "Hi [Name]," prefix, no quotes.
```

**Enrichment context** (when available) is appended and includes:

- **Profile Bio** — full bio text (used for personalization).
- **Interests/Skills** — up to 8 items.
- **Recent Activity/Posts** — up to 3 items, each truncated (e.g. 200 chars).

**Campaign context** (when provided) includes: goal, type, description, target_audience.

**Tone / length / focus instructions (summary):**

| Option   | Values | Effect |
|----------|--------|--------|
| Tone     | professional, friendly, casual, formal, warm | Voice and formality |
| Length   | short (2–3 sentences, ~150–250 chars), medium (3–5, ~400–600), long (4–6, ~500–600) | Length and detail |
| Focus    | recent_post, company, role, mutual_connection, general | What to emphasize (post, company, role, mutuals, or balanced) |

**AI params:** `maxTokens` 150 (short) or 350 (medium/long), `temperature` 0.92. Output is trimmed to `maxLen` (300 for short, 600 otherwise) at sentence boundaries when needed.

---

## 3. Follow-up message prompt

**Used for:** LinkedIn follow-up messages (after connection or in sequence).

**Method:** `AIService.generateFollowUpMessage(lead, enrichment, previousMessages, options)`

**Options:** Same as connection request: `tone`, `length`, `focus`, and optional `campaign`.

**Prompt (template):**

```text
You're a real person writing a LinkedIn follow-up. You know this lead and what you said before. Write something that could only be for THIS person. Natural. Not "following up" in a formal way.

Lead: ${lead.full_name} | ${lead.title || 'N/A'} | ${lead.company || 'N/A'}${enrichmentContext}${campaignContext}

${previousMessages.length > 0 ? `What you already sent:\n${previousMessages.join('\n---\n')}\n\nBuild on it naturally—don't repeat it.` : ''}
${HUMAN_WRITER_BLOCK}

OPENING: Do NOT start with "Hi [Name]," or "Following up on my last message." Do NOT start with "That/the latest product update you shared" or "That/the post you shared" or any "[That/The] [thing] you shared". For THIS lead only, choose a UNIQUE first sentence:
- A question (about something they did or posted).
- A one-line observation phrased in a completely different way (e.g. their role, company, or a specific line from their bio—not "the update you shared").
- A short fragment or a new angle on their work.
Use their name (${lead.first_name}) only if it fits, or skip it. This message must have a different structure and different last line than any other—vary your closing too (question vs soft invite vs open-ended).

PERSONALIZATION: TONE ${toneInstructions[tone]} | LENGTH ${lengthInstructions[length]} | FOCUS ${focusInstructions[focus]}

REQUIREMENTS:
1. One SPECIFIC detail from their profile or activity. If you mention a post or "product update", do NOT start the message with it—weave it in later or open with a question, their role, or a different angle. Never "your recent post" without saying what it was.
2. Add a genuine point or value tied to that detail. Sound like you've thought about them.
3. ${campaign ? 'Tie to campaign only if natural.' : ''}
4. Vary structure and closing: different first sentence, different last sentence. Short sentences ok. Fragments ok. NO emojis.
5. Output the FULL message as sent—no "Hi [Name]," prefix, no quotes.
```

**Enrichment/campaign:** Same structure as connection request (bio, interests, recent posts; campaign goal/type/description/audience). Follow-up also receives **previous messages** so the model can build on them without repeating.

**AI params:** `maxTokens` 150 (short), 300 (medium), 400 (long); `temperature` 0.92. Output is trimmed to `maxLen` (300 / 600 / 800 by length) at sentence boundaries when needed.

---

## 4. How “personalized message” is generated (unified entry)

**Method:** `AIService.generatePersonalizedMessage(leadId, template, stepType, campaignContext)`

This is the main entry used by bulk flows (e.g. enrich + personalize, campaign message generation, approvals):

- **stepType === `'connection_request'`** → uses the **dynamic message** prompt (§ 2 — connection request).
- **stepType === `'message'` or `'follow_up'`** → uses the **follow-up** prompt (§ 3).

So:
- **Dynamic messages** (first touch, one per lead) → **§ 2 Connection request prompt**.
- **Follow-up messages** (later in sequence) → **§ 3 Follow-up prompt**.

Both use the same **HUMAN_WRITER_BLOCK** and personalization options (tone, length, focus).

---

## 5. Related prompts (same style, different channel)

- **Gmail draft** (`generateGmailDraft`): Same lead/enrichment/campaign and `HUMAN_WRITER_BLOCK`; asks for `SUBJECT:` on first line, then email body; tone/length maps similar to above.
- **Email failover** (`generateEmailFailover`): Short “real person” email after LinkedIn, one concrete detail, no “I hope this finds you well”.
- **Email outreach** (`generateEmailOutreach`): Cold email with one concrete detail and optional template; uses `HUMAN_WRITER_BLOCK`.
- **SMS** (`generateSMSOutreach`): One short line (max 160 chars), specific to them, casual, mention LinkedIn, one clear ask.

---

## 6. Where prompts are used in the app

| Feature / flow | Method / prompt |
|----------------|-----------------|
| Single lead: “Generate personalized” (connection note) | `generateConnectionRequest` |
| Single lead: follow-up step | `generateFollowUpMessage` |
| Bulk “Enrich & Personalize” (Leads tab) | `generatePersonalizedMessage` → connection or follow-up by step |
| Campaign: bulk generate messages / approvals | Same as above |
| Bulk Personalize (Campaign/Approvals) with tone/length/focus | Same prompts with user-selected options |
| Gmail draft generation (Leads with email) | `generateGmailDraft` |
| Email failover when LinkedIn has no reply | `generateEmailFailover` |

---

## 7. Source file

All prompts and `HUMAN_WRITER_BLOCK` live in:

**`backend/src/services/ai.service.js`**

- Lines ~56–69: `HUMAN_WRITER_BLOCK`
- Lines ~241–258: Connection request prompt
- Lines ~358–372: Follow-up message prompt
- Lines ~515–584: `generatePersonalizedMessage` (delegation + fallbacks)
- Additional methods: Gmail draft (~649–698), email failover (~594–601), email outreach (~622–634), SMS (~732–734)

AI provider is selected via `AI_PROVIDER` (OpenAI or Claude); if unset or on failure, the service returns non-AI fallback messages (e.g. “Your work at [company] caught my eye—would like to connect.”) so the user can still edit and send.

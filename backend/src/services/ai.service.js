import pool from '../db.js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import '../config/index.js'; // Ensure config is loaded

// AI_PROVIDER is read dynamically on each call so Settings page changes take effect immediately.
// Use the getter function getProvider() everywhere instead of a module-level const.
function getProvider() {
    return (process.env.AI_PROVIDER || 'openai').toLowerCase();
}
// Keep a readable alias for logging at startup
const AI_PROVIDER = getProvider();

// Initialize OpenAI client
// Initialize OpenAI client
const openaiKey = process.env.OPENAI_API_KEY || '';
let openai = null;
if (openaiKey) {
    try {
        openai = new OpenAI({ apiKey: openaiKey });
    } catch (e) {
        console.error('Failed to initialize OpenAI client:', e.message);
    }
}

// Initialize Anthropic (Claude) client
const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
let anthropic = null;
if (anthropicKey) {
    try {
        anthropic = new Anthropic({ apiKey: anthropicKey });
    } catch (e) {
        console.error('Failed to initialize Claude client:', e.message);
    }
}

// Log configuration status
console.log(`\n🤖 AI Configuration:`);
console.log(`   Primary Provider: ${AI_PROVIDER.toUpperCase()}`);

if (anthropic) {
    console.log(`   ✅ Claude API Key loaded`);
    console.log(`   Model: ${process.env.CLAUDE_MODEL || 'claude-sonnet-4-5'}`);
} else {
    console.log('   ⚪ Claude not configured');
}

if (openai) {
    console.log(`   ✅ OpenAI API Key loaded`);
    console.log(`   Model: ${process.env.OPENAI_MODEL || 'gpt-4o'}`);
} else {
    console.log('   ⚪ OpenAI not configured');
}
console.log('');

// ─── Human-like writing: avoid generic/template feel ─────────────────────────
const HUMAN_WRITER_BLOCK = `
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
`;

class AIService {
    /**
     * Check if ANY AI is configured
     */
    static isConfigured() {
        return !!openai || !!anthropic;
    }

    /**
     * Call AI API with automatic fallback.
     * Provider and model are read from process.env on every call, so Settings changes
     * apply globally across the entire CRM (campaigns, leads, content engine, SOW, etc.) without restart.
     */
    static async callAI(prompt, maxTokens = 300, temperature = 0.8) {
        const activeProvider = getProvider();
        let primary = activeProvider === 'claude' ? 'claude' : 'openai';
        let secondary = activeProvider === 'claude' ? 'openai' : 'claude';

        const executeCall = async (provider) => {
            if (provider === 'claude') {
                if (!anthropic) throw new Error('Claude not configured');
                console.log('   📡 Calling Claude API...');
                const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
                const response = await anthropic.messages.create({
                    model: model,
                    max_tokens: maxTokens,
                    temperature: temperature,
                    messages: [{ role: 'user', content: prompt }]
                });
                if (!response?.content?.[0]?.text) throw new Error('Invalid response from Claude');
                return response.content[0].text.trim();
            } else {
                if (!openai) throw new Error('OpenAI not configured');
                console.log('   📡 Calling OpenAI API...');
                const model = process.env.OPENAI_MODEL || 'gpt-4o';
                const response = await openai.chat.completions.create({
                    model: model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: temperature,
                    max_tokens: maxTokens
                });
                if (!response?.choices?.[0]?.message?.content) throw new Error('Invalid response from OpenAI');
                return response.choices[0].message.content.trim();
            }
        };

        try {
            // Try Primary
            return await executeCall(primary);
        } catch (error) {
            console.error(`⚠️ ${primary.toUpperCase()} failed: ${error.message}`);

            // Try Fallback
            if ((primary === 'claude' && openai) || (primary === 'openai' && anthropic)) {
                console.log(`   🔄 Falling back to ${secondary.toUpperCase()}...`);
                try {
                    const result = await executeCall(secondary);
                    console.log(`   ✅ ${secondary.toUpperCase()} fallback successful`);
                    return result;
                } catch (secondaryError) {
                    console.error(`❌ ${secondary.toUpperCase()} fallback also failed: ${secondaryError.message}`);
                    throw error; // Throw original error to trigger superior fallback (template)
                }
            } else {
                throw error;
            }
        }
    }

    /**
     * Personalization options for connection requests (human-selectable before send).
     * @param {Object} options
     * @param {string} [options.tone] - professional | friendly | casual | formal | warm
     * @param {string} [options.length] - short | medium | long
     * @param {string} [options.focus] - recent_post | company | role | mutual_connection | general
     */
    static getFallbackConnectionMessage(lead, enrichment = null) {
        if (enrichment && enrichment.bio) {
            const bioSnippet = (enrichment.bio || '').substring(0, 60);
            return `Saw your work at ${lead.company || 'your company'} and the bit about ${bioSnippet}${bioSnippet.length >= 60 ? '...' : ''} — would be great to connect.`;
        }
        return `Your work at ${lead.company || 'your company'} caught my eye—would like to connect.`;
    }

    /**
     * Generates a personalized connection request note (max 300 chars).
     * Supports optional personalization: tone, length, focus. On API/quota failure returns fallback so user can edit and send.
     * @param {Object} lead - Lead information
     * @param {Object} enrichment - Enriched profile data (optional)
     * @param {Object} options - Options including campaign context
     * @param {Object} options.campaign - Campaign details (goal, type, description, target_audience)
     */
    static async generateConnectionRequest(lead, enrichment = null, options = {}) {
        const tone = options.tone || 'professional';
        const length = options.length || 'medium';
        const focus = options.focus || 'general';
        const campaign = options.campaign || null;

        try {
            if (!this.isConfigured()) {
                console.warn('⚠️ AI not configured, using personalized template. Edit and send.');
                return this.getFallbackConnectionMessage(lead, enrichment);
            }

            // Build rich prompt with all available data
            let enrichmentContext = '';
            let hasEnrichmentData = false;

            if (enrichment) {
                hasEnrichmentData = true;
                if (enrichment.bio && enrichment.bio.trim().length > 0) {
                    enrichmentContext += `\n\nProfile Bio (USE THIS for personalization):\n${enrichment.bio}`;
                    console.log(`      Bio available: ${enrichment.bio.substring(0, 60)}...`);
                }
                if (enrichment.interests && Array.isArray(enrichment.interests) && enrichment.interests.length > 0) {
                    enrichmentContext += `\n\nInterests/Skills (REFERENCE THESE):\n${enrichment.interests.slice(0, 8).join(', ')}`;
                }
                if (enrichment.recent_posts && Array.isArray(enrichment.recent_posts) && enrichment.recent_posts.length > 0) {
                    enrichmentContext += `\n\nRecent Activity/Posts (MENTION IF RELEVANT):`;
                    enrichment.recent_posts.slice(0, 3).forEach((post, idx) => {
                        const postText = post.title || post.text || JSON.stringify(post);
                        enrichmentContext += `\n${idx + 1}. ${postText.substring(0, 200)}`;
                    });
                }
            }

            // Build campaign context
            let campaignContext = '';
            if (campaign) {
                campaignContext = '\n\nCAMPAIGN CONTEXT (ALIGN YOUR MESSAGE WITH THIS):';
                if (campaign.goal) {
                    campaignContext += `\n- Campaign Goal: ${campaign.goal}`;
                }
                if (campaign.type) {
                    campaignContext += `\n- Campaign Type: ${campaign.type}`;
                }
                if (campaign.description) {
                    campaignContext += `\n- Campaign Description: ${campaign.description}`;
                }
                if (campaign.target_audience) {
                    campaignContext += `\n- Target Audience: ${campaign.target_audience}`;
                }
                console.log(`      Campaign context: ${campaign.goal || 'N/A'} - ${campaign.type || 'N/A'}`);
            }

            const toneInstructions = {
                professional: 'Professional and polished. Respectful, clear, no slang.',
                friendly: 'Warm and approachable. Conversational but still professional.',
                casual: 'Relaxed and conversational. Slightly informal, human touch.',
                formal: 'Formal and businesslike. Best for senior/executive contacts.',
                warm: 'Warm and personable. Show genuine interest and enthusiasm.'
            };
            const lengthInstructions = {
                short: '2-3 sentences only. Target 150-250 characters. Be concise.',
                medium: '3-5 sentences. Target 400-600 characters. Balanced.',
                long: '4-6 sentences. Target 500-600 characters (LinkedIn limit). More detail.'
            };
            const focusInstructions = {
                recent_post: 'Reference or mention their recent post/activity if available. Show you saw it.',
                company: 'Focus on their company and role there. Why their company/industry interests you.',
                role: 'Focus on their job title and expertise. Tie to your shared domain.',
                mutual_connection: 'If you have mutual connections, you can reference shared context (keep it natural).',
                general: 'Use a mix of their bio, title, and company. Balanced personalization.'
            };

            const prompt = `You're a real person sending a LinkedIn connection note. You know this profile—write something that could only be for THIS person. Sound natural. Not like a template or "outreach."

Lead: ${lead.full_name} | ${lead.title || 'N/A'} | ${lead.company || 'N/A'}${enrichmentContext}${campaignContext}
${HUMAN_WRITER_BLOCK}

OPENING (important): Do NOT start with "Hi [Name],". Do NOT start with "That/the latest product update you shared" or "That/the post you shared" or any "[That/The] [thing] you shared"—those make every message look the same. For THIS person only, pick ONE opening style and make the first sentence unique:
- Option A: Start with a question (about their work, their company, or something from their profile).
- Option B: Start with a one-line observation—but phrase it in a completely different way (e.g. reference their role, a line from their bio, or their company—not "the update you shared").
- Option C: Start with a short fragment or a contrast (e.g. "Supply chain at Cemex—tough space to innovate in." or "Pohang's been on my radar for a while.").
- Option D: Dive straight into one specific detail with unexpected wording.
Use their first name (${lead.first_name}) only if it fits naturally—or omit it. The goal is this message could never be confused with another: different first sentence, different flow, different last sentence.

CLOSING: Do not repeat the same closer every time. Vary: a question, a soft "if you're ever up for it", a one-word sign-off, or an open-ended line. No "Let me know if you're up for a chat" or "Would love to chat more" as default—pick something that fits this message only.

PERSONALIZATION: TONE ${toneInstructions[tone] || toneInstructions.professional} | LENGTH ${lengthInstructions[length] || lengthInstructions.medium} | FOCUS ${focusInstructions[focus] || focusInstructions.general}

RULES:
1. One CONCRETE detail from their profile (quote from bio, specific post topic, or real role/company). If you mention a post or "product update", do NOT start the message with it—weave it in later or open with something else (question, role, company, or a different angle).
2. Why them—in one or two sentences. Then a brief, low-key ask. No over-the-top closing. Last sentence must be different from generic "Let me know if you're up for a chat" / "Would love to chat more."
3. ${campaign ? 'Weave in campaign goal only if it fits naturally.' : ''}
4. NO emojis. Output the FULL message as the reader will see it—no "Hi [Name]," prefix, no quotes.`;

            console.log(`   📡 Calling ${AI_PROVIDER.toUpperCase()} (tone=${tone}, length=${length}, focus=${focus})...`);

            let message = await this.callAI(prompt, length === 'short' ? 150 : 350, 0.92);

            if (!message || typeof message !== 'string') message = '';
            message = message.trim();
            // No forced "Hi first_name," — use AI output as-is for natural variety

            const maxLen = length === 'short' ? 300 : 600;
            if (message.length > maxLen) {
                const sentences = message.match(/[^.!?]+[.!?]+/g);
                if (sentences && sentences.length > 1) {
                    let truncated = '';
                    for (const s of sentences) {
                        if ((truncated + s).length <= maxLen - 3) truncated += s;
                        else break;
                    }
                    message = (truncated.trim() || message.substring(0, maxLen - 3)) + '...';
                } else {
                    message = message.substring(0, maxLen - 3) + '...';
                }
            }

            console.log(`   ✅ AI call successful (${message.length} chars)`);
            return message;
        } catch (error) {
            console.error('❌ AI Connection Request Error:', error.message);
            if (error.response) {
                console.error('AI API Response:', error.response.status, error.response.data);
            }
            if (error.code === 'insufficient_quota') {
                console.warn('   ⚠️ API quota exceeded. Returning fallback — edit and send.');
            } else if (error.message && (error.message.includes('API key') || error.message.includes('401') || error.message.includes('429'))) {
                console.warn('   ⚠️ API key or rate limit issue. Returning fallback — edit and send.');
            }
            return this.getFallbackConnectionMessage(lead, enrichment);
        }
    }

    /**
     * Generates a personalized follow-up message
     * @param {Object} lead - Lead information
     * @param {Object} enrichment - Enriched profile data (optional)
     * @param {Array} previousMessages - Previous messages sent to this lead
     * @param {Object} options - Personalization options including campaign context
     * @param {string} [options.tone] - professional | friendly | casual | formal | warm
     * @param {string} [options.length] - short | medium | long
     * @param {string} [options.focus] - recent_post | company | role | mutual_connection | general
     * @param {Object} [options.campaign] - Campaign details (goal, type, description, target_audience)
     */
    static async generateFollowUpMessage(lead, enrichment = null, previousMessages = [], options = {}) {
        const tone = options.tone || 'professional';
        const length = options.length || 'medium';
        const focus = options.focus || 'general';
        const campaign = options.campaign || null;

        try {
            if (!this.isConfigured()) {
                console.warn(`⚠️ ${AI_PROVIDER.toUpperCase()} not configured, using personalized template`);
                // Even without AI, use enrichment data to personalize
                if (enrichment && enrichment.bio) {
                    const bioSnippet = enrichment.bio.substring(0, 60);
                    return `That bit in your profile about ${bioSnippet}... resonated. Following up—would be good to chat.`;
                }
                return `Quick follow-up on my last message—would be great to connect when you're free.`;
            }

            // Build rich prompt with all available data
            let enrichmentContext = '';
            let hasEnrichmentData = false;

            if (enrichment) {
                hasEnrichmentData = true;
                if (enrichment.bio && enrichment.bio.trim().length > 0) {
                    enrichmentContext += `\n\nProfile Bio (USE THIS for personalization):\n${enrichment.bio}`;
                    console.log(`      Bio available: ${enrichment.bio.substring(0, 60)}...`);
                }
                if (enrichment.interests && Array.isArray(enrichment.interests) && enrichment.interests.length > 0) {
                    enrichmentContext += `\n\nInterests/Skills (REFERENCE THESE):\n${enrichment.interests.slice(0, 10).join(', ')}`;
                    console.log(`      Interests: ${enrichment.interests.slice(0, 5).join(', ')}`);
                }
                if (enrichment.recent_posts && Array.isArray(enrichment.recent_posts) && enrichment.recent_posts.length > 0) {
                    enrichmentContext += `\n\nRecent Activity/Posts (MENTION IF RELEVANT):`;
                    enrichment.recent_posts.slice(0, 3).forEach((post, idx) => {
                        const postText = post.title || post.text || JSON.stringify(post);
                        enrichmentContext += `\n${idx + 1}. ${postText.substring(0, 250)}`;
                    });
                    console.log(`      Recent posts: ${enrichment.recent_posts.length} items`);
                }
            }

            if (!hasEnrichmentData || enrichmentContext.trim().length === 0) {
                console.log(`      ⚠️  No enrichment data available - will use basic lead info only`);
            }

            // Build campaign context
            let campaignContext = '';
            if (campaign) {
                campaignContext = '\n\nCAMPAIGN CONTEXT (ALIGN YOUR MESSAGE WITH THIS):';
                if (campaign.goal) {
                    campaignContext += `\n- Campaign Goal: ${campaign.goal}`;
                }
                if (campaign.type) {
                    campaignContext += `\n- Campaign Type: ${campaign.type}`;
                }
                if (campaign.description) {
                    campaignContext += `\n- Campaign Description: ${campaign.description}`;
                }
                if (campaign.target_audience) {
                    campaignContext += `\n- Target Audience: ${campaign.target_audience}`;
                }
                console.log(`      Campaign context: ${campaign.goal || 'N/A'} - ${campaign.type || 'N/A'}`);
            }

            const toneInstructions = {
                professional: 'Professional and polished. Respectful, clear, no slang.',
                friendly: 'Warm and approachable. Conversational but still professional.',
                casual: 'Relaxed and conversational. Slightly informal, human touch.',
                formal: 'Formal and businesslike. Best for senior/executive contacts.',
                warm: 'Warm and personable. Show genuine interest and enthusiasm.'
            };
            const lengthInstructions = {
                short: '2-3 sentences only. Target 150-250 characters. Be concise.',
                medium: '3-5 sentences. Target 400-600 characters. Balanced.',
                long: '4-6 sentences. Target 500-800 characters. More detail.'
            };
            const focusInstructions = {
                recent_post: 'Reference or mention their recent post/activity if available. Show you saw it.',
                company: 'Focus on their company and role there. Why their company/industry interests you.',
                role: 'Focus on their job title and expertise. Tie to your shared domain.',
                mutual_connection: 'If you have mutual connections, you can reference shared context (keep it natural).',
                general: 'Use a mix of their bio, title, and company. Balanced personalization.'
            };

            const prompt = `You're a real person writing a LinkedIn follow-up. You know this lead and what you said before. Write something that could only be for THIS person. Natural. Not "following up" in a formal way.

Lead: ${lead.full_name} | ${lead.title || 'N/A'} | ${lead.company || 'N/A'}${enrichmentContext}${campaignContext}

${previousMessages.length > 0 ? `What you already sent:\n${previousMessages.join('\n---\n')}\n\nBuild on it naturally—don't repeat it.` : ''}
${HUMAN_WRITER_BLOCK}

OPENING: Do NOT start with "Hi [Name]," or "Following up on my last message." Do NOT start with "That/the latest product update you shared" or "That/the post you shared" or any "[That/The] [thing] you shared". For THIS lead only, choose a UNIQUE first sentence:
- A question (about something they did or posted).
- A one-line observation phrased in a completely different way (e.g. their role, company, or a specific line from their bio—not "the update you shared").
- A short fragment or a new angle on their work.
Use their name (${lead.first_name}) only if it fits, or skip it. This message must have a different structure and different last line than any other—vary your closing too (question vs soft invite vs open-ended).

PERSONALIZATION: TONE ${toneInstructions[tone] || toneInstructions.professional} | LENGTH ${lengthInstructions[length] || lengthInstructions.medium} | FOCUS ${focusInstructions[focus] || focusInstructions.general}

REQUIREMENTS:
1. One SPECIFIC detail from their profile or activity. If you mention a post or "product update", do NOT start the message with it—weave it in later or open with a question, their role, or a different angle. Never "your recent post" without saying what it was.
2. Add a genuine point or value tied to that detail. Sound like you've thought about them.
3. ${campaign ? 'Tie to campaign only if natural.' : ''}
4. Vary structure and closing: different first sentence, different last sentence. Short sentences ok. Fragments ok. NO emojis.
5. Output the FULL message as sent—no "Hi [Name]," prefix, no quotes.`;

            console.log(`   📡 Calling ${AI_PROVIDER.toUpperCase()} API (follow-up message, tone=${tone}, length=${length}, focus=${focus})...`);
            console.log(`      Enrichment data available: ${enrichment ? 'Yes' : 'No'}`);

            const maxTokens = length === 'short' ? 150 : length === 'long' ? 400 : 300;
            let message = await this.callAI(prompt, maxTokens, 0.92);

            // No forced "Hi first_name," — use AI output as-is for natural variety
            if (!message || typeof message !== 'string') message = '';
            message = message.trim();
            const maxLen = length === 'short' ? 300 : length === 'long' ? 800 : 600;
            if (message.length > maxLen) {
                // Try to cut at sentence boundary
                const sentences = message.match(/[^.!?]+[.!?]+/g);
                if (sentences && sentences.length > 1) {
                    let truncated = '';
                    for (const sentence of sentences) {
                        if ((truncated + sentence).length <= maxLen - 3) {
                            truncated += sentence;
                        } else {
                            break;
                        }
                    }
                    message = truncated.trim() || message.substring(0, maxLen - 3) + '...';
                } else {
                    message = message.substring(0, maxLen - 3) + '...';
                }
            }

            console.log(`   ✅ AI call successful (${message.length} chars)`);
            return message;
        } catch (error) {
            console.error('❌ AI Follow-up Message Error:', error.message);
            if (error.response) {
                console.error('AI API Response Error:', error.response.status, error.response.data);
            }
            if (error.code) {
                console.error('AI API Error Code:', error.code);
                if (error.code === 'insufficient_quota') {
                    throw new Error('AI API quota exceeded. Please check your account billing.');
                }
            }
            // Return fallback message (natural, no forced "Hi")
            return `Quick follow-up—saw your stuff on ${lead.company || 'their company'}. Would be good to connect when you have a sec.`;
        }
    }

    /**
     * Generates a thought-leadership LinkedIn post from an article.
     * @param {Object} article - { original_title, source_url, summary }
     * @param {Object} [options] - Optional content-engine context: { persona, industry, objective, ctaText }
     */
    static async generateThoughtLeadershipPost(article, options = null) {
        try {
            if (!this.isConfigured()) {
                console.warn(`⚠️ ${AI_PROVIDER.toUpperCase()} not configured, using template`);
                return `Interesting article: ${article.original_title}\n\n${article.source_url}\n\n#Leadership #Industry`;
            }

            const persona = options?.persona || '';
            const industry = options?.industry || '';
            const objective = options?.objective || 'thought_leadership';
            const ctaText = options?.ctaText || '';

            let contextBlock = '';
            if (persona || industry || objective) {
                contextBlock = '\n\nAudience/context (write in this voice, do not list these):';
                if (persona) contextBlock += ` Persona: ${persona}.`;
                if (industry) contextBlock += ` Industry: ${industry}.`;
                if (objective) contextBlock += ` Objective: ${objective}.`;
            }

            const prompt = `Write a LinkedIn post that sounds like a real person sharing their perspective—not a brand or a bot. You have actually read/understood the source and have a genuine point of view.

Article/source: ${article.original_title}
${article.source_url ? `URL: ${article.source_url}` : ''}
${article.summary ? `Summary: ${article.summary}` : ''}${contextBlock}

HUMAN VOICE RULES:
- Write as yourself: one professional with a clear opinion. Use "I" and concrete points. No corporate filler ("leverage", "synergy", "drive value", "game-changing").
- Vary structure: don't use the same opening every time (e.g. avoid always "I've been thinking about..."). Surprise the reader with a sharp first line when possible.
- Be specific about the topic—reference real details from the article/source, not vague "recent developments."
- 200-300 words. End with 3-5 relevant hashtags. No emojis in the body unless they fit naturally.
${ctaText ? `\nInclude this CTA naturally in the post (weave it in, don't paste at the end): ${ctaText}` : ''}

Output ONLY the post text. No quotes or extra formatting.`;

            return await this.callAI(prompt, 500, 0.85);
        } catch (error) {
            console.error('❌ AI Post Generation Error:', error.message);
            return `Interesting insights from this article: ${article.original_title}\n\nRead more: ${article.source_url}\n\n#Industry #Insights`;
        }
    }

    /**
     * Generates a personalized message based on lead data and template
     * (Legacy method - enhanced with real AI)
     * @param {number} leadId - Lead ID
     * @param {string} template - Template string (optional)
     * @param {string} stepType - Step type (connection_request, message, follow_up)
     * @param {Object} campaignContext - Campaign context (optional)
     */
    static async generatePersonalizedMessage(leadId, template, stepType = 'message', campaignContext = null) {
        try {
            // 1. Fetch Lead & Enrichment Data
            const leadResult = await pool.query("SELECT * FROM leads WHERE id = $1", [leadId]);
            const lead = leadResult.rows[0];

            if (!lead) {
                throw new Error('Lead not found');
            }

            const enrichmentResult = await pool.query("SELECT * FROM lead_enrichment WHERE lead_id = $1", [leadId]);
            const enrichment = enrichmentResult.rows[0];

            console.log(`   📋 Generating ${stepType} for: ${lead.first_name} ${lead.last_name}`);
            console.log(`      Enrichment: ${enrichment ? 'Available' : 'Not available'}`);
            console.log(`      Campaign context: ${campaignContext ? 'Available' : 'Not available'}`);
            console.log(`      AI Provider: ${this.isConfigured() ? AI_PROVIDER.toUpperCase() : 'Not configured (using template)'}`);

            // 2. Use AI based on step type
            let message = '';
            try {
                const options = campaignContext ? { campaign: campaignContext } : {};
                if (stepType === 'connection_request') {
                    message = await this.generateConnectionRequest(lead, enrichment, options);
                } else if (stepType === 'message' || stepType === 'follow_up') {
                    message = await this.generateFollowUpMessage(lead, enrichment, [], options);
                } else {
                    // Fallback to template replacement
                    message = template || '';
                    message = message.replace(/\{firstName\}/g, lead.first_name || "there");
                    message = message.replace(/\{lastName\}/g, lead.last_name || "");
                    message = message.replace(/\{fullName\}/g, lead.full_name || "there");
                    message = message.replace(/\{company\}/g, lead.company || "your company");
                    message = message.replace(/\{title\}/g, lead.title || "your role");
                }
            } catch (aiError) {
                console.error(`❌ Error during AI generation for ${stepType}:`, aiError.message);
                // Continue to fallback below
            }

            // Ensure we always return a message
            if (!message || message.trim().length === 0) {
                console.warn(`⚠️ Generated empty message, using fallback`);
                if (stepType === 'connection_request') {
                    message = `Your work at ${lead.company || 'your company'} caught my eye—would like to connect.`;
                } else {
                    message = `Quick follow-up—would be good to connect when you have a sec.`;
                }
            }

            console.log(`   ✅ Generated message (${message.length} chars)`);
            return message;
        } catch (error) {
            console.error("❌ AI Generation Error:", error.message);
            console.error("Error stack:", error.stack);

            // Always return a fallback message
            const leadResult = await pool.query("SELECT * FROM leads WHERE id = $1", [leadId]);
            const lead = leadResult.rows[0];

            if (stepType === 'connection_request') {
                return `Your work at ${lead?.company || 'their company'} caught my eye—would like to connect.`;
            } else {
                return `Quick follow-up—would be good to connect when you have a sec.`;
            }
        }
    }

    /**
     * Generate email content for failover
     */
    static async generateEmailFailover(lead, enrichment = null, linkedinMessages = []) {
        try {
            if (!this.isConfigured()) {
                return `Saw your profile—would be good to connect. Quick note via email since LinkedIn's been quiet. Best`;
            }

            const prompt = `You're a real person following up via email after LinkedIn. You know their name, role, company. Write a short email that feels like a human wrote it.

Lead: ${lead.full_name}, ${lead.title || 'N/A'} at ${lead.company || 'N/A'}
Context: You tried LinkedIn first; no reply. This is a brief, respectful email.

RULES: Sound like one person emailing another. One concrete detail about them so it's not bulk. Don't start with "I hope this finds you well" or "I wanted to follow up"—start with something specific or direct. 150-200 words. Clear CTA. No emojis. Output ONLY the email body.`;

            return await this.callAI(prompt, 300, 0.85);
        } catch (error) {
            console.error('❌ AI Email Generation Error:', error.message);
            return `Saw your profile—would be good to connect. Quick note via email since LinkedIn's been quiet. Best`;
        }
    }

    /**
     * Generate personalized email outreach (direct email, not failover)
     */
    async generateEmailOutreach(lead, enrichment = null, template = null) {
        try {
            // Build context about the lead
            let context = `Lead: ${lead.first_name} ${lead.last_name}
Title: ${lead.title || 'Unknown'}
Company: ${lead.company || 'Unknown'}`;

            if (enrichment) {
                if (enrichment.bio) context += `\nBio: ${enrichment.bio}`;
                if (enrichment.interests?.length > 0) {
                    context += `\nInterests: ${enrichment.interests.join(', ')}`;
                }
            }

            const prompt = `You're a real person writing a cold email to ${lead.first_name}. You know specific things about them. Write something that could only be for this person.

${context}
${HUMAN_WRITER_BLOCK}

RULES: One CONCRETE detail from their profile. Don't start with "I came across your profile" or "I was impressed by"—start with something specific or a question. Conversational. 120-180 words. One CTA. Mention you found their contact and wanted to reach out. ${template ? `Style (don't copy): ${template}` : ''} Output ONLY the email body.`;

            return await this.callAI(prompt, 300, 0.88);
        } catch (error) {
            console.error('❌ AI Email Outreach Generation Error:', error.message);
            return `Saw your work at ${lead.company || 'your company'}—would be good to connect. Open to a quick chat when you're free. Best`;
        }
    }

    /**
     * Generate a Gmail/email draft with subject line and longer body (for approval queue).
     * Returns { subject, body } for use in gmail_outreach step_type.
     * @param {Object} lead - Lead information
     * @param {Object} enrichment - Enriched profile data (optional)
     * @param {Object} options - { tone, length, focus, campaign }
     */
    static async generateGmailDraft(lead, enrichment = null, options = {}) {
        const tone = options.tone || 'professional';
        const length = options.length || 'medium';
        const focus = options.focus || 'general';
        const campaign = options.campaign || null;

        try {
            if (!this.isConfigured()) {
                const fallbackSubject = `Quick thought for ${lead.first_name}`;
                const fallbackBody = `Saw your work at ${lead.company || 'your company'}—would be good to connect.\n\n[Add your note here.]\n\nBest`;
                return { subject: fallbackSubject, body: fallbackBody };
            }

            let enrichmentContext = '';
            if (enrichment) {
                if (enrichment.bio?.trim()) enrichmentContext += `\nProfile Bio:\n${enrichment.bio}`;
                if (enrichment.interests?.length) enrichmentContext += `\nInterests: ${enrichment.interests.slice(0, 8).join(', ')}`;
                if (enrichment.recent_posts?.length) {
                    enrichmentContext += '\nRecent activity (mention if relevant):';
                    enrichment.recent_posts.slice(0, 3).forEach((p, i) => {
                        const t = p.title || p.text || JSON.stringify(p);
                        enrichmentContext += `\n${i + 1}. ${t.substring(0, 180)}`;
                    });
                }
            }

            let campaignContext = '';
            if (campaign) {
                campaignContext = '\nCampaign context (align with this):';
                if (campaign.goal) campaignContext += ` Goal: ${campaign.goal}`;
                if (campaign.type) campaignContext += ` | Type: ${campaign.type}`;
                if (campaign.description) campaignContext += ` | ${campaign.description}`;
            }

            const toneMap = {
                professional: 'Professional and polished, no slang.',
                friendly: 'Warm and approachable, conversational.',
                casual: 'Relaxed and conversational.',
                formal: 'Formal and businesslike.',
                warm: 'Warm and personable, genuine interest.'
            };
            const lengthMap = {
                short: 'Body: 120-180 words. Subject: concise, under 60 characters.',
                medium: 'Body: 180-280 words. Subject: clear, under 80 characters.',
                long: 'Body: 280-400 words. Subject: descriptive, under 100 characters.'
            };

            const prompt = `You're a real person writing an email to a prospect. You know specific things about them. Write something that could only be for THIS person. Natural—not a template.

Lead: ${lead.full_name} | ${lead.title || 'N/A'} | ${lead.company || 'N/A'}${enrichmentContext}${campaignContext}
${HUMAN_WRITER_BLOCK}

OPENING: Do NOT default to "Hi [Name],". Do NOT start with "That/the latest product update you shared" or "That/the post you shared" or any "[That/The] [thing] you shared". Use a UNIQUE first line: a question, a direct observation (different wording), or dive in. Use "Hey ${lead.first_name}" or "Hi ${lead.first_name}" only if it fits. Vary your closing too—different sign-off or CTA per message.

REQUIREMENTS: TONE ${toneMap[tone] || toneMap.professional} | LENGTH ${lengthMap[length] || lengthMap.medium}. One CONCRETE detail from their profile (weave it in, don't open with "the thing you shared"). Campaign context only if natural.

OUTPUT FORMAT (strict):
1. First line: SUBJECT: <your subject line>
2. Blank line.
3. Full email body. Any greeting you choose (or none). Paragraphs. Sign off naturally (e.g. Best, Thanks, —[name]). No "Subject:" in body—only SUBJECT: on first line. Body 150-350 words depending on length.`;

            console.log(`   📡 Calling ${AI_PROVIDER.toUpperCase()} (Gmail draft, tone=${tone}, length=${length})...`);
            const maxTokens = length === 'long' ? 650 : length === 'short' ? 350 : 500;
            const raw = await this.callAI(prompt, maxTokens, 0.9);
            if (!raw || typeof raw !== 'string') {
                throw new Error('Invalid AI response');
            }

            const subjectMatch = raw.match(/^\s*SUBJECT:\s*(.+?)(?:\n|$)/im);
            const subject = subjectMatch ? subjectMatch[1].trim() : `Quick thought for ${lead.first_name}`;
            let body = raw;
            if (subjectMatch) {
                body = raw.slice(raw.indexOf('\n')).replace(/^\s*\n?/, '').trim();
            }
            if (body.length > 4000) body = body.substring(0, 3997) + '...';

            console.log(`   ✅ Gmail draft generated (subject: ${subject.length} chars, body: ${body.length} chars)`);
            return { subject, body };
        } catch (error) {
            console.error('❌ AI Gmail Draft Error:', error.message);
            return {
                subject: `Quick thought for ${lead.first_name}`,
                body: `Saw your work at ${lead.company || 'your company'} and wanted to reach out.\n\n[Add your note here—keep it short and natural.]\n\nBest`
            };
        }
    }

    /**
     * Generate personalized SMS message (max 160 chars)
     */
    async generateSMSOutreach(lead, enrichment = null) {
        try {
            const prompt = `Short SMS to ${lead.first_name} (${lead.title || 'pro'} at ${lead.company || 'their company'}). Reference something specific about them. Max 160 chars. Casual, not salesy. Mention LinkedIn. One clear ask. Output ONLY the SMS text.`;

            const result = await this.callAI(prompt, 50, 0.9);
            // Ensure it's under 160 chars
            return result.substring(0, 160);
        } catch (error) {
            console.error('❌ AI SMS Generation Error:', error.message);
            return `Saw your profile—would be good to connect. Free for a quick chat?`;
        }
    }
}

export default AIService;

/**
 * Content Engine Service V2
 * Campaign Publishing Flow:
 * IDEA → DRAFT → REVIEW → APPROVED → SCHEDULED → POSTED
 *
 * Integrates with:
 *   - AI Service (Claude) for content generation
 *   - PhantomBuster LinkedIn Auto Poster for publishing
 *
 * NO engagement scraping, NO auto-DM, NO CRM syncing
 */

import pool from '../db.js';
import AIService from './ai.service.js';

// ─── VALID STATE TRANSITIONS ─────────────────────────────────────────────────
const VALID_TRANSITIONS = {
    IDEA: ['DRAFT', 'APPROVED'],   // APPROVED = direct approve from modal
    DRAFT: ['REVIEW', 'IDEA', 'APPROVED'],
    REVIEW: ['APPROVED', 'DRAFT'],
    APPROVED: ['SCHEDULED', 'REVIEW'],
    SCHEDULED: ['POSTED', 'APPROVED'],  // APPROVED allows retry re-schedule
    POSTED: [],                          // terminal state
};

function validateTransition(from, to) {
    const allowed = VALID_TRANSITIONS[from] || [];
    if (!allowed.includes(to)) {
        throw new Error(
            `Invalid transition: ${from} → ${to}. Allowed next states: ${allowed.join(', ') || 'none (terminal)'}`
        );
    }
}

// ─── CONTENT SOURCES ─────────────────────────────────────────────────────────
export const ContentSourceService = {
    async getAll() {
        const res = await pool.query(
            'SELECT * FROM content_sources ORDER BY created_at DESC'
        );
        return res.rows;
    },

    async create(data) {
        const { name, type = 'manual', url, keywords, industry_tag, persona_tag, active = true } = data;
        const res = await pool.query(
            `INSERT INTO content_sources (name, type, url, keywords, industry_tag, persona_tag, active)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name, type, url || null, keywords || null, industry_tag || null, persona_tag || null, active]
        );
        return res.rows[0];
    },

    async update(id, data) {
        const { name, type, url, keywords, industry_tag, persona_tag, active } = data;
        const res = await pool.query(
            `UPDATE content_sources SET
                name = COALESCE($1, name),
                type = COALESCE($2, type),
                url = COALESCE($3, url),
                keywords = COALESCE($4, keywords),
                industry_tag = COALESCE($5, industry_tag),
                persona_tag = COALESCE($6, persona_tag),
                active = COALESCE($7, active),
                updated_at = NOW()
             WHERE id = $8 RETURNING *`,
            [name, type, url, keywords, industry_tag, persona_tag, active, id]
        );
        return res.rows[0];
    },

    async delete(id) {
        await pool.query('DELETE FROM content_sources WHERE id = $1', [id]);
        return { success: true };
    }
};

// ─── CTA TEMPLATES ───────────────────────────────────────────────────────────
export const CtaTemplateService = {
    async getAll() {
        const res = await pool.query('SELECT * FROM cta_templates ORDER BY id ASC');
        return res.rows;
    },

    async create(data) {
        const { name, template_text } = data;
        const res = await pool.query(
            'INSERT INTO cta_templates (name, template_text) VALUES ($1, $2) RETURNING *',
            [name, template_text]
        );
        return res.rows[0];
    }
};

// ─── CONTENT ITEMS (PIPELINE) ─────────────────────────────────────────────────
export const ContentItemService = {

    /** Get all items with optional filters */
    async getAll({ status, persona, industry, objective, source_id } = {}) {
        const conditions = [];
        const params = [];
        let idx = 1;

        if (status && status !== 'ALL') {
            conditions.push(`ci.status = $${idx++}`);
            params.push(status);
        }
        if (persona) {
            conditions.push(`ci.persona ILIKE $${idx++}`);
            params.push(`%${persona}%`);
        }
        if (industry) {
            conditions.push(`ci.industry ILIKE $${idx++}`);
            params.push(`%${industry}%`);
        }
        if (objective) {
            conditions.push(`ci.objective = $${idx++}`);
            params.push(objective);
        }
        if (source_id) {
            conditions.push(`ci.source_id = $${idx++}`);
            params.push(parseInt(source_id));
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const res = await pool.query(
            `SELECT ci.*,
                    cs.name AS source_name,
                    ct.name AS cta_name,
                    ct.template_text AS cta_template_text
             FROM content_items ci
             LEFT JOIN content_sources cs ON ci.source_id = cs.id
             LEFT JOIN cta_templates ct ON ci.cta_type = ct.id
             ${where}
             ORDER BY ci.created_at DESC`,
            params
        );
        return res.rows;
    },

    async getById(id) {
        const res = await pool.query(
            `SELECT ci.*,
                    cs.name AS source_name,
                    ct.name AS cta_name,
                    ct.template_text AS cta_template_text
             FROM content_items ci
             LEFT JOIN content_sources cs ON ci.source_id = cs.id
             LEFT JOIN cta_templates ct ON ci.cta_type = ct.id
             WHERE ci.id = $1`,
            [id]
        );
        return res.rows[0] || null;
    },

    /**
     * AI Generation Flow:
     * User selects persona, industry, objective, CTA type
     * → Backend generates LinkedIn-ready post
     * → Applies CTA template
     * → Saves as IDEA
     * Supports: existing content_sources (source_id), or inline news article (source_url/source_title/source_summary).
     */
    async generateIdea({ source_id, persona, industry, objective, cta_type_id, topic, source_title, source_url, source_summary }) {
        console.log(`🤖 ContentEngine: Generating IDEA for persona=${persona}, industry=${industry}, objective=${objective}`);

        let effectiveSourceId = source_id || null;
        let effectiveSourceTitle = source_title || null;
        let effectiveSourceUrl = source_url || null;
        let effectiveSourceSummary = source_summary || null;

        // If inline news article data provided, create or reuse a news_article content source and link to it
        if (effectiveSourceUrl && !effectiveSourceId) {
            const name = effectiveSourceTitle || 'News Article';
            const created = await ContentSourceService.create({
                name: name.substring(0, 255),
                type: 'news_article',
                url: effectiveSourceUrl,
                active: true
            });
            effectiveSourceId = created.id;
            effectiveSourceTitle = effectiveSourceTitle || name;
        }
        // If only source_id provided, load source to get url/title for the AI prompt
        else if (effectiveSourceId) {
            const res = await pool.query('SELECT id, name, url FROM content_sources WHERE id = $1', [effectiveSourceId]);
            const row = res.rows[0];
            if (row) {
                effectiveSourceTitle = effectiveSourceTitle || row.name || null;
                effectiveSourceUrl = effectiveSourceUrl || row.url || null;
            }
        }

        // Fetch CTA template
        let ctaText = '';
        if (cta_type_id) {
            const ctaRes = await pool.query('SELECT * FROM cta_templates WHERE id = $1', [cta_type_id]);
            if (ctaRes.rows[0]) ctaText = ctaRes.rows[0].template_text;
        }

        // Build AI prompt context
        const topicContext = topic || effectiveSourceTitle || 'industry trends';
        const promptData = {
            original_title: topicContext,
            source_url: effectiveSourceUrl || '',
            summary: effectiveSourceSummary || `A LinkedIn post for ${persona} in ${industry} focused on ${objective}`
        };

        let generatedContent = '';
        try {
            if (AIService.isConfigured()) {
                const rawPost = await AIService.generateThoughtLeadershipPost(promptData, {
                    persona,
                    industry,
                    objective,
                    ctaText
                });
                generatedContent = rawPost;
            } else {
                // Fallback template when AI not configured
                generatedContent = [
                    `🚀 ${topicContext}`,
                    '',
                    `As a professional in ${industry}, I've been thinking about this topic deeply.`,
                    '',
                    `${objective === 'thought_leadership' ? 'Here\'s my perspective:' : 'Key insights:'}`,
                    `• Point 1 about ${topicContext}`,
                    `• Point 2 connecting to ${industry} trends`,
                    `• Point 3 with actionable takeaway`,
                    '',
                    ctaText || `What are your thoughts? Let me know below! 👇`,
                    '',
                    `#${industry.replace(/\s+/g, '')} #LinkedIn #${objective}`
                ].join('\n');
            }
        } catch (aiError) {
            console.error('AI generation failed, using template:', aiError.message);
            generatedContent = `[AI generation failed - please edit this content]\n\nTopic: ${topicContext}\nPersona: ${persona}\nIndustry: ${industry}\n\n${ctaText}`;
        }

        // Append CTA if not already included
        if (ctaText && !generatedContent.includes(ctaText)) {
            generatedContent = `${generatedContent}\n\n${ctaText}`;
        }

        const res = await pool.query(
            `INSERT INTO content_items 
                (source_id, title, generated_content, edited_content, persona, industry, objective, cta_type, status)
             VALUES ($1, $2, $3, $3, $4, $5, $6, $7, 'IDEA') RETURNING *`,
            [effectiveSourceId, topicContext, generatedContent, persona, industry, objective, cta_type_id || null]
        );

        await this._logTransition(res.rows[0].id, null, 'IDEA', 'Created via AI generation');
        console.log(`✅ ContentEngine: IDEA created with id=${res.rows[0].id}`);
        return res.rows[0];
    },

    /** Update edited content (without status change) */
    async updateContent(id, editedContent) {
        const res = await pool.query(
            `UPDATE content_items SET edited_content = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [editedContent, id]
        );
        return res.rows[0];
    },

    /**
     * Transition state machine - enforces strict rules
     */
    async transition(id, toStatus, options = {}) {
        const item = await this.getById(id);
        if (!item) throw new Error(`Content item ${id} not found`);

        const fromStatus = item.status;
        validateTransition(fromStatus, toStatus);

        const updates = { status: toStatus, updated_at: 'NOW()' };
        const params = [toStatus, id];
        let idx = 3;

        // Only APPROVED content can be moved to SCHEDULED
        if (toStatus === 'SCHEDULED') {
            if (!options.scheduled_at) throw new Error('scheduled_at is required to schedule content');
            const scheduledAt = new Date(options.scheduled_at);
            if (scheduledAt <= new Date()) throw new Error('scheduled_at must be in the future');
            params.splice(1, 0, scheduledAt.toISOString());
            const res = await pool.query(
                `UPDATE content_items SET status = $1, scheduled_at = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
                params
            );
            await this._logTransition(id, fromStatus, toStatus, `Scheduled for ${scheduledAt.toISOString()}`);
            return res.rows[0];
        }

        const res = await pool.query(
            `UPDATE content_items SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [toStatus, id]
        );
        await this._logTransition(id, fromStatus, toStatus, options.note || null);
        return res.rows[0];
    },

    /** Create a manual item (without AI) */
    async createManual(data) {
        const { source_id, title, content, persona, industry, objective, cta_type_id } = data;
        const res = await pool.query(
            `INSERT INTO content_items
                (source_id, title, generated_content, edited_content, persona, industry, objective, cta_type, status)
             VALUES ($1, $2, $3, $3, $4, $5, $6, $7, 'IDEA') RETURNING *`,
            [source_id || null, title || 'Untitled', content || '', persona || null, industry || null, objective || null, cta_type_id || null]
        );
        await this._logTransition(res.rows[0].id, null, 'IDEA', 'Created manually');
        return res.rows[0];
    },

    async delete(id) {
        await pool.query('DELETE FROM content_items WHERE id = $1', [id]);
        return { success: true };
    },

    async _logTransition(itemId, from, to, note) {
        try {
            await pool.query(
                `INSERT INTO content_item_history (content_item_id, from_status, to_status, note)
                 VALUES ($1, $2, $3, $4)`,
                [itemId, from, to, note]
            );
        } catch (e) {
            console.warn('History log failed (non-critical):', e.message);
        }
    },

    async getHistory(id) {
        const res = await pool.query(
            `SELECT * FROM content_item_history WHERE content_item_id = $1 ORDER BY created_at ASC`,
            [id]
        );
        return res.rows;
    }
};

// ─── PHANTOM INTEGRATION SERVICE ─────────────────────────────────────────────
export const ContentPhantomService = {

    /**
     * Send approved+scheduled content to LinkedIn Auto Poster Phantom.
     * Called by the scheduler or manually.
     *
     * Only SCHEDULED items with scheduled_at <= now are processed.
     * On success: status → POSTED, saves post_url and posted_at
     * On failure: status stays SCHEDULED, logs error_message
     */
    async processScheduledItems() {
        const now = new Date();
        const res = await pool.query(
            `SELECT * FROM content_items
             WHERE status = 'SCHEDULED'
               AND scheduled_at <= $1
             ORDER BY scheduled_at ASC`,
            [now.toISOString()]
        );

        const items = res.rows;
        if (items.length === 0) {
            console.log('📅 ContentEngine Scheduler: No items due for posting.');
            return { processed: 0 };
        }

        console.log(`📅 ContentEngine Scheduler: ${items.length} item(s) due for posting.`);

        const results = { processed: 0, success: 0, failed: 0, details: [] };

        for (const item of items) {
            try {
                const result = await this._sendToPhantom(item);
                await pool.query(
                    `UPDATE content_items SET
                        status = 'POSTED',
                        posted_at = NOW(),
                        post_url = $1,
                        phantom_container_id = $2,
                        error_message = NULL,
                        updated_at = NOW()
                     WHERE id = $3`,
                    [result.postUrl || null, result.containerId || null, item.id]
                );
                await ContentItemService._logTransition(item.id, 'SCHEDULED', 'POSTED', `Phantom container: ${result.containerId}`);
                results.success++;
                results.details.push({ id: item.id, status: 'posted', containerId: result.containerId });
                console.log(`✅ ContentEngine: Item ${item.id} posted via Phantom`);
            } catch (err) {
                // Keep as SCHEDULED but log error - allows retry
                await pool.query(
                    `UPDATE content_items SET error_message = $1, updated_at = NOW() WHERE id = $2`,
                    [err.message, item.id]
                );
                results.failed++;
                results.details.push({ id: item.id, status: 'failed', error: err.message });
                console.error(`❌ ContentEngine: Item ${item.id} failed:`, err.message);
            }
            results.processed++;
        }

        return results;
    },

    /** Manually trigger a single item to be sent to Phantom (must be APPROVED or SCHEDULED) */
    async sendNow(itemId) {
        const item = await ContentItemService.getById(itemId);
        if (!item) throw new Error('Content item not found');
        if (!['APPROVED', 'SCHEDULED'].includes(item.status)) {
            throw new Error(`Item must be APPROVED or SCHEDULED to send. Current status: ${item.status}`);
        }

        const content = item.edited_content || item.generated_content;
        if (!content || content.trim() === '') {
            throw new Error('Content cannot be empty before sending to Phantom');
        }

        const result = await this._sendToPhantom(item);

        await pool.query(
            `UPDATE content_items SET
                status = 'POSTED',
                posted_at = NOW(),
                post_url = $1,
                phantom_container_id = $2,
                error_message = NULL,
                updated_at = NOW()
             WHERE id = $3`,
            [result.postUrl || null, result.containerId || null, itemId]
        );
        await ContentItemService._logTransition(itemId, item.status, 'POSTED', 'Manually triggered via Send Now');

        // Notify the user with a deep-link
        try {
            const { default: NotificationService } = await import('./notification.service.js');
            await NotificationService.create({
                type: 'phantom_completed',
                title: 'Post sent to Phantom',
                message: `Your post "${item.title || 'Untitled Idea'}" has been sent to LinkedIn.`,
                data: { link: `/content-engine?highlight=${item.id}&tab=board` }
            });
        } catch (notifErr) {
            console.error('ContentEngine: Failed to create notification', notifErr);
        }

        return { success: true, postUrl: result.postUrl, containerId: result.containerId };
    },

    /** Internal: send a content item to Phantom LinkedIn Auto Poster */
    async _sendToPhantom(item) {
        const phantomId = process.env.LINKEDIN_AUTO_POSTER_PHANTOM_ID || process.env.MESSAGE_SENDER_PHANTOM_ID;

        if (!phantomId) {
            throw new Error('LINKEDIN_AUTO_POSTER_PHANTOM_ID is not configured in .env');
        }

        const content = item.edited_content || item.generated_content;

        console.log(`🚀 ContentEngine: Triggering Phantom ${phantomId} via Google Sheet integration`);
        console.log(`   Content preview: ${content.substring(0, 80)}...`);

        // 1. Append the post to the Google Sheet (this is where the Phantom reads from)
        try {
            const { default: GoogleSheetsService } = await import('./googleSheets.service.js');
            await GoogleSheetsService.appendPost(content);
            console.log(`✅ ContentEngine: Appended to Google Sheet successfully.`);
        } catch (sheetError) {
            console.error(`❌ ContentEngine: Failed to write to Google Sheet.`, sheetError);
            throw new Error(`Failed to write to Google Sheet: ${sheetError.message}`);
        }

        // 2. Launch the Phantom with ZERO arguments.
        // It uses its dashboard configuration (LinkedIn Session Cookie + Google Sheet URL).
        const { default: pb } = await import('./phantombuster.service.js');
        const launchResult = await pb.launchPhantom(phantomId, {}, { minimalArgs: true });

        const containerId = launchResult.containerId;

        console.log(`✅ ContentEngine: Phantom launched. Container: ${containerId}`);

        // For async posting (LinkedIn Auto Poster is usually fast)
        // Return containerId. The actual post_url can be fetched later via webhook or polling.
        return {
            containerId,
            postUrl: null // Will be updated when Phantom webhook/polling confirms
        };
    }
};

// ─── ANALYTICS (INTERNAL ONLY - NO ENGAGEMENT DATA) ─────────────────────────
export const ContentAnalyticsService = {
    async getDashboard() {
        const [statsRes, personaRes, industryRes, ctaRes] = await Promise.all([
            pool.query(`
                SELECT status, COUNT(*) as count
                FROM content_items
                GROUP BY status
            `),
            pool.query(`
                SELECT persona, COUNT(*) as count
                FROM content_items
                WHERE persona IS NOT NULL AND status = 'POSTED'
                GROUP BY persona
                ORDER BY count DESC
                LIMIT 10
            `),
            pool.query(`
                SELECT industry, COUNT(*) as count
                FROM content_items
                WHERE industry IS NOT NULL AND status = 'POSTED'
                GROUP BY industry
                ORDER BY count DESC
                LIMIT 10
            `),
            pool.query(`
                SELECT ct.name as cta_name, COUNT(ci.id) as usage_count
                FROM content_items ci
                JOIN cta_templates ct ON ci.cta_type = ct.id
                GROUP BY ct.id, ct.name
                ORDER BY usage_count DESC
            `)
        ]);

        const statusMap = {};
        for (const row of statsRes.rows) {
            statusMap[row.status] = parseInt(row.count);
        }

        return {
            total_ideas: statusMap['IDEA'] || 0,
            total_drafts: statusMap['DRAFT'] || 0,
            total_in_review: statusMap['REVIEW'] || 0,
            total_approved: statusMap['APPROVED'] || 0,
            total_scheduled: statusMap['SCHEDULED'] || 0,
            total_posted: statusMap['POSTED'] || 0,
            total_all: Object.values(statusMap).reduce((a, b) => a + b, 0),
            posts_by_persona: personaRes.rows,
            posts_by_industry: industryRes.rows,
            cta_usage: ctaRes.rows
        };
    }
};

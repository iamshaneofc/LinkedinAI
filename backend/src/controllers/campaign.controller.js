import pool from "../db.js";
import { NotificationService } from "../services/notification.service.js";

// Allowed automation step types for sequences.
// These MUST stay in sync with:
// - backend/src/services/scheduler.service.js (executeStepForLead)
// - frontend/src/pages/CampaignDetailPage.jsx (Sequence tab UI)
const ALLOWED_SEQUENCE_STEP_TYPES = [
    "connection_request",
    "message",
    "email",
    "gmail_outreach"
];

// GET /api/campaigns
export async function getCampaigns(req, res) {
    try {
        const { goal, type, status, priority, tag, createdFrom, createdTo } = req.query;
        let query = `
            SELECT c.*, 
            (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id) as lead_count,
            (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id AND cl.status IN ('sent', 'replied', 'completed')) as sent_count,
            (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id AND cl.status = 'replied') as replied_count
            FROM campaigns c 
            WHERE 1=1
        `;
        const params = [];
        let idx = 1;
        if (goal) { params.push(goal); query += ` AND c.goal = $${idx++}`; }
        if (type) { params.push(type); query += ` AND c.type = $${idx++}`; }
        if (status) { params.push(status); query += ` AND c.status = $${idx++}`; }
        if (priority) { params.push(priority); query += ` AND c.priority = $${idx++}`; }
        if (tag) { params.push(Array.isArray(tag) ? tag : [tag]); query += ` AND c.tags @> $${idx++}::text[]`; }
        if (createdFrom) { params.push(createdFrom); query += ` AND c.created_at >= $${idx++}`; }
        if (createdTo) { params.push(createdTo); query += ` AND c.created_at <= $${idx++}`; }
        query += ` ORDER BY c.created_at DESC`;
        const result = await pool.query(query, params);
        const rows = result.rows.map(row => {
            const total = parseInt(row.lead_count) || 0;
            const sent = parseInt(row.sent_count) || 0;
            const replied = parseInt(row.replied_count) || 0;
            return {
                ...row,
                progress: total > 0 ? Math.round((sent / total) * 100) : 0,
                response_rate: sent > 0 ? Math.round((replied / sent) * 100) : 0
            };
        });
        return res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// POST /api/campaigns
export async function createCampaign(req, res) {
    try {
        const {
            name,
            type = 'standard',
            description,
            goal = 'connections',
            target_audience,
            schedule_start,
            schedule_end,
            daily_cap = 0,
            timezone = 'UTC',
            tags,
            priority = 'normal',
            notes,
            settings = {}
        } = req.body;
        if (!name) return res.status(400).json({ error: "Name is required" });

        const result = await pool.query(
            `INSERT INTO campaigns (
                name, type, status, description, goal, target_audience,
                schedule_start, schedule_end, daily_cap, timezone, tags, priority, notes, settings
            ) VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb) RETURNING *`,
            [
                name, type, description || null, goal, target_audience || null,
                schedule_start || null, schedule_end || null, parseInt(daily_cap, 10) || 0,
                timezone, Array.isArray(tags) ? tags : (tags ? [tags] : []), priority, notes || null,
                typeof settings === 'object' ? JSON.stringify(settings) : '{}'
            ]
        );

        return res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// GET /api/campaigns/:id
export async function getCampaignById(req, res) {
    try {
        const { id } = req.params;

        // Get campaign details
        const campaignResult = await pool.query("SELECT * FROM campaigns WHERE id = $1", [id]);
        if (campaignResult.rows.length === 0) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        // Get sequences with variants
        const sequenceResult = await pool.query(`
            SELECT s.*, 
            COALESCE((
                SELECT json_agg(sv ORDER BY sv.id ASC) 
                FROM sequence_variants sv 
                WHERE sv.sequence_id = s.id
            ), '[]'::json) as variants
            FROM sequences s 
            WHERE s.campaign_id = $1 
            ORDER BY s.step_order ASC
        `, [id]);

        // Get stats
        const statsResult = await pool.query(
            `SELECT status, COUNT(*) as count 
       FROM campaign_leads 
       WHERE campaign_id = $1 
       GROUP BY status`,
            [id]
        );

        const stats = statsResult.rows.reduce((acc, row) => {
            acc[row.status] = parseInt(row.count);
            return acc;
        }, { pending: 0, sent: 0, replied: 0, failed: 0 });
        // "Sent" = leads we've sent at least one message/connection to (completed or replied)
        stats.sent = (stats.completed || 0) + (stats.replied || 0);

        return res.json({
            ...campaignResult.rows[0],
            sequences: sequenceResult.rows,
            stats
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// PUT /api/campaigns/:id
export async function updateCampaign(req, res) {
    try {
        const { id } = req.params;
        const {
            name, type, description, goal, target_audience,
            schedule_start, schedule_end, daily_cap, timezone, tags, priority, notes, settings
        } = req.body;

        const check = await pool.query("SELECT id FROM campaigns WHERE id = $1", [id]);
        if (check.rows.length === 0) return res.status(404).json({ error: "Campaign not found" });

        const result = await pool.query(
            `UPDATE campaigns SET
                name = COALESCE($2, name),
                type = COALESCE($3, type),
                description = COALESCE($4, description),
                goal = COALESCE($5, goal),
                target_audience = COALESCE($6, target_audience),
                schedule_start = COALESCE($7, schedule_start),
                schedule_end = COALESCE($8, schedule_end),
                daily_cap = COALESCE($9, daily_cap),
                timezone = COALESCE($10, timezone),
                tags = COALESCE($11, tags),
                priority = COALESCE($12, priority),
                notes = COALESCE($13, notes),
                settings = COALESCE($14::jsonb, settings),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 RETURNING *`,
            [
                id, name, type, description, goal, target_audience,
                schedule_start, schedule_end, daily_cap != null ? parseInt(daily_cap, 10) : null,
                timezone, Array.isArray(tags) ? tags : (tags != null ? [tags] : null), priority, notes,
                settings != null ? JSON.stringify(settings) : null
            ]
        );
        return res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// POST /api/campaigns/:id/duplicate
export async function duplicateCampaign(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { name: newName } = req.body;

        const campaign = await client.query("SELECT * FROM campaigns WHERE id = $1", [id]);
        if (campaign.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Campaign not found" });
        }
        const c = campaign.rows[0];
        const name = newName || `${c.name} (Copy)`;

        const insertCampaign = await client.query(
            `INSERT INTO campaigns (name, type, status, description, goal, target_audience,
                schedule_start, schedule_end, daily_cap, timezone, tags, priority, notes, settings)
            VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13::jsonb, '{}'::jsonb)) RETURNING *`,
            [
                name, c.type || 'standard', c.description || null, c.goal || 'connections', c.target_audience || null,
                c.schedule_start || null, c.schedule_end || null, c.daily_cap ?? 0, c.timezone || 'UTC',
                c.tags && Array.isArray(c.tags) ? c.tags : [], c.priority || 'normal', c.notes || null,
                c.settings ? JSON.stringify(c.settings) : '{}'
            ]
        );
        const newCampaignId = insertCampaign.rows[0].id;

        const sequences = await client.query("SELECT * FROM sequences WHERE campaign_id = $1 ORDER BY step_order", [id]);
        for (const seq of sequences.rows) {
            const seqRes = await client.query(
                `INSERT INTO sequences (campaign_id, step_order, type, delay_days, condition_type, send_window_start, send_window_end, retry_count, retry_delay_hours, subject_line, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
                [newCampaignId, seq.step_order, seq.type, seq.delay_days || 0, seq.condition_type, seq.send_window_start, seq.send_window_end, seq.retry_count ?? 0, seq.retry_delay_hours ?? 24, seq.subject_line, seq.notes]
            );
            const newSeqId = seqRes.rows[0].id;
            const variants = await client.query("SELECT content, weight, is_active FROM sequence_variants WHERE sequence_id = $1", [seq.id]);
            for (const v of variants.rows) {
                await client.query(
                    "INSERT INTO sequence_variants (sequence_id, content, weight, is_active) VALUES ($1, $2, $3, $4)",
                    [newSeqId, v.content, v.weight ?? 100, v.is_active !== false]
                );
            }
        }

        await client.query('COMMIT');
        const full = await pool.query("SELECT * FROM campaigns WHERE id = $1", [newCampaignId]);
        return res.status(201).json(full.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
}

// POST /api/campaigns/:id/leads
export async function addLeadsToCampaign(req, res) {
    try {
        const { id } = req.params;
        const { leadIds } = req.body; // Array of lead IDs

        if (!Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({ error: "leadIds array is required" });
        }

        // Check if campaign exists
        const campaignCheck = await pool.query("SELECT * FROM campaigns WHERE id = $1", [id]);
        if (campaignCheck.rows.length === 0) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        // Check if campaign has sequences defined (warning only, not blocking)
        const sequencesCheck = await pool.query(
            "SELECT COUNT(*) as count FROM sequences WHERE campaign_id = $1",
            [id]
        );
        const sequenceCount = parseInt(sequencesCheck.rows[0].count);

        if (sequenceCount === 0) {
            console.warn(`⚠️ Warning: Adding leads to campaign ${id} which has no sequences defined. Leads will be stuck until sequences are added.`);
            // Don't block, but log a warning - user might be adding sequences later
        }

        // CRM rule: Only approved leads can be added to campaigns
        const leadsCheck = await pool.query(
            "SELECT id, review_status FROM leads WHERE id = ANY($1::int[])",
            [leadIds]
        );
        const notApproved = leadsCheck.rows.filter((r) => r.review_status !== 'approved');
        if (notApproved.length > 0) {
            return res.status(400).json({
                error: "Only approved (qualified) leads can be added to campaigns.",
                notApprovedIds: notApproved.map((r) => r.id),
                count: notApproved.length,
            });
        }

        // Bulk insert
        // Note: This is a simple implementation. For large batches, consider using pg-format or UNNEST.
        let addedCount = 0;
        const errors = [];

        for (const leadId of leadIds) {
            try {
                await pool.query(
                    "INSERT INTO campaign_leads (campaign_id, lead_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                    [id, leadId]
                );
                addedCount++;
            } catch (e) {
                errors.push({ leadId, error: e.message });
            }
        }

        const response = {
            success: true,
            message: `Added ${addedCount} leads to campaign`,
            addedCount,
            errors
        };

        if (sequenceCount === 0) {
            response.warning = "Campaign has no sequences defined. Leads will not be processed until sequences are added.";
        }

        return res.json(response);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// POST /api/campaigns/:id/auto-connect
export async function autoConnectCampaign(req, res) {
    try {
        const { id } = req.params;
        const { leadIds } = req.body || {};

        console.log(`\n🔗 ============================================`);
        console.log(`🔗 AUTO CONNECT - Send Connection Requests`);
        console.log(`🔗 Campaign ID: ${id}`);
        console.log(`🔗 ============================================\n`);

        const campaignRes = await pool.query("SELECT * FROM campaigns WHERE id = $1", [id]);
        if (campaignRes.rows.length === 0) return res.status(404).json({ error: "Campaign not found" });

        let leadIdList = Array.isArray(leadIds) ? leadIds : (leadIds != null ? [leadIds] : []);
        if (leadIdList.length === 0) {
            const campaignLeads = await pool.query(
                `SELECT lead_id FROM campaign_leads WHERE campaign_id = $1`,
                [id]
            );
            leadIdList = campaignLeads.rows.map((r) => r.lead_id);
        }
        if (leadIdList.length === 0) {
            return res.status(400).json({ error: "No leads to connect. Add leads to the campaign or pass leadIds in the request body." });
        }

        const leadsRes = await pool.query(
            `SELECT id, linkedin_url, first_name, last_name, full_name FROM leads WHERE id = ANY($1::int[]) AND linkedin_url IS NOT NULL AND linkedin_url != ''`,
            [leadIdList]
        );
        const profiles = leadsRes.rows.map((r) => ({
            id: r.id,
            linkedin_url: r.linkedin_url,
            first_name: r.first_name,
            last_name: r.last_name,
            full_name: r.full_name
        }));
        if (profiles.length === 0) {
            return res.status(400).json({ error: "No leads with LinkedIn URLs found among the selected leads." });
        }

        console.log(`📋 Found ${profiles.length} leads with LinkedIn URLs`);

        // Check for approved messages in approval queue
        console.log(`\n🔍 Checking for approved AI messages...`);
        const approvedMessagesRes = await pool.query(
            `SELECT DISTINCT ON (lead_id) lead_id, generated_content 
             FROM approval_queue 
             WHERE campaign_id = $1 
             AND lead_id = ANY($2::int[]) 
             AND step_type = 'connection_request' 
             AND status = 'approved'
             ORDER BY lead_id, created_at DESC`,
            [id, leadIdList]
        );

        // Create a map of lead_id -> approved message
        const messageByLeadId = {};
        approvedMessagesRes.rows.forEach(row => {
            messageByLeadId[row.lead_id] = row.generated_content;
        });

        // Build messages array in the same order as profiles
        const messages = profiles.map(profile => {
            const message = messageByLeadId[profile.id];
            if (message) {
                console.log(`   ✅ Lead ${profile.id} (${profile.full_name}): Using approved message (${message.length} chars)`);
            } else {
                console.log(`   ⚠️  Lead ${profile.id} (${profile.full_name}): No approved message, will send without note`);
            }
            return message || '';
        });

        const hasMessages = messages.some(m => m && m.trim().length > 0);
        const approvedCount = messages.filter(m => m && m.trim().length > 0).length;

        if (hasMessages) {
            console.log(`\n📝 Using ${approvedCount} approved AI message(s) for connection requests`);
        } else {
            console.log(`\n⚠️  No approved messages found - connection requests will be sent without notes`);
        }

        console.log(`\n📤 Sending connection requests via Auto Connect phantom...\n`);

        const phantomService = (await import("../services/phantombuster.service.js")).default;
        const result = await phantomService.autoConnect(profiles, hasMessages ? messages : null);

        console.log(`✅ Auto Connect phantom launched!`);
        console.log(`   Container ID: ${result.containerId}`);
        console.log(`   Profiles: ${result.count}`);
        console.log(`   With Messages: ${result.hasMessages ? 'Yes' : 'No'}\n`);

        return res.json({
            success: true,
            message: `Auto Connect started for ${profiles.length} lead(s)${hasMessages ? ` with ${approvedCount} personalized message(s)` : ''}.`,
            phantomResult: result,
            stats: {
                total: profiles.length,
                withMessages: approvedCount,
                withoutMessages: profiles.length - approvedCount
            }
        });
    } catch (err) {
        console.error("Auto Connect Error:", err);
        res.status(500).json({ error: err.message });
    }
}

// POST /api/campaigns/:id/launch
export async function launchCampaign(req, res) {
    try {
        const { id } = req.params;
        console.log(`🚀 Request to launch campaign ${id}`);

        // 1. Get Campaign to verify it exists
        const campaignRes = await pool.query("SELECT * FROM campaigns WHERE id = $1", [id]);
        if (campaignRes.rows.length === 0) return res.status(404).json({ error: "Campaign not found" });

        // 2. Fetch Pending Leads
        // Join with leads table to get linkedin_url
        const pendingLeads = await pool.query(
            `SELECT l.id, l.linkedin_url, l.first_name, l.last_name 
             FROM campaign_leads cl
             JOIN leads l ON cl.lead_id = l.id
             WHERE cl.campaign_id = $1 AND cl.status = 'pending'`,
            [id]
        );

        if (pendingLeads.rows.length === 0) {
            return res.status(400).json({ error: "No pending leads found in this campaign." });
        }

        console.log(`found ${pendingLeads.rows.length} pending leads`);

        const leadIds = pendingLeads.rows.map(l => l.id);

        // 3. Fetch approved custom messages for connection requests (one per lead)
        const approvedMessagesRes = await pool.query(
            `SELECT DISTINCT ON (lead_id) lead_id, generated_content 
             FROM approval_queue 
             WHERE campaign_id = $1 
             AND lead_id = ANY($2::int[]) 
             AND step_type = 'connection_request' 
             AND status = 'approved'
             ORDER BY lead_id, created_at DESC`,
            [id, leadIds]
        );
        const messageByLeadId = Object.fromEntries(
            approvedMessagesRes.rows.map((r) => [r.lead_id, r.generated_content])
        );
        // One message per lead (empty string if no approved message)
        const messages = pendingLeads.rows.map((p) => (messageByLeadId[p.id] || "").trim());
        const hasMessages = messages.some((m) => m.length > 0);
        if (hasMessages) {
            const count = messages.filter((m) => m.length > 0).length;
            console.log(`📝 Using ${count} approved custom message(s) for connection requests`);
        } else {
            console.log(`⚠️  No approved messages found - connection requests will be sent without notes`);
        }

        // 4. Trigger PhantomBuster to send connection requests (with custom messages when available)
        const { autoConnect } = await import("../services/phantombuster.service.js");
        const result = await autoConnect(pendingLeads.rows, hasMessages ? messages : null);

        // 5. Mark campaign as active but do NOT schedule any automation flow.
        await pool.query("UPDATE campaigns SET status = 'active' WHERE id = $1", [id]);

        // 6. Mark campaign leads as completed so the scheduler will not pick them up
        if (leadIds.length > 0) {
            await pool.query(
                `
                UPDATE campaign_leads 
                SET status = 'completed', last_activity_at = NOW(), next_action_due = NULL 
                WHERE campaign_id = $1 AND lead_id = ANY($2::int[])
                `,
                [id, leadIds]
            );
        }

        const campaignName = campaignRes.rows[0]?.name || 'Campaign';
        await NotificationService.create({
            type: 'campaign_launched',
            title: 'Campaign launched',
            message: `${campaignName}: ${pendingLeads.rows.length} connection requests sent`,
            data: { campaignId: parseInt(id, 10), leadsProcessed: pendingLeads.rows.length, link: `/campaigns/${id}` },
        });

        return res.json({
            success: true,
            message: "Campaign launched successfully (connections sent, no automation flow).",
            leadsProcessed: pendingLeads.rows.length,
            phantomResult: result
        });

    } catch (err) {
        console.error("Launch Error:", err);
        res.status(500).json({ error: err.message });
    }
}

// PUT /api/campaigns/:id/pause
export async function pauseCampaign(req, res) {
    try {
        const { id } = req.params;
        const result = await pool.query(
            "UPDATE campaigns SET status = 'paused' WHERE id = $1 RETURNING *",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        await NotificationService.create({
            type: 'campaign_paused',
            title: 'Campaign paused',
            message: `"${result.rows[0].name}" has been paused`,
            data: { campaignId: parseInt(id, 10), link: `/campaigns/${id}` },
        });

        return res.json({ success: true, message: "Campaign paused", campaign: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// PUT /api/campaigns/:id/resume
export async function resumeCampaign(req, res) {
    try {
        const { id } = req.params;
        const result = await pool.query(
            "UPDATE campaigns SET status = 'active' WHERE id = $1 RETURNING *",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        await NotificationService.create({
            type: 'campaign_resumed',
            title: 'Campaign resumed',
            message: `"${result.rows[0].name}" is now active`,
            data: { campaignId: parseInt(id, 10), link: `/campaigns/${id}` },
        });

        return res.json({ success: true, message: "Campaign resumed", campaign: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// DELETE /api/campaigns/:id
export async function deleteCampaign(req, res) {
    try {
        const { id } = req.params;

        // Check if campaign exists
        const checkResult = await pool.query("SELECT * FROM campaigns WHERE id = $1", [id]);
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        // Delete campaign (cascade will handle related records: campaign_leads, sequences, approval_queue)
        const result = await pool.query("DELETE FROM campaigns WHERE id = $1 RETURNING *", [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        return res.json({ success: true, message: "Campaign deleted successfully" });
    } catch (err) {
        console.error("Delete campaign error:", err);

        // Provide more helpful error messages
        if (err.code === '23503') { // Foreign key violation
            return res.status(400).json({
                error: "Cannot delete campaign: There are still related records that prevent deletion. Please ensure all related data is cleaned up first."
            });
        }

        res.status(500).json({ error: err.message || "Failed to delete campaign" });
    }
}

// POST /api/campaigns/:id/sequences
export async function addSequenceStep(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { type, content, delay_days } = req.body;

        if (!type) {
            return res.status(400).json({ error: "Type is required" });
        }

        if (!ALLOWED_SEQUENCE_STEP_TYPES.includes(type)) {
            return res.status(400).json({
                error: `Invalid step type. Allowed types: ${ALLOWED_SEQUENCE_STEP_TYPES.join(", ")}.`
            });
        }

        // Normalize delay_days (must be a non-negative integer)
        let normalizedDelay = 0;
        if (delay_days !== undefined && delay_days !== null) {
            const parsed = parseInt(delay_days, 10);
            normalizedDelay = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
        }

        // Get current max step order
        const maxOrderRes = await client.query(
            "SELECT MAX(step_order) as max_order FROM sequences WHERE campaign_id = $1",
            [id]
        );
        const nextOrder = (maxOrderRes.rows[0].max_order || 0) + 1;

        // Optional guardrail: warn if the first step is not a connection_request
        if (nextOrder === 1 && type !== "connection_request") {
            console.warn(
                `⚠️ Creating first sequence step for campaign ${id} as type "${type}".` +
                ' Recommended first step type is "connection_request".'
            );
        }

        // 1. Insert into sequences (no content column)
        const seqResult = await client.query(
            "INSERT INTO sequences (campaign_id, step_order, type, delay_days) VALUES ($1, $2, $3, $4) RETURNING *",
            [id, nextOrder, type, normalizedDelay]
        );
        const sequence = seqResult.rows[0];

        // 2. Insert into sequence_variants if content is provided
        if (content) {
            await client.query(
                "INSERT INTO sequence_variants (sequence_id, content, weight, is_active) VALUES ($1, $2, 100, true)",
                [sequence.id, content]
            );
        }

        await client.query('COMMIT');

        // Fetch complete object with variants for the response
        const finalResult = await pool.query(`
            SELECT s.*, 
            (SELECT json_agg(sv.*) FROM sequence_variants sv WHERE sv.sequence_id = s.id) as variants
            FROM sequences s WHERE s.id = $1
        `, [sequence.id]);

        return res.json(finalResult.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
}

// PUT /api/campaigns/sequences/:seqId
export async function updateSequenceStep(req, res) {
    try {
        const { seqId } = req.params;
        const { delay_days, condition_type, send_window_start, send_window_end, retry_count, retry_delay_hours, subject_line, notes } = req.body;

        const result = await pool.query(
            `UPDATE sequences SET
                delay_days = COALESCE($2, delay_days),
                condition_type = COALESCE($3, condition_type),
                send_window_start = COALESCE($4, send_window_start),
                send_window_end = COALESCE($5, send_window_end),
                retry_count = COALESCE($6, retry_count),
                retry_delay_hours = COALESCE($7, retry_delay_hours),
                subject_line = COALESCE($8, subject_line),
                notes = COALESCE($9, notes)
            WHERE id = $1 RETURNING *`,
            [
                seqId,
                delay_days != null ? parseInt(delay_days, 10) : null,
                condition_type,
                send_window_start,
                send_window_end,
                retry_count != null ? parseInt(retry_count, 10) : null,
                retry_delay_hours != null ? parseInt(retry_delay_hours, 10) : null,
                subject_line,
                notes
            ]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Sequence step not found" });
        const seq = result.rows[0];
        const variantsRes = await pool.query(
            "SELECT * FROM sequence_variants WHERE sequence_id = $1 ORDER BY id ASC",
            [seqId]
        );
        return res.json({ ...seq, variants: variantsRes.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// DELETE /api/campaigns/sequences/:seqId
export async function deleteSequenceStep(req, res) {
    try {
        const { seqId } = req.params;
        await pool.query("DELETE FROM sequences WHERE id = $1", [seqId]);
        return res.json({ success: true, message: "Step deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// GET /api/campaigns/templates (must be before /:id route)
export async function getCampaignTemplates(req, res) {
    try {
        const result = await pool.query(`
            SELECT * FROM campaign_templates
            ORDER BY is_system DESC, name ASC
        `);
        const templates = result.rows;
        if (templates.length === 0) {
            return res.json([
                { id: 'default-connections', name: 'Connection outreach', description: 'Connect then follow up with messages', goal: 'connections', type: 'standard', sequence_config: [{ type: 'connection_request', delay_days: 0 }, { type: 'message', delay_days: 3 }], is_system: true },
                { id: 'default-meetings', name: 'Meeting booking', description: 'Multi-touch sequence to book meetings', goal: 'meetings', type: 'standard', sequence_config: [{ type: 'connection_request', delay_days: 0 }, { type: 'message', delay_days: 2 }, { type: 'message', delay_days: 5 }], is_system: true }
            ]);
        }
        return res.json(templates);
    } catch (err) {
        if (err.code === '42P01') return res.json([]);
        res.status(500).json({ error: err.message });
    }
}

// GET /api/campaigns/:id/leads (List leads in a campaign)
export async function getCampaignLeads(req, res) {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT cl.*, l.first_name, l.last_name, l.linkedin_url, l.title, l.company,
                   l.email, l.phone,
                   le.last_enriched_at,
                   aq.id as approval_id, aq.status as approval_status, aq.generated_content
            FROM campaign_leads cl
            JOIN leads l ON cl.lead_id = l.id
            LEFT JOIN lead_enrichment le ON l.id = le.lead_id
            LEFT JOIN approval_queue aq ON aq.campaign_id = cl.campaign_id AND aq.lead_id = l.id AND aq.status = 'pending'
            WHERE cl.campaign_id = $1
            ORDER BY cl.created_at DESC
        `, [id]);

        return res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}



// POST /api/campaigns/estimate-audience
// Estimate how many leads match the given filter criteria
export async function estimateAudience(req, res) {
    try {
        const { filters } = req.body;

        if (!filters || !filters.groups || filters.groups.length === 0) {
            return res.json({ count: 0, preview: [] });
        }

        // Build SQL WHERE clause from filters
        const whereClause = buildWhereClauseFromFilters(filters);

        // Count matching leads
        const countQuery = `SELECT COUNT(*) as count FROM leads WHERE ${whereClause}`;
        const countResult = await pool.query(countQuery);
        const count = parseInt(countResult.rows[0].count) || 0;

        // Get preview (first 5 leads)
        const previewQuery = `
            SELECT id, full_name, first_name, last_name, title, company, location
            FROM leads 
            WHERE ${whereClause}
            LIMIT 5
        `;
        const previewResult = await pool.query(previewQuery);

        return res.json({
            count,
            preview: previewResult.rows
        });
    } catch (err) {
        console.error('Estimate audience error:', err);
        res.status(500).json({ error: err.message });
    }
}

// Helper function to build SQL WHERE clause from FilterLogicBuilder format
function buildWhereClauseFromFilters(filters) {
    const { operator, groups } = filters;

    if (!groups || groups.length === 0) {
        return '1=1'; // Return all if no filters
    }

    const groupClauses = groups.map(group => {
        const { conditions } = group;
        if (!conditions || conditions.length === 0) return null;

        const conditionClauses = conditions.map(cond => {
            const { field, operator: op, value, exclude } = cond;

            // Skip empty values for non-boolean fields
            if (op !== 'exists' && op !== 'not_exists' && (!value || value === '')) {
                return null;
            }

            let clause = '';

            switch (op) {
                case 'contains':
                    clause = `${field} ILIKE '%${value}%'`;
                    break;
                case 'not_contains':
                    clause = `${field} NOT ILIKE '%${value}%'`;
                    break;
                case 'equals':
                    clause = `${field} = '${value}'`;
                    break;
                case 'not_equals':
                    clause = `${field} != '${value}'`;
                    break;
                case 'starts_with':
                    clause = `${field} ILIKE '${value}%'`;
                    break;
                case 'exists':
                    clause = `${field} IS NOT NULL AND ${field} != ''`;
                    break;
                case 'not_exists':
                    clause = `${field} IS NULL OR ${field} = ''`;
                    break;
                default:
                    return null;
            }

            // Apply exclude logic
            if (exclude && clause) {
                clause = `NOT (${clause})`;
            }

            return clause;
        }).filter(Boolean);

        if (conditionClauses.length === 0) return null;

        // Join conditions with AND within a group
        return `(${conditionClauses.join(' AND ')})`;
    }).filter(Boolean);

    if (groupClauses.length === 0) {
        return '1=1';
    }

    // Join groups with OR (top-level operator)
    return groupClauses.join(` ${operator} `);
}

// POST /api/campaigns/:id/bulk-enrich-generate
export async function bulkEnrichAndGenerate(req, res) {
    try {
        const { id } = req.params;
        const { leadIds } = req.body; // Optional: array of specific lead IDs to process

        console.log(`\n🚀 ============================================`);
        console.log(`🚀 BULK ENRICH & GENERATE AI MESSAGES`);
        console.log(`🚀 Campaign ID: ${id}`);
        console.log(`🚀 ============================================`);
        console.log(`\n📌 IMPORTANT: This is the ONLY place OpenAI API is called.`);
        console.log(`📌 OpenAI will ONLY be used for leads selected in campaigns.`);
        console.log(`📌 The scheduler does NOT call OpenAI automatically.\n`);

        // 0. Fetch campaign details for context
        const campaignResult = await pool.query("SELECT * FROM campaigns WHERE id = $1", [id]);
        if (campaignResult.rows.length === 0) {
            return res.status(404).json({ error: "Campaign not found" });
        }
        const campaign = campaignResult.rows[0];
        console.log(`📋 Campaign: ${campaign.name} (Goal: ${campaign.goal || 'N/A'}, Type: ${campaign.type || 'N/A'})`);

        // 1. Get leads - either specific ones or all in campaign
        let leadsResult;
        if (leadIds && Array.isArray(leadIds) && leadIds.length > 0) {
            // Process only selected leads
            console.log(`📋 User selected ${leadIds.length} leads to process`);
            leadsResult = await pool.query(`
                SELECT l.id, l.first_name, l.last_name, l.full_name, l.linkedin_url, l.title, l.company, l.email
                FROM campaign_leads cl
                JOIN leads l ON cl.lead_id = l.id
                WHERE cl.campaign_id = $1 AND l.id = ANY($2::int[])
            `, [id, leadIds]);
        } else {
            // Process all leads in campaign
            console.log(`📋 User selected ALL leads in campaign to process`);
            leadsResult = await pool.query(`
                SELECT l.id, l.first_name, l.last_name, l.full_name, l.linkedin_url, l.title, l.company, l.email
                FROM campaign_leads cl
                JOIN leads l ON cl.lead_id = l.id
                WHERE cl.campaign_id = $1
            `, [id]);
        }

        if (leadsResult.rows.length === 0) {
            return res.status(400).json({ error: 'No leads found to process' });
        }

        const leads = leadsResult.rows;
        console.log(`📊 Found ${leads.length} leads to process`);

        // Filter out leads without LinkedIn URLs
        const leadsWithLinkedIn = leads.filter(l => l.linkedin_url && l.linkedin_url.trim().length > 0);
        if (leadsWithLinkedIn.length === 0) {
            return res.status(400).json({
                error: 'No leads with LinkedIn URLs found. Please ensure leads have LinkedIn URLs before enriching.'
            });
        }

        if (leadsWithLinkedIn.length < leads.length) {
            console.warn(`⚠️ ${leads.length - leadsWithLinkedIn.length} leads without LinkedIn URLs will be skipped`);
        }

        // 2. Get campaign's first sequence step to determine message type
        const sequenceResult = await pool.query(`
            SELECT type FROM sequences 
            WHERE campaign_id = $1 
            ORDER BY step_order ASC 
            LIMIT 1
        `, [id]);

        const stepType = sequenceResult.rows[0]?.type || 'message';

        // Import services
        const { default: enrichmentService } = await import('../services/enrichment.service.js');
        const { default: AIService } = await import('../services/ai.service.js');
        const { ApprovalService } = await import('../services/approval.service.js');

        // Check OpenAI configuration
        const openaiConfigured = AIService.isConfigured();
        console.log(`\n🔑 OpenAI Configuration Check:`);
        if (!openaiConfigured) {
            console.warn('   ⚠️  OPENAI_API_KEY not configured');
            console.warn('   ⚠️  Will use template messages instead of AI-generated ones');
            console.warn('   💡 To enable AI generation, add OPENAI_API_KEY=sk-... to backend/.env file');
        } else {
            console.log('   ✅ OpenAI API configured');
            console.log('   ✅ Will generate personalized AI messages using OpenAI');
        }
        console.log('');

        const results = {
            enriched: 0,
            generated: 0,
            emailsGenerated: 0,
            failed: [],
            skipped: [],
            total: leads.length
        };

        const campaignContext = {
            goal: campaign.goal,
            type: campaign.type,
            description: campaign.description,
            target_audience: campaign.target_audience
        };

        // 3. Process each lead (with delay to avoid rate limiting)
        for (let index = 0; index < leadsWithLinkedIn.length; index++) {
            const lead = leadsWithLinkedIn[index];
            try {
                // Skip if no LinkedIn URL
                if (!lead.linkedin_url || lead.linkedin_url.trim().length === 0) {
                    console.log(`⏭️  Lead ${lead.id} has no LinkedIn URL, skipping`);
                    results.skipped.push({
                        leadId: lead.id,
                        name: `${lead.first_name} ${lead.last_name}`,
                        reason: 'No LinkedIn URL'
                    });
                    continue;
                }

                // Check if already has pending LinkedIn approval
                const existingLinkedIn = await pool.query(
                    `SELECT id FROM approval_queue 
                     WHERE campaign_id = $1 AND lead_id = $2 AND step_type IN ('connection_request', 'message') AND status = 'pending'`,
                    [id, lead.id]
                );
                const skipLinkedIn = existingLinkedIn.rows.length > 0;

                // Enrich the lead FIRST
                console.log(`🔍 Enriching lead: ${lead.first_name} ${lead.last_name} (ID: ${lead.id})`);
                let enrichmentData = null;
                try {
                    const enrichResult = await enrichmentService.enrichLead(lead.id);
                    if (enrichResult && enrichResult.success) {
                        results.enriched++;
                        enrichmentData = enrichResult.enrichmentData;
                        console.log(`✅ Lead ${lead.id} enriched successfully (source: ${enrichResult.source || 'unknown'})`);
                        if (enrichmentData) {
                            console.log(`   Bio: ${enrichmentData.bio ? enrichmentData.bio.substring(0, 50) + '...' : 'None'}`);
                            console.log(`   Interests: ${enrichmentData.interests?.length || 0} items`);
                        }
                    } else {
                        console.warn(`⚠️ Lead ${lead.id} enrichment returned unexpected result:`, enrichResult);
                        results.enriched++; // Still count it, might be mock data
                    }
                } catch (enrichError) {
                    // If enrichment fails completely, log but continue
                    console.error(`❌ Enrichment failed for lead ${lead.id}:`, enrichError.message);
                    results.enriched++; // Count as attempted
                }

                // Fetch enrichment data from database (in case it was stored)
                if (!enrichmentData) {
                    try {
                        const dbEnrichment = await enrichmentService.getEnrichment(lead.id);
                        if (dbEnrichment) {
                            enrichmentData = {
                                bio: dbEnrichment.bio,
                                interests: dbEnrichment.interests,
                                recent_posts: dbEnrichment.recent_posts
                            };
                            console.log(`📥 Fetched enrichment from database for lead ${lead.id}`);
                        }
                    } catch (fetchError) {
                        console.warn(`⚠️ Could not fetch enrichment data:`, fetchError.message);
                    }
                }

                // Generate LinkedIn AI message (if not already pending)
                if (skipLinkedIn) {
                    console.log(`⏭️  Lead ${lead.id} already has pending LinkedIn approval, skipping`);
                }
                const doGenerateLinkedIn = !skipLinkedIn;
                if (doGenerateLinkedIn) {
                    console.log(`🤖 Generating AI message for lead ${lead.id} (stepType: ${stepType})`);
                    console.log(`   Using enrichment: ${enrichmentData ? 'Yes' : 'No'}`);
                    console.log(`   Using campaign context: Yes (${campaign.goal || 'N/A'} - ${campaign.type || 'N/A'})`);
                    let personalizedMessage;
                    try {
                        // Pass enrichment data and campaign context directly if available
                        if (enrichmentData) {
                            if (stepType === 'connection_request') {
                                personalizedMessage = await AIService.generateConnectionRequest(lead, enrichmentData, { campaign: campaignContext });
                            } else {
                                personalizedMessage = await AIService.generateFollowUpMessage(lead, enrichmentData, [], { campaign: campaignContext });
                            }
                        } else {
                            // Fallback to standard method (still pass campaign context)
                            personalizedMessage = await AIService.generatePersonalizedMessage(
                                lead.id,
                                '', // No template, let AI generate from scratch
                                stepType,
                                campaignContext
                            );
                        }
                    } catch (aiError) {
                        console.error(`❌ AI generation failed for lead ${lead.id}:`, aiError.message);
                        if (enrichmentData && enrichmentData.bio) {
                            const bioSnippet = enrichmentData.bio.substring(0, 80);
                            personalizedMessage = `That bit in your profile about ${bioSnippet}... resonated. Would be great to connect.`;
                        } else {
                            personalizedMessage = `Your work at ${lead.company || 'your company'} caught my eye—would like to connect.`;
                        }
                        console.log(`   ⚠️  Using fallback template message`);
                    }

                    if (!personalizedMessage || personalizedMessage.trim().length === 0) {
                        console.warn(`   ⚠️  Generated empty message, using fallback`);
                        personalizedMessage = `Your work at ${lead.company || 'your company'} caught my eye—would like to connect.`;
                    }

                    console.log(`   📝 Message generated (${personalizedMessage.length} chars)`);
                    console.log(`      Preview: "${personalizedMessage.substring(0, 60)}..."`);

                    // STEP 3: Add to approval queue
                    console.log(`   💾 Step 3: Adding to approval queue...`);
                    const queueResult = await ApprovalService.addToQueue(
                        parseInt(id),
                        lead.id,
                        stepType,
                        personalizedMessage
                    );

                    if (!queueResult || !queueResult.id) {
                        throw new Error('Failed to add message to approval queue');
                    }

                    results.generated++;
                    console.log(`   ✅ LinkedIn message added. Approval Queue ID: ${queueResult.id}`);
                }

                // Generate Gmail draft for leads with email (if not already pending)
                const hasEmail = lead.email && String(lead.email).trim().length > 0;
                if (!hasEmail) {
                    console.log(`   ⏭️  Lead ${lead.id} has no email, skipping Gmail draft`);
                } else {
                    const existingGmail = await pool.query(
                        `SELECT id FROM approval_queue 
                         WHERE campaign_id = $1 AND lead_id = $2 AND step_type = 'gmail_outreach' AND status = 'pending'`,
                        [id, lead.id]
                    );
                    if (existingGmail.rows.length > 0) {
                        console.log(`   ⏭️  Lead ${lead.id} already has pending Gmail draft, skipping`);
                    } else {
                        try {
                            const leadForGmail = {
                                ...lead,
                                full_name: lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || 'Unknown',
                            };
                            console.log(`   📧 Generating Gmail draft for lead ${lead.id} (${lead.email})...`);
                            const draft = await AIService.generateGmailDraft(leadForGmail, enrichmentData, { campaign: campaignContext });
                            const content = JSON.stringify({ subject: draft.subject, body: draft.body });
                            await ApprovalService.addToQueue(parseInt(id), lead.id, 'gmail_outreach', content);
                            results.emailsGenerated++;
                            console.log(`   ✅ Gmail draft added for lead ${lead.id}`);
                        } catch (gmailErr) {
                            console.error(`   ❌ Gmail draft failed for lead ${lead.id}:`, gmailErr.message);
                        }
                    }
                }

                // Delay to avoid rate limiting and quota issues (2 seconds between leads)
                // Don't delay after the last lead
                if (index < leadsWithLinkedIn.length - 1) {
                    console.log(`   ⏳ Waiting 2 seconds before next lead...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

            } catch (error) {
                console.error(`\n   ❌ ERROR processing lead ${lead.id}:`);
                console.error(`      Name: ${lead.first_name} ${lead.last_name}`);
                console.error(`      Error: ${error.message}`);

                // Check for quota errors - stop processing if quota exceeded
                if (error.message && (error.message.includes('quota') || error.message.includes('insufficient_quota'))) {
                    console.error(`\n🛑 ============================================`);
                    console.error(`🛑 OPENAI QUOTA EXCEEDED - STOPPING PROCESSING`);
                    console.error(`🛑 ============================================\n`);
                    results.failed.push({
                        leadId: lead.id,
                        name: `${lead.first_name} ${lead.last_name}`,
                        error: 'OpenAI quota exceeded - processing stopped'
                    });
                    // Add remaining leads to failed list
                    const remainingLeads = leadsWithLinkedIn.slice(leadsWithLinkedIn.indexOf(lead) + 1);
                    remainingLeads.forEach(remainingLead => {
                        results.failed.push({
                            leadId: remainingLead.id,
                            name: `${remainingLead.first_name} ${remainingLead.last_name}`,
                            error: 'Processing stopped due to quota error'
                        });
                    });
                    break; // Stop processing
                }

                results.failed.push({
                    leadId: lead.id,
                    name: `${lead.first_name} ${lead.last_name}`,
                    error: error.message || String(error)
                });
            }
        }

        console.log(`\n✨ ============================================`);
        console.log(`✨ BULK PROCESSING COMPLETE`);
        console.log(`✨ ============================================`);
        console.log(`   Total Leads: ${results.total}`);
        console.log(`   ✅ Enriched: ${results.enriched}`);
        console.log(`   ✅ Generated: ${results.generated}`);
        console.log(`   ⏭️  Skipped: ${results.skipped.length}`);
        console.log(`   ❌ Failed: ${results.failed.length}`);
        if (results.failed.length > 0) {
            console.log(`\n   Failed Leads:`);
            results.failed.forEach(f => {
                console.log(`      - ${f.name} (ID: ${f.leadId}): ${f.error}`);
            });
        }
        console.log(`✨ ============================================\n`);

        // Build summary message
        let message = `Generated ${results.generated} LinkedIn message(s)`;
        if (results.emailsGenerated > 0) {
            message += ` and ${results.emailsGenerated} email draft(s)`;
        }
        message += ' successfully.';
        if (results.failed.length > 0) {
            message += ` ${results.failed.length} failed.`;
        }
        if (results.skipped.length > 0) {
            message += ` ${results.skipped.length} skipped (no LinkedIn URL).`;
        }
        if (results.generated === 0 && results.emailsGenerated === 0 && results.failed.length === 0) {
            message = 'No messages were generated. Check if leads have LinkedIn URLs and if OpenAI API key is configured.';
        }

        return res.json({
            success: results.generated > 0,
            message,
            results
        });

    } catch (err) {
        console.error('Bulk enrich & generate error:', err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * POST /api/campaigns/:id/generate-gmail-drafts
 * Generate Gmail drafts AND LinkedIn AI messages for campaign leads that have an email address.
 * Works like bulk-enrich-generate: generates both email drafts and LinkedIn messages for leads with email.
 * Optional leadIds in body: if provided, only process those leads (that have email).
 */
export async function generateGmailDrafts(req, res) {
    try {
        const campaignId = parseInt(req.params.id, 10);
        const { leadIds } = req.body || {};

        const campaignRes = await pool.query(
            'SELECT id, goal, type, description, target_audience FROM campaigns WHERE id = $1',
            [campaignId]
        );
        if (campaignRes.rows.length === 0) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        const campaign = campaignRes.rows[0];
        const campaignContext = {
            goal: campaign.goal,
            type: campaign.type,
            description: campaign.description,
            target_audience: campaign.target_audience
        };

        let leadsWithEmailRes;
        if (leadIds && Array.isArray(leadIds) && leadIds.length > 0) {
            leadsWithEmailRes = await pool.query(
                `SELECT l.id, l.first_name, l.last_name, l.full_name, l.title, l.company, l.email, l.linkedin_url
                 FROM campaign_leads cl
                 JOIN leads l ON cl.lead_id = l.id
                 WHERE cl.campaign_id = $1 AND l.id = ANY($2::int[]) AND l.email IS NOT NULL AND TRIM(l.email) != ''`,
                [campaignId, leadIds]
            );
        } else {
            leadsWithEmailRes = await pool.query(
                `SELECT l.id, l.first_name, l.last_name, l.full_name, l.title, l.company, l.email, l.linkedin_url
                 FROM campaign_leads cl
                 JOIN leads l ON cl.lead_id = l.id
                 WHERE cl.campaign_id = $1 AND l.email IS NOT NULL AND TRIM(l.email) != ''`,
                [campaignId]
            );
        }
        const leadsWithEmail = leadsWithEmailRes.rows;
        if (leadsWithEmail.length === 0) {
            return res.json({
                success: false,
                message: 'No leads in this campaign have an email address. Use "Get Contact Info" to enrich contacts first.',
                generated: 0,
                skipped: 0,
                linkedinGenerated: 0,
                totalWithEmail: 0
            });
        }

        // Get campaign's first sequence step for LinkedIn message type
        const sequenceResult = await pool.query(
            `SELECT type FROM sequences WHERE campaign_id = $1 ORDER BY step_order ASC LIMIT 1`,
            [campaignId]
        );
        const linkedinStepType = (sequenceResult.rows[0]?.type === 'connection_request') ? 'connection_request' : 'message';

        const { default: AIService } = await import('../services/ai.service.js');
        const { ApprovalService } = await import('../services/approval.service.js');

        let gmailGenerated = 0;
        let gmailSkipped = 0;
        let linkedinGenerated = 0;

        for (const lead of leadsWithEmail) {
            const enrichmentRes = await pool.query('SELECT * FROM lead_enrichment WHERE lead_id = $1', [lead.id]);
            let enrichment = enrichmentRes.rows[0] || null;
            const enrichmentData = enrichment ? {
                bio: enrichment.bio,
                interests: enrichment.interests,
                recent_posts: enrichment.recent_posts
            } : null;

            // 1. Generate Gmail draft (if not already pending)
            const existingGmail = await pool.query(
                `SELECT id FROM approval_queue 
                 WHERE campaign_id = $1 AND lead_id = $2 AND step_type = 'gmail_outreach' AND status = 'pending'`,
                [campaignId, lead.id]
            );
            if (existingGmail.rows.length === 0) {
                let draft;
                try {
                    draft = await AIService.generateGmailDraft(lead, enrichment, { campaign: campaignContext });
                } catch (err) {
                    console.error(`Gmail draft failed for lead ${lead.id}:`, err.message);
                    draft = {
                        subject: `Quick thought for ${lead.first_name}`,
                        body: `Saw your work at ${lead.company || 'your company'}—would be good to connect.\n\nBest`
                    };
                }
                const content = JSON.stringify({ subject: draft.subject, body: draft.body });
                await ApprovalService.addToQueue(campaignId, lead.id, 'gmail_outreach', content);
                gmailGenerated++;
                await new Promise(r => setTimeout(r, 800));
            } else {
                gmailSkipped++;
            }

            // 2. Generate LinkedIn AI message (if not already pending) - same as bulk-enrich-generate
            const existingLinkedIn = await pool.query(
                `SELECT id FROM approval_queue 
                 WHERE campaign_id = $1 AND lead_id = $2 AND step_type IN ('connection_request', 'message') AND status = 'pending'`,
                [campaignId, lead.id]
            );
            if (existingLinkedIn.rows.length === 0 && lead.linkedin_url) {
                try {
                    let personalizedMessage;
                    if (enrichmentData) {
                        if (linkedinStepType === 'connection_request') {
                            personalizedMessage = await AIService.generateConnectionRequest(lead, enrichmentData, { campaign: campaignContext });
                        } else {
                            personalizedMessage = await AIService.generateFollowUpMessage(lead, enrichmentData, [], { campaign: campaignContext });
                        }
                    } else {
                        personalizedMessage = await AIService.generatePersonalizedMessage(
                            lead.id,
                            '',
                            linkedinStepType,
                            campaignContext
                        );
                    }
                    if (!personalizedMessage || personalizedMessage.trim().length === 0) {
                        personalizedMessage = `Your work at ${lead.company || 'your company'} caught my eye—would like to connect.`;
                    }
                    await ApprovalService.addToQueue(campaignId, lead.id, linkedinStepType, personalizedMessage);
                    linkedinGenerated++;
                    await new Promise(r => setTimeout(r, 800));
                } catch (err) {
                    console.error(`LinkedIn message generation failed for lead ${lead.id}:`, err.message);
                }
            }
        }

        const totalNew = gmailGenerated + linkedinGenerated;
        let message = '';
        if (gmailGenerated > 0 || linkedinGenerated > 0) {
            const parts = [];
            if (gmailGenerated > 0) parts.push(`${gmailGenerated} Gmail draft(s)`);
            if (linkedinGenerated > 0) parts.push(`${linkedinGenerated} LinkedIn message(s)`);
            message = `Generated ${parts.join(' and ')} for leads with email.`;
            if (gmailSkipped > 0) message += ` ${gmailSkipped} already had pending draft(s).`;
        } else {
            message = gmailSkipped === leadsWithEmail.length
                ? 'All leads with email already have pending drafts and LinkedIn messages.'
                : 'No new drafts or messages generated.';
        }

        return res.json({
            success: totalNew > 0,
            message,
            generated: gmailGenerated,
            skipped: gmailSkipped,
            linkedinGenerated,
            totalWithEmail: leadsWithEmail.length
        });
    } catch (err) {
        console.error('Generate Gmail drafts error:', err);
        res.status(500).json({ error: err.message });
    }
}

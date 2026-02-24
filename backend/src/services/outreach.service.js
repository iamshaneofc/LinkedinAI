/**
 * Outreach Service - Multi-channel outreach (email, SMS) + approval-based LinkedIn send.
 */
import pool from '../db.js';

// Default export for outreach.controller (email, SMS, stats)
const outreachService = {
    async sendEmailOutreach(lead, campaignId, message, options = {}) {
        const { default: emailService } = await import('./email.service.js');
        if (!lead.email) return { success: false, error: 'No email' };
        try {
            const subject = options.subject || 'Connection request';
            const text = message || `Saw your profile—would be good to connect.`;
            await emailService.sendEmail(lead.email, subject, text);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    async sendSMSOutreach(lead, campaignId, message, options = {}) {
        return { success: false, note: 'SMS requires Twilio integration', error: 'Not implemented' };
    },
    async getOutreachStats(campaignId) {
        const r = await pool.query(
            `SELECT COUNT(*) as total,
             COUNT(CASE WHEN cl.status = 'completed' THEN 1 END) as completed
             FROM campaign_leads cl WHERE cl.campaign_id = $1`,
            [campaignId]
        );
        const row = r.rows[0];
        return { total: parseInt(row?.total || 0), completed: parseInt(row?.completed || 0) };
    }
};

export default outreachService;

export async function sendApprovedLeadImmediately(campaignId, leadId, stepType, content, approvalQueueId = null) {
    if (!['connection_request', 'message'].includes(stepType)) {
        console.log(`⏭️  Outreach: Skipping step_type "${stepType}" - not LinkedIn action`);
        return { sent: false, reason: 'unsupported_step' };
    }

    const phantomService = (await import('./phantombuster.service.js')).default;
    const SafetyService = (await import('./safety.service.js')).default;

    // Safety check
    const safe = await SafetyService.isSafeToProceed(stepType);
    if (!safe) {
        console.warn(`🛑 Outreach: Daily limit reached for ${stepType}, will be picked up by scheduler later`);
        await pool.query(
            `UPDATE campaign_leads SET status = 'pending', next_action_due = NOW() WHERE campaign_id = $1 AND lead_id = $2`,
            [campaignId, leadId]
        );
        return { sent: false, reason: 'limit_reached' };
    }

    // Fetch lead and campaign_lead
    const [leadRes, clRes] = await Promise.all([
        pool.query('SELECT * FROM leads WHERE id = $1', [leadId]),
        pool.query(
            'SELECT * FROM campaign_leads WHERE campaign_id = $1 AND lead_id = $2',
            [campaignId, leadId]
        )
    ]);

    const profile = leadRes.rows[0];
    const campaignLead = clRes.rows[0];
    if (!profile || !campaignLead) {
        console.warn(`⚠️ Outreach: Lead or campaign_lead not found`);
        return { sent: false, reason: 'not_found' };
    }

    if (!profile.linkedin_url) {
        console.warn(`⚠️ Outreach: Lead ${leadId} has no LinkedIn URL`);
        return { sent: false, reason: 'no_linkedin_url' };
    }

    // Mark as processing
    await pool.query(
        "UPDATE campaign_leads SET status = 'processing' WHERE campaign_id = $1 AND lead_id = $2",
        [campaignId, leadId]
    );

    const currentStep = campaignLead.current_step ?? 1;
    const lead = { campaign_id: campaignId, lead_id: leadId, current_step: currentStep };

    try {
        if (stepType === 'connection_request') {
            const result = await phantomService.autoConnect([profile], content || null);
            if (!result.success || !result.containerId) throw new Error('PhantomBuster returned success=false');

            await pool.query(
                "UPDATE campaign_leads SET last_container_id = $1 WHERE campaign_id = $2 AND lead_id = $3",
                [result.containerId, campaignId, leadId]
            );
            if (approvalQueueId) {
                await pool.query(
                    `UPDATE approval_queue SET admin_feedback = $1 WHERE id = $2`,
                    [`Sent via PhantomBuster. Container: ${result.containerId}`, approvalQueueId]
                );
            }
            await SafetyService.logAction('connection_request', { lead_id: leadId, container_id: result.containerId });
            await pool.query(
                `INSERT INTO automation_logs (campaign_id, lead_id, action, status, details) VALUES ($1, $2, $3, $4, $5)`,
                [
                    campaignId,
                    leadId,
                    'send_connection_request',
                    'sent',
                    JSON.stringify({
                        container_id: result.containerId,
                        step_type: 'connection_request',
                        message_preview: content ? content.substring(0, 100) : null,
                        has_message: !!content,
                        sent_at: new Date().toISOString(),
                        triggered_by: 'manual_approval'
                    })
                ]
            );
            console.log(`✅ [Outreach] Connection request sent for lead ${leadId}. Container: ${result.containerId}`);
        } else if (stepType === 'message') {
            const { buildSpreadsheetOptions } = await import('./messageCsvStore.js');
            const opts = buildSpreadsheetOptions(profile.linkedin_url, content);
            const result = await phantomService.sendMessage(profile, content, opts);
            if (!result.success || !result.containerId) throw new Error('PhantomBuster returned success=false');

            await pool.query(
                "UPDATE campaign_leads SET last_container_id = $1 WHERE campaign_id = $2 AND lead_id = $3",
                [result.containerId, campaignId, leadId]
            );
            await SafetyService.logAction('message', {
                lead_id: leadId,
                container_id: result.containerId,
                message_length: content?.length || 0
            });
            await pool.query(
                `INSERT INTO automation_logs (campaign_id, lead_id, action, status, details) VALUES ($1, $2, $3, $4, $5)`,
                [
                    campaignId,
                    leadId,
                    'send_message',
                    'sent',
                    JSON.stringify({
                        container_id: result.containerId,
                        message_length: content?.length || 0,
                        sent_at: new Date().toISOString(),
                        triggered_by: 'manual_approval'
                    })
                ]
            );
            console.log(`✅ [Outreach] Message sent for lead ${leadId}. Container: ${result.containerId}`);
        }

        // Advance to next step
        await advanceStep(lead);
        return { sent: true };
    } catch (error) {
        console.error(`❌ [Outreach] Failed to send for lead ${leadId}:`, error.message);

        await pool.query(
            `INSERT INTO automation_logs (campaign_id, lead_id, action, status, details) VALUES ($1, $2, $3, $4, $5)`,
            [
                campaignId,
                leadId,
                stepType === 'connection_request' ? 'send_connection_request' : 'send_message',
                'failed',
                JSON.stringify({ error: error.message, triggered_by: 'manual_approval' })
            ]
        );
        if (approvalQueueId) {
            await pool.query(`UPDATE approval_queue SET admin_feedback = $1 WHERE id = $2`, [
                `Failed to send: ${error.message}`,
                approvalQueueId
            ]);
        }
        await pool.query(
            "UPDATE campaign_leads SET status = 'pending' WHERE campaign_id = $1 AND lead_id = $2",
            [campaignId, leadId]
        );
        return { sent: false, error: error.message };
    }
}

async function advanceStep(lead) {
    const nextStepOrder = lead.current_step + 1;
    const nextStepRes = await pool.query(
        'SELECT * FROM sequences WHERE campaign_id = $1 AND step_order = $2',
        [lead.campaign_id, nextStepOrder]
    );

    if (nextStepRes.rows.length === 0) {
        await pool.query(
            "UPDATE campaign_leads SET status = 'completed', next_action_due = NULL, last_activity_at = NOW() WHERE campaign_id = $1 AND lead_id = $2",
            [lead.campaign_id, lead.lead_id]
        );
    } else {
        const nextStep = nextStepRes.rows[0];
        const delayDays = nextStep.delay_days || 1;
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + delayDays);
        await pool.query(
            "UPDATE campaign_leads SET status = 'pending', current_step = $2, next_action_due = $3, last_activity_at = NOW() WHERE campaign_id = $1 AND lead_id = $4",
            [lead.campaign_id, nextStepOrder, nextDate, lead.lead_id]
        );
    }
}

import pool from '../db.js';
import config from '../config/index.js';
import * as phantomService from './phantombuster.service.js';
// Note: AIService removed from scheduler - AI generation only happens when user explicitly requests it via campaign page
import { ApprovalService } from './approval.service.js';
import SafetyService from './safety.service.js';
import replyDetectionService from './reply-detection.service.js';
import { NotificationService } from './notification.service.js';

// ==========================================
// SCHEDULER ORCHESTRATOR (SEQUENTIAL)
// ==========================================
// Runs continuously: finds ONE lead due for the next step, executes it, waits for completion, then finds the next.
// NO parallel execution. NO time delay between leads (other than processing time).
export function initScheduler() {
    console.log("🚀 Scheduler: Starting sequential processing loop (No Cron)");
    runSequentialLoop();
}

async function runSequentialLoop() {
    let lastReplyCheck = 0;
    const REPLY_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

    while (true) {
        try {
            // Periodically check for LinkedIn replies
            if (Date.now() - lastReplyCheck > REPLY_CHECK_INTERVAL) {
                await replyDetectionService.checkAllActiveCampaigns();
                lastReplyCheck = Date.now();
            }

            const processed = await processNextLead();
            if (!processed) {
                // No leads due? Wait a bit to avoid hammering the DB
                // User said "no process of time between leads", but if there ARE NO leads, we must wait.
                // 5 seconds poll interval when idle.
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            // If lead was processed, we loop immediately to the next one.
        } catch (err) {
            console.error("❌ Scheduler Loop Error:", err.message);
            // Wait a bit on error to prevent log spam
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

async function processNextLead() {
    try {
        // 1. Find ONE lead that is ready for the next step
        // We look for leads where next_action_due has passed
        // JOIN sequence_variants to get the content
        const dueLeadsResult = await pool.query(`
            SELECT cl.*, s.type as step_type, sv.content as step_content, s.delay_days
            FROM campaign_leads cl
            JOIN sequences s ON cl.campaign_id = s.campaign_id AND cl.current_step = s.step_order
            LEFT JOIN sequence_variants sv ON s.id = sv.sequence_id AND sv.is_active = true
            WHERE (cl.next_action_due <= NOW() OR cl.next_action_due IS NULL)
            AND cl.status NOT IN ('failed', 'completed', 'processing', 'needs_approval')
            AND (cl.status = 'pending' OR cl.status = 'ready_for_action')
            ORDER BY cl.next_action_due ASC
            LIMIT 1
        `);

        if (dueLeadsResult.rows.length === 0) {
            return false; // No leads found
        }

        const lead = dueLeadsResult.rows[0];
        console.log(`⚡ Processing NEXT Lead: ${lead.lead_id} (Campaign ${lead.campaign_id})`);

        await executeStepForLead(lead);
        return true; // Processed a lead

    } catch (err) {
        console.error("❌ Scheduler Query Error:", err.message);
        return false;
    }
}

async function executeStepForLead(lead) {
    console.log(`🤖 Processing Lead ${lead.lead_id} -> Step ${lead.current_step} (${lead.step_type})`);

    const linkedInStepTypes = ['connection_request', 'message'];
    const supportedStepTypes = ['connection_request', 'message', 'email', 'gmail_outreach'];

    // 1. SAFETY CHECK: Have we hit the LinkedIn daily limit?
    const isLinkedInAction = linkedInStepTypes.includes(lead.step_type);
    if (isLinkedInAction) {
        const safe = await SafetyService.isSafeToProceed(lead.step_type);
        if (!safe) {
            console.warn(`🛑 [LIMIT REACHED] Skipping Lead ${lead.lead_id} to protect account safety.`);
            // Leaving status as pending/pending_approval so it can be picked up tomorrow.
            // Since we picked it up, we should probably "back off" or skip it in query.
            // But 'isSafeToProceed' likely checks GLOBAL limit. If limit is reached, NO leads should be processed.
            // So we should probably sleep? 
            // For now, let's just return. The loop will pick it (or another) up again. 
            // To prevent infinite tight loop on limit reached, we should sleep.
            await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 min if limit reached
            return;
        }
    }

    // Mark as processing
    await pool.query("UPDATE campaign_leads SET status = 'processing' WHERE campaign_id = $1 AND lead_id = $2", [lead.campaign_id, lead.lead_id]);

    try {
        // Fetch full lead details (need URL)
        const leadDetails = await pool.query("SELECT * FROM leads WHERE id = $1", [lead.lead_id]);
        const profile = leadDetails.rows[0];

        // --- HUMAN-IN-THE-LOOP CHECK ---
        const requiresApproval = ['message', 'connection_request', 'gmail_outreach'].includes(lead.step_type);
        const queueItemRes = await pool.query(
            "SELECT * FROM approval_queue WHERE campaign_id = $1 AND lead_id = $2 AND step_type = $3 ORDER BY created_at DESC LIMIT 1",
            [lead.campaign_id, lead.lead_id, lead.step_type]
        );
        const queueItem = queueItemRes.rows[0];

        if (requiresApproval && (!queueItem || queueItem.status !== 'approved')) {
            console.log(`✋ Admin Approval Required for Lead ${lead.lead_id}, Step ${lead.current_step}`);
            if (!queueItem) {
                if (lead.step_type === 'gmail_outreach') {
                    try {
                        const enrichmentRes = await pool.query("SELECT * FROM lead_enrichment WHERE lead_id = $1", [lead.lead_id]);
                        const enrichment = enrichmentRes.rows[0] || null;
                        let campaignContext = null;
                        const campRes = await pool.query("SELECT goal, type, description, target_audience FROM campaigns WHERE id = $1", [lead.campaign_id]);
                        if (campRes.rows[0]) campaignContext = campRes.rows[0];
                        const { default: AIService } = await import('./ai.service.js');
                        const draft = await AIService.generateGmailDraft(profile, enrichment, { campaign: campaignContext });
                        const content = JSON.stringify({ subject: draft.subject, body: draft.body });
                        await ApprovalService.addToQueue(lead.campaign_id, lead.lead_id, lead.step_type, content);
                        console.log(`📝 Gmail draft generated and added to approval queue`);
                    } catch (err) {
                        console.error('Gmail draft generation failed:', err.message);
                        const content = JSON.stringify({
                            subject: `Quick thought for ${profile.first_name}`,
                            body: `Saw your work at ${profile.company || 'your company'}—would be good to connect.\n\nBest`
                        });
                        await ApprovalService.addToQueue(lead.campaign_id, lead.lead_id, lead.step_type, content);
                    }
                } else {
                    const templateContent = lead.step_content || `Hi {firstName}, I'd like to connect.`;
                    let content = templateContent;
                    if (profile) {
                        content = content.replace(/\{firstName\}/g, profile.first_name || "there")
                            .replace(/\{lastName\}/g, profile.last_name || "")
                            .replace(/\{fullName\}/g, profile.full_name || "there")
                            .replace(/\{company\}/g, profile.company || "your company")
                            .replace(/\{title\}/g, profile.title || "your role");
                    }
                    console.log(`📝 Using template message (no AI generation)`);
                    await ApprovalService.addToQueue(lead.campaign_id, lead.lead_id, lead.step_type, content);
                }
            }
            await pool.query("UPDATE campaign_leads SET status = 'needs_approval' WHERE campaign_id = $1 AND lead_id = $2", [lead.campaign_id, lead.lead_id]);
            return;
        }

        const contentToSend = queueItem ? queueItem.generated_content : lead.step_content;
        console.log(`📝 Content to send: ${contentToSend ? contentToSend.substring(0, 100) + '...' : 'None'}`);

        if (lead.step_type === 'connection_request') {
            try {
                // Launch Phantom
                const result = await phantomService.autoConnect([profile], contentToSend);

                if (result.success && result.containerId) {
                    // Update DB with container ID
                    await pool.query(
                        "UPDATE campaign_leads SET last_container_id = $1 WHERE campaign_id = $2 AND lead_id = $3",
                        [result.containerId, lead.campaign_id, lead.lead_id]
                    );

                    // 🛑 WAIT FOR COMPLETION (Serial execution requirement)
                    console.log(`⏳ Waiting for Connection Request completion (Container: ${result.containerId})...`);
                    await phantomService.waitForCompletion(result.containerId, result.phantomId || process.env.AUTO_CONNECT_PHANTOM_ID, 10); // 10 mins max

                    // If we are here, it threw no error, so it finished "success" or "finished"

                    // Update approval queue
                    if (queueItem) {
                        await pool.query(
                            `UPDATE approval_queue SET admin_feedback = $1 WHERE id = $2`,
                            [`Sent via PhantomBuster. Container: ${result.containerId}`, queueItem.id]
                        );
                    }

                    // Log Action
                    await SafetyService.logAction(lead.step_type, {
                        lead_id: lead.lead_id,
                        container_id: result.containerId
                    });

                    // Log to automation_logs
                    await pool.query(
                        `INSERT INTO automation_logs (campaign_id, lead_id, action, status, details)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [
                            lead.campaign_id, lead.lead_id, 'send_connection_request', 'sent',
                            JSON.stringify({
                                container_id: result.containerId,
                                step_type: lead.step_type,
                                message_preview: contentToSend ? contentToSend.substring(0, 50) : null,
                                sent_at: new Date().toISOString()
                            })
                        ]
                    );

                    console.log(`✅ Connection request sent AND finished successfully.`);
                    const leadName = profile?.first_name || profile?.full_name || 'Lead';
                    await NotificationService.create({
                        type: 'connection_sent',
                        title: 'Connection request sent',
                        message: `Connection request sent to ${leadName}`,
                        data: { campaignId: lead.campaign_id, leadId: lead.lead_id, link: `/campaigns/${lead.campaign_id}` },
                    });
                } else {
                    throw new Error('PhantomBuster returned success=false');
                }
            } catch (error) {
                console.error(`❌ Failed to send connection request for lead ${lead.lead_id}:`, error.message);
                await pool.query(
                    `INSERT INTO automation_logs (campaign_id, lead_id, action, status, details)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [lead.campaign_id, lead.lead_id, 'send_connection_request', 'failed', JSON.stringify({ error: error.message, failed_at: new Date().toISOString() })]
                );
                if (queueItem) {
                    await pool.query(`UPDATE approval_queue SET admin_feedback = $1 WHERE id = $2`, [`Failed: ${error.message}`, queueItem.id]);
                }
                // Reset status to pending to retry? Or failed?
                // Usually retry is dangerous if it actually sent. 
                // If error is timeout, it might have sent. 
                // Let's mark as pending for retry if it's a network error, but here let's be safe.
                // Keeping original logic: pending (retry later)
                await pool.query("UPDATE campaign_leads SET status = 'pending' WHERE campaign_id = $1 AND lead_id = $2", [lead.campaign_id, lead.lead_id]);
                return;
            }

            await advanceStep(lead);

        } else if (lead.step_type === 'message') {
            console.log(`📧 Sending LinkedIn message to ${profile.full_name || profile.linkedin_url}`);
            try {
                const { buildSpreadsheetOptions } = await import('./messageCsvStore.js');
                const opts = buildSpreadsheetOptions(profile.linkedin_url, contentToSend);

                // phantomService.sendMessage waits internally!
                const result = await phantomService.sendMessage(profile, contentToSend, opts);

                if (result.success && result.containerId) {
                    await pool.query("UPDATE campaign_leads SET last_container_id = $1 WHERE campaign_id = $2 AND lead_id = $3", [result.containerId, lead.campaign_id, lead.lead_id]);
                    await SafetyService.logAction(lead.step_type, { lead_id: lead.lead_id, container_id: result.containerId, message_length: contentToSend.length });
                    await pool.query(
                        `INSERT INTO automation_logs (campaign_id, lead_id, action, status, details) VALUES ($1, $2, $3, $4, $5)`,
                        [lead.campaign_id, lead.lead_id, 'send_message', 'sent', JSON.stringify({ container_id: result.containerId, step_type: lead.step_type, sent_at: new Date().toISOString() })]
                    );
                    console.log(`✅ Message sent AND finished successfully.`);
                    const leadName = profile?.first_name || profile?.full_name || 'Lead';
                    await NotificationService.create({
                        type: 'message_sent',
                        title: 'Message sent',
                        message: `LinkedIn message sent to ${leadName}`,
                        data: { campaignId: lead.campaign_id, leadId: lead.lead_id, link: `/campaigns/${lead.campaign_id}` },
                    });
                }
            } catch (messageError) {
                console.error(`❌ Failed to send LinkedIn message:`, messageError.message);
                await pool.query(
                    `INSERT INTO automation_logs (campaign_id, lead_id, action, status, details) VALUES ($1, $2, $3, $4, $5)`,
                    [lead.campaign_id, lead.lead_id, 'send_message', 'failed', JSON.stringify({ error: messageError.message })]
                );
                // Continue despite failure? Original code continued.
                // We'll advance step to prevent stuck loop.
                console.log(`⚠️ Continuing despite message send failure`);
            }
            await advanceStep(lead);

        } else if (lead.step_type === 'email') {
            // Email is fast, but we process it in the loop anyway
            console.log(`📨 Triggering email failover for lead ${lead.lead_id}`);
            try {
                const enrichmentRes = await pool.query("SELECT * FROM lead_enrichment WHERE lead_id = $1", [lead.lead_id]);
                const { default: emailService } = await import('./email.service.js');
                await emailService.sendFailoverEmail(profile, lead.campaign_id, enrichmentRes.rows[0]);
                console.log(`✅ Failover email sent.`);
                await advanceStep(lead);
            } catch (error) {
                console.error(`❌ Failed to send failover email:`, error.message);
                await pool.query(
                    `INSERT INTO automation_logs (campaign_id, lead_id, action, status, details) VALUES ($1, $2, $3, $4, $5)`,
                    [lead.campaign_id, lead.lead_id, 'email_failover', 'failed', JSON.stringify({ error: error.message })]
                );
                await advanceStep(lead);
            }
        } else if (lead.step_type === 'gmail_outreach') {
            // Gmail draft was approved; no automatic send (user can copy to Gmail). Just advance.
            console.log(`📬 Gmail draft approved for lead ${lead.lead_id}, advancing step`);
            await advanceStep(lead);
        } else {
            console.warn(`⚠️ Unknown step_type "${lead.step_type}". Marking failed.`);
            await pool.query("UPDATE campaign_leads SET status = 'failed' WHERE campaign_id = $1 AND lead_id = $2", [lead.campaign_id, lead.lead_id]);
        }

    } catch (error) {
        console.error(`❌ Failed to process lead ${lead.lead_id}:`, error.message);
        await pool.query("UPDATE campaign_leads SET status = 'failed' WHERE campaign_id = $1 AND lead_id = $2", [lead.campaign_id, lead.lead_id]);
        await NotificationService.create({
            type: 'automation_failed',
            title: 'Automation failed',
            message: `Failed to process lead: ${error.message}`,
            data: { campaignId: lead.campaign_id, leadId: lead.lead_id, error: error.message, link: `/campaigns/${lead.campaign_id}` },
        });
    }
}

export async function advanceStep(lead) {
    const nextStepOrder = lead.current_step + 1;
    const nextStepRes = await pool.query("SELECT * FROM sequences WHERE campaign_id = $1 AND step_order = $2", [lead.campaign_id, nextStepOrder]);

    if (nextStepRes.rows.length === 0) {
        await pool.query("UPDATE campaign_leads SET status = 'completed', next_action_due = NULL, last_activity_at = NOW() WHERE campaign_id = $1 AND lead_id = $2", [lead.campaign_id, lead.lead_id]);
        console.log(`✅ Lead ${lead.lead_id} completed all steps.`);
        await NotificationService.create({
            type: 'automation_completed',
            title: 'Sequence completed',
            message: `Lead completed all steps in campaign`,
            data: { campaignId: lead.campaign_id, leadId: lead.lead_id, link: `/campaigns/${lead.campaign_id}` },
        });

        // Check if all leads in the campaign are completed
        const pendingCountRes = await pool.query(
            "SELECT COUNT(*) as count FROM campaign_leads WHERE campaign_id = $1 AND status NOT IN ('completed', 'failed', 'rejected')",
            [lead.campaign_id]
        );
        const pendingCount = parseInt(pendingCountRes.rows[0].count, 10);

        if (pendingCount === 0) {
            await pool.query("UPDATE campaigns SET status = 'completed' WHERE id = $1 AND status = 'active'", [lead.campaign_id]);

            const campaignRes = await pool.query("SELECT name FROM campaigns WHERE id = $1", [lead.campaign_id]);
            const campaignName = campaignRes.rows[0]?.name || 'Campaign';

            await NotificationService.create({
                type: 'campaign_completed',
                title: 'Campaign Completed',
                message: `All leads in "${campaignName}" have been processed.`,
                data: { campaignId: lead.campaign_id, link: `/campaigns/${lead.campaign_id}` }
            });
            console.log(`🎉 Campaign ${lead.campaign_id} completed!`);
        }
    } else {
        const nextStep = nextStepRes.rows[0];
        const delayDays = nextStep.delay_days || 1;
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + delayDays);
        await pool.query("UPDATE campaign_leads SET status = 'pending', current_step = $2, next_action_due = $3, last_activity_at = NOW() WHERE campaign_id = $1 AND lead_id = $4", [lead.campaign_id, nextStepOrder, nextDate, lead.lead_id]);
        console.log(`🗓️ Lead ${lead.lead_id} advanced to step ${nextStepOrder}. Next run: ${nextDate}`);
    }
}

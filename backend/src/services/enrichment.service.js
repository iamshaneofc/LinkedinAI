import pool from '../db.js';
import * as phantomService from './phantombuster.service.js';
import hunterService from './hunter.service.js';
import logger from '../utils/logger.js';

/**
 * Enrichment Service
 * Handles lead enrichment. Uses Profile Scraper when configured, or mock when not.
 * Note: Message Sender phantom also scrapes basic profile – that data is saved to lead_enrichment
 * automatically when sending messages, so a separate Profile Scraper is not required.
 */
class EnrichmentService {
    /**
     * Enrich a single lead using PhantomBuster Profile Scraper
     */
    async enrichLead(leadId) {
        try {
            // 1. Get lead details
            const leadResult = await pool.query(
                'SELECT * FROM leads WHERE id = $1',
                [leadId]
            );

            if (leadResult.rows.length === 0) {
                throw new Error('Lead not found');
            }

            const lead = leadResult.rows[0];

            if (!lead.linkedin_url) {
                throw new Error('Lead has no LinkedIn URL');
            }

            // CRM rule: Enrichment only for approved leads (connections do NOT bypass)
            if (lead.review_status !== 'approved') {
                throw new Error('Only approved (qualified) leads can be enriched. Please qualify this lead first.');
            }

            // 2. Launch PhantomBuster Profile Scraper
            const phantomId = process.env.PROFILE_SCRAPER_PHANTOM_ID;

            if (!phantomId) {
                console.log(`      Using mock enrichment (PROFILE_SCRAPER_PHANTOM_ID not configured – Message Sender captures profile data when sending)`);
                return await this.mockEnrichment(leadId, lead);
            }

            try {
                console.log(`      Scraping LinkedIn profile via PhantomBuster...`);
                const result = await phantomService.scrapeProfile(lead.linkedin_url);

                if (!result || !result.data || (Array.isArray(result.data) && result.data.length === 0)) {
                    console.log(`      ⚠️  PhantomBuster returned no data, using mock enrichment`);
                    return await this.mockEnrichment(leadId, lead);
                }

                // Handle both single object and array responses
                const profileData = Array.isArray(result.data) ? result.data[0] : result.data;

                if (!profileData) {
                    console.log(`      ⚠️  No profile data found, using mock enrichment`);
                    return await this.mockEnrichment(leadId, lead);
                }

                // 3. Parse and store enrichment data
                const enrichmentData = this.parseProfileData(profileData);

                // IMPORTANT: recent_posts and company_news are JSONB columns.
                // We must pass valid JSON strings for the ::jsonb casts.
                const recentPostsJson = JSON.stringify(enrichmentData.recent_posts || []);
                const companyNewsJson =
                    enrichmentData.company_news !== undefined &&
                        enrichmentData.company_news !== null
                        ? JSON.stringify(enrichmentData.company_news)
                        : null;

                await pool.query(
                    `INSERT INTO lead_enrichment (
                        lead_id, bio, interests, recent_posts, company_news
                    )
                    VALUES ($1, $2, $3::text[], $4::jsonb, $5::jsonb)
                    ON CONFLICT (lead_id) 
                    DO UPDATE SET 
                        bio = $2,
                        interests = $3::text[],
                        recent_posts = $4::jsonb,
                        company_news = $5::jsonb,
                        last_enriched_at = NOW()`,
                    [
                        leadId,
                        enrichmentData.bio,
                        enrichmentData.interests || [],
                        recentPostsJson,
                        companyNewsJson
                    ]
                );

                console.log(`      ✅ PhantomBuster enrichment complete`);



            } catch (phantomError) {
                console.log(`      ⚠️  PhantomBuster failed: ${phantomError.message}`);
                console.log(`      📝 Falling back to mock enrichment`);
                // Always fall back to mock - never throw error
                await this.mockEnrichment(leadId, lead);
            }

            // 4. Hunter.io Email Enrichment (New) - Runs even if PhantomBuster failed/skipped
            try {
                await this.enrichWithHunter(leadId);
            } catch (hunterErr) {
                logger.error(`      ⚠️ Hunter enrichment skipped: ${hunterErr.message}`);
            }

            return {
                success: true,
                leadId,
                source: phantomId ? 'phantombuster' : 'mock'
            };

        } catch (error) {
            console.error(`      ❌ Enrichment error: ${error.message}`);

            // If it's a "no LinkedIn URL" error, throw it
            if (error.message.includes('no LinkedIn URL') || error.message.includes('Lead not found')) {
                throw error;
            }

            // For any other error, try mock enrichment as last resort
            try {
                const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
                if (leadResult.rows.length > 0) {
                    console.log(`      📝 Attempting mock enrichment as fallback`);
                    return await this.mockEnrichment(leadId, leadResult.rows[0]);
                }
            } catch (fallbackError) {
                console.error(`      ❌ Mock enrichment also failed: ${fallbackError.message}`);
            }

            throw error;
        }
    }

    /**
     * Parse profile data from PhantomBuster response (JSON or CSV)
     */
    parseProfileData(profileData) {
        // PhantomBuster Profile Scraper: JSON uses description/summary/headline; CSV uses linkedinHeadline, linkedinDescription, etc.
        const bio = profileData.description ||
            profileData.summary ||
            profileData.headline ||
            profileData.linkedinHeadline ||
            (profileData.linkedinDescription && typeof profileData.linkedinDescription === 'string'
                ? profileData.linkedinDescription.substring(0, 1000) : '') ||
            '';

        // Interests: skills array, linkedinSkillsLabel (CSV), or interests array
        const interests = [];
        if (profileData.skills && Array.isArray(profileData.skills)) {
            interests.push(...profileData.skills.slice(0, 5));
        }
        if (profileData.linkedinSkillsLabel && typeof profileData.linkedinSkillsLabel === 'string') {
            const parts = profileData.linkedinSkillsLabel.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
            interests.push(...parts.slice(0, 5));
        }
        if (profileData.interests && Array.isArray(profileData.interests)) {
            interests.push(...profileData.interests);
        }

        // Recent posts/activity (JSON); CSV typically has no posts
        const recent_posts = [];
        if (profileData.posts && Array.isArray(profileData.posts)) {
            recent_posts.push(...profileData.posts.slice(0, 3).map(post => ({
                title: post.title || post.text?.substring(0, 100),
                engagement: post.likes || 0,
                date: post.date || null
            })));
        }

        const company_news = profileData.companyUpdates || null;
        const skills = profileData.skills || [];
        const education = profileData.education || [];
        const experience = profileData.experience || [];

        return {
            bio,
            interests: interests.slice(0, 10),
            recent_posts,
            company_news,
            skills: skills.slice(0, 15),
            education,
            experience
        };
    }

    /**
     * Mock enrichment (fallback when PhantomBuster is not available)
     */
    async mockEnrichment(leadId, lead) {
        console.log(`      📝 Creating mock enrichment data...`);

        const mockBio = `${lead.title || 'Professional'} at ${lead.company || 'a leading company'}. Passionate about innovation and growth.`;

        const mockInterests = [
            'Business Development',
            'Technology',
            'Innovation',
            'Leadership'
        ];

        const mockRecentPosts = [
            {
                title: 'Excited to share our latest product update',
                engagement: 45,
                date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
            }
        ];

        // Convert interests array to text[] format (PostgreSQL array)
        const interestsArray = Array.isArray(mockInterests) ? mockInterests : [];
        const recentPostsJson = JSON.stringify(mockRecentPosts);

        await pool.query(
            `INSERT INTO lead_enrichment (lead_id, bio, interests, recent_posts)
             VALUES ($1, $2, $3::text[], $4::jsonb)
             ON CONFLICT (lead_id) 
             DO UPDATE SET 
                bio = $2,
                interests = $3::text[],
                recent_posts = $4::jsonb,
                last_enriched_at = NOW()`,
            [leadId, mockBio, interestsArray, recentPostsJson]
        );

        return {
            success: true,
            leadId,
            enrichmentData: {
                bio: mockBio,
                interests: mockInterests,
                recent_posts: mockRecentPosts
            },
            source: 'mock'
        };
    }

    /**
     * Hunter.io Email Enrichment Flow
     */
    async enrichWithHunter(leadId) {
        try {
            // 1. Get lead details
            const leadResult = await pool.query(
                'SELECT * FROM leads WHERE id = $1',
                [leadId]
            );

            if (leadResult.rows.length === 0) return null;
            const lead = leadResult.rows[0];

            // Prevent duplicate calls
            if (lead.hunter_attempted) {
                logger.info(`      ⏭️ Hunter: Already attempted for lead ${leadId}`);
                return null;
            }

            let hunterResults = {
                email: lead.email,
                email_score: lead.email_score,
                email_verification_status: lead.email_verification_status,
                hunter_confidence: lead.hunter_confidence,
                email_source: lead.email_source,
                hunter_attempted: true
            };

            if (!lead.email) {
                // Try to find email
                const domain = await this._inferDomain(lead.company);
                if (domain && lead.first_name && lead.last_name) {
                    logger.info(`      🔍 Hunter: Attempting to find email for ${lead.first_name} ${lead.last_name} at ${domain}`);
                    const finderRes = await hunterService.findEmail(lead.first_name, lead.last_name, domain);

                    if (finderRes.success && finderRes.data && finderRes.data.email) {
                        const email = finderRes.data.email;
                        const score = finderRes.data.score;

                        // Verify found email
                        const verifyRes = await hunterService.verifyEmail(email);
                        const status = verifyRes.success && verifyRes.data ? verifyRes.data.result : 'unknown';
                        const verifyScore = verifyRes.success && verifyRes.data ? verifyRes.data.score : 0;

                        // Only save if result is valid or score is high
                        if (status === 'valid' || verifyScore > 70) {
                            hunterResults.email = email;
                            hunterResults.email_score = verifyScore;
                            hunterResults.email_verification_status = status;
                            hunterResults.hunter_confidence = score;
                            hunterResults.email_source = 'hunter';
                        }
                    }
                }
            } else {
                // Verify existing email
                logger.info(`      🔍 Hunter: Verifying existing email ${lead.email}`);
                const verifyRes = await hunterService.verifyEmail(lead.email);
                if (verifyRes.success && verifyRes.data) {
                    hunterResults.email_verification_status = verifyRes.data.result;
                    hunterResults.email_score = verifyRes.data.score;
                    hunterResults.email_source = lead.email_source || 'existing';
                }
            }

            // Update lead record
            await pool.query(
                `UPDATE leads SET 
                    email = $1,
                    email_score = $2,
                    email_verification_status = $3,
                    hunter_confidence = $4,
                    email_source = $5,
                    hunter_attempted = $6,
                    updated_at = NOW()
                WHERE id = $7`,
                [
                    hunterResults.email,
                    hunterResults.email_score,
                    hunterResults.email_verification_status,
                    hunterResults.hunter_confidence,
                    hunterResults.email_source,
                    hunterResults.hunter_attempted,
                    leadId
                ]
            );

            logger.info(`      ✅ Hunter enrichment complete for lead ${leadId}`);
            return hunterResults;

        } catch (error) {
            logger.error(`      ❌ Hunter enrichment error: ${error.message}`);
            return null;
        }
    }

    /**
     * Naive domain inference from company name
     */
    async _inferDomain(companyName) {
        if (!companyName) return null;

        // Clean company name
        let name = companyName.toLowerCase()
            .replace(/,?\s+(inc|llc|ltd|corp|corporation|group|pvt|private|pllc|consortium|solutions|technologies|systems)\.?$/g, '')
            .replace(/\s+/g, '')
            .replace(/[^a-z0-9]/g, '');

        if (name.length < 2) return null;

        // In a real production system, this would use a Search API or Clearbit Discovery
        return `${name}.com`;
    }

    /**
     * Get enrichment data for a lead
     */
    async getEnrichment(leadId) {
        const result = await pool.query(
            'SELECT * FROM lead_enrichment WHERE lead_id = $1',
            [leadId]
        );

        return result.rows[0] || null;
    }

    /**
     * Batch enrich multiple leads
     */
    async enrichLeads(leadIds) {
        console.log(`📦 Batch enriching ${leadIds.length} leads`);

        const results = [];

        for (const leadId of leadIds) {
            try {
                const result = await this.enrichLead(leadId);
                results.push(result);

                // Add delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.error(`❌ Failed to enrich lead ${leadId}:`, error.message);
                results.push({
                    success: false,
                    leadId,
                    error: error.message
                });
            }
        }

        return results;
    }

    /**
     * Check if lead needs enrichment (older than 30 days or never enriched)
     */
    async needsEnrichment(leadId) {
        const result = await pool.query(
            `SELECT last_enriched_at FROM lead_enrichment 
             WHERE lead_id = $1`,
            [leadId]
        );

        if (result.rows.length === 0) {
            return true; // Never enriched
        }

        const lastEnriched = new Date(result.rows[0].last_enriched_at);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        return lastEnriched < thirtyDaysAgo;
    }
}

// Export singleton instance
const enrichmentService = new EnrichmentService();
export default enrichmentService;

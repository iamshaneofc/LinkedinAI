import axios from 'axios';
import pool from '../db.js';

class ProfileEnrichmentService {
    constructor() {
        this.profileCache = new Map();
    }

    /**
     * Fetch and enrich profile data from LinkedIn URL
     * Uses the contact scraper service if available
     */
    async enrichProfileFromUrl(linkedinUrl) {
        if (!linkedinUrl) return null;

        // Check cache first
        if (this.profileCache.has(linkedinUrl)) {
            const cached = this.profileCache.get(linkedinUrl);
            // Cache for 24 hours
            if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
                return cached.data;
            }
        }

        try {
            // Try to find existing lead data first
            const leadData = await this.getLeadDataByUrl(linkedinUrl);
            if (leadData) {
                const enrichedProfile = {
                    fullName: leadData.full_name,
                    title: leadData.title,
                    company: leadData.company,
                    location: leadData.location || '',
                    industry: this.extractIndustryFromCompany(leadData.company, leadData.title),
                    metadata: this.extractMetadata(leadData.company, leadData.title),
                    source: 'database'
                };

                this.profileCache.set(linkedinUrl, {
                    data: enrichedProfile,
                    timestamp: Date.now()
                });

                return enrichedProfile;
            }

            // If not in database, try to scrape (future enhancement)
            return null;

        } catch (error) {
            console.error('Error enriching profile:', error);
            return null;
        }
    }

    /**
     * Get lead data from database by LinkedIn URL (exact or normalized: with/without trailing slash).
     */
    async getLeadDataByUrl(linkedinUrl) {
        if (!linkedinUrl || typeof linkedinUrl !== 'string') return null;
        const trimmed = linkedinUrl.trim();
        if (!trimmed) return null;
        try {
            const normalized = trimmed.replace(/\/$/, '');
            const withSlash = normalized + '/';
            const result = await pool.query(
                `SELECT full_name, title, company, location FROM leads
                 WHERE linkedin_url = $1 OR linkedin_url = $2
                 LIMIT 1`,
                [normalized, withSlash]
            );
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error fetching lead from database:', error);
            return null;
        }
    }

    /**
     * Extract industry from company name and title
     */
    extractIndustryFromCompany(company, title) {
        if (!company && !title) return '';

        const text = `${company} ${title}`.toLowerCase();

        // Industry keyword mapping
        const industryMap = {
            'Manufacturing': ['chemical', 'manufacturing', 'industrial', 'factory', 'production', 'materials'],
            'Technology': ['software', 'tech', 'digital', 'saas', 'cloud', 'ai', 'data'],
            'Finance': ['bank', 'financial', 'investment', 'capital', 'fund'],
            'Healthcare': ['health', 'medical', 'pharma', 'hospital', 'clinical'],
            'Retail': ['retail', 'commerce', 'store', 'shop'],
            'Education': ['education', 'university', 'school', 'training'],
            'Consulting': ['consulting', 'advisory', 'professional services'],
            'Real Estate': ['real estate', 'property', 'construction'],
            'Media': ['media', 'publishing', 'entertainment', 'broadcast'],
            'Energy': ['energy', 'oil', 'gas', 'renewable', 'power'],
            'Transportation': ['transport', 'logistics', 'shipping', 'delivery'],
            'Telecommunications': ['telecom', 'wireless', 'network', 'communications']
        };

        for (const [industry, keywords] of Object.entries(industryMap)) {
            if (keywords.some(keyword => text.includes(keyword))) {
                return industry;
            }
        }

        return '';
    }

    /**
     * Extract metadata tags from company and title
     */
    extractMetadata(company, title) {
        const metadata = [];
        const text = `${company} ${title}`.toLowerCase();

        const metadataPatterns = {
            'B2B': /\b(b2b|business-to-business|enterprise|commercial|industrial)\b/,
            'B2C': /\b(b2c|consumer|retail|individual)\b/,
            'Marketing': /\b(marketing|advertising|brand|promotion)\b/,
            'Sales': /\b(sales|business development|revenue)\b/,
            'Operations': /\b(operations|supply chain|logistics|production)\b/,
            'Engineering': /\b(engineering|technical|development)\b/,
            'Management': /\b(director|manager|executive|vp|ceo|cto|cfo)\b/,
            'Chemicals': /\b(chemical|chemistry|compound|formula)\b/,
            'Sustainability': /\b(sustainability|green|environmental|eco)\b/
        };

        for (const [tag, pattern] of Object.entries(metadataPatterns)) {
            if (pattern.test(text)) {
                metadata.push(tag);
            }
        }

        return metadata;
    }

    /**
     * Get enriched profile with fallback to manual data
     */
    async getEnrichedProfile(linkedinUrl, manualData = {}) {
        const enriched = await this.enrichProfileFromUrl(linkedinUrl);

        if (enriched) {
            return enriched;
        }

        // Fallback to manual data if provided
        if (manualData.industry || manualData.title) {
            return {
                industry: manualData.industry || '',
                title: manualData.title || '',
                metadata: manualData.metadata || [],
                source: 'manual'
            };
        }

        return null;
    }
}

const profileEnrichmentService = new ProfileEnrichmentService();
export default profileEnrichmentService;

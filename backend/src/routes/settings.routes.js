import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import profileEnrichmentService from '../services/profileEnrichment.service.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import config from '../config/index.js';
import AIService, { getClaudeModel } from '../services/ai.service.js';

const DEFAULT_LOGO_FILENAME = 'Kinnote.png';
const DEFAULT_LOGO_ABSOLUTE_PATH = path.join(__dirname, '..', 'config', DEFAULT_LOGO_FILENAME);

const NAV_LOGO_FILENAME = 'logoSCI.jpg';
const NAV_LOGO_ABSOLUTE_PATH = path.join(__dirname, '..', 'config', NAV_LOGO_FILENAME);

const SEARCH_LOGO_FILENAME = 'Search.png';
const SEARCH_LOGO_ABSOLUTE_PATH = path.join(__dirname, '..', 'config', SEARCH_LOGO_FILENAME);

// Get branding / profile for dashboard welcome (user name, company, logo, profile image, theme)
router.get('/branding', (req, res) => {
    try {
        const branding = {
            userName: process.env.APP_USER_NAME || config.branding.userName || '',
            companyName: process.env.APP_COMPANY_NAME || config.branding.companyName || 'Scottish Chemical Industries',
            logoUrl: process.env.APP_LOGO_URL || config.branding.logoUrl || '/api/settings/logo/default',
            navLogoUrl: process.env.APP_NAV_LOGO_URL || config.branding.navLogoUrl || '/api/settings/logo/nav',
            profileImageUrl: process.env.APP_PROFILE_IMAGE_URL || config.branding.profileImageUrl || '',
            theme: process.env.APP_THEME || config.branding.theme || 'default',
            linkedinAccountName: process.env.LINKEDIN_ACCOUNT_NAME || '',
            linkedinCookieConfigured: !!process.env.LINKEDIN_SESSION_COOKIE
        };
        res.json(branding);
    } catch (error) {
        console.error('Error getting branding:', error);
        res.status(500).json({ error: 'Failed to get branding' });
    }
});

// Serve the built-in default logo image (small icon left of Kinnote)
router.get('/logo/default', (req, res) => {
    try {
        if (!fs.existsSync(DEFAULT_LOGO_ABSOLUTE_PATH)) {
            return res.status(404).json({ error: 'Default logo not found' });
        }
        return res.sendFile(DEFAULT_LOGO_ABSOLUTE_PATH);
    } catch (error) {
        console.error('Error serving default logo:', error);
        return res.status(500).json({ error: 'Failed to load default logo' });
    }
});

// Serve the nav logo (below header, on top of navbar)
router.get('/logo/nav', (req, res) => {
    try {
        if (!fs.existsSync(NAV_LOGO_ABSOLUTE_PATH)) {
            return res.status(404).json({ error: 'Nav logo not found' });
        }
        return res.sendFile(NAV_LOGO_ABSOLUTE_PATH);
    } catch (error) {
        console.error('Error serving nav logo:', error);
        return res.status(500).json({ error: 'Failed to load nav logo' });
    }
});

// Serve the Search/Enrich icon (contacts table)
router.get('/logo/search', (req, res) => {
    try {
        if (!fs.existsSync(SEARCH_LOGO_ABSOLUTE_PATH)) {
            return res.status(404).json({ error: 'Search logo not found' });
        }
        return res.sendFile(SEARCH_LOGO_ABSOLUTE_PATH);
    } catch (error) {
        console.error('Error serving search logo:', error);
        return res.status(500).json({ error: 'Failed to load search logo' });
    }
});

// Update branding (writes to .env)
router.put('/branding', async (req, res) => {
    try {
        const { userName, companyName, logoUrl, profileImageUrl, theme } = req.body;
        const envPath = path.join(__dirname, '..', '..', '.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        const setEnv = (key, value) => {
            if (value === undefined || value === null) return;
            const str = String(value).trim();
            const regex = new RegExp(`^${key}=.*$`, 'm');
            const line = `${key}=${str}`;
            if (regex.test(envContent)) envContent = envContent.replace(regex, line);
            else envContent += (envContent ? '\n' : '') + line;
            process.env[key] = str;
        };
        setEnv('APP_USER_NAME', userName);
        setEnv('APP_COMPANY_NAME', companyName);
        setEnv('APP_LOGO_URL', logoUrl);
        setEnv('APP_PROFILE_IMAGE_URL', profileImageUrl);
        if (theme && ['default', 'blue', 'green', 'violet'].includes(theme)) setEnv('APP_THEME', theme);
        fs.writeFileSync(envPath, envContent.trim() + '\n');
        res.json({ success: true, message: 'Branding updated. Refresh the app to see changes.' });
    } catch (error) {
        console.error('Error updating branding:', error);
        res.status(500).json({ error: 'Failed to update branding' });
    }
});

// Get current settings (masked sensitive data)
router.get('/', async (req, res) => {
    try {
        const linkedinProfileUrl = process.env.LINKEDIN_PROFILE_URL || '';

        // Enrich profile data if URL is provided
        let enrichedProfile = null;
        if (linkedinProfileUrl) {
            enrichedProfile = await profileEnrichmentService.enrichProfileFromUrl(linkedinProfileUrl);
        }

        const settings = {
            phantombuster: {
                apiKey: process.env.PHANTOMBUSTER_API_KEY ? maskKey(process.env.PHANTOMBUSTER_API_KEY) : '',
                connectionsExportPhantomId: process.env.CONNECTIONS_EXPORT_PHANTOM_ID || '',
                networkBoosterPhantomId: process.env.NETWORK_BOOSTER_PHANTOM_ID || '',
                // LinkedIn Search Export phantom (canonical: SEARCH_EXPORT_PHANTOM_ID)
                searchExportPhantomId: process.env.SEARCH_EXPORT_PHANTOM_ID || process.env.SEARCH_LEADS_PHANTOM_ID || '',
                profileScraperPhantomId: process.env.PROFILE_SCRAPER_PHANTOM_ID || '',
                linkedinSessionCookie: process.env.LINKEDIN_SESSION_COOKIE ? maskKey(process.env.LINKEDIN_SESSION_COOKIE) : ''
            },
            ai: {
                provider: process.env.AI_PROVIDER || 'openai',
                openaiApiKey: process.env.OPENAI_API_KEY ? maskKey(process.env.OPENAI_API_KEY) : '',
                openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
                anthropicApiKey: process.env.ANTHROPIC_API_KEY ? maskKey(process.env.ANTHROPIC_API_KEY) : '',
                claudeModel: getClaudeModel()
            },
            email: {
                provider: process.env.EMAIL_PROVIDER || 'sendgrid',
                sendgridApiKey: process.env.SENDGRID_API_KEY ? maskKey(process.env.SENDGRID_API_KEY) : '',
                senderEmail: process.env.SENDER_EMAIL || '',
                awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ? maskKey(process.env.AWS_ACCESS_KEY_ID) : '',
                awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ? maskKey(process.env.AWS_SECRET_ACCESS_KEY) : '',
                awsRegion: process.env.AWS_REGION || 'us-east-1'
            },
            safety: {
                maxDailyInvites: parseInt(process.env.MAX_DAILY_INVITES) || 20,
                emailFailoverDelay: parseInt(process.env.EMAIL_FAILOVER_DELAY) || 7
            },
            preferences: {
                linkedinProfileUrl,
                preferredCompanyKeywords: process.env.PREFERRED_COMPANY_KEYWORDS || '',
                // Include enriched profile data
                industry: enrichedProfile?.industry || '',
                title: enrichedProfile?.title || '',
                company: enrichedProfile?.company || '',
                metadata: enrichedProfile?.metadata || []
            }
        };

        res.json(settings);
    } catch (error) {
        console.error('Error getting settings:', error);
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

// Update settings
router.put('/', async (req, res) => {
    try {
        const { phantombuster, ai, email, safety, preferences } = req.body;

        // Read current .env file
        const envPath = path.join(__dirname, '..', '..', '.env');
        let envContent = '';

        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }

        // Update environment variables
        const updates = {
            // PhantomBuster
            PHANTOMBUSTER_API_KEY: phantombuster?.apiKey,
            CONNECTIONS_EXPORT_PHANTOM_ID: phantombuster?.connectionsExportPhantomId,
            NETWORK_BOOSTER_PHANTOM_ID: phantombuster?.networkBoosterPhantomId,
            // LinkedIn Search Export phantom (canonical env var)
            SEARCH_EXPORT_PHANTOM_ID: phantombuster?.searchExportPhantomId ?? phantombuster?.searchLeadsPhantomId,
            PROFILE_SCRAPER_PHANTOM_ID: phantombuster?.profileScraperPhantomId,
            LINKEDIN_SESSION_COOKIE: phantombuster?.linkedinSessionCookie,

            // AI
            AI_PROVIDER: ai?.provider,
            OPENAI_API_KEY: ai?.openaiApiKey,
            OPENAI_MODEL: ai?.openaiModel,
            ANTHROPIC_API_KEY: ai?.anthropicApiKey,
            CLAUDE_MODEL: ai?.claudeModel,

            // Email
            EMAIL_PROVIDER: email?.provider,
            SENDGRID_API_KEY: email?.sendgridApiKey,
            SENDER_EMAIL: email?.senderEmail,
            AWS_ACCESS_KEY_ID: email?.awsAccessKeyId,
            AWS_SECRET_ACCESS_KEY: email?.awsSecretAccessKey,
            AWS_REGION: email?.awsRegion,

            // Safety
            MAX_DAILY_INVITES: safety?.maxDailyInvites,
            EMAIL_FAILOVER_DELAY: safety?.emailFailoverDelay,

            // Preferences
            LINKEDIN_PROFILE_URL: preferences?.linkedinProfileUrl,
            PREFERRED_COMPANY_KEYWORDS: preferences?.preferredCompanyKeywords
        };

        // Update .env file
        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined && value !== null && value !== '') {
                // Skip if value is masked (contains ***)
                if (typeof value === 'string' && value.includes('***')) {
                    continue;
                }

                const regex = new RegExp(`^${key}=.*$`, 'm');
                if (regex.test(envContent)) {
                    envContent = envContent.replace(regex, `${key}=${value}`);
                } else {
                    envContent += `\n${key}=${value}`;
                }

                // Also update process.env for immediate effect
                process.env[key] = value.toString();
            }
        }

        // Write updated .env file
        fs.writeFileSync(envPath, envContent.trim() + '\n');



        res.json({
            success: true,
            message: 'Settings updated successfully. Restart server for all changes to take effect.'
        });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// Test PhantomBuster connection
router.post('/test/phantombuster', async (req, res) => {
    try {
        const apiKey = process.env.PHANTOMBUSTER_API_KEY;

        if (!apiKey) {
            return res.status(400).json({
                success: false,
                message: 'PhantomBuster API key not configured'
            });
        }

        const response = await fetch('https://api.phantombuster.com/api/v2/agent/fetch-all', {
            headers: {
                'X-Phantombuster-Key': apiKey
            }
        });

        if (response.ok) {
            const data = await response.json();
            res.json({
                success: true,
                message: `Connected! Found ${data.length} phantoms.`,
                phantomCount: data.length
            });
        } else {
            res.json({
                success: false,
                message: 'Invalid API key or connection failed'
            });
        }
    } catch (error) {
        console.error('PhantomBuster test failed:', error);
        res.json({
            success: false,
            message: error.message
        });
    }
});

// Test OpenAI connection
router.post('/test/openai', async (req, res) => {
    try {
        const apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey) {
            return res.status(400).json({
                success: false,
                message: 'OpenAI API key not configured'
            });
        }

        const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (response.ok) {
            res.json({
                success: true,
                message: 'OpenAI API key is valid!'
            });
        } else {
            res.json({
                success: false,
                message: 'Invalid API key'
            });
        }
    } catch (error) {
        console.error('OpenAI test failed:', error);
        res.json({
            success: false,
            message: error.message
        });
    }
});

// Test Claude (Anthropic) connection
router.post('/test/claude', async (req, res) => {
    try {
        const apiKey = process.env.ANTHROPIC_API_KEY;

        if (!apiKey) {
            return res.status(400).json({
                success: false,
                message: 'Claude API key not configured'
            });
        }

        // Test with a simple message
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: getClaudeModel(),
                max_tokens: 10,
                messages: [{ role: 'user', content: 'Hi' }]
            })
        });

        if (response.ok) {
            res.json({
                success: true,
                message: 'Claude API key is valid!'
            });
        } else {
            const errorData = await response.json().catch(() => ({}));
            res.json({
                success: false,
                message: errorData.error?.message || 'Invalid API key'
            });
        }
    } catch (error) {
        console.error('Claude test failed:', error);
        res.json({
            success: false,
            message: error.message
        });
    }
});

// Test Email connection
router.post('/test/email', async (req, res) => {
    try {
        const provider = process.env.EMAIL_PROVIDER || 'sendgrid';

        if (provider === 'sendgrid') {
            const apiKey = process.env.SENDGRID_API_KEY;
            if (!apiKey) {
                return res.json({
                    success: false,
                    message: 'SendGrid API key not configured'
                });
            }

            const response = await fetch('https://api.sendgrid.com/v3/user/profile', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            if (response.ok) {
                res.json({
                    success: true,
                    message: 'SendGrid API key is valid!'
                });
            } else {
                res.json({
                    success: false,
                    message: 'Invalid SendGrid API key'
                });
            }
        } else {
            res.json({
                success: true,
                message: 'AWS SES configuration saved (test not implemented)'
            });
        }
    } catch (error) {
        console.error('Email test failed:', error);
        res.json({
            success: false,
            message: error.message
        });
    }
});

// Helper function to mask sensitive keys
function maskKey(key) {
    if (!key || key.length < 8) return '***';
    return key.substring(0, 4) + '***' + key.substring(key.length - 4);
}

export default router;

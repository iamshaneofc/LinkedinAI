import { Router } from 'express';
import {
    getCampaigns,
    createCampaign,
    getCampaignById,
    updateCampaign,
    duplicateCampaign,
    addLeadsToCampaign,
    launchCampaign,
    getLaunchesToday,
    deleteCampaign,
    addSequenceStep,
    updateSequenceStep,
    deleteSequenceStep,
    getCampaignLeads,
    bulkEnrichAndGenerate,
    generateGmailDrafts,
    pauseCampaign,
    resumeCampaign,
    getCampaignTemplates,

    autoConnectCampaign,
    estimateAudience
} from '../controllers/campaign.controller.js';

const router = Router();

router.get('/', getCampaigns);
router.get('/launches-today', getLaunchesToday);
router.get('/templates', getCampaignTemplates);
router.post('/estimate-audience', estimateAudience);
router.post('/', createCampaign);
router.get('/:id', getCampaignById);
router.put('/:id', updateCampaign);
router.post('/:id/duplicate', duplicateCampaign);
router.get('/:id/leads', getCampaignLeads);
router.post('/:id/leads', addLeadsToCampaign);
router.post('/:id/launch', launchCampaign);
router.put('/:id/pause', pauseCampaign);
router.put('/:id/resume', resumeCampaign);
router.post('/:id/bulk-enrich-generate', bulkEnrichAndGenerate);
router.post('/:id/generate-gmail-drafts', generateGmailDrafts);
router.post('/:id/auto-connect', autoConnectCampaign);
router.delete('/:id', deleteCampaign);



// Sequence Routes
router.post('/:id/sequences', addSequenceStep);
router.put('/sequences/:seqId', updateSequenceStep);
router.delete('/sequences/:seqId', deleteSequenceStep);

export default router;

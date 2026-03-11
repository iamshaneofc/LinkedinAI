import { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Sparkles, Users, Target, MessageSquare, Calendar, Check } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { FilterLogicBuilder } from './FilterLogicBuilder';
import axios from 'axios';
import { useToast } from './ui/toast';
import { cn } from '../lib/utils';
import { useNavigate } from 'react-router-dom';

const CAMPAIGN_GOAL_OPTIONS = [
    {
        value: 'grow_connections',
        type: 'standard',
        legacyGoal: 'connections',
        label: 'Grow Connections',
        icon: '🤝',
        description: 'Connection Request with 2nd and 3rd degree to grow your network. Uses your LinkedIn Inmail credits.',
    },
    {
        value: 'first_degree_message',
        type: 'nurture',
        legacyGoal: 'content_engagement',
        label: '1st Degree Message',
        icon: '💬',
        description: 'Message your existing network - General connect / Product / Service / Announcement campaign. Uses your LinkedIn messages.',
    },
    {
        value: 'event_promotion',
        type: 'event',
        legacyGoal: 'event_promotion',
        label: 'Event Promotion',
        icon: '🎉',
        description: 'Invite your network to an in-person event.',
        needsRegistrationLink: true,
    },
    {
        value: 'webinar',
        type: 'webinar',
        legacyGoal: 'event_promotion',
        label: 'Webinar',
        icon: '📺',
        description: 'Invite your network to a digital event / webinar.',
        needsRegistrationLink: true,
    },
    {
        value: 're_engage',
        type: 're_engagement',
        legacyGoal: 'brand_awareness',
        label: 'Re-engage',
        icon: '🔄',
        description: 'Reconnect with your engaged audience from a previous campaign. Reload a campaign with Outreach Status = Replied.',
    },
    {
        value: 'cold_outreach',
        type: 'cold_outreach',
        legacyGoal: 'pipeline',
        label: 'Cold Outreach',
        icon: '❄️',
        description: 'Product / Service / Announcement campaign to 2nd and 3rd degree. Uses your LinkedIn Inmail credits, as applicable, and therefore not recommended.',
    },
];

export default function CampaignWizard({ onClose, onCreate }) {
    const { addToast } = useToast();
    const navigate = useNavigate();
    const [currentStep, setCurrentStep] = useState(1);
    const [loading, setLoading] = useState(false);

    // Form Data
    const [campaignData, setCampaignData] = useState({
        name: '',
        campaign_goal: 'grow_connections',
        type: 'standard',
        goal: 'connections',
        description: '',
        registration_link: '',
        priority: 'normal',
        tags: [],

        // Audience filters (JSONB structure)
        filters: { operator: 'OR', groups: [] },

        // Schedule (optional)
        schedule_start: '',
        schedule_end: '',
        daily_cap: '',
        timezone: 'UTC'
    });

    // Audience estimation — only after user clicks Apply (linked to My Contacts filter apply)
    const [audienceCount, setAudienceCount] = useState(null);
    const [estimating, setEstimating] = useState(false);
    const [audiencePreview, setAudiencePreview] = useState([]);

    const estimateAudience = async () => {
        setEstimating(true);
        try {
            const res = await axios.post('/api/campaigns/estimate-audience', {
                filters: campaignData.filters
            });
            setAudienceCount(res.data.count);
            setAudiencePreview(res.data.preview || []);
        } catch (err) {
            console.error('Failed to estimate audience:', err);
            setAudienceCount(0);
        } finally {
            setEstimating(false);
        }
    };

    /** Apply current filters and count matching leads (same idea as Apply in My Contacts). */
    const handleApplyFilters = () => {
        const hasConditions = campaignData.filters.groups?.some(g => g.conditions?.length > 0 && g.conditions.some(c => c.value != null && String(c.value).trim() !== ''));
        if (!hasConditions) {
            addToast('Add at least one filter condition with a value', 'warning');
            return;
        }
        estimateAudience();
    };

    const handleNext = () => {
        const selectedGoal = CAMPAIGN_GOAL_OPTIONS.find((g) => g.value === campaignData.campaign_goal) || CAMPAIGN_GOAL_OPTIONS[0];

        // Validation
        if (currentStep === 1 && !campaignData.name.trim()) {
            addToast('Please enter a campaign name', 'warning');
            return;
        }
        if (currentStep === 1 && !campaignData.description.trim()) {
            addToast('Campaign description is required', 'warning');
            return;
        }
        if (currentStep === 1 && selectedGoal.needsRegistrationLink && !campaignData.registration_link?.trim()) {
            addToast('Registration link is required for this campaign goal', 'warning');
            return;
        }

        if (currentStep < 3) {
            setCurrentStep(currentStep + 1);
        }
    };

    const handleBack = () => {
        if (currentStep > 1) {
            setCurrentStep(currentStep - 1);
        }
    };

    const handleCreate = async () => {
        setLoading(true);
        try {
            const selectedGoal = CAMPAIGN_GOAL_OPTIONS.find((g) => g.value === campaignData.campaign_goal) || CAMPAIGN_GOAL_OPTIONS[0];
            // Convert filters to target_audience JSONB
            const payload = {
                name: campaignData.name.trim(),
                type: selectedGoal.type,
                goal: campaignData.campaign_goal,
                description: campaignData.description.trim(),
                target_audience: JSON.stringify(campaignData.filters), // Store as JSONB
                schedule_start: campaignData.schedule_start || undefined,
                schedule_end: campaignData.schedule_end || undefined,
                daily_cap: campaignData.daily_cap ? parseInt(campaignData.daily_cap, 10) : 0,
                timezone: campaignData.timezone || 'UTC',
                tags: campaignData.tags.length ? campaignData.tags : undefined,
                priority: campaignData.priority,
                settings: (campaignData.registration_link?.trim() ? { registration_link: campaignData.registration_link.trim() } : undefined)
            };

            await onCreate(payload);
            onClose();
        } catch (err) {
            console.error('Failed to create campaign:', err);
            addToast(err.response?.data?.error || 'Failed to create campaign', 'error');
        } finally {
            setLoading(false);
        }
    };

    /** Build payload for create (used by handleCreateAndSelectLeads). */
    const buildCreatePayload = () => {
        const selectedGoal = CAMPAIGN_GOAL_OPTIONS.find((g) => g.value === campaignData.campaign_goal) || CAMPAIGN_GOAL_OPTIONS[0];
        return {
            name: campaignData.name.trim(),
            type: selectedGoal.type,
            goal: campaignData.campaign_goal,
            description: campaignData.description.trim(),
            target_audience: JSON.stringify(campaignData.filters),
            schedule_start: campaignData.schedule_start || undefined,
            schedule_end: campaignData.schedule_end || undefined,
            daily_cap: campaignData.daily_cap ? parseInt(campaignData.daily_cap, 10) : 0,
            timezone: campaignData.timezone || 'UTC',
            tags: campaignData.tags.length ? campaignData.tags : undefined,
            priority: campaignData.priority,
            settings: (campaignData.registration_link?.trim() ? { registration_link: campaignData.registration_link.trim() } : undefined)
        };
    };

    /** Create campaign and go to My Contacts with filters in URL so the same filters are applied and you see the exact matching leads. */
    const handleCreateAndSelectLeads = async () => {
        if (audienceCount === 0 || estimating) return;
        const selectedGoal = CAMPAIGN_GOAL_OPTIONS.find((g) => g.value === campaignData.campaign_goal) || CAMPAIGN_GOAL_OPTIONS[0];
        if (!campaignData.name.trim()) { addToast('Enter a campaign name (Step 1) first', 'warning'); return; }
        if (!campaignData.description.trim()) { addToast('Enter a campaign description (Step 1) first', 'warning'); return; }
        if (selectedGoal.needsRegistrationLink && !campaignData.registration_link?.trim()) { addToast('Registration link required (Step 1)', 'warning'); return; }
        setLoading(true);
        try {
            const payload = buildCreatePayload();
            const id = await onCreate(payload);
            if (id) {
                // Pass filters in URL so My Contacts page applies them and shows the same filtered leads (no manual re-apply)
                const filtersParam = encodeURIComponent(JSON.stringify(campaignData.filters));
                onClose();
                navigate(`/my-contacts?campaignId=${id}&filters=${filtersParam}`);
                addToast('Campaign created. Select leads below and click "Add to Campaign" to add them.', 'success');
            }
        } catch (err) {
            addToast(err.response?.data?.error || 'Failed to create campaign', 'error');
        } finally {
            setLoading(false);
        }
    };

    const updateField = (field, value) => {
        setCampaignData((prev) => {
            if (field === 'campaign_goal') {
                const selectedGoal = CAMPAIGN_GOAL_OPTIONS.find((g) => g.value === value) || CAMPAIGN_GOAL_OPTIONS[0];
                const nextState = {
                    ...prev,
                    campaign_goal: value,
                    type: selectedGoal.type,
                    goal: value,
                };

                if (value === 're_engage') {
                    nextState.filters = {
                        operator: 'OR',
                        groups: [
                            {
                                operator: 'AND',
                                conditions: [
                                    { field: 'status', operator: 'equals', value: 'replied', exclude: false }
                                ]
                            }
                        ]
                    };
                }
                return nextState;
            }
            return { ...prev, [field]: value };
        });
    };

    const steps = [
        { number: 1, title: 'Campaign Basics', icon: Target },
        { number: 2, title: 'Target Audience', icon: Users },
        { number: 3, title: 'Review & Create', icon: Check }
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
            <Card className="w-full max-w-5xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <CardHeader className="border-b shrink-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-2xl">Create New Campaign</CardTitle>
                            <CardDescription>Build a targeted LinkedIn outreach campaign</CardDescription>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onClose}>
                            <X className="h-5 w-5" />
                        </Button>
                    </div>

                    {/* Step Indicator */}
                    <div className="flex items-center gap-2 mt-6">
                        {steps.map((step, idx) => {
                            const StepIcon = step.icon;
                            const isActive = currentStep === step.number;
                            const isCompleted = currentStep > step.number;

                            return (
                                <div key={step.number} className="flex items-center flex-1">
                                    <div className={cn(
                                        "flex items-center gap-2 flex-1 p-3 rounded-lg transition-all",
                                        isActive && "bg-primary/10 border-2 border-primary",
                                        isCompleted && "bg-green-500/10 border border-green-500/30",
                                        !isActive && !isCompleted && "bg-muted/30 border border-transparent"
                                    )}>
                                        <div className={cn(
                                            "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                                            isActive && "bg-primary text-primary-foreground",
                                            isCompleted && "bg-green-500 text-white",
                                            !isActive && !isCompleted && "bg-muted text-muted-foreground"
                                        )}>
                                            {isCompleted ? <Check className="w-4 h-4" /> : <StepIcon className="w-4 h-4" />}
                                        </div>
                                        <div className="min-w-0">
                                            <div className={cn(
                                                "text-xs font-medium truncate",
                                                isActive && "text-primary",
                                                isCompleted && "text-green-600",
                                                !isActive && !isCompleted && "text-muted-foreground"
                                            )}>
                                                {step.title}
                                            </div>
                                        </div>
                                    </div>
                                    {idx < steps.length - 1 && (
                                        <ChevronRight className="w-4 h-4 text-muted-foreground mx-1 shrink-0" />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </CardHeader>

                {/* Content */}
                <CardContent className="flex-1 overflow-y-auto p-6">
                    {/* Step 1: Campaign Basics */}
                    {currentStep === 1 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            {/* Campaign Name */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Campaign Name *</label>
                                <Input
                                    placeholder="e.g., Q1 2025 CEO Outreach"
                                    value={campaignData.name}
                                    onChange={(e) => updateField('name', e.target.value)}
                                    autoFocus
                                    className="text-lg"
                                />
                            </div>

                            {/* Campaign Goal Selection */}
                            <div className="space-y-3">
                                <label className="text-sm font-medium">Campaign Goal</label>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {CAMPAIGN_GOAL_OPTIONS.map((goal) => (
                                        <button
                                            key={goal.value}
                                            type="button"
                                            onClick={() => updateField('campaign_goal', goal.value)}
                                            className={cn(
                                                "p-4 rounded-lg border-2 text-left transition-all hover:border-primary/50",
                                                campaignData.campaign_goal === goal.value
                                                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                                                    : "border-muted hover:bg-muted/30"
                                            )}
                                        >
                                            <div className="text-2xl mb-2">{goal.icon}</div>
                                            <div className="font-semibold text-sm">{goal.label}</div>
                                            <div className="text-xs text-muted-foreground mt-1">{goal.description}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Description */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium flex items-center gap-2">
                                    Campaign Description *
                                </label>
                                <textarea
                                    className="w-full min-h-[100px] px-3 py-2 rounded-md border border-input bg-background text-sm resize-y"
                                    placeholder="Describe your campaign goals and value proposition. This helps AI generate better messages. Tip: Include a link here (e.g. product page, signup) — it will be sent to leads together with the AI-generated LinkedIn message."
                                    value={campaignData.description}
                                    onChange={(e) => updateField('description', e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    💡 Tip: Include your product/service name, target persona, and any link (e.g. signup or product page) — links in the description are sent to leads with the AI-generated LinkedIn message.
                                </p>
                            </div>
                            {/* Registration Link for Event Promotion & Webinar */}
                            {(campaignData.campaign_goal === 'event_promotion' || campaignData.campaign_goal === 'webinar') && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium flex items-center gap-2">
                                        Registration Link *
                                    </label>
                                    <Input
                                        type="url"
                                        placeholder="https://..."
                                        value={campaignData.registration_link}
                                        onChange={(e) => updateField('registration_link', e.target.value)}
                                        className="text-base"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        This link will be automatically included in outbound LinkedIn messages.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 2: Target Audience */}
                    {currentStep === 2 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                    <Users className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
                                    <div>
                                        <h3 className="font-semibold text-sm text-blue-900 dark:text-blue-100">Define Your Target Audience</h3>
                                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                                            Build filters to target specific leads from <strong>My Contacts</strong> (1st & 2nd degree). Count and preview show only those leads.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Filter Builder */}
                            <FilterLogicBuilder
                                filters={campaignData.filters}
                                onChange={(newFilters) => updateField('filters', newFilters)}
                            />

                            {/* Apply — same as My Contacts: apply filters and count matching leads */}
                            <div className="flex items-center gap-3 flex-wrap">
                                <Button
                                    type="button"
                                    onClick={handleApplyFilters}
                                    disabled={estimating || !campaignData.filters.groups?.some(g => g.conditions?.length > 0)}
                                    className="gap-2"
                                >
                                    {estimating ? (
                                        <>
                                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
                                            Applying...
                                        </>
                                    ) : (
                                        'Apply'
                                    )}
                                </Button>
                                <span className="text-xs text-muted-foreground">Apply to count leads in My Contacts matching the filters above.</span>
                            </div>

                            {/* Count only shown after Apply */}
                            {audienceCount === null ? (
                                <div className="rounded-lg border border-dashed border-muted bg-muted/20 p-6 text-center">
                                    <p className="text-sm text-muted-foreground">Build filters above and click <strong>Apply</strong> to see how many leads match.</p>
                                    <p className="text-xs text-muted-foreground mt-1">Then click the count to create the campaign and go to My Contacts to select leads.</p>
                                </div>
                            ) : (
                            <>
                            {/* Audience Count — clickable to create campaign and go to My Contacts */}
                                <Card
                                    className={cn(
                                        "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20",
                                        audienceCount > 0 && !estimating && "cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                                    )}
                                    onClick={() => {
                                        if (audienceCount === 0 || estimating) return;
                                        handleCreateAndSelectLeads();
                                    }}
                                    role="button"
                                    tabIndex={audienceCount > 0 && !estimating ? 0 : undefined}
                                    onKeyDown={(e) => {
                                        if (audienceCount > 0 && !estimating && (e.key === 'Enter' || e.key === ' ')) {
                                            e.preventDefault();
                                            handleCreateAndSelectLeads();
                                        }
                                    }}
                                >
                                    <CardContent className="pt-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="text-sm text-muted-foreground">
                                                    {audienceCount > 0 && !estimating ? (
                                                        <span className="underline decoration-dotted">Matching leads (click to create campaign & select leads)</span>
                                                    ) : (
                                                        'Matching leads'
                                                    )}
                                                </div>
                                                <div className="text-3xl font-bold text-green-600 dark:text-green-400">
                                                    {estimating ? '...' : audienceCount.toLocaleString()}
                                                </div>
                                            </div>
                                            <Users className="w-12 h-12 text-green-600/20" />
                                        </div>
                                    </CardContent>
                                </Card>
                            </>
                            )}

                            {/* Audience Preview */}
                            {audiencePreview.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-sm font-medium">Preview (First 5 matches)</h4>
                                    <div className="space-y-2">
                                        {audiencePreview.slice(0, 5).map((lead, idx) => (
                                            <div key={idx} className="p-3 rounded-lg border bg-muted/30 flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold">
                                                    {lead.first_name?.[0]}{lead.last_name?.[0]}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-sm truncate">{lead.full_name}</div>
                                                    <div className="text-xs text-muted-foreground truncate">
                                                        {lead.title} at {lead.company}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 3: Review & Create */}
                    {currentStep === 3 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="bg-gradient-to-r from-primary/10 to-blue-500/10 border border-primary/20 rounded-lg p-6">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                                        <Sparkles className="w-6 h-6 text-primary" />
                                    </div>
                                    <div className="flex-1">
                                        <h2 className="text-2xl font-bold">{campaignData.name}</h2>
                                        <div className="flex flex-wrap gap-2 mt-2">
                                            <Badge variant="outline">
                                                {CAMPAIGN_GOAL_OPTIONS.find((g) => g.value === campaignData.campaign_goal)?.label}
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Summary Cards */}
                            <div className="grid md:grid-cols-2 gap-4">
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-sm flex items-center gap-2">
                                            <Users className="w-4 h-4" />
                                            Target Audience
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-primary">
                                            {audienceCount !== null ? audienceCount.toLocaleString() : '—'}
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            {campaignData.filters.groups.length} filter group(s) defined
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-sm flex items-center gap-2">
                                            <MessageSquare className="w-4 h-4" />
                                            Campaign Details
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Campaign Goal:</span>
                                            <span className="font-medium">
                                                {CAMPAIGN_GOAL_OPTIONS.find((g) => g.value === campaignData.campaign_goal)?.label}
                                            </span>
                                        </div>

                                    </CardContent>
                                </Card>
                            </div>

                            {/* Description */}
                            {campaignData.description && (
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-sm">Campaign Description</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-muted-foreground italic">"{campaignData.description}"</p>
                                    </CardContent>
                                </Card>
                            )}

                            {/* Advanced Settings (Collapsible) */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-sm flex items-center gap-2">
                                        <Calendar className="w-4 h-4" />
                                        Schedule & Limits
                                        <Badge variant="secondary" className="text-xs ml-auto">Optional</Badge>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid md:grid-cols-1 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-medium text-muted-foreground">Timezone</label>
                                            <select
                                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                value={campaignData.timezone}
                                                onChange={(e) => updateField('timezone', e.target.value)}
                                            >
                                                <option value="America/Los_Angeles">Pacific Time (PT)</option>
                                                <option value="America/Denver">Mountain Time (MT)</option>
                                                <option value="America/Chicago">Central Time (CT)</option>
                                                <option value="America/New_York">Eastern Time (ET)</option>
                                                <option value="UTC">Coordinated Universal Time (UTC)</option>
                                                <option value="Europe/London">Greenwich Mean Time (GMT)</option>
                                                <option value="Europe/Paris">Central European Time (CET)</option>
                                                <option value="Asia/Dubai">Gulf Standard Time (GST)</option>
                                                <option value="Asia/Kolkata">India Standard Time (IST)</option>
                                                <option value="Asia/Singapore">Singapore Standard Time (SGT)</option>
                                                <option value="Asia/Tokyo">Japan Standard Time (JST)</option>
                                                <option value="Australia/Sydney">Australian Eastern Time (AET)</option>
                                            </select>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Next Steps Info */}
                            <div className="bg-muted/50 border rounded-lg p-4">
                                <h4 className="font-semibold text-sm mb-2">📋 What happens next?</h4>
                                <ul className="text-xs text-muted-foreground space-y-1.5">
                                    <li>• Your campaign will be created in <strong>Draft</strong> status</li>
                                    <li>• Add leads to your campaign from the Leads page</li>
                                    <li>• Configure message sequences in the campaign detail page</li>
                                    <li>• Launch when ready to start outreach</li>
                                </ul>
                            </div>
                        </div>
                    )}
                </CardContent>

                {/* Footer */}
                <div className="border-t p-4 flex items-center justify-between shrink-0 bg-muted/30">
                    <Button
                        variant="ghost"
                        onClick={handleBack}
                        disabled={currentStep === 1 || loading}
                        className="gap-2"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Back
                    </Button>

                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose} disabled={loading}>
                            Cancel
                        </Button>
                        {currentStep < 3 ? (
                            <Button onClick={handleNext} className="gap-2">
                                Next
                                <ChevronRight className="w-4 h-4" />
                            </Button>
                        ) : (
                            <Button onClick={handleCreate} disabled={loading} className="gap-2">
                                {loading ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Creating...
                                    </>
                                ) : (
                                    <>
                                        <Check className="w-4 h-4" />
                                        Create Campaign
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </div>
            </Card>
        </div>
    );
}

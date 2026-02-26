import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Plus, Play, Pause, MoreVertical, Trash2, Edit2, Users,
    TrendingUp, Calendar, Target, ArrowRight, Search, Filter,
    CheckCircle2, Clock, XCircle, Zap, Copy, Tag, Flag, X, TrendingDown,
    Megaphone, BarChart2, RefreshCw, ChevronDown
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { useToast } from '../components/ui/toast';
import { Skeleton } from '../components/ui/skeleton';
import { useTimeFilter } from '../context/TimeFilterContext';
import PageGuide from '../components/PageGuide';
import CampaignWizard from '../components/CampaignWizard';
import { cn } from '../lib/utils';

// ── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
    active: { icon: Zap, color: '#10B981', bg: 'rgba(16,185,129,0.12)', label: 'Active', pulse: true },
    draft: { icon: Clock, color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', label: 'Draft', pulse: false },
    paused: { icon: Pause, color: '#64748B', bg: 'rgba(100,116,139,0.12)', label: 'Paused', pulse: false },
    completed: { icon: CheckCircle2, color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)', label: 'Completed', pulse: false },
};
function getStatus(s) { return STATUS_CONFIG[s] || STATUS_CONFIG.draft; }

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(ts) {
    if (!ts) return '';
    const d = Date.now() - new Date(ts).getTime();
    const m = Math.floor(d / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}
function rateColor(r) {
    if (r >= 30) return '#10b981';
    if (r >= 15) return '#f59e0b';
    return '#64748b';
}

// ── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, accent, icon: Icon, suffix = '', pulse = false }) {
    return (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <Card className="relative border border-border/40 bg-card/60 backdrop-blur-xl overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                <div className="absolute inset-0 opacity-40" style={{ background: `radial-gradient(circle at top right, ${accent}20, transparent 65%)` }} />
                <CardContent className="p-5 relative z-10">
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}20` }}>
                            <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
                        </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-extrabold tracking-tight" style={{ color: accent }}>{value}{suffix}</span>
                        {pulse && value > 0 && (
                            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: accent }} />
                        )}
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}

// ── Campaign Card ────────────────────────────────────────────────────────────
function CampaignCard({ campaign, index, onNavigate, onDuplicate, onLaunch, onPause, onResume, onDelete, launchDisabled }) {
    const sc = getStatus(campaign.status);
    const Icon = sc.icon;
    const rate = campaign.response_rate || 0;
    const rc = rateColor(rate);
    const preview = campaign.description || 'No description provided.';

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.3, delay: index * 0.04 }}
            layout
        >
            <Card
                className="group relative border border-border/30 bg-card/60 backdrop-blur-xl shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden"
                onClick={() => onNavigate(campaign.id)}
                style={{ borderLeft: `3px solid ${sc.color}` }}
            >
                {/* Glow shimmer on hover */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                    style={{ background: `radial-gradient(ellipse at top left, ${sc.color}12, transparent 60%)` }} />

                <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                            {/* Status pill */}
                            <div className="flex items-center gap-2 mb-2">
                                <span
                                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border"
                                    style={{ color: sc.color, backgroundColor: sc.bg, borderColor: `${sc.color}30` }}
                                >
                                    {sc.pulse && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: sc.color }} />}
                                    <Icon className="w-2.5 h-2.5" />
                                    {sc.label}
                                </span>
                            </div>
                            <CardTitle className="text-sm font-bold leading-snug text-foreground group-hover:text-primary transition-colors truncate">
                                {campaign.name}
                            </CardTitle>
                            <p className="text-[12px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                                {preview}
                            </p>
                        </div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 -mt-1 -mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <MoreVertical className="h-3.5 w-3.5" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-card/95 backdrop-blur-xl border-border/50">
                                <DropdownMenuLabel className="text-xs">Actions</DropdownMenuLabel>
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onNavigate(campaign.id); }} className="gap-2 text-xs">
                                    <BarChart2 className="h-3.5 w-3.5" /> View Performance
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onNavigate(campaign.id); }} className="gap-2 text-xs">
                                    <Edit2 className="h-3.5 w-3.5" /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => onDuplicate(campaign.id, e)} className="gap-2 text-xs">
                                    <Copy className="h-3.5 w-3.5" /> Duplicate
                                </DropdownMenuItem>
                                {campaign.status === 'draft' && (
                                    <DropdownMenuItem
                                        onClick={(e) => !launchDisabled && onLaunch(campaign.id, e)}
                                        className={cn("gap-2 text-xs", launchDisabled && "opacity-60 pointer-events-none")}
                                        disabled={launchDisabled}
                                    >
                                        <Play className="h-3.5 w-3.5" /> {launchDisabled ? 'Launch (limit reached)' : 'Launch'}
                                    </DropdownMenuItem>
                                )}
                                {campaign.status === 'active' && (
                                    <DropdownMenuItem onClick={(e) => onPause(campaign.id, e)} className="gap-2 text-xs">
                                        <Pause className="h-3.5 w-3.5" /> Pause
                                    </DropdownMenuItem>
                                )}
                                {campaign.status === 'paused' && (
                                    <DropdownMenuItem onClick={(e) => onResume(campaign.id, e)} className="gap-2 text-xs">
                                        <Play className="h-3.5 w-3.5" /> Resume
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={(e) => onDelete(campaign.id, e)} className="gap-2 text-xs text-destructive focus:text-destructive">
                                    <Trash2 className="h-3.5 w-3.5" /> Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </CardHeader>

                <CardContent className="px-4 pb-4 space-y-3">
                    {/* Metrics */}
                    <div className="flex items-center gap-3 text-xs">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Users className="h-3.5 w-3.5" />
                            <span className="font-semibold text-foreground">{campaign.lead_count || 0}</span>
                            <span>leads</span>
                        </div>
                        <div className="w-px h-3 bg-border/60" />
                        <div className="flex items-center gap-1 font-bold" style={{ color: rc }}>
                            {rate >= 15 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                            <span className="text-sm">{rate}%</span>
                        </div>
                        <div className="flex-1 flex justify-end">
                            <span className="text-[10px] text-muted-foreground/70">{timeAgo(campaign.created_at)}</span>
                        </div>
                    </div>

                    {/* Progress bar */}
                    <div className="h-[3px] bg-muted/40 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${campaign.progress || 0}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut', delay: index * 0.05 }}
                            style={{ backgroundColor: sc.color }}
                        />
                    </div>

                    {/* Tags */}
                    {(campaign.goal || campaign.type || campaign.priority) && (
                        <div className="flex flex-wrap gap-1">
                            {campaign.goal && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                                    {campaign.goal}
                                </span>
                            )}
                            {campaign.type && campaign.type !== 'standard' && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted/60 text-muted-foreground border border-border/40">
                                    {campaign.type}
                                </span>
                            )}
                            {campaign.priority && campaign.priority !== 'normal' && (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                    <Flag className="h-2.5 w-2.5" />{campaign.priority}
                                </span>
                            )}
                        </div>
                    )}

                    {/* View arrow */}
                    <div className="flex justify-end pt-1">
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-200">
                            View details <ArrowRight className="w-3 h-3" />
                        </span>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function CampaignsPage() {
    const navigate = useNavigate();
    const { addToast } = useToast();
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterGoal, setFilterGoal] = useState('all');
    const [filterType, setFilterType] = useState('all');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const { period, month, year } = useTimeFilter();
    const [launchesToday, setLaunchesToday] = useState({ count: 0, limit: 2, countWeek: 0, limitWeek: 8 });
    const [limitEnforced, setLimitEnforced] = useState(true);
    const [showQueuedModal, setShowQueuedModal] = useState(false);
    const [queuedCampaignName, setQueuedCampaignName] = useState('');
    useEffect(() => {
        try { setLimitEnforced(localStorage.getItem('campaignLimitEnforced') !== 'false'); } catch { }
    }, []);
    useEffect(() => {
        axios.get('/api/campaigns/launches-today').then((r) => {
            if (r.data && typeof r.data.count === 'number') setLaunchesToday({
                count: r.data.count,
                limit: r.data.limit ?? 2,
                countWeek: typeof r.data.countWeek === 'number' ? r.data.countWeek : 0,
                limitWeek: r.data.limitWeek ?? 8,
            });
        }).catch(() => {});
    }, []);

    useEffect(() => { fetchCampaigns(); }, [period, month, year]);

    const fetchCampaigns = async () => {
        try {
            setError(null);
            setLoading(true);

            // Calculate range based on global context
            const now = new Date();
            let start, end;
            if (period === "daily") {
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            } else if (period === "weekly") {
                const day = now.getDay() || 7;
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
                end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
            } else if (period === "monthly") {
                start = new Date(year, month, 1);
                end = new Date(year, month + 1, 1);
            } else if (period === "yearly") {
                start = new Date(year, 0, 1);
                end = new Date(year + 1, 0, 1);
            }

            const params = new URLSearchParams();
            if (start) params.set('createdFrom', start.toISOString());
            if (end) params.set('createdTo', end.toISOString());

            const res = await axios.get(`/api/campaigns?${params.toString()}`);
            setCampaigns(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            const errorMsg = err.response?.data?.error || err.message || 'Could not load campaigns';
            addToast(`Error: ${errorMsg}`, 'error');
            setError(errorMsg);
            setCampaigns([]);
        } finally {
            setLoading(false);
        }
    };

    const createCampaign = async (payload) => {
        try {
            const res = await axios.post('/api/campaigns', payload);
            if (res.data) {
                addToast('Campaign created successfully', 'success');
                fetchCampaigns();
                setShowCreateModal(false);
                if (res.data.id) return res.data.id;
            }
        } catch (err) {
            const errorMsg = err.response?.data?.error || err.message || 'Failed to create campaign';
            addToast(`Error: ${errorMsg}`, 'error');
        }
    };

    const duplicateCampaign = async (id, e) => {
        e?.stopPropagation();
        try {
            const res = await axios.post(`/api/campaigns/${id}/duplicate`);
            if (res.data?.id) { addToast('Campaign duplicated', 'success'); fetchCampaigns(); navigate(`/campaigns/${res.data.id}`); }
        } catch (err) { addToast(err.response?.data?.error || 'Failed to duplicate', 'error'); }
    };

    const atLaunchLimit = limitEnforced && (launchesToday.count >= launchesToday.limit || launchesToday.countWeek >= launchesToday.limitWeek);

    const launchCampaign = async (id, e) => {
        e.stopPropagation();
        if (atLaunchLimit) {
            addToast(`Daily limit reached (${launchesToday.limit} campaigns/day). You can still create campaigns.`, 'warning');
            return;
        }
        try {
            const res = await axios.post(`/api/campaigns/${id}/launch`, limitEnforced ? {} : { bypassLimit: true });
            addToast(`Campaign launched! Processed ${res.data.leadsProcessed} leads.`, 'success');
            setLaunchesToday((prev) => ({ ...prev, count: prev.count + 1 }));
            fetchCampaigns();
        } catch (err) {
            const data = err.response?.data;
            if (data?.code === 'CAMPAIGN_ALREADY_RUNNING') {
                setQueuedCampaignName(data.runningCampaignName || 'A campaign');
                setShowQueuedModal(true);
                return;
            }
            if (data?.code === 'LAUNCH_LIMIT_REACHED' || data?.code === 'LAUNCH_LIMIT_WEEK_REACHED') {
                addToast(data.error || 'Launch limit reached.', 'warning');
                setLaunchesToday((prev) => ({ ...prev, count: data.launchesToday ?? prev.count, countWeek: data.launchesWeek ?? prev.countWeek }));
                return;
            }
            addToast(data?.error || 'Failed to launch', 'error');
        }
    };

    const pauseCampaign = async (id, e) => {
        e.stopPropagation();
        try { await axios.post(`/api/campaigns/${id}/pause`); addToast('Campaign paused', 'success'); fetchCampaigns(); }
        catch (err) { addToast(err.response?.data?.error || 'Failed to pause', 'error'); }
    };

    const resumeCampaign = async (id, e) => {
        e.stopPropagation();
        try { await axios.post(`/api/campaigns/${id}/resume`); addToast('Campaign resumed', 'success'); fetchCampaigns(); }
        catch (err) { addToast(err.response?.data?.error || 'Failed to resume', 'error'); }
    };

    const deleteCampaign = async (id, e) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure you want to delete this campaign?')) return;
        try { await axios.delete(`/api/campaigns/${id}`); addToast('Campaign deleted', 'success'); fetchCampaigns(); }
        catch (err) { addToast(err.response?.data?.error || 'Failed to delete', 'error'); }
    };

    const filteredCampaigns = campaigns.filter((c) => {
        const matchesSearch = !searchTerm || c.name?.toLowerCase().includes(searchTerm.toLowerCase()) || c.description?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
        const matchesGoal = filterGoal === 'all' || c.goal === filterGoal;
        const matchesType = filterType === 'all' || c.type === filterType;
        return matchesSearch && matchesStatus && matchesGoal && matchesType;
    });

    const stats = {
        total: campaigns.length,
        active: campaigns.filter(c => c.status === 'active').length,
        draft: campaigns.filter(c => c.status === 'draft').length,
        totalLeads: campaigns.reduce((sum, c) => sum + (c.lead_count || 0), 0),
    };

    const hasActiveFilters = filterStatus !== 'all' || filterGoal !== 'all' || filterType !== 'all';
    const clearFilters = () => { setFilterStatus('all'); setFilterGoal('all'); setFilterType('all'); };

    return (
        <div className="relative flex flex-col min-h-0 pb-8">
            {/* Aurora background */}
            <div className="aurora-bg fixed inset-0 -z-10" />
            <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background/95 via-background/90 to-background" />

            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">

                {/* ── Header ─────────────────────────────────────────────── */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-border/30">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 via-blue-500/15 to-cyan-500/20 border border-indigo-500/25 shadow-lg shadow-indigo-500/10 overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                            <Megaphone className="relative w-6 h-6 text-indigo-500" />
                        </div>
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Campaigns</h1>
                            <p className="text-muted-foreground text-sm mt-0.5">Manage your LinkedIn outreach campaigns</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {/* Launch limits: label "Limits" + tooltip with day/week rows */}
                        <div className="flex items-center gap-1.5 shrink-0 h-9">
                            <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span
                                            className={cn(
                                                "inline-flex items-center h-8 px-2.5 rounded-lg border text-xs font-medium cursor-default",
                                                (limitEnforced && (launchesToday.count >= launchesToday.limit || launchesToday.countWeek >= launchesToday.limitWeek))
                                                    ? "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400"
                                                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                            )}
                                        >
                                            Limits
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="font-normal">
                                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Campaign limits</p>
                                        <div className="space-y-1 text-xs tabular-nums">
                                            <p>Day &nbsp; {launchesToday.count} / {launchesToday.limit}</p>
                                            <p>Week {launchesToday.countWeek} / {launchesToday.limitWeek}</p>
                                        </div>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <button
                                type="button"
                                onClick={() => {
                                    const next = !limitEnforced;
                                    setLimitEnforced(next);
                                    try { localStorage.setItem('campaignLimitEnforced', next ? 'true' : 'false'); } catch { }
                                }}
                                className={cn(
                                    "h-8 px-2 rounded-lg border text-xs font-medium transition-colors",
                                    "border-border/60 bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground",
                                    limitEnforced && "ring-1 ring-primary/30 text-primary"
                                )}
                                title={limitEnforced ? "Limits on (2/day, 8/week). Click to turn off for testing." : "Limits off (testing). Click to turn on."}
                            >
                                {limitEnforced ? 'On' : 'Off'}
                            </button>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 rounded-xl border-border/50 hover:border-primary/30 hover:bg-primary/5"
                            onClick={fetchCampaigns}
                        >
                            <RefreshCw className="w-4 h-4" /> Refresh
                        </Button>
                        <Button
                            size="sm"
                            className="gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 hover:from-indigo-500 hover:via-blue-500 hover:to-cyan-500 text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all duration-300 border-0"
                            onClick={() => setShowCreateModal(true)}
                        >
                            <Plus className="w-4 h-4" /> Create Campaign
                        </Button>
                    </div>
                </div>

                {/* ── Stat Cards ─────────────────────────────────────────── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <StatCard label="Total" value={stats.total} accent="#6366f1" icon={Megaphone} />
                    <StatCard label="Active" value={stats.active} accent="#10b981" icon={Zap} pulse />
                    <StatCard label="Draft" value={stats.draft} accent="#f59e0b" icon={Clock} />
                    <StatCard label="Total Leads" value={stats.totalLeads.toLocaleString()} accent="#8b5cf6" icon={Users} />
                </div>

                {/* ── Toolbar ────────────────────────────────────────────── */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Search campaigns..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-8 h-9 rounded-xl border-border/50 bg-card/60 backdrop-blur-sm text-sm"
                        />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        {/* Status filter */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className={cn("h-9 gap-1.5 rounded-xl border-border/50 text-xs", filterStatus !== 'all' && "border-primary/40 bg-primary/10 text-primary")}>
                                    <Filter className="h-3.5 w-3.5" />
                                    Status {filterStatus !== 'all' && `· ${filterStatus}`}
                                    <ChevronDown className="h-3 w-3 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-card/95 backdrop-blur-xl border-border/50 text-xs">
                                {['all', 'active', 'draft', 'paused', 'completed'].map(s => (
                                    <DropdownMenuItem key={s} onClick={() => setFilterStatus(s)} className="capitalize text-xs">{s === 'all' ? 'All Statuses' : s}</DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Goal filter */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className={cn("h-9 gap-1.5 rounded-xl border-border/50 text-xs", filterGoal !== 'all' && "border-primary/40 bg-primary/10 text-primary")}>
                                    <Target className="h-3.5 w-3.5" />
                                    Goal {filterGoal !== 'all' && `· ${filterGoal}`}
                                    <ChevronDown className="h-3 w-3 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-card/95 backdrop-blur-xl border-border/50 text-xs">
                                {['all', 'connections', 'meetings', 'pipeline', 'brand_awareness', 'event_promotion'].map(g => (
                                    <DropdownMenuItem key={g} onClick={() => setFilterGoal(g)} className="text-xs">{g === 'all' ? 'All Goals' : g.replace('_', ' ')}</DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Type filter */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className={cn("h-9 gap-1.5 rounded-xl border-border/50 text-xs", filterType !== 'all' && "border-primary/40 bg-primary/10 text-primary")}>
                                    <Tag className="h-3.5 w-3.5" />
                                    Type {filterType !== 'all' && `· ${filterType}`}
                                    <ChevronDown className="h-3 w-3 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-card/95 backdrop-blur-xl border-border/50 text-xs">
                                {['all', 'standard', 'event', 'webinar', 'nurture', 're_engagement'].map(t => (
                                    <DropdownMenuItem key={t} onClick={() => setFilterType(t)} className="text-xs">{t === 'all' ? 'All Types' : t.replace('_', ' ')}</DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {hasActiveFilters && (
                            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 gap-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground">
                                <X className="h-3.5 w-3.5" /> Clear
                            </Button>
                        )}
                    </div>
                </div>

                {/* Active filter pills */}
                <AnimatePresence>
                    {hasActiveFilters && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="flex items-center gap-2 flex-wrap -mt-3"
                        >
                            {filterStatus !== 'all' && (
                                <Badge variant="secondary" className="gap-1.5 px-3 py-1 bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 cursor-pointer text-xs" onClick={() => setFilterStatus('all')}>
                                    Status: {filterStatus} <X className="h-2.5 w-2.5" />
                                </Badge>
                            )}
                            {filterGoal !== 'all' && (
                                <Badge variant="secondary" className="gap-1.5 px-3 py-1 bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 cursor-pointer text-xs" onClick={() => setFilterGoal('all')}>
                                    Goal: {filterGoal} <X className="h-2.5 w-2.5" />
                                </Badge>
                            )}
                            {filterType !== 'all' && (
                                <Badge variant="secondary" className="gap-1.5 px-3 py-1 bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 cursor-pointer text-xs" onClick={() => setFilterType('all')}>
                                    Type: {filterType} <X className="h-2.5 w-2.5" />
                                </Badge>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Error */}
                {error && (
                    <Card className="border-red-500/30 bg-red-500/5">
                        <CardContent className="pt-5 pb-4">
                            <p className="text-sm text-red-400">Error loading campaigns: {error}. Please ensure backend is running.</p>
                        </CardContent>
                    </Card>
                )}

                {/* ── Campaign Grid ───────────────────────────────────────── */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {loading ? (
                        [...Array(6)].map((_, i) => (
                            <Card key={i} className="border-border/30 bg-card/50 backdrop-blur-sm overflow-hidden">
                                <CardHeader className="pb-3">
                                    <Skeleton className="h-5 w-16 rounded-full mb-2" />
                                    <Skeleton className="h-4 w-3/4" />
                                    <Skeleton className="h-3 w-full mt-1" />
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <Skeleton className="h-3 w-full" />
                                    <Skeleton className="h-[3px] w-full rounded-full" />
                                    <Skeleton className="h-4 w-1/3 rounded-full" />
                                </CardContent>
                            </Card>
                        ))
                    ) : filteredCampaigns.length === 0 ? (
                        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="col-span-full">
                            <Card className="border-border/30 bg-card/50 backdrop-blur-sm">
                                <CardContent className="flex flex-col items-center justify-center py-20">
                                    <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-500/15 to-blue-500/15 border border-indigo-500/20 flex items-center justify-center mb-5">
                                        <Target className="h-8 w-8 text-indigo-400" />
                                    </div>
                                    <h3 className="text-lg font-semibold text-foreground mb-2">
                                        {searchTerm || hasActiveFilters ? 'No campaigns match your filters' : 'No campaigns yet'}
                                    </h3>
                                    <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm leading-relaxed">
                                        {searchTerm || hasActiveFilters
                                            ? 'Try adjusting your search or filters to find what you\'re looking for.'
                                            : 'Create your first campaign to start reaching out to your LinkedIn connections.'}
                                    </p>
                                    {!searchTerm && !hasActiveFilters && (
                                        <Button
                                            onClick={() => setShowCreateModal(true)}
                                            className="gap-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white border-0 shadow-lg shadow-indigo-500/20"
                                        >
                                            <Plus className="w-4 h-4" /> Create Campaign
                                        </Button>
                                    )}
                                </CardContent>
                            </Card>
                        </motion.div>
                    ) : (
                        <AnimatePresence mode="popLayout">
                            {filteredCampaigns.map((campaign, index) => (
                                <CampaignCard
                                    key={campaign.id}
                                    campaign={campaign}
                                    index={index}
                                    onNavigate={(id) => navigate(`/campaigns/${id}`)}
                                    onDuplicate={duplicateCampaign}
                                    onLaunch={launchCampaign}
                                    launchDisabled={atLaunchLimit}
                                    onPause={pauseCampaign}
                                    onResume={resumeCampaign}
                                    onDelete={deleteCampaign}
                                />
                            ))}
                        </AnimatePresence>
                    )}
                </div>

                {/* Summary count */}
                {!loading && filteredCampaigns.length > 0 && (
                    <p className="text-center text-xs text-muted-foreground/60">
                        Showing {filteredCampaigns.length} of {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
                    </p>
                )}
            </div>

            {/* Create Campaign Wizard */}
            {showCreateModal && (
                <CampaignWizard
                    onClose={() => setShowCreateModal(false)}
                    onCreate={createCampaign}
                />
            )}

            {/* Queued modal: another campaign is running */}
            <Dialog open={showQueuedModal} onOpenChange={setShowQueuedModal}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Please wait</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Another campaign (<strong>{queuedCampaignName}</strong>) is currently running. This campaign has been queued. Try launching again when the current campaign has finished.
                    </p>
                </DialogContent>
            </Dialog>

            <PageGuide pageKey="campaigns" />
        </div>
    );
}

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
    Sparkles, Plus, Filter, X, ChevronRight, Edit3, Calendar,
    Send, Trash2, RefreshCw, CheckCircle2, Clock, Zap, BarChart2,
    FileText, Tag, Target, Users, Globe, ArrowRight, AlertCircle,
    ExternalLink, Copy, MoreHorizontal, Newspaper, Rss, Settings,
    BookOpen, TrendingUp, CheckCheck, Eye, Archive
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardSpotlight } from '@/components/ui/card-spotlight';
import { useToast } from '@/components/ui/toast';

// ── Constants ────────────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
    { key: 'IDEA', label: 'Ideas', color: '#6366f1', bg: 'rgba(99,102,241,0.08)', icon: Sparkles },
    { key: 'DRAFT', label: 'Draft', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', icon: Edit3 },
    { key: 'REVIEW', label: 'Review', color: '#ec4899', bg: 'rgba(236,72,153,0.08)', icon: Eye },
    { key: 'APPROVED', label: 'Approved', color: '#10b981', bg: 'rgba(16,185,129,0.08)', icon: CheckCircle2 },
    { key: 'SCHEDULED', label: 'Scheduled', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', icon: Calendar },
    { key: 'POSTED', label: 'Posted', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)', icon: CheckCheck },
];

const VALID_NEXT = {
    IDEA: ['DRAFT'],
    DRAFT: ['REVIEW', 'IDEA'],
    REVIEW: ['APPROVED', 'DRAFT'],
    APPROVED: ['SCHEDULED', 'REVIEW'],
    SCHEDULED: ['POSTED', 'APPROVED'],
    POSTED: [],
};

const OBJECTIVES = [
    { value: 'thought_leadership', label: 'Thought Leadership' },
    { value: 'product_launch', label: 'Product Launch' },
    { value: 'engagement', label: 'Engagement' },
    { value: 'educational', label: 'Educational' },
    { value: 'networking', label: 'Networking' },
];

// ── Helper ────────────────────────────────────────────────────────────────────

function stageFor(key) {
    return PIPELINE_STAGES.find(s => s.key === key) || PIPELINE_STAGES[0];
}

function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

// ── Phantom Status Config ─────────────────────────────────────────────────────

const PHANTOM_STATUS_CONFIG = {
    pending: { label: 'Pending Sheet', color: '#64748b', bg: 'rgba(100,116,139,0.15)' },
    queued: { label: 'Queued to Publish', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
    processing: { label: 'Publishing…', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
    posted: { label: 'Published', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
    failed: { label: 'Failed', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
};

function PhantomBadge({ status }) {
    if (!status) return null;
    const cfg = PHANTOM_STATUS_CONFIG[status];
    if (!cfg) return null;
    return (
        <span
            className="inline-flex items-center gap-1 px-1.5 py-[2px] rounded-md text-[9px] font-bold border leading-none"
            style={{ color: cfg.color, backgroundColor: cfg.bg, borderColor: `${cfg.color}35` }}
        >
            {status === 'processing' && <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ backgroundColor: cfg.color }} />}
            {cfg.label}
        </span>
    );
}

// ── Generate Idea Modal (Dual-variant picker) ────────────────────────────────

function GenerateModal({ sources, ctaTemplates, onClose, onCreated }) {
    const { addToast } = useToast();
    const [form, setForm] = useState({
        source_id: '', persona: '', industry: '',
        objective: 'thought_leadership', cta_type_id: '', topic: '',
        news_article_url: '', news_article_title: '', news_article_summary: '',
    });
    const [loading, setLoading] = useState(false);
    // Dual-variant picker state
    const [variants, setVariants] = useState(null); // [{item}, {item}]
    const [picking, setPicking] = useState(false);

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const submit = async () => {
        if (!form.persona.trim() || !form.industry.trim()) {
            addToast('Persona and Industry are required', 'error'); return;
        }
        setLoading(true);
        try {
            const payload = {
                ...form,
                cta_type_id: form.cta_type_id || null,
                source_id: form.news_article_url.trim() ? null : (form.source_id || null),
                source_url: form.news_article_url.trim() || null,
                source_title: form.news_article_title.trim() || null,
                source_summary: form.news_article_summary.trim() || null,
            };
            delete payload.news_article_url;
            delete payload.news_article_title;
            delete payload.news_article_summary;
            // Generate 2 in parallel
            const [r1, r2] = await Promise.all([
                axios.post('/api/sow/engine/items/generate', payload),
                axios.post('/api/sow/engine/items/generate', payload),
            ]);
            setVariants([r1.data, r2.data]);
        } catch (e) {
            addToast(e.response?.data?.error || 'Generation failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    const pickVariant = async (chosen, discard) => {
        setPicking(true);
        try {
            // Delete the rejected variant silently
            await axios.delete(`/api/sow/engine/items/${discard.id}`).catch(() => { });
            addToast('✅ Idea added to your pipeline!', 'success');
            onCreated(chosen);
            onClose();
        } finally { setPicking(false); }
    };

    // ── Variant picker view ──
    if (variants) {
        return (
            <ModalShell title="✨ Pick Your Favourite" onClose={onClose} wide>
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground text-center">
                        AI generated two versions — choose the one you prefer. The other will be discarded.
                    </p>
                    <div className="grid grid-cols-1 gap-4">
                        {variants.map((v, i) => (
                            <motion.div
                                key={v.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.08 }}
                                className="relative rounded-xl border border-border/40 bg-muted/20 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-all duration-200 overflow-hidden"
                            >
                                <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-t-xl" />
                                <div className="p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/25">
                                            Variant {i + 1}
                                        </span>
                                        <span className="text-xs font-semibold text-foreground line-clamp-1 flex-1">{v.title}</span>
                                    </div>
                                    <p className="text-[12px] text-muted-foreground/80 leading-relaxed line-clamp-5 font-mono whitespace-pre-wrap">
                                        {v.edited_content || v.generated_content}
                                    </p>
                                    <Button
                                        size="sm"
                                        className="mt-3 w-full gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white border-0 shadow-md shadow-indigo-500/20 rounded-xl"
                                        disabled={picking}
                                        onClick={() => pickVariant(v, variants[1 - i])}
                                    >
                                        {picking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                        Use This Version
                                    </Button>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                    <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setVariants(null)}>
                        ← Regenerate with different settings
                    </Button>
                </div>
            </ModalShell>
        );
    }

    // ── Form view ──
    return (
        <ModalShell title="✨ AI Generate Idea" onClose={onClose}>
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Persona *">
                        <Input placeholder="e.g. B2B Agency Owner, Sales Leader" value={form.persona} onChange={e => set('persona', e.target.value)} className="border-border/60" />
                    </Field>
                    <Field label="Industry *">
                        <Input placeholder="e.g. B2B Software, Marketing & Advertising" value={form.industry} onChange={e => set('industry', e.target.value)} className="border-border/60" />
                    </Field>
                </div>
                <Field label="Topic / Seed Idea">
                    <Input placeholder="e.g. Cold email VS LinkedIn for B2B lead generation" value={form.topic} onChange={e => set('topic', e.target.value)} className="border-border/60" />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Objective">
                        <select className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground border-border/60" value={form.objective} onChange={e => set('objective', e.target.value)}>
                            {OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </Field>
                    <Field label="CTA Template">
                        <select className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground border-border/60" value={form.cta_type_id} onChange={e => set('cta_type_id', e.target.value)}>
                            <option value="">None</option>
                            {ctaTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    </Field>
                </div>
                <Field label="Content Source (optional)">
                    <select className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground border-border/60" value={form.source_id} onChange={e => set('source_id', e.target.value)}>
                        <option value="">None</option>
                        {sources.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </Field>
                <div className="space-y-2 rounded-lg border border-border/50 bg-muted/10 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                        <Newspaper className="w-3.5 h-3.5 text-indigo-400" />
                        News Article (optional)
                    </div>
                    <p className="text-[11px] text-muted-foreground">Base your post on a news article — paste URL and optionally title or summary. AI will use it for context.</p>
                    <div className="grid grid-cols-1 gap-2">
                        <Input placeholder="Article URL (e.g. https://...)" value={form.news_article_url} onChange={e => set('news_article_url', e.target.value)} className="border-border/60 text-sm" />
                        <Input placeholder="Article title (optional)" value={form.news_article_title} onChange={e => set('news_article_title', e.target.value)} className="border-border/60 text-sm" />
                        <textarea placeholder="Summary or key points (optional)" value={form.news_article_summary} onChange={e => set('news_article_summary', e.target.value)} rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground border-border/60 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </div>
                </div>
                {/* Dual generate note */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-500/8 border border-indigo-500/20">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <p className="text-[11px] text-indigo-400/90">AI will generate <strong>2 variants</strong> — you'll choose your favourite before it's added to the pipeline.</p>
                </div>
                <Button className="w-full gap-2 h-10 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-md" onClick={submit} disabled={loading}>
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {loading ? 'Generating 2 variants with AI…' : 'Generate 2 Variants'}
                </Button>
            </div>
        </ModalShell>
    );
}

// ── Add Source Modal ─────────────────────────────────────────────────────────

function AddSourceModal({ onClose, onCreated }) {
    const { addToast } = useToast();
    const [form, setForm] = useState({ name: '', type: 'manual', url: '', industry_tag: '', persona_tag: '' });
    const [loading, setLoading] = useState(false);
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const submit = async () => {
        if (!form.name.trim()) { addToast('Name is required', 'error'); return; }
        setLoading(true);
        try {
            const res = await axios.post('/api/sow/engine/sources', form);
            addToast('Source added!', 'success');
            onCreated(res.data);
            onClose();
        } catch (e) {
            addToast(e.response?.data?.error || 'Failed', 'error');
        } finally { setLoading(false); }
    };

    return (
        <ModalShell title="Add Content Source" onClose={onClose}>
            <div className="space-y-4">
                <Field label="Name *">
                    <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. TechCrunch Feed" className="border-border/60" />
                </Field>
                <Field label="Type">
                    <select className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground border-border/60" value={form.type} onChange={e => set('type', e.target.value)}>
                        <option value="manual">Manual</option>
                        <option value="rss">RSS Feed</option>
                        <option value="keyword">Keyword Monitor</option>
                        <option value="news_article">News Article</option>
                    </select>
                </Field>
                {(form.type === 'rss' || form.type === 'news_article') && (
                    <Field label={form.type === 'news_article' ? 'Article URL' : 'RSS URL'}>
                        <Input value={form.url} onChange={e => set('url', e.target.value)} placeholder={form.type === 'news_article' ? 'https://...' : 'https://...'} className="border-border/60" />
                    </Field>
                )}
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Industry Tag">
                        <Input value={form.industry_tag} onChange={e => set('industry_tag', e.target.value)} placeholder="Marketing & Advertising" className="border-border/60" />
                    </Field>
                    <Field label="Persona Tag">
                        <Input value={form.persona_tag} onChange={e => set('persona_tag', e.target.value)} placeholder="B2B Agency Owner" className="border-border/60" />
                    </Field>
                </div>
                <Button className="w-full h-10" onClick={submit} disabled={loading}>
                    {loading ? 'Saving...' : 'Add Source'}
                </Button>
            </div>
        </ModalShell>
    );
}

// ── Manual Create Modal ───────────────────────────────────────────────────────

function ManualCreateModal({ onClose, onCreated }) {
    const { addToast } = useToast();
    const [form, setForm] = useState({ title: '', content: '', persona: '', industry: '', objective: 'thought_leadership' });
    const [loading, setLoading] = useState(false);
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const submit = async () => {
        if (!form.title.trim() || !form.content.trim()) {
            addToast('Title and Content are required', 'error'); return;
        }
        setLoading(true);
        try {
            const res = await axios.post('/api/sow/engine/items', {
                title: form.title, generated_content: form.content,
                edited_content: form.content,
                persona: form.persona, industry: form.industry,
                objective: form.objective, status: 'IDEA',
            });
            addToast('Item created!', 'success');
            onCreated(res.data); onClose();
        } catch (e) {
            addToast(e.response?.data?.error || 'Failed to create', 'error');
        } finally { setLoading(false); }
    };

    return (
        <ModalShell title="✏️ Add Item Manually" onClose={onClose} wide>
            <div className="space-y-4">
                <Field label="Title *">
                    <Input placeholder="Post title or topic summary" value={form.title} onChange={e => set('title', e.target.value)} className="border-border/60" />
                </Field>
                <Field label="Content *">
                    <textarea
                        rows={8}
                        placeholder="Write your LinkedIn post content here…"
                        value={form.content}
                        onChange={e => set('content', e.target.value)}
                        className="w-full rounded-lg border border-input bg-muted/30 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono leading-relaxed"
                    />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Persona">
                        <Input placeholder="B2B Agency Owner" value={form.persona} onChange={e => set('persona', e.target.value)} className="border-border/60" />
                    </Field>
                    <Field label="Industry">
                        <Input placeholder="Marketing & Advertising" value={form.industry} onChange={e => set('industry', e.target.value)} className="border-border/60" />
                    </Field>
                </div>
                <Field label="Objective">
                    <select className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground border-border/60" value={form.objective} onChange={e => set('objective', e.target.value)}>
                        {OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </Field>
                <Button className="w-full h-10 gap-2" onClick={submit} disabled={loading}>
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {loading ? 'Creating…' : 'Add to Pipeline'}
                </Button>
            </div>
        </ModalShell>
    );
}

// ── CTA Template Manager Modal ────────────────────────────────────────────────

function CtaManagerModal({ ctaTemplates, onClose, onChange }) {
    const { addToast } = useToast();
    const [newName, setNewName] = useState('');
    const [newText, setNewText] = useState('');
    const [adding, setAdding] = useState(false);
    const [deletingId, setDeletingId] = useState(null);

    const addTemplate = async () => {
        if (!newName.trim()) { addToast('Name is required', 'error'); return; }
        setAdding(true);
        try {
            const res = await axios.post('/api/sow/engine/cta-templates', { name: newName, text: newText });
            addToast('CTA template added!', 'success');
            onChange(prev => [res.data, ...prev]);
            setNewName(''); setNewText('');
        } catch (e) {
            addToast(e.response?.data?.error || 'Failed', 'error');
        } finally { setAdding(false); }
    };

    return (
        <ModalShell title="🏷️ CTA Templates" onClose={onClose}>
            <div className="space-y-5">
                {/* Add new */}
                <div className="p-4 rounded-xl border border-border/40 bg-muted/20 space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Add New Template</p>
                    <Field label="Name *">
                        <Input placeholder="e.g. Book a Call" value={newName} onChange={e => setNewName(e.target.value)} className="border-border/60" />
                    </Field>
                    <Field label="CTA Text (optional)">
                        <Input placeholder="e.g. Schedule a free 15-min chat → link" value={newText} onChange={e => setNewText(e.target.value)} className="border-border/60" />
                    </Field>
                    <Button size="sm" className="gap-1.5 w-full" onClick={addTemplate} disabled={adding}>
                        {adding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        {adding ? 'Saving…' : 'Add Template'}
                    </Button>
                </div>

                {/* Existing templates */}
                <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Existing ({ctaTemplates.length})</p>
                    {ctaTemplates.length === 0 && (
                        <p className="text-xs text-muted-foreground/60 text-center py-4">No CTA templates yet. Add one above.</p>
                    )}
                    {ctaTemplates.map(t => (
                        <div key={t.id} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-border/30 bg-card/60 group">
                            <div className="min-w-0">
                                <p className="text-sm font-semibold truncate">{t.name}</p>
                                {t.text && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{t.text}</p>}
                            </div>
                            <button
                                onClick={() => setDeletingId(t.id)}
                                className="h-6 w-6 shrink-0 rounded-md flex items-center justify-center text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>

                {/* Delete confirmation inline */}
                <AnimatePresence>
                    {deletingId && (() => {
                        const tpl = ctaTemplates.find(t => t.id === deletingId);
                        return (
                            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                                className="p-3 rounded-xl border border-red-500/30 bg-red-500/8 space-y-3">
                                <p className="text-sm text-red-400">Delete <strong>"{tpl?.name}"</strong>? This cannot be undone.</p>
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeletingId(null)}>Cancel</Button>
                                    <Button size="sm" className="flex-1 bg-red-600 hover:bg-red-500 text-white border-0" onClick={async () => {
                                        try {
                                            // Note: no delete route exists in backend yet — we'll optimistically remove from UI
                                            // await axios.delete(`/api/sow/engine/cta-templates/${deletingId}`);
                                            onChange(prev => prev.filter(t => t.id !== deletingId));
                                            addToast('Template removed from session', 'success');
                                        } catch { addToast('Failed', 'error'); }
                                        setDeletingId(null);
                                    }}>
                                        <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                                    </Button>
                                </div>
                            </motion.div>
                        );
                    })()}
                </AnimatePresence>
            </div>
        </ModalShell>
    );
}

// ── Edit / Detail Modal ───────────────────────────────────────────────────────

function ItemDetailModal({ item, ctaTemplates, onClose, onUpdated, onDeleted }) {
    const { addToast } = useToast();
    const [content, setContent] = useState(item.edited_content || item.generated_content || '');
    const [saving, setSaving] = useState(false);
    const [transitioning, setTransitioning] = useState(false);
    const [scheduledAt, setScheduledAt] = useState('');
    const [showScheduleForm, setShowScheduleForm] = useState(false);
    const [sending, setSending] = useState(false);
    const [retrying, setRetrying] = useState(false);
    // History tab
    const [activeTab, setActiveTab] = useState('content'); // 'content' | 'history'
    const [history, setHistory] = useState([]);
    const [historyLoaded, setHistoryLoaded] = useState(false);

    const stage = stageFor(item.status);
    const nextStates = VALID_NEXT[item.status] || [];

    const loadHistory = async () => {
        if (historyLoaded) return;
        try {
            const res = await axios.get(`/api/sow/engine/items/${item.id}/history`);
            setHistory(Array.isArray(res.data) ? res.data : []);
            setHistoryLoaded(true);
        } catch { setHistory([]); setHistoryLoaded(true); }
    };

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        if (tab === 'history') loadHistory();
    };

    const saveContent = async () => {
        setSaving(true);
        try {
            const res = await axios.put(`/api/sow/engine/items/${item.id}/content`, { edited_content: content });
            addToast('Content saved', 'success');
            onUpdated(res.data);
        } catch (e) {
            addToast('Save failed', 'error');
        } finally { setSaving(false); }
    };

    const transition = async (toStatus) => {
        if (toStatus === 'SCHEDULED') { setShowScheduleForm(true); return; }
        setTransitioning(true);
        try {
            const res = await axios.put(`/api/sow/engine/items/${item.id}/transition`, { to_status: toStatus });
            addToast(`Moved to ${toStatus}`, 'success');
            onUpdated(res.data);
            onClose();
        } catch (e) {
            addToast(e.response?.data?.error || 'Transition failed', 'error');
        } finally { setTransitioning(false); }
    };

    const scheduleNow = async () => {
        if (!scheduledAt) { addToast('Pick a date/time', 'error'); return; }
        setTransitioning(true);
        try {
            const res = await axios.put(`/api/sow/engine/items/${item.id}/transition`, { to_status: 'SCHEDULED', scheduled_at: scheduledAt });
            addToast('Scheduled!', 'success');
            onUpdated(res.data);
            onClose();
        } catch (e) {
            addToast(e.response?.data?.error || 'Schedule failed', 'error');
        } finally { setTransitioning(false); }
    };

    const sendToPhantom = async () => {
        setSending(true);
        try {
            await axios.post(`/api/sow/engine/items/${item.id}/send`);
            addToast('✅ Sent to LinkedIn via Phantom!', 'success');
            onUpdated({ ...item, status: 'POSTED' });
            onClose();
        } catch (e) {
            addToast(e.response?.data?.error || 'Send failed', 'error');
        } finally { setSending(false); }
    };

    const retryPhantom = async () => {
        setRetrying(true);
        try {
            await axios.post(`/api/sow/engine/items/${item.id}/send`);
            addToast('✅ Retried — sent to Phantom!', 'success');
            onUpdated({ ...item, error_message: null });
            onClose();
        } catch (e) {
            addToast(e.response?.data?.error || 'Retry failed', 'error');
        } finally { setRetrying(false); }
    };

    const deleteItem = async () => {
        if (!window.confirm('Delete this content item?')) return;
        try {
            await axios.delete(`/api/sow/engine/items/${item.id}`);
            addToast('Deleted', 'success');
            onDeleted(item.id);
            onClose();
        } catch { addToast('Delete failed', 'error'); }
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(content);
        addToast('Copied to clipboard!', 'success');
    };

    // Stage color map for history
    const stageColor = (s) => stageFor(s)?.color || '#6366f1';

    return (
        <ModalShell title={item.title || 'Content Item'} onClose={onClose} wide>
            <div className="space-y-4">
                {/* Meta row */}
                <div className="flex flex-wrap gap-2 items-center">
                    <Badge style={{ backgroundColor: stage.color + '22', color: stage.color, border: `1px solid ${stage.color}44` }}>
                        {item.status}
                    </Badge>
                    {item.persona && <Badge variant="outline" className="text-xs gap-1"><Users className="w-3 h-3" />{item.persona}</Badge>}
                    {item.industry && <Badge variant="outline" className="text-xs gap-1"><Globe className="w-3 h-3" />{item.industry}</Badge>}
                    {item.objective && <Badge variant="secondary" className="text-xs">{item.objective}</Badge>}
                    {item.cta_name && <Badge variant="secondary" className="text-xs gap-1"><Tag className="w-3 h-3" />{item.cta_name}</Badge>}
                    {item.phantom_status && <PhantomBadge status={item.phantom_status} />}
                </div>

                {/* Tab bar */}
                <div className="flex gap-1 p-1 rounded-xl bg-muted/40 border border-border/30">
                    {[['content', '📝 Content'], ['history', '🕐 History']].map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => handleTabChange(key)}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${activeTab === key
                                ? 'bg-card text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* ── Content Tab ── */}
                {activeTab === 'content' && (
                    <div className="space-y-4">
                        <div className="relative">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">LinkedIn Post Content</label>
                            <textarea
                                value={content}
                                onChange={e => setContent(e.target.value)}
                                rows={10}
                                disabled={item.status === 'POSTED'}
                                className="w-full rounded-lg border border-input bg-muted/30 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono leading-relaxed disabled:opacity-60"
                            />
                            <div className="flex gap-2 mt-2">
                                <Button size="sm" onClick={saveContent} disabled={saving || item.status === 'POSTED'} className="gap-1.5">
                                    {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                                    {saving ? 'Saving...' : 'Save Edits'}
                                </Button>
                                <Button size="sm" variant="outline" onClick={copyToClipboard} className="gap-1.5">
                                    <Copy className="w-3 h-3" /> Copy
                                </Button>
                            </div>
                        </div>

                        {showScheduleForm && (
                            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 space-y-2">
                                <p className="text-sm font-medium text-blue-400">📅 Schedule post for:</p>
                                <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className="bg-background" />
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={scheduleNow} disabled={transitioning} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
                                        <Calendar className="w-3 h-3" /> Confirm Schedule
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setShowScheduleForm(false)}>Cancel</Button>
                                </div>
                            </motion.div>
                        )}

                        {item.scheduled_at && (
                            <div className="flex items-center gap-2 text-sm text-blue-400">
                                <Calendar className="w-4 h-4" />
                                Scheduled: {new Date(item.scheduled_at).toLocaleString()}
                            </div>
                        )}

                        {item.post_url && (
                            <a href={item.post_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-emerald-400 hover:underline">
                                <ExternalLink className="w-4 h-4" /> View LinkedIn Post
                            </a>
                        )}

                        {/* Error message + Retry */}
                        {item.error_message && (
                            <div className="space-y-2">
                                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                    <span className="flex-1 break-words">{item.error_message}</span>
                                </div>
                                {['APPROVED', 'SCHEDULED'].includes(item.status) && (
                                    <Button
                                        size="sm"
                                        className="gap-1.5 w-full bg-red-600 hover:bg-red-500 text-white border-0"
                                        onClick={retryPhantom}
                                        disabled={retrying}
                                    >
                                        {retrying ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                        {retrying ? 'Retrying…' : '🔄 Retry Phantom Send'}
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ── History Tab ── */}
                {activeTab === 'history' && (
                    <div className="space-y-2 min-h-[200px]">
                        {!historyLoaded ? (
                            <div className="flex items-center justify-center py-10 text-muted-foreground">
                                <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading history…
                            </div>
                        ) : history.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/60">
                                <Clock className="w-8 h-8 mb-2 opacity-30" />
                                <p className="text-sm">No transitions recorded yet.</p>
                            </div>
                        ) : (
                            <div className="relative pl-5">
                                {/* Vertical line */}
                                <div className="absolute left-2 top-0 bottom-0 w-px bg-border/50" />
                                <div className="space-y-4">
                                    {history.map((h, i) => {
                                        const toStage = stageFor(h.to_status);
                                        return (
                                            <motion.div
                                                key={h.id ?? i}
                                                initial={{ opacity: 0, x: -6 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: i * 0.04 }}
                                                className="relative"
                                            >
                                                {/* Dot */}
                                                <div
                                                    className="absolute -left-[18px] top-1 w-3 h-3 rounded-full border-2 border-background"
                                                    style={{ backgroundColor: toStage.color }}
                                                />
                                                <div className="bg-card/60 border border-border/30 rounded-lg px-3 py-2 space-y-1">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-1.5">
                                                            {h.from_status && (
                                                                <>
                                                                    <span className="text-[10px] font-bold px-1.5 py-[1px] rounded" style={{ backgroundColor: stageColor(h.from_status) + '20', color: stageColor(h.from_status) }}>{h.from_status}</span>
                                                                    <ArrowRight className="w-3 h-3 text-muted-foreground/50" />
                                                                </>
                                                            )}
                                                            <span className="text-[10px] font-bold px-1.5 py-[1px] rounded" style={{ backgroundColor: toStage.color + '20', color: toStage.color }}>{h.to_status}</span>
                                                        </div>
                                                        <span className="text-[10px] text-muted-foreground/60 shrink-0">{timeAgo(h.created_at)}</span>
                                                    </div>
                                                    {h.note && <p className="text-[11px] text-muted-foreground/70 italic">{h.note}</p>}
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Action buttons (always visible) */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                    {['IDEA', 'DRAFT', 'REVIEW'].includes((item.status || '').toUpperCase()) && (
                        <Button
                            size="sm"
                            onClick={() => transition('APPROVED')}
                            disabled={transitioning || sending}
                            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                            <CheckCircle2 className="w-3 h-3" />
                            Approve
                        </Button>
                    )}
                    {nextStates.map(s => {
                        const ns = stageFor(s);
                        const Icon = ns.icon;
                        const isPhantom = s === 'POSTED';
                        return (
                            <Button
                                key={s}
                                size="sm"
                                onClick={() => isPhantom ? sendToPhantom() : transition(s)}
                                disabled={transitioning || sending}
                                className="gap-1.5"
                                style={{ backgroundColor: ns.color, color: '#fff' }}
                            >
                                <Icon className="w-3 h-3" />
                                {isPhantom ? 'Publish to LinkedIn' : `Move to ${s}`}
                            </Button>
                        );
                    })}

                    {['APPROVED', 'SCHEDULED'].includes(item.status) && (
                        <Button size="sm" variant="outline" onClick={sendToPhantom} disabled={sending} className="gap-1.5 border-purple-500/40 text-purple-400 hover:bg-purple-500/10">
                            {sending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                            {sending ? 'Sending...' : 'Publish to LinkedIn now'}
                        </Button>
                    )}

                    <div className="flex-1" />
                    <Button size="sm" variant="ghost" onClick={deleteItem} className="gap-1.5 text-destructive hover:bg-destructive/10">
                        <Trash2 className="w-3 h-3" /> Delete
                    </Button>
                </div>
            </div>
        </ModalShell>
    );
}

// ── Kanban Card ───────────────────────────────────────────────────────────────

function KanbanCard({ item, onClick }) {
    const stage = stageFor(item.status);
    const preview = (item.edited_content || item.generated_content || '').slice(0, 140);
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94, y: -4 }}
            transition={{ duration: 0.22 }}
            className="w-full shrink-0 group"
        >
            <div
                onClick={onClick}
                className="relative cursor-pointer rounded-xl border border-border/25 bg-card/80 backdrop-blur-md shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 overflow-hidden"
                style={{ borderLeft: `3px solid ${stage.color}` }}
            >
                {/* Hover glow */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                    style={{ background: `radial-gradient(ellipse at top left, ${stage.color}10, transparent 55%)` }} />

                <div className="p-3 flex flex-col gap-2 relative z-10">
                    {/* Title row with phantom badge */}
                    <div className="flex items-start justify-between gap-1.5">
                        <p className="text-[13px] font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors flex-1 min-w-0">
                            {item.title || 'Untitled Idea'}
                        </p>
                        {item.phantom_status && (
                            <div className="shrink-0 mt-0.5">
                                <PhantomBadge status={item.phantom_status} />
                            </div>
                        )}
                    </div>

                    {/* Content preview */}
                    {preview && (
                        <p className="text-[11px] text-muted-foreground/80 leading-relaxed line-clamp-2">
                            {preview}{preview.length === 140 ? '…' : ''}
                        </p>
                    )}

                    {/* Compact Tags */}
                    <div className="flex flex-wrap gap-1">
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-[2px] rounded-md bg-gradient-to-r from-purple-500/15 to-indigo-500/15 text-purple-400 border border-purple-500/25">
                            <Sparkles className="w-2 h-2 shrink-0" />AI
                        </span>
                        {item.persona && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-[2px] rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                <Users className="w-2.5 h-2.5 shrink-0" />{item.persona}
                            </span>
                        )}
                        {item.objective && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-[2px] rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                <Target className="w-2.5 h-2.5 shrink-0" />{item.objective.replace('_', ' ')}
                            </span>
                        )}
                        {item.industry && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-[2px] rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                <Globe className="w-2.5 h-2.5 shrink-0" />{item.industry}
                            </span>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 pt-2 mt-auto border-t border-border/25">
                        <span>{timeAgo(item.created_at)}</span>
                        <div className="flex items-center gap-1.5">
                            {item.scheduled_at && (
                                <span className="flex items-center gap-1 text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-md text-[9px] font-semibold border border-blue-500/20">
                                    <Calendar className="w-2.5 h-2.5" />{new Date(item.scheduled_at).toLocaleDateString()}
                                </span>
                            )}
                            {item.error_message && <AlertCircle className="w-3 h-3 text-red-400" />}
                            {item.post_url && <ExternalLink className="w-3 h-3 text-emerald-400" />}
                            <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

// ── Reusable UI helpers ───────────────────────────────────────────────────────

function ModalShell({ title, onClose, children, wide = false }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/70 backdrop-blur-md"
                onClick={onClose}
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.94, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: 20 }}
                transition={{ type: 'spring', damping: 28, stiffness: 340 }}
                className={`relative bg-card/95 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl shadow-black/40 w-full max-h-[90vh] overflow-hidden flex flex-col ${wide ? 'max-w-2xl' : 'max-w-lg'}`}
            >
                {/* Gradient header */}
                <div className="relative flex items-center justify-between px-6 py-4 border-b border-border/40 shrink-0 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/8 via-purple-600/6 to-transparent pointer-events-none" />
                    <h2 className="relative text-base font-bold tracking-tight">{title}</h2>
                    <Button variant="ghost" size="icon" className="relative h-8 w-8 rounded-xl hover:bg-muted/60" onClick={onClose}>
                        <X className="w-3.5 h-3.5" />
                    </Button>
                </div>
                <div className="p-6 overflow-y-auto">{children}</div>
            </motion.div>
        </div>
    );
}

function Field({ label, children }) {
    return (
        <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">{label}</label>
            {children}
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ContentEnginePage() {
    const { addToast } = useToast();

    // Data
    const [items, setItems] = useState([]);
    const [sources, setSources] = useState([]);
    const [ctaTemplates, setCtaTemplates] = useState([]);
    const [analytics, setAnalytics] = useState(null);

    // UI state
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('board'); // board | analytics
    const [showFilters, setShowFilters] = useState(false);
    const [showGenerateModal, setShowGenerateModal] = useState(false);
    const [showAddSourceModal, setShowAddSourceModal] = useState(false);
    const [showManualCreateModal, setShowManualCreateModal] = useState(false);
    const [showCtaManagerModal, setShowCtaManagerModal] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);

    // Filters (right panel)
    const [filterPersona, setFilterPersona] = useState('');
    const [filterIndustry, setFilterIndustry] = useState('');
    const [filterObjective, setFilterObjective] = useState('');
    const [filterSource, setFilterSource] = useState('');
    const [filterStatus, setFilterStatus] = useState(''); // empty = all

    // ── Delete source state ────────────────────────────────────────────────────
    const [deleteSourceId, setDeleteSourceId] = useState(null); // id to confirm deletion

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [itemsRes, sourcesRes, ctaRes, analyticsRes] = await Promise.all([
                axios.get('/api/sow/engine/items'),
                axios.get('/api/sow/engine/sources'),
                axios.get('/api/sow/engine/cta-templates'),
                axios.get('/api/sow/engine/analytics').catch(() => ({ data: null })),
            ]);
            setItems(Array.isArray(itemsRes.data) ? itemsRes.data : []);
            setSources(Array.isArray(sourcesRes.data) ? sourcesRes.data : []);
            setCtaTemplates(Array.isArray(ctaRes.data) ? ctaRes.data : []);
            setAnalytics(analyticsRes.data);
        } catch (e) {
            addToast('Failed to load content engine data', 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    // ── Soft-refresh items only (no loading flash, no scroll/modal disruption) ──
    const softRefreshItems = useCallback(async () => {
        try {
            const res = await axios.get('/api/sow/engine/items');
            const fresh = Array.isArray(res.data) ? res.data : [];
            setItems(prev => {
                // Merge: update changed items, keep order, add new ones at front
                const prevMap = new Map(prev.map(i => [i.id, i]));
                const merged = fresh.map(item => {
                    const old = prevMap.get(item.id);
                    return old ? { ...old, ...item } : item;
                });
                return merged;
            });
        } catch { /* silent — do not disrupt UX on poll failure */ }
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    // ── Handle deep linking from notifications ──────────────────────────────────
    useEffect(() => {
        if (!loading && items.length > 0) {
            const params = new URLSearchParams(window.location.search);
            const highlightId = params.get('highlight');
            if (highlightId) {
                const itemToHighlight = items.find(i => String(i.id) === highlightId);
                // Only select if not already selected to avoid loop
                if (itemToHighlight && !selectedItem) {
                    setSelectedItem(itemToHighlight);
                    setActiveTab('board'); // ensure we are on the board view

                    // Clear the query param so refreshing doesn't reopen it
                    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                    window.history.replaceState({ path: newUrl }, '', newUrl);
                }
            }
        }
    }, [loading, items, selectedItem]);

    // ── 20-second polling for cron/phantom_status updates ─────────────────────
    useEffect(() => {
        const interval = setInterval(softRefreshItems, 20000);
        return () => clearInterval(interval);
    }, [softRefreshItems]);

    // ── Delete source handler ──────────────────────────────────────────────────
    const handleDeleteSource = async (sourceId) => {
        try {
            await axios.delete(`/api/sow/engine/sources/${sourceId}`);
            setSources(prev => prev.filter(s => s.id !== sourceId));
            // Clear filter if the deleted source was selected
            if (filterSource === String(sourceId)) setFilterSource('');
            addToast('Source deleted', 'success');
        } catch (e) {
            addToast(e.response?.data?.error || 'Failed to delete source', 'error');
        } finally {
            setDeleteSourceId(null);
        }
    };

    // Derived: filtered items
    const filteredItems = items.filter(item => {
        if (filterStatus && item.status !== filterStatus) return false;
        if (filterPersona && !item.persona?.toLowerCase().includes(filterPersona.toLowerCase())) return false;
        if (filterIndustry && !item.industry?.toLowerCase().includes(filterIndustry.toLowerCase())) return false;
        if (filterObjective && item.objective !== filterObjective) return false;
        if (filterSource && String(item.source_id) !== String(filterSource)) return false;
        return true;
    });

    const itemsByStage = (stageKey) => filteredItems.filter(i => i.status === stageKey);

    const handleItemUpdated = (updated) => {
        setItems(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i));
    };
    const handleItemCreated = (newItem) => {
        setItems(prev => [newItem, ...prev]);
    };
    const handleItemDeleted = (id) => {
        setItems(prev => prev.filter(i => i.id !== id));
    };
    const handleSourceCreated = (s) => setSources(prev => [s, ...prev]);

    const toggleSourceActive = async (source) => {
        try {
            const res = await axios.put(`/api/sow/engine/sources/${source.id}`, { active: !source.active });
            setSources(prev => prev.map(s => s.id === source.id ? res.data : s));
        } catch { addToast('Failed to update source', 'error'); }
    };

    const hasFilters = filterPersona || filterIndustry || filterObjective || filterSource || filterStatus;

    return (
        <div className="relative flex flex-col h-full min-h-0 overflow-hidden">
            {/* Aceternity-style Aurora background */}
            <div className="aurora-bg fixed inset-0 -z-10" />
            <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background/95 via-background/90 to-background" />

            <div className="flex flex-col h-full min-h-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* ── Header: Lamp-style gradient, refined typography ── */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 pb-6 border-b border-border/30">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 via-purple-500/15 to-violet-500/20 border border-indigo-500/25 shadow-lg shadow-indigo-500/10 overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                            <Newspaper className="relative w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                                Content Engine
                            </h1>
                            <p className="text-muted-foreground text-sm mt-0.5">Create → Refine → Approve → Schedule → Publish</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`gap-1.5 rounded-xl border ${showFilters ? 'bg-primary/10 text-primary border-primary/30' : 'border-transparent text-muted-foreground hover:bg-muted/50'}`}
                            onClick={() => setShowFilters(!showFilters)}
                        >
                            <Filter className="w-4 h-4" /> Filters
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 rounded-xl border-border/50 hover:border-primary/30 hover:bg-primary/5"
                            onClick={() => setActiveTab(t => t === 'board' ? 'analytics' : 'board')}
                        >
                            {activeTab === 'board' ? <><BarChart2 className="w-4 h-4" /> Analytics</> : <><Rss className="w-4 h-4" /> Board</>}
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 rounded-xl border-border/50 hover:border-amber-500/30 hover:bg-amber-500/5 text-muted-foreground hover:text-amber-400"
                            onClick={() => setShowCtaManagerModal(true)}
                            title="Manage CTA Templates"
                        >
                            <Tag className="w-4 h-4" /> CTAs
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 rounded-xl border-border/50 hover:border-emerald-500/30 hover:bg-emerald-500/5 text-muted-foreground hover:text-emerald-400"
                            onClick={() => setShowManualCreateModal(true)}
                            title="Add item manually"
                        >
                            <Plus className="w-4 h-4" /> Manual
                        </Button>
                        <Button
                            size="sm"
                            className="gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-violet-600 hover:from-indigo-500 hover:via-purple-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all duration-300 border-0"
                            onClick={() => setShowGenerateModal(true)}
                        >
                            <Sparkles className="w-4 h-4" /> Generate Idea
                        </Button>
                    </div>
                </div>

                {/* ── Pipeline filter: horizontal stepper style ── */}
                <div className="flex items-center gap-0 mb-6 overflow-x-auto pb-1">
                    <button
                        onClick={() => setFilterStatus('')}
                        className={`shrink-0 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${!filterStatus ? 'bg-foreground text-background shadow-md' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                    >
                        All ({items.length})
                    </button>
                    <div className="w-px h-5 bg-border/60 shrink-0 mx-1" />
                    {PIPELINE_STAGES.map((s, idx) => {
                        const count = items.filter(i => i.status === s.key).length;
                        const isActive = filterStatus === s.key;
                        return (
                            <React.Fragment key={s.key}>
                                {idx > 0 && <div className="w-3 h-px bg-border/50 shrink-0" aria-hidden />}
                                <button
                                    onClick={() => setFilterStatus(isActive ? '' : s.key)}
                                    className={`shrink-0 px-4 py-2 rounded-xl text-xs font-medium transition-all duration-200 flex items-center gap-1.5 ${isActive ? 'text-white shadow-md' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                                    style={isActive ? { backgroundColor: s.color } : {}}
                                >
                                    <span>{s.label}</span>
                                    {count > 0 && <span className={`tabular-nums ${isActive ? 'opacity-90' : 'text-muted-foreground'}`}>{count}</span>}
                                </button>
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* ── Main layout: 3-column responsive grid ── */}
                <div className={`grid grid-cols-1 lg:grid-cols-[220px_1fr${showFilters ? '_220px' : ''}] xl:grid-cols-[240px_1fr${showFilters ? '_240px' : ''}] gap-4 min-h-0 flex-1 overflow-hidden transition-all duration-300`}>

                    {/* ── Left: Sources ── */}
                    <div className="shrink-0 min-w-0 flex flex-col max-lg:max-h-[200px]">
                        <Card className="border border-border/40 bg-card/70 backdrop-blur-xl rounded-2xl shadow-sm shadow-black/5 dark:shadow-black/20 h-full overflow-hidden">
                            <CardHeader className="py-4 px-4 border-b border-border/50">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                        <Rss className="w-4 h-4 text-orange-500" />
                                        Content Sources
                                    </CardTitle>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-primary/10"
                                        onClick={() => setShowAddSourceModal(true)}
                                    >
                                        <Plus className="w-4 h-4" />
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="p-3 space-y-2 overflow-y-auto max-h-[calc(100vh-340px)]">
                                {sources.length === 0 ? (
                                    <div className="text-center py-8 px-3 rounded-xl border border-dashed border-border/60 bg-muted/20">
                                        <BookOpen className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                                        <p className="text-xs text-muted-foreground mb-2">No sources yet</p>
                                        <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowAddSourceModal(true)}>
                                            Add Source
                                        </Button>
                                    </div>
                                ) : (
                                    sources.map(s => (
                                        <div
                                            key={s.id}
                                            onClick={() => setFilterSource(filterSource === String(s.id) ? '' : String(s.id))}
                                            className={`group/src cursor-pointer rounded-lg p-3 border transition-all duration-200 ${filterSource === String(s.id) ? 'border-indigo-500/50 bg-indigo-500/10 shadow-sm shadow-indigo-500/5' : 'border-border/40 hover:border-border bg-muted/10 hover:bg-muted/30'}`}
                                        >
                                            <div className="flex items-center justify-between gap-1.5">
                                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${s.type === 'rss' ? 'bg-orange-500/15 text-orange-500' : s.type === 'keyword' ? 'bg-blue-500/15 text-blue-500' : 'bg-purple-500/15 text-purple-500'}`}>
                                                        {s.type === 'rss' ? <Rss className="w-3.5 h-3.5" /> : s.type === 'keyword' ? <Target className="w-3.5 h-3.5" /> : <BookOpen className="w-3.5 h-3.5" />}
                                                    </div>
                                                    <span className="text-xs font-medium truncate flex-1">{s.name}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {/* Toggle active */}
                                                    <button
                                                        onClick={e => { e.stopPropagation(); toggleSourceActive(s); }}
                                                        className={`w-9 h-5 rounded-full transition-all shrink-0 flex items-center ${s.active ? 'bg-emerald-500 justify-end' : 'bg-muted justify-start'}`}
                                                        title={s.active ? 'Deactivate source' : 'Activate source'}
                                                    >
                                                        <span className="w-3.5 h-3.5 rounded-full bg-white shadow-sm m-0.5 transition-transform" />
                                                    </button>
                                                    {/* Delete source */}
                                                    <button
                                                        onClick={e => { e.stopPropagation(); setDeleteSourceId(s.id); }}
                                                        className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover/src:opacity-100 transition-all duration-150"
                                                        title="Delete source"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            </div>
                                            {(s.industry_tag || s.persona_tag) && (
                                                <div className="flex gap-1 mt-2 flex-wrap">
                                                    {s.industry_tag && <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-500 rounded-md border border-emerald-500/20">{s.industry_tag}</span>}
                                                    {s.persona_tag && <span className="text-[10px] px-2 py-0.5 bg-indigo-500/10 text-indigo-500 rounded-md border border-indigo-500/20">{s.persona_tag}</span>}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* ── Main: Board or Analytics ── */}
                    <div className="min-w-0 flex-1 flex flex-col overflow-hidden h-full">
                        <div className="h-full overflow-hidden flex flex-col">
                            <div className="flex-1 overflow-hidden h-full">
                                {loading ? (
                                    <div className="flex gap-6 overflow-x-hidden h-full">
                                        {PIPELINE_STAGES.map(s => (
                                            <div key={s.key} className="w-[320px] shrink-0 space-y-4 h-full flex flex-col">
                                                <div className="h-10 w-32 bg-muted/50 rounded-xl animate-pulse" />
                                                <div className="flex-1 rounded-2xl bg-muted/20 animate-pulse" />
                                            </div>
                                        ))}
                                    </div>
                                ) : activeTab === 'analytics' ? (
                                    <AnalyticsView analytics={analytics} items={items} />
                                ) : (
                                    /* Kanban: Horizontal scrolling board */
                                    <div className="flex h-full gap-4 overflow-x-auto pb-4 px-2 snap-x snap-mandatory">
                                        {PIPELINE_STAGES.map((stage, index) => {
                                            const stageItems = itemsByStage(stage.key);
                                            const Icon = stage.icon;
                                            const isIdeaStage = stage.key === 'IDEA';

                                            return (
                                                <React.Fragment key={stage.key}>
                                                    {index > 0 && <div className="w-px shrink-0 bg-border/30 my-2" aria-hidden />}
                                                    <div className="shrink-0 flex flex-col h-full snap-center w-[290px] sm:w-[310px]">
                                                        {/* Stage header — glassy pill */}
                                                        <div
                                                            className="flex items-center justify-between mb-2.5 px-3 py-2 rounded-xl border shrink-0"
                                                            style={{ backgroundColor: `${stage.color}10`, borderColor: `${stage.color}25` }}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <div
                                                                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                                                                    style={{ backgroundColor: `${stage.color}25` }}
                                                                >
                                                                    <Icon className="w-3 h-3" style={{ color: stage.color }} />
                                                                </div>
                                                                <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: stage.color }}>
                                                                    {stage.label}
                                                                </span>
                                                            </div>
                                                            <span
                                                                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                                                style={{ backgroundColor: `${stage.color}20`, color: stage.color }}
                                                            >
                                                                {stageItems.length}
                                                            </span>
                                                        </div>

                                                        {/* Column body */}
                                                        <div
                                                            className="flex-1 rounded-2xl border border-border/20 overflow-hidden flex flex-col"
                                                            style={{ background: `linear-gradient(180deg, ${stage.color}06 0%, transparent 40%)` }}
                                                        >
                                                            <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-thumb-muted/30 hover:scrollbar-thumb-muted/50">
                                                                <AnimatePresence mode="popLayout">
                                                                    {stageItems.map(item => (
                                                                        <KanbanCard key={item.id} item={item} onClick={() => setSelectedItem(item)} />
                                                                    ))}
                                                                </AnimatePresence>

                                                                {stageItems.length === 0 && (
                                                                    <motion.div
                                                                        initial={{ opacity: 0 }}
                                                                        animate={{ opacity: 1 }}
                                                                        className="flex flex-col items-center justify-center pt-10 pb-8 text-center mx-2"
                                                                    >
                                                                        <div
                                                                            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 border"
                                                                            style={{ backgroundColor: `${stage.color}12`, borderColor: `${stage.color}20` }}
                                                                        >
                                                                            <Icon className="w-6 h-6" style={{ color: stage.color, opacity: 0.7 }} />
                                                                        </div>
                                                                        <p className="text-[11px] text-muted-foreground/70 font-medium mb-4 max-w-[190px] leading-relaxed">
                                                                            {stage.key === 'IDEA'
                                                                                ? 'Generate ideas with AI to start your pipeline.'
                                                                                : `Nothing here yet.`}
                                                                        </p>
                                                                        {stage.key === 'IDEA' && (
                                                                            <Button
                                                                                size="sm"
                                                                                className="h-8 text-[11px] gap-1.5 rounded-xl w-full max-w-[155px] bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white border-0 shadow-md shadow-indigo-500/20"
                                                                                onClick={() => setShowGenerateModal(true)}
                                                                            >
                                                                                <Sparkles className="w-3.5 h-3.5" /> Generate Idea
                                                                            </Button>
                                                                        )}
                                                                    </motion.div>
                                                                )}
                                                                <div className="h-4" aria-hidden />
                                                            </div>

                                                            {isIdeaStage && (
                                                                <div className="p-2 border-t border-border/20 bg-card/60 backdrop-blur-sm shrink-0">
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="w-full justify-center text-muted-foreground hover:text-primary gap-1.5 h-8 text-[11px] font-medium rounded-xl border border-border/30 hover:border-primary/30 hover:bg-primary/5"
                                                                        onClick={() => setShowGenerateModal(true)}
                                                                    >
                                                                        <Plus className="w-3.5 h-3.5" /> New Idea
                                                                    </Button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </React.Fragment>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── Right: Filters ── */}
                    {showFilters && (
                        <div className="shrink-0 min-w-0 flex flex-col max-lg:max-h-[240px] animate-in slide-in-from-right-8 fade-in duration-300">
                            <Card className="border border-border/40 bg-card/70 backdrop-blur-xl rounded-2xl shadow-sm shadow-black/5 dark:shadow-black/20 h-full overflow-hidden flex flex-col">
                                <CardHeader className="py-4 px-4 border-b border-border/50">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                            <Filter className="w-4 h-4 text-violet-500" />
                                            Filters
                                        </CardTitle>
                                        {hasFilters && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 text-[10px] text-primary hover:bg-primary/10"
                                                onClick={() => { setFilterPersona(''); setFilterIndustry(''); setFilterObjective(''); setFilterSource(''); setFilterStatus(''); }}
                                            >
                                                Clear
                                            </Button>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="p-3 space-y-3 overflow-y-auto max-h-[calc(100vh-340px)]">
                                    <div className="space-y-3">
                                        <Field label="Persona">
                                            <Input placeholder="Any persona" value={filterPersona} onChange={e => setFilterPersona(e.target.value)} className="h-8 text-xs border-border/60" />
                                        </Field>
                                        <Field label="Industry">
                                            <Input placeholder="Any industry" value={filterIndustry} onChange={e => setFilterIndustry(e.target.value)} className="h-8 text-xs border-border/60" />
                                        </Field>
                                        <Field label="Objective">
                                            <select className="w-full h-8 px-3 rounded-md border border-input bg-background text-xs text-foreground border-border/60" value={filterObjective} onChange={e => setFilterObjective(e.target.value)}>
                                                <option value="">All</option>
                                                {OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </Field>
                                    </div>

                                    {/* Pipeline stats */}
                                    <div className="pt-3 border-t border-border/50 space-y-2">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pipeline</p>
                                        <div className="space-y-1.5">
                                            {PIPELINE_STAGES.map(s => {
                                                const count = items.filter(i => i.status === s.key).length;
                                                return (
                                                    <div key={s.key} className="flex items-center justify-between text-xs py-1 px-2 rounded-md hover:bg-muted/30 transition-colors">
                                                        <span className="flex items-center gap-1.5" style={{ color: s.color }}>
                                                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                                                            {s.label}
                                                        </span>
                                                        <span className="font-semibold tabular-nums text-foreground">{count}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </div>

                {/* ── Modals ── */}
                <AnimatePresence>
                    {showGenerateModal && (
                        <GenerateModal sources={sources} ctaTemplates={ctaTemplates} onClose={() => setShowGenerateModal(false)} onCreated={handleItemCreated} />
                    )}
                    {showAddSourceModal && (
                        <AddSourceModal onClose={() => setShowAddSourceModal(false)} onCreated={handleSourceCreated} />
                    )}
                    {showManualCreateModal && (
                        <ManualCreateModal onClose={() => setShowManualCreateModal(false)} onCreated={handleItemCreated} />
                    )}
                    {showCtaManagerModal && (
                        <CtaManagerModal
                            ctaTemplates={ctaTemplates}
                            onClose={() => setShowCtaManagerModal(false)}
                            onChange={setCtaTemplates}
                        />
                    )}
                    {selectedItem && (
                        <ItemDetailModal
                            item={selectedItem}
                            ctaTemplates={ctaTemplates}
                            onClose={() => setSelectedItem(null)}
                            onUpdated={updated => { handleItemUpdated(updated); setSelectedItem(prev => ({ ...prev, ...updated })); }}
                            onDeleted={handleItemDeleted}
                        />
                    )}
                </AnimatePresence>

                {/* ── Delete Source Confirmation Modal ── */}
                <AnimatePresence>
                    {deleteSourceId && (() => {
                        const src = sources.find(s => s.id === deleteSourceId);
                        return (
                            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="absolute inset-0 bg-black/70 backdrop-blur-md"
                                    onClick={() => setDeleteSourceId(null)}
                                />
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.94, y: 16 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.94, y: 16 }}
                                    transition={{ type: 'spring', damping: 28, stiffness: 340 }}
                                    className="relative bg-card/95 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl shadow-black/40 w-full max-w-sm overflow-hidden"
                                >
                                    {/* Danger header accent */}
                                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-red-500 to-rose-500 rounded-t-2xl" />
                                    <div className="p-6 pt-7">
                                        <div className="flex items-center gap-3 mb-4">
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15 border border-red-500/25">
                                                <Trash2 className="w-5 h-5 text-red-400" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-foreground">Delete Source</h3>
                                                <p className="text-xs text-muted-foreground mt-0.5">This action cannot be undone</p>
                                            </div>
                                        </div>
                                        <p className="text-sm text-foreground/80 mb-1">
                                            Are you sure you want to delete <span className="font-semibold text-foreground">"{src?.name}"</span>?
                                        </p>
                                        <p className="text-xs text-muted-foreground mb-6">
                                            Content items already created from this source will not be affected.
                                        </p>
                                        <div className="flex gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="flex-1 h-9 rounded-xl border-border/50"
                                                onClick={() => setDeleteSourceId(null)}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                size="sm"
                                                className="flex-1 h-9 rounded-xl bg-red-600 hover:bg-red-500 text-white border-0 shadow-lg shadow-red-500/20"
                                                onClick={() => handleDeleteSource(deleteSourceId)}
                                            >
                                                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete Source
                                            </Button>
                                        </div>
                                    </div>
                                </motion.div>
                            </div>
                        );
                    })()}
                </AnimatePresence>
            </div>
        </div>
    );
}

// ── Analytics View ────────────────────────────────────────────────────────────

function AnalyticsView({ analytics, items }) {
    if (!analytics) return (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                <div className="text-center">
                    <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No analytics data yet.</p>
                    <p className="text-xs mt-1">Generate and post content to see stats.</p>
                </div>
            </CardContent>
        </Card>
    );

    const statCards = [
        { label: 'Total Ideas', value: analytics.total_ideas, color: '#6366f1', icon: Sparkles },
        { label: 'Approved', value: analytics.total_approved, color: '#10b981', icon: CheckCircle2 },
        { label: 'Scheduled', value: analytics.total_scheduled, color: '#3b82f6', icon: Calendar },
        { label: 'Posted', value: analytics.total_posted, color: '#8b5cf6', icon: CheckCheck },
        { label: 'In Review', value: analytics.total_in_review, color: '#ec4899', icon: Eye },
        { label: 'Drafts', value: analytics.total_drafts, color: '#f59e0b', icon: Edit3 },
    ];

    return (
        <div className="space-y-5 pr-2 overflow-y-auto pb-4">
            {/* Glassmorphic stat grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {statCards.map((s, i) => (
                    <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.3 }}>
                        <Card className="relative border border-border/30 bg-card/60 backdrop-blur-xl overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200" style={{ borderLeft: `3px solid ${s.color}` }}>
                            <div className="absolute inset-0 opacity-30" style={{ background: `radial-gradient(circle at top right, ${s.color}25, transparent 60%)` }} />
                            <CardContent className="p-4 relative z-10">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</span>
                                    <div className="flex h-6 w-6 items-center justify-center rounded-lg" style={{ backgroundColor: `${s.color}20` }}>
                                        <s.icon className="w-3 h-3" style={{ color: s.color }} />
                                    </div>
                                </div>
                                <p className="text-2xl font-extrabold tabular-nums tracking-tight" style={{ color: s.color }}>{s.value ?? 0}</p>
                            </CardContent>
                        </Card>
                    </motion.div>
                ))}
            </div>

            {/* Posts by persona */}
            {analytics.posts_by_persona?.length > 0 && (
                <Card className="border-border/50 bg-card/50">
                    <CardHeader className="py-4">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <Users className="w-4 h-4 text-indigo-500" />
                            Posts by Persona
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-3">
                        {analytics.posts_by_persona.map(p => (
                            <div key={p.persona} className="flex items-center gap-3">
                                <span className="text-sm w-36 truncate font-medium">{p.persona || 'Unknown'}</span>
                                <div className="flex-1 h-2.5 rounded-full bg-muted/50 overflow-hidden">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${Math.min(100, (p.count / (analytics.total_posted || 1)) * 100)}%` }}
                                        transition={{ duration: 0.5, ease: 'easeOut' }}
                                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                                    />
                                </div>
                                <span className="text-xs font-bold w-8 text-right tabular-nums">{p.count}</span>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            {/* CTA usage */}
            {analytics.cta_usage?.length > 0 && (
                <Card className="border-border/50 bg-card/50">
                    <CardHeader className="py-4">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <Tag className="w-4 h-4 text-amber-500" />
                            CTA Usage
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <div className="flex flex-wrap gap-2">
                            {analytics.cta_usage.map(c => (
                                <div key={c.cta_name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs font-medium">
                                    <Tag className="w-3.5 h-3.5 text-amber-500" />
                                    <span>{c.cta_name}</span>
                                    <span className="font-bold text-amber-600 dark:text-amber-400">{c.usage_count}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

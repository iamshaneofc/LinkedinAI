import { useState, useRef, useEffect, Component } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Search, Linkedin, Loader2, CheckCircle2, AlertCircle, Share2, Play, Sparkles, Upload, FileText, X, Info, Download } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { useToast } from '../components/ui/toast';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';

const InfoTooltip = ({ content }) => (
    <Tooltip>
        <TooltipTrigger asChild>
            <span className="inline-flex ml-2 cursor-help">
                <Info className="h-3.5 w-3.5 text-muted-foreground/70 hover:text-foreground transition-colors" />
            </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs bg-popover text-popover-foreground border border-border shadow-xl p-3">
            <div className="font-normal text-sm">{content}</div>
        </TooltipContent>
    </Tooltip>
);

const IMPORT_SOURCE_OPTIONS = [
    { value: 'connections_export', label: 'Import My Connections', envLabel: 'CONNECTIONS_EXPORT_SOURCE', description: 'Your 1st-degree LinkedIn connections', icon: Share2 },
    { value: 'search_export', label: 'Explore Beyond My Network', envLabel: 'SEARCH_EXPORT_SOURCE', description: 'Find 2nd & 3rd-degree LinkedIn leads', icon: Search },
];

class LeadSearchErrorBoundary extends Component {
    state = { hasError: false, error: null };
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, info) {
        console.error('LeadSearchPage error:', error, info);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div className="p-8 max-w-md mx-auto text-center space-y-4">
                    <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
                    <h2 className="text-xl font-semibold">Something went wrong</h2>
                    <p className="text-sm text-muted-foreground">{this.state.error?.message || 'An error occurred on this page.'}</p>
                    <Button onClick={() => window.location.reload()} variant="outline">Reload page</Button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default function LeadSearchPage() {
    const { addToast } = useToast();
    const [importSource, setImportSource] = useState('search_export');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);

    // CSV Import State
    const [uploading, setUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState(null);
    const [importType, setImportType] = useState('csv');
    const fileInputRef = useRef(null);

    // 1st degree (Phantom) import stats for widget: { saved, totalLeads, timestamp }
    const [firstDegreeImportStats, setFirstDegreeImportStats] = useState(null);
    const [firstDegreeImportLoading, setFirstDegreeImportLoading] = useState(false);

    const fetchFirstDegreeImportStats = () => {
        setFirstDegreeImportLoading(true);
        axios.get('/api/leads/imports?limit=50')
            .then((res) => {
                const rows = res.data || [];
                const last = rows.find((r) => r.source === 'connections_export');
                if (last) {
                    setFirstDegreeImportStats({
                        saved: last.saved ?? 0,
                        totalLeads: last.total_leads ?? 0,
                        timestamp: last.timestamp,
                    });
                } else {
                    setFirstDegreeImportStats(null);
                }
            })
            .catch(() => setFirstDegreeImportStats(null))
            .finally(() => setFirstDegreeImportLoading(false));
    };

    const handleSearch = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        setLoading(true);
        setError(null);
        setResults(null);

        try {
            const endpoint = importSource === 'connections_export'
                ? '/api/phantom/export-connections-complete'
                : '/api/phantom/search-leads-complete';

            const response = await axios.post(endpoint, {}, { timeout: 180000 });
            setResults(response.data);

            if (importSource === 'connections_export') {
                fetchFirstDegreeImportStats();
            }

            if (response.data.totalLeads > 0) {
                addToast(`✅ Found ${response.data.totalLeads} leads and saved ${response.data.savedToDatabase} to database!`, 'success');
            } else {
                addToast('⚠️ No new Leads found', 'warning');
            }
        } catch (err) {
            const backend = err.response?.data;
            const errorMsg = (backend && (backend.message || backend.error)) || err.message || 'Failed to search leads';
            const errorCode = backend?.code;
            const helpUrl = backend?.helpUrl || null;
            setError({
                message: errorMsg,
                code: errorCode || null,
                tips: backend?.tips || null,
                helpUrl,
            });
            addToast(errorCode ? `[${errorCode}] ${errorMsg}` : errorMsg, 'error', helpUrl ? { helpUrl } : {});
        } finally {
            setLoading(false);
        }
    };

    // Fetch latest 1st degree import stats when "Import My Connections" is selected (and keep refetching so it stays current)
    useEffect(() => {
        if (importSource !== 'connections_export') {
            setFirstDegreeImportStats(null);
            return;
        }
        fetchFirstDegreeImportStats();
    }, [importSource]);

    const handleFileSelect = (type) => {
        setImportType(type);
        fileInputRef.current?.click();
    };

    const handleFileUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (importType === 'csv' && !file.name.endsWith('.csv')) {
            setUploadResult({ success: false, message: 'Please upload a CSV file' });
            return;
        }

        if (importType === 'excel' && !file.name.match(/\.(xlsx|xls)$/)) {
            setUploadResult({ success: false, message: 'Please upload an Excel file (.xlsx or .xls)' });
            return;
        }

        const formData = new FormData();
        if (importType === 'csv') {
            formData.append('csvFile', file);
        } else {
            formData.append('excelFile', file);
        }

        try {
            setUploading(true);
            setUploadResult(null);

            const endpoint = importType === 'csv' ? '/api/leads/import-csv' : '/api/leads/import-excel';
            const res = await axios.post(endpoint, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            const summary = res.data.summary || {};
            let message = 'Import completed successfully!';
            if (summary.errors > 0) {
                message = summary.saved > 0
                    ? `Import completed with ${summary.errors} row(s) skipped.`
                    : 'Import finished with errors — see reasons below.';
            }

            setUploadResult({
                success: summary.errors === 0,
                message,
                summary,
            });
        } catch (err) {
            console.error('Upload failed:', err);
            let errorMessage = `Failed to upload ${importType.toUpperCase()} file`;
            if (err.response?.data?.error) errorMessage = err.response.data.error;
            else if (err.message) errorMessage = err.message;

            setUploadResult({ success: false, message: errorMessage });
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDownloadTemplate = (format) => {
        const f = format || 'csv';
        const url = `/api/leads/import-template?format=${f}`;
        fetch(url)
            .then((res) => {
                if (!res.ok) throw new Error(res.statusText);
                return res.blob();
            })
            .then((blob) => {
                const filename = f === 'xlsx' ? 'leads_import_template.xlsx' : 'leads_import_template.csv';
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(a.href);
                addToast(`Downloaded ${filename}`, 'success');
            })
            .catch((err) => {
                addToast(err.message || 'Failed to download template', 'error');
            });
    };

    return (
        <LeadSearchErrorBoundary>
        <TooltipProvider>
            <div className="space-y-6 page-enter">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
                            Lead Search
                        </h1>
                        <p className="text-muted-foreground mt-1 text-sm md:text-base max-w-2xl">
                            Import new leads based on your criteria
                        </p>
                    </div>
                </div>

                <Card className="glass-strong card-elevated overflow-hidden relative border-primary/20">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                    <CardHeader className="relative z-10 pb-4">
                        <CardTitle className="flex items-center gap-2 text-xl">
                            <div className="p-2 bg-[#0077b5]/10 rounded-xl mr-1">
                                <Linkedin className="h-5 w-5 text-[#0077b5]" />
                            </div>
                            Select Data Source
                        </CardTitle>
                        <CardDescription className="text-sm">
                            Choose which data strategy to run. Configuration is managed in your external provider settings.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="relative z-10">
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {IMPORT_SOURCE_OPTIONS.map((opt) => (
                                    <motion.button
                                        whileHover={{ scale: 1.01 }}
                                        whileTap={{ scale: 0.98 }}
                                        key={opt.value}
                                        type="button"
                                        onClick={() => setImportSource(opt.value)}
                                        className={`relative flex items-start gap-4 p-5 rounded-2xl border-2 text-left transition-all overflow-hidden ${importSource === opt.value
                                            ? 'border-primary bg-primary/5 shadow-glow-sm shadow-primary/20'
                                            : 'border-border/60 hover:border-primary/40 hover:bg-muted/30 bg-card/40'
                                            }`}
                                    >
                                        {importSource === opt.value && (
                                            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
                                        )}
                                        <div className={`p-3 rounded-xl transition-all ${importSource === opt.value ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30' : 'bg-muted text-muted-foreground'}`}>
                                            <opt.icon className="h-6 w-6" />
                                        </div>
                                        <div className="min-w-0 flex-1 relative z-10">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="font-bold text-base text-foreground block">{opt.label}</span>
                                                {importSource === opt.value && <CheckCircle2 className="h-5 w-5 text-primary shrink-0 animate-scale-in" />}
                                            </div>
                                            <span className="inline-block text-[10px] font-mono font-medium text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full mb-2">
                                                {opt.envLabel}
                                            </span>
                                            <p className="text-xs text-muted-foreground leading-relaxed">{opt.description}</p>
                                        </div>
                                    </motion.button>
                                ))}
                            </div>

                            {importSource === 'connections_export' && (
                                <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
                                    {firstDegreeImportLoading ? (
                                        <span className="inline-flex items-center gap-2 text-muted-foreground">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            Loading latest import…
                                        </span>
                                    ) : firstDegreeImportStats ? (
                                        <span className="font-medium tabular-nums">
                                            {firstDegreeImportStats.saved} / {firstDegreeImportStats.totalLeads} 1st degree connections imported
                                            {firstDegreeImportStats.timestamp
                                                ? ` as of ${new Date(firstDegreeImportStats.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
                                                : ''}
                                        </span>
                                    ) : (
                                        <span className="text-muted-foreground">
                                            No 1st degree import yet. Run Engine to import your connections.
                                        </span>
                                    )}
                                </div>
                            )}

                            <div className="flex flex-col sm:flex-row items-center justify-between pt-6 border-t border-border/50 gap-4">
                                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                                    Leads are saved with source <strong>{importSource}</strong>. Phantom uses its own saved search URL and LinkedIn connection.
                                </p>
                                <Button size="lg" className="w-full sm:w-auto gap-2 font-semibold shadow-lg shadow-primary/20 btn-shimmer group" disabled={loading} onClick={handleSearch}>
                                    {loading ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Syncing Data...
                                        </>
                                    ) : (
                                        <>
                                            <Play className="h-4 w-4 fill-current group-hover:scale-110 transition-transform" />
                                            Run Engine
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Import Contacts Section */}
                <Card className="glass-strong card-elevated overflow-hidden relative border-primary/20">
                    <CardHeader className="pb-3 border-b border-border/10">
                        <CardTitle className="flex items-center gap-2 text-xl">
                            <div className="p-2 bg-primary/10 rounded-xl mr-1">
                                <Upload className="h-5 w-5 text-primary" />
                            </div>
                            <span className="flex items-center">
                                Import Contacts
                                <InfoTooltip content="Import external leads (CSV/Excel) to track and analyze them in your dashboard." />
                            </span>
                        </CardTitle>
                        <CardDescription className="text-sm">
                            Upload your existing contacts from CSV or Excel files directly into Kinnote.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                            <p className="text-sm text-muted-foreground w-full sm:w-auto">
                                Support for standard CSV and Excel formats.
                            </p>
                            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="default"
                                            className="gap-2 border-primary/20 hover:bg-primary/5 font-medium"
                                        >
                                            <Download className="h-4 w-4" />
                                            Download template
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-[200px]">
                                        <DropdownMenuItem onClick={() => handleDownloadTemplate('csv')} className="gap-2 cursor-pointer">
                                            <FileText className="h-4 w-4" />
                                            <span>CSV template</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleDownloadTemplate('xlsx')} className="gap-2 cursor-pointer">
                                            <FileText className="h-4 w-4 text-green-600" />
                                            <span>Excel template</span>
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={importType === "csv" ? ".csv" : ".xlsx,.xls"}
                                    onChange={handleFileUpload}
                                    className="hidden"
                                />
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="default"
                                            disabled={uploading}
                                            className="gap-2 border-primary/20 hover:bg-primary/5 font-bold tracking-wide w-full sm:w-auto"
                                        >
                                            <Upload className="h-4 w-4" />
                                            {uploading ? "IMPORTING..." : "IMPORT CONTACTS"}
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-[180px]">
                                        <DropdownMenuItem onClick={() => handleFileSelect("csv")} className="gap-2 cursor-pointer">
                                            <FileText className="h-4 w-4" />
                                            <span>From CSV File</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleFileSelect("excel")} className="gap-2 cursor-pointer">
                                            <FileText className="h-4 w-4 text-green-600" />
                                            <span>From Excel File</span>
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>

                        {/* Upload Result Alert - dynamic summary after CSV/Excel import */}
                        {uploadResult && (
                            <div
                                className={cn(
                                    "w-full animate-in slide-in-from-top-2 fade-in duration-300 rounded-xl border-2 p-5 shadow-sm mt-4",
                                    uploadResult.success ? "bg-green-50/50 dark:bg-green-950/20 border-green-300 dark:border-green-700" : "bg-red-50/50 dark:bg-red-950/20 border-red-300 dark:border-red-700"
                                )}
                            >
                                <div className="flex items-start gap-3">
                                    {uploadResult.success ? (
                                        <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                                    ) : (
                                        <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className={cn("font-semibold text-base", uploadResult.success ? "text-green-800 dark:text-green-200" : "text-red-800 dark:text-red-200")}>
                                                {uploadResult.message}
                                            </p>
                                            <button onClick={() => setUploadResult(null)} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5" aria-label="Dismiss">
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                        {uploadResult.summary && (
                                            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                                                <div className="rounded-lg bg-green-100/80 dark:bg-green-900/30 border border-green-200 dark:border-green-800 p-3">
                                                    <div className="text-2xl font-bold text-green-800 dark:text-green-200 tabular-nums">{uploadResult.summary.saved}</div>
                                                    <div className="text-xs font-medium text-green-700 dark:text-green-300 mt-0.5">Imported</div>
                                                </div>
                                                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
                                                    <div className="text-2xl font-bold text-amber-800 dark:text-amber-200 tabular-nums">{uploadResult.summary.duplicates}</div>
                                                    <div className="text-xs font-medium text-amber-700 dark:text-amber-300 mt-0.5">Duplicates avoided</div>
                                                </div>
                                                <div className="rounded-lg bg-muted/60 border border-border p-3">
                                                    <div className="text-2xl font-bold tabular-nums">{uploadResult.summary.totalLeads}</div>
                                                    <div className="text-xs font-medium text-muted-foreground mt-0.5">In file</div>
                                                </div>
                                                {uploadResult.summary.errors > 0 && (
                                                    <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
                                                        <div className="text-2xl font-bold text-red-800 dark:text-red-200 tabular-nums">{uploadResult.summary.errors}</div>
                                                        <div className="text-xs font-medium text-red-700 dark:text-red-300 mt-0.5">Errors</div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {uploadResult.summary?.errors > 0 && Array.isArray(uploadResult.summary.errorDetails) && uploadResult.summary.errorDetails.length > 0 && (
                                            <div className="mt-4 rounded-lg bg-red-50/80 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-4">
                                                <p className="text-xs font-semibold text-red-800 dark:text-red-200 uppercase tracking-wider mb-2">Why some rows failed</p>
                                                <ul className="space-y-1.5 text-sm text-red-700 dark:text-red-300">
                                                    {uploadResult.summary.errorDetails.slice(0, 5).map((detail, idx) => (
                                                        <li key={idx} className="flex flex-col gap-0.5">
                                                            <span className="font-medium">{detail.reason}</span>
                                                            {detail.row && (detail.row.linkedin_url || detail.row.full_name || detail.row.first_name) && (
                                                                <span className="text-xs opacity-90 truncate">
                                                                    Row: {detail.row.full_name || detail.row.first_name || detail.row.linkedin_url || '—'}
                                                                </span>
                                                            )}
                                                        </li>
                                                    ))}
                                                </ul>
                                                {uploadResult.summary.errorDetails.length > 5 && (
                                                    <p className="text-xs text-red-600 dark:text-red-400 mt-2">+ {uploadResult.summary.errorDetails.length - 5} more</p>
                                                )}
                                            </div>
                                        )}
                                        {uploadResult.success && uploadResult.summary?.saved > 0 && (
                                            <div className="mt-4 pt-4 border-t border-green-200/60 dark:border-green-800/60">
                                                <Link to="/imported-leads" className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 dark:text-green-300 hover:text-green-800 dark:hover:text-green-200 underline underline-offset-2">
                                                    View imported leads →
                                                </Link>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {results && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                        <Card className="glass border-emerald-500/30 overflow-hidden relative">
                            <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent pointer-events-none" />
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-emerald-500">
                                    <CheckCircle2 className="h-5 w-5" />
                                    Import Completed Successfully
                                </CardTitle>
                                <CardDescription className="flex items-center gap-2 mt-1">
                                    Data Source: <Badge variant="outline" className="font-mono bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]">{importSource}</Badge>
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-3 gap-4 mb-6">
                                    {[
                                        { label: 'Leads Found', val: results.totalLeads, color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
                                        { label: 'New Saved', val: results.savedToDatabase, color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
                                        { label: 'Duplicates', val: results.duplicates || 0, color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/20' }
                                    ].map((s, i) => (
                                        <div key={i} className={`text-center p-5 rounded-2xl border ${s.border} ${s.bg} backdrop-blur-sm`}>
                                            <div className={`text-3xl font-black ${s.color} stat-value`}>{s.val}</div>
                                            <div className="text-xs font-semibold text-muted-foreground mt-1 uppercase tracking-wider">{s.label}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex gap-3">
                                    <Button onClick={() => window.location.href = '/leads'} className="flex-1" variant="outline">View Leads</Button>
                                    <Button onClick={() => setResults(null)} variant="ghost" className="hover:bg-muted">Dismiss</Button>
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}

                {error && (
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                        <Card className="glass border-destructive/40 relative overflow-hidden">
                            <div className="absolute inset-0 bg-destructive/5 pointer-events-none" />
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-destructive">
                                    <AlertCircle className="h-5 w-5" />
                                    Search Failed
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="bg-destructive/10 p-5 rounded-xl border border-destructive/20 backdrop-blur-md">
                                    <p className="text-sm font-semibold text-destructive-foreground mb-3 flex items-start gap-2">
                                        <span className="leading-snug">{error.message || 'An unknown error occurred while searching leads.'}</span>
                                    </p>
                                    {error.tips && Array.isArray(error.tips) && (
                                        <div className="mt-4 pt-4 border-t border-destructive/20">
                                            <p className="text-xs font-semibold text-destructive/80 uppercase tracking-wider mb-2">What you can do</p>
                                            <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground">
                                                {error.tips.map((tip, idx) => <li key={idx} className="leading-relaxed">{tip}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                    {error.helpUrl && (
                                        <div className="mt-4 pt-4 border-t border-destructive/20">
                                            <a
                                                href={error.helpUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                                            >
                                                Reconnect your account
                                            </a>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
            </div>
        </TooltipProvider>
        </LeadSearchErrorBoundary>
    );
}

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Users,
  Phone,
  Mail,
  Target,
  BarChart3,
  ArrowRight,
  FileText,
  MessageSquare,
  Zap,
  Calendar,
  Link2,
  UserCheck,
  UserPlus,
  Rocket,
  TrendingUp,
  Search,
  Filter,
  X,
  ChevronDown,
  ChevronRight,
  Info,
  Sparkles,
  MoveRight,
  Upload,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  FunnelChart,
  Funnel,
  LabelList,
  Sector,
} from "recharts";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { useTimeFilter } from "../context/TimeFilterContext";

const PERIODS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const CHART_COLORS = [
  "hsl(var(--primary))",
  "#64748b",
  "#94a3b8",
  "#cbd5e1",
  "#e2e8f0",
];

// Industry-specific color palette - distinct colors for each industry
const INDUSTRY_COLORS = {
  "Accommodation Services": "#3b82f6", // Blue
  "Administrative and Support Services": "#8b5cf6", // Purple
  Construction: "#f59e0b", // Amber
  "Consumer Services": "#ec4899", // Pink
  Education: "#10b981", // Emerald
  "Entertainment Providers": "#f97316", // Orange
  "Farming, Ranching, Forestry": "#84cc16", // Lime
  "Financial Services": "#22c55e", // Green
  "Government Administration": "#6366f1", // Indigo
  "Holding Companies": "#14b8a6", // Teal
  "Hospitals and Health Care": "#fb923c", // Coral/Orange
  Manufacturing: "#06b6d4", // Cyan
  "Oil, Gas, and Mining": "#64748b", // Slate
  "Professional Services": "#a855f7", // Violet
  "Real Estate and Equipment Rental Services": "#f43f5e", // Rose
  Retail: "#eab308", // Yellow
  "Technology, Information and Media": "#059669", // Darker Emerald (distinct from Education)
  "Transportation, Logistics, Supply Chain and Storage": "#0ea5e9", // Sky Blue
  Utilities: "#0891b2", // Darker Cyan (distinct from Manufacturing)
  Wholesale: "#9333ea", // Deep Purple (distinct from Administrative)
  Other: "#9ca3af", // Neutral Gray for unclassified leads
  "Marketing & Advertising": "#9333ea", // Purple
  "Food & Beverage Services": "#a16207",
  Automotive: "#b91c1c",
  "Non-profit & Organization": "#0f766e",
  "Design & Arts": "#6d28d9",
};

// Get color for industry, with fallback
const getIndustryColor = (industryName) => {
  return (
    INDUSTRY_COLORS[industryName] ||
    CHART_COLORS[Math.floor(Math.random() * CHART_COLORS.length)]
  );
};

// Custom Tooltip Component for better visibility
const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-background border border-border rounded-lg shadow-lg p-3 min-w-[200px]">
        <p className="font-semibold text-foreground text-sm mb-1">
          {data.name}
        </p>
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: data.fill }}
          />
          <p className="text-foreground text-sm">
            <span className="font-medium">{data.value}</span> leads
          </p>
        </div>
        <p className="text-muted-foreground text-xs mt-1">
          {data.percentage}% of total
        </p>
      </div>
    );
  }
  return null;
};

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

export default function DashboardPage() {
  const navigate = useNavigate();
  const { period, setPeriod, month, setMonth, year, setYear } = useTimeFilter();
  const [analytics, setAnalytics] = useState(null);
  const [analyticsError, setAnalyticsError] = useState(null); // e.g. "Backend unreachable"
  const [imports, setImports] = useState([]);
  const [branding, setBranding] = useState({ userName: "", companyName: "" });
  const [loading, setLoading] = useState(true);
  const [industrySearchTerm, setIndustrySearchTerm] = useState("");
  const [selectedIndustries, setSelectedIndustries] = useState(new Set());
  const [expandedIndustries, setExpandedIndustries] = useState(new Set());
  const [hoveredIndustry, setHoveredIndustry] = useState(null);
  const [activeCampaignIndex, setActiveCampaignIndex] = useState(null);
  const [selectedConnectionDegree, setSelectedConnectionDegree] =
    useState(null); // null | '1st' | '2nd' | '3rd'

  // Preferences: driven globally by Settings (preference_active). No dashboard toggle.
  const [settings, setSettings] = useState(null);
  const [preferencesApplied, setPreferencesApplied] = useState(false);

  // Dashboard scope: My Contacts (default) vs All Leads — controls which leads the dashboard stats/charts show
  const DASHBOARD_SCOPE_KEY = "dashboard-scope-v1";
  const [dashboardScope, setDashboardScope] = useState(() => {
    try {
      const s = sessionStorage.getItem(DASHBOARD_SCOPE_KEY);
      if (s === "all" || s === "all_leads") return "all";
      return "my_contacts";
    } catch {
      return "my_contacts";
    }
  });
  const setDashboardScopeAndPersist = (scope) => {
    const v = scope === "all" ? "all" : "my_contacts";
    setDashboardScope(v);
    try {
      sessionStorage.setItem(DASHBOARD_SCOPE_KEY, v);
    } catch (_) {}
  };



  const analyticsAbortRef = useRef(null);
  const fetchDebounceRef = useRef(null);

  const fetchAnalytics = async (signal = null) => {
    try {
      setLoading(true);
      setAnalyticsError(null);
      const params = new URLSearchParams({
        period,
        month,
        year,
        preferences: preferencesApplied,
        scope: dashboardScope,
      });
      if (selectedConnectionDegree)
        params.set("connection_degree", selectedConnectionDegree);
      const res = await axios.get(
        `/api/analytics/dashboard?${params.toString()}`,
        signal ? { signal } : {}
      );
      if (signal?.aborted) return;
      setAnalytics(res.data);
    } catch (err) {
      if (axios.isCancel(err) || err?.name === "AbortError") return;
      const isNetworkError =
        err.code === "ERR_NETWORK" ||
        (err.request && err.request.status === 0) ||
        err.message === "Network Error";
      if (isNetworkError) {
        const base = axios.defaults.baseURL || "the backend";
        setAnalyticsError(
          `Can't reach the server. Make sure the backend is running (e.g. ${base}).`
        );
      } else {
        setAnalyticsError(err.response?.data?.error || err.message || "Failed to load analytics.");
      }
      setAnalytics(null);
    } finally {
      if (!signal || !signal.aborted) setLoading(false);
    }
  };

  const getRangeParams = () => {
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
    } else {
      return "";
    }

    return `&createdFrom=${start.toISOString()}&createdTo=${end.toISOString()}`;
  };

  useEffect(() => {
    if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
    if (analyticsAbortRef.current) analyticsAbortRef.current.abort();

    fetchDebounceRef.current = setTimeout(() => {
      fetchDebounceRef.current = null;
      const controller = new AbortController();
      analyticsAbortRef.current = controller;
      fetchAnalytics(controller.signal);
    }, 300);

    return () => {
      if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
      if (analyticsAbortRef.current) analyticsAbortRef.current.abort();
    };
  }, [period, month, year, selectedConnectionDegree, preferencesApplied, dashboardScope]);

  useEffect(() => {
    axios
      .get("/api/leads/imports?limit=5")
      .then((r) => setImports(r.data || []))
      .catch(() => { });
  }, []);

  useEffect(() => {
    axios
      .get("/api/settings/branding")
      .then((r) => setBranding(r.data || {}))
      .catch(() => { });
  }, []);

  useEffect(() => {
    axios
      .get("/api/settings")
      .then((r) => {
        setSettings(r.data || {});
      })
      .catch(() => { });
  }, []);

  // Global preference_active from Settings (single source of truth). Leads matching profile URL stay on top.
  useEffect(() => {
    axios
      .get("/api/preferences")
      .then((r) => {
        const active = !!(r.data && r.data.preference_active);
        setPreferencesApplied(active);
      })
      .catch(() => {});
  }, []);

  const hasProfileUrl = !!settings?.preferences?.linkedinProfileUrl;

  const toggleConnectionDegreeFilter = (degree) => {
    setSelectedConnectionDegree((prev) => (prev === degree ? null : degree));
  };



  const ls = analytics?.leadScraping ?? {};
  const ca = analytics?.campaignAnalytics ?? {};
  const conn = ls.connectionBreakdown ?? {};
  const displayName = branding.userName || branding.companyName || "there";

  // Lead Quality Data
  const lq = ls.leadQuality ?? {
    primary: 0,
    secondary: 0,
    tertiary: 0,
    totalScored: 0,
  };
  const totalQualityLeads = lq.primary + lq.secondary + lq.tertiary;
  const leadQualityData = [
    {
      id: "primary",
      name: "Primary",
      qualification: "High relevance match",
      value: lq.primary,
      fill: "hsl(var(--primary))",
      desc: "Highest relevance matches",
      percentage:
        totalQualityLeads > 0 ? Math.round((lq.primary / totalQualityLeads) * 100) : 0,
      tag: "Core",
      tagVariant: "default",
    },
    {
      id: "secondary",
      name: "Secondary",
      qualification: "Medium relevance match",
      value: lq.secondary,
      fill: "hsl(var(--primary) / 0.7)",
      desc: "Medium relevance matches",
      percentage:
        totalQualityLeads > 0 ? Math.round((lq.secondary / totalQualityLeads) * 100) : 0,
      tag: "Adjacent",
      tagVariant: "secondary",
    },
    {
      id: "tertiary",
      name: "Tertiary",
      qualification: "Low relevance match",
      value: lq.tertiary,
      fill: "hsl(var(--muted-foreground) / 0.6)",
      desc: "Lower relevance matches",
      percentage:
        totalQualityLeads > 0 ? Math.round((lq.tertiary / totalQualityLeads) * 100) : 0,
      tag: "Exploratory",
      tagVariant: "outline",
    },
  ];

  // Industry + sub-industry data
  const rawIndustryDistribution = ls.industryDistribution || [];
  const totalLeadsCount = rawIndustryDistribution.reduce(
    (sum, d) => sum + (d.count || 0),
    0,
  );

  // Top-level industries (default view)
  const industryPieData = rawIndustryDistribution
    .map((d) => ({
      name: d.industry,
      value: d.count || 0,
      fill: getIndustryColor(d.industry),
      percentage:
        totalLeadsCount > 0
          ? Math.round(((d.count || 0) / totalLeadsCount) * 100)
          : 0,
      contextLabel: "total leads",
      subCategories: Array.isArray(d.subCategories) ? d.subCategories : [],
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => {
      const isOtherA = a.name === "Other" || a.name === "Others";
      const isOtherB = b.name === "Other" || b.name === "Others";
      if (isOtherA && !isOtherB) return 1;
      if (!isOtherA && isOtherB) return -1;
      return b.value - a.value;
    });

  // Build sub-industry breakdown map: { [industryName]: SubSlice[] }
  const subIndustryMap = {};
  industryPieData.forEach((parent) => {
    const subs = parent.subCategories || [];
    if (!subs.length) return;

    const totalForParent =
      subs.reduce((sum, s) => sum + (s.count || 0), 0) || parent.value;

    const slices = subs
      .map((sub, idx) => ({
        name: sub.name,
        value: sub.count || 0,
        fill: CHART_COLORS[idx % CHART_COLORS.length],
        percentage:
          totalForParent > 0
            ? Math.round(((sub.count || 0) / totalForParent) * 100)
            : 0,
        contextLabel: parent.name,
      }))
      .filter((s) => s.value > 0)
      .sort((a, b) => {
        const isOtherA = a.name === "Other" || a.name === "Others";
        const isOtherB = b.name === "Other" || b.name === "Others";
        if (isOtherA && !isOtherB) return 1;
        if (!isOtherA && isOtherB) return -1;
        return b.value - a.value;
      });

    if (slices.length > 0) {
      subIndustryMap[parent.name] = slices;
    }
  });

  // Filter industries based on search term (top-level and subcategories)
  const searchLower = industrySearchTerm.toLowerCase().trim();
  const filteredIndustryData = searchLower
    ? industryPieData.filter((item) => {
      const nameMatches = item.name.toLowerCase().includes(searchLower);
      const subMatches = (item.subCategories || []).some((sub) =>
        sub.name.toLowerCase().includes(searchLower),
      );
      return nameMatches || subMatches;
    })
    : industryPieData;

  // Auto-expand industries when search matches a subcategory
  useEffect(() => {
    if (!searchLower) return;
    const toExpand = industryPieData
      .filter((item) =>
        (item.subCategories || []).some((sub) =>
          sub.name.toLowerCase().includes(searchLower),
        ),
      )
      .map((item) => item.name);
    if (toExpand.length > 0) {
      setExpandedIndustries((prev) => new Set([...prev, ...toExpand]));
    }
  }, [searchLower]);

  // Toggle industry selection
  const toggleIndustrySelection = (industryName) => {
    const newSelected = new Set(selectedIndustries);
    if (newSelected.has(industryName)) {
      newSelected.delete(industryName);
    } else {
      newSelected.add(industryName);
    }
    setSelectedIndustries(newSelected);
  };

  // Clear all selections
  const clearSelections = () => {
    setSelectedIndustries(new Set());
    setIndustrySearchTerm("");
  };

  // Toggle industry expand/collapse for subcategories
  const toggleIndustryExpanded = (industryName, e) => {
    e?.stopPropagation?.();
    setExpandedIndustries((prev) => {
      const next = new Set(prev);
      if (next.has(industryName)) {
        next.delete(industryName);
      } else {
        next.add(industryName);
      }
      return next;
    });
  };

  // If exactly one industry is selected AND we have sub-categories for it,
  // drill down the chart into that industry's sub-categories.
  const singleSelectedIndustry =
    selectedIndustries.size === 1 ? Array.from(selectedIndustries)[0] : null;
  const activeSubIndustryData = singleSelectedIndustry
    ? subIndustryMap[singleSelectedIndustry] || null
    : null;
  const chartData =
    activeSubIndustryData && activeSubIndustryData.length > 0
      ? activeSubIndustryData
      : industryPieData;

  // Connection type data (no chart, just counts)
  const connectionData = {
    firstDegree: conn.firstDegree ?? 0,
    secondDegree: conn.secondDegree ?? 0,
    thirdDegree: conn.thirdDegree ?? 0,
  };

  // Calculate total and percentages
  const totalConnections =
    connectionData.firstDegree +
    connectionData.secondDegree +
    connectionData.thirdDegree;
  const connectionPercentages = {
    firstDegree:
      totalConnections > 0
        ? Math.round((connectionData.firstDegree / totalConnections) * 100)
        : 0,
    secondDegree:
      totalConnections > 0
        ? Math.round((connectionData.secondDegree / totalConnections) * 100)
        : 0,
    thirdDegree:
      totalConnections > 0
        ? Math.round((connectionData.thirdDegree / totalConnections) * 100)
        : 0,
  };

  // Campaign type breakdown with green-gray range colors
  const campaignTypeColors = {
    standard: "#10b981", // Emerald green
    webinar: "#059669", // Darker green
    event: "#34d399", // Light green
    nurture: "#6ee7b7", // Pale green
    re_engagement: "#64748b", // Slate gray
    cold_outreach: "#475569", // Darker gray
    messages_sent: "#94a3b8", // Light gray
  };

  // Format type name for display
  const formatTypeName = (type) => {
    if (type === "messages_sent") return "Messages Sent";
    return type
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Build campaign type pie data from backend
  const campaignPieData = (
    ca.typeBreakdown ? Object.entries(ca.typeBreakdown) : []
  )
    .map(([type, count]) => ({
      name: formatTypeName(type),
      value: count || 0,
      fill:
        campaignTypeColors[type] ||
        CHART_COLORS[Math.floor(Math.random() * CHART_COLORS.length)],
      originalType: type,
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <TooltipProvider>
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 relative">
        {/* Header: Title + Time/Import Actions */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          {/* Left: Title & Subtitle */}
          <div className="flex flex-col gap-1.5">
            <p className="text-base font-semibold text-heading-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-heading-2 fill-heading-2/20" />
              Better conversations, by design.
            </p>
            <p className="text-sm text-muted-foreground max-w-xl">
              Build stronger connections with quality outreach, scoring, and analytics that turn replies into meetings.
            </p>
            {selectedConnectionDegree && (
              <Badge variant="secondary" className="text-xs font-medium w-fit">
                Filtered by {selectedConnectionDegree} degree (past year)
              </Badge>
            )}
          </div>

          {/* Right: Actions Group (Time + Import) */}
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full lg:w-auto justify-end">
            {/* Time Range Group */}
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border bg-muted/40 p-1">
              {PERIODS.map((p) => {
                if (p.value === 'monthly') {
                  return (
                    <DropdownMenu key={p.value}>
                      <DropdownMenuTrigger asChild>
                        <button
                          className={cn(
                            "px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5",
                            period === "monthly"
                              ? "bg-background text-foreground shadow"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => setPeriod("monthly")}
                        >
                          {period === 'monthly' ? `${MONTHS[month]} ${year}` : 'Monthly'}
                          <ChevronDown className="h-3 w-3 opacity-50" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-[180px]">
                        {MONTHS.map((m, idx) => (
                          <DropdownMenuItem
                            key={m}
                            onClick={() => {
                              setPeriod("monthly");
                              setMonth(idx);
                            }}
                            className={cn(
                              "flex items-center justify-between",
                              month === idx && period === 'monthly' && "bg-accent text-accent-foreground"
                            )}
                          >
                            {m}
                            {month === idx && period === 'monthly' && <CheckCircle2 className="h-3 w-3 text-primary" />}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                }
                return (
                  <button
                    key={p.value}
                    onClick={() => setPeriod(p.value)}
                    className={cn(
                      "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                      period === p.value
                        ? "bg-background text-foreground shadow"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

            {/* Dashboard scope: My Contacts (default) vs All Leads */}
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Showing:
              </span>
              <span className="text-sm font-semibold text-foreground">
                {dashboardScope === "all" ? "All Leads" : "My Contacts"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs font-medium text-primary hover:text-primary hover:bg-primary/10"
                onClick={() => setDashboardScopeAndPersist(dashboardScope === "all" ? "my_contacts" : "all")}
              >
                {dashboardScope === "all" ? "My Contacts" : "All Leads"}
              </Button>
            </div>
          </div>
        </div>

        {/* Preferences are global (Settings). When active, leads matching your profile URL stay on top. */}


        {analyticsError && (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 mb-6">
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row items-start gap-4">
                <AlertCircle className="h-10 w-10 text-amber-600 dark:text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-amber-900 dark:text-amber-100">
                    Failed to load dashboard analytics
                  </h3>
                  <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                    {analyticsError}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                    If the backend runs on a different port, set VITE_API_URL in frontend .env (e.g. http://localhost:3000) and restart the dev server.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/50"
                    onClick={() => fetchAnalytics()}
                  >
                    Retry
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* —— Search & Lead Scraping —— */}
        <Card
          className={cn(
            "transition-all duration-700",
            preferencesApplied &&
            "border-primary/50 shadow-[0_0_30px_-5px_hsl(var(--primary)/0.15)] ring-1 ring-primary/20",
          )}
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Rocket className="h-5 w-5 text-primary" />
              Lead quality & distribution
            </CardTitle>
            <CardDescription>
              Extraction and lead quality metrics
              {dashboardScope === "my_contacts" && (
                <span className="ml-2 text-muted-foreground">(My Contacts only)</span>
              )}
              {dashboardScope === "all" && (
                <span className="ml-2 text-muted-foreground">(All leads)</span>
              )}
              {preferencesApplied && (
                <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
                  Prioritized View
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Lead Quality Distribution - Redesigned */}
            <div className="rounded-lg border bg-muted/20 p-4 transition-all hover:bg-muted/30">
              <div className="flex flex-col gap-2 mb-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Lead quality tiers
                    <InfoTooltip
                      content={
                        <div className="space-y-2">
                          <p className="font-semibold border-b border-border/50 pb-1 mb-1">Lead relevance scoring</p>
                          <div className="grid gap-1.5">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                              <span className="text-muted-foreground">Primary <span className="text-foreground/80 font-medium ml-1">= high relevance match</span></span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]" />
                              <span className="text-muted-foreground">Secondary <span className="text-foreground/80 font-medium ml-1">= medium relevance match</span></span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-slate-400" />
                              <span className="text-muted-foreground">Tertiary <span className="text-foreground/80 font-medium ml-1">= low relevance match</span></span>
                            </div>
                          </div>
                        </div>
                      }
                    />
                  </p>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-foreground">{Number(ls.totalLeads ?? totalQualityLeads)}</span>
                  <span className="text-sm font-medium text-muted-foreground">Leads Generated</span>
                </div>
                <p className="text-[11px] text-muted-foreground/70">Primary = best match to your profile, Secondary = medium match, Tertiary = lower match. Based on Settings → LinkedIn Preferences (profile URL).</p>
              </div>

              {loading ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                  Calculating scores...
                </div>
              ) : leadQualityData.length > 0 ? (
                <div className="w-full">
                  {/* KPI Cards (Full Width) */}
                  <div className="flex-1 w-full grid grid-cols-1 gap-4">
                    {leadQualityData.map((item, idx) => (
                      <div
                        key={idx}
                        className="cursor-pointer flex flex-col p-4 rounded-md bg-background/50 border border-border/50 hover:border-primary/50 hover:bg-muted/40 transition-all group relative overflow-hidden space-y-2"
                        onClick={() => {
                          const qualityParam = `quality=${item.id}`;
                          const connParam = selectedConnectionDegree ? `&connection_degree=${selectedConnectionDegree}` : "";
                          if (dashboardScope === "all") {
                            navigate(`/leads?${qualityParam}${connParam}`);
                          } else {
                            navigate(selectedConnectionDegree ? `/my-contacts?${qualityParam}&connection_degree=${selectedConnectionDegree}` : `/my-contacts?${qualityParam}`);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div
                          className="absolute left-0 top-0 bottom-0 w-1 opacity-80 group-hover:opacity-100 transition-opacity"
                          style={{ backgroundColor: item.fill }}
                        />

                        {/* Label & Value Row */}
                        <div className="flex items-center justify-between pl-3 pr-2">
                          <div>
                            <div className="flex items-center gap-3 mb-1">
                              <p className="text-base font-semibold text-foreground group-hover:text-primary transition-colors flex items-center gap-2">
                                {item.name}
                                <span className="text-muted-foreground font-normal text-sm">
                                  — {item.qualification}
                                </span>
                                {idx === 0 && (
                                  <Sparkles className="h-4 w-4 text-yellow-500 fill-yellow-500/20" />
                                )}
                              </p>
                              <Badge
                                variant={item.tagVariant}
                                className="h-5 px-2 text-[10px] font-medium cursor-pointer hover:bg-opacity-80"
                              >
                                {item.tag}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {item.desc}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-3xl font-bold tabular-nums tracking-tight leading-none">
                              {item.value}
                            </p>
                          </div>
                        </div>

                        {/* Unified UI Friendly Bar */}
                        <div className="w-full h-2 bg-muted/50 rounded-full overflow-hidden ml-2 pr-2 mt-1">
                          <div
                            className="h-full rounded-full transition-all duration-1000 ease-out"
                            style={{
                              width: `${item.percentage}%`,
                              backgroundColor: item.fill,
                              opacity: 0.9,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-40 flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
                  <Sparkles className="h-8 w-8 opacity-20" />
                  <p>No scored leads yet</p>
                  <p className="text-xs opacity-70">
                    Set LinkedIn profile URL and turn on preferences in Settings to rank leads by your profile
                  </p>
                </div>
              )}
            </div>

            {/* Connection degree filter: no results hint */}
            {selectedConnectionDegree &&
              !loading &&
              (ls.totalLeads ?? 0) === 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 p-4 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-900 dark:text-amber-100">
                      No {selectedConnectionDegree} degree leads found
                    </p>
                    <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                      Connection degree is set when importing from
                      PhantomBuster. CSV/Excel imports may not include it. Clear
                      the filter to see all leads.
                    </p>
                  </div>
                </div>
              )}

            {/* Connection Type - Moved Up */}
            <div className="rounded-lg border bg-muted/20 p-4 transition-all hover:bg-muted/30">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-primary" />
                  Connection types
                  <InfoTooltip
                    content={
                      selectedConnectionDegree
                        ? `Showing only ${selectedConnectionDegree} degree leads. Click a card to filter, click again to clear.`
                        : "Distribution of 1st, 2nd, and 3rd degree connections. Click a card to filter the dashboard by that degree."
                    }
                  />
                </p>
                {selectedConnectionDegree && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedConnectionDegree(null)}
                    className="h-7 px-2 text-xs gap-1"
                  >
                    <X className="h-3 w-3" />
                    Clear filter
                  </Button>
                )}
              </div>
              {loading ? (
                <div className="h-20 flex items-center justify-center text-muted-foreground text-sm">
                  Loading...
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div
                    className={cn(
                      "flex items-center justify-between p-3 rounded-md bg-background/50 border border-border/50 hover:border-primary/50 hover:bg-muted/40 transition-all cursor-pointer group",
                      selectedConnectionDegree === "1st" &&
                      "ring-2 ring-primary bg-primary/10 border-primary/50",
                    )}
                    onClick={() => toggleConnectionDegreeFilter("1st")}
                  >
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <UserCheck className="h-4 w-4" />
                      </div>
                      <span className="font-medium text-foreground">
                        1st degree
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold block leading-none">
                        {connectionData.firstDegree}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {connectionPercentages.firstDegree}%
                      </span>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "flex items-center justify-between p-3 rounded-md bg-background/50 border border-border/50 hover:border-primary/50 hover:bg-muted/40 transition-all cursor-pointer group",
                      selectedConnectionDegree === "2nd" &&
                      "ring-2 ring-primary bg-primary/10 border-primary/50",
                    )}
                    onClick={() => toggleConnectionDegreeFilter("2nd")}
                  >
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <UserPlus className="h-4 w-4" />
                      </div>
                      <span className="font-medium text-foreground">
                        2nd degree
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold block leading-none">
                        {connectionData.secondDegree}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {connectionPercentages.secondDegree}%
                      </span>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "flex items-center justify-between p-3 rounded-md bg-background/50 border border-border/50 hover:border-primary/50 hover:bg-muted/40 transition-all cursor-pointer group",
                      selectedConnectionDegree === "3rd" &&
                      "ring-2 ring-primary bg-primary/10 border-primary/50",
                    )}
                    onClick={() => toggleConnectionDegreeFilter("3rd")}
                  >
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <Users className="h-4 w-4" />
                      </div>
                      <span className="font-medium text-foreground">
                        3rd degree
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold block leading-none">
                        {connectionData.thirdDegree}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {connectionPercentages.thirdDegree}%
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Lead Metrics - Enhanced Visualization */}
            <div className="rounded-lg border bg-muted/20 p-4 transition-all hover:bg-muted/30">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  Quality distribution
                  <InfoTooltip content="Overview of total leads quality distribution and contact information availability." />
                </p>
              </div>

              {loading ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                  Loading metrics...
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Leads Quality Distribution Bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-foreground">
                        Quality percentage breakdown
                      </span>
                      <span className="font-bold text-foreground">
                        {ls.totalLeads || 0} total
                      </span>
                    </div>
                    <div className="w-full h-8 bg-muted/50 rounded-full overflow-hidden relative flex shadow-inner">
                      {/* Primary segment - Hot/Orange */}
                      {lq.primary > 0 && (
                        <div
                          className="h-full bg-[#f97316] transition-all duration-1000 ease-out flex items-center justify-center relative group"
                          style={{
                            width: `${ls.totalLeads > 0 ? (lq.primary / ls.totalLeads) * 100 : 0}%`,
                          }}
                        >
                          <span className="text-[10px] sm:text-xs font-bold text-white px-1 truncate">
                            {ls.totalLeads > 0 ? Math.round((lq.primary / ls.totalLeads) * 100) : 0}%
                          </span>
                          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded shadow-lg border opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                            Hot (primary): {ls.totalLeads > 0 ? Math.round((lq.primary / ls.totalLeads) * 100) : 0}%
                          </div>
                        </div>
                      )}
                      {/* Secondary segment - Warm/Amber */}
                      {lq.secondary > 0 && (
                        <div
                          className="h-full bg-[#f59e0b] transition-all duration-1000 ease-out flex items-center justify-center relative group"
                          style={{
                            width: `${ls.totalLeads > 0 ? (lq.secondary / ls.totalLeads) * 100 : 0}%`,
                          }}
                        >
                          <span className="text-[10px] sm:text-xs font-bold text-white px-1 truncate">
                            {ls.totalLeads > 0 ? Math.round((lq.secondary / ls.totalLeads) * 100) : 0}%
                          </span>
                          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded shadow-lg border opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                            Warm (secondary): {ls.totalLeads > 0 ? Math.round((lq.secondary / ls.totalLeads) * 100) : 0}%
                          </div>
                        </div>
                      )}
                      {/* Tertiary segment - Cold/Blue */}
                      {lq.tertiary > 0 && (
                        <div
                          className="h-full bg-[#3b82f6] transition-all duration-1000 ease-out flex items-center justify-center relative group"
                          style={{
                            width: `${ls.totalLeads > 0 ? (lq.tertiary / ls.totalLeads) * 100 : 0}%`,
                          }}
                        >
                          <span className="text-[10px] sm:text-xs font-bold text-white px-1 truncate">
                            {ls.totalLeads > 0 ? Math.round((lq.tertiary / ls.totalLeads) * 100) : 0}%
                          </span>
                          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded shadow-lg border opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                            Cold (tertiary): {ls.totalLeads > 0 ? Math.round((lq.tertiary / ls.totalLeads) * 100) : 0}%
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground px-1">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#f97316]" />{" "}
                        🔥 Hot (Primary)
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />{" "}
                        ☀️ Warm (Secondary)
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#3b82f6]" />{" "}
                        ❄️ Cold (Tertiary)
                      </div>
                    </div>
                  </div>

                  {/* Contact Availability Grid (Hidden for now) */}
                  {/* <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between text-xs">
                                                    <span className="font-medium text-muted-foreground flex items-center gap-1.5">
                                                        <Mail className="h-3.5 w-3.5 text-blue-500" /> 
                                                        Leads with Email
                                                    </span>
                                                    <span className="font-bold text-foreground">{ls.leadsWithEmail || 0}</span>
                                                </div>
                                                <div className="w-full h-3 bg-muted/50 rounded-full overflow-hidden shadow-inner">
                                                    <div
                                                        className="h-full bg-blue-500 transition-all duration-1000 ease-out"
                                                        style={{ width: `${ls.totalLeads > 0 ? (ls.leadsWithEmail / ls.totalLeads) * 100 : 0}%` }}
                                                    />
                                                </div>
                                                <p className="text-[10px] text-right text-muted-foreground">
                                                    {ls.totalLeads > 0 ? Math.round((ls.leadsWithEmail / ls.totalLeads) * 100) : 0}% coverage
                                                </p>
                                            </div>

                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between text-xs">
                                                    <span className="font-medium text-muted-foreground flex items-center gap-1.5">
                                                        <Phone className="h-3.5 w-3.5 text-emerald-500" /> 
                                                        Leads with Phone
                                                    </span>
                                                    <span className="font-bold text-foreground">{ls.leadsWithPhone || 0}</span>
                                                </div>
                                                <div className="w-full h-3 bg-muted/50 rounded-full overflow-hidden shadow-inner">
                                                    <div
                                                        className="h-full bg-emerald-500 transition-all duration-1000 ease-out"
                                                        style={{ width: `${ls.totalLeads > 0 ? (ls.leadsWithPhone / ls.totalLeads) * 100 : 0}%` }}
                                                    />
                                                </div>
                                                <p className="text-[10px] text-right text-muted-foreground">
                                                    {ls.totalLeads > 0 ? Math.round((ls.leadsWithPhone / ls.totalLeads) * 100) : 0}% coverage
                                                </p>
                                            </div>
                                        </div> */}
                </div>
              )}
            </div>

            {/* Industry distribution - Full width, larger chart */}
            <div className="rounded-lg border bg-muted/30 p-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Industry distribution
                  <InfoTooltip content="Breakdown of leads by their identified industry." />
                </p>
                {industryPieData.length > 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Total: {totalLeadsCount} leads</span>
                    {selectedIndustries.size > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearSelections}
                        className="h-6 px-2 text-xs"
                      >
                        <X className="h-3 w-3 mr-1" />
                        Clear ({selectedIndustries.size})
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {loading ? (
                <div className="h-96 flex items-center justify-center text-muted-foreground text-sm">
                  Loading…
                </div>
              ) : industryPieData.length > 0 ? (
                <>
                  {/* Selected Industries Display */}
                  {selectedIndustries.size > 0 && (
                    <div className="mb-6 p-4 bg-primary/5 border border-primary/20 rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                          <Target className="h-4 w-4 text-primary" />
                          Selected Industries ({selectedIndustries.size})
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {Array.from(selectedIndustries).map((industryName) => {
                          const industry = industryPieData.find(
                            (d) => d.name === industryName,
                          );
                          if (!industry) return null;
                          return (
                            <div
                              key={industryName}
                              className="flex items-center gap-3 p-3 bg-background border border-primary/30 rounded-md hover:border-primary/50 transition-colors"
                            >
                              <div
                                className="w-4 h-4 rounded-full flex-shrink-0 border-2 border-background shadow-sm"
                                style={{ backgroundColor: industry.fill }}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-foreground truncate">
                                  {industry.name}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs font-medium text-primary">
                                    {industry.value}{" "}
                                    {industry.value === 1 ? "lead" : "leads"}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    ·
                                  </span>
                                  <span className="text-xs font-semibold text-foreground">
                                    {industry.percentage}%
                                  </span>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  toggleIndustrySelection(industryName)
                                }
                                className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                      {selectedIndustries.size > 0 && (
                        <div className="col-span-full mt-3 flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 bg-background/50 hover:bg-background"
                            onClick={() => {
                              const params = new URLSearchParams();
                              params.set(
                                "industry",
                                Array.from(selectedIndustries)[0],
                              );
                              if (selectedConnectionDegree)
                                params.set(
                                  "connection_degree",
                                  selectedConnectionDegree,
                                );
                              navigate(`/leads?${params.toString()}`);
                            }}
                          >
                            <MoveRight className="h-4 w-4" />
                            View in Leads List
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid lg:grid-cols-2 gap-6">
                    {/* Chart - Clean without labels */}
                    <div className="flex flex-col items-center justify-center">
                      {/* Show selected industry details above chart */}
                      {selectedIndustries.size === 1 &&
                        (() => {
                          const selectedIndustry = industryPieData.find((d) =>
                            selectedIndustries.has(d.name),
                          );
                          if (!selectedIndustry) return null;

                          const subSlices =
                            subIndustryMap[selectedIndustry.name] || [];

                          return (
                            <div className="mb-4 w-full p-4 bg-primary/10 border border-primary/30 rounded-lg">
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-6 h-6 rounded-full flex-shrink-0 border-2 border-background shadow-md"
                                  style={{
                                    backgroundColor: selectedIndustry.fill,
                                  }}
                                />
                                <div className="flex-1">
                                  <p className="text-base font-bold text-foreground">
                                    {selectedIndustry.name}
                                  </p>
                                  <div className="flex items-center gap-3 mt-1">
                                    <span className="text-sm font-semibold text-primary">
                                      {selectedIndustry.value}{" "}
                                      {selectedIndustry.value === 1
                                        ? "lead"
                                        : "leads"}
                                    </span>
                                    <span className="text-sm text-muted-foreground">
                                      ·
                                    </span>
                                    <span className="text-sm font-semibold text-foreground">
                                      {selectedIndustry.percentage}% of total
                                      leads
                                    </span>
                                  </div>
                                  {subSlices.length > 0 && (
                                    <div className="mt-3">
                                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                                        Sub-categories ({subSlices.length})
                                      </p>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {subSlices.slice(0, 6).map((sub) => (
                                          <div
                                            key={sub.name}
                                            className="flex items-center justify-between rounded-md bg-background/80 border border-border/60 px-2.5 py-1.5"
                                          >
                                            <div className="flex items-center gap-2 min-w-0">
                                              <span
                                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                                style={{
                                                  backgroundColor: sub.fill,
                                                }}
                                              />
                                              <span className="text-xs font-medium text-foreground truncate">
                                                {sub.name}
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                              <span>
                                                {sub.value}{" "}
                                                {sub.value === 1
                                                  ? "lead"
                                                  : "leads"}
                                              </span>
                                              <span>·</span>
                                              <span className="font-semibold text-foreground">
                                                {sub.percentage}%
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      <ResponsiveContainer width="100%" height={400}>
                        <PieChart>
                          <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={80}
                            outerRadius={140}
                            paddingAngle={3}
                            dataKey="value"
                            nameKey="name"
                            label={false}
                          >
                            {chartData.map((entry, i) => {
                              const isSelected = selectedIndustries.has(
                                entry.name,
                              );
                              const isHovered = hoveredIndustry === entry.name;
                              return (
                                <Cell
                                  key={`cell-${i}`}
                                  fill={entry.fill}
                                  stroke={entry.fill}
                                  strokeWidth={
                                    isSelected ? 4 : isHovered ? 3 : 2
                                  }
                                  opacity={
                                    selectedIndustries.size > 0 && !isSelected
                                      ? 0.3
                                      : isHovered
                                        ? 0.9
                                        : 1
                                  }
                                  style={{ cursor: "pointer" }}
                                  onClick={() =>
                                    toggleIndustrySelection(entry.name)
                                  }
                                />
                              );
                            })}
                          </Pie>
                          <RechartsTooltip content={<CustomTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Filter Panel with Search and Industry List */}
                    <div className="flex flex-col">
                      {/* Search Bar */}
                      <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          placeholder="Search industries (e.g. Technology, Finance)"
                          value={industrySearchTerm}
                          onChange={(e) =>
                            setIndustrySearchTerm(e.target.value)
                          }
                          className="pl-9 h-9 placeholder:text-muted-foreground/80 focus:placeholder:text-muted-foreground"
                        />
                      </div>

                      {/* Industry List with Details and Subcategories */}
                      <div className="border rounded-lg bg-background/50 p-3 max-h-[340px] overflow-y-auto relative">
                        <div className="space-y-1">
                          {filteredIndustryData.length > 0 ? (
                            filteredIndustryData.map((entry, i) => {
                              const isSelected = selectedIndustries.has(
                                entry.name,
                              );
                              const isHovered = hoveredIndustry === entry.name;
                              const subSlices =
                                subIndustryMap[entry.name] || [];
                              const hasSubcategories = subSlices.length > 0;
                              const isExpanded = expandedIndustries.has(
                                entry.name,
                              );
                              return (
                                <div key={i} className="space-y-1">
                                  <div
                                    onClick={() =>
                                      toggleIndustrySelection(entry.name)
                                    }
                                    onMouseEnter={() =>
                                      setHoveredIndustry(entry.name)
                                    }
                                    onMouseLeave={() =>
                                      setHoveredIndustry(null)
                                    }
                                    className={cn(
                                      "flex items-center gap-3 p-3 rounded-md transition-all cursor-pointer border relative group",
                                      isSelected
                                        ? "bg-primary/10 border-primary/50 shadow-sm"
                                        : "hover:bg-muted/50 border-transparent hover:border-border",
                                    )}
                                  >
                                    <button
                                      type="button"
                                      onClick={(e) =>
                                        toggleIndustryExpanded(entry.name, e)
                                      }
                                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-foreground"
                                      title={
                                        hasSubcategories
                                          ? "Expand subcategories"
                                          : "Expand details"
                                      }
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="h-4 w-4" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4" />
                                      )}
                                    </button>
                                    <div
                                      className="w-5 h-5 rounded-full flex-shrink-0 border-2 border-background shadow-sm"
                                      style={{ backgroundColor: entry.fill }}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p
                                        className={cn(
                                          "text-sm font-medium text-foreground",
                                          isSelected && "text-primary",
                                        )}
                                      >
                                        {entry.name}
                                      </p>
                                      <div className="flex items-center gap-3 mt-0.5">
                                        <p className="text-xs text-muted-foreground">
                                          {entry.value}{" "}
                                          {entry.value === 1 ? "lead" : "leads"}
                                        </p>
                                        <span className="text-xs text-muted-foreground">
                                          ·
                                        </span>
                                        <p className="text-xs font-semibold text-foreground">
                                          {entry.percentage}%
                                        </p>
                                      </div>
                                    </div>

                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className={cn(
                                        "h-8 w-8 ml-1 shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all",
                                        !isHovered &&
                                        !isSelected &&
                                        "opacity-0 group-hover:opacity-100",
                                      )}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const params = new URLSearchParams();
                                        params.set("industry", entry.name);
                                        if (selectedConnectionDegree)
                                          params.set(
                                            "connection_degree",
                                            selectedConnectionDegree,
                                          );
                                        navigate(`/leads?${params.toString()}`);
                                      }}
                                      title="View leads"
                                    >
                                      <ArrowRight className="h-4 w-4" />
                                    </Button>

                                    {isSelected && (
                                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 ml-1" />
                                    )}

                                    {/* Hover Tooltip */}
                                    {isHovered && (
                                      <div className="absolute right-full mr-3 top-1/2 -translate-y-1/2 z-50 pointer-events-none">
                                        <div className="bg-background border border-border rounded-lg shadow-lg p-3 min-w-[200px]">
                                          <p className="font-semibold text-foreground text-sm mb-1">
                                            {entry.name}
                                          </p>
                                          <div className="flex items-center gap-2">
                                            <div
                                              className="w-3 h-3 rounded-full flex-shrink-0"
                                              style={{
                                                backgroundColor: entry.fill,
                                              }}
                                            />
                                            <p className="text-foreground text-sm">
                                              <span className="font-medium">
                                                {entry.value}
                                              </span>{" "}
                                              leads
                                            </p>
                                          </div>
                                          <p className="text-muted-foreground text-xs mt-1">
                                            {entry.percentage}% of total
                                          </p>
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Expandable Subcategories */}
                                  {isExpanded && (
                                    <div className="ml-6 pl-4 border-l-2 border-muted/60 space-y-1">
                                      {hasSubcategories ? (
                                        subSlices.map((sub) => (
                                          <div
                                            key={sub.name}
                                            className="flex items-center gap-2 py-2 px-3 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
                                          >
                                            <div
                                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                              style={{
                                                backgroundColor: sub.fill,
                                              }}
                                            />
                                            <div className="flex-1 min-w-0">
                                              <p className="text-xs font-medium text-foreground">
                                                {sub.name}
                                              </p>
                                              <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[11px] text-muted-foreground">
                                                  {sub.value}{" "}
                                                  {sub.value === 1
                                                    ? "lead"
                                                    : "leads"}
                                                </span>
                                                <span className="text-[11px] text-muted-foreground">
                                                  ·
                                                </span>
                                                <span className="text-[11px] font-medium text-foreground">
                                                  {sub.percentage}%
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        ))
                                      ) : (
                                        <p className="py-2 px-3 text-xs text-muted-foreground">
                                          No subcategory breakdown available
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          ) : (
                            <div className="text-center py-8 text-sm text-muted-foreground">
                              No industries found matching "{industrySearchTerm}
                              "
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Summary Stats */}
                      {filteredIndustryData.length > 0 && (
                        <div className="mt-4 pt-4 border-t flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            Showing {filteredIndustryData.length} of{" "}
                            {industryPieData.length} industries
                          </span>
                          {filteredIndustryData.length <
                            industryPieData.length && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setIndustrySearchTerm("")}
                                className="h-6 px-2 text-xs"
                              >
                                Clear search
                              </Button>
                            )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-96 flex items-center justify-center text-muted-foreground text-sm">
                  No industry data available
                </div>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-lg border bg-muted/30 p-4 flex flex-col justify-center">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Rocket className="h-3.5 w-3.5" />
                  Extracted this period
                  <InfoTooltip
                    content={`Total number of profiles extracted during the ${period} period.`}
                  />
                </p>
                <p className="text-3xl font-bold">
                  {loading ? "—" : (ls.extractionByPeriod?.count ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground mt-1 capitalize">
                  {period}
                </p>
              </div>
            </div>

            {ls.sourceCount && Object.keys(ls.sourceCount).length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center">
                  By source (filter extracted data)
                  <InfoTooltip content="Breakdown of extracted leads by their origin source." />
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(ls.sourceCount).map(([source, count]) => {
                    const displayNames = {
                      connections_export: "my connections",
                      search_export: "prospects",
                    };
                    const label = displayNames[source] || source.replace(/_/g, " ");
                    return (
                      <span
                        key={source}
                        className="inline-flex items-center rounded-md bg-secondary px-2.5 py-0.5 text-xs font-medium"
                      >
                        {label}: {count}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* —— Campaign Analytics —— */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Campaign Analytics
            </CardTitle>
            <CardDescription>Status, messaging & engagement</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Campaign types pie + messaging stats */}
            <div className="grid md:grid-cols-2 gap-6 items-stretch">
              <div className="rounded-lg border bg-muted/30 p-6 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5" />
                    Campaign Types
                    <InfoTooltip content="Diversity of your outreach strategy by campaign type." />
                  </p>
                </div>

                {loading ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                    Loading…
                  </div>
                ) : campaignPieData.length > 0 ? (
                  <div className="flex flex-col flex-1 justify-between">
                    <div>
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie
                            data={campaignPieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
                            paddingAngle={4}
                            dataKey="value"
                            nameKey="name"
                            label={false}
                            activeIndex={activeCampaignIndex}
                            onMouseEnter={(_, index) =>
                              setActiveCampaignIndex(index)
                            }
                            onMouseLeave={() => setActiveCampaignIndex(null)}
                          >
                            {campaignPieData.map((entry, i) => (
                              <Cell
                                key={i}
                                fill={entry.fill}
                                strokeWidth={0}
                                style={{ cursor: "pointer" }}
                              />
                            ))}
                          </Pie>
                          <RechartsTooltip />
                        </PieChart>
                      </ResponsiveContainer>

                      {/* Legend Below Chart */}
                      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
                        {campaignPieData.map((entry, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: entry.fill }}
                            />
                            <span className="text-sm font-medium text-foreground truncate">
                              {entry.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Active/Paused Indicators */}
                    <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-border/50">
                      <div className="text-center">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                          Active
                        </p>
                        <p className="text-xl font-bold text-foreground">
                          {ca.statusOverview?.active ?? 0}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                          Paused/Scheduled
                        </p>
                        <p className="text-xl font-bold text-foreground">
                          {(ca.statusOverview?.draft ?? 0) +
                            (ca.statusOverview?.scheduled ?? 0)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                    No campaign types available
                  </div>
                )}
              </div>

              {/* Right Side: Message Metrics or Zero State */}
              <div className="flex flex-col h-full">
                {(ca.messaging?.messagesSent ?? 0) === 0 && !loading ? (
                  <div className="h-full rounded-lg border border-dashed border-border bg-muted/20 p-8 flex flex-col items-center justify-center text-center min-h-[300px]">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                      <MessageSquare className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="font-semibold text-lg text-foreground mb-2">
                      No messages sent yet
                    </h3>
                    <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto">
                      You haven't sent any messages this period. Start reaching
                      out to your leads!
                    </p>
                    <Button
                      onClick={() => navigate("/campaigns/new")}
                      className="gap-2"
                    >
                      <UserPlus className="h-4 w-4" />
                      Create Your First Campaign
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 h-full">
                    <div className="rounded-lg border bg-muted/30 p-6 text-center hover:bg-muted/40 transition-colors flex flex-col items-center justify-center flex-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                        Messages sent
                        <InfoTooltip content="Total messages sent during selected period." />
                      </p>
                      <p className="text-4xl font-bold text-foreground">
                        {loading ? "—" : (ca.messaging?.messagesSent ?? 0)}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 flex-1">
                      <div className="rounded-lg border bg-muted/30 p-4 text-center hover:bg-muted/40 transition-colors flex flex-col items-center justify-center">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                          Replies
                          <InfoTooltip content="Replies received from sent messages." />
                        </p>
                        <p className="text-3xl font-bold text-foreground">
                          {loading ? "—" : (ca.messaging?.repliesReceived ?? 0)}
                        </p>
                      </div>
                      <div className="rounded-lg border bg-muted/30 p-4 text-center hover:bg-muted/40 transition-colors flex flex-col items-center justify-center">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                          Engagement
                          <InfoTooltip content="Reply rate based on messages sent." />
                        </p>
                        <p className="text-3xl font-bold text-foreground">
                          {loading
                            ? "—"
                            : Math.round(ca.messaging?.engagementPercent ?? 0)}
                          %
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border bg-primary/5 border-primary/20 p-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5" />
                This period ({period})
                <InfoTooltip
                  content={`Aggregated metrics for the selected ${period} timeframe.`}
                />
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center p-3 rounded-md bg-background/50 hover:bg-background/70 transition-colors">
                  <p className="text-2xl font-bold text-foreground">
                    {loading ? "—" : (ca.totalsByPeriod?.campaigns ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center">
                    Campaigns{" "}
                    <InfoTooltip
                      content={`Campaigns created during selected period.`}
                    />
                  </p>
                </div>
                <div className="text-center p-3 rounded-md bg-background/50 hover:bg-background/70 transition-colors">
                  <p className="text-2xl font-bold text-foreground">
                    {loading ? "—" : (ca.totalsByPeriod?.leadsAdded ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center">
                    Leads added to campaigns
                    <InfoTooltip
                      content={`Leads added to active campaigns during the selected ${period} period.`}
                    />
                  </p>
                </div>
                <div className="text-center p-3 rounded-md bg-background/50 hover:bg-background/70 transition-colors">
                  <p className="text-2xl font-bold text-foreground">
                    {loading ? "—" : (ca.totalsByPeriod?.messagesSent ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center">
                    Messages sent{" "}
                    <InfoTooltip
                      content={`Messages sent specifically during the ${period} period.`}
                    />
                  </p>
                </div>
                <div className="text-center p-3 rounded-md bg-background/50 hover:bg-background/70 transition-colors">
                  <p className="text-2xl font-bold text-foreground">
                    {loading ? "—" : Math.round(ca.totalsByPeriod?.engagement ?? 0)}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center">
                    Engagement{" "}
                    <InfoTooltip
                      content={`Engagement rate calculated for the ${period} period.`}
                    />
                  </p>
                </div>
              </div>
            </div>

          </CardContent>
        </Card>

        {/* Recent imports + CTA */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center">
                Recent imports
                <InfoTooltip content="Your latest data imports." />
              </CardTitle>
              <CardDescription>Last data imports</CardDescription>
            </CardHeader>
            <CardContent>
              {imports.length > 0 ? (
                <ul className="space-y-2">
                  {imports.slice(0, 5).map((imp, i) => (
                    <li
                      key={i}
                      className="flex justify-between text-sm border-b border-border pb-2 last:border-0"
                    >
                      <span className="font-medium capitalize">
                        {imp.source === 'connections_export' ? 'My connections' : imp.source === 'search_export' ? 'Prospects' : (imp.source?.replace(/_/g, " ") ?? "Import")}
                      </span>
                      <span className="text-muted-foreground">
                        {imp.total_leads ?? imp.totalLeads ?? 0} leads ·{" "}
                        {imp.saved ?? 0} saved
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No recent imports
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-6">
              <h3 className="font-semibold text-lg">
                Manage leads & campaigns
              </h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                View, filter, and run outreach from Leads and Campaigns.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() =>
                    navigate(
                      selectedConnectionDegree
                        ? `/leads?connection_degree=${selectedConnectionDegree}`
                        : "/leads",
                    )
                  }
                  variant="default"
                  className="gap-2"
                >
                  Leads <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  onClick={() => navigate("/campaigns")}
                  variant="outline"
                  className="gap-2"
                >
                  Campaigns <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </TooltipProvider>
  );
}

function MiniStat({ label, value, icon: Icon }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
      <div>
        <p className="text-lg font-semibold">{value ?? 0}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

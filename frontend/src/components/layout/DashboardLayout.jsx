import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { LayoutDashboard, Users, UserPlus, Contact, Megaphone, Settings, Menu, Newspaper, Search, ChevronDown, Sun, Moon } from 'lucide-react';
import { cn } from '../../lib/utils';
import NotificationDropdown from '../NotificationDropdown';
import { TimeFilterProvider } from '../../context/TimeFilterContext';

const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/', color: '#6366f1' },
    { id: 'search', label: 'Lead Search', icon: Search, path: '/search', color: '#0ea5e9' },
    {
        id: 'crm',
        label: 'CRM',
        icon: Users,
        path: '/my-contacts',
        color: '#10b981',
        children: [
            { id: 'my-contacts', label: 'My Contacts', path: '/my-contacts' },
            { id: 'prospects', label: 'Prospects', path: '/prospects' },
            { id: 'leads', label: 'Leads', path: '/leads' },
        ],
    },
    {
        id: 'campaigns',
        label: 'Campaigns',
        icon: Megaphone,
        path: '/campaigns',
        color: '#f59e0b',
        children: [
            { id: 'campaigns-linkedin', label: 'LinkedIn', path: '/campaigns' },
            { id: 'campaigns-email', label: 'Email', path: '/campaigns/email' },
        ],
    },
    { id: 'content', label: 'Content Engine', icon: Newspaper, path: '/content', color: '#a855f7' },
    { id: 'settings', label: 'Settings', icon: Settings, path: '/settings', color: '#64748b' },
];

const UI_PREFS_STORAGE_KEY = 'ui-preferences-v1';

const applyUiPreferencesFromStorage = () => {
    try {
        const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const root = document.documentElement;
        const contrast = ['soft', 'normal', 'high'].includes(parsed.contrast) ? parsed.contrast : 'normal';
        const radius = ['rounded', 'square'].includes(parsed.radius) ? parsed.radius : 'rounded';
        const effects = ['rich', 'minimal'].includes(parsed.effects) ? parsed.effects : 'rich';
        root.setAttribute('data-ui-contrast', contrast);
        root.setAttribute('data-ui-radius', radius);
        root.setAttribute('data-ui-effects', effects);
        return parsed;
    } catch {
        document.documentElement.setAttribute('data-ui-contrast', 'normal');
        document.documentElement.setAttribute('data-ui-radius', 'rounded');
        document.documentElement.setAttribute('data-ui-effects', 'rich');
        return {};
    }
};

export default function DashboardLayout() {
    const location = useLocation();
    const navigate = useNavigate();
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [expandedItems, setExpandedItems] = useState({});
    const [isDarkMode, setIsDarkMode] = useState(() => {
        try {
            const rawPrefs = localStorage.getItem(UI_PREFS_STORAGE_KEY);
            if (rawPrefs) {
                const parsedPrefs = JSON.parse(rawPrefs);
                if (parsedPrefs.mode === 'light') return false;
                if (parsedPrefs.mode === 'dark') return true;
            }
        } catch { }
        const storedTheme = localStorage.getItem('theme-mode');
        if (storedTheme === 'light') return false;
        if (storedTheme === 'dark') return true;
        // Default to dark for better overall UX and reduced eye strain
        return true;
    });
    const [branding, setBranding] = useState({ userName: 'Rishab Khandelwal', companyName: '', logoUrl: '', profileImageUrl: '', theme: 'default', linkedinAccountName: '' });

    useEffect(() => {
        axios.get('/api/settings/branding').then((r) => {
            const data = r.data || {};
            setBranding(data);
        }).catch(() => { });
    }, []);

    useEffect(() => {
        const theme = branding.theme && branding.theme !== 'default' ? branding.theme : '';
        document.documentElement.setAttribute('data-theme', theme);
        return () => document.documentElement.removeAttribute('data-theme');
    }, [branding.theme]);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', isDarkMode);
        localStorage.setItem('theme-mode', isDarkMode ? 'dark' : 'light');
        try {
            const rawPrefs = localStorage.getItem(UI_PREFS_STORAGE_KEY);
            const parsedPrefs = rawPrefs ? JSON.parse(rawPrefs) : {};
            localStorage.setItem(
                UI_PREFS_STORAGE_KEY,
                JSON.stringify({ ...parsedPrefs, mode: isDarkMode ? 'dark' : 'light' }),
            );
        } catch { }
    }, [isDarkMode]);

    useEffect(() => {
        const syncPreferences = () => {
            const parsed = applyUiPreferencesFromStorage();
            if (parsed.mode === 'light') setIsDarkMode(false);
            if (parsed.mode === 'dark') setIsDarkMode(true);
        };

        syncPreferences();
        window.addEventListener('ui-preferences-updated', syncPreferences);
        return () => window.removeEventListener('ui-preferences-updated', syncPreferences);
    }, []);

    const getInitials = (name) => {
        if (!name || name === 'there') return 'JD';
        const parts = String(name).trim().split(/\s+/);
        if (parts.length === 1) return (parts[0][0] || 'U').toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };

    // Show initials (e.g. RK) when we have first + last name; otherwise show full name or company
    const nameForDisplay = branding.userName || 'Rishab Khandelwal';
    const displayName = nameForDisplay;
    // Logo URLs: use backend base in production so Vercel loads from API
    const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '').trim();
    const navLogoSrc = (() => {
        const u = branding.navLogoUrl || '/api/settings/logo/nav';
        return (apiBase && u.startsWith('/')) ? apiBase + u : u;
    })();
    const [navLogoFailed, setNavLogoFailed] = useState(false);
    const logoFallbackSrc = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>');
    const topLogoSrc = (() => {
        const u = branding.logoUrl || '/api/settings/logo/default';
        return (apiBase && u.startsWith('/')) ? apiBase + u : u;
    })();
    const [topLogoFailed, setTopLogoFailed] = useState(false);

    useEffect(() => {
        setNavLogoFailed(false);
    }, [branding.navLogoUrl]);

    useEffect(() => {
        setTopLogoFailed(false);
    }, [branding.logoUrl]);

    const initials = getInitials(nameForDisplay);

    // Determine the current page label for the header breadcrumb
    const currentPage = navItems.reduce((found, item) => {
        if (found) return found;
        if (item.children) {
            const child = item.children.find(c => location.pathname + location.search === c.path || location.pathname === c.path.split('?')[0]);
            if (child) return { label: child.label, parent: item.label };
        }
        if (item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)) return { label: item.label };
        return null;
    }, null);

    return (
        <TimeFilterProvider>
            <div className="min-h-screen bg-background flex text-foreground font-sans overflow-x-hidden">
                {/* ── Aurora background ── */}
                <div className="aurora-bg" aria-hidden="true" />
                <div className="dot-grid fixed inset-0 -z-[1] pointer-events-none" aria-hidden="true" />

                {/* ── Sidebar ── */}
                <aside
                    className={cn(
                        "fixed h-full z-30 flex flex-col transition-all duration-300 ease-out",
                        sidebarOpen ? "w-[240px]" : "w-[68px]"
                    )}
                >
                    {/* Sidebar inner (glassmorphism applied via global CSS) */}
                    <div className="flex flex-col h-full">

                        {/* ── Logo area (Kinnote logo at top) ── */}
                        <div className={cn(
                            "flex items-center border-b border-border/40 overflow-hidden transition-all duration-300",
                            sidebarOpen ? "h-[64px] px-5" : "h-[64px] px-0 justify-center"
                        )}>
                            {sidebarOpen ? (
                                <div className="flex flex-col justify-center overflow-hidden select-none min-w-0">
                                    {!topLogoFailed ? (
                                        <img
                                            src={topLogoSrc}
                                            alt="Kinnote"
                                            className="h-8 w-auto max-w-[180px] object-contain"
                                            onError={() => setTopLogoFailed(true)}
                                        />
                                    ) : (
                                        <span className="font-heading font-black text-[20px] tracking-tight leading-none bg-gradient-to-r from-primary to-primary/80 bg-clip-text text-transparent">
                                            Kinnote
                                        </span>
                                    )}
                                    <span className="text-[10px] font-medium text-muted-foreground mt-1.5 leading-tight">
                                        <span className="block">Better conversations</span>
                                        <span className="block">by design.</span>
                                    </span>
                                </div>
                            ) : (
                                !topLogoFailed ? (
                                    <img src={topLogoSrc} alt="Kinnote" className="h-8 w-auto max-w-[48px] object-contain" onError={() => setTopLogoFailed(true)} />
                                ) : (
                                    <span className="font-heading font-black text-xl tracking-tight bg-gradient-to-r from-primary to-primary/80 bg-clip-text text-transparent">K</span>
                                )
                            )}
                        </div>

                        {/* ── Nav ── */}
                        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-4 px-3">
                            {sidebarOpen && (
                                <div className="mb-4 flex justify-center px-2">
                                    <img src={navLogoFailed ? logoFallbackSrc : navLogoSrc} alt="Kinnote" className="h-14 w-auto max-w-[200px] object-contain" onError={() => setNavLogoFailed(true)} />
                                </div>
                            )}

                            <div className="space-y-1">
                                {navItems.map((item) => {
                                    if (item.children) {
                                        const isParentActive =
                                            location.pathname.startsWith(item.path) ||
                                            (item.children.some((c) => {
                                                const childPath = c.path.split('?')[0];
                                                return location.pathname === childPath || location.pathname.startsWith(childPath + '/');
                                            }));
                                        const isExpanded = expandedItems[item.id] !== undefined ? expandedItems[item.id] : isParentActive;
                                        const activeChildrenCount = item.children.filter((child) => {
                                            const searchParams = new URLSearchParams(location.search);
                                            const childPath = child.path.split('?')[0];
                                            const childQuery = new URLSearchParams(child.path.split('?')[1] || '');
                                            if (location.pathname !== childPath) return false;
                                            const degree = childQuery.get('connection_degree');
                                            const hasContactInfo = childQuery.get('has_contact_info');
                                            if (degree) return searchParams.get('connection_degree') === degree;
                                            if (hasContactInfo) return searchParams.get('has_contact_info') === hasContactInfo;
                                            return true;
                                        }).length;

                                        return (
                                            <div key={item.id} className="w-full flex flex-col">
                                                <div
                                                    className={cn(
                                                        "w-full flex items-center justify-between rounded-2xl transition-all duration-200 group relative overflow-hidden",
                                                        sidebarOpen ? "px-3 py-2.5 gap-3" : "px-0 py-2.5 justify-center cursor-pointer",
                                                        isParentActive
                                                            ? "text-primary"
                                                            : "text-muted-foreground hover:text-foreground"
                                                    )}
                                                    onClick={() => {
                                                        navigate(item.path);
                                                        setExpandedItems(prev => ({ ...prev, [item.id]: true }));
                                                    }}
                                                >
                                                    <span
                                                        className={cn(
                                                            "absolute inset-0 transition-opacity duration-200",
                                                            isParentActive
                                                                ? "bg-gradient-to-r from-primary/18 via-primary/8 to-transparent opacity-100"
                                                                : "bg-accent/60 opacity-0 group-hover:opacity-100"
                                                        )}
                                                    />
                                                    {isParentActive && (
                                                        <>
                                                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 rounded-r-full bg-primary pointer-events-none" />
                                                            <span className="absolute left-[6px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary/90 pointer-events-none shadow-[0_0_10px_hsl(var(--primary)/0.7)]" />
                                                        </>
                                                    )}
                                                    <div className="relative flex items-center gap-3 flex-1 flex-shrink-0 cursor-pointer">
                                                        <div className={cn(
                                                            "flex items-center justify-center w-7 h-7 rounded-xl transition-all border",
                                                            isParentActive
                                                                ? "bg-primary/20 border-primary/30 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
                                                                : "border-border/40 bg-card/50 group-hover:bg-accent/80"
                                                        )}>
                                                            <item.icon className="w-4 h-4 min-w-[16px]" style={{ color: isParentActive ? item.color : undefined }} />
                                                        </div>
                                                        {sidebarOpen && (
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span className="font-semibold text-sm select-none truncate">{item.label}</span>
                                                                {isParentActive && activeChildrenCount > 0 && (
                                                                    <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/12 px-1.5 py-0.5 text-[10px] font-bold text-primary leading-none">
                                                                        {activeChildrenCount}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {sidebarOpen && (
                                                        <div
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setExpandedItems(prev => ({ ...prev, [item.id]: !isExpanded }));
                                                            }}
                                                            className="p-1 -mr-1 hover:bg-accent/50 rounded-md transition-colors cursor-pointer"
                                                        >
                                                            <ChevronDown className={cn("w-3.5 h-3.5 opacity-50 transition-transform duration-200 shrink-0", isExpanded && "rotate-180")} />
                                                        </div>
                                                    )}
                                                    {!sidebarOpen && (
                                                        <div className="absolute left-full ml-3 w-max px-2.5 py-1.5 bg-popover/95 backdrop-blur-xl text-popover-foreground text-xs font-medium rounded-lg shadow-xl border border-border/50 opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-50 -translate-x-1 group-hover:translate-x-0">
                                                            {item.label}
                                                        </div>
                                                    )}
                                                </div>

                                                {sidebarOpen && isExpanded && (
                                                    <div className="relative flex flex-col gap-0.5 ml-5 pl-3 mt-1 mb-1 animate-slide-up">
                                                        <span className="absolute left-0 top-1 bottom-1 w-px bg-gradient-to-b from-primary/35 via-border/70 to-transparent" />
                                                        {item.children.map((child) => {
                                                            const searchParams = new URLSearchParams(location.search);
                                                            const childPath = child.path.split('?')[0];
                                                            const childQuery = new URLSearchParams(child.path.split('?')[1] || '');
                                                            let isActive = false;
                                                            if (location.pathname === childPath) {
                                                                const degree = childQuery.get('connection_degree');
                                                                const hasContactInfo = childQuery.get('has_contact_info');
                                                                if (degree) isActive = searchParams.get('connection_degree') === degree;
                                                                else if (hasContactInfo) isActive = searchParams.get('has_contact_info') === hasContactInfo;
                                                                else isActive = true;
                                                            }
                                                            return (
                                                                <NavLink
                                                                    key={child.id}
                                                                    to={child.path}
                                                                    className={cn(
                                                                        "w-full flex items-center px-3 py-2 text-[13px] rounded-xl transition-colors duration-150 font-medium relative overflow-hidden",
                                                                        isActive
                                                                            ? "text-primary bg-primary/12"
                                                                            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                                                                    )}
                                                                >
                                                                    {child.label}
                                                                </NavLink>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    }

                                    // Standard item
                                    return (
                                        <NavLink
                                            key={item.id}
                                            to={item.path}
                                            end={item.path === '/'}
                                            className={({ isActive }) => cn(
                                                "w-full flex items-center rounded-2xl transition-all duration-200 group relative overflow-hidden",
                                                sidebarOpen ? "px-3 py-2.5 gap-3" : "px-0 py-2.5 justify-center",
                                                isActive
                                                    ? "text-primary"
                                                    : "text-muted-foreground hover:text-foreground"
                                            )}
                                        >
                                            {({ isActive }) => (
                                                <>
                                                    <span
                                                        className={cn(
                                                            "absolute inset-0 transition-opacity duration-200",
                                                            isActive
                                                                ? "bg-gradient-to-r from-primary/18 via-primary/8 to-transparent opacity-100"
                                                                : "bg-accent/60 opacity-0 group-hover:opacity-100"
                                                        )}
                                                    />
                                                    {isActive && (
                                                        <>
                                                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 rounded-r-full bg-primary" />
                                                            <span className="absolute left-[6px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary/90 shadow-[0_0_10px_hsl(var(--primary)/0.7)]" />
                                                        </>
                                                    )}
                                                    <div className={cn(
                                                        "relative flex items-center justify-center w-7 h-7 rounded-xl transition-all border",
                                                        isActive
                                                            ? "bg-primary/20 border-primary/30 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
                                                            : "border-border/40 bg-card/50 group-hover:bg-accent/80"
                                                    )}>
                                                        <item.icon className="w-4 h-4 min-w-[16px]" style={{ color: isActive ? item.color : undefined }} />
                                                    </div>
                                                    {sidebarOpen && <span className="relative font-semibold text-sm">{item.label}</span>}
                                                    {!sidebarOpen && (
                                                        <div className="absolute left-full ml-3 w-max px-2.5 py-1.5 bg-popover/95 backdrop-blur-xl text-popover-foreground text-xs font-medium rounded-lg shadow-xl border border-border/50 opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-50 -translate-x-1 group-hover:translate-x-0">
                                                            {item.label}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </NavLink>
                                    );
                                })}
                            </div>
                        </nav>
                        {/* ── User Footer ── */}
                        <div className={cn(
                            "border-t border-border/40 transition-all duration-300",
                            sidebarOpen ? "p-4" : "p-2 flex justify-center"
                        )}>
                            <div className={cn("flex items-center gap-3", !sidebarOpen && "justify-center")}>
                                {branding.profileImageUrl ? (
                                    <img src={branding.profileImageUrl} alt="" className="w-9 h-9 rounded-full object-cover ring-2 ring-border shrink-0" />
                                ) : (
                                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground font-bold text-xs shrink-0 ring-2 ring-primary/20 shadow-lg shadow-primary/20">
                                        {initials}
                                    </div>
                                )}
                                {sidebarOpen && (
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-sm truncate">{displayName}</p>
                                        <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">{branding.companyName || 'Scottish Chemicals'}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </aside>

                {/* ── Main Content ── */}
                <main className={cn(
                    "flex-1 flex flex-col min-h-screen min-w-0 transition-all duration-300 ease-out",
                    sidebarOpen ? "ml-[240px]" : "ml-[68px]"
                )}>
                    {/* ── Top Header ── */}
                    <header className="h-[64px] sticky top-0 z-20 px-4 sm:px-6 flex items-center justify-between gap-2 min-w-0 overflow-hidden shrink-0">
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                            {/* Sidebar toggle */}
                            <button
                                onClick={() => setSidebarOpen(!sidebarOpen)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150 shrink-0"
                                aria-label="Toggle sidebar"
                            >
                                <Menu className="w-4 h-4" />
                            </button>

                            {/* Breadcrumb */}
                            {currentPage && (
                                <div className="hidden sm:flex items-center gap-1.5 text-sm min-w-0">
                                    {currentPage.parent && (
                                        <>
                                            <span className="text-muted-foreground font-medium truncate">{currentPage.parent}</span>
                                            <span className="text-border shrink-0">/</span>
                                        </>
                                    )}
                                    <span className="font-semibold text-foreground truncate">{currentPage.label}</span>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                            <button
                                onClick={() => setIsDarkMode((prev) => !prev)}
                                className="w-9 h-9 rounded-lg border border-border/40 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150"
                                aria-label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                                title={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                            >
                                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                            </button>

                            {/* Notifications */}
                            <NotificationDropdown />

                            {/* User chip: truncate so it never overflows */}
                            <div className="hidden sm:flex items-center gap-2 pl-2 md:pl-3 border-l border-border/40 min-w-0 max-w-[180px] md:max-w-[220px]">
                                {branding.profileImageUrl ? (
                                    <img src={branding.profileImageUrl} alt="" className="w-8 h-8 rounded-full object-cover ring-2 ring-border shrink-0" />
                                ) : (
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground font-bold text-xs ring-2 ring-primary/20 shrink-0">
                                        {initials}
                                    </div>
                                )}
                                <div className="flex flex-col min-w-0 flex-1">
                                    <span className="text-sm font-semibold text-foreground leading-none truncate">{displayName}</span>
                                    <span className="text-[11px] text-muted-foreground mt-0.5 truncate" title="Better conversations, by design.">Better conversations, by design.</span>
                                </div>
                            </div>
                        </div>
                    </header>

                    {/* ── Page Content ── (min-h-0 so flex child can shrink; overflow-auto so content scrolls within viewport) */}
                    <div className="flex-1 min-h-0 min-w-0 overflow-auto p-4 sm:p-6 md:p-8 max-w-[1440px] mx-auto w-full flex flex-col">
                        <div className="page-enter flex flex-col flex-1 min-h-0">
                            <Outlet />
                        </div>
                    </div>
                </main>
            </div>
        </TimeFilterProvider>
    );
}

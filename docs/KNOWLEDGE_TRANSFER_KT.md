# Knowledge Transfer (KT) Document  
## LinkedIn Growth Engine – Automation & Lead Generation Platform

**Version:** 1.0  
**Audience:** Clients, developers, and technical stakeholders  
**Last updated:** March 2026

---

## 1. Project Overview

### 1.1 Brief Description

The **LinkedIn Growth Engine** is an AI-enhanced automation platform that automates LinkedIn outreach, lead generation, and network growth. It combines PhantomBuster-based LinkedIn automation with a Node.js/PostgreSQL backend, campaign management, lead scoring, and optional CRM integration.

### 1.2 Problem It Solves

- **Manual effort:** Reduces time spent on repetitive LinkedIn actions (connection requests, messages, search-based lead discovery).
- **Scale:** Enables targeted outreach and lead capture at scale while aiming to stay within platform limits.
- **Quality:** Uses lead quality tiers (Primary/Secondary/Tertiary) and connection-degree logic so the right actions (e.g. connection vs. message-only) are applied per lead.
- **Control:** Provides approval queues for AI-generated messages and campaign lifecycle management (draft, launch, pause, resume).

### 1.3 Technologies and Tools Used

| Layer | Technology |
|-------|------------|
| Backend | Node.js (Express), PostgreSQL |
| Frontend | React (Vite) |
| LinkedIn automation | PhantomBuster (Search Export, Auto Connect, Message Sender) |
| AI / messaging | Claude / OpenAI (optional) |
| Email (optional) | SendGrid / AWS SES |
| Tunneling (local dev) | ngrok or localtunnel (for PhantomBuster callbacks) |

---

## 2. System Architecture

### 2.1 High-Level Overview

- **Frontend** sends requests to the **Backend API** (campaigns, leads, phantom triggers, approvals).
- **Backend** stores leads and campaign data in **PostgreSQL**, and triggers **PhantomBuster** agents via its API.
- **PhantomBuster** runs browser automation on LinkedIn (search export, connection requests, messages). For message sending, PhantomBuster fetches a CSV from a **public backend URL** (spreadsheet URL) that contains per-lead LinkedIn URL and message.
- **Webhooks** (when configured) can notify the backend when a phantom container finishes, so campaign state can advance (e.g. from “waiting_phantom” to next step).

### 2.2 End-to-End Workflow

1. **Lead acquisition:** Leads are added via Search Export (PhantomBuster), CSV/Excel import, or CRM-triggered search.
2. **Storage:** Leads are normalized and stored in the `leads` table; duplicates are handled by `linkedin_url`.
3. **Campaign setup:** User creates a campaign, adds leads to it (`campaign_leads`), and may configure sequences (connection → message → email).
4. **Approval (optional):** AI-generated messages are stored in `approval_queue`; user approves before sending.
5. **Execution:** User launches the campaign. Backend:
   - For 2nd/3rd degree (or unknown) leads: triggers **Auto Connect** phantom (connection requests; optional note from approval queue or dashboard).
   - For 1st degree (or after connection): triggers **Message Sender** phantom with a CSV URL pointing to the backend; PhantomBuster fetches CSV and sends messages.
   - Optionally sends **email** via SendGrid/SES when configured.
6. **Tracking:** Lead and campaign-lead statuses are updated; import and automation events can be logged (e.g. `import_logs`, container IDs on `campaign_leads`).

### 2.3 Main Components

| Component | Role |
|-----------|------|
| **Backend API** | REST API for leads, campaigns, phantom launch, approvals, CRM search, webhooks. |
| **PhantomBuster service** | Calls PhantomBuster API to launch agents, poll container status, and fetch result files (e.g. S3 CSV/JSON). |
| **Lead service** | Normalization, deduplication by `linkedin_url`, persistence; used by import and campaign logic. |
| **Campaign service** | Campaign and sequence logic; which leads get Auto Connect vs. message-only. |
| **Approval service** | Manages approval queue (pending/approved) for AI-generated messages. |
| **Scheduler service** | Optional scheduled execution of campaign steps. |
| **Database** | PostgreSQL: `leads`, `campaigns`, `campaign_leads`, `approval_queue`, `import_logs`, etc. |

---

## 3. Tools & Platforms Used

| Tool / Platform | Role |
|-----------------|------|
| **PhantomBuster** | Runs LinkedIn automation agents: Search Export (lead extraction from LinkedIn search), Auto Connect (connection requests), Message Sender (InMail/follow-up messages). Requires API key and per-agent LinkedIn connection (OAuth) in dashboard. |
| **LinkedIn** | Target platform; no direct API for automation—all actions go through PhantomBuster. |
| **PostgreSQL** | Primary data store for leads, campaigns, campaign_leads, approval_queue, import_logs. |
| **Node.js / Express** | Backend server and API. |
| **React frontend** | Dashboard, campaign UI, lead list, approval queue, Lead Search (trigger Search Export / CRM search). |
| **OpenAI / Claude** | Optional AI for generating personalized connection and message content; used before messages enter approval queue. |
| **SendGrid / AWS SES** | Optional email delivery for outreach sequences. |
| **CRM (external)** | Optional. Backend can pull search criteria from CRM and push imported leads to CRM via configurable API (see CRM Search Run). |
| **ngrok / localtunnel** | Exposes local backend via a public URL so PhantomBuster can fetch the message CSV when sending LinkedIn messages. |

---

## 4. Authentication & Access Setup

### 4.1 Required Credentials

- **PhantomBuster API key:** From PhantomBuster dashboard (Settings or API section). Stored in `.env` as `PHANTOMBUSTER_API_KEY`.
- **LinkedIn (per phantom):** Each PhantomBuster agent (Search Export, Auto Connect, Message Sender) must have **LinkedIn connected via OAuth** in the PhantomBuster dashboard. Session cookie from browser is **not** sufficient for message/connection phantoms when running from PhantomBuster cloud (IP mismatch). Prefer OAuth connection in dashboard.
- **Database:** PostgreSQL credentials in `.env`: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
- **Backend public URL:** For message sending, PhantomBuster must reach the backend to download the CSV. Set `BACKEND_PUBLIC_URL` in `.env` (production URL or ngrok/localtunnel URL in development).
- **Optional:** OpenAI/Claude API key for AI message generation; CRM API key/base URL for CRM integration; SendGrid/SES for email.

### 4.2 LinkedIn Session / Cookie (Legacy or Fallback)

- **Search Export** can use configuration stored entirely in the PhantomBuster dashboard (search URL, number of results). No cookie needs to be sent from the app; LinkedIn must still be connected in the dashboard for the Search Export agent.
- For **Auto Connect** and **Message Sender**, the recommended approach is **OAuth connection in PhantomBuster**. If documentation or scripts refer to `LINKEDIN_SESSION_COOKIE`:
  - **Do not** rely on a cookie copied from browser into `.env` for phantoms that run on PhantomBuster’s servers (can cause “cookie invalid” or “cookie missing”).
  - **Do** complete “Connect to LinkedIn” (OAuth) in the PhantomBuster agent page and save.

### 4.3 PhantomBuster Dashboard – Connect LinkedIn (OAuth)

1. Log in at [phantombuster.com](https://phantombuster.com).
2. Open the relevant phantom (Search Export, Auto Connect, or Message Sender).
3. Find “Connect to LinkedIn” / “LinkedIn Account” / “Authentication.”
4. Click **Connect** (or “Add LinkedIn Account” / “Authorize”).
5. Complete LinkedIn login and authorize PhantomBuster.
6. Confirm “Connected” (e.g. green check) and click **Save** on the phantom.
7. Restart the backend after connecting so it can use the updated agent state if needed.

### 4.4 Security Considerations

- Keep `.env` out of version control; use `.env.example` as a template only (no secrets).
- Restrict PhantomBuster API key and CRM/email keys to need-to-know; rotate if compromised.
- Use HTTPS for `BACKEND_PUBLIC_URL` so the message CSV is served over a secure tunnel.
- If the app becomes multi-tenant, add authentication/authorization on API routes and scope campaigns/leads by user/org.

---

## 5. Data Flow & Pipeline

### 5.1 How Leads Are Collected

- **Search Export (PhantomBuster):** User runs “Run Search Export” (or CRM-triggered search). Backend launches the Search Export phantom with **no** launch arguments; the phantom uses the search URL and limit from its PhantomBuster dashboard. When the container finishes, the backend fetches the result CSV/JSON from PhantomBuster storage, parses rows, normalizes fields (e.g. profile URL, connection degree), and saves to `leads` with `source = 'search_export'`.
- **CSV / Excel import:** User uploads a file. Backend parses rows; each row with a valid `linkedin_url` (or accepted alias) is inserted or updated in `leads`; `source` is set to `csv_import` or `excel_import`. Rows without a valid LinkedIn URL are rejected and reported in the response.
- **CRM Search Run:** If CRM is configured, the backend can get search criteria from the CRM API, build the same LinkedIn search URL, run the Search Export phantom, save leads to the database, and optionally push them to the CRM via its import API.

### 5.2 Where Leads Are Stored

- **Table:** `leads` (PostgreSQL). Key columns: `id`, `linkedin_url` (unique), `first_name`, `last_name`, `full_name`, `title`, `company`, `location`, `connection_degree`, `status`, `source`, `email`, `phone`, `created_at`, `updated_at`.
- **Deduplication:** On insert/import, if `linkedin_url` already exists, the row is updated (e.g. ON CONFLICT DO UPDATE); otherwise inserted. All lead sources write into this same table.

### 5.3 How Data Moves Through the System

- **Campaign assignment:** Leads are linked to campaigns via `campaign_leads` (campaign_id, lead_id, status, current_step, etc.). Only leads with a valid `linkedin_url` are used for automation.
- **Connection degree:** Campaign logic uses `connection_degree`:
  - **1st** → message-only path (Message Sender phantom).
  - **2nd / 3rd or missing** → Auto Connect (connection request) first; then optionally Message Sender after connection.
- **Approval queue:** AI-generated messages are stored in `approval_queue` (campaign_id, lead_id, message content, status). When status is `approved`, those messages can be used for connection notes or for the Message Sender CSV.
- **Message CSV:** When sending messages, the backend creates a one-time URL: `{BACKEND_PUBLIC_URL}/api/phantom/message-csv/{token}`. The token maps to a CSV with columns `LinkedInUrl` and `Message`. PhantomBuster’s Message Sender is launched with this URL; it fetches the CSV and sends the message to each profile. Token is short-lived (e.g. 10 minutes) and single-use.

### 5.4 How Responses Are Tracked

- **Campaign lead status:** `campaign_leads.status` can reflect pending, sent, replied, failed; `last_activity_at` and optional `last_container_id` track last phantom run.
- **Lead status:** `leads.status` can be updated when leads are contacted or when replies are detected (e.g. via reply-detection or manual update).
- **Import history:** `import_logs` records import runs (source, timestamp, counts) for auditing.
- **Webhooks:** If PhantomBuster is configured to send webhooks on container end, the backend can update campaign state (e.g. from `waiting_phantom` to next step or completed).

---

## 6. Automation Workflows

### 6.1 Connection Sending (Auto Connect)

| Item | Description |
|------|-------------|
| **Purpose** | Send LinkedIn connection requests to selected leads (typically 2nd/3rd degree or unknown). Optionally attach a note from approved AI messages or from PhantomBuster dashboard. |
| **Inputs** | Campaign ID; optional list of lead IDs (default: all pending campaign leads with valid `linkedin_url`). |
| **Steps** | 1) Resolve campaign and leads; filter by `connection_degree` if only non–1st should get connection requests. 2) Check `approval_queue` for approved messages for those leads. 3) Build payload: profile URLs and, where available, per-lead message. 4) Call PhantomBuster API to launch Auto Connect phantom with this payload (or URLs only if no messages). 5) Store container ID on campaign/leads if needed; update status when webhook or polling indicates completion. |
| **Output** | API response with success, container ID, and counts (e.g. total sent, with/without message). Campaign leads may be marked as “sent” or similar after confirmation. |
| **Dependencies** | PhantomBuster API key; Auto Connect phantom ID (`AUTO_CONNECT_PHANTOM_ID`); LinkedIn connected (OAuth) for that phantom in PhantomBuster dashboard. |

### 6.2 Lead Extraction (Search Export)

| Item | Description |
|------|-------------|
| **Purpose** | Extract leads from a LinkedIn people search and save them into the application database. |
| **Inputs** | Search URL and result limit configured in PhantomBuster dashboard (for “Run Search Export” with no args). For CRM Search Run: criteria from request body or from CRM API, plus optional limit. |
| **Steps** | 1) Build or use LinkedIn search URL (app or CRM criteria). 2) Launch Search Export phantom with **no** launch arguments so it uses dashboard config. 3) Poll container until finished. 4) Fetch result file (CSV/JSON) from PhantomBuster storage. 5) Parse and normalize (e.g. profile URL, name, headline, company, connection degree). 6) For each row, insert or update `leads` by `linkedin_url`; set `source = 'search_export'`. 7) Optionally write CSV export and log to `import_logs`. |
| **Output** | Count of leads saved, duplicates skipped, and optional CSV path. For CRM Search Run, may also return “pushedToCrm” count. |
| **Dependencies** | PhantomBuster API key; Search Export phantom ID (`SEARCH_EXPORT_PHANTOM_ID`); LinkedIn connected for that phantom; search URL and limit set in PhantomBuster dashboard. |

### 6.3 Messaging (LinkedIn Message Sender)

| Item | Description |
|------|-------------|
| **Purpose** | Send personalized LinkedIn messages to leads (typically 1st degree or after connection). |
| **Inputs** | Campaign and lead(s); message content from approval queue or fallback. |
| **Steps** | 1) For each lead, get approved message from `approval_queue` or use default. 2) Create a short-lived token and store mapping: token → (LinkedIn URL, message). 3) Build spreadsheet URL: `{BACKEND_PUBLIC_URL}/api/phantom/message-csv/{token}`. 4) Launch Message Sender phantom with arguments: `spreadsheetUrl`, `message` (fallback), `messageColumnName`, `profilesPerLaunch`. 5) PhantomBuster fetches CSV from backend and sends the message. 6) On completion (webhook or poll), update campaign_lead status and clear token. |
| **Output** | Success/failure and container ID. Lead status updated after send. |
| **Dependencies** | PhantomBuster API key; Message Sender phantom ID (`PHANTOM_MESSAGE_SENDER_ID`); `BACKEND_PUBLIC_URL` reachable by PhantomBuster (HTTPS); LinkedIn connected (OAuth) for Message Sender phantom. |

### 6.4 Email Extraction / Enrichment

| Item | Description |
|------|-------------|
| **Purpose** | Enrich leads with email (and optionally phone) for use in email outreach or CRM. |
| **Inputs** | Lead records (e.g. from DB) with at least LinkedIn URL or company/name. |
| **Steps** | Enrichment service (and/or Hunter.io integration) looks up email by domain, name, or other signals. Results are written back to `leads.email` (and optionally phone). Email sending itself uses the email service (SendGrid/SES) when a campaign step type is “email.” |
| **Output** | Updated lead records with `email` (and optionally `phone`) populated. |
| **Dependencies** | Enrichment/Hunter API keys if used; email service configured for actual sending. |

### 6.5 CRM Synchronization

| Item | Description |
|------|-------------|
| **Purpose** | Run a LinkedIn search from CRM criteria and optionally push imported leads back to the CRM. |
| **Inputs** | Optional request body with `criteria` (e.g. title, jobTitle, industry, location, company, keywords) and `limit`. If omitted and CRM is configured, backend fetches criteria from CRM (`GET` to `CRM_BASE_URL` + `CRM_SEARCH_CRITERIA_PATH`). |
| **Steps** | 1) Resolve criteria (body or CRM API). 2) Build LinkedIn search URL from criteria. 3) Launch Search Export phantom (dashboard config or passed params as per implementation). 4) Parse results and save to `leads` with `source = 'search_export'`. 5) If CRM import path is configured, POST leads to CRM (`CRM_LEADS_IMPORT_PATH`) in the expected format. |
| **Output** | Response with criteria used, LinkedIn URL, totalLeads, savedToDatabase, duplicates, pushedToCrm, and optional CSV path. |
| **Dependencies** | PhantomBuster and Search Export phantom; CRM env vars: `CRM_BASE_URL`, `CRM_API_KEY` (or `CRM_API_TOKEN`), optional `CRM_AUTH_HEADER`, `CRM_SEARCH_CRITERIA_PATH`, `CRM_LEADS_IMPORT_PATH`. |

---

## 7. Configuration Instructions

### 7.1 Prerequisites

- Node.js v18+
- PostgreSQL v14+
- PhantomBuster account
- (Optional) ngrok or localtunnel for local backend URL; production server for deployed backend

### 7.2 Step-by-Step Setup

1. **Clone and install**
   - Clone the repository; from `backend` run: `npm install`.

2. **Database**
   - Create a PostgreSQL database (e.g. `linkedin_leads`).
   - Run all migrations in `backend/database/migrations/` in order (or use the project’s migration runner). Ensure base schema (e.g. `database/schema.sql`) and migrations for `leads`, `campaigns`, `campaign_leads`, `approval_queue`, `import_logs`, etc. are applied.

3. **Environment (.env)**
   - Copy `.env.example` to `.env` in `backend/`.
   - Set:
     - `PORT`, `NODE_ENV`
     - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
     - `PHANTOMBUSTER_API_KEY`
     - `SEARCH_EXPORT_PHANTOM_ID`, `AUTO_CONNECT_PHANTOM_ID`, `PHANTOM_MESSAGE_SENDER_ID`
     - `BACKEND_PUBLIC_URL` (production URL or ngrok/localtunnel URL for message sending)
   - Optional: `LINKEDIN_SESSION_COOKIE` (only if required by a specific phantom and not using OAuth); OpenAI/Claude keys; CRM and email provider variables.

4. **PhantomBuster**
   - For each phantom (Search Export, Auto Connect, Message Sender): open the agent in PhantomBuster, click “Connect to LinkedIn,” complete OAuth, then Save.
   - In Search Export phantom, set the LinkedIn search URL and number of results in the dashboard (used when the app sends no arguments).

5. **Public URL (message sending)**
   - Production: set `BACKEND_PUBLIC_URL` to your API base (e.g. `https://api.yourdomain.com`).
   - Local: run `ngrok http <PORT>` (or localtunnel), put the HTTPS URL in `BACKEND_PUBLIC_URL`, and keep the tunnel running while testing message send.

6. **Start backend**
   - From `backend`: `npm run dev`. Confirm DB connection and migrations.

7. **Frontend**
   - From frontend directory: install dependencies and run dev server; set API base URL to the backend (e.g. `http://localhost:3000` or your backend URL).

8. **Smoke tests**
   - `GET /api/leads/stats` – should return lead counts.
   - Run a small Search Export (or CRM Search Run with criteria), then check `leads` and `import_logs`.
   - Create a campaign, add leads, run Auto Connect and/or Message Sender and verify in PhantomBuster and LinkedIn.

---

## 8. Error Handling & Common Issues

| Problem | Likely Cause | Resolution |
|--------|----------------|-------------|
| **cookie-missing / Cookie missing** | LinkedIn not connected for the phantom, or phantom expects OAuth but only cookie was provided. | Connect LinkedIn via OAuth in PhantomBuster for that phantom; Save. Do not rely on copying browser cookie into `.env` for cloud-run phantoms. |
| **argument-invalid** (Search Export) | Launch arguments were sent to Search Export phantom. | Ensure Search Export is launched with **no** arguments (minimalArgsForSearch); phantom uses dashboard config only. |
| **argument-invalid** (Message Sender) | Wrong or invalid args (e.g. bad spreadsheetUrl). | Verify `BACKEND_PUBLIC_URL` is set and the message-csv URL is reachable by PhantomBuster; check CSV format (LinkedInUrl, Message). |
| **CSV expired or not found** | Token expired (e.g. 10 min) or PhantomBuster could not reach backend. | Ensure backend is up and `BACKEND_PUBLIC_URL` is correct; if using ngrok, keep it running and update `.env` if URL changed. |
| **relation "automation_logs" does not exist** (or similar) | Migrations not run or wrong path. | Run all migrations from `backend/database/migrations/`; fix migration runner path if it points to the wrong directory. |
| **Network cookie invalid** | Cookie was created on one IP (e.g. local) but phantom runs on PhantomBuster’s servers. | Use OAuth connection in PhantomBuster dashboard instead of sending cookie from `.env`. |
| **No leads returned from Search Export** | Search URL or limit not set in PhantomBuster. | Configure the Search Export phantom’s search URL and number of results in its dashboard. |
| **CRM search returns 502 / criteria failed** | CRM not reachable or auth wrong. | Check `CRM_BASE_URL`, `CRM_API_KEY`/token, and `CRM_SEARCH_CRITERIA_PATH`; verify CRM returns the expected criteria object. |

---

## 9. Maintenance Guidelines

### 9.1 Monitoring Automations

- **PhantomBuster dashboard:** Check container runs, exit codes, and logs for each phantom.
- **Backend logs:** Watch for launch requests, container IDs, and errors (e.g. “cookie-missing”, “argument-invalid”).
- **Database:** Query `import_logs` for import history; check `campaign_leads` and `leads.status` for campaign progress.

### 9.2 Updating Cookies / LinkedIn Connection

- Prefer **OAuth in PhantomBuster**; when LinkedIn session expires, open the phantom and reconnect LinkedIn, then Save.
- If any flow still uses `LINKEDIN_SESSION_COOKIE`, update it only for phantoms that run with that cookie (e.g. local runs); for cloud phantoms, rely on dashboard OAuth.

### 9.3 Updating Workflows

- **Phantom IDs:** If you create new phantoms or duplicate agents, update `.env` (`SEARCH_EXPORT_PHANTOM_ID`, `AUTO_CONNECT_PHANTOM_ID`, `PHANTOM_MESSAGE_SENDER_ID`).
- **Arguments:** After changing phantom arguments in code, confirm PhantomBuster agent still accepts them (especially Search Export: it must receive no arguments when using dashboard config).
- **Backend URL:** If `BACKEND_PUBLIC_URL` changes (e.g. new ngrok URL), update `.env` and restart backend.

### 9.4 Data Cleanup

- Periodically archive or delete old leads/campaigns if policy requires it.
- Clear or trim `import_logs` and automation logs if they grow large.
- Ensure any CRM sync or export still matches current schema and API contracts.

---

## 10. Future Improvements

- **Scalability:** Queue campaign execution (e.g. `campaign_jobs`) so only one campaign runs per user at a time; add rate limits per campaign/user (max connections/messages/emails per day).
- **Reliability:** Full webhook integration for all phantoms so campaign state advances automatically on container end; retries with backoff for PhantomBuster and CRM calls.
- **Security:** API authentication and authorization; scope campaigns and leads by tenant/user; secrets in a vault instead of `.env` where possible.
- **UX:** Unified inbox for LinkedIn and email replies; clearer approval flow (e.g. “Send approved messages” button or scheduled send after approval).
- **Data quality:** Stricter validation and normalization of `connection_degree` on import; default or warning when `connection_degree` is missing so campaign routing is predictable.
- **Observability:** Structured logging, metrics (e.g. sends per day, failure rates), and optional alerting on phantom failures or quota issues.

---

*End of Knowledge Transfer Document*

# LinkedIn Growth Engine — User Guide

This guide explains how to use the **LinkedIn Growth Engine** platform from the dashboard. It is written for everyday users such as founders, sales teams, and marketing teams. No technical background is required.

---

## 1. Introduction

### What is LinkedIn Growth Engine?

**LinkedIn Growth Engine** helps you grow your LinkedIn network and generate leads without spending hours on manual outreach. The platform:

- **Finds leads** — Imports people from your LinkedIn connections or from LinkedIn search (e.g. by job title, industry, location).
- **Manages contacts** — Keeps all your leads in one place so you can view, filter, and organize them.
- **Runs campaigns** — Sends connection requests and messages to your leads on your behalf, in a controlled way.
- **Uses AI** — Suggests personalized messages you can review and approve before anything is sent.

### How does it help you?

- **Save time** — Automate connection requests and follow-up messages.
- **Stay in control** — Review and edit every message before it is sent.
- **Scale outreach** — Reach more people while the platform handles the repetitive steps.
- **Track progress** — See how many connections and messages were sent and how your campaigns are doing.

---

## 2. Dashboard Overview

When you log in, you see the main dashboard and a **sidebar menu** on the left. Here are the main sections:

### Dashboard (Home)

- **Where:** Click **Dashboard** (or the home icon) in the sidebar.
- **What:** Overview of your network and activity — total leads, industry breakdown, recent growth, and campaign performance. Use the time filter (Daily, Weekly, Monthly, Yearly) to change the period.

### Lead Search

- **Where:** **Lead Search** in the sidebar.
- **What:** Add new leads into the system. You can:
  - Run the engine to import from LinkedIn (your connections or a saved search).
  - Upload a CSV or Excel file with your own list of contacts.

### CRM (Contacts & Leads)

- **Where:** **CRM** in the sidebar. It has sub-items: **My Contacts**, **Prospects**, and **Leads**.
- **What:**
  - **My Contacts** — Your contact list (e.g. 1st-degree connections).
  - **Prospects** — Prospects you are tracking.
  - **Leads** — All leads in one list with filters and tabs (All, Approved, To Review, Rejected, Imported). This is where you manage and organize leads.

### Campaigns

- **Where:** **Campaigns** in the sidebar. Sub-items: **LinkedIn** and **Email**.
- **What:**
  - **LinkedIn** — Create and run LinkedIn outreach campaigns (connection requests and messages).
  - **Email** — Manage email campaigns and send approved email drafts to leads who have an email address.

### Approval Queue

- **Where:** Inside each **campaign**. Open a campaign and click the **Approvals** tab.
- **What:** AI-generated LinkedIn messages (and optionally Gmail drafts) appear here. You approve, edit, or reject them before anything is sent. Nothing goes out until you approve and then **Launch** the campaign.

### Automation

- **Where:** Inside each **campaign**. The **Launch** button (green “Launch” or “Launch again”) runs the automation.
- **What:** When you click **Launch**, the platform sends connection requests to leads who are not yet connected, then sends approved messages to the right leads. Limits (e.g. per day or per week) apply so you don’t over-send.

### CRM Search (if enabled)

- **Where:** If your organization has connected a CRM, leads may be added automatically when a search is run from your CRM, or your admin may run a “CRM search” that pulls criteria from the CRM and imports leads into the platform. Ask your administrator how this is set up for you.

### Settings

- **Where:** **Settings** in the sidebar (gear icon).
- **What:** Configure branding, which AI writes your messages, lead prioritization (preferences), safety limits, and (for admins) integration credentials. See **Section 9** for a short explanation of how preferences work.

---

## 3. Importing Leads

You can add leads in three ways: **LinkedIn Search Export** (Run Engine), **CSV/Excel upload**, and (if enabled) **CRM search integration**.

---

### Option A: LinkedIn Search Export (Run Engine)

This uses your LinkedIn data: either your **1st-degree connections** or a **saved LinkedIn search** (e.g. “CEOs in Technology”).

**Steps:**

1. Go to **Lead Search** in the sidebar.
2. Under **Select Data Source**, choose one:
   - **Import My Connections** — Imports your 1st-degree LinkedIn connections.
   - **Explore Beyond My Network** — Imports leads from a LinkedIn people search (the search URL and number of results are set by your administrator in the external tool).
3. Click the **Run Engine** button.
4. Wait while the platform runs (this can take a few minutes). You will see a “Syncing Data...” state.
5. When it finishes, you will see how many leads were found, how many were saved, and how many were duplicates. Click **View Leads** to open the Leads list.

**Note:** For “Explore Beyond My Network,” the exact search (keywords, filters, limit) is configured in the external automation tool by your admin. You only choose the data source and run the engine.

---

### Option B: CSV or Excel Upload

Use this when you already have a list of contacts in a spreadsheet.

**Steps:**

1. Go to **Lead Search** in the sidebar.
2. Scroll to **Import Contacts**.
3. (Recommended) Download a template so your file has the right columns:
   - Click **Download template** and choose **CSV template** or **Excel template**.
   - Fill in the template with your contacts (at minimum, include each person’s **LinkedIn profile URL**).
4. Click **Import Contacts** (or **IMPORT CONTACTS**).
5. Choose **From CSV File** or **From Excel File** and select your file.
6. Wait for the import to finish. You will see a summary: how many were imported, how many were duplicates, and if any rows had errors (e.g. missing LinkedIn URL).
7. If the import succeeded, use **View imported leads** to open the Leads list.

**Tips:**

- The **LinkedIn profile URL** (or equivalent column) is required for each row. Rows without it are skipped and shown in the error summary.
- Including **Connection Degree** (1st, 2nd, 3rd) helps the platform decide whether to send a connection request or only a message.

---

### Option C: CRM Search Integration

If your company has connected a CRM:

- Leads may be added automatically when someone runs a search from the CRM, or
- Your admin may run a “CRM search” that uses criteria from the CRM and imports results into the platform.

Ask your administrator how this is set up and whether you need to do anything (e.g. run a report in the CRM or click a button in the platform).

---

## 4. Managing Leads

### Viewing leads

1. Go to **CRM** in the sidebar, then click **Leads** (or use **View Leads** after an import).
2. You will see a table with columns such as name, title, company, location, status, and source.
3. Use the **search** box to find leads by name, company, or title.
4. Use **pagination** at the bottom to move through pages if you have many leads.

### Filtering leads

- Use the **filters** (e.g. status, source, connection degree, industry, date range) to narrow the list.
- **Quick filters** (if shown) let you jump to presets like “Via Import only,” “CEOs in SaaS,” “CTOs in Tech,” etc.
- You can combine search and filters to find the right subset of leads.

### Organizing leads

- **Status** — Leads can have statuses such as New, Contacted, Replied. Use filters to see leads by status.
- **Review tabs** — On the Leads page you may see tabs like **All**, **Approved**, **To Review**, **Rejected**, **Imported**. Use these to see leads by review state.
- **Campaigns** — Add leads to a campaign from the Leads list or from inside a campaign (see “Creating a Campaign” below).

### Checking lead information

- Click a lead’s row (or name) to open the **lead detail** page.
- There you can see full profile information, notes, which campaigns they are in, and options to add them to a campaign or to the approval queue.

---

## 5. Creating a Campaign

A campaign is a set of leads and a sequence of actions: connection requests and/or messages. Follow these steps to create and configure a campaign.

### Step 1: Create a new campaign

1. Go to **Campaigns** → **LinkedIn** in the sidebar.
2. Click **Create campaign** (or similar button to add a new campaign).
3. Enter a **name** and any **description** or **goal** (e.g. “Q1 CEO Outreach”). Save or continue.

### Step 2: Add leads to the campaign

1. Open the campaign you just created (click it in the list).
2. Go to the **Leads** tab inside the campaign.
3. Add leads in one of these ways:
   - **Add from your Leads list** — Use “Add to Campaign” (or similar) from the main Leads page and choose this campaign, or
   - **Add from within the campaign** — Use the **Add Leads** button in the Leads tab and select leads from your database.
4. You can select multiple leads with checkboxes. You can also remove leads from the campaign using **Remove from campaign** when they are selected.

### Step 3: Generate messages (LinkedIn AI)

1. Stay on the **Leads** tab of the campaign.
2. Optionally select specific leads with the checkboxes, or leave all leads selected.
3. Click **LinkedIn AI (Messages + Emails)** (or **LinkedIn AI** with a number if you have selected leads). This generates personalized connection and message suggestions (and optionally email drafts for leads with email).
4. Wait for the progress bar to finish. Generated messages will appear in the **Approvals** tab.

### Step 4: Configure outreach (if needed)

- The campaign uses an **Automation Sequence** that defines the order of steps (e.g. connection request, then message). Your admin may have set this; if you have options to add or reorder steps, configure them as needed.
- The **Launch** button will send connection requests and messages according to this sequence and the approval queue.

You are now ready to approve messages and launch (see sections 6 and 7).

---

## 6. Message Approval

Before any connection request or message is sent, it appears in the **Approvals** tab. You decide what actually goes out.

### Where to find approvals

1. Open your **campaign** (Campaigns → LinkedIn → click the campaign).
2. Click the **Approvals** tab.
3. You may see sub-tabs such as **LinkedIn** (connection/message text) and **Gmail** (email drafts). Switch between them as needed.

### What you see

- Each row is one lead and the AI-generated **message** (or email subject/body) for them.
- You can read the message, **edit** it, **approve** it, or **reject** it.
- You can use **Regenerate** (if available) to get a new suggestion with different tone, length, or focus.

### How to approve or edit

1. **Select messages** — Use the checkboxes next to each message. You can **Select All** for the current list.
2. **Edit a single message** — Click **Edit** (or the message text), change the text, and save.
3. **Approve** — Select the messages you want to send, then click **Approve** (or “Approve selected”). Approved messages will be sent when you **Launch** the campaign.
4. **Reject** — Select messages you do not want to send and click **Reject**. They will not be sent.

### Important

- **Nothing is sent until you Launch.** Approving only marks messages as “ready to send.” The actual sending happens when you click **Launch** in the campaign (see “Running Automations” below).
- Review each message for tone, accuracy, and personalization. The AI is there to help; you have the final say.

---

## 7. Running Automations

Once leads are in the campaign and messages are approved, you **Launch** the campaign to send connection requests and messages.

### What “Launch” does

- **Connection requests** — For leads who are not yet 1st-degree connections, the platform sends a LinkedIn connection request (with an optional note if you approved one).
- **LinkedIn messages** — For leads who are already connected (or after they accept), the platform sends the approved message.
- The system runs in a sequence (e.g. connections first, then messages) and respects daily/weekly limits so you don’t exceed a safe volume.

### How to launch

1. Open your **campaign** (Campaigns → LinkedIn → click the campaign).
2. Make sure you have:
   - **Leads** added in the Leads tab.
   - **Messages** approved in the Approvals tab (for the leads you want to contact).
3. Click the green **Launch** button (or **Launch again** if the campaign has been run before).
4. If a limit has been reached (e.g. “Limit reached (2/day or 8/week)”), the button will be disabled and you’ll need to wait until the next day or week, or ask your admin about limits.
5. While it runs, the button may show “Launching...” and the campaign status may change. Wait until it finishes.

### After launching

- **Connection requests** — They are sent by the platform in the background. You can check your LinkedIn “Sent” invitations to see them.
- **Messages** — Approved messages are sent to the right leads according to the campaign sequence.
- **Campaign status** — The campaign may move to “Active,” then “Completed” or “Paused” when the run is done. You can **Launch again** later to run another batch (within your limits).
- **Lead status** — In the Leads list or campaign Leads tab, lead statuses may update (e.g. “Contacted,” “Replied”) as the system tracks activity.

---

## 8. Monitoring Campaign Progress

### Where to look

- **Campaign card** — On the Campaigns list, each campaign shows status (Draft, Active, Paused, Completed), lead count, and sometimes response rate or last activity.
- **Inside the campaign** — Open the campaign to see:
  - **Leads tab** — Number of leads, their status, and (if shown) step or next action.
  - **Approvals tab** — How many messages are pending vs approved.
  - **Outcomes or Analytics** (if available) — Sent counts, replies, or other metrics.

### What you can track

- **Connection requests sent** — Reflected in campaign/lead status and in your LinkedIn “Sent” invitations.
- **Messages sent** — Reflected in lead status and in the campaign’s sent/message counts.
- **Replies** — If the system tracks replies, lead status may change to “Replied” or similar; check the campaign or Leads list for filters like “Replied.”
- **Limits** — If you see “Limit reached,” you’ve hit the daily or weekly launch limit; wait until it resets or contact your admin.

---

## 9. Settings & How Preferences Work

You can open **Settings** from the sidebar (gear icon) to personalize the app and control how leads are prioritized.

### What’s in Settings (short)

- **Branding & Welcome** — Your display name, company name, optional profile image URL, and theme color (default, blue, green, violet). Click **Save branding** to apply. This affects the welcome area and sidebar.
- **AI Model** — Choose which AI writes your messages: **OpenAI** (e.g. GPT-4o) or **Claude** (e.g. Claude Sonnet). You can also pick a specific model for each. The one you don’t select is used as a fallback if the main one fails. Changes apply to new message generation.
- **Integration Credentials** — API key and LinkedIn session (usually managed by your administrator). Most users don’t need to change these.
- **Webhook Integration** — A URL for the external data source (for admins). Used so the platform can update lead status in real time.
- **Account Safety** — **Max connection requests per day** (e.g. 20–30). Keeps your LinkedIn account within safe limits. Save configuration to apply.
- **System Health** — Shows whether the backend, database, and data source API are connected.
- **Danger Zone** — **Delete all leads** (permanent). Use only if you need to wipe all lead data; requires typing “DELETE ALL” to confirm.

### How preferences work (lead prioritization)

**LinkedIn Preferences** in Settings control how leads are grouped into **Primary** (high value), **Secondary** (potential), and **Tertiary** (lower priority). These tiers appear on the dashboard and in filters.

- **Toggle: Active vs Paused**
  - **Active** — Your **manual** Primary, Secondary, and Tertiary rules apply. You define which job titles, industries, and company sizes belong to each tier.
  - **Paused** — The platform tiers leads automatically based on **your profile** (your title and industry). Your manual tier lists are not used.

- **Your profile** — Enter your **Name**, **Title**, and **Industry**. Click **Analyze** to let the AI suggest which titles, industries, and company sizes should go into Primary, Secondary, and Tertiary. You can edit the suggestions and then save.

- **Primary / Secondary / Tertiary** — For each tier you can add:
  - **Titles** (e.g. CEO, CTO, Director)
  - **Industries** (from the dropdown)
  - **Company size** (e.g. 1–10, 11–50, 51–200)
  Leads that match a tier’s criteria are counted in that tier on the dashboard.

- **Saving** — Click **Save Preferences**. The app will refresh and redirect to the dashboard; lead tier counts update so you see how many Primary, Secondary, and Tertiary leads you have.

In short: **Active** = you define who is high/medium/low value; **Paused** = the system decides from your profile. Use **Analyze** to get a starting suggestion, then tweak and save.

---

## 10. Best Practices

### Send a limited number of connections per day

- The platform uses limits (e.g. 2 launches per day, 8 per week) to keep your account safe. Don’t try to bypass these.
- If you need higher limits, discuss with your administrator; increasing too much can risk your LinkedIn account.

### Personalize messages

- Use the **Edit** option in Approvals to adjust AI-generated messages so they sound like you and fit the lead (e.g. mention their company or role).
- Short, relevant messages usually get better response rates than long, generic ones.

### Review AI messages before sending

- Always open the **Approvals** tab and read (and if needed edit) messages before you **Launch**.
- Check for tone, spelling, and that nothing is inappropriate or off-brand.

### Keep your lead list clean

- Remove leads who have already replied or asked to opt out from future campaigns.
- Use status and filters to avoid sending duplicate messages to the same person.

### Use filters to target the right people

- Before adding leads to a campaign, use filters (job title, industry, connection degree) so you only add people who match your goal.
- This improves response rates and keeps your reputation strong.

---

## 11. Troubleshooting

### “No leads found” or “0 saved” after Run Engine

- **Import My Connections:** Ensure your LinkedIn account is connected in the external automation tool (your admin does this). Try again later.
- **Explore Beyond My Network:** The search is configured in the external tool. Ask your admin to set or update the search URL and limit, then run the engine again.

### Import failed or “cookie missing” / “connection” error

- Your LinkedIn connection in the external automation service may have expired. Your administrator needs to **reconnect LinkedIn** (e.g. “Connect to LinkedIn”) in that service and save. After that, try Run Engine or Launch again.

### I approved messages but nothing was sent

- Approving only marks messages as ready. You must click **Launch** (or **Launch again**) in the campaign to actually send connection requests and messages. Check that the campaign is not paused and that the Launch button is enabled.

### “Limit reached” — I can’t click Launch

- The platform limits how often you can launch (e.g. 2 times per day, 8 per week). Wait until the next day or week, or ask your admin if limits can be adjusted for your role.

### CSV/Excel import: “Errors” or “Skipped” rows

- Each row needs a valid **LinkedIn profile URL**. Rows without it are skipped and listed in the error summary. Add the URL column and fill it, then import again.
- Check the **Download template** format and match your column names (e.g. “linkedin_url” or “LinkedIn URL”) so the system recognizes them.

### I don’t see the Approvals tab or LinkedIn AI button

- Make sure you are inside a **campaign** (Campaigns → LinkedIn → open a campaign). The Approvals tab and LinkedIn AI button are on the campaign page, not on the main Leads list.
- If you don’t see **LinkedIn AI**, your organization may need to enable AI features or connect an API key; contact your administrator.

### Messages or connection requests not appearing on LinkedIn

- It can take a few minutes for actions to show in LinkedIn. Refresh your LinkedIn “Sent” and “Messages” after a few minutes.
- If nothing appears, the external automation service may have failed. Check for an error message in the platform or contact support with the campaign name and approximate time you clicked Launch.

---

If you need help beyond this guide, contact your administrator or support. They can check limits, LinkedIn connection status, and campaign configuration.

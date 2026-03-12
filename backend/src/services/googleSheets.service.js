/**
 * Google Sheets Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides a clean interface to the Google Sheets API for the Content Engine.
 *
 * Current capabilities:
 *   - appendPost(content)          → Append [post_content, 'pending'] to Sheet1!A:B
 *   - updateRowStatus(row, status) → (Future) Update col B of a specific row
 *   - getRows()                    → (Future) Read all rows for deduplication
 *
 * Authentication:
 *   - Service account JSON: backend/src/config/linkedin-post-488117-96c95d33663a.json (default)
 *   - Scope: https://www.googleapis.com/auth/spreadsheets
 *
 * Config via environment variables:
 *   - GOOGLE_SHEET_ID   → Spreadsheet ID (from the sheet URL)
 *   - GOOGLE_SHEETS_CREDENTIALS_PATH → (optional) Path to service account JSON (absolute or relative to backend)
 *
 * ⚠️  Credentials are NEVER exposed to the frontend or committed publicly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
// Credentials: use GOOGLE_SHEETS_CREDENTIALS_PATH (absolute or relative to backend) or default path
const DEFAULT_CREDENTIALS_PATH = path.resolve(
    __dirname,
    '../config/linkedin-post-488117-96c95d33663a.json'
);

function getCredentialsPath() {
    const envPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;
    if (envPath) {
        return path.isAbsolute(envPath) ? envPath : path.resolve(__dirname, '../..', envPath);
    }
    return DEFAULT_CREDENTIALS_PATH;
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/**
 * Target range: Sheet1, columns A and B (post content + status)
 * Format: [ [post_content, phantom_status], ... ]
 */
const SHEET_RANGE = 'Sheet1!A:B';

// ─── AUTH ─────────────────────────────────────────────────────────────────────

/**
 * Build an authenticated Google Auth client using the service account.
 * Throws clearly if credentials file is missing.
 */
function getAuthClient() {
    const credentialsPath = getCredentialsPath();
    if (!fs.existsSync(credentialsPath)) {
        throw new Error(
            `Google Sheets credentials file not found at: ${credentialsPath}\n` +
            `Ensure the service account JSON is at backend/src/config/ or set GOOGLE_SHEETS_CREDENTIALS_PATH in .env`
        );
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: SCOPES,
    });

    return auth;
}

// ─── SHEET ID VALIDATION ──────────────────────────────────────────────────────

function getSheetId() {
    const id = process.env.GOOGLE_SHEET_ID;
    if (!id) {
        throw new Error(
            'GOOGLE_SHEET_ID is not set in .env. ' +
            'Add: GOOGLE_SHEET_ID=1R0KY7cQFAlfdXuBgas5XHYwC78BAaB49w51pR76Aotg'
        );
    }
    return id;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/** Range for data rows only (excludes header row 1). Cleared before each send so phantom sees only one post. */
const DATA_ROWS_RANGE = 'Sheet1!A2:B1000';

const GoogleSheetsService = {

    /**
     * Clear all data rows in Sheet1 (keeps row 1 header: Post | Status).
     * Call before appendPost on "Send now" so the phantom only sees the single post we just added.
     */
    async clearDataRows() {
        const auth = getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = getSheetId();
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: DATA_ROWS_RANGE,
        });
        console.log('📊 GoogleSheets: Cleared data rows (Sheet1 row 2 onward) so only one post will be sent.');
    },

    /**
     * Append a single post to the Google Sheet.
     *
     * Row format: | post_content | pending |
     * Range:      Sheet1!A:B
     *
     * @param {string} postContent  - The LinkedIn post text to append
     * @returns {Promise<object>}   - Google Sheets API response
     */
    async appendPost(postContent) {
        const auth = getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = getSheetId();

        const sanitizedContent = (postContent || '').trim();

        if (!sanitizedContent) {
            throw new Error('Cannot append empty post content to Google Sheet.');
        }

        const response = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: SHEET_RANGE,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
                values: [[sanitizedContent, 'pending']],
            },
        });

        const updatedRange = response.data.updates?.updatedRange || null;
        console.log(
            `📊 GoogleSheets: Appended post to sheet. ` +
            `Updated range: ${updatedRange || 'unknown'}`
        );

        return { ...response.data, updatedRange };
    },

    /**
     * Remove the row that was just appended (rollback when send fails).
     * Use the updatedRange returned from appendPost (e.g. "Sheet1!A5:B5").
     * Avoids leaving a failed post in the sheet so the next run doesn't post the wrong content.
     *
     * @param {string} updatedRange - e.g. "Sheet1!A5:B5" from append response
     * @returns {Promise<void>}
     */
    async undoAppend(updatedRange) {
        if (!updatedRange || typeof updatedRange !== 'string') {
            console.warn('GoogleSheets: undoAppend skipped (no updatedRange)');
            return;
        }
        const auth = getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = getSheetId();

        // Parse "Sheet1!A5:B5" -> sheetName = Sheet1, row = 5 (1-based)
        const match = updatedRange.match(/^'?([^'!]+)'?!A(\d+):/i) || updatedRange.match(/^([^!]+)!A(\d+):/i);
        const sheetName = match ? match[1].replace(/^'|'$/g, '') : 'Sheet1';
        const row1Based = match ? parseInt(match[2], 10) : null;
        if (!row1Based || row1Based < 1) {
            console.warn('GoogleSheets: undoAppend could not parse row from range:', updatedRange);
            return;
        }

        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        const sheet = (meta.data.sheets || []).find(
            (s) => (s.properties?.title || '') === sheetName
        );
        const sheetId = sheet?.properties?.sheetId ?? 0;
        const startIndex = row1Based - 1;
        const endIndex = startIndex + 1;

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    {
                        deleteDimension: {
                            range: {
                                sheetId,
                                dimension: 'ROWS',
                                startIndex,
                                endIndex,
                            },
                        },
                    },
                ],
            },
        });

        console.log(`📊 GoogleSheets: Rolled back appended row (${updatedRange}) after send failure.`);
    },

    /**
     * (Future Use) Update the status column (col B) of a specific row.
     *
     * @param {number} rowIndex  - 1-based row index in the sheet
     * @param {string} status    - New status value to write (e.g. 'posted', 'failed')
     * @returns {Promise<object>}
     */
    async updateRowStatus(rowIndex, status) {
        const auth = getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = getSheetId();

        const range = `Sheet1!B${rowIndex}`;

        const response = await sheets.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: 'RAW',
            requestBody: {
                values: [[status]],
            },
        });

        console.log(`📊 GoogleSheets: Updated row ${rowIndex} status to "${status}"`);
        return response.data;
    },

    /**
     * (Future Use) Fetch all rows from the sheet for cross-referencing.
     *
     * @returns {Promise<Array<Array<string>>>}  - 2D array of cell values
     */
    async getRows() {
        const auth = getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = getSheetId();

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: SHEET_RANGE,
        });

        return response.data.values || [];
    },

    /**
     * Health check — verifies credentials and sheet access.
     * Call this at startup to surface config errors early.
     *
     * @returns {Promise<{ ok: boolean, sheetId: string, tabCount: number }>}
     */
    async healthCheck() {
        const auth = getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = getSheetId();

        const response = await sheets.spreadsheets.get({ spreadsheetId });
        return {
            ok: true,
            sheetId: spreadsheetId,
            title: response.data.properties?.title,
            tabCount: response.data.sheets?.length || 0,
        };
    },
};

export default GoogleSheetsService;

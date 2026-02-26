#!/usr/bin/env node
/**
 * Run migration 028 (CRM restructure: is_priority, preference_tiers, indexes).
 * Use this when psql is not available: node scripts/run_028_migration.mjs
 *
 * Requires: DATABASE_URL in .env or backend database config.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
dotenv.config({ path: join(root, '.env') });

async function run() {
  let pool;
  try {
    if (process.env.DATABASE_URL) {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    } else {
      const host = process.env.DB_HOST || 'localhost';
      const port = parseInt(process.env.DB_PORT || '5432', 10);
      const user = process.env.DB_USER || 'postgres';
      const password = process.env.DB_PASSWORD != null ? String(process.env.DB_PASSWORD) : '';
      const database = process.env.DB_NAME || process.env.DB_DATABASE || 'linkedin_leads';
      if (!database || !user) {
        throw new Error('Set DATABASE_URL or DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME in .env');
      }
      pool = new pg.Pool({ host, port, user, password, database });
    }
    const sqlPath = join(root, 'database/migrations/028_crm_restructure_is_priority_and_tiers.sql');
    const sql = readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log('✅ Migration 028 applied successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.end();
  }
}

run();

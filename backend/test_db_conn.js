import pool from './src/db.js';
console.log('Testing connection...');
try {
  const res = await pool.query('SELECT NOW()');
  console.log('SUCCESS:', res.rows[0]);
} catch (err) {
  console.error('ERROR:', err);
}
process.exit(0);

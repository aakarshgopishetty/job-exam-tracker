const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Minimal tagged-template helper that mimics @vercel/postgres's `sql` API
// (so nothing in api/*.js needs to change), backed by plain `pg` instead —
// Prisma Postgres's connection string works with any standard Postgres
// client, just not with @vercel/postgres's Neon-specific validation.
function sql(strings, ...values) {
  let text = '';
  const params = [];
  strings.forEach((str, i) => {
    text += str;
    if (i < values.length) {
      params.push(values[i]);
      text += `$${params.length}`;
    }
  });
  return pool.query(text, params);
}

module.exports = { sql, pool };
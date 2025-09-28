// db.js - Enhanced PostgreSQL connection with error handling
require('dotenv').config();
const { Pool } = require('pg');

// Database configuration
const dbConfig = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 5432,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

console.log('🔧 Database Config:', {
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database,
  user: dbConfig.user
});

// Create connection pool
const pool = new Pool(dbConfig);

// Connection event handlers
pool.on('connect', (client) => {
  console.log('✅ New PostgreSQL client connected');
});

pool.on('error', (err, client) => {
  console.error('❌ Unexpected error on idle PostgreSQL client:', err.message);
  console.error('💡 Tip: Make sure PostgreSQL is running and accessible');
});

// Test database connection
async function testConnection() {
  let client;
  try {
    console.log('🔌 Testing database connection...');
    client = await pool.connect();
    
    const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('✅ PostgreSQL connected successfully');
    console.log('📅 Server time:', result.rows[0].current_time);
    console.log('🐘 PostgreSQL version:', result.rows[0].pg_version.split(' ')[0] + ' ' + result.rows[0].pg_version.split(' ')[1]);
    
    // Test if we can create tables
    await client.query('SELECT 1');
    console.log('✅ Database permissions verified');
    
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('💡 Please check:');
    console.error('   - PostgreSQL is running on port', process.env.DB_PORT);
    console.error('   - Database "' + process.env.DB_DATABASE + '" exists');
    console.error('   - User "' + process.env.DB_USER + '" has correct permissions');
    console.error('   - Password is correct');
  } finally {
    if (client) client.release();
  }
}

// Initialize connection test
testConnection();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down database connections...');
  await pool.end();
  console.log('✅ Database connections closed');
});

// Export database interface
module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  close: () => pool.end(),
  pool: pool
};

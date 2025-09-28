// server.js - Enhanced Express server with auto port detection
require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const bcrypt = require('bcrypt');
const session = require('express-session');
const net = require('net');

const app = express();
let PORT = parseInt(process.env.PORT) || 3000;
const FALLBACK_PORT = parseInt(process.env.FALLBACK_PORT) || 3001;

// Enhanced port detection function
async function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.listen(startPort, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    
    server.on('error', () => {
      server.close();
      if (startPort < FALLBACK_PORT + 10) {
        findAvailablePort(startPort + 1).then(resolve);
      } else {
        resolve(FALLBACK_PORT);
      }
    });
  });
}

// Database initialization with enhanced error handling
async function initializeDatabase() {
  try {
    console.log('\n🔧 Initializing database schema...');
    
    // Create users table with enhanced structure
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      )
    `);
    
    // Create indexes for better performance
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
    `);
    
    console.log('✅ Database schema initialized successfully');
    
    // Check current user count
    const userCount = await db.query('SELECT COUNT(*) as count FROM users');
    console.log(`📊 Current registered users: ${userCount.rows[0].count}`);
    
    return true;
    
  } catch (err) {
    console.error('❌ Database initialization failed:', err.message);
    console.error('💡 Please ensure PostgreSQL is running and accessible');
    return false;
  }
}

// Enhanced middleware setup
console.log('\n🔧 Setting up Express middleware...');

// Request logging with timestamp
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  console.log(`[${timestamp}] ${req.method} ${req.url} - ${ip}`);
  next();
});

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Enhanced session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-this',
  resave: false,
  saveUninitialized: false,
  name: 'loginSid',
  cookie: { 
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  },
  rolling: true // Reset expiry on each request
}));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Static file serving with enhanced path handling
const staticPath = path.join(__dirname, 'Frontend files', 'public');
console.log('📁 Static files directory:', staticPath);
app.use(express.static(staticPath, {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
  etag: false
}));

// ==================== ENHANCED API ROUTES ====================

// User registration with enhanced validation
app.post('/api/register', async (req, res) => {
  const startTime = Date.now();
  console.log('📝 Registration attempt for:', req.body.username);
  
  try {
    const { username, email, password } = req.body;
    
    // Enhanced input validation
    if (!username || !email || !password) {
      console.log('❌ Registration failed: Missing required fields');
      return res.status(400).json({ 
        error: 'All fields are required',
        details: 'Username, email, and password must be provided'
      });
    }
    
    // Username validation
    if (username.length < 3 || username.length > 50) {
      return res.status(400).json({ 
        error: 'Username must be between 3 and 50 characters'
      });
    }
    
    // Email validation (basic)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        error: 'Please provide a valid email address'
      });
    }
    
    // Password validation
    if (password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters long'
      });
    }
    
    // Check for existing user
    const existingUser = await db.query(
      'SELECT id, username, email FROM users WHERE username = $1 OR email = $2',
      [username.toLowerCase(), email.toLowerCase()]
    );
    
    if (existingUser.rows.length > 0) {
      const existing = existingUser.rows[0];
      const conflictField = existing.username.toLowerCase() === username.toLowerCase() ? 'username' : 'email';
      console.log(`❌ Registration failed: ${conflictField} already exists`);
      return res.status(400).json({ 
        error: `This ${conflictField} is already registered`
      });
    }
    
    // Hash password with configurable rounds
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Insert new user
    const result = await db.query(
      `INSERT INTO users (username, email, password, created_at) 
       VALUES ($1, $2, $3, NOW()) 
       RETURNING id, username, email, created_at`,
      [username.toLowerCase(), email.toLowerCase(), hashedPassword]
    );
    
    const newUser = result.rows[0];
    
    // Create session
    req.session.userId = newUser.id;
    req.session.username = newUser.username;
    req.session.loginTime = new Date();
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ User registered successfully: ${username} (${processingTime}ms)`);
    
    res.status(201).json({
      message: 'Registration successful',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        created_at: newUser.created_at
      }
    });
    
  } catch (err) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ Registration error (${processingTime}ms):`, err.message);
    
    if (err.code === '23505') { // PostgreSQL unique violation
      return res.status(400).json({ 
        error: 'Username or email already exists'
      });
    }
    
    res.status(500).json({ 
      error: 'Registration failed due to server error'
    });
  }
});

// Enhanced login endpoint
app.post('/api/login', async (req, res) => {
  const startTime = Date.now();
  console.log('🔐 Login attempt for:', req.body.username);
  
  try {
    const { username, password } = req.body;
    
    // Input validation
    if (!username || !password) {
      console.log('❌ Login failed: Missing credentials');
      return res.status(400).json({ 
        error: 'Username and password are required'
      });
    }
    
    // Find user (case insensitive)
    const userResult = await db.query(
      'SELECT id, username, email, password, last_login FROM users WHERE LOWER(username) = LOWER($1) AND is_active = true',
      [username]
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ Login failed: User not found');
      return res.status(401).json({ 
        error: 'Invalid username or password'
      });
    }
    
    const user = userResult.rows[0];
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      console.log('❌ Login failed: Invalid password');
      return res.status(401).json({ 
        error: 'Invalid username or password'
      });
    }
    
    // Update last login time
    await db.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );
    
    // Create session
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.loginTime = new Date();
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ User logged in successfully: ${username} (${processingTime}ms)`);
    
    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        lastLogin: user.last_login
      }
    });
    
  } catch (err) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ Login error (${processingTime}ms):`, err.message);
    res.status(500).json({ 
      error: 'Login failed due to server error'
    });
  }
});

// Enhanced logout endpoint
app.post('/api/logout', (req, res) => {
  const username = req.session.username;
  const sessionDuration = req.session.loginTime ? 
    Math.round((Date.now() - new Date(req.session.loginTime).getTime()) / 1000) : 0;
  
  req.session.destroy((err) => {
    if (err) {
      console.error('❌ Logout error:', err.message);
      return res.status(500).json({ 
        error: 'Logout failed'
      });
    }
    
    res.clearCookie('loginSid');
    console.log(`👋 User logged out: ${username} (session: ${sessionDuration}s)`);
    res.json({ 
      message: 'Logged out successfully'
    });
  });
});

// Enhanced profile endpoint
app.get('/api/profile', async (req, res) => {
  if (!req.session.userId) {
    console.log('❌ Profile access denied: Not authenticated');
    return res.status(401).json({ 
      error: 'Authentication required'
    });
  }
  
  try {
    const userResult = await db.query(
      `SELECT id, username, email, created_at, last_login, 
              (SELECT COUNT(*) FROM users) as total_users
       FROM users WHERE id = $1 AND is_active = true`,
      [req.session.userId]
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ Profile access denied: User not found');
      return res.status(404).json({ 
        error: 'User account not found'
      });
    }
    
    const user = userResult.rows[0];
    const sessionDuration = req.session.loginTime ? 
      Math.round((Date.now() - new Date(req.session.loginTime).getTime()) / 1000) : 0;
    
    console.log(`✅ Profile accessed: ${user.username}`);
    
    res.json({ 
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        created_at: user.created_at,
        last_login: user.last_login,
        session_duration: sessionDuration
      },
      stats: {
        total_users: parseInt(user.total_users)
      }
    });
    
  } catch (err) {
    console.error('❌ Profile error:', err.message);
    res.status(500).json({ 
      error: 'Failed to load profile'
    });
  }
});

// ==================== HTML ROUTES ====================

// Serve HTML files with error handling
app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'Frontend files', 'public', 'login.html');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('❌ Error serving login.html:', err.message);
      res.status(404).send(`
        <h1>File Not Found</h1>
        <p>Login page could not be loaded.</p>
        <p>Please check if the file exists at: Frontend files/public/login.html</p>
        <a href="/test">Test Server</a>
      `);
    }
  });
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'Frontend files', 'public', 'login.html'));
});

app.get('/register.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'Frontend files', 'public', 'register.html'));
});

app.get('/profile.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'Frontend files', 'public', 'profile.html'));
});

// Enhanced test endpoint
app.get('/test', (req, res) => {
  const uptime = process.uptime();
  const memUsage = process.memoryUsage();
  
  res.send(`
    <h1>🚀 Server Status: RUNNING</h1>
    <div style="font-family: monospace; background: #f5f5f5; padding: 15px; border-radius: 5px;">
      <p><strong>Time:</strong> ${new Date().toISOString()}</p>
      <p><strong>Uptime:</strong> ${Math.floor(uptime)}s</p>
      <p><strong>Memory:</strong> ${Math.round(memUsage.rss / 1024 / 1024)}MB</p>
      <p><strong>Session ID:</strong> ${req.session.id}</p>
      <p><strong>User ID:</strong> ${req.session.userId || 'Not logged in'}</p>
      <p><strong>Static Path:</strong> Frontend files/public/</p>
    </div>
    <div style="margin-top: 20px;">
      <a href="/" style="margin-right: 10px;">🏠 Login</a>
      <a href="/register.html" style="margin-right: 10px;">📝 Register</a>
      <a href="/profile.html">👤 Profile</a>
    </div>
  `);
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404 - Not found: ${req.url}`);
  res.status(404).send(`
    <h1>404 - Page Not Found</h1>
    <p>The page <strong>${req.url}</strong> was not found.</p>
    <p><a href="/">← Go to Home</a></p>
  `);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err.message);
  console.error(err.stack);
  res.status(500).send(`
    <h1>Server Error</h1>
    <p>Something went wrong on our end.</p>
    <p><a href="/">← Go to Home</a></p>
  `);
});

// ==================== SERVER STARTUP ====================

async function startServer() {
  try {
    console.log('\n🚀 Starting Login System Server...');
    console.log('================================================');
    
    // Initialize database first
    const dbInitialized = await initializeDatabase();
    if (!dbInitialized) {
      console.log('⚠️  Database initialization failed, but continuing...');
    }
    
    // Find available port
    const availablePort = await findAvailablePort(PORT);
    if (availablePort !== PORT) {
      console.log(`⚠️  Port ${PORT} is busy, using port ${availablePort} instead`);
      PORT = availablePort;
    }
    
    // Start server
    const server = app.listen(PORT, () => {
      console.log('\n🎉 SERVER STARTED SUCCESSFULLY!');
      console.log('================================================');
      console.log(`🌐 Server URL: http://localhost:${PORT}`);
      console.log(`📁 Static files: Frontend files/public/`);
      console.log(`🔗 Test endpoint: http://localhost:${PORT}/test`);
      console.log(`💓 Health check: http://localhost:${PORT}/health`);
      console.log('================================================');
      console.log('📍 Available routes:');
      console.log('   🏠 GET  / (login page)');
      console.log('   📝 GET  /register.html');
      console.log('   👤 GET  /profile.html');
      console.log('   🔧 GET  /test (debugging)');
      console.log('   💓 GET  /health (status)');
      console.log('   📝 POST /api/register');
      console.log('   🔐 POST /api/login');
      console.log('   👋 POST /api/logout');
      console.log('   👤 GET  /api/profile');
      console.log('================================================');
      console.log('✨ Ready to accept connections!');
      console.log('Press Ctrl+C to stop the server');
    });
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down server gracefully...');
      server.close(async () => {
        console.log('🔌 Server connections closed');
        await db.close();
        console.log('💾 Database connections closed');
        console.log('👋 Goodbye!');
        process.exit(0);
      });
    });
    
  } catch (err) {
    console.error('💥 Failed to start server:', err.message);
    process.exit(1);
  }
}

// Start the server
startServer();

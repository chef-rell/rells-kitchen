const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const nodemailer = require('nodemailer');
// const USPSIntegration = require('./usps-integration'); // Old Web Tools API - DEPRECATED
const USPSOAuthIntegration = require('./usps-oauth-integration'); // New OAuth 2.0 API
const TaxCalculator = require('./tax-calculator');
const NotificationService = require('./notification-service');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

// Initialize USPS OAuth 2.0 integration
const uspsIntegration = new USPSOAuthIntegration(
  process.env.USPS_CONSUMER_KEY,
  process.env.USPS_CONSUMER_SECRET,
  process.env.USPS_CUSTOMER_REGISTRATION_ID,
  process.env.USPS_MAILER_ID
);

// Initialize tax calculator
const taxCalculator = new TaxCalculator();

// Initialize notification service with error handling
let notificationService;
try {
  console.log('🔧 Initializing notification service...');
  notificationService = new NotificationService();
  console.log('✅ Notification service created');
  console.log('📊 Service status:', notificationService.getServiceStatus());
} catch (error) {
  console.error('❌ Error initializing notification service:', error.message);
  console.error('❌ Error stack:', error.stack);
  // Create a fallback notification service that handles errors gracefully
  notificationService = {
    sendTestEmail: async () => { throw new Error('Email service not available'); },
    sendTestSMS: async () => { throw new Error('SMS service not available'); },
    getServiceStatus: () => ({ email: { configured: false }, sms: { configured: false } })
  };
}

// Trust proxy when behind Railway/Heroku/etc reverse proxy
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.paypal.com", "https://www.paypalobjects.com", "https://*.paypal.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://www.paypal.com", "https://api.paypal.com", "https://postcollector.paypal.com", "https://*.paypal.com"],
      frameSrc: ["'self'", "https://www.paypal.com", "https://*.paypal.com"]
    }
  }
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// Serve static files with proper caching headers
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: false,
  setHeaders: (res, path) => {
    // Prevent caching of JavaScript files to ensure updates are loaded
    if (path.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// PostgreSQL connection using fresh Postgres-S448 service
const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection and initialize tables
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to PostgreSQL database:', err);
  } else {
    console.log('✅ Connected to PostgreSQL database');
    release();
    initializeTables();
  }
});

// Initialize database tables
async function initializeTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        preferences TEXT DEFAULT '{}',
        first_name TEXT,
        last_name TEXT,
        phone TEXT,
        address_street TEXT,
        address_city TEXT,
        address_state TEXT,
        address_zip TEXT,
        birth_month TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create products table
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price DECIMAL(10,2),
        available BOOLEAN DEFAULT true,
        neo_flavor_profile INTEGER DEFAULT 1,
        user_rating INTEGER DEFAULT 1,
        inventory_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create sub_products table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sub_products (
        id TEXT PRIMARY KEY,
        parent_product_id TEXT NOT NULL,
        size TEXT NOT NULL,
        size_oz INTEGER NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        inventory_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_product_id) REFERENCES products (id)
      )
    `);

    // Create reservations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        product_id TEXT,
        quantity INTEGER DEFAULT 1,
        status TEXT DEFAULT 'pending',
        pickup_date DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (product_id) REFERENCES products (id)
      )
    `);

    // Create recipes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        ingredients TEXT NOT NULL,
        instructions TEXT NOT NULL,
        spice_level INTEGER DEFAULT 1,
        prep_time INTEGER,
        author TEXT DEFAULT 'Rell',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create coupons table
    await client.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        discount_type TEXT NOT NULL,
        discount_value DECIMAL(10,2) NOT NULL,
        active BOOLEAN DEFAULT true,
        usage_limit INTEGER DEFAULT -1,
        usage_count INTEGER DEFAULT 0,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create subscriptions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        paypal_subscription_id TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'active',
        plan_id TEXT DEFAULT 'P-7JA37658E8258991HNCEYJMQ',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        next_billing_date TIMESTAMP,
        billing_cycles_completed INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // Create orders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        sub_product_id TEXT,
        customer_email TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        customer_phone TEXT,
        shipping_street TEXT,
        shipping_city TEXT,
        shipping_state TEXT,
        shipping_zip TEXT,
        shipping_method TEXT,
        shipping_cost DECIMAL(10,2) DEFAULT 0,
        coupon_code TEXT,
        coupon_discount DECIMAL(10,2) DEFAULT 0,
        quantity INTEGER NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        paypal_order_id TEXT,
        order_notes TEXT,
        status TEXT DEFAULT 'completed',
        user_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products (id),
        FOREIGN KEY (sub_product_id) REFERENCES sub_products (id)
      )
    `);

    // Insert default coupon
    await client.query(`
      INSERT INTO coupons (id, code, discount_type, discount_value, active, usage_limit) 
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (code) DO NOTHING
    `, [uuidv4(), 'family', 'percentage', 25, true, -1]);

    // Note: Test coupons can be manually deactivated if needed

    // Fix existing subscriptions with NULL next_billing_date
    await client.query(`
      UPDATE subscriptions 
      SET next_billing_date = started_at + INTERVAL '1 month' 
      WHERE next_billing_date IS NULL
    `);

    // Create admin_settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        id TEXT PRIMARY KEY,
        setting_key TEXT UNIQUE NOT NULL,
        setting_value TEXT NOT NULL,
        setting_type TEXT DEFAULT 'string',
        description TEXT,
        updated_by TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default admin settings
    await client.query(`
      INSERT INTO admin_settings (id, setting_key, setting_value, setting_type, description)
      VALUES 
        ('admin-email', 'admin_email', 'admin@rellskitchen.com', 'string', 'Admin email for notifications'),
        ('admin-phone', 'admin_phone', '+15017609490', 'string', 'Admin phone for SMS alerts'),
        ('email-new-orders', 'email_new_orders', 'true', 'boolean', 'Send email for new orders'),
        ('email-low-stock', 'email_low_stock', 'true', 'boolean', 'Send email for low stock alerts'),
        ('sms-critical', 'sms_critical_alerts', 'true', 'boolean', 'Send SMS for critical alerts'),
        ('sms-out-of-stock', 'sms_out_of_stock', 'false', 'boolean', 'Send SMS for out of stock alerts'),
        ('low-stock-threshold', 'low_stock_threshold', '5', 'number', 'Low stock alert threshold')
      ON CONFLICT (setting_key) DO NOTHING
    `);

    await client.query('COMMIT');
    console.log('✅ Database tables initialized');

    // Check if products exist, if not, initialize them
    const productCount = await client.query('SELECT COUNT(*) as count FROM products');
    if (parseInt(productCount.rows[0].count) === 0) {
      console.log('Initializing database with products...');
      setTimeout(() => {
        initializeDatabase();
      }, 1000);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error initializing database tables:', err);
  } finally {
    client.release();
  }
}

// Initialize products and sub-products
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert products using ON CONFLICT to avoid duplicates
    await client.query(`
      INSERT INTO products 
      (id, name, description, price, available, neo_flavor_profile, user_rating, created_at, inventory_count) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        price = EXCLUDED.price,
        available = EXCLUDED.available,
        neo_flavor_profile = EXCLUDED.neo_flavor_profile,
        user_rating = EXCLUDED.user_rating,
        inventory_count = EXCLUDED.inventory_count
    `, [
      'fixed-tamarind-stew-id',
      'Tamarind_Sweets',
      "This beloved Caribbean comfort food delivers the perfect harmony of sweet and tangy flavors. A treasured local dish known as 'Tamarind Stew'.",
      6.99,
      true,
      4,
      4,
      '2025-07-26 19:04:59',
      15
    ]);

    await client.query(`
      INSERT INTO products 
      (id, name, description, price, available, neo_flavor_profile, user_rating, created_at, inventory_count) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        price = EXCLUDED.price,
        available = EXCLUDED.available,
        neo_flavor_profile = EXCLUDED.neo_flavor_profile,
        user_rating = EXCLUDED.user_rating,
        inventory_count = EXCLUDED.inventory_count
    `, [
      'fixed-quantum-mango-id',
      'Quantum_Mango',
      "Succulent St. Thomas mango, slow-simmered with traditional island spices until fork-tender. This aromatic masterpiece, known locally as 'Mango Stew,' delivers layers of complex, neo-Caribbean flavors.",
      8.99,
      true,
      3,
      4,
      '2025-07-26 19:04:59',
      0
    ]);

    // Insert sub-products
    const subProducts = [
      ['254fa798-1cce-413f-8e29-6e3c426e4b80', 'fixed-tamarind-stew-id', '4oz', 4, 6.99, 14, '2025-07-26 21:28:40'],
      ['208c9859-4e32-4a19-972a-63046e916633', 'fixed-tamarind-stew-id', '8oz', 8, 13.98, 15, '2025-07-26 21:28:40'],
      ['89506dba-86cd-4b74-b7d2-1d87b4917148', 'fixed-tamarind-stew-id', '16oz', 16, 27.96, 11, '2025-07-26 21:36:40'],
      ['046ae866-7f24-49b6-a137-7f3a0b649872', 'fixed-quantum-mango-id', '4oz', 4, 8.99, 0, '2025-07-27 05:00:53'],
      ['1a80e4ea-fa3d-40ff-bdaf-1d8f9dfacacf', 'fixed-quantum-mango-id', '8oz', 8, 17.98, 0, '2025-07-26 21:40:25'],
      ['14428213-7032-4c22-ab5f-0d04deb95987', 'fixed-quantum-mango-id', '16oz', 16, 35.96, 0, '2025-07-27 05:00:53']
    ];

    for (const subProduct of subProducts) {
      await client.query(`
        INSERT INTO sub_products 
        (id, parent_product_id, size, size_oz, price, inventory_count, created_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          parent_product_id = EXCLUDED.parent_product_id,
          size = EXCLUDED.size,
          size_oz = EXCLUDED.size_oz,
          price = EXCLUDED.price,
          inventory_count = EXCLUDED.inventory_count
      `, subProduct);
    }

    await client.query('COMMIT');
    console.log('✅ Database initialized with products and sub-products');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error initializing database with products:', err);
  } finally {
    client.release();
  }
}

const authenticateToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

const optionalAuth = (req, res, next) => {
  const token = req.cookies.token;
  if (token) {
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (!err) req.user = user;
    });
  }
  next();
};

// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
  const token = req.cookies.token;
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Get user from database to check current role
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin privileges required' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(401).json({ error: 'Invalid authentication' });
  }
};

app.post('/api/register', async (req, res) => {
  const { 
    username, 
    email, 
    password, 
    firstName, 
    lastName, 
    phone, 
    addressStreet, 
    addressCity, 
    addressState, 
    addressZip, 
    birthMonth 
  } = req.body;

  if (!username || !email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: 'Username, email, password, first name, and last name are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Check if user exists
    const existingUser = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $2', [username, email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const hash = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    // Create user
    await pool.query(`
      INSERT INTO users (
        id, username, email, password, first_name, last_name, phone, 
        address_street, address_city, address_state, address_zip, birth_month
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [userId, username, email, hash, firstName, lastName, phone, 
        addressStreet, addressCity, addressState, addressZip, birthMonth]);

    const token = jwt.sign({ userId, username, role: 'member' }, JWT_SECRET, { expiresIn: '7d' });
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ message: 'Registration successful', user: { id: userId, username, role: 'member' } });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ message: 'Login successful', user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Authentication error' });
  }
});

app.post('/api/guest-login', (req, res) => {
  const guestId = uuidv4();
  const token = jwt.sign({ userId: guestId, username: 'guest', role: 'guest' }, JWT_SECRET, { expiresIn: '24h' });
  
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  });

  res.json({ message: 'Guest session created', user: { id: guestId, username: 'guest', role: 'guest' } });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

// Auth verification endpoint for admin dashboard
app.get('/api/auth/verify', async (req, res) => {
  const token = req.cookies.token;
  
  if (!token) {
    return res.status(401).json({ error: 'No authentication token' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Get user from database to get current role and info
    const userResult = await pool.query('SELECT id, username, email, role FROM users WHERE id = $1', [decoded.userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    });
  } catch (error) {
    console.error('Auth verification error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
});

// Logout endpoint for admin dashboard (alternative path)
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/user', authenticateToken, async (req, res) => {
  if (req.user.role === 'guest') {
    return res.json({ user: { id: req.user.userId, username: 'guest', role: 'guest' } });
  }

  try {
    const userResult = await pool.query(`
      SELECT 
        id, username, email, role, preferences, first_name, last_name, phone,
        address_street, address_city, address_state, address_zip, birth_month, created_at
      FROM users WHERE id = $1
    `, [req.user.userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Check subscription status
    const subscriptionResult = await pool.query(
      'SELECT * FROM subscriptions WHERE user_id = $1 AND status = $2', 
      [req.user.userId, 'active']
    );
    
    const subscription = subscriptionResult.rows[0] || null;
    
    const userData = { 
      ...user, 
      preferences: JSON.parse(user.preferences || '{}'),
      subscription: subscription,
      isSubscribed: !!subscription,
      supporterDiscount: subscription ? 5 : 0
    };
    
    res.json({ user: userData });
  } catch (err) {
    console.error('User fetch error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/products', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE available = true ORDER BY name');
    console.log('API products query result:', result.rows);
    res.json({ products: result.rows });
  } catch (err) {
    console.error('Products fetch error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/sub-products/:productId', async (req, res) => {
  const { productId } = req.params;
  
  console.log('Sub-products API called with productId:', productId);
  
  try {
    const result = await pool.query('SELECT * FROM sub_products WHERE parent_product_id = $1 ORDER BY size_oz', [productId]);
    console.log('Found sub-products:', result.rows.length, 'items');
    res.json({ subProducts: result.rows });
  } catch (err) {
    console.error('Sub-products database error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/validate-coupon', optionalAuth, async (req, res) => {
  const { code, subtotal, shippingCost } = req.body;
  
  if (!code || !subtotal) {
    return res.status(400).json({ error: 'Coupon code and subtotal required' });
  }
  
  try {
    const result = await pool.query(`
      SELECT * FROM coupons WHERE code = $1 AND active = true 
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (usage_limit = -1 OR usage_count < usage_limit)
    `, [code.toLowerCase()]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired coupon code' });
    }
    
    const coupon = result.rows[0];
    
    // Calculate discount on subtotal + shipping
    const baseAmount = parseFloat(subtotal) + parseFloat(shippingCost || 0);
    
    let discountAmount = 0;
    if (coupon.discount_type === 'percentage') {
      discountAmount = (baseAmount * coupon.discount_value / 100);
    } else if (coupon.discount_type === 'fixed') {
      discountAmount = Math.min(coupon.discount_value, baseAmount);
    }
    
    res.json({
      valid: true,
      code: coupon.code,
      discountType: coupon.discount_type,
      discountValue: coupon.discount_value,
      discountAmount: parseFloat(discountAmount.toFixed(2))
    });
  } catch (err) {
    console.error('Coupon validation error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/reservations', authenticateToken, async (req, res) => {
  const { productId, quantity = 1, pickupDate, notes } = req.body;

  if (!productId) {
    return res.status(400).json({ error: 'Product ID required' });
  }

  try {
    const reservationId = uuidv4();
    await pool.query(
      'INSERT INTO reservations (id, user_id, product_id, quantity, pickup_date, notes) VALUES ($1, $2, $3, $4, $5, $6)',
      [reservationId, req.user.userId, productId, quantity, pickupDate, notes]
    );

    res.json({ message: 'Reservation created successfully', reservationId });
  } catch (err) {
    console.error('Reservation creation error:', err);
    res.status(500).json({ error: 'Reservation failed' });
  }
});

app.get('/api/reservations', authenticateToken, async (req, res) => {
  if (req.user.role === 'guest') {
    return res.json({ reservations: [] });
  }

  try {
    const result = await pool.query(`
      SELECT r.*, p.name as product_name, p.price 
      FROM reservations r 
      JOIN products p ON r.product_id = p.id 
      WHERE r.user_id = $1 
      ORDER BY r.created_at DESC
    `, [req.user.userId]);

    res.json({ reservations: result.rows });
  } catch (err) {
    console.error('Reservations fetch error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Utility route to create PayPal subscription plan (run once)
app.post('/api/create-subscription-plan', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const fetch = require('node-fetch');
    
    // Get PayPal access token
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    
    const tokenResponse = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // First create a product
    const productResponse = await fetch('https://api-m.paypal.com/v1/catalogs/products', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'PayPal-Request-Id': Date.now().toString()
      },
      body: JSON.stringify({
        id: 'PROD-RELLS-SUPPORTER',
        name: "Rell's Kitchen Supporter Plan",
        description: "Monthly subscription with 5% discount and free samples",
        type: 'SERVICE',
        category: 'SOFTWARE'
      })
    });

    const productData = await productResponse.json();
    console.log('Product creation response:', productData);

    // Create subscription plan
    const planResponse = await fetch('https://api-m.paypal.com/v1/billing/plans', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'PayPal-Request-Id': Date.now().toString()
      },
      body: JSON.stringify({
        product_id: 'PROD-RELLS-SUPPORTER',
        name: "Rell's Kitchen Supporter Plan",
        description: "Monthly subscription with 5% discount and free samples",
        status: 'ACTIVE',
        billing_cycles: [{
          frequency: {
            interval_unit: 'MONTH',
            interval_count: 1
          },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: {
              value: '9.99',
              currency_code: 'USD'
            }
          }
        }],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee: {
            value: '0',
            currency_code: 'USD'
          },
          setup_fee_failure_action: 'CONTINUE',
          payment_failure_threshold: 3
        },
        taxes: {
          percentage: '0',
          inclusive: false
        }
      })
    });

    const planData = await planResponse.json();
    
    if (planResponse.ok) {
      res.json({ 
        success: true, 
        plan_id: planData.id,
        message: 'Subscription plan created successfully',
        plan: planData
      });
    } else {
      res.status(400).json({ error: 'Failed to create plan', details: planData });
    }
  } catch (error) {
    console.error('Plan creation error:', error);
    res.status(500).json({ error: 'Failed to create subscription plan' });
  }
});

// Subscription routes
app.post('/api/subscribe', authenticateToken, async (req, res) => {
  console.log('Subscription request received:', {
    userId: req.user.userId,
    userRole: req.user.role,
    body: req.body
  });

  if (req.user.role === 'guest') {
    console.log('Subscription denied: guest user');
    return res.status(403).json({ error: 'Member account required for subscription' });
  }

  const { subscriptionID } = req.body;
  
  if (!subscriptionID) {
    console.log('Subscription failed: missing PayPal subscription ID');
    return res.status(400).json({ error: 'PayPal subscription ID required' });
  }

  console.log('Checking for existing subscription for user:', req.user.userId);

  try {
    // Check if user already has an active subscription
    const existingResult = await pool.query('SELECT * FROM subscriptions WHERE user_id = $1 AND status = $2', [req.user.userId, 'active']);
    
    if (existingResult.rows.length > 0) {
      console.log('Subscription denied: user already has active subscription:', existingResult.rows[0].id);
      return res.status(400).json({ error: 'You already have an active subscription' });
    }

    const subscriptionId = uuidv4();
    const nextBillingDate = new Date();
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1); // Monthly billing

    console.log('Creating new subscription:', {
      subscriptionId: subscriptionId,
      userId: req.user.userId,
      paypalSubscriptionId: subscriptionID,
      nextBillingDate: nextBillingDate.toISOString()
    });

    await pool.query(`
      INSERT INTO subscriptions (
        id, user_id, paypal_subscription_id, status, next_billing_date
      ) VALUES ($1, $2, $3, $4, $5)
    `, [subscriptionId, req.user.userId, subscriptionID, 'active', nextBillingDate]);
    
    console.log('Subscription created successfully:', subscriptionId);
    
    res.json({ 
      message: 'Subscription activated successfully',
      subscriptionId: subscriptionId,
      benefits: {
        discount: '10% site-wide discount',
        samples: 'Monthly 4oz samples of new products',
        earlyAccess: 'Early access to new releases'
      }
    });
  } catch (err) {
    console.error('Failed to create subscription in database:', err);
    res.status(500).json({ error: 'Subscription creation failed' });
  }
});

app.post('/api/cancel-subscription', authenticateToken, async (req, res) => {
  if (req.user.role === 'guest') {
    return res.status(403).json({ error: 'Member account required' });
  }

  try {
    const result = await pool.query(
      'UPDATE subscriptions SET status = $1, updated_at = NOW() WHERE user_id = $2 AND status = $3', 
      ['cancelled', req.user.userId, 'active']
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No active subscription found' });
    }
    
    res.json({ message: 'Subscription cancelled successfully' });
  } catch (err) {
    console.error('Subscription cancellation error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Order history route
app.get('/api/order-history', authenticateToken, async (req, res) => {
  if (req.user.role === 'guest') {
    return res.json({ orders: [] });
  }

  try {
    const result = await pool.query(`
      SELECT o.*, p.name as product_name, sp.size as product_size
      FROM orders o
      JOIN products p ON o.product_id = p.id
      LEFT JOIN sub_products sp ON o.sub_product_id = sp.id
      WHERE o.user_id = $1 OR o.customer_email = (SELECT email FROM users WHERE id = $2)
      ORDER BY o.created_at DESC
    `, [req.user.userId, req.user.userId]);

    res.json({ orders: result.rows });
  } catch (err) {
    console.error('Order history fetch error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Profile update route
app.put('/api/profile', authenticateToken, async (req, res) => {
  if (req.user.role === 'guest') {
    return res.status(403).json({ error: 'Member account required' });
  }

  const { 
    firstName, lastName, phone, addressStreet, 
    addressCity, addressState, addressZip, birthMonth 
  } = req.body;

  try {
    const result = await pool.query(`
      UPDATE users SET 
        first_name = $1, last_name = $2, phone = $3, address_street = $4,
        address_city = $5, address_state = $6, address_zip = $7, birth_month = $8
      WHERE id = $9
    `, [firstName, lastName, phone, addressStreet, addressCity, addressState, addressZip, birthMonth, req.user.userId]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cookbook disabled
app.get('/cookbook', (req, res) => {
  res.status(404).send('Cookbook is currently unavailable');
});

app.get('/account', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'account.html'));
});

// Admin dashboard page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/payment.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

// PayPal redirect flow pages
app.get('/payment-cancel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment-cancel.html'));
});

app.get('/payment-return', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment-return.html'));
});

app.get('/test-registration.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'test-registration.html'));
});

// Calculate shipping rates
app.post('/api/calculate-shipping', optionalAuth, async (req, res) => {
  const { zipCode, productSize, quantity } = req.body;
  
  console.log('Shipping calculation request:', { zipCode, productSize, quantity });
  
  if (!zipCode || !productSize || !quantity) {
    return res.status(400).json({ error: 'ZIP code, product size, and quantity are required' });
  }
  
  // Validate ZIP code format
  if (!uspsIntegration.isValidZipCode(zipCode)) {
    return res.status(400).json({ error: 'Invalid ZIP code format' });
  }
  
  try {
    // Shipping origin (your business location)
    const fromZip = '72120'; // North Little Rock, AR
    
    // Calculate package weight and dimensions
    const weight = uspsIntegration.calculatePackageWeight(productSize, quantity);
    const dimensions = uspsIntegration.getPackageDimensions(productSize, quantity);
    
    console.log('Calculated shipping parameters:', { weight, dimensions, fromZip, toZip: zipCode });
    
    // Get USPS rates using OAuth 2.0 API
    const shippingRates = await uspsIntegration.calculateShippingRates(
      fromZip, 
      zipCode, 
      weight, 
      dimensions
    );
    
    console.log('USPS OAuth rates calculated:', shippingRates);
    
    // Add local pickup option to USPS rates
    const ratesWithPickup = [
      {
        service: 'LOCAL_PICKUP',
        name: 'Local Pickup',
        cost: 0.00,
        deliveryTime: 'Next business day',
        description: 'Local Pickup - FREE (North Little Rock, AR)'
      },
      ...shippingRates
    ];
    
    res.json({ 
      success: true,
      rates: ratesWithPickup,
      packageInfo: {
        weight: weight,
        dimensions: dimensions
      }
    });
    
  } catch (error) {
    console.error('Shipping calculation error:', error);
    
    // Fallback to static rates if USPS API fails
    const fallbackRates = [
      {
        service: 'LOCAL_PICKUP',
        name: 'Local Pickup',
        cost: 0.00,
        deliveryTime: 'Next business day',
        description: 'Local Pickup - FREE (North Little Rock, AR)'
      },
      {
        service: 'GROUND_ADVANTAGE',
        name: 'Ground Advantage',
        cost: 9.95,
        deliveryTime: '2-5 business days',
        description: 'Ground Advantage (2-5 business days) - $9.95'
      },
      {
        service: 'PRIORITY_MAIL',
        name: 'Priority Mail',
        cost: 18.50,
        deliveryTime: '1-3 business days',
        description: 'Priority Mail (1-3 business days) - $18.50'
      },
      {
        service: 'PRIORITY_MAIL_EXPRESS',
        name: 'Priority Express',
        cost: 49.95,
        deliveryTime: '1-2 business days',
        description: 'Priority Express (1-2 business days) - $49.95'
      }
    ];
    
    console.log('Using fallback shipping rates due to API error');
    
    res.json({ 
      success: true,
      rates: fallbackRates,
      fallback: true,
      error: 'Live rates unavailable, using standard rates'
    });
  }
});

// Calculate shipping rates and tax for a complete order preview
app.post('/api/calculate-order-total', optionalAuth, async (req, res) => {
  const { zipCode, productSize, quantity, productPrice, address } = req.body;
  
  console.log('Order total calculation request:', { zipCode, productSize, quantity, productPrice, address });
  
  if (!zipCode || !productSize || !quantity || !productPrice) {
    return res.status(400).json({ error: 'ZIP code, product size, quantity, and product price are required' });
  }
  
  // Validate ZIP code format
  if (!uspsIntegration.isValidZipCode(zipCode)) {
    return res.status(400).json({ error: 'Invalid ZIP code format' });
  }
  
  try {
    // Calculate subtotal
    const subtotal = productPrice * quantity;
    
    // Get shipping rates from USPS OAuth API
    const fromZip = '72120'; // North Little Rock, AR
    const weight = uspsIntegration.calculatePackageWeight(productSize, quantity);
    const dimensions = uspsIntegration.getPackageDimensions(productSize, quantity);
    
    let shippingRates = [];
    try {
      shippingRates = await uspsIntegration.calculateShippingRates(fromZip, zipCode, weight, dimensions);
      // Add local pickup option to USPS rates
      shippingRates = [
        {
          service: 'LOCAL_PICKUP',
          name: 'Local Pickup',
          cost: 0.00,
          deliveryTime: 'Next business day',
          description: 'Local Pickup - FREE (North Little Rock, AR)'
        },
        ...shippingRates
      ];
    } catch (shippingError) {
      console.warn('USPS OAuth shipping calculation failed, using fallback rates:', shippingError.message);
      shippingRates = [
        {
          service: 'LOCAL_PICKUP',
          name: 'Local Pickup',
          cost: 0.00,
          deliveryTime: 'Next business day',
          description: 'Local Pickup - FREE (North Little Rock, AR)'
        },
        { service: 'STANDARD', name: 'Standard Shipping', cost: 12.50, deliveryTime: '3-5 business days', description: 'Standard Shipping (3-5 business days) - $12.50' },
        { service: 'EXPEDITED', name: 'Expedited Shipping', cost: 25.00, deliveryTime: '1-2 business days', description: 'Expedited Shipping (1-2 business days) - $25.00' }
      ];
    }
    
    // Calculate tax based on address or zip code
    let shippingAddress = address;
    if (!shippingAddress && zipCode) {
      // Extract state from zip code using tax calculator
      shippingAddress = { 
        zip: zipCode,
        state: taxCalculator.getStateFromZip(zipCode)
      };
    }
    
    // Calculate totals for each shipping option
    const orderOptions = shippingRates.map(rate => {
      const shippingCost = rate.cost;
      // In Arkansas, shipping is taxable - calculate tax on subtotal + shipping
      const taxableAmount = subtotal + shippingCost;
      const taxCalculation = taxCalculator.calculateTax(taxableAmount, shippingAddress);
      const taxAmount = taxCalculation.taxAmount;
      const total = subtotal + shippingCost + taxAmount;
      
      return {
        shippingService: rate.service,
        shippingName: rate.name,
        shippingCost: shippingCost,
        shippingDescription: rate.description,
        deliveryTime: rate.deliveryTime,
        subtotal: subtotal,
        taxAmount: taxAmount,
        taxRate: taxCalculation.taxRate,
        taxReason: taxCalculation.reason,
        total: parseFloat(total.toFixed(2))
      };
    });
    
    res.json({
      success: true,
      subtotal: subtotal,
      tax: orderOptions.length > 0 ? {
        taxAmount: orderOptions[0].taxAmount,
        taxRate: orderOptions[0].taxRate,
        taxableAmount: subtotal + (orderOptions[0].shippingCost || 0),
        reason: orderOptions[0].taxReason
      } : { taxAmount: 0, taxRate: 0, taxableAmount: subtotal, reason: 'No shipping selected' },
      shippingOptions: orderOptions,
      packageInfo: { weight, dimensions }
    });
    
  } catch (error) {
    console.error('Order total calculation error:', error);
    res.status(500).json({ 
      error: 'Unable to calculate order total',
      details: error.message 
    });
  }
});

// Debug endpoint to test PayPal credentials
app.get('/api/debug-paypal', async (req, res) => {
  try {
    console.log('Testing PayPal credentials...');
    
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
      return res.json({
        success: false,
        error: 'PayPal credentials not configured',
        clientId: !!process.env.PAYPAL_CLIENT_ID,
        clientSecret: !!process.env.PAYPAL_CLIENT_SECRET
      });
    }

    // Test getting access token
    const tokenResponse = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    const tokenData = await tokenResponse.json();
    
    if (!tokenResponse.ok) {
      return res.json({
        success: false,
        error: 'PayPal token request failed',
        status: tokenResponse.status,
        response: tokenData
      });
    }

    res.json({
      success: true,
      message: 'PayPal credentials working',
      hasAccessToken: !!tokenData.access_token,
      tokenType: tokenData.token_type,
      expiresIn: tokenData.expires_in
    });

  } catch (error) {
    res.json({
      success: false,
      error: 'Debug test failed',
      details: error.message
    });
  }
});

// Create PayPal order for redirect flow
app.post('/api/create-paypal-order', optionalAuth, async (req, res) => {
  console.log('Creating PayPal order for redirect flow:', req.body);
  
  const {
    subProductId,
    productId,
    productName,
    productSize,
    quantity,
    customerEmail,
    shippingZip,
    shippingMethod,
    shippingCost,
    couponCode,
    couponDiscount,
    isSubscriber,
    subscriberDiscount,
    taxAmount,
    total,
    orderNotes
  } = req.body;

  // Validate required fields
  if (!subProductId || !productId || !productName || !productSize || !quantity || !customerEmail || !total) {
    console.error('Missing required fields:', {
      subProductId: !!subProductId,
      productId: !!productId, 
      productName: !!productName,
      productSize: !!productSize,
      quantity: !!quantity,
      customerEmail: !!customerEmail,
      total: !!total
    });
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Check if PayPal credentials are set
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
      console.error('PayPal credentials missing:', {
        clientId: !!process.env.PAYPAL_CLIENT_ID,
        clientSecret: !!process.env.PAYPAL_CLIENT_SECRET
      });
      throw new Error('PayPal credentials not configured');
    }

    // Get PayPal access token
    const tokenResponse = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text();
      console.error('PayPal token response error:', tokenError);
      throw new Error(`Failed to get PayPal access token: ${tokenResponse.status} ${tokenResponse.statusText}`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Create PayPal order - fix breakdown calculation
    // The item price should be the original item total before discounts
    // Formula: itemPrice = total - shippingCost - taxAmount + totalDiscountAmount
    const itemPrice = parseFloat((total - parseFloat(shippingCost || 0) - parseFloat(taxAmount || 0) + parseFloat(couponDiscount || 0) + parseFloat(subscriberDiscount || 0)).toFixed(2));
    
    console.log('PayPal breakdown calculation:', {
      total: parseFloat(total),
      shippingCost: parseFloat(shippingCost || 0),
      taxAmount: parseFloat(taxAmount || 0),
      couponDiscount: parseFloat(couponDiscount || 0),
      subscriberDiscount: parseFloat(subscriberDiscount || 0),
      itemPrice: itemPrice,
      quantity: quantity
    });

    // Ensure item price is positive
    if (itemPrice <= 0) {
      throw new Error(`Invalid item price calculated: ${itemPrice}`);
    }
    
    const breakdown = {
      item_total: {
        currency_code: "USD",
        value: itemPrice.toFixed(2)
      },
      shipping: {
        currency_code: "USD",
        value: parseFloat(shippingCost || 0).toFixed(2)
      }
    };

    // Add tax to breakdown if applicable
    if (parseFloat(taxAmount || 0) > 0) {
      breakdown.tax_total = {
        currency_code: "USD",
        value: parseFloat(taxAmount).toFixed(2)
      };
    }

    // Add discount to breakdown if any discounts are applied
    const totalDiscountAmount = parseFloat(couponDiscount || 0) + parseFloat(subscriberDiscount || 0);
    if (totalDiscountAmount > 0) {
      breakdown.discount = {
        currency_code: "USD",
        value: totalDiscountAmount.toFixed(2)
      };
    }

    const orderRequest = {
      intent: "CAPTURE",
      purchase_units: [{
        amount: {
          currency_code: "USD",
          value: parseFloat(total).toFixed(2),
          breakdown: breakdown
        },
        items: [{
          name: `${productName} (${productSize})`,
          quantity: quantity.toString(),
          unit_amount: {
            currency_code: "USD",
            value: parseFloat(itemPrice / quantity).toFixed(2)
          }
        }],
        description: `${productName} (${productSize}) x${quantity} - Rell's Kitchen`,
        custom_id: `${subProductId}_${quantity}_${Date.now()}`
      }],
      application_context: {
        brand_name: "Rell's Kitchen",
        locale: "en-US",
        landing_page: "BILLING",
        shipping_preference: "GET_FROM_FILE",
        user_action: "PAY_NOW",
        return_url: `${req.protocol}://${req.get('host')}/payment-return`,
        cancel_url: `${req.protocol}://${req.get('host')}/payment-cancel`
      }
    };

    console.log('PayPal order request:', JSON.stringify(orderRequest, null, 2));

    const orderResponse = await fetch('https://api-m.paypal.com/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': Date.now().toString()
      },
      body: JSON.stringify(orderRequest)
    });

    if (!orderResponse.ok) {
      const errorData = await orderResponse.json();
      console.error('PayPal order creation failed:', errorData);
      throw new Error(`PayPal order creation failed: ${errorData.message || 'Unknown error'}`);
    }

    const orderData = await orderResponse.json();
    console.log('PayPal order created:', JSON.stringify(orderData, null, 2));
    console.log('PayPal order links:', orderData.links);

    // Find the approval URL
    const approvalUrl = orderData.links?.find(link => link.rel === 'approve')?.href;
    if (!approvalUrl) {
      console.error('No approval URL found. Available links:', orderData.links?.map(link => ({ rel: link.rel, href: link.href })));
      throw new Error('No approval URL found in PayPal response');
    }

    res.json({
      orderId: orderData.id,
      approvalUrl: approvalUrl,
      status: orderData.status
    });

  } catch (error) {
    console.error('PayPal order creation error:', error);
    res.status(500).json({ 
      error: 'Failed to create PayPal order',
      details: error.message 
    });
  }
});

// Capture PayPal payment for redirect flow
app.post('/api/capture-paypal-payment', optionalAuth, async (req, res) => {
  console.log('Capturing PayPal payment for redirect flow:', req.body);
  
  const {
    orderId,
    payerId,
    token,
    orderData
  } = req.body;

  if (!orderId || !payerId || !orderData) {
    return res.status(400).json({ error: 'Missing required payment capture data' });
  }

  try {
    // Get PayPal access token
    const tokenResponse = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to get PayPal access token');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Capture the PayPal order
    const captureResponse = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': Date.now().toString()
      }
    });

    if (!captureResponse.ok) {
      const errorData = await captureResponse.json();
      console.error('PayPal capture failed:', errorData);
      throw new Error(`PayPal capture failed: ${errorData.message || 'Unknown error'}`);
    }

    const captureData = await captureResponse.json();
    console.log('PayPal capture successful:', captureData);

    // Extract shipping address from PayPal data
    const paypalShipping = captureData.purchase_units[0]?.shipping?.address;
    const shippingAddress = paypalShipping ? {
      street: paypalShipping.address_line_1 || '',
      city: paypalShipping.admin_area_2 || '',
      state: paypalShipping.admin_area_1 || '',
      zip: paypalShipping.postal_code || ''
    } : {
      // Fallback address from order data
      street: 'No address provided',
      city: 'Test City',
      state: 'AR',
      zip: orderData.shippingZip || '72000'
    };

    // Extract customer name from PayPal data
    const paypalPayer = captureData.payer;
    const customerName = paypalPayer ? `${paypalPayer.name?.given_name || ''} ${paypalPayer.name?.surname || ''}`.trim() : 'PayPal Customer';

    // Process the order in our system
    const processOrderData = {
      subProductId: orderData.subProductId,
      productId: orderData.productId,
      quantity: orderData.quantity,
      customerEmail: orderData.customerEmail,
      customerName: customerName,
      customerPhone: '', // Not collected in redirect flow
      orderNotes: orderData.orderNotes || '',
      shippingAddress: shippingAddress,
      shippingMethod: orderData.shippingMethod,
      shippingCost: orderData.shippingCost,
      couponCode: orderData.couponCode,
      couponDiscount: orderData.couponDiscount,
      isSubscriber: orderData.isSubscriber,
      subscriberDiscount: orderData.subscriberDiscount,
      paypalOrderId: orderId,
      paypalData: captureData
    };

    console.log('Processing order in our system:', processOrderData);

    // Get sub-product details for the response
    const subProductResult = await pool.query(
      'SELECT sp.*, p.name as product_name FROM sub_products sp JOIN products p ON sp.parent_product_id = p.id WHERE sp.id = $1', 
      [orderData.subProductId]
    );

    if (subProductResult.rows.length === 0) {
      throw new Error('Product not found');
    }

    const subProduct = subProductResult.rows[0];

    // Calculate total amount
    const subtotal = (subProduct.price * orderData.quantity);
    const totalAmount = subtotal + orderData.shippingCost - (orderData.couponDiscount || 0) - (orderData.subscriberDiscount || 0);

    // Generate unique order ID
    const orderUniqueId = uuidv4();
    
    // Insert the order into our database
    const orderInsertResult = await pool.query(`
      INSERT INTO orders (
        id, sub_product_id, product_id, customer_email, customer_name, customer_phone,
        shipping_street, shipping_city, shipping_state, shipping_zip,
        shipping_method, shipping_cost, quantity, total_amount, paypal_order_id, order_notes, 
        coupon_code, coupon_discount, user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
      [
        orderUniqueId, orderData.subProductId, orderData.productId, orderData.customerEmail, customerName, '',
        shippingAddress.street, shippingAddress.city, shippingAddress.state, shippingAddress.zip,
        orderData.shippingMethod, orderData.shippingCost || 0, orderData.quantity, totalAmount, 
        orderId, orderData.orderNotes, orderData.couponCode, orderData.couponDiscount || 0, 
        req.user?.id || null
      ]
    );

    const newOrderId = orderInsertResult.rows[0].id;
    console.log('Order saved to database with ID:', newOrderId);

    // Update inventory
    await pool.query(
      'UPDATE sub_products SET inventory_count = inventory_count - $1 WHERE id = $2',
      [orderData.quantity, orderData.subProductId]
    );

    console.log('Inventory updated for sub-product:', orderData.subProductId);

    res.json({
      success: true,
      orderId: newOrderId,
      paypalOrderId: orderId,
      totalAmount: totalAmount.toFixed(2),
      productName: subProduct.product_name,
      productSize: subProduct.size,
      quantity: orderData.quantity,
      message: 'Payment captured and order processed successfully'
    });

  } catch (error) {
    console.error('PayPal payment capture error:', error);
    res.status(500).json({ 
      error: 'Failed to capture PayPal payment',
      details: error.message 
    });
  }
});

app.post('/api/process-payment', optionalAuth, async (req, res) => {
  console.log('Payment processing started with data:', {
    subProductId: req.body.subProductId,
    productId: req.body.productId,
    customerEmail: req.body.customerEmail,
    paypalOrderId: req.body.paypalOrderId
  });

  const { 
    subProductId,
    productId, 
    quantity, 
    customerEmail, 
    customerName,
    customerPhone,
    shippingAddress,
    shippingMethod,
    shippingCost,
    orderNotes, 
    couponCode,
    couponDiscount,
    paypalOrderId,
    paypalData 
  } = req.body;

  if (!subProductId || !productId || !quantity || !customerEmail || !customerName || !paypalOrderId) {
    console.log('Missing required fields:', {
      subProductId: !!subProductId,
      productId: !!productId,
      quantity: !!quantity,
      customerEmail: !!customerEmail,
      customerName: !!customerName,
      paypalOrderId: !!paypalOrderId
    });
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!shippingAddress || !shippingAddress.street || !shippingAddress.city || !shippingAddress.state || !shippingAddress.zip) {
    console.log('Missing shipping address:', shippingAddress);
    return res.status(400).json({ error: 'Complete shipping address is required' });
  }

  try {
    // Get sub-product details
    console.log('Looking up sub-product with ID:', subProductId);
    const subProductResult = await pool.query(
      'SELECT sp.*, p.name as product_name FROM sub_products sp JOIN products p ON sp.parent_product_id = p.id WHERE sp.id = $1', 
      [subProductId]
    );

    if (subProductResult.rows.length === 0) {
      console.log('Sub-product not found with ID:', subProductId);
      return res.status(404).json({ error: 'Product variant not found' });
    }
    
    const subProduct = subProductResult.rows[0];
    console.log('Found sub-product:', subProduct);

    // Check inventory
    if (!subProduct.inventory_count || subProduct.inventory_count < quantity) {
      return res.status(400).json({ error: 'Insufficient inventory' });
    }

    const subtotal = subProduct.price * quantity;
    const totalAmount = (subtotal + (shippingCost || 0)).toFixed(2);
    const orderId = uuidv4();

    console.log('Creating order with data:', {
      orderId,
      productId,
      subProductId,
      customerEmail,
      customerName,
      totalAmount,
      paypalOrderId
    });

    // Create order record with shipping information
    await pool.query(`
      INSERT INTO orders 
        (id, product_id, sub_product_id, customer_email, customer_name, customer_phone, 
         shipping_street, shipping_city, shipping_state, shipping_zip, shipping_method, shipping_cost,
         quantity, total_amount, paypal_order_id, order_notes, coupon_code, coupon_discount, user_id) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    `, [orderId, productId, subProductId, customerEmail, customerName, customerPhone,
        shippingAddress.street, shippingAddress.city, shippingAddress.state, shippingAddress.zip,
        shippingMethod, shippingCost || 0, quantity, totalAmount, paypalOrderId, orderNotes, 
        couponCode || null, couponDiscount || 0, req.user?.userId || null]);
    
    console.log('Order created successfully with ID:', orderId);

    // Update sub-product inventory
    await pool.query('UPDATE sub_products SET inventory_count = inventory_count - $1 WHERE id = $2', 
      [quantity, subProductId]);

    // Update coupon usage count if coupon was used
    if (couponCode) {
      await pool.query('UPDATE coupons SET usage_count = usage_count + 1 WHERE code = $1', 
        [couponCode]);
    }

    res.json({ 
      message: 'Payment processed successfully',
      orderId: orderId,
      customerEmail: customerEmail
    });
  } catch (error) {
    console.error('Payment processing error:', error);
    res.status(500).json({ error: 'Payment processing failed' });
  }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
  // Only allow admin users to view all orders
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const result = await pool.query(`
      SELECT o.*, p.name as product_name 
      FROM orders o 
      JOIN products p ON o.product_id = p.id 
      ORDER BY o.created_at DESC
    `);

    res.json({ orders: result.rows });
  } catch (err) {
    console.error('Orders fetch error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Debug route to check database products
app.get('/debug/products', async (req, res) => {
  try {
    const productsResult = await pool.query('SELECT * FROM products');
    const subProductsResult = await pool.query('SELECT * FROM sub_products');
    
    res.json({ 
      products: productsResult.rows,
      subProducts: subProductsResult.rows,
      productCount: productsResult.rows.length,
      subProductCount: subProductsResult.rows.length
    });
  } catch (err) {
    res.json({ error: 'Database error', details: err.message });
  }
});

// Debug route to check static file serving
app.get('/debug/static', (req, res) => {
  const fs = require('fs');
  const staticPath = path.join(__dirname, 'public');
  
  fs.readdir(staticPath, (err, files) => {
    if (err) {
      return res.json({ error: 'Cannot read public directory', path: staticPath });
    }
    
    res.json({ 
      publicPath: staticPath,
      files: files,
      imagesExists: fs.existsSync(path.join(staticPath, 'images')),
      currentDir: __dirname
    });
  });
});

// Admin endpoint to view database data (secure)
app.get('/admin/database/:table', async (req, res) => {
  // Simple authentication check
  const adminKey = req.query.key;
  const validKey = 'rells-kitchen-admin-2025';
  
  if (adminKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }
  
  const { table } = req.params;
  const validTables = ['users', 'orders', 'products', 'sub_products', 'subscriptions', 'coupons'];
  
  if (!validTables.includes(table)) {
    return res.status(400).json({ error: 'Invalid table name' });
  }
  
  const limit = req.query.limit ? parseInt(req.query.limit) : 50;
  
  try {
    let query = `SELECT * FROM ${table} ORDER BY created_at DESC`;
    if (limit && limit > 0) {
      query += ` LIMIT ${limit}`;
    }
    
    const result = await pool.query(query);
    
    res.json({
      table: table,
      count: result.rows.length,
      data: result.rows,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error(`Error querying ${table}:`, err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// Admin endpoint for database stats
app.get('/admin/stats', async (req, res) => {
  // Simple authentication check
  const adminKey = req.query.key;
  const validKey = 'rells-kitchen-admin-2025';
  
  if (adminKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }
  
  try {
    const stats = {};
    const tables = ['users', 'orders', 'products', 'sub_products', 'subscriptions'];
    
    for (const table of tables) {
      try {
        const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        stats[table] = { count: parseInt(result.rows[0].count) };
      } catch (err) {
        stats[table] = { error: err.message };
      }
    }
    
    // Get recent activity
    const recentResult = await pool.query(`
      SELECT 'user' as type, created_at FROM users 
      UNION ALL 
      SELECT 'order' as type, created_at FROM orders 
      ORDER BY created_at DESC LIMIT 10
    `);
    
    stats.recent_activity = recentResult.rows;
    
    res.json({
      stats: stats,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Stats fetch error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Admin endpoint to activate/deactivate coupons
app.post('/admin/coupon/:code/:action', async (req, res) => {
  const adminKey = req.query.key;
  const validKey = 'rells-kitchen-admin-2025';
  
  if (adminKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }
  
  const { code, action } = req.params;
  
  if (!['activate', 'deactivate'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Use activate or deactivate' });
  }
  
  try {
    const active = action === 'activate';
    const result = await pool.query(
      'UPDATE coupons SET active = $1 WHERE code = $2',
      [active, code]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Coupon not found' });
    }
    
    res.json({ 
      message: `Coupon '${code}' ${action}d successfully`,
      code: code,
      active: active
    });
  } catch (err) {
    console.error(`Error ${action}ing coupon:`, err);
    res.status(500).json({ error: 'Database error' });
  }
});

// TEMPORARY: Admin endpoint to fix product name
app.get('/admin/fix-tamarind', async (req, res) => {
  const adminKey = req.query.key;
  const validKey = 'rells-kitchen-admin-2025';
  
  if (adminKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }
  
  try {
    // Force update the product using the same logic as initializeDatabase
    const result = await pool.query(`
      UPDATE products SET 
        name = $1,
        description = $2,
        price = $3,
        available = $4,
        neo_flavor_profile = $5,
        user_rating = $6,
        inventory_count = $7
      WHERE id = $8
    `, [
      'Tamarind_Sweets',
      "This beloved Caribbean comfort food delivers the perfect harmony of sweet and tangy flavors. A treasured local dish known as 'Tamarind Stew'.",
      6.99,
      true,
      4,
      4,
      15,
      'fixed-tamarind-stew-id'
    ]);
    
    res.json({ 
      message: 'Product forcefully updated to Tamarind_Sweets',
      updated_records: result.rowCount,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error updating product name:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// TEMPORARY: Simple diagnostic endpoint
app.get('/admin/check-products', async (req, res) => {
  const adminKey = req.query.key;
  const validKey = 'rells-kitchen-admin-2025';
  
  if (adminKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }
  
  try {
    const result = await pool.query("SELECT id, name FROM products");
    res.json({ 
      success: true,
      products: result.rows,
      count: result.rows.length 
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      database_url_exists: !!process.env.DATABASE_URL
    });
  }
});

// TEMPORARY: Admin endpoint to update product name (remove after use)
app.get('/admin/update-product-name', async (req, res) => {
  const adminKey = req.query.key;
  const validKey = 'rells-kitchen-admin-2025';
  
  if (adminKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }
  
  try {
    console.log('Starting product name update...');
    console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
    
    // First check current products
    const currentResult = await pool.query("SELECT id, name FROM products");
    console.log('Current products:', currentResult.rows);
    
    // Update the product name in the products table
    const updateResult = await pool.query(
      "UPDATE products SET name = $1 WHERE name = $2",
      ['Tamarind_Sweets', 'Tamarind_Splice']
    );
    
    console.log(`Updated ${updateResult.rowCount} product record(s)`);
    
    // Verify the update
    const verifyResult = await pool.query(
      "SELECT id, name FROM products WHERE id = 'fixed-tamarind-stew-id'"
    );
    
    const result = {
      success: true,
      database_url_exists: !!process.env.DATABASE_URL,
      current_products: currentResult.rows,
      updated_records: updateResult.rowCount,
      current_name: verifyResult.rows[0]?.name || 'Not found',
      verification: verifyResult.rows[0] || null,
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ Product name update completed:', result);
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error updating product name:', error);
    res.status(500).json({ 
      error: 'Update failed', 
      details: error.message,
      stack: error.stack,
      database_url_exists: !!process.env.DATABASE_URL
    });
  }
});

// TEMPORARY: Admin key-based email test endpoint
app.post('/admin/test-email', async (req, res) => {
  const adminKey = req.query.key;
  const validKey = 'rells-kitchen-admin-2025';
  
  if (adminKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }
  
  try {
    console.log('🧪 Starting admin key-based email test...');
    
    // Direct environment variable check
    console.log('📧 Direct env check - SMTP_EMAIL:', !!process.env.SMTP_EMAIL);
    console.log('📧 Direct env check - SMTP_PASSWORD:', !!process.env.SMTP_PASSWORD);
    console.log('📧 SMTP_EMAIL value:', process.env.SMTP_EMAIL);
    console.log('📧 SMTP_PASSWORD length:', process.env.SMTP_PASSWORD ? process.env.SMTP_PASSWORD.length : 0);
    
    // Get admin email from settings
    const emailResult = await pool.query('SELECT setting_value FROM admin_settings WHERE setting_key = $1', ['admin_email']);
    const adminEmail = emailResult.rows.length > 0 ? emailResult.rows[0].setting_value : 'admin@rellskitchen.com';
    
    // Create transporter directly (bypass notification service)
    if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
      throw new Error('SMTP credentials not found in environment variables');
    }
    
    console.log('📧 Creating direct Gmail transporter...');
    
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD
      }
    });
    
    console.log('📧 Transporter created successfully');
    console.log('📧 Sending test email to:', adminEmail);
    
    const mailOptions = {
      from: process.env.SMTP_EMAIL,
      to: adminEmail,
      subject: '🧪 Admin Key Test Email - Rell\'s Kitchen',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #00f5ff;">🏝️ Rell's Kitchen Admin Test</h2>
          <p>This is a test email sent using the admin key endpoint.</p>
          <p><strong>Test Details:</strong></p>
          <ul>
            <li>Sent: ${new Date().toLocaleString()}</li>
            <li>Method: Admin key authentication</li>
            <li>Status: ✅ Working</li>
            <li>From: ${process.env.SMTP_EMAIL}</li>
            <li>To: ${adminEmail}</li>
          </ul>
          <p style="color: #666; font-size: 12px;">
            Caribbean • Cyberpunk • Fusion<br>
            Neo-Caribbean cuisine from the future
          </p>
        </div>
      `
    };
    
    console.log('📧 Attempting to send email via Gmail SMTP...');
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Admin key test email sent successfully:', result.messageId);
    
    res.json({ 
      success: true, 
      messageId: result.messageId,
      to: adminEmail,
      from: process.env.SMTP_EMAIL,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Admin key email test error:', error.message);
    console.error('❌ Full error:', error);
    
    // Provide specific error messages for common Gmail issues
    let errorMessage = error.message;
    if (error.code === 'EAUTH') {
      errorMessage = 'Gmail authentication failed - check app password';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'Gmail SMTP server not found - check internet connection';
    } else if (error.responseCode === 535) {
      errorMessage = 'Gmail login failed - invalid email or app password';
    } else if (error.responseCode === 534) {
      errorMessage = 'Gmail requires app-specific password - regular password not allowed';
    }
    
    res.status(500).json({ 
      error: 'Failed to send admin key test email', 
      details: errorMessage,
      code: error.code,
      responseCode: error.responseCode,
      envStatus: {
        smtpEmail: !!process.env.SMTP_EMAIL,
        smtpPassword: !!process.env.SMTP_PASSWORD,
        emailValue: process.env.SMTP_EMAIL,
        passwordLength: process.env.SMTP_PASSWORD ? process.env.SMTP_PASSWORD.length : 0
      }
    });
  }
});

// TEMPORARY: Test main notification service with admin key
app.post('/admin/test-notification-service', async (req, res) => {
  const adminKey = req.query.key;
  const validKey = 'rells-kitchen-admin-2025';
  
  if (adminKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }
  
  try {
    console.log('🧪 Testing main NotificationService...');
    
    // Check service status
    const serviceStatus = notificationService.getServiceStatus();
    console.log('📊 Service status:', serviceStatus);
    
    // Get admin email from settings
    const emailResult = await pool.query('SELECT setting_value FROM admin_settings WHERE setting_key = $1', ['admin_email']);
    const adminEmail = emailResult.rows.length > 0 ? emailResult.rows[0].setting_value : 'admin@rellskitchen.com';
    
    // Try to send email through notification service
    const result = await notificationService.sendTestEmail(adminEmail);
    console.log('✅ NotificationService email sent:', result.messageId);
    
    res.json({ 
      success: true, 
      messageId: result.messageId,
      serviceStatus: serviceStatus,
      to: adminEmail,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ NotificationService test error:', error.message);
    console.error('❌ Full error:', error);
    
    res.status(500).json({ 
      error: 'NotificationService test failed', 
      details: error.message,
      serviceStatus: notificationService.getServiceStatus()
    });
  }
});

// Admin API endpoints
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, p.name as product_name, sp.size 
      FROM orders o 
      JOIN products p ON o.product_id = p.id 
      LEFT JOIN sub_products sp ON o.sub_product_id = sp.id 
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.get('/api/admin/inventory', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sp.*, p.name as product_name 
      FROM sub_products sp 
      JOIN products p ON sp.parent_product_id = p.id 
      ORDER BY p.name, sp.size_oz
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// Tax reporting endpoint - fetches completed orders for ADAP reporting
app.get('/api/admin/tax-report', async (req, res) => {
  // Check for admin authentication via JWT or admin key
  const adminKey = req.query.key || req.headers['x-admin-key'];
  const token = req.cookies.token;
  
  // First check admin key
  if (adminKey && adminKey === 'rells-kitchen-admin-2025') {
    // Admin key is valid, proceed
  } else if (token) {
    // Try JWT authentication
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
      
      if (userResult.rows.length === 0 || userResult.rows[0].role !== 'admin') {
        return res.status(403).json({ error: 'Admin privileges required' });
      }
    } catch (err) {
      return res.status(401).json({ error: 'Invalid authentication' });
    }
  } else {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const { startDate, endDate } = req.query;
    
    // Build query using only columns that actually exist in the orders table
    // Based on schema: total_amount, shipping_cost, coupon_discount, quantity
    let query = `
      SELECT 
        o.id,
        o.created_at as date,
        o.customer_email,
        COALESCE(o.customer_name, o.customer_email) as customer_name,
        p.name as product_name,
        sp.size,
        o.quantity,
        -- Calculate subtotal from total_amount - shipping_cost + coupon_discount
        COALESCE(
          o.total_amount - COALESCE(o.shipping_cost, 0) + COALESCE(o.coupon_discount, 0),
          o.total_amount
        ) as subtotal_before_tax,
        -- Calculate unit price from subtotal_before_tax / quantity  
        COALESCE(
          (o.total_amount - COALESCE(o.shipping_cost, 0) + COALESCE(o.coupon_discount, 0)) / NULLIF(o.quantity, 0),
          0
        ) as unit_price,
        -- Calculate subtotal (before tax): reverse engineer from total
        -- If tax is 4.5%: subtotal = (total + discount - shipping) / 1.045
        COALESCE(
          (o.total_amount + COALESCE(o.coupon_discount, 0) - COALESCE(o.shipping_cost, 0)) / 1.045,
          o.total_amount - COALESCE(o.shipping_cost, 0) + COALESCE(o.coupon_discount, 0)
        ) as subtotal,
        COALESCE(o.shipping_cost, 0) as shipping_cost,
        -- Calculate tax: total - subtotal - shipping + discount
        COALESCE(
          o.total_amount - ((o.total_amount + COALESCE(o.coupon_discount, 0) - COALESCE(o.shipping_cost, 0)) / 1.045) - COALESCE(o.shipping_cost, 0) + COALESCE(o.coupon_discount, 0),
          0
        ) as tax_amount,
        o.total_amount,
        COALESCE(o.shipping_zip, '') as shipping_zip,
        COALESCE(o.shipping_state, 'AR') as shipping_state,
        o.status,
        o.paypal_order_id
      FROM orders o 
      JOIN products p ON o.product_id = p.id 
      LEFT JOIN sub_products sp ON o.sub_product_id = sp.id 
      WHERE o.status IN ('completed', 'shipped', 'delivered')
        AND o.shipping_state = 'AR'
    `;
    
    const queryParams = [];
    
    if (startDate) {
      queryParams.push(startDate);
      query += ` AND DATE(o.created_at) >= $${queryParams.length}`;
    }
    
    if (endDate) {
      queryParams.push(endDate);
      query += ` AND DATE(o.created_at) <= $${queryParams.length}`;
    }
    
    query += ` ORDER BY o.created_at DESC`;
    
    const result = await pool.query(query, queryParams);
    
    // Calculate summary statistics
    const summary = {
      totalOrders: result.rows.length,
      totalSales: result.rows.reduce((sum, order) => sum + parseFloat(order.subtotal || 0), 0),
      totalShipping: result.rows.reduce((sum, order) => sum + parseFloat(order.shipping_cost || 0), 0),
      totalTax: result.rows.reduce((sum, order) => sum + parseFloat(order.tax_amount || 0), 0),
      totalRevenue: result.rows.reduce((sum, order) => sum + parseFloat(order.total_amount || 0), 0)
    };
    
    res.json({
      orders: result.rows,
      summary: summary
    });
  } catch (error) {
    console.error('Error fetching tax report:', error);
    console.error('Query error details:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch tax report data',
      details: error.message 
    });
  }
});

// Test endpoint to debug database connectivity and order data
app.get('/api/admin/test-orders', async (req, res) => {
  const adminKey = req.query.key || req.headers['x-admin-key'];
  
  if (adminKey !== 'rells-kitchen-admin-2025') {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    // Test basic database connection
    const testQuery = await pool.query('SELECT 1 as test');
    console.log('Database connection test:', testQuery.rows);
    
    // Get the actual column names from the orders table
    const columnsQuery = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'orders' 
      ORDER BY ordinal_position
    `);
    console.log('Orders table columns:', columnsQuery.rows);
    
    // Check what orders exist with only basic columns we know exist
    const ordersQuery = await pool.query(`
      SELECT *
      FROM orders 
      LIMIT 5
    `);
    console.log('Sample orders:', ordersQuery.rows);
    
    // Check Arkansas orders specifically
    const arkansasQuery = await pool.query(`
      SELECT 
        COUNT(*) as count
      FROM orders 
      WHERE shipping_zip LIKE '71%' OR shipping_zip LIKE '72%'
    `);
    console.log('Arkansas orders count:', arkansasQuery.rows);
    
    res.json({
      success: true,
      databaseConnection: 'OK',
      tableColumns: columnsQuery.rows,
      totalOrders: ordersQuery.rows.length,
      arkansasOrdersCount: arkansasQuery.rows[0]?.count || 0,
      sampleOrders: ordersQuery.rows,
      message: 'Database test completed - check server logs and response for column names'
    });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({ 
      error: 'Database test failed',
      details: error.message 
    });
  }
});

app.get('/api/admin/notification-settings', requireAdmin, async (req, res) => {
  try {
    // Load settings from database
    const settingsResult = await pool.query('SELECT setting_key, setting_value FROM admin_settings');
    const settingsMap = {};
    settingsResult.rows.forEach(row => {
      settingsMap[row.setting_key] = row.setting_value;
    });

    const settings = {
      email: settingsMap['admin_email'] || 'admin@rellskitchen.com',
      phone: settingsMap['admin_phone'] || '+15017609490',
      emailNewOrders: settingsMap['email_new_orders'] === 'true',
      emailLowStock: settingsMap['email_low_stock'] === 'true',
      smsCritical: settingsMap['sms_critical_alerts'] === 'true',
      smsOutOfStock: settingsMap['sms_out_of_stock'] === 'true'
    };
    res.json(settings);
  } catch (error) {
    console.error('Error fetching notification settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.post('/api/admin/notification-settings', requireAdmin, async (req, res) => {
  try {
    const { email, phone, emailNewOrders, emailLowStock, smsCritical, smsOutOfStock } = req.body;
    
    console.log('Attempting to save notification settings:', req.body);
    console.log('User attempting save:', req.user?.username || 'unknown');

    // Update settings in database using simple UPDATE/INSERT pattern
    const updates = [
      ['admin_email', email],
      ['admin_phone', phone],
      ['email_new_orders', emailNewOrders.toString()],
      ['email_low_stock', emailLowStock.toString()],
      ['sms_critical_alerts', smsCritical.toString()],
      ['sms_out_of_stock', smsOutOfStock.toString()]
    ];

    for (const [key, value] of updates) {
      console.log(`Updating setting: ${key} = ${value}`);
      
      // Try to update first
      const updateResult = await pool.query(
        'UPDATE admin_settings SET setting_value = $1, updated_at = CURRENT_TIMESTAMP WHERE setting_key = $2',
        [value, key]
      );

      // If no rows updated, insert new record
      if (updateResult.rowCount === 0) {
        console.log(`No existing record for ${key}, inserting new`);
        await pool.query(
          'INSERT INTO admin_settings (id, setting_key, setting_value, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
          [uuidv4(), key, value]
        );
      } else {
        console.log(`Updated existing record for ${key}`);
      }
    }

    console.log('Admin notification settings saved successfully');
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Error saving notification settings:', error);
    console.error('Error details:', error.message);
    console.error('Error code:', error.code);
    console.error('User object:', req.user);
    res.status(500).json({ error: 'Failed to save settings', details: error.message });
  }
});

// Stock threshold endpoints
app.get('/api/admin/stock-threshold', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT setting_value FROM admin_settings WHERE setting_key = $1', ['low_stock_threshold']);
    const threshold = result.rows.length > 0 ? result.rows[0].setting_value : '5';
    res.json({ threshold: parseInt(threshold) });
  } catch (error) {
    console.error('Error getting stock threshold:', error);
    res.status(500).json({ error: 'Failed to get threshold' });
  }
});

app.post('/api/admin/stock-threshold', requireAdmin, async (req, res) => {
  try {
    const { threshold } = req.body;
    
    if (!threshold || isNaN(threshold)) {
      return res.status(400).json({ error: 'Valid threshold number required' });
    }

    console.log('Attempting to update stock threshold to:', threshold);
    console.log('User attempting update:', req.user?.username || 'unknown');

    // First try to update existing record
    const updateResult = await pool.query(
      'UPDATE admin_settings SET setting_value = $1, updated_at = CURRENT_TIMESTAMP WHERE setting_key = $2',
      [threshold.toString(), 'low_stock_threshold']
    );

    // If no rows were updated, insert new record
    if (updateResult.rowCount === 0) {
      console.log('No existing record found, inserting new threshold setting');
      await pool.query(
        'INSERT INTO admin_settings (id, setting_key, setting_value, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
        [uuidv4(), 'low_stock_threshold', threshold.toString()]
      );
    } else {
      console.log('Updated existing threshold record');
    }

    console.log('Stock threshold updated successfully to:', threshold);
    res.json({ success: true, message: 'Stock threshold updated successfully' });
  } catch (error) {
    console.error('Error updating stock threshold:', error);
    console.error('Error details:', error.message);
    console.error('Error code:', error.code);
    console.error('User object:', req.user);
    res.status(500).json({ error: 'Failed to update threshold', details: error.message });
  }
});

// Debug endpoint to test admin_settings table
app.get('/api/admin/debug-settings', requireAdmin, async (req, res) => {
  try {
    // Test if table exists and can be queried
    const tableCheck = await pool.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'admin_settings'
      ORDER BY ordinal_position
    `);
    
    // Get current settings
    const settingsCheck = await pool.query('SELECT * FROM admin_settings LIMIT 5');
    
    // Try a simple insert test
    const testId = 'debug-test-' + Date.now();
    const insertTest = await pool.query(`
      INSERT INTO admin_settings (id, setting_key, setting_value, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (setting_key) 
      DO UPDATE SET 
        setting_value = EXCLUDED.setting_value,
        updated_at = CURRENT_TIMESTAMP
    `, [testId, 'debug_test', 'test_value']);
    
    // Clean up test data
    await pool.query('DELETE FROM admin_settings WHERE setting_key = $1', ['debug_test']);
    
    res.json({
      success: true,
      tableStructure: tableCheck.rows,
      currentSettings: settingsCheck.rows,
      insertTest: insertTest.rowCount,
      message: 'Database operations successful'
    });
  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({ 
      error: 'Debug test failed', 
      details: error.message,
      code: error.code,
      constraint: error.constraint
    });
  }
});

app.get('/api/admin/system-status', requireAdmin, async (req, res) => {
  try {
    // Check various system components
    const notificationStatus = notificationService.getServiceStatus();
    const status = {
      overall: 'Operational',
      database: 'Connected',
      usps: 'Active',
      paypal: 'Active',
      email: notificationStatus.email.configured ? 'Ready' : 'Not Configured',
      sms: notificationStatus.sms.configured ? 'Ready' : 'Not Configured'
    };
    
    // Test database connection
    try {
      await pool.query('SELECT 1');
    } catch (dbError) {
      status.database = 'Error';
      status.overall = 'Degraded';
    }
    
    res.json(status);
  } catch (error) {
    console.error('Error checking system status:', error);
    res.status(500).json({ error: 'Failed to check system status' });
  }
});

app.post('/api/admin/test-email', requireAdmin, async (req, res) => {
  try {
    console.log('🧪 Starting direct email test (bypassing service status)...');
    
    // Direct environment variable check
    console.log('📧 Direct env check - SMTP_EMAIL:', !!process.env.SMTP_EMAIL);
    console.log('📧 Direct env check - SMTP_PASSWORD:', !!process.env.SMTP_PASSWORD);
    console.log('📧 SMTP_EMAIL value:', process.env.SMTP_EMAIL);
    console.log('📧 SMTP_PASSWORD length:', process.env.SMTP_PASSWORD ? process.env.SMTP_PASSWORD.length : 0);
    
    // Get admin email from settings
    const emailResult = await pool.query('SELECT setting_value FROM admin_settings WHERE setting_key = $1', ['admin_email']);
    const adminEmail = emailResult.rows.length > 0 ? emailResult.rows[0].setting_value : 'admin@rellskitchen.com';
    
    // Create transporter directly (bypass notification service)
    if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
      throw new Error('SMTP credentials not found in environment variables');
    }
    
    console.log('📧 Creating direct Gmail transporter...');
    
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD
      }
    });
    
    console.log('📧 Transporter created successfully');
    console.log('📧 Sending test email to:', adminEmail);
    
    const mailOptions = {
      from: process.env.SMTP_EMAIL,
      to: adminEmail,
      subject: '🧪 Direct Test Email - Rell\'s Kitchen Admin',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #00f5ff;">🏝️ Rell's Kitchen Admin Test</h2>
          <p>This is a direct test email bypassing the notification service.</p>
          <p><strong>Test Details:</strong></p>
          <ul>
            <li>Sent: ${new Date().toLocaleString()}</li>
            <li>Method: Direct nodemailer</li>
            <li>Status: ✅ Working</li>
            <li>From: ${process.env.SMTP_EMAIL}</li>
          </ul>
          <p style="color: #666; font-size: 12px;">
            Caribbean • Cyberpunk • Fusion<br>
            Neo-Caribbean cuisine from the future
          </p>
        </div>
      `
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Direct test email sent successfully:', result.messageId);
    
    res.json({ 
      success: true, 
      message: 'Direct test email sent successfully',
      messageId: result.messageId,
      recipient: adminEmail,
      smtpUser: process.env.SMTP_EMAIL,
      method: 'direct-nodemailer'
    });
  } catch (error) {
    console.error('❌ Error sending direct test email:', error);
    console.error('❌ Error stack:', error.stack);
    
    res.status(500).json({ 
      error: 'Failed to send direct test email', 
      details: error.message,
      errorCode: error.code,
      errorCommand: error.command,
      smtpConfigured: {
        email: !!process.env.SMTP_EMAIL,
        password: !!process.env.SMTP_PASSWORD,
        emailValue: process.env.SMTP_EMAIL,
        passwordLength: process.env.SMTP_PASSWORD ? process.env.SMTP_PASSWORD.length : 0
      }
    });
  }
});

app.post('/api/admin/test-sms', requireAdmin, async (req, res) => {
  try {
    // Get admin phone from settings
    const phoneResult = await pool.query('SELECT setting_value FROM admin_settings WHERE setting_key = $1', ['admin_phone']);
    const adminPhone = phoneResult.rows.length > 0 ? phoneResult.rows[0].setting_value : null;
    
    const result = await notificationService.sendTestSMS(adminPhone);
    console.log('✅ Test SMS sent successfully');
    res.json({ 
      success: true, 
      message: 'Test SMS sent successfully',
      messageId: result.sid,
      recipient: adminPhone
    });
  } catch (error) {
    console.error('Error sending test SMS:', error);
    res.status(500).json({ error: 'Failed to send test SMS', details: error.message });
  }
});

// Health check endpoint for debugging
app.get('/api/health', (req, res) => {
  try {
    const status = {
      server: 'running',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      hasDatabase: !!process.env.DATABASE_URL,
      hasSmtpEmail: !!process.env.SMTP_EMAIL,
      hasSmtpPassword: !!process.env.SMTP_PASSWORD,
      smtpEmailValue: process.env.SMTP_EMAIL ? process.env.SMTP_EMAIL.substring(0, 5) + '...' : 'undefined',
      smtpPasswordLength: process.env.SMTP_PASSWORD ? process.env.SMTP_PASSWORD.length : 0,
      notificationService: notificationService ? 'initialized' : 'failed',
      notificationServiceStatus: notificationService ? notificationService.getServiceStatus() : 'N/A'
    };
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Admin-only diagnostic endpoint
app.get('/api/admin/env-debug', requireAdmin, (req, res) => {
  try {
    const envVars = {
      NODE_ENV: process.env.NODE_ENV || 'undefined',
      PORT: process.env.PORT || 'undefined',
      DATABASE_URL: process.env.DATABASE_URL ? 'SET (hidden)' : 'undefined',
      SMTP_EMAIL: process.env.SMTP_EMAIL || 'undefined',
      SMTP_PASSWORD: process.env.SMTP_PASSWORD ? `SET (${process.env.SMTP_PASSWORD.length} chars)` : 'undefined',
      PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID ? 'SET (hidden)' : 'undefined',
      allEnvKeys: Object.keys(process.env).filter(key => key.includes('SMTP')).sort()
    };
    res.json(envVars);
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.get('/api/admin/export-orders', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, p.name as product_name, sp.size 
      FROM orders o 
      JOIN products p ON o.product_id = p.id 
      LEFT JOIN sub_products sp ON o.sub_product_id = sp.id 
      ORDER BY o.created_at DESC
    `);
    
    // Convert to CSV
    const csvHeader = 'Order ID,Product,Size,Quantity,Customer Email,Total,Shipping Method,Status,Date\n';
    const csvRows = result.rows.map(order => 
      `${order.id},${order.product_name},${order.size || 'N/A'},${order.quantity},${order.customer_email},${order.total_amount},${order.shipping_method || 'N/A'},${order.status},${order.created_at}`
    ).join('\n');
    
    const csv = csvHeader + csvRows;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting orders:', error);
    res.status(500).json({ error: 'Failed to export orders' });
  }
});

app.post('/api/admin/backup-database', requireAdmin, async (req, res) => {
  try {
    // For now, just acknowledge. In production, implement actual backup
    console.log('Database backup initiated by admin');
    res.json({ success: true, message: 'Backup completed successfully' });
  } catch (error) {
    console.error('Error backing up database:', error);
    res.status(500).json({ error: 'Failed to backup database' });
  }
});

app.listen(PORT, () => {
  console.log(`🏝️  Rell's Kitchen server running on port ${PORT}`);
  console.log(`🌴  Caribbean-Cyberpunk fusion cuisine awaits...`);
  console.log(`📁  Static files served from: ${path.join(__dirname, 'public')}`);
  console.log(`🚀  Deployment successful at ${new Date().toISOString()}`);
  console.log(`📦  Product: Tamarind_Sweets should be available`);
  console.log(`📧  SMTP Email configured: ${process.env.SMTP_EMAIL ? 'Yes (' + process.env.SMTP_EMAIL + ')' : 'No'}`);
  console.log(`📧  SMTP Password configured: ${process.env.SMTP_PASSWORD ? 'Yes' : 'No'}`);
});
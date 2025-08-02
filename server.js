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
// const USPSIntegration = require('./usps-integration'); // Old Web Tools API - DEPRECATED
const USPSOAuthIntegration = require('./usps-oauth-integration'); // New OAuth 2.0 API
const TaxCalculator = require('./tax-calculator');

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

// PostgreSQL connection  
console.log('🔍 All environment variables:');
Object.keys(process.env).filter(key => key.includes('DATABASE')).forEach(key => {
  console.log(`🔍 ${key}:`, process.env[key] ? 'SET (length: ' + process.env[key].length + ')' : 'NOT SET');
});

const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
console.log('🔍 Final connection string length:', connectionString ? connectionString.length : 'NONE');

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
  const { code, subtotal } = req.body;
  
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
    
    let discountAmount = 0;
    if (coupon.discount_type === 'percentage') {
      discountAmount = (parseFloat(subtotal) * coupon.discount_value / 100);
    } else if (coupon.discount_type === 'fixed') {
      discountAmount = Math.min(coupon.discount_value, parseFloat(subtotal));
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

app.get('/payment.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
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
    
    res.json({ 
      success: true,
      rates: shippingRates,
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
    } catch (shippingError) {
      console.warn('USPS OAuth shipping calculation failed, using fallback rates:', shippingError.message);
      shippingRates = [
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
    
    const taxCalculation = taxCalculator.calculateTax(subtotal, shippingAddress);
    
    // Calculate totals for each shipping option
    const orderOptions = shippingRates.map(rate => {
      const shippingCost = rate.cost;
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
      tax: taxCalculation,
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

app.listen(PORT, () => {
  console.log(`🏝️  Rell's Kitchen server running on port ${PORT}`);
  console.log(`🌴  Caribbean-Cyberpunk fusion cuisine awaits...`);
  console.log(`📁  Static files served from: ${path.join(__dirname, 'public')}`);
  console.log(`🚀  Deployment successful at ${new Date().toISOString()}`);
  console.log(`📦  Product: Tamarind_Sweets should be available`);
});
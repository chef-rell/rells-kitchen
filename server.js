const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { initializeDatabase } = require('./init-database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'rells_kitchen_secret_key_2024';

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
  etag: false
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

const db = new sqlite3.Database('./rells_kitchen.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(10,2),
    available BOOLEAN DEFAULT 1,
    neo_flavor_profile INTEGER DEFAULT 1,
    user_rating INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Add inventory_count column if it doesn't exist
  db.run(`ALTER TABLE products ADD COLUMN inventory_count INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding inventory_count column:', err);
    }
  });

  // Create sub_products table for different sizes
  db.run(`CREATE TABLE IF NOT EXISTS sub_products (
    id TEXT PRIMARY KEY,
    parent_product_id TEXT NOT NULL,
    size TEXT NOT NULL,
    size_oz INTEGER NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    inventory_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_product_id) REFERENCES products (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    product_id TEXT,
    quantity INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending',
    pickup_date DATE,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (product_id) REFERENCES products (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    ingredients TEXT NOT NULL,
    instructions TEXT NOT NULL,
    spice_level INTEGER DEFAULT 1,
    prep_time INTEGER,
    author TEXT DEFAULT 'Rell',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    discount_type TEXT NOT NULL,
    discount_value DECIMAL(10,2) NOT NULL,
    active BOOLEAN DEFAULT 1,
    usage_limit INTEGER DEFAULT -1,
    usage_count INTEGER DEFAULT 0,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default coupon
  db.run(`INSERT OR IGNORE INTO coupons (id, code, discount_type, discount_value, active, usage_limit) 
          VALUES (?, ?, ?, ?, ?, ?)`, 
    [uuidv4(), 'family', 'percentage', 25, 1, -1]);

  // Create subscriptions table
  db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    paypal_subscription_id TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'active',
    plan_id TEXT DEFAULT 'P-7JA37658E8258991HNCEYJMQ',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    next_billing_date DATETIME,
    billing_cycles_completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`);

  // Add new user profile columns if they don't exist
  const userColumns = [
    'first_name TEXT',
    'last_name TEXT', 
    'phone TEXT',
    'address_street TEXT',
    'address_city TEXT',
    'address_state TEXT',
    'address_zip TEXT',
    'birth_month TEXT'
  ];
  
  userColumns.forEach(column => {
    const columnName = column.split(' ')[0];
    db.run(`ALTER TABLE users ADD COLUMN ${column}`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error(`Error adding ${columnName} column:`, err);
      }
    });
  });

  // Fix existing subscriptions with NULL next_billing_date
  db.run(`UPDATE subscriptions 
          SET next_billing_date = datetime(started_at, '+1 month') 
          WHERE next_billing_date IS NULL`, (err) => {
    if (err) {
      console.error('Error fixing subscription billing dates:', err);
    } else {
      console.log('Fixed subscription billing dates for existing subscriptions');
    }
  });

  // Add user_id column to orders table for better order tracking
  db.run(`ALTER TABLE orders ADD COLUMN user_id TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding user_id column to orders:', err);
    }
  });

  // Initialize products and sub-products if they don't exist
  db.get('SELECT COUNT(*) as count FROM products', (err, row) => {
    if (!err && row.count === 0) {
      console.log('Initializing database with products...');
      setTimeout(() => {
        initializeDatabase();
      }, 1000);
    }
  });

});

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

app.post('/api/register', (req, res) => {
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

  db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, email], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (row) return res.status(400).json({ error: 'Username or email already exists' });

    bcrypt.hash(password, 12, (err, hash) => {
      if (err) return res.status(500).json({ error: 'Password hashing failed' });

      const userId = uuidv4();
      db.run(`INSERT INTO users (
        id, username, email, password, first_name, last_name, phone, 
        address_street, address_city, address_state, address_zip, birth_month
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [userId, username, email, hash, firstName, lastName, phone, 
         addressStreet, addressCity, addressState, addressZip, birthMonth], function(err) {
        if (err) return res.status(500).json({ error: 'User creation failed' });

        const token = jwt.sign({ userId, username, role: 'member' }, JWT_SECRET, { expiresIn: '7d' });
        
        res.cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({ message: 'Registration successful', user: { id: userId, username, role: 'member' } });
      });
    });
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    bcrypt.compare(password, user.password, (err, match) => {
      if (err) return res.status(500).json({ error: 'Authentication error' });
      if (!match) return res.status(401).json({ error: 'Invalid credentials' });

      const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
      
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.json({ message: 'Login successful', user: { id: user.id, username: user.username, role: user.role } });
    });
  });
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

app.get('/api/user', authenticateToken, (req, res) => {
  if (req.user.role === 'guest') {
    return res.json({ user: { id: req.user.userId, username: 'guest', role: 'guest' } });
  }

  db.get(`SELECT 
    id, username, email, role, preferences, first_name, last_name, phone,
    address_street, address_city, address_state, address_zip, birth_month, created_at
    FROM users WHERE id = ?`, [req.user.userId], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check subscription status
    db.get('SELECT * FROM subscriptions WHERE user_id = ? AND status = "active"', [req.user.userId], (err, subscription) => {
      if (err) console.error('Error checking subscription:', err);
      
      const userData = { 
        ...user, 
        preferences: JSON.parse(user.preferences || '{}'),
        subscription: subscription || null,
        isSubscribed: !!subscription,
        supporterDiscount: subscription ? 5 : 0
      };
      
      res.json({ user: userData });
    });
  });
});

app.get('/api/products', optionalAuth, (req, res) => {
  db.all('SELECT * FROM products WHERE available = 1 ORDER BY name', (err, products) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ products });
  });
});

app.get('/api/sub-products/:productId', (req, res) => {
  const { productId } = req.params;
  
  console.log('Sub-products API called with productId:', productId);
  
  db.all('SELECT * FROM sub_products WHERE parent_product_id = ? ORDER BY size_oz', [productId], (err, subProducts) => {
    if (err) {
      console.error('Sub-products database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    console.log('Found sub-products:', subProducts.length, 'items');
    res.json({ subProducts });
  });
});

app.post('/api/validate-coupon', optionalAuth, (req, res) => {
  const { code, subtotal } = req.body;
  
  if (!code || !subtotal) {
    return res.status(400).json({ error: 'Coupon code and subtotal required' });
  }
  
  
  db.get(`SELECT * FROM coupons WHERE code = ? AND active = 1 
          AND (expires_at IS NULL OR expires_at > datetime('now'))
          AND (usage_limit = -1 OR usage_count < usage_limit)`, 
    [code.toLowerCase()], (err, coupon) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    
    if (!coupon) {
      return res.status(404).json({ error: 'Invalid or expired coupon code' });
    }
    
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
  });
});

app.post('/api/reservations', authenticateToken, (req, res) => {
  const { productId, quantity = 1, pickupDate, notes } = req.body;

  if (!productId) {
    return res.status(400).json({ error: 'Product ID required' });
  }

  const reservationId = uuidv4();
  db.run('INSERT INTO reservations (id, user_id, product_id, quantity, pickup_date, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [reservationId, req.user.userId, productId, quantity, pickupDate, notes], function(err) {
    if (err) return res.status(500).json({ error: 'Reservation failed' });

    res.json({ message: 'Reservation created successfully', reservationId });
  });
});

app.get('/api/reservations', authenticateToken, (req, res) => {
  if (req.user.role === 'guest') {
    return res.json({ reservations: [] });
  }

  db.all(`
    SELECT r.*, p.name as product_name, p.price 
    FROM reservations r 
    JOIN products p ON r.product_id = p.id 
    WHERE r.user_id = ? 
    ORDER BY r.created_at DESC
  `, [req.user.userId], (err, reservations) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ reservations });
  });
});

// Cookbook functionality disabled
// app.get('/api/cookbook', authenticateToken, (req, res) => {
//   if (req.user.role === 'guest') {
//     return res.status(403).json({ error: 'Member access required for cookbook' });
//   }

//   db.all('SELECT * FROM recipes ORDER BY created_at DESC', (err, recipes) => {
//     if (err) return res.status(500).json({ error: 'Database error' });
//     res.json({ recipes });
//   });
// });

// Utility route to create PayPal subscription plan (run once)
app.post('/api/create-subscription-plan', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const fetch = require('node-fetch');
    
    // Get PayPal access token
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    
    const tokenResponse = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
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
    const productResponse = await fetch('https://api-m.sandbox.paypal.com/v1/catalogs/products', {
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
    const planResponse = await fetch('https://api-m.sandbox.paypal.com/v1/billing/plans', {
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
app.post('/api/subscribe', authenticateToken, (req, res) => {
  if (req.user.role === 'guest') {
    return res.status(403).json({ error: 'Member account required for subscription' });
  }

  const { subscriptionID } = req.body;
  
  if (!subscriptionID) {
    return res.status(400).json({ error: 'PayPal subscription ID required' });
  }

  // Check if user already has an active subscription
  db.get('SELECT * FROM subscriptions WHERE user_id = ? AND status = "active"', [req.user.userId], (err, existingSubscription) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    
    if (existingSubscription) {
      return res.status(400).json({ error: 'You already have an active subscription' });
    }

    const subscriptionId = uuidv4();
    const nextBillingDate = new Date();
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1); // Monthly billing

    db.run(`INSERT INTO subscriptions (
      id, user_id, paypal_subscription_id, status, next_billing_date
    ) VALUES (?, ?, ?, ?, ?)`, 
      [subscriptionId, req.user.userId, subscriptionID, 'active', nextBillingDate.toISOString()], 
      function(err) {
        if (err) return res.status(500).json({ error: 'Subscription creation failed' });
        
        res.json({ 
          message: 'Subscription activated successfully',
          subscriptionId: subscriptionId,
          benefits: {
            discount: '5% site-wide discount',
            samples: 'Monthly 4oz samples of new products',
            earlyAccess: 'Early access to new releases'
          }
        });
      }
    );
  });
});

app.post('/api/cancel-subscription', authenticateToken, (req, res) => {
  if (req.user.role === 'guest') {
    return res.status(403).json({ error: 'Member account required' });
  }

  db.run('UPDATE subscriptions SET status = "cancelled", updated_at = datetime("now") WHERE user_id = ? AND status = "active"', 
    [req.user.userId], function(err) {
    if (err) return res.status(500).json({ error: 'Database error' });
    
    if (this.changes === 0) {
      return res.status(404).json({ error: 'No active subscription found' });
    }
    
    res.json({ message: 'Subscription cancelled successfully' });
  });
});

// Order history route
app.get('/api/order-history', authenticateToken, (req, res) => {
  if (req.user.role === 'guest') {
    return res.json({ orders: [] });
  }

  db.all(`
    SELECT o.*, p.name as product_name, sp.size as product_size
    FROM orders o
    JOIN products p ON o.product_id = p.id
    LEFT JOIN sub_products sp ON o.sub_product_id = sp.id
    WHERE o.user_id = ? OR o.customer_email = (SELECT email FROM users WHERE id = ?)
    ORDER BY o.created_at DESC
  `, [req.user.userId, req.user.userId], (err, orders) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ orders });
  });
});

// Profile update route
app.put('/api/profile', authenticateToken, (req, res) => {
  if (req.user.role === 'guest') {
    return res.status(403).json({ error: 'Member account required' });
  }

  const { 
    firstName, lastName, phone, addressStreet, 
    addressCity, addressState, addressZip, birthMonth 
  } = req.body;

  db.run(`UPDATE users SET 
    first_name = ?, last_name = ?, phone = ?, address_street = ?,
    address_city = ?, address_state = ?, address_zip = ?, birth_month = ?
    WHERE id = ?`, 
    [firstName, lastName, phone, addressStreet, addressCity, addressState, addressZip, birthMonth, req.user.userId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Profile update failed' });
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      res.json({ message: 'Profile updated successfully' });
    }
  );
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

// Create orders table for payment tracking
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    sub_product_id TEXT,
    customer_email TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    paypal_order_id TEXT,
    order_notes TEXT,
    status TEXT DEFAULT 'completed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products (id),
    FOREIGN KEY (sub_product_id) REFERENCES sub_products (id)
  )`);

  // Add sub_product_id column if it doesn't exist
  db.run(`ALTER TABLE orders ADD COLUMN sub_product_id TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding sub_product_id column to orders:', err);
    }
  });

  // Add shipping columns if they don't exist
  db.run(`ALTER TABLE orders ADD COLUMN customer_phone TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding customer_phone column to orders:', err);
    }
  });

  db.run(`ALTER TABLE orders ADD COLUMN shipping_street TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding shipping_street column to orders:', err);
    }
  });

  db.run(`ALTER TABLE orders ADD COLUMN shipping_city TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding shipping_city column to orders:', err);
    }
  });

  db.run(`ALTER TABLE orders ADD COLUMN shipping_state TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding shipping_state column to orders:', err);
    }
  });

  db.run(`ALTER TABLE orders ADD COLUMN shipping_zip TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding shipping_zip column to orders:', err);
    }
  });

  db.run(`ALTER TABLE orders ADD COLUMN shipping_method TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding shipping_method column to orders:', err);
    }
  });

  db.run(`ALTER TABLE orders ADD COLUMN shipping_cost DECIMAL(10,2) DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding shipping_cost column to orders:', err);
    }
  });

  // Add coupon tracking columns
  db.run(`ALTER TABLE orders ADD COLUMN coupon_code TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding coupon_code column:', err);
    }
  });

  db.run(`ALTER TABLE orders ADD COLUMN coupon_discount DECIMAL(10,2) DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding coupon_discount column:', err);
    }
  });
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
    db.get('SELECT sp.*, p.name as product_name FROM sub_products sp JOIN products p ON sp.parent_product_id = p.id WHERE sp.id = ?', [subProductId], (err, subProduct) => {
      if (err) {
        console.error('Database error getting sub-product:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      if (!subProduct) {
        console.log('Sub-product not found with ID:', subProductId);
        return res.status(404).json({ error: 'Product variant not found' });
      }
      
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
      db.run(`INSERT INTO orders 
        (id, product_id, sub_product_id, customer_email, customer_name, customer_phone, 
         shipping_street, shipping_city, shipping_state, shipping_zip, shipping_method, shipping_cost,
         quantity, total_amount, paypal_order_id, order_notes, coupon_code, coupon_discount, user_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, productId, subProductId, customerEmail, customerName, customerPhone,
         shippingAddress.street, shippingAddress.city, shippingAddress.state, shippingAddress.zip,
         shippingMethod, shippingCost || 0, quantity, totalAmount, paypalOrderId, orderNotes, 
         couponCode || null, couponDiscount || 0, req.user?.userId || null],
        function(err) {
          if (err) {
            console.error('Failed to create order:', err);
            return res.status(500).json({ error: 'Failed to create order' });
          }
          
          console.log('Order created successfully with ID:', orderId);

          // Update sub-product inventory
          db.run('UPDATE sub_products SET inventory_count = inventory_count - ? WHERE id = ?', 
            [quantity, subProductId], (err) => {
            if (err) {
              console.error('Failed to update sub-product inventory:', err);
              // Don't fail the order, but log the error
            }

            // Update coupon usage count if coupon was used
            if (couponCode) {
              db.run('UPDATE coupons SET usage_count = usage_count + 1 WHERE code = ?', 
                [couponCode], (err) => {
                if (err) {
                  console.error('Failed to update coupon usage:', err);
                  // Don't fail the order, but log the error
                }
              });
            }

            res.json({ 
              message: 'Payment processed successfully',
              orderId: orderId,
              customerEmail: customerEmail
            });
          });
        }
      );
    });
  } catch (error) {
    console.error('Payment processing error:', error);
    res.status(500).json({ error: 'Payment processing failed' });
  }
});

app.get('/api/orders', authenticateToken, (req, res) => {
  // Only allow admin users to view all orders
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  db.all(`
    SELECT o.*, p.name as product_name 
    FROM orders o 
    JOIN products p ON o.product_id = p.id 
    ORDER BY o.created_at DESC
  `, (err, orders) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ orders });
  });
});

// Debug route to check database products
app.get('/debug/products', (req, res) => {
  db.all('SELECT * FROM products', (err, products) => {
    if (err) {
      return res.json({ error: 'Database error', details: err.message });
    }
    
    db.all('SELECT * FROM sub_products', (err2, subProducts) => {
      if (err2) {
        return res.json({ error: 'Sub-products database error', details: err2.message });
      }
      
      res.json({ 
        products: products,
        subProducts: subProducts,
        productCount: products.length,
        subProductCount: subProducts.length
      });
    });
  });
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

app.listen(PORT, () => {
  console.log(`🏝️  Rell's Kitchen server running on port ${PORT}`);
  console.log(`🌴  Caribbean-Cyberpunk fusion cuisine awaits...`);
  console.log(`📁  Static files served from: ${path.join(__dirname, 'public')}`);
  console.log(`🚀  Deployment successful at ${new Date().toISOString()}`);
});
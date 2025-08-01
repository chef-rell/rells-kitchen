// PostgreSQL database setup
const { Pool } = require('pg');

// PostgreSQL connection
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to PostgreSQL database:', err);
  } else {
    console.log('✅ Connected to PostgreSQL database');
    release();
  }
});

// Initialize PostgreSQL database
async function initializePostgreSQL() {
  try {
    // Create users table
    await pool.query(`
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
    await pool.query(`
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
    await pool.query(`
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

    // Create orders table
    await pool.query(`
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
        quantity INTEGER NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        paypal_order_id TEXT,
        order_notes TEXT,
        coupon_code TEXT,
        coupon_discount DECIMAL(10,2) DEFAULT 0,
        user_id TEXT,
        status TEXT DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products (id)
      )
    `);

    // Create subscriptions table
    await pool.query(`
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

    // Create coupons table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
        discount_value DECIMAL(10,2) NOT NULL,
        active BOOLEAN DEFAULT true,
        usage_limit INTEGER DEFAULT -1,
        usage_count INTEGER DEFAULT 0,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create reservations table
    await pool.query(`
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
    await pool.query(`
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

    // Initialize with sample data if needed
    const result = await pool.query('SELECT COUNT(*) FROM products');
    if (parseInt(result.rows[0].count) === 0) {
      console.log('Initializing database with products...');
      await initializePostgreSQLData();
    }

    // Insert default coupon if not exists
    await pool.query(`
      INSERT INTO coupons (id, code, discount_type, discount_value, active, usage_limit) 
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (code) DO NOTHING
    `, [require('uuid').v4(), 'family', 'percentage', 25, true, -1]);

    console.log('✅ PostgreSQL database initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing PostgreSQL database:', error);
  }
}

// Initialize database data for PostgreSQL
async function initializePostgreSQLData() {
  try {
    // Insert products
    await pool.query(`
      INSERT INTO products (id, name, description, price, available, neo_flavor_profile, user_rating, created_at, inventory_count)
      VALUES 
      ($1, $2, $3, $4, $5, $6, $7, $8, $9),
      ($10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (id) DO NOTHING
    `, [
      'fixed-tamarind-stew-id', 'Tamarind_Sweets', 'This beloved Caribbean comfort food delivers the perfect harmony of sweet and tangy flavors. A treasured local dish known as \'Tamarind Stew\'.', 6.99, true, 4, 4, '2025-07-26 19:04:59', 15,
      'fixed-quantum-mango-id', 'Quantum_Mango', 'Succulent St. Thomas mango, slow-simmered with traditional island spices until fork-tender. This aromatic masterpiece, known locally as \'Mango Stew\', delivers layers of complex, neo-Caribbean flavors.', 8.99, true, 3, 4, '2025-07-26 19:04:59', 0
    ]);

    // Insert sub-products
    await pool.query(`
      INSERT INTO sub_products (id, parent_product_id, size, size_oz, price, inventory_count, created_at)
      VALUES 
      ($1, $2, $3, $4, $5, $6, $7),
      ($8, $9, $10, $11, $12, $13, $14),
      ($15, $16, $17, $18, $19, $20, $21),
      ($22, $23, $24, $25, $26, $27, $28),
      ($29, $30, $31, $32, $33, $34, $35),
      ($36, $37, $38, $39, $40, $41, $42)
      ON CONFLICT (id) DO NOTHING
    `, [
      '254fa798-1cce-413f-8e29-6e3c426e4b80', 'fixed-tamarind-stew-id', '4oz', 4, 6.99, 14, '2025-07-26 21:28:40',
      '208c9859-4e32-4a19-972a-63046e916633', 'fixed-tamarind-stew-id', '8oz', 8, 13.98, 15, '2025-07-26 21:28:40',
      '89506dba-86cd-4b74-b7d2-1d87b4917148', 'fixed-tamarind-stew-id', '16oz', 16, 27.96, 11, '2025-07-26 21:36:40',
      '046ae866-7f24-49b6-a137-7f3a0b649872', 'fixed-quantum-mango-id', '4oz', 4, 8.99, 0, '2025-07-27 05:00:53',
      '1a80e4ea-fa3d-40ff-bdaf-1d8f9dfacacf', 'fixed-quantum-mango-id', '8oz', 8, 17.98, 0, '2025-07-26 21:40:25',
      '14428213-7032-4c22-ab5f-0d04deb95987', 'fixed-quantum-mango-id', '16oz', 16, 35.96, 0, '2025-07-27 05:00:53'
    ]);

    console.log('✅ Database initialized with products and sub-products');
  } catch (error) {
    console.error('❌ Error initializing database data:', error);
  }
}

module.exports = { pool, initializePostgreSQL };
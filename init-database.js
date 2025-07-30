const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

// Initialize database with products and sub-products
function initializeDatabase() {
    const db = new sqlite3.Database('./rells_kitchen.db');
    
    db.serialize(() => {
        // Create tables first
        db.run(`CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            price REAL,
            available INTEGER DEFAULT 1,
            neo_flavor_profile INTEGER DEFAULT 3,
            user_rating INTEGER DEFAULT 4,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            inventory_count INTEGER DEFAULT 0
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS sub_products (
            id TEXT PRIMARY KEY,
            product_id TEXT,
            size TEXT NOT NULL,
            size_oz INTEGER,
            price REAL NOT NULL,
            inventory_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products (id)
        )`);

        // Insert products
        const insertProduct = db.prepare(`INSERT OR REPLACE INTO products 
            (id, name, description, price, available, neo_flavor_profile, user_rating, created_at, inventory_count) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

        // Tamarind Splice
        insertProduct.run([
            'fixed-tamarind-stew-id',
            'Tamarind_Splice',
            "This beloved Caribbean comfort food delivers the perfect harmony of sweet and tangy flavors. A treasured local dish known as 'Tamarind Stew'.",
            5.99,
            1,
            4,
            4,
            '2025-07-26 19:04:59',
            15
        ]);

        // Quantum Mango
        insertProduct.run([
            'fixed-quantum-mango-id',
            'Quantum_Mango',
            "Succulent St. Thomas mango, slow-simmered with traditional island spices until fork-tender. This aromatic masterpiece, known locally as 'Mango Stew,' delivers layers of complex, neo-Caribbean flavors.",
            8.99,
            1,
            3,
            4,
            '2025-07-26 19:04:59',
            0
        ]);

        insertProduct.finalize();

        // Insert sub-products
        const insertSubProduct = db.prepare(`INSERT OR REPLACE INTO sub_products 
            (id, product_id, size, size_oz, price, inventory_count, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`);

        // Tamarind Splice sub-products
        insertSubProduct.run([
            '254fa798-1cce-413f-8e29-6e3c426e4b80',
            'fixed-tamarind-stew-id',
            '4oz',
            4,
            5.99,
            14,
            '2025-07-26 21:28:40'
        ]);

        insertSubProduct.run([
            '208c9859-4e32-4a19-972a-63046e916633',
            'fixed-tamarind-stew-id',
            '8oz',
            8,
            11.98,
            15,
            '2025-07-26 21:28:40'
        ]);

        insertSubProduct.run([
            '89506dba-86cd-4b74-b7d2-1d87b4917148',
            'fixed-tamarind-stew-id',
            '16oz',
            16,
            23.96,
            11,
            '2025-07-26 21:36:40'
        ]);

        // Quantum Mango sub-products
        insertSubProduct.run([
            '046ae866-7f24-49b6-a137-7f3a0b649872',
            'fixed-quantum-mango-id',
            '4oz',
            4,
            8.99,
            0,
            '2025-07-27 05:00:53'
        ]);

        insertSubProduct.run([
            '1a80e4ea-fa3d-40ff-bdaf-1d8f9dfacacf',
            'fixed-quantum-mango-id',
            '8oz',
            8,
            17.98,
            0,
            '2025-07-26 21:40:25'
        ]);

        insertSubProduct.run([
            '14428213-7032-4c22-ab5f-0d04deb95987',
            'fixed-quantum-mango-id',
            '16oz',
            16,
            35.96,
            0,
            '2025-07-27 05:00:53'
        ]);

        insertSubProduct.finalize();

        console.log('✅ Database initialized with products and sub-products');
    });

    db.close();
}

// Run initialization if this file is executed directly
if (require.main === module) {
    initializeDatabase();
}

module.exports = { initializeDatabase };
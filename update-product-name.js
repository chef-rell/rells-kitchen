const { Pool } = require('pg');

// Database update script to change Tamarind_Splice to Tamarind_Sweets
async function updateProductName() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('Connecting to database...');
    
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
    
    if (verifyResult.rows.length > 0) {
      console.log('Verification - Product name is now:', verifyResult.rows[0].name);
    } else {
      console.log('Product not found for verification');
    }
    
    console.log('✅ Product name update completed successfully');
    
  } catch (error) {
    console.error('❌ Error updating product name:', error);
  } finally {
    await pool.end();
  }
}

// Run the update
updateProductName();
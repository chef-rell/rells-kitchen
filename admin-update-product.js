// Temporary admin endpoint - add this to your server.js

// Admin endpoint to update product name (remove after use)
app.get('/admin/update-product-name', async (req, res) => {
  // Simple authentication check
  const adminKey = req.query.key;
  const validKey = 'rells-kitchen-admin-2025';
  
  if (adminKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }
  
  try {
    console.log('Starting product name update...');
    
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
      updated_records: updateResult.rowCount,
      current_name: verifyResult.rows[0]?.name || 'Not found',
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ Product name update completed:', result);
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error updating product name:', error);
    res.status(500).json({ 
      error: 'Update failed', 
      details: error.message 
    });
  }
});
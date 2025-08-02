const { Pool } = require('pg');

// Test both connection strings
const publicUrl = process.env.DATABASE_PUBLIC_URL;
const privateUrl = process.env.DATABASE_URL;

console.log('Testing DATABASE_PUBLIC_URL...');
console.log('Connection string:', publicUrl);

const pool1 = new Pool({
  connectionString: publicUrl,
  ssl: { rejectUnauthorized: false }
});

pool1.connect((err, client, release) => {
  if (err) {
    console.error('❌ DATABASE_PUBLIC_URL failed:', err.message);
  } else {
    console.log('✅ DATABASE_PUBLIC_URL works!');
    release();
  }
  
  console.log('\nTesting DATABASE_URL...');
  console.log('Connection string:', privateUrl);
  
  const pool2 = new Pool({
    connectionString: privateUrl,
    ssl: { rejectUnauthorized: false }
  });
  
  pool2.connect((err2, client2, release2) => {
    if (err2) {
      console.error('❌ DATABASE_URL failed:', err2.message);
    } else {
      console.log('✅ DATABASE_URL works!');
      release2();
    }
    process.exit(0);
  });
});
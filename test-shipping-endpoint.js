const fetch = require('node-fetch');

async function testShippingEndpoint() {
    console.log('🧪 Testing shipping calculation endpoint...\n');

    const serverUrl = 'http://localhost:3000';
    
    const testCases = [
        {
            name: 'Local Arkansas ZIP (72201)',
            zipCode: '72201',
            productSize: '4oz',
            quantity: 1
        },
        {
            name: 'California ZIP (90210)', 
            zipCode: '90210',
            productSize: '8oz',
            quantity: 2
        },
        {
            name: 'Invalid ZIP code',
            zipCode: '1234',
            productSize: '4oz',
            quantity: 1
        },
        {
            name: 'Missing parameters',
            zipCode: '72201'
            // Missing productSize and quantity
        }
    ];

    for (const testCase of testCases) {
        console.log(`📦 Testing: ${testCase.name}`);
        
        try {
            const response = await fetch(`${serverUrl}/api/calculate-shipping`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(testCase)
            });

            const data = await response.json();
            
            console.log(`   Status: ${response.status} ${response.statusText}`);
            
            if (response.ok && data.success) {
                console.log('   ✅ Success');
                console.log(`   Rates found: ${data.rates.length}`);
                
                if (data.fallback) {
                    console.log('   ⚠️  Using fallback rates (USPS API unavailable)');
                }
                
                console.log('   📊 Shipping Options:');
                data.rates.forEach(rate => {
                    console.log(`     • ${rate.name}: $${rate.cost.toFixed(2)} (${rate.deliveryTime})`);
                });
                
                if (data.packageInfo) {
                    console.log(`   📦 Package Info: ${data.packageInfo.weight} lbs, ${data.packageInfo.dimensions.length}"x${data.packageInfo.dimensions.width}"x${data.packageInfo.dimensions.height}"`);
                }
            } else {
                console.log('   ❌ Error');
                console.log(`   Message: ${data.error || 'Unknown error'}`);
            }
            
        } catch (error) {
            console.log(`   ❌ Request failed: ${error.message}`);
        }
        
        console.log('');
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('🧪 Shipping endpoint test completed!');
}

// Check if server is running first
async function checkServer() {
    try {
        const response = await fetch('http://localhost:3000/debug/static');
        if (response.ok) {
            console.log('✅ Server is running on port 3000\n');
            return true;
        }
    } catch (error) {
        console.log('❌ Server is not running on port 3000');
        console.log('   Please start the server with: npm start\n');
        return false;
    }
}

checkServer().then(serverRunning => {
    if (serverRunning) {
        testShippingEndpoint().catch(console.error);
    }
});
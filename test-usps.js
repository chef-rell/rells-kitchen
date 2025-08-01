const USPSIntegration = require('./usps-integration');

// Test script for USPS integration
async function testUSPSIntegration() {
    console.log('🧪 Testing USPS Integration...\n');

    // You'll need to set these environment variables or replace with your credentials
    const username = process.env.USPS_USERNAME || 'YOUR_USPS_USERNAME';
    const password = process.env.USPS_PASSWORD || 'YOUR_USPS_PASSWORD';

    if (username === 'YOUR_USPS_USERNAME' || password === 'YOUR_USPS_PASSWORD') {
        console.log('❌ Please set USPS_USERNAME and USPS_PASSWORD environment variables');
        console.log('   or update the credentials in this test file\n');
        console.log('   Example:');
        console.log('   USPS_USERNAME=your_username USPS_PASSWORD=your_password node test-usps.js');
        return;
    }

    const usps = new USPSIntegration(username, password);

    // Test data
    const testCases = [
        {
            name: 'Local Arkansas shipping (4oz jar)',
            fromZip: '72120',
            toZip: '72201',
            productSize: '4oz',
            quantity: 1
        },
        {
            name: 'Cross-country shipping (8oz jar)',
            fromZip: '72120',
            toZip: '90210',
            productSize: '8oz',
            quantity: 2
        },
        {
            name: 'USVI shipping (16oz jar)',
            fromZip: '72120',
            toZip: '00801',
            productSize: '16oz',
            quantity: 1
        }
    ];

    for (const testCase of testCases) {
        console.log(`📦 Testing: ${testCase.name}`);
        console.log(`   From: ${testCase.fromZip} → To: ${testCase.toZip}`);
        console.log(`   Product: ${testCase.productSize} x${testCase.quantity}`);

        try {
            const weight = usps.calculatePackageWeight(testCase.productSize, testCase.quantity);
            const dimensions = usps.getPackageDimensions(testCase.productSize, testCase.quantity);
            
            console.log(`   Weight: ${weight} lbs`);
            console.log(`   Dimensions: ${dimensions.length}"L x ${dimensions.width}"W x ${dimensions.height}"H`);

            const rates = await usps.calculateShippingRates(
                testCase.fromZip,
                testCase.toZip,
                weight,
                dimensions
            );

            console.log('   📊 Shipping Rates:');
            rates.forEach(rate => {
                console.log(`     • ${rate.name}: $${rate.cost.toFixed(2)} (${rate.deliveryTime})`);
            });
            
            console.log('   ✅ Success\n');

        } catch (error) {
            console.log(`   ❌ Error: ${error.message}\n`);
        }

        // Add delay between requests to be nice to USPS API
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('🧪 USPS Integration test completed!');
}

// Test helper functions
console.log('🔧 Testing helper functions...');
const usps = new USPSIntegration('test', 'test');

// Test ZIP code validation
const zipTests = ['12345', '12345-6789', '1234', 'abcde', ''];
console.log('\n📍 ZIP Code Validation Tests:');
zipTests.forEach(zip => {
    const isValid = usps.isValidZipCode(zip);
    console.log(`   "${zip}": ${isValid ? '✅ Valid' : '❌ Invalid'}`);
});

// Test weight calculations  
console.log('\n⚖️  Weight Calculation Tests:');
const sizeTests = ['4oz', '8oz', '16oz'];
sizeTests.forEach(size => {
    const weight1 = usps.calculatePackageWeight(size, 1);
    const weight2 = usps.calculatePackageWeight(size, 2);
    console.log(`   ${size} x1: ${weight1} lbs, x2: ${weight2} lbs`);
});

// Test dimension calculations
console.log('\n📐 Dimension Calculation Tests:');
sizeTests.forEach(size => {
    [1, 2, 3].forEach(qty => {
        const dims = usps.getPackageDimensions(size, qty);
        console.log(`   ${size} x${qty}: ${dims.length}" x ${dims.width}" x ${dims.height}"`);
    });
});

console.log('\n');

// Run API tests if credentials are available
if (process.argv.includes('--api-test')) {
    testUSPSIntegration().catch(console.error);
} else {
    console.log('💡 To test the USPS API, run: node test-usps.js --api-test');
    console.log('   Make sure to set your USPS credentials first!');
}
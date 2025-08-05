class TaxCalculator {
    constructor() {
        // Tax rates by state for food/jam products
        this.taxRates = {
            // Arkansas has reduced rate for food products
            'AR': 0.045, // 4.5% reduced rate for jams/food
            'AL': 0.04,    // 4% state sales tax on food
            'AZ': 0.056,   // 5.6% state rate (food not exempt)
            'CA': 0.075,   // 7.5% base rate (food taxable)
            'CO': 0.029,   // 2.9% state rate on food
            'CT': 0.0635,  // 6.35% (food generally exempt, but processed food may be taxable)
            'FL': 0.06,    // 6% (food generally exempt, but specialty items may be taxable)
            'GA': 0.04,    // 4% (food generally exempt at state level)
            'IL': 0.0625,  // 6.25% (reduced rate for food in some areas)
            'IN': 0.07,    // 7% (food generally exempt)
            'KS': 0.065,   // 6.5% (food taxable)
            'LA': 0.045,   // 4.45% state rate
            'MA': 0.0625,  // 6.25% (food generally exempt)
            'MO': 0.04225, // 4.225% (food generally exempt)
            'MS': 0.07,    // 7% (food taxable)
            'NC': 0.0475,  // 4.75% (food generally exempt)
            'NY': 0.08,    // 8% (food generally exempt, but prepared food taxable)
            'OH': 0.0575,  // 5.75% (food generally exempt)
            'OK': 0.045,   // 4.5% (food taxable)
            'SC': 0.06,    // 6% (food generally exempt)
            'TN': 0.07,    // 7% (food taxable at reduced rate)
            'TX': 0.0625,  // 6.25% (food generally exempt)
            'VA': 0.043,   // 4.3% (food generally exempt, but prepared food taxable)
            'WA': 0.065,   // 6.5% (food generally exempt)
            'WV': 0.06,    // 6% (food generally exempt)
            'WI': 0.05,    // 5% (food generally exempt)
        };

        // States where you likely have nexus and should collect tax
        // Update this based on your business registration and sales thresholds
        this.nexusStates = [
            'AR', // Your business location - always collect
            // Add other states where you meet nexus thresholds
        ];
    }

    // Calculate tax for a given amount and shipping address
    calculateTax(amount, shippingAddress) {
        if (!shippingAddress || !shippingAddress.state) {
            console.log('No shipping state provided, no tax calculated');
            return {
                taxAmount: 0,
                taxRate: 0,
                taxableAmount: amount,
                reason: 'No shipping state provided'
            };
        }

        const state = shippingAddress.state.toUpperCase();
        
        // Check if we have nexus in this state
        if (!this.nexusStates.includes(state)) {
            console.log(`No nexus in ${state}, no tax collected`);
            return {
                taxAmount: 0,
                taxRate: 0,
                taxableAmount: amount,
                reason: `No nexus in ${state}`
            };
        }

        // Get tax rate for the state
        const taxRate = this.taxRates[state] || 0;
        
        if (taxRate === 0) {
            console.log(`No tax rate configured for ${state}`);
            return {
                taxAmount: 0,
                taxRate: 0,
                taxableAmount: amount,
                reason: `No tax rate configured for ${state}`
            };
        }

        const taxAmount = amount * taxRate;
        
        console.log(`Tax calculation for ${state}:`, {
            taxableAmount: amount,
            taxRate: taxRate,
            taxAmount: taxAmount
        });

        return {
            taxAmount: parseFloat(taxAmount.toFixed(2)),
            taxRate: taxRate,
            taxableAmount: amount,
            state: state,
            reason: `${state} sales tax (${(taxRate * 100).toFixed(3)}%)`
        };
    }

    // Get tax info for display purposes
    getTaxInfo(state) {
        const stateCode = state ? state.toUpperCase() : '';
        const hasNexus = this.nexusStates.includes(stateCode);
        const taxRate = this.taxRates[stateCode] || 0;

        return {
            state: stateCode,
            hasNexus: hasNexus,
            taxRate: taxRate,
            taxPercentage: (taxRate * 100).toFixed(3) + '%',
            willCollectTax: hasNexus && taxRate > 0
        };
    }

    // Add a state to nexus list (for business expansion)
    addNexusState(state) {
        const stateCode = state.toUpperCase();
        if (!this.nexusStates.includes(stateCode)) {
            this.nexusStates.push(stateCode);
            console.log(`Added ${stateCode} to nexus states`);
        }
    }

    // Update tax rate for a state
    updateTaxRate(state, rate) {
        const stateCode = state.toUpperCase();
        this.taxRates[stateCode] = rate;
        console.log(`Updated tax rate for ${stateCode}: ${(rate * 100).toFixed(3)}%`);
    }

    // Basic zip code to state mapping for tax calculation
    getStateFromZip(zipCode) {
        const zip = zipCode.toString();
        
        // Arkansas zip codes (where you have nexus)
        if (zip.match(/^7[12]/)) return 'AR';
        
        // Basic zip code ranges for major states
        const zipRanges = {
            'AL': [35000, 36999],
            'AZ': [85000, 86999],
            'CA': [90000, 96699],
            'CO': [80000, 81999],
            'CT': [6000, 6999],
            'FL': [32000, 34999],
            'GA': [30000, 31999],
            'IL': [60000, 62999],
            'IN': [46000, 47999],
            'KS': [66000, 67999],
            'LA': [70000, 71999],
            'MA': [1000, 2799],
            'MO': [63000, 65999],
            'MS': [38000, 39999],
            'NC': [27000, 28999],
            'NY': [10000, 14999],
            'OH': [43000, 45999],
            'OK': [73000, 74999],
            'SC': [29000, 29999],
            'TN': [37000, 38599],
            'TX': [75000, 79999],
            'VA': [20000, 24699],
            'WA': [98000, 99499],
            'WV': [24700, 26999],
            'WI': [53000, 54999]
        };

        const zipNum = parseInt(zip);
        for (const [state, [min, max]] of Object.entries(zipRanges)) {
            if (zipNum >= min && zipNum <= max) {
                return state;
            }
        }

        return null; // Unknown state
    }
}

module.exports = TaxCalculator;
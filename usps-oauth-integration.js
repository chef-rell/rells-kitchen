const https = require('https');

class USPSOAuthIntegration {
    constructor(consumerKey, consumerSecret, customerRegistrationId, mailerId) {
        this.consumerKey = consumerKey;
        this.consumerSecret = consumerSecret;
        this.customerRegistrationId = customerRegistrationId;
        this.mailerId = mailerId;
        this.baseUrl = process.env.NODE_ENV === 'production' 
            ? 'apis.usps.com' 
            : 'apis-cat.usps.com'; // CAT environment for testing
        
        // Token management
        this.accessToken = null;
        this.tokenExpiry = null;
        this.tokenRefreshBuffer = 5 * 60 * 1000; // Refresh 5 minutes before expiry
        
        // Rate cache (keeping the 10-minute caching from old integration)
        this.rateCache = new Map();
        this.cacheTTL = 10 * 60 * 1000; // 10 minutes
    }

    // Generate cache key for shipping rates
    generateCacheKey(fromZip, toZip, weight, dimensions) {
        const dimStr = dimensions ? `${dimensions.width}x${dimensions.length}x${dimensions.height}` : 'nodim';
        return `${fromZip}-${toZip}-${weight}-${dimStr}`;
    }

    // Check if cached rate is still valid
    getCachedRate(cacheKey) {
        const cached = this.rateCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
            console.log(`✅ Using cached shipping rate for key: ${cacheKey}`);
            return cached.rates;
        }
        return null;
    }

    // Store rate in cache
    setCachedRate(cacheKey, rates) {
        this.rateCache.set(cacheKey, {
            rates: rates,
            timestamp: Date.now()
        });
        console.log(`💾 Cached shipping rate for key: ${cacheKey}`);
        
        // Clean up expired entries periodically
        if (this.rateCache.size > 100) {
            this.cleanExpiredCache();
        }
    }

    // Remove expired cache entries
    cleanExpiredCache() {
        const now = Date.now();
        for (const [key, value] of this.rateCache.entries()) {
            if ((now - value.timestamp) >= this.cacheTTL) {
                this.rateCache.delete(key);
            }
        }
        console.log(`🧹 Cleaned expired cache entries. Current size: ${this.rateCache.size}`);
    }

    // Get OAuth 2.0 access token
    async getAccessToken() {
        // Check if current token is still valid
        if (this.accessToken && this.tokenExpiry && 
            (Date.now() + this.tokenRefreshBuffer) < this.tokenExpiry) {
            return this.accessToken;
        }

        console.log('🔐 Requesting new OAuth access token...');

        return new Promise((resolve, reject) => {
            const tokenData = JSON.stringify({
                'client_id': this.consumerKey,
                'client_secret': this.consumerSecret,
                'grant_type': 'client_credentials'
            });

            const options = {
                hostname: this.baseUrl,
                port: 443,
                path: '/oauth2/v3/token',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': tokenData.length
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const tokenResponse = JSON.parse(data);
                        
                        if (res.statusCode === 200 && tokenResponse.access_token) {
                            this.accessToken = tokenResponse.access_token;
                            // Token typically expires in 3600 seconds (1 hour)
                            this.tokenExpiry = Date.now() + (tokenResponse.expires_in * 1000);
                            
                            console.log('✅ OAuth token obtained successfully');
                            resolve(this.accessToken);
                        } else {
                            console.error('❌ OAuth token request failed:', tokenResponse);
                            reject(new Error(`OAuth error: ${tokenResponse.error_description || 'Unknown error'}`));
                        }
                    } catch (error) {
                        console.error('❌ Failed to parse OAuth response:', data);
                        reject(new Error('Failed to parse OAuth token response'));
                    }
                });
            });

            req.on('error', (error) => {
                console.error('❌ OAuth request failed:', error);
                reject(error);
            });

            req.write(tokenData);
            req.end();
        });
    }

    // Get shipping rates from new USPS API
    async calculateShippingRates(fromZip, toZip, weight, dimensions = null) {
        // Check cache first
        const cacheKey = this.generateCacheKey(fromZip, toZip, weight, dimensions);
        const cachedRates = this.getCachedRate(cacheKey);
        if (cachedRates) {
            return cachedRates;
        }

        try {
            // Get OAuth token
            const token = await this.getAccessToken();
            
            // Convert weight to pounds and ounces
            const pounds = Math.floor(weight);
            const ounces = Math.round((weight - pounds) * 16);
            
            // Prepare pricing request
            const pricingData = {
                "originZIPCode": fromZip,
                "destinationZIPCode": toZip,
                "weight": weight,
                "length": dimensions?.length || 10,
                "width": dimensions?.width || 8,
                "height": dimensions?.height || 5,
                "mailClass": "USPS_GROUND_ADVANTAGE", // Start with Ground Advantage
                "processingCategory": "MACHINABLE",
                "rateIndicator": "SP", // Single Piece
                "destinationEntryFacilityType": "NONE",
                "priceType": "RETAIL"
            };

            const rates = [];
            const services = [
                { mailClass: "USPS_GROUND_ADVANTAGE", name: "Ground Advantage" },
                { mailClass: "PRIORITY_MAIL", name: "Priority Mail" },
                { mailClass: "PRIORITY_MAIL_EXPRESS", name: "Priority Express" }
            ];

            // Get rates for each service
            for (const service of services) {
                try {
                    const serviceRate = await this.getPriceForService(token, {
                        ...pricingData,
                        mailClass: service.mailClass
                    });
                    
                    if (serviceRate) {
                        rates.push({
                            service: service.mailClass,
                            name: service.name,
                            cost: parseFloat(serviceRate.totalPrice || serviceRate.price || 0),
                            deliveryTime: this.getDeliveryTime(service.mailClass),
                            description: `${service.name} (${this.getDeliveryTime(service.mailClass)})`
                        });
                    }
                } catch (error) {
                    console.warn(`Failed to get rate for ${service.name}:`, error.message);
                }
            }

            // Add pickup option (always free)
            rates.unshift({
                service: 'PICKUP',
                name: 'Hold For Pickup',
                cost: 0,
                deliveryTime: 'Hold for pickup',
                description: 'UPS or USPS Post Office (Hold For Pickup) - FREE'
            });

            // Cache the rates before returning
            this.setCachedRate(cacheKey, rates);

            return rates;
        } catch (error) {
            console.error('USPS OAuth rate calculation failed:', error);
            // Return fallback rates
            return [
                {
                    service: 'PICKUP',
                    name: 'Hold For Pickup',
                    cost: 0,
                    deliveryTime: 'Hold for pickup',
                    description: 'UPS or USPS Post Office (Hold For Pickup) - FREE'
                }
            ];
        }
    }

    // Get price for specific service
    async getPriceForService(token, pricingData) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify(pricingData);
            
            const options = {
                hostname: this.baseUrl,
                port: 443,
                path: '/prices/v3/base-rates/search',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Content-Length': postData.length
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        
                        if (res.statusCode === 200 && response.totalBasePrice) {
                            resolve({
                                price: response.totalBasePrice,
                                totalPrice: response.totalBasePrice
                            });
                        } else {
                            console.warn('USPS pricing API error:', response);
                            reject(new Error(`Pricing API error: ${response.error?.message || 'Unknown error'}`));
                        }
                    } catch (error) {
                        console.error('Failed to parse pricing response:', data);
                        reject(new Error('Failed to parse pricing response'));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(postData);
            req.end();
        });
    }

    // Get estimated delivery time for service
    getDeliveryTime(service) {
        const serviceMap = {
            'USPS_GROUND_ADVANTAGE': '2-5 business days',
            'PRIORITY_MAIL': '1-3 business days',
            'PRIORITY_MAIL_EXPRESS': '1-2 business days'
        };
        return serviceMap[service] || '2-5 business days';
    }

    // Validate ZIP code format
    isValidZipCode(zipCode) {
        return /^\d{5}(-\d{4})?$/.test(zipCode);
    }

    // Calculate package weight based on product size and quantity
    calculatePackageWeight(productSize, quantity) {
        const sizeWeights = {
            'small': 0.5,   // 8oz
            '8oz': 0.5,
            'medium': 1.0,  // 16oz
            '16oz': 1.0,
            'large': 1.5,   // 24oz
            '24oz': 1.5
        };
        
        const baseWeight = sizeWeights[productSize.toLowerCase()] || 1.0;
        return baseWeight * quantity + 0.5; // Add packaging weight
    }

    // Get package dimensions based on quantity
    getPackageDimensions(productSize, quantity) {
        // Adjust box size based on quantity
        if (quantity === 1) {
            return { width: 6, length: 9, height: 4 }; // Small box
        } else if (quantity === 2) {
            return { width: 8, length: 10, height: 5 }; // Medium box
        } else {
            return { width: 10, length: 12, height: 6 }; // Large box
        }
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

module.exports = USPSOAuthIntegration;
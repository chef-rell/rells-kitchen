const https = require('https');
const xml2js = require('xml2js');

class USPSIntegration {
    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.apiUrl = 'secure.shippingapis.com';
        this.testApiUrl = 'stg-secure.shippingapis.com';
        this.isProduction = process.env.NODE_ENV === 'production';
        
        // Initialize cache for shipping rates
        this.rateCache = new Map();
        this.cacheTTL = 10 * 60 * 1000; // 10 minutes in milliseconds
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

    // Calculate shipping rates for different USPS services
    async calculateShippingRates(fromZip, toZip, weight, dimensions = null) {
        // Check cache first
        const cacheKey = this.generateCacheKey(fromZip, toZip, weight, dimensions);
        const cachedRates = this.getCachedRate(cacheKey);
        if (cachedRates) {
            return cachedRates;
        }

        try {
            const services = [
                { service: 'GROUND_ADVANTAGE', name: 'Ground Advantage' },
                { service: 'PRIORITY_MAIL', name: 'Priority Mail' },
                { service: 'PRIORITY_MAIL_EXPRESS', name: 'Priority Express' }
            ];

            const rates = [];
            
            for (const service of services) {
                try {
                    const rate = await this.getRateForService(fromZip, toZip, weight, service.service, dimensions);
                    if (rate) {
                        rates.push({
                            service: service.service,
                            name: service.name,
                            cost: parseFloat(rate.cost),
                            deliveryTime: rate.deliveryTime,
                            description: `${service.name} (${rate.deliveryTime})`
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
            console.error('USPS rate calculation failed:', error);
            throw new Error('Unable to calculate shipping rates');
        }
    }

    async getRateForService(fromZip, toZip, weight, service, dimensions) {
        return new Promise((resolve, reject) => {
            // Construct XML request based on service type
            let xmlRequest;
            
            if (service === 'GROUND_ADVANTAGE') {
                xmlRequest = this.buildGroundAdvantageRequest(fromZip, toZip, weight, dimensions);
            } else {
                xmlRequest = this.buildPriorityRequest(fromZip, toZip, weight, service, dimensions);
            }

            const apiHost = this.isProduction ? this.apiUrl : this.testApiUrl;
            const path = `/ShippingAPI.dll?API=RateV4&XML=${encodeURIComponent(xmlRequest)}`;

            const options = {
                hostname: apiHost,
                port: 443,
                path: path,
                method: 'GET',
                headers: {
                    'User-Agent': 'RellsKitchen/1.0'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    this.parseUSPSResponse(data, service)
                        .then(resolve)
                        .catch(reject);
                });
            });

            req.on('error', (error) => {
                reject(new Error(`USPS API request failed: ${error.message}`));
            });

            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('USPS API request timeout'));
            });

            req.end();
        });
    }

    buildGroundAdvantageRequest(fromZip, toZip, weight, dimensions) {
        const width = dimensions?.width || 6;
        const length = dimensions?.length || 9;
        const height = dimensions?.height || 4;
        const girth = (width + height) * 2;

        return `
            <RateV4Request USERID="${this.username}">
                <Revision>2</Revision>
                <Package ID="1ST">
                    <Service>GROUND_ADVANTAGE</Service>
                    <ZipOrigination>${fromZip}</ZipOrigination>
                    <ZipDestination>${toZip}</ZipDestination>
                    <Pounds>${Math.floor(weight)}</Pounds>
                    <Ounces>${Math.round((weight % 1) * 16)}</Ounces>
                    <Container>RECTANGULAR</Container>
                    <Width>${width}</Width>
                    <Length>${length}</Length>
                    <Height>${height}</Height>
                    <Girth>${girth}</Girth>
                    <Machinable>TRUE</Machinable>
                </Package>
            </RateV4Request>
        `.trim();
    }

    buildPriorityRequest(fromZip, toZip, weight, service, dimensions) {
        const width = dimensions?.width || 6;
        const length = dimensions?.length || 9;
        const height = dimensions?.height || 4;

        const serviceMap = {
            'PRIORITY_MAIL': 'PRIORITY',
            'PRIORITY_MAIL_EXPRESS': 'EXPRESS'
        };

        return `
            <RateV4Request USERID="${this.username}">
                <Revision>2</Revision>
                <Package ID="1ST">
                    <Service>${serviceMap[service] || 'PRIORITY'}</Service>
                    <ZipOrigination>${fromZip}</ZipOrigination>
                    <ZipDestination>${toZip}</ZipDestination>
                    <Pounds>${Math.floor(weight)}</Pounds>
                    <Ounces>${Math.round((weight % 1) * 16)}</Ounces>
                    <Container>RECTANGULAR</Container>
                    <Width>${width}</Width>
                    <Length>${length}</Length>
                    <Height>${height}</Height>
                    <Machinable>TRUE</Machinable>
                </Package>
            </RateV4Request>
        `.trim();
    }

    async parseUSPSResponse(xmlData, requestedService) {
        try {
            const parser = new xml2js.Parser({ explicitArray: false });
            const result = await parser.parseStringPromise(xmlData);
            
            if (result.Error) {
                throw new Error(`USPS API Error: ${result.Error.Description}`);
            }

            if (!result.RateV4Response || !result.RateV4Response.Package) {
                throw new Error('Invalid USPS response format');
            }

            const packageData = result.RateV4Response.Package;
            
            if (packageData.Error) {
                throw new Error(`USPS Package Error: ${packageData.Error.Description}`);
            }

            // Handle different response formats
            let postage = packageData.Postage;
            if (Array.isArray(postage)) {
                // Multiple services returned, find the one we want
                postage = postage.find(p => this.matchesRequestedService(p, requestedService));
            }

            if (!postage) {
                throw new Error(`No rate found for requested service: ${requestedService}`);
            }

            return {
                cost: parseFloat(postage.Rate),
                deliveryTime: this.getDeliveryTime(postage.MailService || requestedService),
                service: postage.MailService || requestedService
            };

        } catch (error) {
            console.error('Failed to parse USPS response:', error);
            console.error('XML Data:', xmlData);
            throw error;
        }
    }

    matchesRequestedService(postage, requestedService) {
        const serviceMap = {
            'GROUND_ADVANTAGE': ['Ground Advantage', 'USPS Ground Advantage'],
            'PRIORITY_MAIL': ['Priority Mail', 'Priority Mail 1-Day', 'Priority Mail 2-Day', 'Priority Mail 3-Day'],
            'PRIORITY_MAIL_EXPRESS': ['Priority Mail Express', 'Express Mail']
        };

        const expectedNames = serviceMap[requestedService] || [];
        const actualService = postage.MailService || '';
        
        return expectedNames.some(name => actualService.includes(name));
    }

    getDeliveryTime(service) {
        const serviceMap = {
            'Ground Advantage': '2-5 business days',
            'USPS Ground Advantage': '2-5 business days',
            'Priority Mail': '1-3 business days',
            'Priority Mail 1-Day': '1 business day',
            'Priority Mail 2-Day': '2 business days', 
            'Priority Mail 3-Day': '3 business days',
            'Priority Mail Express': '1-2 business days',
            'Express Mail': '1-2 business days',
            'GROUND_ADVANTAGE': '2-5 business days',
            'PRIORITY_MAIL': '1-3 business days',
            'PRIORITY_MAIL_EXPRESS': '1-2 business days'
        };

        return serviceMap[service] || '2-5 business days';
    }

    // Validate ZIP code format
    isValidZipCode(zip) {
        return /^\d{5}(-\d{4})?$/.test(zip);
    }

    // Get estimated package weight based on product and quantity
    calculatePackageWeight(productSize, quantity) {
        // Weight estimates based on jar sizes
        const sizeWeights = {
            '4oz': 0.8,   // 4oz jar + contents
            '8oz': 1.4,   // 8oz jar + contents  
            '16oz': 2.6   // 16oz jar + contents
        };

        const unitWeight = sizeWeights[productSize] || 1.0;
        const totalWeight = unitWeight * quantity;
        
        // Add packaging weight (0.5 lbs for box + padding)
        return totalWeight + 0.5;
    }

    // Get estimated package dimensions
    getPackageDimensions(productSize, quantity) {
        // Base dimensions for different jar sizes
        const sizeDimensions = {
            '4oz': { width: 3, length: 3, height: 3 },
            '8oz': { width: 3.5, length: 3.5, height: 4 },
            '16oz': { width: 4, length: 4, height: 5 }
        };

        const baseDim = sizeDimensions[productSize] || sizeDimensions['8oz'];
        
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

module.exports = USPSIntegration;
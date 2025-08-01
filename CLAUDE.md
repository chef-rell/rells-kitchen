# Rell's Kitchen - Project Documentation

## Project Overview
Caribbean-Cyberpunk fusion cuisine e-commerce website built with Node.js, Express, and PostgreSQL. Features product catalog, user authentication, PayPal integration, and subscription management.

## Recent Work History

### Security Fixes (2025-08-01)
**CRITICAL**: Resolved PostgreSQL URI exposure detected by GitGuardian
- **Issue**: Hardcoded database credentials exposed in 4 files
- **Exposed passwords**: 
  - `qYsSoNHsFiSRLdVzmzHknIBufxqQwmmK` (shuttle.proxy.rlwy.net:57798)
  - `WxSSoUGRLEMHfpxpBfQZoiAvvBdRrDls` (tramway.proxy.rlwy.net:31100)
- **Resolution**: 
  - Removed hardcoded URIs from all files
  - Replaced with `process.env.DATABASE_URL`
  - Created `.env.example` template
  - Updated `.gitignore` to prevent future leaks
  - **STILL REQUIRED**: Rotate database credentials in Railway

### Product Name Change (2025-08-01)
- **Changed**: "Tamarind_Splice" → "Tamarind_Sweets"
- **Files updated**: 6 files across frontend and backend
- **Database**: Created update script but not yet executed

## Current Architecture

### Database
- **Production**: PostgreSQL on Railway
- **Local Development**: SQLite fallback
- **Key Tables**: users, products, sub_products, orders, subscriptions, coupons

### Key Products
- **Tamarind_Sweets** (formerly Tamarind_Splice) - ID: `fixed-tamarind-stew-id`
- **Quantum_Mango** - ID: `fixed-quantum-mango-id`

### Authentication & Security
- JWT tokens with HttpOnly cookies
- Rate limiting with express-rate-limit
- Helmet for security headers
- PayPal integration for payments and subscriptions

## Important File Locations
- **Main server**: `server.js`
- **Database setup**: `postgresql-setup.js`
- **Frontend**: `public/` directory
- **Admin endpoints**: Secured with key `rells-kitchen-admin-2025`

## Development Notes
- **Environment Variables**: Use `.env.example` as template
- **Testing**: Admin endpoints available at `/admin/*` with proper key
- **Git**: Main branch, commits include Claude attribution

## Current Issues

### Products Not Displaying (2025-08-01)
- **Issue**: Website shows "2 Signature Items" but no products display in menu
- **Root Cause**: Frontend/Backend mismatch during product name change attempt
- **Status**: Under investigation
- **API Status**: `/api/products` returns correct data (Tamarind_Splice, Quantum_Mango)
- **Frontend**: Reverted to look for "Tamarind_Splice" to match database
- **Next Steps**: Investigate JavaScript console logs and deployment issues

### USPS Shipping Integration (2025-08-01)
**NEW FEATURE**: Implemented USPS Web Tools API integration with caching
- **Status**: ✅ Developed locally, ❌ NOT deployed to production
- **Credentials Added**: Username `76RELLS62U229`, Password `83282077QJ36LYV` 
- **Issue**: USPS credentials rejected with "Authorization failure" - account needs activation
- **Files Modified**:
  - `usps-integration.js` - Added 10-minute rate caching system
  - `server.js` - Added `/api/calculate-shipping` endpoint
  - `.env` - Added USPS_USERNAME and USPS_PASSWORD
- **Caching Features**:
  - Smart cache keys: `fromZip-toZip-weight-dimensions`
  - 10-minute TTL with automatic cleanup
  - Handles 100+ cache entries efficiently
  - Console logging for cache hits/misses
- **Fallback**: Shows "Hold For Pickup - FREE" when USPS API fails
- **Testing**: ✅ Local server (port 3001), ❌ Production deployment pending
- **Next Steps**: 
  1. Activate USPS Web Tools account at https://registration.shippingapis.com/
  2. Deploy changes to production when credentials work
  3. Test live USPS API integration

## Known Issues / TODO
- [x] Execute database update for product name change (reverted approach)
- [ ] Rotate exposed PostgreSQL credentials  
- [ ] Fix product display issue on live site
- [ ] Plan proper product name change for later
- [ ] **USPS**: Activate Web Tools account credentials
- [ ] **USPS**: Deploy shipping integration to production

## Commands
- **Database Update**: `node update-product-name.js` (requires DATABASE_URL)
- **Admin Access**: Add `?key=rells-kitchen-admin-2025` to admin endpoints
- **USPS Test**: `curl -X POST http://localhost:3001/api/calculate-shipping -H "Content-Type: application/json" -d '{"zipCode":"10001","productSize":"medium","quantity":2}'`
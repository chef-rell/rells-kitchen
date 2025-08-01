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

### USPS Shipping Integration (2025-08-01) - PARTIALLY COMPLETED
**STATUS**: USPS integration developed but DISABLED due to account authorization issues
- **Credentials Added**: Username `76RELLS62U229`, Password `83282077QJ36LYV` 
- **Issue**: USPS credentials rejected - account needs activation
- **Current State**: USPS code commented out in server.js to prevent crashes
- **Files Created**:
  - `usps-integration.js` - Complete USPS API with 10-minute caching (ready when account activated)
  - `tax-calculator.js` - Arkansas 3.125% tax rate system (ACTIVE)
- **Deployment Issue**: Site crashed with USPS integration, so temporarily disabled
- **Next Steps**: 
  1. ✅ Complete tax-only deployment (IN PROGRESS)
  2. Activate USPS Web Tools account later
  3. Re-enable USPS integration when account works

### Tax Calculation System (2025-08-01) - IN PROGRESS
**NEW FEATURE**: Dynamic tax calculation with Arkansas reduced rate
- **Status**: ✅ Code complete, 🔄 Currently deploying tax-only version
- **Arkansas Rate**: 3.125% for jams (reduced food rate)
- **Nexus Management**: Only collects tax where legally required (AR for now)
- **PayPal Integration**: ✅ Modified to include tax_total in breakdown
- **API Endpoints**: 
  - `/api/calculate-order-total` - Combined shipping/tax calculation
  - Modified `/api/calculate-shipping` to use fallback rates (no USPS)
- **Current Work**: Removing USPS dependency while keeping tax functionality
- **Files Modified**: `server.js`, `public/js/payment.js`

### DEPLOYMENT STATUS (2025-08-01) - COMPLETED ✅
- **Issue**: Site crashed when USPS integration was deployed
- **Solution**: Successfully deployed tax-only functionality 
- **Status**: ✅ LIVE AND WORKING - https://www.rellskitchen.com
- **Progress**: 
  - ✅ USPS integration commented out in server.js
  - ✅ Updated order calculation endpoints to work without USPS
  - ✅ Tax-only functionality deployed and tested
  - ✅ Site restored and operational

## Known Issues / TODO
- [x] Execute database update for product name change (reverted approach)
- [ ] Rotate exposed PostgreSQL credentials  
- [ ] Fix product display issue on live site
- [ ] Plan proper product name change for later
- [ ] **USPS**: Activate Web Tools account credentials (Account: 76RELLS62U229)
- [ ] **CURRENT**: Finish tax-only deployment (remove USPS dependencies)
- [ ] **CURRENT**: Add zip-to-state mapping to tax-calculator.js 
- [ ] **CURRENT**: Test and deploy working tax system
- [ ] **LATER**: Re-enable USPS integration when account activated

## Commands
- **Database Update**: `node update-product-name.js` (requires DATABASE_URL)
- **Admin Access**: Add `?key=rells-kitchen-admin-2025` to admin endpoints
- **USPS Test**: `curl -X POST http://localhost:3001/api/calculate-shipping -H "Content-Type: application/json" -d '{"zipCode":"10001","productSize":"medium","quantity":2}'`
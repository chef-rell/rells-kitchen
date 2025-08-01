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

## Known Issues / TODO
- [ ] Execute database update for product name change
- [ ] Rotate exposed PostgreSQL credentials
- [ ] Test product name change on live site

## Commands
- **Database Update**: `node update-product-name.js` (requires DATABASE_URL)
- **Admin Access**: Add `?key=rells-kitchen-admin-2025` to admin endpoints
# Rell's Kitchen - Project Documentation

## Project Overview
Caribbean-Cyberpunk fusion cuisine e-commerce website built with Node.js, Express, and PostgreSQL. Features product catalog, user authentication, PayPal integration, and subscription management.

## Recent Work History

### Security Fixes (2025-08-01) - RESOLVED ✅
- **Issue**: Hardcoded database credentials exposed in 4 files
- **Resolution**: 
  - Removed hardcoded URIs from all files
  - Replaced with `process.env.DATABASE_URL`
  - Created `.env.example` template
  - Updated `.gitignore` to prevent future leaks
  - Database credentials rotated in Railway

### Product Name Change (2025-08-01) - COMPLETED ✅
- **Changed**: "Tamarind_Splice" → "Tamarind_Sweets"
- **Files updated**: 6 files across frontend and backend
- **Database**: Successfully updated

## Current Architecture

### Database
- **Production**: PostgreSQL on Railway (ALWAYS USE THIS)
- **Local Development**: ~~SQLite fallback~~ (NO LONGER USED - Always connect to Railway PostgreSQL)
- **IMPORTANT**: Always use the PostgreSQL database hosted on Railway. Local SQLite is deprecated.
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
- **Database Connection**: ALWAYS use Railway PostgreSQL via DATABASE_URL environment variable
- **NO LOCAL DATABASE**: SQLite is deprecated. All development and testing must use Railway PostgreSQL
- **Testing**: Admin endpoints available at `/admin/*` with proper key
- **Git**: Main branch, commits include Claude attribution

## Completed Systems

### USPS Shipping Integration (2025-08-02) - FULLY OPERATIONAL ✅
**STATUS**: Complete USPS OAuth 2.0 integration with activated account
- **Account**: 76RELLS62U229 - ACTIVATED AND WORKING
- **API**: Migrated from deprecated Web Tools to OAuth 2.0 API
- **Current State**: Live USPS rates being calculated in real-time
- **Performance**: 10-minute rate caching + automatic fallback system
- **Files**:
  - `usps-oauth-integration.js` - OAuth 2.0 API integration (ACTIVE)
  - `usps-integration.js` - Legacy Web Tools API (DEPRECATED)
- **Live Rates**: Ground Advantage ($13.20), Priority Mail ($16.00) for sample ZIP
- **Environment**: Production OAuth API (apis.usps.com)

### Tax Calculation System (2025-08-02) - FULLY OPERATIONAL ✅
**STATUS**: Complete tax system with Arkansas nexus compliance
- **Arkansas Rate**: 4.5% for food items (reduced rate)
- **Integration**: Full PayPal breakdown with itemized tax
- **API Endpoints**:
  - `/api/calculate-order-total` - Combined shipping/tax/discount calculation
  - `/api/calculate-shipping` - USPS rates with fallback
- **Files**: `tax-calculator.js` (ACTIVE)
- **Coverage**: Arkansas only (legal nexus requirement)

### PayPal Payment Integration (2025-08-02) - FULLY OPERATIONAL ✅
**STATUS**: Complete redirect-flow PayPal integration with tax breakdown
- **Flow**: Custom redirect flow (replaced SDK buttons for mobile compatibility)
- **Features**: Tax calculation, shipping integration, discount handling
- **Pages**: 
  - `payment-cancel.html` - Cancellation handling
  - `payment-return.html` - Success processing
- **API Endpoints**:
  - `/api/create-paypal-order` - Order creation with tax/shipping breakdown
  - `/api/capture-paypal-payment` - Payment capture handling
- **Status**: Production-ready with proper error handling

## Admin Management System (2025-08-02) - FULLY COMPLETED ✅
**STATUS**: Complete admin dashboard with persistent database configuration
- **Admin Page**: ✅ Account page styling with tabbed interface - https://www.rellskitchen.com/admin
- **Access Control**: ✅ Database-only admin permissions (chef_IT_admin has access)
- **Order Management**: ✅ View all orders with filtering by status/date  
- **Inventory Tracking**: ✅ Dynamic stock levels with customizable thresholds
- **Notification Settings**: ✅ Email/SMS preferences saved to admin_settings table
- **Stock Threshold**: ✅ Configurable low-stock alerts with database persistence
- **System Monitoring**: ✅ Database, API, and service health checks
- **Data Export**: ✅ CSV order export functionality
- **Security**: ✅ requireAdmin middleware for admin-only routes
- **Database**: ✅ UPSERT operations ensure settings persist properly

**NEXT STEPS** (if session disconnected):
1. **Email Notifications**: Implement nodemailer for admin alerts
   - Install: `npm install nodemailer`
   - Add SMTP configuration (Gmail/SendGrid)
   - Create email templates for new orders and low stock
   - Integrate with order completion and inventory checks
2. **SMS Notifications**: Implement Twilio for critical alerts
   - Install: `npm install twilio`
   - Add Twilio credentials to environment variables
   - Create SMS templates for urgent notifications
   - Add SMS triggers for out-of-stock and order failures
3. **Real-time Notifications**: Add auto-trigger on order completion
   - Hook into PayPal capture success
   - Check inventory levels after each order
   - Send notifications based on admin preferences

## Known Issues / TODO
- [x] Execute database update for product name change (COMPLETED)
- [x] USPS OAuth integration with activated account (COMPLETED)
- [x] Tax calculation system with Arkansas compliance (COMPLETED)  
- [x] PayPal redirect flow integration (COMPLETED)
- [x] Free local pickup shipping option (COMPLETED)
- [x] PayPal payment capture database fixes (COMPLETED)
- [x] Build admin management system (COMPLETED)
- [x] Rotate exposed PostgreSQL credentials (COMPLETED)
- [x] Fix product display issue on live site (COMPLETED)
- [ ] **NEXT**: Implement email notifications for admin alerts
- [ ] Implement SMS notifications for critical alerts
- [ ] Add real-time notifications on order completion

## Current System Status (2025-08-20) ✅
**E-COMMERCE PLATFORM**: Fully operational with complete payment processing
- **Shipping**: Real-time USPS rates via OAuth API + fallback system
- **Tax**: Arkansas 4.5% compliance with proper nexus management (includes shipping in taxable amount)
- **Payment**: PayPal redirect flow with itemized tax/shipping breakdown
- **Database**: PostgreSQL on Railway (PRODUCTION ONLY - no local SQLite)
- **Security**: JWT auth, rate limiting, environment variables
- **Performance**: USPS rate caching, optimized database queries
- **Admin Tools**: Integrated tax tracker for ADAP reporting with auto-sync from database

## Commands
- **Database Update**: `node update-product-name.js` (requires DATABASE_URL)
- **Admin Access**: Add `?key=rells-kitchen-admin-2025` to admin endpoints
- **USPS Test**: `curl -X POST http://localhost:3001/api/calculate-shipping -H "Content-Type: application/json" -d '{"zipCode":"10001","productSize":"medium","quantity":2}'`

## Memory

### Project Memories
- Added memory
- Memory added
- memorize
- website current updates
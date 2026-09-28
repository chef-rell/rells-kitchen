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

### Admin Key Removal (2026-09-27) - RESOLVED ✅
- **Issue**: A shared admin key was hardcoded in `server.js`, in this file, and in `public/js/admin.js` (served publicly to every visitor). The key unlocked `/admin/database/:table`, which returned full rows from `users` and `orders`.
- **Resolution**:
  - All admin routes now use the `requireAdmin` middleware (JWT cookie + `users.role = 'admin'`). There is no admin key anymore; `?key=` is ignored.
  - Deleted `/admin/database/:table` and the one-off rename routes (`/admin/fix-tamarind`, `/admin/check-products`, `/admin/update-product-name`)
  - Tax tracker uses the admin login cookie instead of a key
  - Deleted unused `server-sqlite-backup.js`, `server-sqlite-backup2.js`, `admin-update-product.js`
- **Follow-up (manual)**: The old key remains in git history; treat it as burned and never reuse it. Review Railway logs for past requests to `/admin/database`.

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
- **Admin endpoints**: Require logging in as a user with `role = 'admin'` (`requireAdmin` middleware in `server.js`)

## Development Notes
- **Environment Variables**: Use `.env.example` as template
- **Database Connection**: ALWAYS use Railway PostgreSQL via DATABASE_URL environment variable
- **NO LOCAL DATABASE**: SQLite is deprecated. All development and testing must use Railway PostgreSQL
- **Testing**: Admin endpoints at `/admin/*` and `/api/admin/*` require an admin login session
- **Git**: Main branch, commits include Claude attribution

### Database Schema Notes (CRITICAL for Future Development)
**ORDERS TABLE STRUCTURE** (Railway PostgreSQL):
```sql
-- Columns that EXIST:
id (text), product_id (text), sub_product_id (text), customer_email (text), 
customer_name (text), shipping_street (text), shipping_city (text), 
shipping_state (text), shipping_zip (text), shipping_method (text), 
shipping_cost (numeric), coupon_code (text), coupon_discount (numeric), 
quantity (integer), total_amount (numeric), paypal_order_id (text), 
order_notes (text), status (text), created_at (timestamp)

-- Columns that DO NOT EXIST:
subtotal, price, unit_price, tax_amount
```

**IMPORTANT**: When creating queries against orders table:
- Calculate subtotal from: `total_amount - shipping_cost + coupon_discount`
- Calculate unit_price from: `subtotal / quantity`  
- Calculate tax from: `total_amount - subtotal - shipping_cost + coupon_discount`
- NEVER assume columns exist - always inspect schema first using test endpoint

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
- **Security**: ✅ requireAdmin middleware on every admin route (no shared key)
- **Database**: ✅ UPSERT operations ensure settings persist properly

### Tax Tracker Integration (2025-08-20) - FULLY OPERATIONAL ✅
**STATUS**: Complete ADAP tax reporting system with database integration
- **Admin Integration**: ✅ Tax Tracker button in admin dashboard opens in new tab
- **Database Sync**: ✅ Auto-pulls Arkansas orders from production PostgreSQL database
- **API Endpoint**: ✅ `/api/admin/tax-report` with admin login authentication
- **Data Calculation**: ✅ Reverse-engineers subtotal/tax from total_amount (no separate columns exist)
- **Export Formats**: ✅ CSV, ADAP XML, Monthly Report for Arkansas Department of Finance
- **Date Filtering**: ✅ Current month, last month, or custom date ranges
- **Real Orders**: ✅ Successfully processes 5+ completed Arkansas orders
- **CSP Compliance**: ✅ All JavaScript uses event listeners (no inline handlers)

### Discount and Local Pickup Update (2025-09-26) - COMPLETED ✅
- Coupons and subscriber discounts now apply to products + shipping (not products only)
- `LOCAL_PICKUP` shipping option re-enabled for all users, with pickup policy notice on the payment page

### Seasonal Mode (2025-10-20) - ACTIVE FOR OFF-SEASON
- `SEASONAL_MODE=true` serves `public/seasonal-splash.html` ("See You Next Summer") in place of the storefront
- `/admin*`, `/api*`, `/login`, and `/register` stay reachable while seasonal mode is on
- Middleware must stay before `express.static` in `server.js` or `index.html` is served instead

### Notifications - PARTIALLY BUILT (wiring plan drafted, not yet implemented)
- `notification-service.js` (nodemailer + Twilio) exists, is initialized in `server.js`, and both packages are installed
- Only the admin test endpoints call it (`/admin/test-notification-service`, `/api/admin/test-email`, `/api/admin/test-sms`)
- `sendOrderCompletedAlert(orderData)` and `sendLowStockAlert(name, stock, threshold)` already exist but are never called

#### Current gaps (verified 2026-09-28)
- **No trigger**: `/api/capture-paypal-payment` (`server.js`, the live checkout path used by `payment-return.html`) inserts the order and decrements `sub_products.inventory_count`, then returns without notifying anyone
- **Settings ignored**: the service sends to `process.env.ADMIN_EMAIL` / `ADMIN_PHONE` and never reads `admin_settings`. The dashboard saves these keys, which currently have no effect: `admin_email`, `admin_phone`, `email_new_orders`, `email_low_stock`, `sms_critical_alerts`, `sms_out_of_stock`, `low_stock_threshold`
- **SMS rule hardcoded**: low-stock SMS fires when `stock <= threshold / 2`, unrelated to the `sms_*` toggles
- **No duplicate guard**: nothing stops the same PayPal order from being recorded twice (e.g. reload of `payment-return.html`), which would also duplicate alerts
- **Unescaped HTML**: customer name/email are interpolated directly into the alert email HTML
- **Legacy path**: `/api/process-payment` (SDK-button flow, called only from `public/js/payment.js` `processPayment`) also creates orders; it appears unused since the redirect flow replaced it. Confirm before deciding whether to wire it or delete it

#### Wiring plan (for review; ask before modifying existing code)
1. **Load settings per alert**: add a helper in `server.js` (e.g. `getNotificationSettings()`) that reads `admin_settings` into an object, falling back to env vars and then the seeded defaults. Pass recipient and toggles into the service methods instead of the service reading env vars.
2. **Service changes** (`notification-service.js`):
   - `sendOrderCompletedAlert(orderData, settings)`: email only when `email_new_orders` is true, sent to `settings.admin_email`
   - `sendLowStockAlert(name, stock, threshold, settings)`: email when `email_low_stock`; SMS when `stock === 0 && sms_out_of_stock`, or `stock > 0 && sms_critical_alerts`
   - Add an `escapeHtml` helper for every interpolated value
3. **Order-completed trigger**: in `/api/capture-paypal-payment`, after the order insert and before `res.json`, call the alert without `await` (fire-and-forget with `.catch(console.error)`) so a mail failure never fails or slows checkout.
4. **Low-stock trigger**: change the inventory decrement to `UPDATE ... RETURNING inventory_count`. Alert only when the count crosses the threshold on this order (`before > threshold && after <= threshold`), plus once when it hits 0. This avoids one alert per order while stock is already low.
5. **Duplicate guard** (recommended, small): before inserting, check `orders.paypal_order_id`; if it already exists, return the existing order and skip the insert, inventory decrement, and alerts.
6. **Legacy path**: decide whether `/api/process-payment` and `payment.js processPayment` are removed or get the same wiring.
7. **Verify**: with SMTP/Twilio env vars set on Railway, use the admin test buttons first, then place one small live order (or local pickup) and confirm one email, correct recipient, and inventory/alert behavior at the threshold.

Open decisions for the user: SMS on every new order or only stock alerts? Delete or wire the legacy `/api/process-payment` path? Include the duplicate guard in the same change?

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
- [x] Fix tax calculation to include shipping in taxable amount (COMPLETED)
- [x] Integrate sales tax tracker with order management for ADAP reporting (COMPLETED)
- [x] Discount on products + shipping, re-enable local pickup (COMPLETED 2025-09-26)
- [x] Seasonal splash page (COMPLETED 2025-10-20)
- [x] Remove hardcoded admin key; all admin routes require admin login (COMPLETED 2026-09-27)
- [ ] **NEXT**: Wire notification-service into order completion and low-stock checks (plan drafted in Notifications section; awaiting user decisions)
- [ ] Add automated tests (none exist yet)

## Pending Manual Checks
- Log in as admin, open the Tax Tracker from the dashboard, run one sync (admin-login path of the 2026-09-27 security fix was not tested against the live database)
- Done 2026-09-28: `/admin/database/users` returns 404 in production; Railway logs reviewed, no unauthorized access found

## Reopening Checklist (end of off-season)
1. Set `SEASONAL_MODE=false` in Railway and redeploy
2. Verify USPS OAuth credentials still return live rates (`/api/calculate-shipping`)
3. Verify PayPal credentials with a small live order and capture
4. Confirm product availability and inventory counts in the admin dashboard
5. Decide whether automated order/low-stock notifications must ship before reopening

## Current System Status (2026-09-28)
**E-COMMERCE PLATFORM**: Feature complete; currently closed for the off-season behind the seasonal splash page (`SEASONAL_MODE`)
- **Shipping**: Real-time USPS rates via OAuth API + fallback system
- **Tax**: Arkansas 4.5% compliance with proper nexus management (includes shipping in taxable amount)
- **Payment**: PayPal redirect flow with itemized tax/shipping breakdown
- **Database**: PostgreSQL on Railway (PRODUCTION ONLY - no local SQLite)
- **Security**: JWT auth, role-based admin access, rate limiting, environment variables
- **Performance**: USPS rate caching, optimized database queries
- **Admin Tools**: Integrated tax tracker for ADAP reporting with auto-sync from database

## Commands
- **Database Update**: `node update-product-name.js` (requires DATABASE_URL)
- **Admin Access**: Log in with an admin account (`users.role = 'admin'`), then use `/admin` or call admin endpoints with that session cookie
- **Tax Tracker**: Access via Admin Dashboard → System → Tax Tracker button
- **Database Schema Check**: `GET /api/admin/test-orders` (admin login required)
- **USPS Test**: `curl -X POST http://localhost:3000/api/calculate-shipping -H "Content-Type: application/json" -d '{"zipCode":"10001","productSize":"medium","quantity":2}'`

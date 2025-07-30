class AccountManager {
    constructor() {
        this.currentUser = null;
        this.subscription = null;
        this.orders = [];
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkAuth();
    }

    setupEventListeners() {
        // Tab switching
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabName = e.target.dataset.tab;
                if (tabName) {
                    this.switchTab(tabName);
                }
            });
        });

        // Profile form
        const profileForm = document.getElementById('profile-form');
        if (profileForm) {
            profileForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.updateProfile();
            });
        }

        // Login prompt button
        const loginPromptBtn = document.getElementById('login-prompt-btn');
        if (loginPromptBtn) {
            loginPromptBtn.addEventListener('click', () => {
                this.showAuthModal();
            });
        }
    }

    async checkAuth() {
        try {
            const response = await fetch('/api/user', { credentials: 'include' });
            
            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.user;
                this.subscription = data.user.subscription;
                
                if (this.currentUser.role === 'guest') {
                    this.showLoginRequired();
                } else {
                    this.showAccountContent();
                    this.loadUserData();
                }
            } else {
                this.showLoginRequired();
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            this.showLoginRequired();
        }
    }

    showLoginRequired() {
        document.getElementById('account-content').style.display = 'none';
        document.getElementById('login-required').style.display = 'block';
        
        // Update auth button
        const authBtn = document.getElementById('auth-btn');
        if (authBtn) {
            authBtn.textContent = 'Login';
            authBtn.onclick = () => this.showAuthModal();
        }
    }

    showAccountContent() {
        document.getElementById('account-content').style.display = 'block';
        document.getElementById('login-required').style.display = 'none';
        
        // Update auth button
        const authBtn = document.getElementById('auth-btn');
        if (authBtn) {
            authBtn.textContent = 'Logout';
            authBtn.onclick = () => this.logout();
        }
    }

    switchTab(tabName) {
        // Remove active class from all tabs and panels
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
        
        // Add active class to selected tab and panel
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}-tab`).classList.add('active');
        
        // Load tab-specific data
        if (tabName === 'orders') {
            this.loadOrderHistory();
        } else if (tabName === 'subscription') {
            this.loadSubscriptionInfo();
        }
    }

    loadUserData() {
        if (!this.currentUser) return;
        
        // Populate profile form
        document.getElementById('first-name').value = this.currentUser.first_name || '';
        document.getElementById('last-name').value = this.currentUser.last_name || '';
        document.getElementById('email').value = this.currentUser.email || '';
        document.getElementById('phone').value = this.currentUser.phone || '';
        document.getElementById('address-street').value = this.currentUser.address_street || '';
        document.getElementById('address-city').value = this.currentUser.address_city || '';
        document.getElementById('address-state').value = this.currentUser.address_state || '';
        document.getElementById('address-zip').value = this.currentUser.address_zip || '';
        document.getElementById('birth-month').value = this.currentUser.birth_month || '';
    }

    async updateProfile() {
        const profileData = {
            firstName: document.getElementById('first-name').value,
            lastName: document.getElementById('last-name').value,
            phone: document.getElementById('phone').value,
            addressStreet: document.getElementById('address-street').value,
            addressCity: document.getElementById('address-city').value,
            addressState: document.getElementById('address-state').value,
            addressZip: document.getElementById('address-zip').value,
            birthMonth: document.getElementById('birth-month').value
        };

        try {
            const response = await fetch('/api/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(profileData)
            });

            const result = await response.json();

            if (response.ok) {
                this.showNotification('Profile updated successfully!', 'success');
                // Refresh user data
                this.checkAuth();
            } else {
                this.showNotification(result.error || 'Profile update failed', 'error');
            }
        } catch (error) {
            console.error('Profile update error:', error);
            this.showNotification('Profile update failed. Please try again.', 'error');
        }
    }

    async loadOrderHistory() {
        const ordersList = document.getElementById('orders-list');
        ordersList.innerHTML = '<div class="loading">Loading orders...</div>';

        try {
            const response = await fetch('/api/order-history', { credentials: 'include' });
            const data = await response.json();

            if (response.ok) {
                this.orders = data.orders;
                this.renderOrderHistory();
            } else {
                ordersList.innerHTML = '<div class="error">Failed to load order history</div>';
            }
        } catch (error) {
            console.error('Order history load error:', error);
            ordersList.innerHTML = '<div class="error">Failed to load order history</div>';
        }
    }

    renderOrderHistory() {
        const ordersList = document.getElementById('orders-list');
        
        if (this.orders.length === 0) {
            ordersList.innerHTML = '<div class="no-orders">No orders found</div>';
            return;
        }

        const ordersHTML = this.orders.map(order => {
            const orderDate = new Date(order.created_at).toLocaleDateString();
            const productInfo = order.product_size ? 
                `${order.product_name} (${order.product_size})` : 
                order.product_name;
            
            return `
                <div class="order-item">
                    <div class="order-header">
                        <div class="order-id">Order #${order.id.slice(-8).toUpperCase()}</div>
                        <div class="order-date">${orderDate}</div>
                    </div>
                    <div class="order-details">
                        <div class="order-product">${productInfo}</div>
                        <div class="order-quantity">Qty: ${order.quantity}</div>
                        <div class="order-total">$${parseFloat(order.total_amount).toFixed(2)}</div>
                    </div>
                    <div class="order-status">
                        <span class="status-badge ${order.status}">${order.status.toUpperCase()}</span>
                    </div>
                </div>
            `;
        }).join('');

        ordersList.innerHTML = ordersHTML;
    }

    async loadSubscriptionInfo() {
        const subscriptionStatus = document.getElementById('subscription-status');
        const subscriptionActions = document.getElementById('subscription-actions');
        
        if (this.currentUser.isSubscribed && this.subscription) {
            const subscriptionDate = new Date(this.subscription.started_at);
            
            subscriptionStatus.innerHTML = `
                <div class="subscription-active">
                    <h4>✅ Active Subscription</h4>
                    <p>Started: ${subscriptionDate.toLocaleDateString()}</p>
                    <p>Next Billing: ${this.subscription.next_billing_date ? new Date(this.subscription.next_billing_date).toLocaleDateString() : 'Processing...'}</p>
                    <p>Status: 🎁 Benefits Active - Automatic 10% discount applied at checkout!</p>
                </div>
            `;
            
            subscriptionActions.innerHTML = `
                <button id="cancel-subscription-btn" class="cancel-btn">Cancel Subscription</button>
            `;
            
            document.getElementById('cancel-subscription-btn').addEventListener('click', () => {
                this.cancelSubscription();
            });
        } else {
            subscriptionStatus.innerHTML = `
                <div class="subscription-inactive">
                    <h4>No Active Subscription</h4>
                    <p>Subscribe to unlock supporter benefits!</p>
                </div>
            `;
            
            subscriptionActions.innerHTML = `
                <div id="paypal-button-container-P-7JA37658E8258991HNCEYJMQ"></div>
            `;
            
            this.setupPayPalSubscription();
        }
    }

    setupPayPalSubscription() {
        if (typeof paypal === 'undefined') {
            console.error('PayPal SDK not loaded');
            return;
        }

        paypal.Buttons({
            style: {
                shape: 'pill',
                color: 'gold',
                layout: 'horizontal',
                label: 'subscribe'
            },
            createSubscription: (data, actions) => {
                return actions.subscription.create({
                    plan_id: 'P-7JA37658E8258991HNCEYJMQ'
                });
            },
            onApprove: async (data, actions) => {
                try {
                    const response = await fetch('/api/subscribe', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        credentials: 'include',
                        body: JSON.stringify({
                            subscriptionID: data.subscriptionID
                        })
                    });

                    const result = await response.json();

                    if (response.ok) {
                        this.showNotification('Subscription activated successfully!', 'success');
                        // Refresh user data and subscription info
                        await this.checkAuth();
                        this.loadSubscriptionInfo();
                    } else {
                        this.showNotification(result.error || 'Subscription activation failed', 'error');
                    }
                } catch (error) {
                    console.error('Subscription activation error:', error);
                    this.showNotification('Subscription activation failed. Please try again.', 'error');
                }
            },
            onError: (err) => {
                console.error('PayPal subscription error:', err);
                this.showNotification('Subscription setup failed. Please try again.', 'error');
            }
        }).render('#paypal-button-container-P-7JA37658E8258991HNCEYJMQ');
    }

    async cancelSubscription() {
        if (!confirm('Are you sure you want to cancel your subscription? You will lose access to supporter benefits.')) {
            return;
        }

        try {
            const response = await fetch('/api/cancel-subscription', {
                method: 'POST',
                credentials: 'include'
            });

            const result = await response.json();

            if (response.ok) {
                this.showNotification('Subscription cancelled successfully', 'success');
                await this.checkAuth();
                this.loadSubscriptionInfo();
            } else {
                this.showNotification(result.error || 'Subscription cancellation failed', 'error');
            }
        } catch (error) {
            console.error('Subscription cancellation error:', error);
            this.showNotification('Subscription cancellation failed. Please try again.', 'error');
        }
    }

    async logout() {
        try {
            const response = await fetch('/api/logout', {
                method: 'POST',
                credentials: 'include'
            });

            if (response.ok) {
                window.location.href = '/';
            } else {
                console.error('Logout failed');
            }
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    showAuthModal() {
        // This should trigger the main auth modal from main.js
        if (window.rellsKitchen && typeof window.rellsKitchen.showAuthModal === 'function') {
            window.rellsKitchen.showAuthModal();
        } else {
            // Fallback - redirect to home page
            window.location.href = '/';
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--card-bg);
            border: 2px solid var(--${type === 'success' ? 'success-green' : type === 'error' ? 'error-red' : 'neon-cyan'});
            color: var(--text-light);
            padding: 15px 20px;
            border-radius: 8px;
            font-family: 'Orbitron', monospace;
            font-weight: 600;
            z-index: 1500;
            max-width: 300px;
            box-shadow: 0 10px 30px rgba(0, 245, 255, 0.3);
            animation: slideIn 0.3s ease;
        `;
        
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }
}

// Initialize account manager when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.accountManager = new AccountManager();
});
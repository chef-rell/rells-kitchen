class AdminDashboard {
    constructor() {
        this.currentUser = null;
        this.orders = [];
        this.inventory = [];
        this.init();
    }

    async init() {
        console.log('Initializing Admin Dashboard...');
        
        // Check authentication and admin privileges
        await this.checkAdminAccess();
        
        // Set up tab switching
        this.setupTabs();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Load initial data if admin
        if (this.currentUser && this.currentUser.role === 'admin') {
            await this.loadDashboardData();
        }
    }

    async checkAdminAccess() {
        try {
            const response = await fetch('/api/auth/verify', {
                credentials: 'include'
            });
            
            if (response.ok) {
                this.currentUser = await response.json();
                console.log('Current user:', this.currentUser);
                
                if (this.currentUser.role === 'admin') {
                    document.getElementById('loading-content').style.display = 'none';
                    document.getElementById('admin-content').style.display = 'block';
                    console.log('Admin access granted');
                } else {
                    document.getElementById('loading-content').style.display = 'none';
                    document.getElementById('access-denied').style.display = 'block';
                    console.log('Admin access denied - insufficient privileges');
                }
            } else {
                document.getElementById('loading-content').style.display = 'none';
                document.getElementById('access-denied').style.display = 'block';
                console.log('Admin access denied - not authenticated');
            }
        } catch (error) {
            console.error('Error checking admin access:', error);
            document.getElementById('loading-content').style.display = 'none';
            document.getElementById('access-denied').style.display = 'block';
        }
    }

    setupTabs() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabPanels = document.querySelectorAll('.tab-panel');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');
                
                // Remove active class from all buttons and panels
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabPanels.forEach(panel => panel.classList.remove('active'));
                
                // Add active class to clicked button and corresponding panel
                button.classList.add('active');
                document.getElementById(`${targetTab}-tab`).classList.add('active');
                
                // Load data for the active tab
                this.loadTabData(targetTab);
            });
        });
    }

    setupEventListeners() {
        // Orders management
        document.getElementById('refresh-orders')?.addEventListener('click', () => this.loadOrders());
        document.getElementById('order-status-filter')?.addEventListener('change', () => this.filterOrders());
        document.getElementById('order-date-filter')?.addEventListener('change', () => this.filterOrders());
        
        // Inventory management
        document.getElementById('update-threshold')?.addEventListener('click', () => this.updateStockThreshold());
        
        // Notification settings
        document.getElementById('save-notification-settings')?.addEventListener('click', () => this.saveNotificationSettings());
        
        // Settings
        document.getElementById('test-email')?.addEventListener('click', () => this.testEmailNotification());
        document.getElementById('test-sms')?.addEventListener('click', () => this.testSMSNotification());
        document.getElementById('export-orders')?.addEventListener('click', () => this.exportOrders());
        document.getElementById('backup-data')?.addEventListener('click', () => this.backupDatabase());
        
        // Auth button
        document.getElementById('auth-btn')?.addEventListener('click', () => this.logout());
    }

    async loadDashboardData() {
        console.log('Loading dashboard data...');
        await Promise.all([
            this.loadOrders(),
            this.loadInventory(),
            this.loadNotificationSettings(),
            this.checkSystemStatus()
        ]);
    }

    async loadTabData(tabName) {
        switch(tabName) {
            case 'orders':
                await this.loadOrders();
                break;
            case 'inventory':
                await this.loadInventory();
                break;
            case 'notifications':
                await this.loadNotificationSettings();
                break;
            case 'settings':
                await this.checkSystemStatus();
                break;
        }
    }

    async loadOrders() {
        try {
            const response = await fetch('/api/admin/orders', {
                credentials: 'include'
            });
            
            if (response.ok) {
                this.orders = await response.json();
                this.renderOrders();
            } else {
                throw new Error('Failed to load orders');
            }
        } catch (error) {
            console.error('Error loading orders:', error);
            document.getElementById('orders-list').innerHTML = `
                <div style="text-align: center; padding: 20px; color: var(--error-red);">
                    Error loading orders: ${error.message}
                </div>
            `;
        }
    }

    renderOrders() {
        const ordersList = document.getElementById('orders-list');
        
        if (this.orders.length === 0) {
            ordersList.innerHTML = `
                <div style="text-align: center; padding: 20px; color: var(--text-light);">
                    No orders found
                </div>
            `;
            return;
        }

        const ordersHTML = this.orders.map(order => `
            <div class="orders-item">
                <div class="order-header">
                    <span class="order-id">#${order.id.substring(0, 8)}</span>
                    <span class="order-status status-${order.status}">${order.status.toUpperCase()}</span>
                </div>
                <div class="order-details">
                    <p><strong>Customer:</strong> ${order.customer_email}</p>
                    <p><strong>Product:</strong> ${order.product_name} (${order.size})</p>
                    <p><strong>Quantity:</strong> ${order.quantity}</p>
                    <p><strong>Total:</strong> $${parseFloat(order.total_amount).toFixed(2)}</p>
                    <p><strong>Shipping:</strong> ${order.shipping_method} - $${parseFloat(order.shipping_cost).toFixed(2)}</p>
                    <p><strong>Date:</strong> ${new Date(order.created_at).toLocaleDateString()}</p>
                    ${order.order_notes ? `<p><strong>Notes:</strong> ${order.order_notes}</p>` : ''}
                </div>
            </div>
        `).join('');

        ordersList.innerHTML = ordersHTML;
    }

    filterOrders() {
        const statusFilter = document.getElementById('order-status-filter').value;
        const dateFilter = document.getElementById('order-date-filter').value;
        
        let filteredOrders = [...this.orders];
        
        if (statusFilter) {
            filteredOrders = filteredOrders.filter(order => order.status === statusFilter);
        }
        
        if (dateFilter) {
            const filterDate = new Date(dateFilter);
            filteredOrders = filteredOrders.filter(order => {
                const orderDate = new Date(order.created_at);
                return orderDate.toDateString() === filterDate.toDateString();
            });
        }
        
        // Temporarily update orders for rendering
        const originalOrders = this.orders;
        this.orders = filteredOrders;
        this.renderOrders();
        this.orders = originalOrders;
    }

    async loadInventory() {
        try {
            const response = await fetch('/api/admin/inventory', {
                credentials: 'include'
            });
            
            if (response.ok) {
                this.inventory = await response.json();
                this.renderInventory();
            } else {
                throw new Error('Failed to load inventory');
            }
        } catch (error) {
            console.error('Error loading inventory:', error);
            document.getElementById('inventory-list').innerHTML = `
                <div style="text-align: center; padding: 20px; color: var(--error-red);">
                    Error loading inventory: ${error.message}
                </div>
            `;
        }
    }

    renderInventory() {
        const inventoryList = document.getElementById('inventory-list');
        
        if (this.inventory.length === 0) {
            inventoryList.innerHTML = `
                <div style="text-align: center; padding: 20px; color: var(--text-light);">
                    No inventory data found
                </div>
            `;
            return;
        }

        const inventoryHTML = this.inventory.map(item => {
            const stockClass = item.inventory_count <= 5 ? 'status-failed' : 
                             item.inventory_count <= 10 ? 'status-processing' : 'status-completed';
            
            return `
                <div class="orders-item">
                    <div class="order-header">
                        <span class="order-id">${item.product_name} (${item.size})</span>
                        <span class="order-status ${stockClass}">${item.inventory_count} in stock</span>
                    </div>
                    <div class="order-details">
                        <p><strong>Price:</strong> $${parseFloat(item.price).toFixed(2)}</p>
                        <p><strong>Size:</strong> ${item.size_oz}oz</p>
                        <p><strong>Status:</strong> ${item.inventory_count <= 5 ? 'LOW STOCK' : 
                                                   item.inventory_count <= 10 ? 'MEDIUM STOCK' : 'IN STOCK'}</p>
                    </div>
                </div>
            `;
        }).join('');

        inventoryList.innerHTML = inventoryHTML;
    }

    async updateStockThreshold() {
        const threshold = document.getElementById('low-stock-threshold').value;
        if (!threshold) return;

        try {
            const response = await fetch('/api/admin/stock-threshold', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ threshold: parseInt(threshold) })
            });

            if (response.ok) {
                alert('Stock threshold updated successfully');
                await this.loadInventory();
            } else {
                throw new Error('Failed to update threshold');
            }
        } catch (error) {
            console.error('Error updating threshold:', error);
            alert('Error updating threshold: ' + error.message);
        }
    }

    async loadNotificationSettings() {
        try {
            const response = await fetch('/api/admin/notification-settings', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const settings = await response.json();
                this.populateNotificationSettings(settings);
            }
        } catch (error) {
            console.error('Error loading notification settings:', error);
        }
    }

    populateNotificationSettings(settings) {
        document.getElementById('admin-email').value = settings.email || '';
        document.getElementById('admin-phone').value = settings.phone || '';
        document.getElementById('email-new-orders').checked = settings.emailNewOrders !== false;
        document.getElementById('email-low-stock').checked = settings.emailLowStock !== false;
        document.getElementById('sms-critical-alerts').checked = settings.smsCritical !== false;
        document.getElementById('sms-out-of-stock').checked = settings.smsOutOfStock === true;
    }

    async saveNotificationSettings() {
        const settings = {
            email: document.getElementById('admin-email').value,
            phone: document.getElementById('admin-phone').value,
            emailNewOrders: document.getElementById('email-new-orders').checked,
            emailLowStock: document.getElementById('email-low-stock').checked,
            smsCritical: document.getElementById('sms-critical-alerts').checked,
            smsOutOfStock: document.getElementById('sms-out-of-stock').checked
        };

        try {
            const response = await fetch('/api/admin/notification-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(settings)
            });

            if (response.ok) {
                alert('Notification settings saved successfully');
            } else {
                throw new Error('Failed to save settings');
            }
        } catch (error) {
            console.error('Error saving notification settings:', error);
            alert('Error saving settings: ' + error.message);
        }
    }

    async testEmailNotification() {
        try {
            const response = await fetch('/api/admin/test-email', {
                method: 'POST',
                credentials: 'include'
            });

            if (response.ok) {
                alert('Test email sent successfully');
            } else {
                throw new Error('Failed to send test email');
            }
        } catch (error) {
            console.error('Error sending test email:', error);
            alert('Error sending test email: ' + error.message);
        }
    }

    async testSMSNotification() {
        try {
            const response = await fetch('/api/admin/test-sms', {
                method: 'POST',
                credentials: 'include'
            });

            if (response.ok) {
                alert('Test SMS sent successfully');
            } else {
                throw new Error('Failed to send test SMS');
            }
        } catch (error) {
            console.error('Error sending test SMS:', error);
            alert('Error sending test SMS: ' + error.message);
        }
    }

    async checkSystemStatus() {
        try {
            const response = await fetch('/api/admin/system-status', {
                credentials: 'include'
            });

            if (response.ok) {
                const status = await response.json();
                this.updateSystemStatus(status);
            }
        } catch (error) {
            console.error('Error checking system status:', error);
        }
    }

    updateSystemStatus(status) {
        const statusText = `System Status: ${status.overall}
Database: ${status.database}
USPS API: ${status.usps}
PayPal API: ${status.paypal}
Email Service: ${status.email}
SMS Service: ${status.sms}
Last Updated: ${new Date().toLocaleString()}`;

        document.getElementById('system-status').value = statusText;
    }

    async exportOrders() {
        try {
            const response = await fetch('/api/admin/export-orders', {
                credentials: 'include'
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `orders-${new Date().toISOString().split('T')[0]}.csv`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            } else {
                throw new Error('Failed to export orders');
            }
        } catch (error) {
            console.error('Error exporting orders:', error);
            alert('Error exporting orders: ' + error.message);
        }
    }

    async backupDatabase() {
        try {
            const response = await fetch('/api/admin/backup-database', {
                method: 'POST',
                credentials: 'include'
            });

            if (response.ok) {
                const result = await response.json();
                alert('Database backup completed: ' + result.message);
            } else {
                throw new Error('Failed to backup database');
            }
        } catch (error) {
            console.error('Error backing up database:', error);
            alert('Error backing up database: ' + error.message);
        }
    }

    async logout() {
        try {
            const response = await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });

            if (response.ok) {
                window.location.href = '/';
            }
        } catch (error) {
            console.error('Error logging out:', error);
        }
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AdminDashboard();
});
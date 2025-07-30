class RellsKitchen {
    constructor() {
        this.currentUser = null;
        this.products = [];
        this.currentProduct = null;
        this.init();
    }

    init() {
        console.log('RellsKitchen initializing...');
        this.setupEventListeners();
        this.checkAuthStatus();
        this.loadProducts();
        this.setupBackgroundVideo();
        
        // Cookbook disabled
        // if (window.location.pathname === '/cookbook') {
        //     this.loadCookbook();
        // }
        console.log('RellsKitchen initialized');
    }

    setupBackgroundVideo() {
        const backgroundVideo = document.querySelector('.menu-background-video');
        if (backgroundVideo) {
            backgroundVideo.addEventListener('loadeddata', () => {
                backgroundVideo.playbackRate = 0.4;
            });
        }
    }

    setupEventListeners() {
        console.log('Setting up event listeners...');
        const authBtn = document.getElementById('auth-btn');
        const guestBtn = document.getElementById('guest-btn');
        const authModal = document.getElementById('auth-modal');
        const reservationModal = document.getElementById('reservation-modal');
        const closeButtons = document.querySelectorAll('.close');
        const tabBtns = document.querySelectorAll('.tab-btn');
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        const reservationForm = document.getElementById('reservation-form');
        // const cookbookLoginBtn = document.getElementById('cookbook-login-btn');
        
        console.log('loginForm element:', loginForm);
        console.log('registerForm element:', registerForm);

        if (authBtn) {
            authBtn.addEventListener('click', () => this.showAuthModal());
        }

        if (guestBtn) {
            guestBtn.addEventListener('click', () => this.guestLogin());
        }

        // if (cookbookLoginBtn) {
        //     cookbookLoginBtn.addEventListener('click', () => this.showAuthModal());
        // }

        closeButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.modal').style.display = 'none';
            });
        });

        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        if (loginForm) {
            console.log('Adding submit event listener to login form');
            loginForm.addEventListener('submit', (e) => this.handleAuth(e, true));
        } else {
            console.log('Login form not found!');
        }

        if (registerForm) {
            console.log('Adding submit event listener to register form');
            registerForm.addEventListener('submit', (e) => this.handleAuth(e, false));
        } else {
            console.log('Register form not found!');
        }

        if (reservationForm) {
            reservationForm.addEventListener('submit', (e) => this.handleReservation(e));
        }
    }

    async checkAuthStatus() {
        try {
            const response = await fetch('/api/user', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.user;
                this.updateAuthUI();
            }
        } catch (error) {
            console.log('No active session');
        }
    }

    updateAuthUI() {
        const authBtn = document.getElementById('auth-btn');
        const guestBtn = document.getElementById('guest-btn');
        // const cookbookLink = document.querySelector('.cookbook-link');

        if (this.currentUser) {
            if (authBtn) {
                authBtn.textContent = this.currentUser.role === 'guest' ? 'Guest Mode' : this.currentUser.username.toUpperCase();
                authBtn.onclick = () => this.logout();
            }
            
            if (guestBtn && this.currentUser.role !== 'guest') {
                guestBtn.style.display = 'none';
            }

            // if (cookbookLink && this.currentUser.role === 'guest') {
            //     cookbookLink.style.opacity = '0.6';
            //     cookbookLink.title = 'Member access required';
            // }
        }
    }

    showAuthModal() {
        const modal = document.getElementById('auth-modal');
        if (modal) {
            modal.style.display = 'block';
        }
    }

    switchTab(tab) {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const formContents = document.querySelectorAll('.form-content');

        tabBtns.forEach(btn => btn.classList.remove('active'));
        formContents.forEach(content => content.classList.remove('active'));

        document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
        document.getElementById(`${tab}-form`).classList.add('active');
    }

    async handleAuth(e, isLogin) {
        e.preventDefault();
        console.log('handleAuth called, isLogin:', isLogin);
        
        let formData;
        
        if (isLogin) {
            formData = {
                username: document.getElementById('login-username').value,
                password: document.getElementById('login-password').value
            };
        } else {
            console.log('Collecting registration data...');
            formData = {
                username: document.getElementById('register-username').value,
                email: document.getElementById('register-email').value,
                password: document.getElementById('register-password').value,
                firstName: document.getElementById('register-first-name').value,
                lastName: document.getElementById('register-last-name').value,
                phone: document.getElementById('register-phone').value,
                addressStreet: document.getElementById('register-address-street').value,
                addressCity: document.getElementById('register-address-city').value,
                addressState: document.getElementById('register-address-state').value,
                addressZip: document.getElementById('register-address-zip').value,
                birthMonth: document.getElementById('register-birth-month').value
            };
            console.log('Form data collected:', formData);
        }

        try {
            console.log('Sending request to:', `/api/${isLogin ? 'login' : 'register'}`);
            console.log('Request body:', JSON.stringify(formData));
            
            const response = await fetch(`/api/${isLogin ? 'login' : 'register'}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(formData)
            });

            console.log('Response status:', response.status);
            const data = await response.json();
            console.log('Response data:', data);

            if (response.ok) {
                this.currentUser = data.user;
                this.updateAuthUI();
                document.getElementById('auth-modal').style.display = 'none';
                this.showNotification(`${isLogin ? 'Login' : 'Registration'} successful! Welcome to Rell's Kitchen.`, 'success');
                
                // if (window.location.pathname === '/cookbook') {
                //     this.loadCookbook();
                // }
            } else {
                console.log('Registration failed:', data.error);
                this.showNotification(data.error, 'error');
            }
        } catch (error) {
            console.error('Registration error:', error);
            this.showNotification('Connection error. Please try again.', 'error');
        }
    }

    async guestLogin() {
        try {
            const response = await fetch('/api/guest-login', {
                method: 'POST',
                credentials: 'include'
            });

            const data = await response.json();

            if (response.ok) {
                this.currentUser = data.user;
                this.updateAuthUI();
                this.showNotification('Guest session activated. Limited features available.', 'success');
                
                // if (window.location.pathname === '/cookbook') {
                //     this.loadCookbook();
                // }
            }
        } catch (error) {
            this.showNotification('Failed to create guest session.', 'error');
        }
    }

    async logout() {
        try {
            const response = await fetch('/api/logout', {
                method: 'POST',
                credentials: 'include'
            });

            if (response.ok) {
                this.currentUser = null;
                location.reload();
            }
        } catch (error) {
            this.showNotification('Logout failed.', 'error');
        }
    }

    async loadProducts() {
        try {
            const response = await fetch('/api/products', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                this.products = data.products;
                this.renderProducts();
            }
        } catch (error) {
            console.error('Failed to load products:', error);
        }
    }

    renderProducts() {
        const menuGrid = document.getElementById('menu-grid');
        if (!menuGrid) return;

        menuGrid.innerHTML = this.products.map(product => {
            // Add images for specific products
            let productImage = '';
            if (product.name === 'Tamarind_Splice') {
                productImage = `<div class="product-image">
                    <img src="/images/tamarind_stew.webp" alt="${product.name}" loading="lazy">
                </div>`;
            } else if (product.name === 'Quantum_Mango') {
                productImage = `<div class="product-image">
                    <img src="/images/mango_stew.jpg" alt="${product.name}" loading="lazy">
                </div>`;
            }
            
            return `
            <div class="product-card" data-product-id="${product.id}">
                ${productImage}
                <div class="product-header">
                    <h3 class="product-name">${product.name}</h3>
                    <p class="product-description">${product.description}</p>
                    <div class="product-price">Priced from $${product.price}</div>
                </div>
                <div class="product-stats">
                    <div class="stat-item">
                        <span class="stat-value">${'🌴'.repeat(product.neo_flavor_profile)}</span>
                        <span class="stat-name">Neo-Flavor Profile</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${'⚡'.repeat(product.user_rating)}</span>
                        <span class="stat-name">User Rating</span>
                    </div>
                </div>
                <div class="product-actions">
                    <button class="reserve-btn" data-product-id="${product.id}">
                        Order Now
                    </button>
                </div>
            </div>
            `;
        }).join('');

        // Add event listeners to the order buttons
        const orderButtons = menuGrid.querySelectorAll('.reserve-btn');
        orderButtons.forEach(button => {
            button.addEventListener('click', () => {
                const productId = button.getAttribute('data-product-id');
                this.goToPayment(productId);
            });
        });
    }

    goToPayment(productId) {
        console.log('goToPayment called with productId:', productId);
        const product = this.products.find(p => p.id === productId);
        console.log('Found product:', product);
        
        if (!product) {
            console.log('Product not found');
            return;
        }

        // Check inventory before redirecting
        console.log('Product inventory_count:', product.inventory_count);
        if (product.inventory_count !== undefined && product.inventory_count === 0) {
            this.showNotification('This item is currently out of stock.', 'warning');
            return;
        }

        // Redirect all products to payment page
        window.location.href = `/payment.html?product=${productId}`;
    }

    showReservationModal(productId) {
        if (!this.currentUser) {
            this.showNotification('Please login or use guest mode to make reservations.', 'warning');
            return;
        }

        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        this.currentProduct = product;
        
        document.getElementById('reservation-product-name').textContent = product.name;
        document.getElementById('reservation-product-description').textContent = product.description;
        document.getElementById('reservation-product-price').textContent = `$${product.price}`;
        
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('pickup-date').setAttribute('min', today);
        
        document.getElementById('reservation-modal').style.display = 'block';
    }

    async handleReservation(e) {
        e.preventDefault();

        if (!this.currentProduct || !this.currentUser) {
            this.showNotification('Invalid reservation request.', 'error');
            return;
        }

        const formData = {
            productId: this.currentProduct.id,
            quantity: parseInt(document.getElementById('quantity').value),
            pickupDate: document.getElementById('pickup-date').value,
            notes: document.getElementById('notes').value
        };

        try {
            const response = await fetch('/api/reservations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (response.ok) {
                document.getElementById('reservation-modal').style.display = 'none';
                this.showNotification('Reservation created successfully! We\'ll prepare your order.', 'success');
                document.getElementById('reservation-form').reset();
            } else {
                this.showNotification(data.error, 'error');
            }
        } catch (error) {
            this.showNotification('Reservation failed. Please try again.', 'error');
        }
    }

    // Cookbook functionality disabled
    /* async loadCookbook() {
        const accessDenied = document.getElementById('cookbook-access-denied');
        const recipesSection = document.getElementById('cookbook-recipes');

        if (!this.currentUser || this.currentUser.role === 'guest') {
            if (accessDenied) accessDenied.style.display = 'block';
            if (recipesSection) recipesSection.style.display = 'none';
            return;
        }

        try {
            const response = await fetch('/api/cookbook', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                this.renderRecipes(data.recipes);
                if (accessDenied) accessDenied.style.display = 'none';
                if (recipesSection) recipesSection.style.display = 'block';
            } else {
                if (accessDenied) accessDenied.style.display = 'block';
                if (recipesSection) recipesSection.style.display = 'none';
            }
        } catch (error) {
            console.error('Failed to load cookbook:', error);
        }
    }

    renderRecipes(recipes) {
        const recipesGrid = document.getElementById('recipes-grid');
        if (!recipesGrid) return;

        if (recipes.length === 0) {
            recipesGrid.innerHTML = `
                <div class="cyber-card">
                    <div class="card-header">NO RECIPES FOUND</div>
                    <div class="card-content">
                        <p>The neural cookbook is currently being updated with new recipes.</p>
                        <p>Check back soon for Chef Rell's secret fusion recipes!</p>
                    </div>
                </div>
            `;
            return;
        }

        recipesGrid.innerHTML = recipes.map(recipe => {
            const ingredients = JSON.parse(recipe.ingredients || '[]');
            const instructions = JSON.parse(recipe.instructions || '[]');
            
            return `
                <div class="recipe-card">
                    <div class="recipe-header">
                        <h3 class="recipe-title">${recipe.title}</h3>
                        <div class="recipe-meta">
                            <div class="meta-item">
                                <span>🌴</span>
                                <span>${'★'.repeat(recipe.spice_level)}</span>
                            </div>
                            <div class="meta-item">
                                <span>⏰</span>
                                <span>${recipe.prep_time || 'N/A'} min</span>
                            </div>
                            <div class="meta-item">
                                <span>👨‍🍳</span>
                                <span>${recipe.author}</span>
                            </div>
                        </div>
                    </div>
                    <div class="recipe-content">
                        <h4>Ingredients:</h4>
                        <ul class="ingredients-list">
                            ${ingredients.map(ingredient => `<li>${ingredient}</li>`).join('')}
                        </ul>
                        <h4>Instructions:</h4>
                        <ol class="instructions-list">
                            ${instructions.map(instruction => `<li>${instruction}</li>`).join('')}
                        </ol>
                    </div>
                </div>
            `;
        }).join('');
    } */

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--card-bg);
            border: 2px solid var(--${type === 'success' ? 'success-green' : type === 'error' ? 'error-red' : type === 'warning' ? 'warning-amber' : 'neon-cyan'});
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

let rellsKitchen;

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing RellsKitchen...');
    rellsKitchen = new RellsKitchen();
    window.rellsKitchen = rellsKitchen; // Make it globally accessible
});

const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);
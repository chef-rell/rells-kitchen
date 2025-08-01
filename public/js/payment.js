class PaymentHandler {
    constructor() {
        this.currentProduct = null;
        this.subProducts = [];
        this.selectedSubProduct = null;
        this.quantity = 1;
        this.shippingCost = 0;
        this.shippingMethod = '';
        this.availableShippingRates = [];
        this.shippingZip = '';
        this.couponCode = '';
        this.couponDiscount = 0;
        this.validatedCoupon = null;
        this.currentUser = null;
        this.isSubscriber = false;
        this.subscriberDiscount = 0;
        this.paypalButtonsInitialized = false;
        this.init();
    }

    init() {
        console.log('PaymentHandler initializing...');
        this.loadProductFromURL();
        // Run user subscription check in parallel, don't wait for it
        this.checkUserSubscription().catch(err => {
            console.log('User subscription check failed, continuing anyway:', err);
        });
        this.updateAuthUI();
        this.setupEventListeners();
        this.setupPayPalButtons();
        // Try to populate email and ZIP in case user data loads later
        setTimeout(async () => {
            this.populateUserEmail();
            await this.populateUserZip();
        }, 500);
    }

    loadProductFromURL() {
        console.log('Loading product from URL...');
        console.log('Current URL:', window.location.href);
        
        const urlParams = new URLSearchParams(window.location.search);
        const productId = urlParams.get('product');
        
        console.log('Extracted product ID:', productId);
        
        if (!productId) {
            console.error('No product ID found in URL. Redirecting to home.');
            window.location.href = '/';
            return;
        }

        this.fetchProduct(productId);
    }

    async fetchProduct(productId) {
        try {
            console.log('Fetching product with ID:', productId);
            
            const [productResponse, subProductResponse] = await Promise.all([
                fetch('/api/products', { credentials: 'include' }),
                fetch(`/api/sub-products/${productId}`, { credentials: 'include' })
            ]);

            console.log('Product response status:', productResponse.status);
            console.log('Sub-product response status:', subProductResponse.status);

            if (productResponse.ok && subProductResponse.ok) {
                const productData = await productResponse.json();
                const subProductData = await subProductResponse.json();
                
                console.log('Product data:', productData);
                console.log('Sub-product data:', subProductData);
                
                this.currentProduct = productData.products.find(p => p.id === productId);
                this.subProducts = subProductData.subProducts;
                
                // Ensure all sub-product prices are numbers
                this.subProducts.forEach(subProduct => {
                    subProduct.price = parseFloat(subProduct.price);
                });
                
                console.log('Found current product:', this.currentProduct);
                console.log('Found sub-products:', this.subProducts);
                
                if (!this.currentProduct || this.subProducts.length === 0) {
                    console.error('Product or sub-products not found. Redirecting to home.');
                    window.location.href = '/';
                    return;
                }

                await this.renderProduct();
            } else {
                console.error('API request failed:', {
                    productStatus: productResponse.status,
                    subProductStatus: subProductResponse.status
                });
                window.location.href = '/';
            }
        } catch (error) {
            console.error('Failed to load product:', error);
            window.location.href = '/';
        }
    }

    async checkUserSubscription() {
        try {
            console.log('Checking user subscription status...');
            const response = await fetch('/api/user', { credentials: 'include' });
            
            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.user;
                console.log('User data loaded:', this.currentUser);
                
                if (this.currentUser && this.currentUser.isSubscribed && this.currentUser.subscription) {
                    // Benefits activate immediately upon subscription
                    this.isSubscriber = true;
                    console.log('User qualifies for subscriber discount');
                }
                
                // Update auth UI after getting user data
                this.updateAuthUI();
                this.populateUserEmail();
                await this.populateUserZip();
            } else {
                console.log('User not logged in (401), continuing as guest');
                this.currentUser = null;
                this.updateAuthUI();
            }
        } catch (error) {
            console.log('Could not check subscription status:', error);
            this.currentUser = null;
            this.updateAuthUI(); // Still update UI even if no user
        }
    }

    updateAuthUI() {
        const authBtn = document.getElementById('auth-btn');
        const userStatusSection = document.getElementById('user-status-section');
        const userWelcome = document.getElementById('user-welcome');
        const subscriberStatus = document.getElementById('subscriber-status');
        
        if (this.currentUser) {
            // Update auth button
            if (authBtn) {
                authBtn.textContent = this.currentUser.role === 'guest' ? 'Guest Mode' : this.currentUser.username.toUpperCase();
                authBtn.onclick = () => this.logout();
            }
            
            // Show user status section
            if (userStatusSection) {
                userStatusSection.style.display = 'block';
                
                if (userWelcome) {
                    const welcomeText = this.currentUser.role === 'guest' 
                        ? 'Shopping as Guest'
                        : `Welcome, ${this.currentUser.first_name || this.currentUser.username}!`;
                    userWelcome.textContent = welcomeText;
                }
                
                if (subscriberStatus) {
                    if (this.currentUser.isSubscribed) {
                        subscriberStatus.textContent = '🎁 Supporter Plan Active - 10% Discount Applied!';
                        subscriberStatus.className = 'subscriber-status subscriber';
                    } else if (this.currentUser.role !== 'guest') {
                        subscriberStatus.innerHTML = '💡 <a href="/account" style="color: var(--neon-cyan); text-decoration: none;">Join Supporter Plan</a> for 10% off all purchases';
                        subscriberStatus.className = 'subscriber-status not-subscriber';
                    } else {
                        subscriberStatus.textContent = '';
                    }
                }
            }
        } else {
            // Update auth button for non-logged in users
            if (authBtn) {
                authBtn.textContent = 'Login';
                authBtn.onclick = () => this.showAuthModal();
            }
            
            // Hide user status section
            if (userStatusSection) {
                userStatusSection.style.display = 'none';
            }
        }
    }

    showAuthModal() {
        // This would typically show a login modal
        // For now, redirect to main page where auth modal exists
        window.location.href = '/?auth=login';
    }

    async logout() {
        try {
            const response = await fetch('/api/logout', {
                method: 'POST',
                credentials: 'include'
            });

            if (response.ok) {
                this.currentUser = null;
                this.isSubscriber = false;
                this.subscriberDiscount = 0;
                this.updateAuthUI();
                await this.updateTotalPrice(); // Refresh pricing without subscriber discount
            }
        } catch (error) {
            console.error('Logout failed:', error);
        }
    }

    populateUserEmail() {
        const emailField = document.getElementById('customer-email');
        
        if (emailField && this.currentUser && this.currentUser.email && this.currentUser.role !== 'guest') {
            // Only populate if the field is empty to avoid overwriting user input
            if (!emailField.value.trim()) {
                emailField.value = this.currentUser.email;
                console.log('Auto-populated email for logged-in user:', this.currentUser.email);
            }
        }
    }

    async populateUserZip() {
        const zipField = document.getElementById('shipping-zip');
        
        if (zipField && this.currentUser && this.currentUser.address_zip && this.currentUser.role !== 'guest') {
            // Only populate if the field is empty to avoid overwriting user input
            if (!zipField.value.trim()) {
                zipField.value = this.currentUser.address_zip;
                this.shippingZip = this.currentUser.address_zip;
                console.log('Auto-populated ZIP code for logged-in user:', this.currentUser.address_zip);
                
                // Auto-calculate shipping rates if valid ZIP
                if (this.isValidZipCode(this.currentUser.address_zip) && this.selectedSubProduct) {
                    console.log('Triggering shipping calculation for auto-populated ZIP');
                    // Trigger the shipping calculation
                    await this.calculateShippingRates();
                    // Also update total price with tax calculation
                    await this.updateTotalPrice();
                }
            }
        }
    }

    async renderProduct() {
        const product = this.currentProduct;
        
        // Update product display
        document.getElementById('product-name').textContent = product.name;
        document.getElementById('product-description').textContent = product.description;
        
        // Set product image based on product name
        const productImageEl = document.getElementById('product-image');
        if (product.name === 'Tamarind_Sweets') {
            productImageEl.src = '/images/tamarind_stew.webp';
            productImageEl.alt = product.name;
            productImageEl.style.display = 'block';
        } else if (product.name === 'Quantum_Mango') {
            productImageEl.src = '/images/mango_stew.jpg';
            productImageEl.alt = product.name;
            productImageEl.style.display = 'block';
        } else {
            productImageEl.style.display = 'none';
        }
        
        // Populate size dropdown
        this.renderSizeOptions();
        
        // Select first available size by default
        if (this.subProducts.length > 0) {
            this.selectedSubProduct = this.subProducts[0];
            // Set initial quantity to 1
            this.quantity = 1;
            document.getElementById('quantity').value = this.quantity;
            await this.updateProductDetails();
            // Calculate initial shipping cost
            this.calculateShippingCost();
        }
    }
    
    renderSizeOptions() {
        const sizeSelect = document.getElementById('size-select');
        sizeSelect.innerHTML = '';
        
        this.subProducts.forEach(subProduct => {
            const option = document.createElement('option');
            option.value = subProduct.id;
            option.textContent = `${subProduct.size} - $${subProduct.price}`;
            option.dataset.price = subProduct.price;
            option.dataset.inventory = subProduct.inventory_count;
            sizeSelect.appendChild(option);
        });
    }
    
    async updateProductDetails() {
        if (!this.selectedSubProduct) return;
        
        document.getElementById('unit-price').textContent = `$${parseFloat(this.selectedSubProduct.price).toFixed(2)}`;
        document.getElementById('inventory-count').textContent = this.selectedSubProduct.inventory_count || 0;
        
        // Set quantity limits based on inventory only
        const quantityInput = document.getElementById('quantity');
        const maxQty = Math.min(this.selectedSubProduct.inventory_count || 1, 3);
        
        quantityInput.min = 1;
        quantityInput.max = maxQty;
        
        // Reset quantity if current is above maximum
        if (this.quantity > maxQty) {
            this.quantity = maxQty;
            quantityInput.value = this.quantity;
        }
        
        await this.updateTotalPrice();
        
        // Check inventory availability
        if (!this.selectedSubProduct.inventory_count || this.selectedSubProduct.inventory_count === 0) {
            this.showOutOfStock();
        }
    }

    setupEventListeners() {
        const quantityInput = document.getElementById('quantity');
        const decreaseBtn = document.getElementById('decrease-qty');
        const increaseBtn = document.getElementById('increase-qty');
        const sizeSelect = document.getElementById('size-select');

        // Size selection change
        sizeSelect.addEventListener('change', async () => {
            const selectedId = sizeSelect.value;
            this.selectedSubProduct = this.subProducts.find(sp => sp.id === selectedId);
            
            // Keep current quantity or set to 1 if not set
            if (!this.quantity) {
                this.quantity = 1;
                quantityInput.value = this.quantity;
            }
            
            await this.updateProductDetails();
            
            // Recalculate shipping for new size
            if (this.shippingZip && this.isValidZipCode(this.shippingZip)) {
                this.calculateShippingRates();
            }
        });

        quantityInput.addEventListener('change', async () => {
            this.quantity = parseInt(quantityInput.value);
            await this.updateTotalPrice();
            
            // Recalculate shipping for new quantity
            if (this.shippingZip && this.isValidZipCode(this.shippingZip)) {
                this.calculateShippingRates();
            }
        });

        decreaseBtn.addEventListener('click', async () => {
            if (this.quantity > 1) {
                this.quantity--;
                quantityInput.value = this.quantity;
                await this.updateTotalPrice();
                
                // Recalculate shipping for new quantity
                if (this.shippingZip && this.isValidZipCode(this.shippingZip)) {
                    this.calculateShippingRates();
                }
            }
        });

        increaseBtn.addEventListener('click', async () => {
            const maxQty = Math.min(this.selectedSubProduct?.inventory_count || 1, 3);
            if (this.quantity < maxQty) {
                this.quantity++;
                quantityInput.value = this.quantity;
                await this.updateTotalPrice();
                
                // Recalculate shipping for new quantity
                if (this.shippingZip && this.isValidZipCode(this.shippingZip)) {
                    this.calculateShippingRates();
                }
            }
        });

        // Shipping method change
        const shippingMethodSelect = document.getElementById('shipping-method');
        if (shippingMethodSelect) {
            shippingMethodSelect.addEventListener('change', async () => {
                this.shippingMethod = shippingMethodSelect.value;
                await this.calculateShippingCost();
            });
        }

        // Coupon code application
        const applyCouponBtn = document.getElementById('apply-coupon');
        const couponInput = document.getElementById('coupon-code');
        
        if (applyCouponBtn && couponInput) {
            applyCouponBtn.addEventListener('click', () => {
                this.applyCoupon();
            });
            
            couponInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.applyCoupon();
                }
            });
        }

        // Email field validation
        const emailField = document.getElementById('customer-email');
        if (emailField) {
            emailField.addEventListener('input', () => {
                // Clear error styling when user starts typing
                emailField.style.borderColor = '';
            });
        }

        // ZIP code input and shipping calculation
        const zipField = document.getElementById('shipping-zip');
        if (zipField) {
            zipField.addEventListener('input', async () => {
                // Clear error styling when user starts typing
                zipField.style.borderColor = '';
                this.shippingZip = zipField.value.trim();
                
                // Auto-calculate shipping when valid ZIP entered
                if (this.isValidZipCode(this.shippingZip)) {
                    await this.calculateShippingRates();
                } else if (this.shippingZip.length === 0) {
                    // Clear shipping options when ZIP is empty
                    await this.clearShippingOptions();
                }
            });

            zipField.addEventListener('blur', () => {
                // Validate ZIP code format on blur
                if (this.shippingZip && !this.isValidZipCode(this.shippingZip)) {
                    zipField.style.borderColor = 'var(--error-red)';
                    this.showNotification('Please enter a valid 5-digit ZIP code', 'error');
                }
            });
        }

    }

    async updateTotalPrice() {
        if (!this.selectedSubProduct) return;
        
        const subtotal = (this.selectedSubProduct.price * this.quantity).toFixed(2);
        const couponDiscountAmount = this.calculateCouponDiscount(subtotal);
        
        // Calculate subscriber discount
        let subscriberDiscountAmount = 0;
        if (this.isSubscriber) {
            subscriberDiscountAmount = parseFloat(subtotal) * 0.10; // 10% discount
            this.subscriberDiscount = subscriberDiscountAmount;
        }
        
        // Get tax information if ZIP code is available
        let taxAmount = 0;
        let taxLabel = 'Tax:';
        const zipField = document.getElementById('shipping-zip');
        const shippingZip = zipField ? zipField.value.trim() : '';
        
        if (shippingZip && this.isValidZipCode(shippingZip)) {
            try {
                const taxResponse = await fetch('/api/calculate-order-total', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        zipCode: shippingZip,
                        productSize: this.selectedSubProduct.size.toLowerCase(),
                        quantity: this.quantity,
                        productPrice: this.selectedSubProduct.price
                    })
                });
                
                if (taxResponse.ok) {
                    const taxData = await taxResponse.json();
                    taxAmount = taxData.tax.taxAmount || 0;
                    if (taxAmount > 0) {
                        taxLabel = `Tax (${taxData.tax.reason}):`;
                    }
                }
            } catch (error) {
                console.warn('Tax calculation failed:', error);
            }
        }
        
        const total = (parseFloat(subtotal) + this.shippingCost + taxAmount - couponDiscountAmount - subscriberDiscountAmount).toFixed(2);
        
        document.getElementById('display-quantity').textContent = this.quantity;
        document.getElementById('subtotal-price').textContent = `$${subtotal}`;
        document.getElementById('shipping-cost').textContent = this.shippingCost > 0 ? `$${this.shippingCost.toFixed(2)}` : 'FREE';
        
        // Update tax display
        if (taxAmount > 0) {
            document.getElementById('tax-line').style.display = 'flex';
            document.getElementById('tax-label').textContent = taxLabel;
            document.getElementById('tax-amount').textContent = `$${taxAmount.toFixed(2)}`;
        } else {
            document.getElementById('tax-line').style.display = 'none';
        }
        
        // Update subscriber discount display
        if (this.isSubscriber && subscriberDiscountAmount > 0) {
            document.getElementById('subscriber-discount-line').style.display = 'flex';
            document.getElementById('subscriber-discount').textContent = `-$${subscriberDiscountAmount.toFixed(2)}`;
        } else {
            document.getElementById('subscriber-discount-line').style.display = 'none';
        }
        
        // Update coupon discount display
        if (couponDiscountAmount > 0) {
            document.getElementById('coupon-discount-line').style.display = 'flex';
            document.getElementById('coupon-discount').textContent = `-$${couponDiscountAmount.toFixed(2)}`;
        } else {
            document.getElementById('coupon-discount-line').style.display = 'none';
        }
        
        document.getElementById('total-price').textContent = `$${total}`;
    }

    async applyCoupon() {
        const couponInput = document.getElementById('coupon-code');
        const couponStatus = document.getElementById('coupon-status');
        const enteredCode = couponInput.value.trim();
        
        if (!enteredCode) {
            this.showCouponStatus('Please enter a coupon code', 'error');
            return;
        }
        
        if (!this.selectedSubProduct) {
            this.showCouponStatus('Please select a product first', 'error');
            return;
        }
        
        const subtotal = (this.selectedSubProduct.price * this.quantity).toFixed(2);
        
        try {
            this.showCouponStatus('Validating coupon...', 'info');
            
            const response = await fetch('/api/validate-coupon', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    code: enteredCode,
                    subtotal: subtotal
                })
            });
            
            const data = await response.json();
            
            if (response.ok && data.valid) {
                this.couponCode = data.code;
                this.validatedCoupon = data;
                await this.updateTotalPrice();
                this.showCouponStatus(`Coupon applied! ${data.discountValue}% off`, 'success');
            } else {
                this.couponCode = '';
                this.validatedCoupon = null;
                await this.updateTotalPrice();
                this.showCouponStatus(data.error || 'Invalid coupon code', 'error');
            }
        } catch (error) {
            console.error('Coupon validation error:', error);
            this.showCouponStatus('Unable to validate coupon. Please try again.', 'error');
        }
    }

    calculateCouponDiscount(subtotal) {
        if (!this.couponCode || !this.validatedCoupon) {
            return 0;
        }
        
        // Use the server-validated discount amount
        if (this.validatedCoupon.discountType === 'percentage') {
            return (parseFloat(subtotal) * this.validatedCoupon.discountValue / 100);
        } else if (this.validatedCoupon.discountType === 'fixed') {
            return Math.min(this.validatedCoupon.discountValue, parseFloat(subtotal));
        }
        
        return 0;
    }

    showCouponStatus(message, type) {
        const couponStatus = document.getElementById('coupon-status');
        couponStatus.textContent = message;
        couponStatus.className = `coupon-status ${type}`;
        
        // Clear status after 3 seconds
        setTimeout(() => {
            couponStatus.textContent = '';
            couponStatus.className = 'coupon-status';
        }, 3000);
    }

    setupPayPalButtons() {
        console.log('Setting up PayPal buttons with production client ID...');
        
        // Prevent multiple initialization
        if (this.paypalButtonsInitialized) {
            console.log('PayPal buttons already initialized, skipping...');
            return;
        }
        
        try {
            // Clear any existing PayPal button container content
            const paypalContainer = document.getElementById('paypal-button-container');
            if (paypalContainer) {
                paypalContainer.innerHTML = '';
            }

            paypal.Buttons({
            style: {
                layout: 'vertical',
                color: 'blue',
                shape: 'rect',
                label: 'paypal'
            },
            createOrder: async (data, actions) => {
                const emailField = document.getElementById('customer-email');
                const zipField = document.getElementById('shipping-zip');
                const customerEmail = emailField.value.trim();
                const shippingZip = zipField.value.trim();
                
                // Clear any previous error styling
                emailField.style.borderColor = '';
                zipField.style.borderColor = '';
                
                if (!customerEmail) {
                    this.showNotification('Please enter your email address before proceeding.', 'error');
                    emailField.style.borderColor = 'var(--error-red)';
                    emailField.focus();
                    return Promise.reject(new Error('Missing email address'));
                }
                
                // Basic email validation
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(customerEmail)) {
                    this.showNotification('Please enter a valid email address.', 'error');
                    emailField.style.borderColor = 'var(--error-red)';
                    emailField.focus();
                    return Promise.reject(new Error('Invalid email address'));
                }

                if (!shippingZip) {
                    this.showNotification('Please enter your ZIP code before proceeding.', 'error');
                    zipField.style.borderColor = 'var(--error-red)';
                    zipField.focus();
                    return Promise.reject(new Error('Missing ZIP code'));
                }

                if (!this.isValidZipCode(shippingZip)) {
                    this.showNotification('Please enter a valid 5-digit ZIP code.', 'error');
                    zipField.style.borderColor = 'var(--error-red)';
                    zipField.focus();
                    return Promise.reject(new Error('Invalid ZIP code'));
                }

                if (!this.shippingMethod || this.availableShippingRates.length === 0) {
                    this.showNotification('Please wait for shipping options to load or refresh the page.', 'error');
                    return Promise.reject(new Error('No shipping method selected'));
                }

                if (!this.selectedSubProduct) {
                    this.showNotification('Please select a size before proceeding.', 'error');
                    return Promise.reject(new Error('No product selected'));
                }

                // Calculate tax for the order using server-side tax calculator
                const subtotal = parseFloat((this.selectedSubProduct.price * this.quantity).toFixed(2));
                const couponDiscountAmount = parseFloat(this.calculateCouponDiscount(subtotal).toFixed(2));
                const subscriberDiscountAmount = this.isSubscriber ? parseFloat((subtotal * 0.10).toFixed(2)) : 0;
                const totalDiscountAmount = couponDiscountAmount + subscriberDiscountAmount;
                const shippingCost = parseFloat(this.shippingCost.toFixed(2));
                
                // Get tax information from server
                let taxAmount = 0;
                let taxRate = 0;
                try {
                    const taxResponse = await fetch('/api/calculate-order-total', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            zipCode: shippingZip,
                            productSize: this.selectedSubProduct.size.toLowerCase(),
                            quantity: this.quantity,
                            productPrice: this.selectedSubProduct.price
                        })
                    });
                    
                    if (taxResponse.ok) {
                        const taxData = await taxResponse.json();
                        taxAmount = taxData.tax.taxAmount || 0;
                        taxRate = taxData.tax.taxRate || 0;
                        console.log('Tax calculation:', taxData.tax);
                    } else {
                        console.warn('Tax calculation failed, proceeding without tax');
                    }
                } catch (error) {
                    console.warn('Tax calculation error:', error);
                }
                
                const total = parseFloat((subtotal + shippingCost + taxAmount - totalDiscountAmount).toFixed(2));

                // Ensure total is positive
                if (parseFloat(total) <= 0) {
                    this.showNotification('Order total must be greater than $0.00', 'error');
                    return Promise.reject(new Error('Invalid order total'));
                }

                console.log('Creating PayPal order with:', {
                    subtotal: subtotal,
                    couponDiscountAmount: couponDiscountAmount,
                    subscriberDiscountAmount: subscriberDiscountAmount,
                    totalDiscountAmount: totalDiscountAmount,
                    shippingCost: this.shippingCost,
                    taxAmount: taxAmount,
                    taxRate: taxRate,
                    total: total,
                    productName: this.currentProduct.name,
                    productSize: this.selectedSubProduct.size,
                    quantity: this.quantity
                });

                const breakdown = {
                    item_total: {
                        currency_code: "USD",
                        value: subtotal.toFixed(2)
                    },
                    shipping: {
                        currency_code: "USD",
                        value: shippingCost.toFixed(2)
                    }
                };

                // Add tax to breakdown if applicable
                if (taxAmount > 0) {
                    breakdown.tax_total = {
                        currency_code: "USD",
                        value: taxAmount.toFixed(2)
                    };
                }

                // Add discount to breakdown if any discounts are applied
                if (totalDiscountAmount > 0) {
                    breakdown.discount = {
                        currency_code: "USD",
                        value: totalDiscountAmount.toFixed(2)
                    };
                }

                const orderRequest = {
                    purchase_units: [{
                        amount: {
                            value: total.toFixed(2),
                            breakdown: breakdown
                        },
                        items: [{
                            name: `${this.currentProduct.name} (${this.selectedSubProduct.size})`,
                            quantity: this.quantity.toString(),
                            unit_amount: {
                                currency_code: "USD",
                                value: parseFloat(this.selectedSubProduct.price).toFixed(2)
                            }
                        }],
                        description: `${this.currentProduct.name} (${this.selectedSubProduct.size}) x${this.quantity} - Rell's Kitchen`,
                        custom_id: `${this.selectedSubProduct.id}_${this.quantity}_${Date.now()}`
                    }]
                };

                // Verify the math before sending to PayPal
                const calculatedTotal = subtotal + shippingCost - totalDiscountAmount;
                const expectedTotal = parseFloat(total.toFixed(2));
                
                console.log('PayPal math verification:', {
                    subtotal: subtotal,
                    shippingCost: shippingCost,
                    couponDiscountAmount: couponDiscountAmount,
                    subscriberDiscountAmount: subscriberDiscountAmount,
                    totalDiscountAmount: totalDiscountAmount,
                    calculatedTotal: calculatedTotal,
                    expectedTotal: expectedTotal,
                    mathCheck: Math.abs(calculatedTotal - expectedTotal) < 0.01
                });
                
                if (Math.abs(calculatedTotal - expectedTotal) >= 0.01) {
                    console.error('PayPal amount mismatch detected before sending');
                    this.showNotification('Calculation error. Please refresh and try again.', 'error');
                    return Promise.reject(new Error('Amount calculation error'));
                }
                
                console.log('PayPal order request:', JSON.stringify(orderRequest, null, 2));
                
                return actions.order.create(orderRequest).catch(error => {
                    console.error('PayPal order creation failed:', error);
                    this.showNotification('Failed to create payment order. Please try again.', 'error');
                    throw error;
                });
            },
            onApprove: async (data, actions) => {
                try {
                    const order = await actions.order.capture();
                    
                    // Calculate final shipping cost based on PayPal shipping address
                    const shippingAddress = order.purchase_units[0]?.shipping?.address;
                    if (shippingAddress) {
                        try {
                            const finalShippingCost = this.calculateFinalShippingCost(shippingAddress);
                            this.shippingCost = finalShippingCost;
                        } catch (error) {
                            console.error('Shipping validation failed:', error);
                            this.showNotification(error.message, 'error');
                            return;
                        }
                    }
                    
                    await this.processPayment(order);
                } catch (error) {
                    console.error('Payment capture failed:', error);
                    this.showNotification('Payment processing failed. Please try again.', 'error');
                }
            },
            onError: (err) => {
                console.error('PayPal error:', err);
                this.showNotification('Payment failed. Please try again.', 'error');
            },
            onCancel: (data) => {
                this.showNotification('Payment cancelled.', 'info');
            }
        }).render('#paypal-button-container').then(() => {
            console.log('PayPal buttons rendered successfully');
            this.paypalButtonsInitialized = true;
        }).catch(error => {
            console.error('Failed to render PayPal buttons:', error);
            this.paypalButtonsInitialized = false;
            this.showPayPalError();
        });
        
        } catch (error) {
            console.error('Error setting up PayPal buttons:', error);
            this.showPayPalError();
        }
    }
    
    showPayPalError() {
        const container = document.getElementById('paypal-button-container');
        if (container) {
            container.innerHTML = `
                <div class="product-card">
                    <div class="product-header">
                        <h3 class="product-name">PAYMENT ERROR</h3>
                    </div>
                    <div class="card-content" style="padding: 25px;">
                        <div class="form-row">
                            <div class="input-group full-width">
                                <input type="text" value="⚠️ Payment System Unavailable" readonly style="color: var(--error-red); font-weight: bold;">
                                <label>Status</label>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="input-group full-width">
                                <textarea readonly style="height: 60px;">Payment processing is temporarily unavailable. Please refresh the page or contact us directly to complete your order.</textarea>
                                <label>Information</label>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="input-group">
                                <input type="text" value="(501) 760-9490" readonly>
                                <label>Phone</label>
                            </div>
                            <div class="input-group">
                                <input type="text" value="sales@rellskitchen.com" readonly>
                                <label>Email</label>
                            </div>
                        </div>
                        <div style="text-align: center; margin-top: 20px;">
                            <button onclick="window.location.reload()" class="submit-btn">Refresh Page</button>
                            <a href="tel:(501)760-9490" class="submit-btn" style="background: rgba(0, 245, 255, 0.1); border: 1px solid var(--neon-cyan); margin-left: 10px;">Call Us</a>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    async processPayment(paypalOrder) {
        console.log('Processing payment with PayPal order:', JSON.stringify(paypalOrder, null, 2));
        
        const customerEmail = document.getElementById('customer-email').value;
        const orderNotes = document.getElementById('order-notes').value;

        // Extract shipping address from PayPal order data
        const paypalShipping = paypalOrder.purchase_units[0]?.shipping?.address;
        const shippingAddress = paypalShipping ? {
            street: paypalShipping.address_line_1 || '',
            city: paypalShipping.admin_area_2 || '',
            state: paypalShipping.admin_area_1 || '',
            zip: paypalShipping.postal_code || ''
        } : {
            // Fallback address for testing when PayPal doesn't provide shipping
            street: 'No address provided',
            city: 'Test City',
            state: 'AR',
            zip: '72000'
        };

        console.log('Extracted shipping address:', shippingAddress);
        
        // Extract customer name from PayPal data
        const paypalPayer = paypalOrder.payer;
        const customerName = paypalPayer ? `${paypalPayer.name?.given_name || ''} ${paypalPayer.name?.surname || ''}`.trim() : 'PayPal Customer';
        
        console.log('Extracted customer name:', customerName);

        // Validate required data
        if (!customerEmail) {
            this.showNotification('Missing email address', 'error');
            return;
        }

        if (!this.selectedSubProduct || !this.currentProduct) {
            this.showNotification('Missing product information', 'error');
            return;
        }

        const subtotal = (this.selectedSubProduct.price * this.quantity).toFixed(2);
        const couponDiscount = this.calculateCouponDiscount(subtotal);
        const subscriberDiscount = this.isSubscriber ? parseFloat(subtotal) * 0.10 : 0;

        const orderData = {
            subProductId: this.selectedSubProduct.id,
            productId: this.currentProduct.id,
            quantity: this.quantity,
            customerEmail,
            customerName,
            customerPhone: '', // Not collected in form, use empty string
            orderNotes,
            shippingAddress,
            shippingMethod: this.shippingMethod,
            shippingCost: this.shippingCost,
            couponCode: this.couponCode,
            couponDiscount: couponDiscount,
            isSubscriber: this.isSubscriber,
            subscriberDiscount: subscriberDiscount,
            paypalOrderId: paypalOrder.id,
            paypalData: paypalOrder
        };

        try {
            console.log('Sending order data to server:', orderData);
            
            const response = await fetch('/api/process-payment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(orderData)
            });

            console.log('Server response status:', response.status);
            
            const result = await response.json();
            console.log('Server response data:', result);

            if (response.ok) {
                this.showSuccessPage(result);
            } else {
                console.error('Server error:', result);
                this.showNotification(result.error || `Payment processing failed (${response.status}).`, 'error');
            }
        } catch (error) {
            console.error('Order processing failed:', error);
            this.showNotification('Order processing failed. Please contact support.', 'error');
        }
    }

    showSuccessPage(orderData) {
        document.querySelector('.menu-section').innerHTML = `
            <video class="menu-background-video" autoplay muted>
                <source src="/images/palm-trees-and-futuristic-neon-lit-cabanas-glow-on-a-tropical-beach_preview.mp4" type="video/mp4">
            </video>
            <div class="container">
                <h2 class="section-title">Order <span class="usvi-accent">Complete</span></h2>
                <div class="product-card">
                    <div class="product-header">
                        <h3 class="product-name">ORDER CONFIRMATION</h3>
                    </div>
                    <div class="card-content" style="padding: 25px;">
                        <div class="form-row">
                            <div class="input-group full-width">
                                <input type="text" value="✅ Payment Successful" readonly style="color: var(--success-green); font-weight: bold;">
                                <label>Status</label>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="input-group">
                                <input type="text" value="${orderData.orderId}" readonly>
                                <label>Order ID</label>
                            </div>
                            <div class="input-group">
                                <input type="text" value="$${(this.selectedSubProduct.price * this.quantity + this.shippingCost - this.calculateCouponDiscount((this.selectedSubProduct.price * this.quantity).toFixed(2)) - (this.isSubscriber ? parseFloat((this.selectedSubProduct.price * this.quantity).toFixed(2)) * 0.10 : 0)).toFixed(2)}" readonly>
                                <label>Total Paid</label>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="input-group">
                                <input type="text" value="${this.currentProduct.name}" readonly>
                                <label>Product</label>
                            </div>
                            <div class="input-group">
                                <input type="text" value="${this.selectedSubProduct.size} (Qty: ${this.quantity})" readonly>
                                <label>Size & Quantity</label>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="input-group full-width">
                                <textarea readonly style="height: 80px;">📧 Confirmation email sent
👨‍🍳 Chef Rell will prepare your order  
📱 You'll receive local USPS pickup or shipping notification within 48 hours
🕒 Pickup hours: Mon-Fri 10AM-3PM CST</textarea>
                                <label>Next Steps</label>
                            </div>
                        </div>
                        <div style="text-align: center; margin-top: 20px;">
                            <a href="/" class="submit-btn" style="margin-right: 10px;">Continue Shopping</a>
                            <a href="/account" class="submit-btn" style="background: rgba(0, 245, 255, 0.1); border: 1px solid var(--neon-cyan);">View Account</a>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    showOutOfStock() {
        document.querySelector('.paypal-container').innerHTML = `
            <div class="product-card">
                <div class="product-header">
                    <h3 class="product-name">ITEM UNAVAILABLE</h3>
                </div>
                <div class="card-content" style="padding: 25px;">
                    <div class="form-row">
                        <div class="input-group full-width">
                            <input type="text" value="❌ Out of Stock" readonly style="color: var(--error-red); font-weight: bold;">
                            <label>Status</label>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="input-group full-width">
                            <textarea readonly style="height: 60px;">This item is currently unavailable. Please check back later or contact us for availability updates.</textarea>
                            <label>Information</label>
                        </div>
                    </div>
                    <div style="text-align: center; margin-top: 20px;">
                        <a href="/" class="submit-btn">Back to Menu</a>
                        <a href="mailto:sales@rellskitchen.com" class="submit-btn" style="background: rgba(0, 245, 255, 0.1); border: 1px solid var(--neon-cyan); margin-left: 10px;">Contact Us</a>
                    </div>
                </div>
            </div>
        `;
    }

    async calculateShippingCost() {
        // Get shipping cost from selected option
        const shippingSelect = document.getElementById('shipping-method');
        if (shippingSelect && this.shippingMethod) {
            const selectedRate = this.availableShippingRates.find(rate => rate.service === this.shippingMethod);
            if (selectedRate) {
                this.shippingCost = selectedRate.cost;
            }
        }
        
        await this.updateTotalPrice();
    }

    async calculateShippingRates() {
        if (!this.selectedSubProduct || !this.shippingZip) {
            return;
        }

        console.log('Calculating shipping rates for:', {
            zip: this.shippingZip,
            productSize: this.selectedSubProduct.size,
            quantity: this.quantity
        });

        const loadingEl = document.getElementById('shipping-loading');
        const errorEl = document.getElementById('shipping-error');
        const shippingSelect = document.getElementById('shipping-method');

        // Show loading state
        if (loadingEl) loadingEl.style.display = 'block';
        if (errorEl) errorEl.style.display = 'none';

        try {
            const response = await fetch('/api/calculate-shipping', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    zipCode: this.shippingZip,
                    productSize: this.selectedSubProduct.size,
                    quantity: this.quantity
                })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.availableShippingRates = data.rates;
                await this.populateShippingOptions(data.rates, data.fallback);
                
                if (data.fallback) {
                    console.warn('Using fallback shipping rates:', data.error);
                }
            } else {
                throw new Error(data.error || 'Failed to calculate shipping rates');
            }

        } catch (error) {
            console.error('Shipping calculation failed:', error);
            await this.showShippingError();
        } finally {
            if (loadingEl) loadingEl.style.display = 'none';
        }
    }

    async populateShippingOptions(rates, isFallback = false) {
        const shippingSelect = document.getElementById('shipping-method');
        if (!shippingSelect) return;

        // Clear existing options
        shippingSelect.innerHTML = '';

        // Add shipping options
        rates.forEach((rate, index) => {
            const option = document.createElement('option');
            option.value = rate.service;
            option.textContent = `${rate.description} - ${rate.cost > 0 ? '$' + rate.cost.toFixed(2) : 'FREE'}`;
            option.dataset.cost = rate.cost;
            option.dataset.deliveryTime = rate.deliveryTime;
            
            // Select Ground Advantage by default, or first option if not available
            if (rate.service === 'USPS_GROUND_ADVANTAGE' || (index === 0 && !rates.find(r => r.service === 'USPS_GROUND_ADVANTAGE'))) {
                option.selected = true;
                this.shippingMethod = rate.service;
                this.shippingCost = rate.cost;
            }
            
            shippingSelect.appendChild(option);
        });

        // Add fallback notice if using fallback rates
        if (isFallback) {
            const notice = document.createElement('option');
            notice.disabled = true;
            notice.textContent = '--- Live rates unavailable, using standard rates ---';
            notice.style.fontStyle = 'italic';
            shippingSelect.insertBefore(notice, shippingSelect.firstChild);
        }

        await this.updateTotalPrice();
    }

    async clearShippingOptions() {
        const shippingSelect = document.getElementById('shipping-method');
        if (shippingSelect) {
            shippingSelect.innerHTML = '<option value="" disabled selected>Enter ZIP code to see shipping options</option>';
        }
        
        this.availableShippingRates = [];
        this.shippingMethod = '';
        this.shippingCost = 0;
        await this.updateTotalPrice();
    }

    async showShippingError() {
        const errorEl = document.getElementById('shipping-error');
        if (errorEl) {
            errorEl.style.display = 'block';
        }

        // Show fallback options
        const fallbackRates = [
            {
                service: 'GROUND_ADVANTAGE',
                name: 'Ground Advantage',
                cost: 9.95,
                deliveryTime: '2-5 business days',
                description: 'Ground Advantage (2-5 business days) - $9.95'
            },
            {
                service: 'PRIORITY_MAIL',
                name: 'Priority Mail',
                cost: 18.50,
                deliveryTime: '1-3 business days',
                description: 'Priority Mail (1-3 business days) - $18.50'
            }
        ];

        this.availableShippingRates = fallbackRates;
        await this.populateShippingOptions(fallbackRates, true);
    }

    isValidZipCode(zip) {
        return /^\d{5}(-\d{4})?$/.test(zip);
    }
    
    calculateFinalShippingCost(shippingAddress) {
        // Calculate final shipping cost based on PayPal address data
        const state = shippingAddress.admin_area_1?.toLowerCase();
        const zip = shippingAddress.postal_code;
        
        // Get base shipping method cost
        const shippingSelect = document.getElementById('shipping-method');
        let baseCost = 0;
        if (shippingSelect) {
            const selectedOption = shippingSelect.querySelector(`option[value="${this.shippingMethod}"]`);
            if (selectedOption) {
                baseCost = parseFloat(selectedOption.dataset.cost) || 0;
            }
        }

        // If pickup method, no shipping costs
        if (this.shippingMethod === 'pickup') {
            return 0;
        }
        
        // Validate and adjust costs based on location
        if (state && zip) {
            if (!this.isValidShippingLocation(state, zip)) {
                throw new Error('We only ship to the United States and U.S. Virgin Islands.');
            }
            return this.adjustShippingCostByLocation(state, zip, baseCost);
        }
        
        return baseCost;
    }

    isValidShippingLocation(state, zip) {
        // U.S. States and territories
        const validStates = [
            'alabama', 'al', 'alaska', 'ak', 'arizona', 'az', 'arkansas', 'ar', 'california', 'ca',
            'colorado', 'co', 'connecticut', 'ct', 'delaware', 'de', 'florida', 'fl', 'georgia', 'ga',
            'hawaii', 'hi', 'idaho', 'id', 'illinois', 'il', 'indiana', 'in', 'iowa', 'ia',
            'kansas', 'ks', 'kentucky', 'ky', 'louisiana', 'la', 'maine', 'me', 'maryland', 'md',
            'massachusetts', 'ma', 'michigan', 'mi', 'minnesota', 'mn', 'mississippi', 'ms',
            'missouri', 'mo', 'montana', 'mt', 'nebraska', 'ne', 'nevada', 'nv', 'new hampshire', 'nh',
            'new jersey', 'nj', 'new mexico', 'nm', 'new york', 'ny', 'north carolina', 'nc',
            'north dakota', 'nd', 'ohio', 'oh', 'oklahoma', 'ok', 'oregon', 'or', 'pennsylvania', 'pa',
            'rhode island', 'ri', 'south carolina', 'sc', 'south dakota', 'sd', 'tennessee', 'tn',
            'texas', 'tx', 'utah', 'ut', 'vermont', 'vt', 'virginia', 'va', 'washington', 'wa',
            'west virginia', 'wv', 'wisconsin', 'wi', 'wyoming', 'wy',
            // U.S. Virgin Islands
            'virgin islands', 'vi', 'usvi', 'u.s. virgin islands',
            // Other territories
            'puerto rico', 'pr', 'guam', 'gu', 'american samoa', 'as', 'northern mariana islands', 'mp'
        ];

        // Basic ZIP code validation (5 digits or 5+4 format)
        const zipRegex = /^\d{5}(-\d{4})?$/;
        if (!zipRegex.test(zip)) {
            return false;
        }

        // U.S.V.I. specific ZIP codes (008xx)
        if (zip.startsWith('008')) {
            return ['virgin islands', 'vi', 'usvi', 'u.s. virgin islands'].includes(state);
        }

        return validStates.includes(state);
    }

    adjustShippingCostByLocation(state, zip, baseCost) {
        // U.S. Virgin Islands - higher shipping cost
        if (['virgin islands', 'vi', 'usvi', 'u.s. virgin islands'].includes(state) || zip.startsWith('008')) {
            return baseCost + 15.00; // Additional $15 for USVI
        }

        // Alaska and Hawaii - higher shipping cost
        if (['alaska', 'ak', 'hawaii', 'hi'].includes(state)) {
            return baseCost + 10.00; // Additional $10 for AK/HI
        }

        // Other territories
        if (['puerto rico', 'pr', 'guam', 'gu', 'american samoa', 'as', 'northern mariana islands', 'mp'].includes(state)) {
            return baseCost + 12.00; // Additional $12 for other territories
        }

        // Continental US - base cost
        return baseCost;
    }

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

// Initialize payment handler when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing PaymentHandler...');
    new PaymentHandler();
});

// Debug PayPal SDK loading
window.addEventListener('load', () => {
    console.log('Window loaded, PayPal available:', typeof paypal !== 'undefined');
    if (typeof paypal !== 'undefined') {
        console.log('PayPal SDK version:', paypal.version);
    }
});


const nodemailer = require('nodemailer');
const twilio = require('twilio');

class NotificationService {
  constructor() {
    // Initialize email transporter
    this.emailTransporter = null;
    this.twilioClient = null;
    
    this.initializeEmailService();
    this.initializeSMSService();
  }

  initializeEmailService() {
    try {
      // Only initialize if credentials are provided
      if (process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD) {
        this.emailTransporter = nodemailer.createTransporter({
          service: 'gmail',
          auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD // App-specific password for Gmail
          }
        });
        
        console.log('✅ Email service initialized');
      } else {
        console.log('⚠️ Email service not configured - missing SMTP credentials');
      }
    } catch (error) {
      console.error('❌ Error initializing email service:', error.message);
      this.emailTransporter = null;
    }
  }

  initializeSMSService() {
    try {
      if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        this.twilioClient = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );
        console.log('✅ SMS service initialized');
      } else {
        console.log('⚠️ SMS service not configured - missing Twilio credentials');
      }
    } catch (error) {
      console.error('❌ Error initializing SMS service:', error.message);
    }
  }

  async sendTestEmail(recipientEmail = null) {
    if (!this.emailTransporter) {
      throw new Error('Email service not configured - missing SMTP credentials');
    }

    const recipient = recipientEmail || process.env.ADMIN_EMAIL || 'admin@rellskitchen.com';

    console.log('📧 Preparing test email...');
    console.log('📧 From:', process.env.SMTP_EMAIL);
    console.log('📧 To:', recipient);

    const mailOptions = {
      from: process.env.SMTP_EMAIL || 'noreply@rellskitchen.com',
      to: recipient,
      subject: '🧪 Test Email - Rell\'s Kitchen Admin',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #00f5ff;">🏝️ Rell's Kitchen Admin Test</h2>
          <p>This is a test email from your Rell's Kitchen admin dashboard.</p>
          <p><strong>Test Details:</strong></p>
          <ul>
            <li>Sent: ${new Date().toLocaleString()}</li>
            <li>Service: Email Notifications</li>
            <li>Status: ✅ Working</li>
            <li>From: ${process.env.SMTP_EMAIL}</li>
          </ul>
          <p style="color: #666; font-size: 12px;">
            Caribbean • Cyberpunk • Fusion<br>
            Neo-Caribbean cuisine from the future
          </p>
        </div>
      `
    };

    try {
      console.log('📧 Attempting to send email via Gmail SMTP...');
      const result = await this.emailTransporter.sendMail(mailOptions);
      console.log('✅ Test email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('❌ Gmail SMTP Error:', error.message);
      
      // Provide specific error messages for common Gmail issues
      if (error.code === 'EAUTH') {
        throw new Error('Gmail authentication failed - check app password');
      } else if (error.code === 'ENOTFOUND') {
        throw new Error('Gmail SMTP server not found - check internet connection');
      } else if (error.responseCode === 535) {
        throw new Error('Gmail login failed - invalid email or app password');
      } else if (error.responseCode === 534) {
        throw new Error('Gmail requires app-specific password - regular password not allowed');
      } else {
        throw new Error(`Gmail SMTP Error: ${error.message} (Code: ${error.code})`);
      }
    }
  }

  async sendTestSMS(recipientPhone = null) {
    if (!this.twilioClient) {
      throw new Error('SMS service not configured');
    }

    const recipient = recipientPhone || process.env.ADMIN_PHONE || '+15017609490';

    const message = await this.twilioClient.messages.create({
      body: `🧪 Test SMS from Rell's Kitchen Admin\n\nThis is a test message sent at ${new Date().toLocaleString()}.\n\n🏝️ Caribbean • Cyberpunk • Fusion`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: recipient
    });

    console.log('✅ Test SMS sent:', message.sid);
    return message;
  }

  async sendLowStockAlert(productName, currentStock, threshold) {
    const alerts = [];

    // Send email alert
    if (this.emailTransporter) {
      try {
        const mailOptions = {
          from: process.env.SMTP_EMAIL || 'noreply@rellskitchen.com',
          to: process.env.ADMIN_EMAIL || 'admin@rellskitchen.com',
          subject: '⚠️ Low Stock Alert - Rell\'s Kitchen',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #ff6b35;">⚠️ Low Stock Alert</h2>
              <p><strong>${productName}</strong> is running low on inventory.</p>
              <p><strong>Current Stock:</strong> ${currentStock} units</p>
              <p><strong>Alert Threshold:</strong> ${threshold} units</p>
              <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
              <p>Please restock this item soon to avoid stockouts.</p>
              <p style="color: #666; font-size: 12px;">
                🏝️ Rell's Kitchen Admin System<br>
                Caribbean • Cyberpunk • Fusion
              </p>
            </div>
          `
        };

        const emailResult = await this.emailTransporter.sendMail(mailOptions);
        alerts.push({ type: 'email', success: true, messageId: emailResult.messageId });
      } catch (error) {
        alerts.push({ type: 'email', success: false, error: error.message });
      }
    }

    // Send SMS alert for critical low stock
    if (this.twilioClient && currentStock <= Math.floor(threshold / 2)) {
      try {
        const smsMessage = await this.twilioClient.messages.create({
          body: `🚨 CRITICAL: ${productName} only has ${currentStock} units left! (Threshold: ${threshold})`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: process.env.ADMIN_PHONE || '+15017609490'
        });

        alerts.push({ type: 'sms', success: true, messageId: smsMessage.sid });
      } catch (error) {
        alerts.push({ type: 'sms', success: false, error: error.message });
      }
    }

    return alerts;
  }

  async sendOrderCompletedAlert(orderData) {
    const alerts = [];

    // Send email notification
    if (this.emailTransporter) {
      try {
        const mailOptions = {
          from: process.env.SMTP_EMAIL || 'noreply@rellskitchen.com',
          to: process.env.ADMIN_EMAIL || 'admin@rellskitchen.com',
          subject: '✅ New Order Completed - Rell\'s Kitchen',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #00f5ff;">✅ New Order Completed</h2>
              <p><strong>Order ID:</strong> ${orderData.id}</p>
              <p><strong>Customer:</strong> ${orderData.customerName} (${orderData.customerEmail})</p>
              <p><strong>Product:</strong> ${orderData.productName}</p>
              <p><strong>Quantity:</strong> ${orderData.quantity}</p>
              <p><strong>Total:</strong> $${parseFloat(orderData.totalAmount).toFixed(2)}</p>
              <p><strong>Shipping:</strong> ${orderData.shippingMethod}</p>
              <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
              <p style="color: #666; font-size: 12px;">
                🏝️ Rell's Kitchen Admin System<br>
                Caribbean • Cyberpunk • Fusion
              </p>
            </div>
          `
        };

        const emailResult = await this.emailTransporter.sendMail(mailOptions);
        alerts.push({ type: 'email', success: true, messageId: emailResult.messageId });
      } catch (error) {
        alerts.push({ type: 'email', success: false, error: error.message });
      }
    }

    return alerts;
  }

  getServiceStatus() {
    return {
      email: {
        configured: !!this.emailTransporter,
        service: 'Gmail SMTP'
      },
      sms: {
        configured: !!this.twilioClient,
        service: 'Twilio'
      }
    };
  }
}

module.exports = NotificationService;
// server.js - Updated for Docker container with local Chrome and QR Code support
const express = require('express');
const { create } = require('@wppconnect-team/wppconnect');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Store active sessions
const sessions = new Map();
const sessionTokens = new Map();

// Chrome executable path from environment or default
const CHROME_EXECUTABLE_PATH = process.env.CHROME_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable';

// Generate session ID
function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

// Store session tokens for persistence
function storeSessionToken(sessionId, phoneNumber, token) {
    const tokenData = {
        sessionId,
        phoneNumber,
        token,
        timestamp: new Date().toISOString()
    };
    
    const tokenPath = path.join(__dirname, 'tokens', `${sessionId}.json`);
    
    // Ensure tokens directory exists
    if (!fs.existsSync(path.join(__dirname, 'tokens'))) {
        fs.mkdirSync(path.join(__dirname, 'tokens'), { recursive: true });
    }
    
    fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2));
    sessionTokens.set(sessionId, tokenData);
    return tokenData;
}

// Load existing session token
function loadSessionToken(sessionId) {
    const tokenPath = path.join(__dirname, 'tokens', `${sessionId}.json`);
    
    if (fs.existsSync(tokenPath)) {
        try {
            const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
            sessionTokens.set(sessionId, tokenData);
            return tokenData;
        } catch (error) {
            console.error('Error loading session token:', error);
        }
    }
    return null;
}

// Store user credentials securely
function storeUserCredentials(sessionId, phoneNumber, credentials) {
    const credData = {
        sessionId,
        phoneNumber,
        credentials,
        timestamp: new Date().toISOString()
    };
    
    const credPath = path.join(__dirname, 'credentials', `${sessionId}.json`);
    
    // Ensure credentials directory exists
    if (!fs.existsSync(path.join(__dirname, 'credentials'))) {
        fs.mkdirSync(path.join(__dirname, 'credentials'), { recursive: true });
    }
    
    fs.writeFileSync(credPath, JSON.stringify(credData, null, 2));
    return credData;
}

// Initialize WhatsApp connection with local Chrome
async function initializeWhatsApp(phoneNumber, sessionId, useQR = false) {
    try {
        console.log(`Initializing WhatsApp for phone: ${phoneNumber}, session: ${sessionId}, useQR: ${useQR}`);
        console.log(`Using Chrome executable: ${CHROME_EXECUTABLE_PATH}`);
        
        // Load existing token if available
        const existingToken = loadSessionToken(sessionId);
        
        const client = await create({
            session: sessionId,
            multiDevice: true, // Enable multidevice support
            folderNameToken: path.join(__dirname, 'tokens'),
            mkdirFolderToken: path.join(__dirname, 'tokens'),
            headless: true,
            devtools: false,
            useChrome: true,
            debug: false,
            logQR: true,
            disableSpins: true,
            disableWelcome: true,
            autoClose: 0, // Don't auto-close
            createPathFileToken: true,
            waitForLogin: true,
            executablePath: CHROME_EXECUTABLE_PATH,
            
            // Connection method - QR code or pairing code
            linkingMethod: useQR ? 'qr-code' : 'pairing-code',
            
            // Enhanced browser arguments for Docker container
            browserArgs: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--disable-web-security',
    '--disable-features=VizDisplayCompositor',
    '--window-size=1366,768',
    '--no-first-run',
    '--disable-extensions',
    '--disable-plugins',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-field-trial-config',
    '--disable-back-forward-cache',
    '--disable-ipc-flooding-protection',
    '--disable-background-networking',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-features=AudioServiceOutOfProcess',
    '--disable-hang-monitor',
    '--disable-print-preview',
    '--disable-prompt-on-repost',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--no-default-browser-check',
    '--no-pings',
    '--password-store=basic',
    '--use-mock-keychain',
    '--single-process',

    // ✅ Spoofed user-agent for Microsoft Edge with Samuel name
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Samuel/117.0.0.0 Chrome/117.0.0.0 Safari/537.36 Edg/117.0.2045.31'
],
            
            puppeteerOptions: {
                headless: true,
                executablePath: CHROME_EXECUTABLE_PATH,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--single-process'
                ],
                defaultViewport: {
                    width: 1366,
                    height: 768
                },
                timeout: 60000
            },
            
            // QR Code handler
            catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
    console.log('QR Code generated for session:', sessionId);
    console.log('QR Code attempts:', attempts);

    const session = sessions.get(sessionId);
    if (session) {
        QRCode.toDataURL(urlCode, { margin: 1 }, (err, dataUrl) => {
            if (err) {
                console.error('Failed to generate QR image:', err);
                return;
            }
            session.qrCode = dataUrl.replace(/^data:image\/png;base64,/, '');
        });
        session.qrAttempts = attempts;
        session.qrUrl = urlCode;
        session.status = 'qr_code_ready';
        session.qrCodeExpiry = new Date(Date.now() + 60000); // 1 minute
        sessions.set(sessionId, session);
        console.log('QR Code stored for session:', sessionId);
    }
},
            // Pairing code handler
            catchPairingCode: (pairingCode) => {
                console.log('Pairing code generated for session:', sessionId, 'Code:', pairingCode);
                
                const session = sessions.get(sessionId);
                if (session) {
                    session.pairingCode = pairingCode;
                    session.status = 'pairing_code_ready';
                    session.pairingCodeExpiry = new Date(Date.now() + 300000); // 5 minutes expiry
                    sessions.set(sessionId, session);
                    
                    console.log('Pairing code stored for session:', sessionId);
                }
            },
            
            // Status handler
            statusFind: (statusSession, session) => {
                console.log('Status Session:', statusSession);
                console.log('Session name:', session);
                
                const sessionData = sessions.get(sessionId);
                if (sessionData) {
                    sessionData.status = statusSession;
                    sessions.set(sessionId, sessionData);
                }
            },
            
            // Loading handler
            onLoadingScreen: (percent, message) => {
                console.log(`Loading: ${percent}% - ${message}`);
                const session = sessions.get(sessionId);
                if (session) {
                    session.loadingPercent = percent;
                    session.loadingMessage = message;
                    sessions.set(sessionId, session);
                }
            }
        });

        // Store session
        sessions.set(sessionId, {
            client,
            phoneNumber,
            status: 'connecting',
            connectionMethod: useQR ? 'qr-code' : 'pairing-code',
            qrCode: null,
            qrAttempts: 0,
            qrUrl: null,
            qrCodeExpiry: null,
            pairingCode: null,
            pairingCodeExpiry: null,
            loadingPercent: 0,
            loadingMessage: '',
            timestamp: new Date()
        });

        // Handle state changes
        client.onStateChange((state) => {
            console.log('State changed:', state);
            const session = sessions.get(sessionId);
            if (session) {
                session.status = state;
                sessions.set(sessionId, session);
                
                // Handle successful connection
                if (state === 'CONNECTED') {
                    console.log('Successfully connected to WhatsApp');
                    sendCredentialsToUser(client, phoneNumber, sessionId);
                    
                    // Store session token for persistence
                    client.getSessionTokenBrowser().then(token => {
                        if (token) {
                            storeSessionToken(sessionId, phoneNumber, token);
                        }
                    }).catch(console.error);
                }
            }
        });

        // Enhanced message handler
        client.onMessage(async (message) => {
            console.log('Message received:', message.from, message.body);
        });

        // Handle disconnection
        client.onInChat((chatId) => {
            console.log('In chat:', chatId);
        });

        // Handle authentication failure
        client.onAck((ack) => {
            console.log('Message ACK:', ack);
        });

        // Start the client
        await client.start();
        
        console.log('Client started successfully');
        
        return client;
    } catch (error) {
        console.error('Error initializing WhatsApp:', error);
        
        // Update session with error
        const session = sessions.get(sessionId);
        if (session) {
            session.status = 'error';
            session.error = error.message;
            sessions.set(sessionId, session);
        }
        
        throw error;
    }
}

// Send credentials to user's WhatsApp
async function sendCredentialsToUser(client, phoneNumber, sessionId) {
    try {
        const credentials = {
            sessionId,
            phoneNumber,
            connectionTime: new Date().toISOString(),
            serverEnvironment: 'Docker Container'
        };

        // Store credentials
        const credData = storeUserCredentials(sessionId, phoneNumber, credentials);

        // Format message
        const message = `🔐 *WhatsApp Connection Successful*\n\n` +
                       `Session ID: ${sessionId}\n` +
                       `Phone: ${phoneNumber}\n` +
                       `Connected: ${new Date().toLocaleString()}\n` +
                       `Server: Docker Container\n\n` +
                       `*Save these credentials for future connections*\n\n` +
                       `⚠️ Keep this information secure and don't share with others.`;

        // Send message to user
        const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
        await client.sendText(chatId, message);
        
        console.log('Credentials sent to user:', phoneNumber);
    } catch (error) {
        console.error('Error sending credentials:', error);
    }
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize connection
app.post('/api/connect', async (req, res) => {
    try {
        const { phoneNumber, method = 'pairing-code' } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Format phone number
        let formattedPhone = phoneNumber.replace(/\D/g, '');
        
        // Basic validation for country code
        if (formattedPhone.length < 10) {
            return res.status(400).json({ error: 'Invalid phone number format' });
        }
        
        // Generate session ID
        const sessionId = generateSessionId();
        
        // Validate method
        const useQR = method === 'qr-code';
        
        // Store initial session info
        sessions.set(sessionId, {
            phoneNumber: formattedPhone,
            status: 'initializing',
            connectionMethod: method,
            qrCode: null,
            qrAttempts: 0,
            qrUrl: null,
            qrCodeExpiry: null,
            pairingCode: null,
            pairingCodeExpiry: null,
            loadingPercent: 0,
            loadingMessage: '',
            timestamp: new Date()
        });

        // Initialize WhatsApp connection in background
        setImmediate(async () => {
            try {
                await initializeWhatsApp(formattedPhone, sessionId, useQR);
            } catch (error) {
                console.error('Background initialization error:', error);
                const session = sessions.get(sessionId);
                if (session) {
                    session.status = 'error';
                    session.error = error.message;
                    sessions.set(sessionId, session);
                }
            }
        });

        res.json({
            success: true,
            sessionId,
            method,
            message: `Connection process started using ${method}. Please wait...`
        });
    } catch (error) {
        console.error('Connect error:', error);
        res.status(500).json({ error: 'Failed to initialize connection' });
    }
});

// Check connection status
app.get('/api/status/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    // Check if client is still connected
    let isConnected = false;
    if (session.client && session.status === 'CONNECTED') {
        try {
            isConnected = await session.client.isConnected();
            if (!isConnected) {
                session.status = 'disconnected';
                sessions.set(sessionId, session);
            }
        } catch (error) {
            console.error('Error checking connection status:', error);
            session.status = 'error';
            session.error = error.message;
            sessions.set(sessionId, session);
        }
    }

    // Check if QR code or pairing code has expired
    let qrExpired = false;
    let pairingExpired = false;
    
    if (session.qrCodeExpiry) {
        qrExpired = new Date() > session.qrCodeExpiry;
    }
    
    if (session.pairingCodeExpiry) {
        pairingExpired = new Date() > session.pairingCodeExpiry;
    }

    res.json({
        sessionId,
        phoneNumber: session.phoneNumber,
        status: session.status,
        connectionMethod: session.connectionMethod,
        qrCode: session.qrCode,
        qrAttempts: session.qrAttempts,
        qrUrl: session.qrUrl,
        qrExpired,
        pairingCode: session.pairingCode,
        pairingExpired,
        loadingPercent: session.loadingPercent,
        loadingMessage: session.loadingMessage,
        isConnected,
        timestamp: session.timestamp,
        error: session.error || null
    });
});

// Generate new QR code
app.post('/api/generate-qr/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (session.connectionMethod !== 'qr-code') {
        return res.status(400).json({ error: 'Session is not using QR code method' });
    }

    try {
        if (session.client && session.client.getQR) {
            const qrData = await session.client.getQR();
            if (qrData) {
                session.qrCode = qrData;
                session.qrCodeExpiry = new Date(Date.now() + 60000); // 1 minute expiry
                sessions.set(sessionId, session);
                
                res.json({
                    success: true,
                    qrCode: qrData,
                    message: 'New QR code generated'
                });
            } else {
                res.status(500).json({ error: 'Failed to generate QR code' });
            }
        } else {
            res.status(400).json({ error: 'QR code generation not available' });
        }
    } catch (error) {
        console.error('QR generation error:', error);
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// Generate new pairing code
app.post('/api/generate-pairing-code/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (session.connectionMethod !== 'pairing-code') {
        return res.status(400).json({ error: 'Session is not using pairing code method' });
    }

    try {
        if (session.client && session.client.getPairingCode) {
            const pairingCode = await session.client.getPairingCode();
            if (pairingCode) {
                session.pairingCode = pairingCode;
                session.pairingCodeExpiry = new Date(Date.now() + 300000); // 5 minutes expiry
                sessions.set(sessionId, session);
                
                res.json({
                    success: true,
                    pairingCode: pairingCode,
                    message: 'New pairing code generated'
                });
            } else {
                res.status(500).json({ error: 'Failed to generate pairing code' });
            }
        } else {
            res.status(400).json({ error: 'Pairing code generation not available' });
        }
    } catch (error) {
        console.error('Pairing code generation error:', error);
        res.status(500).json({ error: 'Failed to generate pairing code' });
    }
});

// Restart session
app.post('/api/restart/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    try {
        // Close existing client
        if (session.client) {
            await session.client.close();
        }

        // Reset session status
        session.status = 'initializing';
        session.qrCode = null;
        session.qrAttempts = 0;
        session.qrCodeExpiry = null;
        session.pairingCode = null;
        session.pairingCodeExpiry = null;
        session.error = null;
        session.client = null;
        sessions.set(sessionId, session);

        // Restart connection
        const useQR = session.connectionMethod === 'qr-code';
        setImmediate(async () => {
            try {
                await initializeWhatsApp(session.phoneNumber, sessionId, useQR);
            } catch (error) {
                console.error('Restart error:', error);
                session.status = 'error';
                session.error = error.message;
                sessions.set(sessionId, session);
            }
        });

        res.json({ success: true, message: 'Session restart initiated' });
    } catch (error) {
        console.error('Restart error:', error);
        res.status(500).json({ error: 'Failed to restart session' });
    }
});

// Get session credentials
app.get('/api/credentials/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const credPath = path.join(__dirname, 'credentials', `${sessionId}.json`);
    
    if (!fs.existsSync(credPath)) {
        return res.status(404).json({ error: 'Credentials not found' });
    }

    try {
        const credData = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        res.json(credData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read credentials' });
    }
});

// Disconnect session
app.post('/api/disconnect/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    try {
        if (session.client) {
            await session.client.close();
        }
        sessions.delete(sessionId);
        
        // Clean up token file
        const tokenPath = path.join(__dirname, 'tokens', `${sessionId}.json`);
        if (fs.existsSync(tokenPath)) {
            fs.unlinkSync(tokenPath);
        }
        
        res.json({ success: true, message: 'Session disconnected' });
    } catch (error) {
        console.error('Disconnect error:', error);
        res.status(500).json({ error: 'Failed to disconnect session' });
    }
});

// Send test message
app.post('/api/send-message/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { to, message } = req.body;
    
    const session = sessions.get(sessionId);
    
    if (!session || !session.client) {
        return res.status(404).json({ error: 'Session not found or not connected' });
    }

    try {
        // Check if client is connected
        const isConnected = await session.client.isConnected();
        if (!isConnected) {
            return res.status(400).json({ error: 'Session is not connected' });
        }

        const chatId = to.includes('@') ? to : `${to}@c.us`;
        await session.client.sendText(chatId, message);
        res.json({ success: true, message: 'Message sent successfully' });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        activeSessions: sessions.size,
        chromeExecutablePath: CHROME_EXECUTABLE_PATH,
        environment: process.env.NODE_ENV || 'development'
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Using Chrome executable: ${CHROME_EXECUTABLE_PATH}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    
    // Close all sessions
    for (const [sessionId, session] of sessions.entries()) {
        try {
            if (session.client) {
                await session.client.close();
            }
        } catch (error) {
            console.error(`Error closing session ${sessionId}:`, error);
        }
    }
    
    process.exit(0);
});

// Clean up old sessions every hour
setInterval(() => {
    const now = new Date();
    for (const [sessionId, session] of sessions.entries()) {
        const age = now - session.timestamp;
        // Remove sessions older than 4 hours
        if (age > 4 * 60 * 60 * 1000) {
            console.log(`Cleaning up old session: ${sessionId}`);
            if (session.client) {
                session.client.close().catch(console.error);
            }
            sessions.delete(sessionId);
            
            // Clean up token file
            const tokenPath = path.join(__dirname, 'tokens', `${sessionId}.json`);
            if (fs.existsSync(tokenPath)) {
                fs.unlinkSync(tokenPath);
            }
            
            // Clean up credentials file
            const credPath = path.join(__dirname, 'credentials', `${sessionId}.json`);
            if (fs.existsSync(credPath)) {
                fs.unlinkSync(credPath);
            }
        }
    }
}, 60 * 60 * 1000); // Run every hour

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

module.exports = app; 
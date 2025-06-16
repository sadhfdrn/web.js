const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store active clients
const activeClients = new Map();
let browserInstances = new Map(); // Track browser instances

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    
    // Disconnect all clients
    for (const [phoneNumber, clientData] of activeClients) {
        try {
            console.log(`Disconnecting client: ${phoneNumber}`);
            if (clientData.client && typeof clientData.client.destroy === 'function') {
                await clientData.client.destroy();
            }
        } catch (error) {
            console.error(`Error disconnecting client ${phoneNumber}:`, error);
        }
    }
    
    activeClients.clear();
    browserInstances.clear();
    
    // Clean up chrome user data directories
    try {
        const tmpDir = path.join(__dirname, 'tmp');
        const entries = await fs.readdir(tmpDir);
        for (const entry of entries) {
            if (entry.startsWith('chrome-user-data-')) {
                await fs.rm(path.join(tmpDir, entry), { recursive: true, force: true });
            }
        }
    } catch (error) {
        console.error('Error cleaning up chrome directories:', error);
    }
    
    process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Ensure session directory exists
const ensureSessionDir = async () => {
    const sessionDir = path.join(__dirname, '.wwebjs_auth');
    try {
        await fs.access(sessionDir);
    } catch {
        await fs.mkdir(sessionDir, { recursive: true });
    }
};

// Initialize session directory
ensureSessionDir();

// Clean up old chrome user data directories
const cleanupOldChromeData = async () => {
    try {
        const tmpDir = path.join(__dirname, 'tmp');
        const entries = await fs.readdir(tmpDir);
        
        for (const entry of entries) {
            if (entry.startsWith('chrome-user-data-')) {
                const dirPath = path.join(tmpDir, entry);
                try {
                    // Remove SingletonLock files that might be stuck
                    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
                    for (const lockFile of lockFiles) {
                        try {
                            await fs.unlink(path.join(dirPath, lockFile));
                        } catch (e) {
                            // Ignore if file doesn't exist
                        }
                    }
                } catch (error) {
                    console.error(`Error cleaning lock files in ${dirPath}:`, error);
                }
            }
        }
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
};

// Improved Chrome args for better stability and unique instances
const getChromeArgs = (sessionId) => {
    const userDataDir = path.join(__dirname, 'tmp', `chrome-user-data-${sessionId}`);
    const cacheDir = path.join(__dirname, 'tmp', `chrome-cache-${sessionId}`);
    
    return [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor,TranslateUI',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-field-trial-config',
        '--disable-ipc-flooding-protection',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-default-apps',
        '--disable-component-extensions-with-background-pages',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-pings',
        '--password-store=basic',
        '--use-mock-keychain',
        '--disable-hang-monitor',
        '--disable-prompt-on-repost',
        '--disable-client-side-phishing-detection',
        '--disable-component-update',
        '--disable-domain-reliability',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1366,768',
        '--start-maximized',
        '--disable-infobars',
        '--disable-notifications',
        '--no-crash-upload',
        '--disable-crash-reporter',
        '--shm-size=3gb',
        '--single-process', // Force single process mode
        '--no-first-run',
        '--disable-gpu-sandbox',
        '--disable-software-rasterizer',
        '--disable-dev-tools',
        `--user-data-dir=${userDataDir}`,
        `--disk-cache-dir=${cacheDir}`,
        `--remote-debugging-port=0` // Let Chrome choose an available port
    ];
};

// Create unique tmp directories for each session
const ensureUniqueTmpDirs = async (sessionId) => {
    const dirs = [
        path.join(__dirname, 'tmp'),
        path.join(__dirname, 'tmp', `chrome-user-data-${sessionId}`),
        path.join(__dirname, 'tmp', `chrome-cache-${sessionId}`)
    ];
    
    for (const dir of dirs) {
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
        }
    }
};

// Cleanup function for a specific session
const cleanupSession = async (sessionId, phoneNumber) => {
    try {
        // Remove from active clients
        activeClients.delete(phoneNumber);
        browserInstances.delete(sessionId);
        
        // Clean up session-specific directories
        const userDataDir = path.join(__dirname, 'tmp', `chrome-user-data-${sessionId}`);
        const cacheDir = path.join(__dirname, 'tmp', `chrome-cache-${sessionId}`);
        
        // Remove directories with a delay to ensure processes are closed
        setTimeout(async () => {
            try {
                await fs.rm(userDataDir, { recursive: true, force: true });
                await fs.rm(cacheDir, { recursive: true, force: true });
                console.log(`Cleaned up directories for session ${sessionId}`);
            } catch (error) {
                console.error(`Error cleaning up session ${sessionId}:`, error);
            }
        }, 5000);
        
    } catch (error) {
        console.error(`Error in cleanup for session ${sessionId}:`, error);
    }
};

// Initial cleanup
cleanupOldChromeData();

app.post('/api/generate-pair-code', async (req, res) => {
    let sessionId = null;
    let client = null;
    
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Clean phone number (remove spaces, dashes, etc.)
        const cleanPhoneNumber = phoneNumber.replace(/\D/g, '');
        sessionId = uuidv4(); // Generate unique session ID
        
        if (activeClients.has(cleanPhoneNumber)) {
            const existingClient = activeClients.get(cleanPhoneNumber);
            if (existingClient.isConnected) {
                return res.json({ 
                    success: true, 
                    message: 'Client is already connected!',
                    phoneNumber: cleanPhoneNumber,
                    status: 'already_connected'
                });
            } else {
                // Clean up existing client properly
                try {
                    if (existingClient.client && typeof existingClient.client.destroy === 'function') {
                        await existingClient.client.destroy();
                    }
                    await cleanupSession(existingClient.sessionId, cleanPhoneNumber);
                } catch (error) {
                    console.error('Error destroying existing client:', error);
                }
            }
        }

        console.log(`Generating pair code for: ${cleanPhoneNumber} with session: ${sessionId}`);

        // Ensure unique directories for this session
        await ensureUniqueTmpDirs(sessionId);

        client = new Client({
            authStrategy: new LocalAuth({ 
                clientId: cleanPhoneNumber,
                dataPath: path.join(__dirname, '.wwebjs_auth')
            }),
            puppeteer: {
                headless: true,
                args: getChromeArgs(sessionId),
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
                timeout: 120000,
                protocolTimeout: 120000,
                handleSIGINT: false,
                handleSIGTERM: false,
                handleSIGHUP: false,
                devtools: false,
                ignoreDefaultArgs: ['--enable-automation'],
                defaultViewport: null,
                ignoreHTTPSErrors: true
            },
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
            },
            takeoverOnConflict: true,
            takeoverTimeoutMs: 60000
        });

        let pairCode = null;
        let isConnected = false;
        let responseSent = false;
        let timeoutId = null;

        const sendResponse = (data) => {
            if (!responseSent) {
                responseSent = true;
                if (timeoutId) clearTimeout(timeoutId);
                res.json(data);
            }
        };

        const sendErrorResponse = (error) => {
            if (!responseSent) {
                responseSent = true;
                if (timeoutId) clearTimeout(timeoutId);
                res.status(500).json(error);
                // Clean up on error
                setTimeout(() => cleanupSession(sessionId, cleanPhoneNumber), 1000);
            }
        };

        // Handle pair code generation
        client.on('code', (code) => {
            console.log(`Pair code generated for ${cleanPhoneNumber}: ${code}`);
            pairCode = code;
            
            if (!responseSent) {
                sendResponse({ 
                    success: true, 
                    pairCode,
                    phoneNumber: cleanPhoneNumber,
                    sessionId: sessionId,
                    message: 'Enter this code in your WhatsApp app: Settings > Linked Devices > Link a Device > Link with phone number instead'
                });
            }
        });

        // Handle QR code (fallback)
        client.on('qr', (qr) => {
            console.log(`QR code generated for ${cleanPhoneNumber} (fallback)`);
            if (!pairCode && !responseSent) {
                sendResponse({
                    success: true,
                    qr,
                    phoneNumber: cleanPhoneNumber,
                    sessionId: sessionId,
                    message: 'QR code generated as fallback - scan with WhatsApp'
                });
            }
        });

        // Handle authentication
        client.on('authenticated', () => {
            console.log(`Client ${cleanPhoneNumber} authenticated`);
        });

        // Handle ready state
        client.on('ready', async () => {
            console.log(`Client ${cleanPhoneNumber} is ready!`);
            isConnected = true;
            
            // Update client status
            if (activeClients.has(cleanPhoneNumber)) {
                activeClients.get(cleanPhoneNumber).isConnected = true;
            }
            
            try {
                // Get client info
                const clientInfo = client.info;
                console.log(`Connected as: ${clientInfo.wid.user}@${clientInfo.wid.server}`);
                
                // Send connection info to user
                await client.sendMessage(cleanPhoneNumber + '@c.us', 
                    `🎉 *WhatsApp Bot Connected Successfully!*\n\n` +
                    `📱 Phone: ${cleanPhoneNumber}\n` +
                    `⏰ Connected at: ${new Date().toLocaleString()}\n` +
                    `🔑 Session ID: ${sessionId}\n\n` +
                    `Your bot is now active and ready to receive messages!`
                );
            } catch (error) {
                console.error('Error sending connection info:', error);
            }
        });

        // Handle authentication failure
        client.on('auth_failure', (msg) => {
            console.error(`Authentication failed for ${cleanPhoneNumber}:`, msg);
            
            if (!responseSent) {
                sendErrorResponse({ 
                    error: 'Authentication failed', 
                    details: msg,
                    phoneNumber: cleanPhoneNumber
                });
            }
        });

        // Handle disconnection
        client.on('disconnected', (reason) => {
            console.log(`Client ${cleanPhoneNumber} disconnected:`, reason);
            if (activeClients.has(cleanPhoneNumber)) {
                activeClients.get(cleanPhoneNumber).isConnected = false;
            }
            // Clean up session after disconnection
            setTimeout(() => cleanupSession(sessionId, cleanPhoneNumber), 2000);
        });

        // Handle errors with better error handling
        client.on('error', (error) => {
            console.error(`Client ${cleanPhoneNumber} error:`, error);
            
            // Don't send error response for minor errors after successful connection
            if (!responseSent && !isConnected) {
                sendErrorResponse({ 
                    error: 'Client initialization error', 
                    details: error.message,
                    phoneNumber: cleanPhoneNumber
                });
            }
        });

        // Handle incoming messages (example functionality)
        client.on('message', async (message) => {
            console.log(`Message from ${message.from}: ${message.body}`);
            
            try {
                // Auto-reply functionality
                if (message.body.toLowerCase() === 'ping') {
                    await message.reply('pong! 🏓');
                } else if (message.body.toLowerCase() === 'status') {
                    await message.reply(`Bot is online! 🟢\nConnected as: ${cleanPhoneNumber}\nSession: ${sessionId}`);
                } else if (message.body.toLowerCase() === 'help') {
                    await message.reply(
                        `🤖 *Bot Commands:*\n\n` +
                        `• ping - Test bot response\n` +
                        `• status - Check bot status\n` +
                        `• help - Show this help message`
                    );
                }
            } catch (error) {
                console.error('Error handling message:', error);
            }
        });

        // Store client with session info
        activeClients.set(cleanPhoneNumber, {
            client,
            phoneNumber: cleanPhoneNumber,
            sessionId: sessionId,
            createdAt: new Date(),
            isConnected: false
        });

        browserInstances.set(sessionId, {
            phoneNumber: cleanPhoneNumber,
            createdAt: new Date()
        });

        // Set timeout for the entire process
        timeoutId = setTimeout(() => {
            if (!responseSent) {
                console.log(`Timeout waiting for pair code for ${cleanPhoneNumber}`);
                sendErrorResponse({ 
                    error: 'Timeout waiting for pair code. Please try again.',
                    phoneNumber: cleanPhoneNumber
                });
            }
        }, 120000); // 2 minutes timeout

        try {
            // Initialize client with retry logic
            console.log(`Initializing WhatsApp client for ${cleanPhoneNumber}...`);
            await client.initialize();
        } catch (error) {
            if (timeoutId) clearTimeout(timeoutId);
            console.error(`Error initializing client for ${cleanPhoneNumber}:`, error);
            
            if (!responseSent) {
                sendErrorResponse({ 
                    error: 'Failed to initialize WhatsApp client', 
                    details: error.message,
                    phoneNumber: cleanPhoneNumber,
                    suggestion: 'Please try again in a few minutes'
                });
            }
        }

    } catch (error) {
        console.error('Error generating pair code:', error);
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Failed to generate pair code', 
                details: error.message 
            });
        }
        // Clean up on error
        if (sessionId) {
            setTimeout(() => cleanupSession(sessionId, req.body.phoneNumber?.replace(/\D/g, '')), 1000);
        }
    }
});

// Get client status
app.get('/api/status/:phoneNumber', (req, res) => {
    const { phoneNumber } = req.params;
    const cleanPhoneNumber = phoneNumber.replace(/\D/g, '');
    
    const clientData = activeClients.get(cleanPhoneNumber);
    
    if (!clientData) {
        return res.json({ connected: false, message: 'No client found' });
    }

    res.json({
        connected: clientData.isConnected,
        phoneNumber: cleanPhoneNumber,
        sessionId: clientData.sessionId,
        createdAt: clientData.createdAt
    });
});

// Disconnect client
app.delete('/api/disconnect/:phoneNumber', async (req, res) => {
    try {
        const { phoneNumber } = req.params;
        const cleanPhoneNumber = phoneNumber.replace(/\D/g, '');
        
        const clientData = activeClients.get(cleanPhoneNumber);
        
        if (!clientData) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Properly destroy client
        if (clientData.client && typeof clientData.client.destroy === 'function') {
            await clientData.client.destroy();
        }
        
        // Clean up session
        await cleanupSession(clientData.sessionId, cleanPhoneNumber);
        
        res.json({ success: true, message: 'Client disconnected successfully' });
    } catch (error) {
        console.error('Error disconnecting client:', error);
        res.status(500).json({ error: 'Failed to disconnect client' });
    }
});

// List active clients
app.get('/api/clients', (req, res) => {
    const clients = Array.from(activeClients.entries()).map(([phoneNumber, data]) => ({
        phoneNumber,
        connected: data.isConnected,
        sessionId: data.sessionId,
        createdAt: data.createdAt
    }));
    
    res.json({ 
        success: true,
        count: clients.length,
        clients 
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        activeClients: activeClients.size,
        browserInstances: browserInstances.size
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'WhatsApp Bot API Server',
        endpoints: {
            'POST /api/generate-pair-code': 'Generate pair code for WhatsApp connection',
            'GET /api/status/:phoneNumber': 'Check client connection status',
            'DELETE /api/disconnect/:phoneNumber': 'Disconnect client',
            'GET /api/clients': 'List all active clients',
            'GET /health': 'Health check'
        }
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`WhatsApp Bot Server running on port ${PORT}`);
    console.log(`Frontend available at: http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});

// Handle uncaught exceptions with better logging
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    console.error('Stack:', error.stack);
    // Don't exit immediately, log and continue
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit immediately, log and continue
});
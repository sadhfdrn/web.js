const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store active clients
const activeClients = new Map();

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

app.post('/api/generate-pair-code', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Clean phone number (remove spaces, dashes, etc.)
        const cleanPhoneNumber = phoneNumber.replace(/\D/g, '');
        
        if (activeClients.has(cleanPhoneNumber)) {
            return res.status(400).json({ error: 'Client already exists for this number' });
        }

        console.log(`Generating pair code for: ${cleanPhoneNumber}`);

        const client = new Client({
            authStrategy: new LocalAuth({ 
                clientId: cleanPhoneNumber,
                dataPath: path.join(__dirname, '.wwebjs_auth')
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ],
                executablePath: '/usr/bin/chromium-browser'
            }
        });

        let pairCode = null;
        let isConnected = false;

        // Handle pair code generation
        client.on('code', (code) => {
            console.log(`Pair code generated for ${cleanPhoneNumber}: ${code}`);
            pairCode = code;
        });

        // Handle QR code (fallback)
        client.on('qr', (qr) => {
            console.log(`QR code generated for ${cleanPhoneNumber}`);
        });

        // Handle authentication
        client.on('authenticated', () => {
            console.log(`Client ${cleanPhoneNumber} authenticated`);
        });

        // Handle ready state
        client.on('ready', async () => {
            console.log(`Client ${cleanPhoneNumber} is ready!`);
            isConnected = true;
            
            try {
                // Get session data
                const sessionPath = path.join(__dirname, '.wwebjs_auth', `session-${cleanPhoneNumber}`);
                const sessionExists = await fs.access(sessionPath).then(() => true).catch(() => false);
                
                if (sessionExists) {
                    // Send connection info to user
                    const connectionInfo = {
                        phoneNumber: cleanPhoneNumber,
                        connectedAt: new Date().toISOString(),
                        sessionId: cleanPhoneNumber,
                        status: 'connected'
                    };

                    // Send the connection info as a message to the user
                    await client.sendMessage(cleanPhoneNumber + '@c.us', 
                        `🎉 *WhatsApp Bot Connected Successfully!*\n\n` +
                        `📱 Phone: ${cleanPhoneNumber}\n` +
                        `⏰ Connected at: ${new Date().toLocaleString()}\n` +
                        `🔑 Session ID: ${cleanPhoneNumber}\n\n` +
                        `Your bot is now active and ready to receive messages!`
                    );
                }
            } catch (error) {
                console.error('Error sending connection info:', error);
            }
        });

        // Handle authentication failure
        client.on('auth_failure', (msg) => {
            console.error(`Authentication failed for ${cleanPhoneNumber}:`, msg);
            activeClients.delete(cleanPhoneNumber);
        });

        // Handle disconnection
        client.on('disconnected', (reason) => {
            console.log(`Client ${cleanPhoneNumber} disconnected:`, reason);
            activeClients.delete(cleanPhoneNumber);
        });

        // Handle incoming messages (example functionality)
        client.on('message', async (message) => {
            console.log(`Message from ${message.from}: ${message.body}`);
            
            // Auto-reply functionality
            if (message.body.toLowerCase() === 'ping') {
                await message.reply('pong! 🏓');
            } else if (message.body.toLowerCase() === 'status') {
                await message.reply(`Bot is online! 🟢\nConnected as: ${cleanPhoneNumber}`);
            }
        });

        // Store client
        activeClients.set(cleanPhoneNumber, {
            client,
            phoneNumber: cleanPhoneNumber,
            createdAt: new Date(),
            isConnected: false
        });

        // Initialize client
        await client.initialize();

        // Wait for pair code generation (timeout after 30 seconds)
        const timeout = setTimeout(() => {
            if (!pairCode && !isConnected) {
                activeClients.delete(cleanPhoneNumber);
                res.status(408).json({ error: 'Timeout waiting for pair code' });
            }
        }, 30000);

        // Check for pair code every 500ms
        const checkPairCode = setInterval(() => {
            if (pairCode) {
                clearInterval(checkPairCode);
                clearTimeout(timeout);
                res.json({ 
                    success: true, 
                    pairCode,
                    phoneNumber: cleanPhoneNumber,
                    message: 'Enter this code in your WhatsApp app: Settings > Linked Devices > Link a Device > Link with phone number instead'
                });
            } else if (isConnected) {
                clearInterval(checkPairCode);
                clearTimeout(timeout);
                res.json({ 
                    success: true, 
                    message: 'Already connected!',
                    phoneNumber: cleanPhoneNumber
                });
            }
        }, 500);

    } catch (error) {
        console.error('Error generating pair code:', error);
        res.status(500).json({ error: 'Failed to generate pair code', details: error.message });
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

        await clientData.client.destroy();
        activeClients.delete(cleanPhoneNumber);
        
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
        createdAt: data.createdAt
    }));
    
    res.json({ clients });
});

app.listen(PORT, () => {
    console.log(`WhatsApp Bot Server running on port ${PORT}`);
    console.log(`Frontend available at: http://localhost:${PORT}`);
});

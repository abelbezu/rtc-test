const WebSocket = require('ws');
const http = require('http'); // For optional HTTP server to serve static files

const wss = new WebSocket.Server({ port: 8080 }); // WebSocket server on port 8080

// Map to store client IDs to WebSocket connections
const clients = new Map();

wss.on('connection', ws => {
    console.log('Client connected.');

    ws.on('message', message => {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message);
        } catch (e) {
            console.error('Invalid JSON received:', message);
            return;
        }

        console.log(`Received message: ${JSON.stringify(parsedMessage)}`);

        switch (parsedMessage.type) {
            case 'register':
                const id = parsedMessage.id;
                if (clients.has(id)) {
                    ws.send(JSON.stringify({ type: 'error', message: `ID '${id}' is already taken.` }));
                    console.log(`ID ${id} already taken.`);
                } else {
                    clients.set(id, ws);
                    ws.id = id; // Attach ID to the WebSocket object for easy lookup
                    ws.send(JSON.stringify({ type: 'registered', id: id }));
                    console.log(`Client registered: ${id}`);
                }
                break;
            case 'offer':
            case 'answer':
            case 'candidate':
            case 'hangup':
                const targetId = parsedMessage.targetId;
                const targetWs = clients.get(targetId);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    // Add sender ID for context on the receiving end
                    parsedMessage.senderId = ws.id;
                    targetWs.send(JSON.stringify(parsedMessage));
                    console.log(`Relayed ${parsedMessage.type} from ${ws.id} to ${targetId}`);
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: `Target client ${targetId} not found or not connected.` }));
                    console.log(`Failed to relay ${parsedMessage.type}: target ${targetId} not found.`);
                }
                break;
            default:
                console.warn('Unknown message type:', parsedMessage.type);
                ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type.' }));
        }
    });

    ws.on('close', () => {
        if (ws.id) {
            clients.delete(ws.id);
            console.log(`Client disconnected: ${ws.id}`);
        } else {
            console.log('Unregistered client disconnected.');
        }
    });

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
});

console.log('Signaling server started on ws://localhost:8080');

// Optional: Basic HTTP server to serve your index.html and client.js
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        require('fs').readFile('index.html', (err, data) => {
            if (err) {
                res.end('Error loading index.html');
            } else {
                res.end(data);
            }
        });
    } else if (req.url === '/client.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        require('fs').readFile('client.js', (err, data) => {
            if (err) {
                res.end('Error loading client.js');
            } else {
                res.end(data);
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(3000, () => {
    console.log('HTTP server started on http://localhost:3000 (serving index.html and client.js)');
    console.log('Open http://localhost:3000 in your browser to access the client.');
});
// Global variables
let localPeerConnection; // Our RTCPeerConnection
let remoteVideo = document.getElementById('remoteVideo');
let clientIdInput = document.getElementById('clientIdInput');
let remoteIdInput = document.getElementById('remoteIdInput');
let registerBtn = document.getElementById('registerBtn');
let callBtn = document.getElementById('callBtn');
let hangupBtn = document.getElementById('hangupBtn');
let startRecordBtn = document.getElementById('startRecordBtn');
let stopRecordBtn = document.getElementById('stopRecordBtn');
let downloadRecordBtn = document.getElementById('downloadRecordBtn');
let messagesDiv = document.getElementById('messages');

console.log("loaded...");

let signalingSocket;
const signalingServerUrl = 'ws://localhost:8080'; // Change to wss:// for production!

let mediaRecorder;
let recordedChunks = [];
let remoteStream; // To hold the incoming stream for recording

const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }, // Google's public STUN server
        // Add TURN servers here for more robust connectivity (e.g., behind firewalls)
        // { urls: 'turn:your.turn.server.com:3478', username: 'user', credential: 'password' }
    ]
};

// --- Helper Functions ---
function log(message) {
    const p = document.createElement('p');
    p.textContent = message;
    messagesDiv.prepend(p); // Add to the top
    console.log(message);
}

function enableControls(register, call, hangup, startRecord, stopRecord, downloadRecord) {
    registerBtn.disabled = !register;
    callBtn.disabled = !call;
    hangupBtn.disabled = !hangup;
    startRecordBtn.disabled = !startRecord;
    stopRecordBtn.disabled = !stopRecord;
    downloadRecordBtn.disabled = !downloadRecord;
}

// --- Signaling Functions ---
function setupSignaling() {
    signalingSocket = new WebSocket(signalingServerUrl);

    signalingSocket.onopen = () => {
        log('Signaling server connected.');
        enableControls(true, false, false, false, false, false);
    };

    signalingSocket.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        log(`Received signaling message: ${message.type}`);

        switch (message.type) {
            case 'registered':
                log(`Registered as ${message.id}. Ready to call or receive.`);
                enableControls(false, true, false, false, false, false); // Can initiate call
                break;
            case 'offer':
                if (localPeerConnection) {
                    log('Received offer while already connected. Ignoring or handling as renegotiation...');
                    // For simplicity, we'll assume a new connection. In a real app, handle renegotiation.
                }
                log('Received offer from remote. Setting up PeerConnection...');
                await createPeerConnection(message.senderId); // Create PC for the offerer
                await localPeerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
                const answer = await localPeerConnection.createAnswer();
                await localPeerConnection.setLocalDescription(answer);
                signalingSocket.send(JSON.stringify({
                    type: 'answer',
                    targetId: message.senderId,
                    answer: answer
                }));
                enableControls(false, false, true, true, false, false); // Can hang up, start recording
                break;
            case 'answer':
                if (localPeerConnection && localPeerConnection.signalingState !== 'stable') {
                    await localPeerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
                    log('Received answer. Peer connection established!');
                    enableControls(false, false, true, true, false, false); // Can hang up, start recording
                } else {
                    log('Received answer but no active peer connection or not in expected signaling state.');
                }
                break;
            case 'candidate':
                if (localPeerConnection) {
                    try {
                        await localPeerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
                        log('Added ICE candidate.');
                    } catch (e) {
                        console.error('Error adding received ICE candidate:', e);
                    }
                } else {
                    log('Received ICE candidate but no peer connection yet.');
                }
                break;
            case 'hangup':
                log('Remote party hung up.');
                hangUp();
                break;
            case 'error':
                log(`Signaling error: ${message.message}`);
                break;
            default:
                log(`Unknown signaling message type: ${message.type}`);
        }
    };

    signalingSocket.onclose = () => {
        log('Signaling server disconnected.');
        hangUp(); // Clean up if signaling drops
        enableControls(true, false, false, false, false, false);
    };

    signalingSocket.onerror = (error) => {
        console.error('Signaling socket error:', error);
        log('Signaling socket error. Check console for details.');
        hangUp();
    };
}

// --- WebRTC Peer Connection Functions ---
async function createPeerConnection(remoteId) {
    localPeerConnection = new RTCPeerConnection(iceServers);
    log('Created RTCPeerConnection.');

    localPeerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            log('Sending ICE candidate...');
            signalingSocket.send(JSON.stringify({
                type: 'candidate',
                targetId: remoteId,
                candidate: event.candidate
            }));
        }
    };

    localPeerConnection.oniceconnectionstatechange = () => {
        log(`ICE connection state: ${localPeerConnection.iceConnectionState}`);
        if (localPeerConnection.iceConnectionState === 'disconnected' ||
            localPeerConnection.iceConnectionState === 'failed' ||
            localPeerConnection.iceConnectionState === 'closed') {
            log('ICE connection state changed to disconnected/failed/closed. Hanging up.');
            hangUp();
        }
    };

    localPeerConnection.ontrack = (event) => {
        log('Received remote stream track!');
        // Attach the first stream from the event to the video element
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            remoteStream = event.streams[0]; // Store for recording
            log('Remote stream attached to video element.');
        }
    };

    localPeerConnection.onnegotiationneeded = async () => {
        log('Negotiation needed. Creating offer...');
        // This event fires when we need to generate an offer.
        // It's part of the "perfect negotiation" pattern.
        try {
            const offer = await localPeerConnection.createOffer();
            await localPeerConnection.setLocalDescription(offer);
            signalingSocket.send(JSON.stringify({
                type: 'offer',
                targetId: remoteId,
                offer: localPeerConnection.localDescription
            }));
            log('Offer sent.');
        } catch (e) {
            console.error('Error creating or sending offer:', e);
            log('Error creating or sending offer.');
        }
    };

    // Add transceivers for receiving video and audio
    // This explicitly tells the browser we expect to receive video and audio
    // This is good practice for "simulcast" or explicit direction of media.
    localPeerConnection.addTransceiver('video', { direction: 'recvonly' });
    localPeerConnection.addTransceiver('audio', { direction: 'recvonly' });
}

async function callRemote() {
    const remoteId = remoteIdInput.value;
    if (!remoteId) {
        alert('Please enter a Remote Client ID.');
        return;
    }

    log(`Attempting to call ${remoteId}...`);
    await createPeerConnection(remoteId);
    // The onnegotiationneeded event handler will automatically create and send the offer.
    enableControls(false, false, true, true, false, false);
}

function hangUp() {
    if (localPeerConnection) {
        log('Hanging up...');
        localPeerConnection.close();
        localPeerConnection = null;
    }
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        stopRecording();
    }
    signalingSocket.send(JSON.stringify({
        type: 'hangup',
        targetId: remoteIdInput.value // Notify the other side
    }));
    log('Connection closed.');
    enableControls(false, true, false, false, false, false);
    remoteIdInput.value = ''; // Clear remote ID
    recordedChunks = [];
    remoteStream = null;
}

// --- Recording Functions ---
function startRecording() {
    if (!remoteStream) {
        log('No remote video stream available to record.');
        return;
    }

    recordedChunks = [];
    try {
        mediaRecorder = new MediaRecorder(remoteStream, { mimeType: 'video/webm; codecs=vp8' }); // You can try 'video/mp4' but WebM is widely supported in browsers
    } catch (e) {
        log(`Error creating MediaRecorder: ${e.name} - ${e.message}`);
        alert(`Error creating MediaRecorder: ${e.name}. Try a different mimeType or check browser support.`);
        return;
    }

    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
            log(`Recorded chunk of size: ${event.data.size} bytes`);
        }
    };

    mediaRecorder.onstop = () => {
        log('Recording stopped. Ready to download.');
        enableControls(false, false, true, false, false, true); // Allow download
    };

    mediaRecorder.start();
    log('Recording started...');
    enableControls(false, false, true, false, true, false); // Can stop recording
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        log('Stopping recording...');
    }
}

function downloadRecording() {
    if (recordedChunks.length === 0) {
        log('No recorded video to download.');
        return;
    }

    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    document.body.appendChild(a);
    a.style.display = 'none';
    a.href = url;
    a.download = `webrtc_recording_${new Date().toISOString()}.webm`;
    a.click();
    window.URL.revokeObjectURL(url);
    log('Recording downloaded.');
    recordedChunks = []; // Clear chunks after download
    enableControls(false, false, true, true, false, false); // Can start new recording
}


// --- Event Listeners ---
registerBtn.onclick = () => {
    const id = clientIdInput.value;
    if (id) {
        signalingSocket.send(JSON.stringify({ type: 'register', id: id }));
        log(`Registering as ${id}...`);
    } else {
        alert('Please enter a Client ID to register.');
    }
};

callBtn.onclick = callRemote;
hangupBtn.onclick = hangUp;
startRecordBtn.onclick = startRecording;
stopRecordBtn.onclick = stopRecording;
downloadRecordBtn.onclick = downloadRecording;

// Initialize signaling on page load
window.onload = setupSignaling;
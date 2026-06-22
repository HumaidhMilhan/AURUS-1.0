// Establish Socket.IO connection with reconnection support (P1 #5)
const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000
});

// P1 #5: Connection state management
socket.on('connect', () => {
    console.log('[SocketIO] Connected to server.');
    const statusDiv = document.getElementById('system-status');
    if (statusDiv) {
        statusDiv.className = 'status-badge connected';
    }
});

socket.on('disconnect', (reason) => {
    console.warn('[SocketIO] Disconnected:', reason);
    const statusDiv = document.getElementById('system-status');
    const statusText = statusDiv ? statusDiv.querySelector('.status-lbl') : null;
    if (statusDiv) {
        statusDiv.className = 'status-badge disconnected';
    }
    if (statusText) {
        statusText.textContent = 'Disconnected — Reconnecting...';
    }
    appendChatMessage('System', 'Connection lost. Attempting to reconnect...', 'system');
});

socket.on('reconnect', (attemptNumber) => {
    console.log(`[SocketIO] Reconnected after ${attemptNumber} attempts.`);
    appendChatMessage('System', 'Reconnected to server!', 'system');
});

socket.on('reconnect_error', () => {
    console.warn('[SocketIO] Reconnection attempt failed.');
});

socket.on('connect_error', (err) => {
    console.warn('[SocketIO] Connection error:', err.message);
});

// Initialize canvas face
const face = new RoverFace('face-canvas');

// State tracking
let activeKeys = {};
let roverTele = null;
let currentDriveMode = 'manual';

// --- Drive Mode Management ---

function setDriveMode(mode) {
    socket.emit('set_mode', { mode: mode });
}

function updateModeUI(mode) {
    currentDriveMode = mode;
    
    // Update mode selector buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        if (btn.getAttribute('data-mode') === mode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Update control pad lock overlay
    const lockOverlay = document.getElementById('control-pad-lock');
    const modeBadge = document.getElementById('control-mode-badge');
    
    if (mode === 'manual') {
        if (lockOverlay) lockOverlay.style.display = 'none';
        if (modeBadge) {
            modeBadge.textContent = 'MANUAL';
            modeBadge.className = 'mode-indicator-badge manual';
        }
    } else if (mode === 'autonomous') {
        if (lockOverlay) lockOverlay.style.display = 'flex';
        if (modeBadge) {
            modeBadge.textContent = 'EXPLORING';
            modeBadge.className = 'mode-indicator-badge autonomous';
        }
    } else if (mode === 'voice_command') {
        if (lockOverlay) lockOverlay.style.display = 'flex';
        if (modeBadge) {
            modeBadge.textContent = 'VOICE CMD';
            modeBadge.className = 'mode-indicator-badge voice';
        }
    }
}

// Virtual room simulation parameters
const simCanvas = document.getElementById('sim-canvas');
const simCtx = simCanvas.getContext('2d');
let obstacles = [];

// Radar sensor canvas parameters
const radarCanvas = document.getElementById('radar-canvas');
const radarCtx = radarCanvas.getContext('2d');

// Audio Synthesizer (Web Audio API Fallbacks)
function playSynthSound(soundType) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        if (soundType === 'happy_chirp') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1100, audioCtx.currentTime + 0.15);
            osc.frequency.exponentialRampToValueAtTime(700, audioCtx.currentTime + 0.22);
            osc.frequency.exponentialRampToValueAtTime(1700, audioCtx.currentTime + 0.4);
            
            gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.45);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.5);
        } 
        else if (soundType === 'scared_screech') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(1500, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.5);
            
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.5);
        }
        else if (soundType === 'listening_beep') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(880, audioCtx.currentTime);
            osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.08);
            
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.2);
        }
    } catch (e) {
        console.warn("Web Audio API not supported or blocked: ", e);
    }
}

// Ensure Canvas is properly resized
function resizeCanvases() {
    // 2D Sim Arena resizing
    const simWrap = simCanvas.parentElement;
    simCanvas.width = simWrap.clientWidth;
    simCanvas.height = simWrap.clientHeight || 280;

    // Radar Resizing
    const radarWrap = radarCanvas.parentElement;
    radarCanvas.width = radarWrap.clientWidth;
    radarCanvas.height = 140;
}
window.addEventListener('resize', resizeCanvases);
setTimeout(resizeCanvases, 100);

// --- SOCKETIO RECV BROADCASTS ---

socket.on('telemetry', (telemetry) => {
    roverTele = telemetry;
    
    // Sync speed slider if the user is not actively dragging it
    const speedSlider = document.getElementById('speed-multiplier');
    if (speedSlider && document.activeElement !== speedSlider) {
        if (telemetry.speed_multiplier !== undefined) {
            const pct = Math.round(telemetry.speed_multiplier * 100);
            speedSlider.value = pct;
            document.getElementById('speed-val').textContent = pct + '%';
        }
    }
    
    // 1. Update mood metrics UI
    document.getElementById('val-happiness').textContent = Math.round(telemetry.happiness * 100) + '%';
    document.getElementById('bar-happiness').style.width = (telemetry.happiness * 100) + '%';
    
    document.getElementById('val-curiosity').textContent = Math.round(telemetry.curiosity * 100) + '%';
    document.getElementById('bar-curiosity').style.width = (telemetry.curiosity * 100) + '%';
    
    document.getElementById('val-fear').textContent = Math.round(telemetry.fear * 100) + '%';
    document.getElementById('bar-fear').style.width = (telemetry.fear * 100) + '%';

    // 2. Face canvas transition
    const faceBadge = document.getElementById('current-expression');
    faceBadge.textContent = telemetry.expression.toUpperCase();
    faceBadge.className = `expression-badge ${telemetry.expression}`;
    face.setExpression(telemetry.expression);

    // 3. Update Hardware/Sim status connection tag
    const statusDiv = document.getElementById('system-status');
    const statusText = statusDiv.querySelector('.status-lbl');
    if (telemetry.is_simulation) {
        statusDiv.className = "status-badge connected";
        statusText.textContent = "Simulation Mode";
    } else {
        statusDiv.className = "status-badge connected hw";
        statusText.textContent = "Pi Hardware Active";
    }

    // 4. Update Server Microphone Connection tag
    const micStatus = document.getElementById('mic-status');
    const micText = micStatus.querySelector('.mic-status-lbl');
    if (telemetry.mic_active) {
        micStatus.className = "status-badge mic-active";
        micText.textContent = "AURUS Listening";
    } else {
        micStatus.className = "status-badge mic-inactive";
        micText.textContent = "Mic Offline";
    }

    // 5. Render 2D simulation loop
    drawSimulation(telemetry);
    
    // 6. Draw Sonar Proximity Radar (5 sensors)
    drawRadar(telemetry);
    
    // 7. Sync drive mode from server
    if (telemetry.drive_mode && telemetry.drive_mode !== currentDriveMode) {
        updateModeUI(telemetry.drive_mode);
    }

    // 8. Render detected objects
    const objectsList = document.getElementById('detected-objects-list');
    if (objectsList && telemetry.objects) {
        if (telemetry.objects.length > 0) {
            objectsList.innerHTML = telemetry.objects.map(obj => 
                `<div><i class="fa-solid fa-crosshairs"></i> ${obj.label} (${Math.round(obj.confidence * 100)}%)</div>`
            ).join('');
        } else {
            objectsList.innerHTML = '';
        }
    }
});

// --- Mode Change Events ---

socket.on('mode_changed', (data) => {
    updateModeUI(data.mode);
    const modeNames = {
        'manual': 'Manual Control',
        'autonomous': 'Autonomous Exploration',
        'voice_command': 'Voice Commands'
    };
    appendChatMessage('System', `Mode switched to: ${modeNames[data.mode] || data.mode}`, 'system');
});

socket.on('mode_conflict', (data) => {
    appendChatMessage('System', data.message, 'system');
});

socket.on('mode_error', (data) => {
    appendChatMessage('System', `Mode error: ${data.message}`, 'system');
});

socket.on('xai_update', (data) => {
    const decEl = document.getElementById('xai-decision');
    const reaEl = document.getElementById('xai-reason');
    const confEl = document.getElementById('xai-confidence');
    const srcEl = document.getElementById('xai-source');
    
    if (decEl) decEl.textContent = data.decision || 'N/A';
    if (reaEl) reaEl.textContent = data.reason || 'N/A';
    if (confEl) confEl.textContent = data.confidence || 'N/A';
    if (srcEl) srcEl.textContent = data.source_data || 'N/A';
    
    // Quick flash animation
    const panel = document.getElementById('xai-panel');
    if (panel) {
        panel.style.boxShadow = '0 0 15px rgba(14, 165, 233, 0.4)';
        setTimeout(() => {
            panel.style.boxShadow = 'none';
        }, 500);
    }
});

socket.on('audio_trigger', (data) => {
    playSynthSound(data.sound);
});

socket.on('rover_listening', () => {
    appendChatMessage('Rover', '...', 'rover typing-indicator');
    face.setExpression('listening');
    playSynthSound('listening_beep');
});

socket.on('voice_trigger', (data) => {
    // Append the user command transcribed by the server microphone
    appendChatMessage('You (Voice)', data.message, 'user');
});

socket.on('rover_reply', (data) => {
    // Remove last ellipsis bubble if present
    const terminals = document.getElementById('chat-terminal');
    const typingBubbles = terminals.getElementsByClassName('typing-indicator');
    while(typingBubbles.length > 0) {
        typingBubbles[0].remove();
    }
    
    // Append actual text response
    appendChatMessage('AURUS', data.speech, 'rover');
    
    // Trigger Canvas face state
    face.setExpression(data.emotion);
});

// --- AURUS INNER THOUGHTS ---

socket.on('inner_thought', (data) => {
    const thoughtEl = document.getElementById('inner-thought-text');
    const display = document.getElementById('inner-thought-display');
    
    if (!thoughtEl || !display) return;
    
    // Fade out → update → fade in
    display.classList.remove('visible');
    setTimeout(() => {
        thoughtEl.textContent = data.thought;
        display.classList.add('visible');
    }, 300);
    
    // Auto-hide after 8 seconds
    setTimeout(() => {
        display.classList.remove('visible');
    }, 8000);
});

socket.on('idle_thought', (data) => {
    // Append idle thoughts to chat with special styling
    appendChatMessage('AURUS (thinking)', data.speech, 'thought');
    
    // Update face expression
    if (data.emotion) {
        face.setExpression(data.emotion);
    }
    
    // Show inner thought if present
    if (data.inner_thought) {
        const thoughtEl = document.getElementById('inner-thought-text');
        const display = document.getElementById('inner-thought-display');
        if (thoughtEl && display) {
            display.classList.remove('visible');
            setTimeout(() => {
                thoughtEl.textContent = data.inner_thought;
                display.classList.add('visible');
            }, 300);
            setTimeout(() => {
                display.classList.remove('visible');
            }, 8000);
        }
    }
});

// --- CHAT INTERFACES ---

function handleInputKey(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

function sendMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    
    appendChatMessage('You', msg, 'user');
    socket.emit('user_talk', { message: msg });
    input.value = '';
}

// P2 #10: Maximum chat messages to prevent unbounded memory growth
const MAX_CHAT_MESSAGES = 100;

function appendChatMessage(sender, text, className) {
    const terminal = document.getElementById('chat-terminal');
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${className}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    
    if (text === '...') {
        bubble.innerHTML = '<span class="dot-pulse-1">.</span><span class="dot-pulse-2">.</span><span class="dot-pulse-3">.</span>';
    } else {
        bubble.textContent = text;
    }
    
    msgDiv.appendChild(bubble);
    terminal.appendChild(msgDiv);
    
    // P2 #10: Remove oldest messages when limit exceeded
    while (terminal.children.length > MAX_CHAT_MESSAGES) {
        terminal.removeChild(terminal.firstChild);
    }
    
    // Scroll to bottom
    terminal.scrollTop = terminal.scrollHeight;
}

// --- WEB BROWSER MICROPHONE (Web Speech API) ---

let webMicActive = false;
let recognition = null;
let recognitionRestarting = false;

function initWebSpeechAPI() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn('[WebMic] Web Speech API not supported in this browser.');
        return null;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;        // Keep listening continuously
    rec.interimResults = true;    // Show partial results for live transcript
    rec.lang = 'en-US';
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        // Update live transcript display
        const transcriptEl = document.getElementById('mic-transcript');
        if (interimTranscript) {
            transcriptEl.textContent = interimTranscript;
        }

        // Process final transcript for wake word
        if (finalTranscript) {
            transcriptEl.textContent = `"${finalTranscript}"`;
            processWebVoiceTranscript(finalTranscript);
        }
    };

    rec.onerror = (event) => {
        console.warn('[WebMic] Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
            appendChatMessage('System', 'Microphone access denied. Please allow mic permission in your browser.', 'system');
            stopWebMic();
        } else if (event.error === 'no-speech') {
            // No speech detected — this is normal, recognition will restart
        } else if (event.error === 'aborted') {
            // Aborted — don't restart
        } else {
            // Other errors — try to restart
            if (webMicActive && !recognitionRestarting) {
                restartRecognition();
            }
        }
    };

    rec.onend = () => {
        // Auto-restart if still active (recognition stops naturally after silence)
        if (webMicActive && !recognitionRestarting) {
            restartRecognition();
        }
    };

    return rec;
}

function restartRecognition() {
    if (!webMicActive || recognitionRestarting) return;
    recognitionRestarting = true;

    setTimeout(() => {
        if (webMicActive && recognition) {
            try {
                recognition.start();
            } catch (e) {
                // Already started, ignore
            }
        }
        recognitionRestarting = false;
    }, 300);
}

function processWebVoiceTranscript(transcript) {
    const text = transcript.toLowerCase().trim();
    
    // Check for wake word
    let wakeWordFound = false;
    let command = '';

    for (const wakeWord of WAKE_WORDS) {
        const idx = text.indexOf(wakeWord.toLowerCase());
        if (idx !== -1) {
            wakeWordFound = true;
            // Extract everything after the wake word
            command = text.substring(idx + wakeWord.length).trim();
            break;
        }
    }

    if (wakeWordFound) {
        // Visual feedback
        const micBtn = document.getElementById('web-mic-btn');
        micBtn.classList.add('triggered');
        setTimeout(() => micBtn.classList.remove('triggered'), 800);

        if (!command) {
            command = 'hello';  // Default if just wake word spoken
        }

        appendChatMessage('You (Voice)', command, 'user');
        socket.emit('user_talk', { message: command });
    }
}

function toggleWebMic() {
    if (webMicActive) {
        stopWebMic();
    } else {
        startWebMic();
    }
}

function startWebMic() {
    if (!recognition) {
        recognition = initWebSpeechAPI();
    }

    if (!recognition) {
        appendChatMessage('System', 'Web Speech API not supported in this browser. Use Chrome or Edge for voice input.', 'system');
        return;
    }

    try {
        recognition.start();
        webMicActive = true;

        // Update UI
        const micBtn = document.getElementById('web-mic-btn');
        const micStatus = document.getElementById('web-mic-status');
        const transcript = document.getElementById('mic-transcript');

        micBtn.classList.add('active');
        micStatus.style.display = 'flex';
        transcript.textContent = 'Listening for "AURUS"...';

        appendChatMessage('System', 'Browser microphone activated. Say "AURUS" followed by your command.', 'system');
    } catch (e) {
        console.error('[WebMic] Failed to start:', e);
        appendChatMessage('System', 'Failed to start microphone. Check browser permissions.', 'system');
    }
}

function stopWebMic() {
    webMicActive = false;
    recognitionRestarting = false;

    if (recognition) {
        try {
            recognition.stop();
        } catch (e) {
            // Already stopped
        }
    }

    // Update UI
    const micBtn = document.getElementById('web-mic-btn');
    const micStatus = document.getElementById('web-mic-status');

    micBtn.classList.remove('active');
    micBtn.classList.remove('triggered');
    micStatus.style.display = 'none';

    appendChatMessage('System', 'Browser microphone deactivated.', 'system');
}

// --- FEED & CONFIGS ---

function feedTreat() {
    socket.emit('feed_treat');
}

function resetSim() {
    socket.emit('reset_sim');
}

function triggerStop() {
    socket.emit('stop');
}

function triggerEStop() {
    socket.emit('stop');
    appendChatMessage('System', 'EMERGENCY SHUTDOWN — All motors stopped. Reverted to Manual mode.', 'system');
}

// --- DEMONSTRATION MODE (PHASE 10) ---
function startDemoSequence() {
    appendChatMessage('System', 'Starting Demonstration Sequence...', 'system');
    
    // 1. User enters room (Presence -> Present)
    setTimeout(() => {
        appendChatMessage('System', '[Demo] Mocking Presence: Present', 'system');
        socket.emit('demo_mock_presence', { state: 'Present' });
    }, 2000);
    
    // 2. User asks question
    setTimeout(() => {
        appendChatMessage('You (Demo)', 'What is my name?', 'user');
        socket.emit('user_talk', { message: 'What is my name?' });
    }, 15000);
    
    // 3. User activates follow mode
    setTimeout(() => {
        appendChatMessage('You (Demo)', 'Follow me!', 'user');
        socket.emit('user_talk', { message: 'Follow me!' });
    }, 30000);
    
    // 4. User leaves room (Presence -> Absent)
    setTimeout(() => {
        appendChatMessage('System', '[Demo] Mocking Presence: Absent', 'system');
        socket.emit('demo_mock_presence', { state: 'Absent' });
        
        // Return to manual mode after following
        socket.emit('user_talk', { message: 'stop following' });
    }, 45000);
    
    // 5. User requests summary
    setTimeout(() => {
        appendChatMessage('You (Demo)', 'AURUS summarize today', 'user');
        socket.emit('user_talk', { message: 'AURUS summarize today' });
        
        // Reset mock
        setTimeout(() => {
            socket.emit('demo_mock_presence', { state: null });
            appendChatMessage('System', 'Demonstration Sequence Complete.', 'system');
        }, 20000);
    }, 55000);
}

// Config Modal Handlers
function openConfigModal() {
    document.getElementById('config-modal').style.display = 'flex';
}

function closeConfigModal() {
    document.getElementById('config-modal').style.display = 'none';
    document.getElementById('modal-status-msg').textContent = '';
}

function saveApiKey() {
    const key = document.getElementById('gemini-key').value.trim();
    const statusMsg = document.getElementById('modal-status-msg');
    
    statusMsg.className = 'modal-status';
    statusMsg.textContent = 'Saving configuration...';
    
    fetch('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            statusMsg.className = 'modal-status success';
            statusMsg.textContent = 'Success! Gemini is active.';
            setTimeout(closeConfigModal, 1500);
        } else {
            statusMsg.className = 'modal-status error';
            statusMsg.textContent = 'Error: ' + data.message;
        }
    })
    .catch(err => {
        statusMsg.className = 'modal-status error';
        statusMsg.textContent = 'Failed connecting to server.';
    });
}

// --- KEYBOARD DIRECT CONTROL ---

const KEY_MAPPINGS = {
    'KeyW': 'W', 'KeyS': 'S', 'KeyA': 'A', 'KeyD': 'D',
    'KeyQ': 'Q', 'KeyE': 'E'
};

window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;
    // Guard: keyboard controls only work in manual mode
    if (currentDriveMode !== 'manual') return;
    if (KEY_MAPPINGS[e.code]) {
        activeKeys[KEY_MAPPINGS[e.code]] = true;
        updateDriveVector();
        highlightPadBtn(e.code, true);
    }
});

window.addEventListener('keyup', (e) => {
    if (KEY_MAPPINGS[e.code]) {
        activeKeys[KEY_MAPPINGS[e.code]] = false;
        updateDriveVector();
        highlightPadBtn(e.code, false);
    }
});

function highlightPadBtn(code, active) {
    let mapping = {
        'KeyW': 'forward',
        'KeyS': 'backward',
        'KeyA': 'strafe_left',
        'KeyD': 'strafe_right',
        'KeyQ': 'spin_left',
        'KeyE': 'spin_right'
    };
    const action = mapping[code];
    if (action) {
        const btn = document.querySelector(`[mousedown-cmd="${action}"]`);
        if (btn) {
            if (active) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    }
}

function updateDriveVector() {
    let vx = 0;
    let vy = 0;
    let omega = 0;
    
    if (activeKeys['W']) vx += 1.0;
    if (activeKeys['S']) vx -= 1.0;
    if (activeKeys['D']) vy += 1.0;
    if (activeKeys['A']) vy -= 1.0;
    if (activeKeys['E']) omega += 1.0;
    if (activeKeys['Q']) omega -= 1.0;
    
    socket.emit('manual_drive', { vx, vy, omega });
}

function updateSpeedMultiplier(val) {
    document.getElementById('speed-val').textContent = val + '%';
    socket.emit('set_speed_multiplier', { multiplier: val / 100.0 });
}

// Precision mouse hold pad events
document.querySelectorAll('.pad-btn[mousedown-cmd]').forEach(btn => {
    const action = btn.getAttribute('mousedown-cmd');
    
    const handleStart = (e) => {
        e.preventDefault();
        let vx = 0, vy = 0, omega = 0;
        
        if (action === 'forward') vx = 1.0;
        else if (action === 'backward') vx = -1.0;
        else if (action === 'strafe_left') vy = -1.0;
        else if (action === 'strafe_right') vy = 1.0;
        else if (action === 'spin_left') omega = -1.0;
        else if (action === 'spin_right') omega = 1.0;
        else if (action === 'diagonal_fl') { vx = 0.7; vy = -0.7; }
        else if (action === 'diagonal_fr') { vx = 0.7; vy = 0.7; }
        
        btn.classList.add('active');
        socket.emit('manual_drive', { vx, vy, omega });
    };
    
    const handleEnd = (e) => {
        btn.classList.remove('active');
        socket.emit('stop');
    };
    
    btn.addEventListener('mousedown', handleStart);
    btn.addEventListener('mouseup', handleEnd);
    btn.addEventListener('mouseleave', handleEnd);
    
    btn.addEventListener('touchstart', handleStart, {passive: false});
    btn.addEventListener('touchend', handleEnd);
});

// --- RENDER 2D SIMULATION ---

function drawSimulation(telemetry) {
    if (!simCanvas) return;
    
    const w = simCanvas.width;
    const h = simCanvas.height;
    simCtx.clearRect(0, 0, w, h);
    
    // Grid system mapping (-150 to +150)
    const toCanvasX = (realX) => ((realX + 150) / 300) * w;
    const toCanvasY = (realY) => ((150 - realY) / 300) * h;
    const sizeScale = w / 300;
    
    // Draw grid back
    simCtx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    simCtx.lineWidth = 1;
    for (let x = -150; x <= 150; x += 30) {
        simCtx.beginPath();
        simCtx.moveTo(toCanvasX(x), 0);
        simCtx.lineTo(toCanvasX(x), h);
        simCtx.stroke();
    }
    for (let y = -150; y <= 150; y += 30) {
        simCtx.beginPath();
        simCtx.moveTo(0, toCanvasY(y));
        simCtx.lineTo(w, toCanvasY(y));
        simCtx.stroke();
    }
    
    // Circular obstacles
    const mockObstacles = [
        { x: 50.0, y: 50.0, r: 25.0 },
        { x: -60.0, y: -40.0, r: 20.0 },
        { x: 0.0, y: 100.0, r: 15.0 }
    ];
    
    mockObstacles.forEach(obs => {
        simCtx.fillStyle = 'rgba(30, 41, 59, 0.4)';
        simCtx.strokeStyle = 'rgba(51, 65, 85, 0.6)';
        simCtx.lineWidth = 2;
        simCtx.beginPath();
        simCtx.arc(toCanvasX(obs.x), toCanvasY(obs.y), obs.r * sizeScale, 0, 2 * Math.PI);
        simCtx.fill();
        simCtx.stroke();
    });

    // Room Border Bounds
    simCtx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
    simCtx.lineWidth = 3;
    simCtx.strokeRect(0, 0, w, h);
    
    // Rover
    const rx = toCanvasX(telemetry.sim_x);
    const ry = toCanvasY(telemetry.sim_y);
    const rtheta = telemetry.sim_theta;
    
    const roverRadius = 14 * sizeScale;
    
    simCtx.save();
    simCtx.translate(rx, ry);
    simCtx.rotate(-rtheta);

    // Sensor rays (5 directions)
    const sensorRays = [
        { dist: telemetry.dist_fl, angle: Math.PI / 4, label: 'FL', color: '#8b5cf6' },
        { dist: telemetry.dist_f,  angle: 0,           label: 'F',  color: '#2563eb' },
        { dist: telemetry.dist_fr, angle: -Math.PI / 4, label: 'FR', color: '#06b6d4' },
        { dist: telemetry.dist_rl, angle: 3 * Math.PI / 4, label: 'RL', color: '#f59e0b' },
        { dist: telemetry.dist_rr, angle: -3 * Math.PI / 4, label: 'RR', color: '#ef4444' }
    ];

    sensorRays.forEach(ray => {
        const dist = ray.dist || 150;
        const alarmColor = '#ef4444';
        const isAlarm = dist < 20;
        const rayDx = Math.cos(ray.angle);
        const rayDy = -Math.sin(ray.angle); // Canvas Y is inverted

        // Sensor ray line
        simCtx.lineWidth = 1;
        simCtx.strokeStyle = isAlarm ? alarmColor : (ray.color + '66');
        simCtx.beginPath();
        simCtx.moveTo(10 * sizeScale * rayDx, 10 * sizeScale * rayDy);
        simCtx.lineTo(dist * sizeScale * rayDx, dist * sizeScale * rayDy);
        simCtx.stroke();

        // Target dot
        simCtx.fillStyle = isAlarm ? alarmColor : ray.color;
        simCtx.beginPath();
        simCtx.arc(dist * sizeScale * rayDx, dist * sizeScale * rayDy, 3, 0, 2 * Math.PI);
        simCtx.fill();
    });

    // Wheels (chassis placements)
    simCtx.fillStyle = '#111827';
    simCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    simCtx.lineWidth = 1.5;
    const wheelW = 12 * sizeScale;
    const wheelH = 6 * sizeScale;
    
    const wheelOffsets = [
        { x: 8, y: 12, angle: Math.PI/4 },
        { x: 8, y: -12, angle: -Math.PI/4 },
        { x: -8, y: 12, angle: -Math.PI/4 },
        { x: -8, y: -12, angle: Math.PI/4 }
    ];
    
    wheelOffsets.forEach(wOffset => {
        simCtx.save();
        simCtx.translate(wOffset.x * sizeScale, wOffset.y * sizeScale);
        simCtx.rotate(wOffset.angle);
        simCtx.fillRect(-wheelW/2, -wheelH/2, wheelW, wheelH);
        simCtx.strokeRect(-wheelW/2, -wheelH/2, wheelW, wheelH);
        simCtx.restore();
    });
    
    // Chassis
    const chassisColor = telemetry.expression === 'scared' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(37, 99, 235, 0.15)';
    const strokeColor = telemetry.expression === 'scared' ? '#ef4444' : '#2563eb';
    
    simCtx.fillStyle = chassisColor;
    simCtx.strokeStyle = strokeColor;
    simCtx.lineWidth = 2.5;
    
    simCtx.beginPath();
    simCtx.arc(0, 0, roverRadius, 0, 2 * Math.PI);
    simCtx.fill();
    simCtx.stroke();
    
    // Direction cap
    simCtx.fillStyle = 'white';
    simCtx.beginPath();
    simCtx.moveTo(roverRadius - 3, 0);
    simCtx.lineTo(roverRadius - 10, -5);
    simCtx.lineTo(roverRadius - 10, 5);
    simCtx.closePath();
    simCtx.fill();
    
    simCtx.restore();
}

// --- RENDER SONAR RADAR ---

function drawRadar(telemetry) {
    if (!radarCanvas) return;
    
    const w = radarCanvas.width;
    const h = radarCanvas.height;
    
    radarCtx.clearRect(0, 0, w, h);
    
    const cx = w / 2;
    const cy = h / 2;
    const maxRadius = Math.min(w, h) / 2 - 10;
    
    // Draw rings
    radarCtx.strokeStyle = 'rgba(37, 99, 235, 0.12)';
    radarCtx.lineWidth = 1;
    for (let r = maxRadius; r >= maxRadius * 0.25; r -= maxRadius * 0.25) {
        radarCtx.beginPath();
        radarCtx.arc(cx, cy, r, 0, 2 * Math.PI);
        radarCtx.stroke();
    }
    
    // Radar axes (crosshair + diagonals)
    radarCtx.strokeStyle = 'rgba(37, 99, 235, 0.06)';
    radarCtx.beginPath();
    // Horizontal
    radarCtx.moveTo(cx - maxRadius, cy);
    radarCtx.lineTo(cx + maxRadius, cy);
    // Vertical
    radarCtx.moveTo(cx, cy - maxRadius);
    radarCtx.lineTo(cx, cy + maxRadius);
    // Diagonal lines for the 45° sensors
    const diagLen = maxRadius * 0.707;
    radarCtx.moveTo(cx - diagLen, cy - diagLen);
    radarCtx.lineTo(cx + diagLen, cy + diagLen);
    radarCtx.moveTo(cx + diagLen, cy - diagLen);
    radarCtx.lineTo(cx - diagLen, cy + diagLen);
    radarCtx.stroke();
    
    // Scanner Sweep
    const scanAngle = (Date.now() / 600) % (2 * Math.PI);
    const grad = radarCtx.createRadialGradient(cx, cy, 2, cx, cy, maxRadius);
    grad.addColorStop(0, 'rgba(37, 99, 235, 0)');
    grad.addColorStop(1, 'rgba(37, 99, 235, 0.15)');
    
    radarCtx.fillStyle = grad;
    radarCtx.beginPath();
    radarCtx.moveTo(cx, cy);
    radarCtx.arc(cx, cy, maxRadius, scanAngle - 0.4, scanAngle);
    radarCtx.closePath();
    radarCtx.fill();
    
    const mapDist = (d) => Math.min(maxRadius, (d / 150.0) * maxRadius);
    
    // 5 sensor targets: [key, angle_rad (0=right, CCW positive), color, label]
    // Radar display: 0° = up (front), angles go CW on screen
    const sensorTargets = [
        { key: 'dist_fl', angle: -Math.PI / 4, color: '#8b5cf6', label: 'FL' },
        { key: 'dist_f',  angle: 0,            color: '#10b981', label: 'F' },
        { key: 'dist_fr', angle: Math.PI / 4,  color: '#06b6d4', label: 'FR' },
        { key: 'dist_rl', angle: -3 * Math.PI / 4, color: '#f59e0b', label: 'RL' },
        { key: 'dist_rr', angle: 3 * Math.PI / 4,  color: '#ef4444', label: 'RR' }
    ];
    
    sensorTargets.forEach(s => {
        const dist = telemetry[s.key];
        if (dist != null && dist < 150) {
            const fd = mapDist(dist);
            const isAlarm = dist < 15.0;
            // Radar: 0° = up, so x = sin(angle), y = -cos(angle)
            const tx = cx + fd * Math.sin(s.angle);
            const ty = cy - fd * Math.cos(s.angle);
            
            radarCtx.fillStyle = isAlarm ? '#ef4444' : s.color;
            radarCtx.beginPath();
            radarCtx.arc(tx, ty, 5, 0, 2 * Math.PI);
            radarCtx.fill();
            
            // Label
            radarCtx.fillStyle = isAlarm ? '#ef4444' : 'rgba(255,255,255,0.4)';
            radarCtx.font = '9px Inter, sans-serif';
            radarCtx.textAlign = 'center';
            radarCtx.fillText(s.label, tx, ty - 8);
        }
    });
}

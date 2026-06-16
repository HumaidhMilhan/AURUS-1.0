class RoverFace {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        
        // Base dimensions
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        
        // Target state parameters for interpolations
        this.states = {
            happy: { eyeOpen: 1.0, pupilScale: 0.8, browAngle: 0.15, browHeight: -18, shape: 'crescent', color: '#10b981' },
            sad: { eyeOpen: 0.7, pupilScale: 0.65, browAngle: -0.2, browHeight: -5, shape: 'droop', color: '#6366f1' },
            curious: { eyeOpen: 1.2, pupilScale: 1.1, browAngle: 0.0, browHeight: -25, shape: 'circle', color: '#2563eb' },
            scared: { eyeOpen: 1.3, pupilScale: 0.4, browAngle: -0.3, browHeight: -30, shape: 'circle', color: '#ef4444' },
            sleeping: { eyeOpen: 0.0, pupilScale: 0.0, browAngle: 0.0, browHeight: -5, shape: 'line', color: '#64748b' },
            listening: { eyeOpen: 1.0, pupilScale: 0.9, browAngle: 0.1, browHeight: -20, shape: 'pulse', color: '#06b6d4' }
        };
        
        // Current state variables (lerped towards active expression state)
        this.current = {
            eyeOpen: 1.0,
            pupilScale: 0.8,
            browAngle: 0.15,
            browHeight: -18,
            color: '#10b981'
        };
        
        this.activeExpression = 'happy';
        this.blinkFactor = 1.0;  // 1 = fully open, 0 = fully shut (blink)
        this.isBlinking = false;
        
        // Micro-interaction variables
        this.shiverX = 0;
        this.shiverY = 0;
        this.pupilOffsetX = 0;
        this.pupilOffsetY = 0;
        this.pulseTime = 0;
        
        // Kick off loops
        this.startBlinkTimer();
        this.animate();
    }
    
    setExpression(expression) {
        if (this.states[expression]) {
            this.activeExpression = expression;
        }
    }
    
    startBlinkTimer() {
        const scheduleNextBlink = () => {
            const delay = 3000 + Math.random() * 4000; // blink every 3-7s
            setTimeout(() => {
                this.triggerBlink();
                scheduleNextBlink();
            }, delay);
        };
        scheduleNextBlink();
    }
    
    triggerBlink() {
        if (this.activeExpression === 'sleeping') return;
        this.isBlinking = true;
        let elapsed = 0;
        const duration = 160; // 160ms blink
        const interval = 16;
        
        const blinkInterval = setInterval(() => {
            elapsed += interval;
            const progress = elapsed / duration;
            
            if (progress <= 0.5) {
                // Closing
                this.blinkFactor = 1.0 - (progress * 2);
            } else if (progress <= 1.0) {
                // Opening
                this.blinkFactor = (progress - 0.5) * 2;
            } else {
                this.blinkFactor = 1.0;
                this.isBlinking = false;
                clearInterval(blinkInterval);
            }
        }, interval);
    }
    
    // Help helper function to interpolate colors
    lerpColor(a, b, amount) {
        const ah = parseInt(a.replace(/#/g, ''), 16),
              ar = ah >> 16, ag = ah >> 8 & 0xff, ab = ah & 0xff,
              bh = parseInt(b.replace(/#/g, ''), 16),
              br = bh >> 16, bg = bh >> 8 & 0xff, bb = bh & 0xff,
              rr = ar + amount * (br - ar),
              rg = ag + amount * (bg - ag),
              rb = ab + amount * (bb - ab);
        return '#' + ((1 << 24) + (rr << 16) + (rg << 8) + rb | 0).toString(16).slice(1);
    }
    
    update() {
        const target = this.states[this.activeExpression];
        const ease = 0.15; // Smooth interpolation speed
        
        // Lerp states
        this.current.eyeOpen += (target.eyeOpen - this.current.eyeOpen) * ease;
        this.current.pupilScale += (target.pupilScale - this.current.pupilScale) * ease;
        this.current.browAngle += (target.browAngle - this.current.browAngle) * ease;
        this.current.browHeight += (target.browHeight - this.current.browHeight) * ease;
        this.current.color = this.lerpColor(this.current.color, target.color, ease);
        
        // Shiver micro-animation for scared state
        if (this.activeExpression === 'scared') {
            this.shiverX = (Math.random() - 0.5) * 6;
            this.shiverY = (Math.random() - 0.5) * 6;
        } else {
            this.shiverX = 0;
            this.shiverY = 0;
        }
        
        // Pupil drifting for curiosity state
        if (this.activeExpression === 'curious') {
            this.pulseTime += 0.05;
            this.pupilOffsetX = Math.sin(this.pulseTime) * 12;
            this.pupilOffsetY = Math.cos(this.pulseTime * 0.7) * 4;
        } else {
            this.pupilOffsetX += (0 - this.pupilOffsetX) * 0.1;
            this.pupilOffsetY += (0 - this.pupilOffsetY) * 0.1;
        }
        
        if (this.activeExpression === 'listening') {
            this.pulseTime += 0.15;
        }
    }
    
    drawEye(x, y, radius, isLeft) {
        const ctx = this.ctx;
        const openHeight = radius * this.current.eyeOpen * this.blinkFactor;
        const targetShape = this.states[this.activeExpression].shape;
        
        ctx.save();
        ctx.translate(x + this.shiverX, y + this.shiverY);
        
        // Eyebrows
        ctx.strokeStyle = this.current.color;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const direction = isLeft ? 1 : -1;
        ctx.translate(0, this.current.browHeight);
        ctx.rotate(this.current.browAngle * direction);
        ctx.moveTo(-radius * 1.2, 0);
        ctx.lineTo(radius * 1.2, 0);
        ctx.stroke();
        
        // Restore for eye outline
        ctx.restore();
        ctx.save();
        ctx.translate(x + this.shiverX, y + this.shiverY);
        
        // Colors & Shadows
        ctx.shadowColor = this.current.color;
        ctx.shadowBlur = 18;
        ctx.strokeStyle = this.current.color;
        ctx.fillStyle = this.current.color;
        
        // Draw Outline depending on expression
        if (this.blinkFactor < 0.1 || targetShape === 'line') {
            // Closed / Sleeping eyes
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0.1 * Math.PI, 0.9 * Math.PI, false);
            ctx.stroke();
        } 
        else if (targetShape === 'crescent') {
            // Happy crescent shapes
            ctx.beginPath();
            ctx.lineWidth = 6;
            ctx.arc(0, -radius * 0.1, radius, 1.25 * Math.PI, 1.75 * Math.PI, false);
            ctx.arc(0, -radius * 0.1 + 8, radius - 8, 1.75 * Math.PI, 1.25 * Math.PI, true);
            ctx.closePath();
            ctx.fill();
        } 
        else if (targetShape === 'droop') {
            // Sad droopy eyes
            ctx.beginPath();
            ctx.lineWidth = 5;
            ctx.ellipse(0, 0, radius, openHeight * 0.9, 0, 0, 2 * Math.PI);
            ctx.stroke();
            
            // Draw pupil looking down-inward
            ctx.save();
            const lookDir = isLeft ? 6 : -6;
            ctx.translate(lookDir, openHeight * 0.3);
            ctx.beginPath();
            ctx.arc(0, 0, radius * this.current.pupilScale * 0.7, 0, 2 * Math.PI);
            ctx.fill();
            ctx.restore();
        }
        else if (targetShape === 'pulse') {
            // Listening state - Draw pulsing waves around eyes
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, 2 * Math.PI);
            ctx.stroke();
            
            // Outer pulse wave
            ctx.lineWidth = 2;
            const waveScale = 1.0 + (Math.sin(this.pulseTime) * 0.25);
            ctx.strokeStyle = this.hexToRgba(this.current.color, 0.4);
            ctx.beginPath();
            ctx.arc(0, 0, radius * waveScale, 0, 2 * Math.PI);
            ctx.stroke();
            
            // Pupil
            ctx.fillStyle = this.current.color;
            ctx.beginPath();
            ctx.arc(0, 0, radius * this.current.pupilScale, 0, 2 * Math.PI);
            ctx.fill();
        }
        else {
            // Curious, Scared or default wide eyes
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.ellipse(0, 0, radius, openHeight, 0, 0, 2 * Math.PI);
            ctx.stroke();
            
            // Draw pupil with offsets
            ctx.save();
            ctx.translate(this.pupilOffsetX, this.pupilOffsetY);
            ctx.beginPath();
            ctx.arc(0, 0, radius * this.current.pupilScale * 0.6, 0, 2 * Math.PI);
            ctx.fill();
            
            // Highlighting catchlight inside pupil
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(-radius * 0.15, -radius * 0.15, radius * 0.12, 0, 2 * Math.PI);
            ctx.fill();
            ctx.restore();
        }
        
        ctx.restore();
    }
    
    hexToRgba(hex, alpha) {
        const h = parseInt(hex.replace(/#/g, ''), 16);
        const r = h >> 16;
        const g = h >> 8 & 0xff;
        const b = h & 0xff;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    
    animate() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        // Update states
        this.update();
        
        // Draw eyes
        const eyeRadius = 45;
        const leftEyeX = this.width / 2 - 95;
        const rightEyeX = this.width / 2 + 95;
        const eyeY = this.height / 2;
        
        this.drawEye(leftEyeX, eyeY, eyeRadius, true);
        this.drawEye(rightEyeX, eyeY, eyeRadius, false);
        
        // Draw mouth
        this.drawMouth();
        
        // Loop frame
        requestAnimationFrame(() => this.animate());
    }
    
    drawMouth() {
        const ctx = this.ctx;
        const x = this.width / 2;
        const y = this.height / 2 + 65;
        const active = this.activeExpression;
        
        ctx.save();
        ctx.translate(x + this.shiverX, y + this.shiverY);
        ctx.strokeStyle = this.current.color;
        ctx.shadowColor = this.current.color;
        ctx.shadowBlur = 10;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.fillStyle = this.current.color;
        
        if (active === 'happy') {
            // Smile arc
            ctx.beginPath();
            ctx.arc(0, -10, 20, 0.1 * Math.PI, 0.9 * Math.PI, false);
            ctx.stroke();
        } 
        else if (active === 'sad') {
            // Frown arc
            ctx.beginPath();
            ctx.arc(0, 10, 20, 1.1 * Math.PI, 1.9 * Math.PI, false);
            ctx.stroke();
        } 
        else if (active === 'scared') {
            // O-shaped mouth
            ctx.beginPath();
            ctx.ellipse(0, 0, 12, 18, 0, 0, 2 * Math.PI);
            ctx.stroke();
        } 
        else if (active === 'sleeping') {
            // Tiny ZZZs
            ctx.restore();
            this.drawZzzs(x + 110, y - 90);
            return;
        } 
        else if (active === 'listening') {
            // Straight waveform line
            ctx.beginPath();
            const width = 60;
            const segments = 10;
            ctx.moveTo(-width / 2, 0);
            for (let i = 0; i <= segments; i++) {
                const px = -width / 2 + (width / segments) * i;
                // Wave amplitude
                const amp = i === 0 || i === segments ? 0 : Math.sin(this.pulseTime * 2 + i) * 6;
                ctx.lineTo(px, amp);
            }
            ctx.stroke();
        }
        else {
            // Curious: small flat smirk
            ctx.beginPath();
            ctx.moveTo(-12, 0);
            ctx.lineTo(12, 0);
            ctx.stroke();
        }
        
        ctx.restore();
    }
    
    drawZzzs(startX, startY) {
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = '#64748b';
        ctx.font = '700 14px "Outfit"';
        
        // Draw Z offsets based on sine waves
        const timeFactor = Date.now() * 0.002;
        for (let i = 0; i < 3; i++) {
            const opacity = Math.max(0, Math.sin(timeFactor - i * 1.5));
            ctx.fillStyle = `rgba(100, 116, 139, ${opacity})`;
            
            const dx = Math.sin(timeFactor * 1.5 + i * 2) * 15 + i * 20;
            const dy = -i * 25 - (timeFactor * 10) % 25;
            const size = 12 + i * 4;
            
            ctx.font = `700 ${size}px "Outfit"`;
            ctx.fillText("Z", startX + dx, startY + dy);
        }
        ctx.restore();
    }
}

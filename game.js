// === GAME CONSTANTS ===
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// === DOM ELEMENTS ===
const startScreen = document.getElementById('start-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const hud = document.getElementById('hud');
const scoreValue = document.getElementById('score-value');
const waveValue = document.getElementById('wave-value');
const livesDisplay = document.getElementById('lives-display');
const finalScoreValue = document.getElementById('final-score-value');
const highScoreValue = document.getElementById('high-score-value');

// === GAME STATE ===
let gameState = 'START'; // START | PLAYING | GAME_OVER
let score = 0;
let wave = 1;

let highScore = parseInt(localStorage.getItem('galacticAssault_highScore')) || 0;
let lastTime = 0;
let screenFlashTimer = 0;

// === INPUT ===
const keys = {};
window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
        e.preventDefault();
    }
});
window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

// === MOBILE / TOUCH INPUT ===
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let touchActive = false;
let playerTouchOffsetX = 0;

canvas.addEventListener('pointerdown', (e) => {
    if (gameState !== 'PLAYING') return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const clientX = e.clientX * scaleX;

    touchActive = true;
    playerTouchOffsetX = player.x - clientX; // offset from ship center for natural drag feel
    canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
    if (!touchActive || gameState !== 'PLAYING') return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const clientX = e.clientX * scaleX;

    // Move ship to follow finger, clamped to bounds
    player.x = Math.max(player.width / 2,
        Math.min(W - player.width / 2,
            clientX + playerTouchOffsetX));
});

canvas.addEventListener('pointerup', (e) => {
    touchActive = false;
});

canvas.addEventListener('pointercancel', (e) => {
    touchActive = false;
});

// === SOUND MANAGER ===
const soundManager = (() => {
    let audioCtx = null;

    function ensureAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioCtx;
    }

    // Pre-generate a single shared white noise buffer (4 seconds, reused for all explosions)
    let noiseBuffer = null;
    function getNoiseBuffer(ctx) {
        if (!noiseBuffer) {
            const sampleRate = ctx.sampleRate;
            const length = sampleRate * 4; // 4 seconds
            const buffer = ctx.createBuffer(1, length, sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            noiseBuffer = buffer;
        }
        return noiseBuffer;
    }

    function playPlayerLaser() {
        const ctx = ensureAudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.12);
    }

    function playEnemyLaser() {
        const ctx = ensureAudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(350, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
    }

    function playExplosion(size) {
        const ctx = ensureAudioContext();
        const buffer = getNoiseBuffer(ctx);

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';

        const gain = ctx.createGain();

        let duration, startFreq, volume;
        switch (size) {
            case 'small':
                duration = 0.1;
                startFreq = 800;
                volume = 0.2;
                break;
            case 'medium':
                duration = 0.2;
                startFreq = 600;
                volume = 0.35;
                break;
            case 'large':
            default:
                duration = 0.4;
                startFreq = 400;
                volume = 0.5;
                break;
        }

        filter.frequency.setValueAtTime(startFreq, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + duration);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

        source.connect(filter).connect(gain).connect(ctx.destination);
        source.start(ctx.currentTime);
        source.stop(ctx.currentTime + duration);
    }

    return { playPlayerLaser, playEnemyLaser, playExplosion };
})();

// === PLAYER ===
const player = {
    x: W / 2,
    y: H - 50,
    width: 28,
    height: 24,
    speed: 220, // pixels per second
    color: '#00e5ff',
    hitCount: 0,
    invulnTimer: 0,

    getDamageColor() {
        if (this.hitCount === 1) return '#ffea00';
        if (this.hitCount === 2) return '#ff1744';
        return '#00e5ff';
    },

    update(dt) {
        if (keys['ArrowLeft'] || keys['KeyA']) {
            this.x -= this.speed * dt;
        }
        if (keys['ArrowRight'] || keys['KeyD']) {
            this.x += this.speed * dt;
        }

        // Clamp to canvas bounds
        this.x = Math.max(this.width / 2, Math.min(W - this.width / 2, this.x));

        // Shooting — fire on space press or while touch is active (auto-fire, with cooldown)
        if (keys['Space'] || touchActive) {
            if (!this.fireTimer || this.fireTimer <= 0) {
                lasers.push(createPlayerLaser(this.x, this.y - this.height / 2));
                soundManager.playPlayerLaser();
                this.fireTimer = 0.15; // 150ms cooldown
            }
        }
        if (this.fireTimer !== undefined) {
            this.fireTimer -= dt;
        }

        // Invulnerability countdown
        if (this.invulnTimer > 0) {
            this.invulnTimer -= dt;
        }
    },

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);

        const hw = this.width;   // half-width of the ship
        const hh = this.height;  // half-height of the ship

        // Invulnerability — dim ship instead of hiding it
        if (this.invulnTimer > 0 && Math.floor(this.invulnTimer * 10) % 2 === 0) {
            ctx.globalAlpha = 0.3;
        } else if (this.invulnTimer > 0) {
            ctx.globalAlpha = 0.7;
        }

        // --- Main body — compact angular delta fuselage ---
        ctx.fillStyle = this.getDamageColor();
        ctx.shadowColor = this.getDamageColor();
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(0, -hh);                        // pointed nose (top)
        ctx.lineTo(-hw * 0.55, hh * 0.25);         // left wing tip
        ctx.lineTo(-hw * 0.35, hh * 0.45);         // left rear corner
        ctx.lineTo(0, hh * 0.35);                  // center tail notch
        ctx.lineTo(hw * 0.35, hh * 0.45);          // right rear corner
        ctx.lineTo(hw * 0.55, hh * 0.25);          // right wing tip
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // --- Body center-line ridge ---
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -hh + 3);
        ctx.lineTo(0, hh * 0.4);
        ctx.stroke();

        // --- Cockpit — angular diamond canopy near nose ---
        ctx.fillStyle = '#0a1628';
        ctx.beginPath();
        ctx.moveTo(0, -hh * 0.7);                  // front tip
        ctx.lineTo(-hw * 0.15, -hh * 0.35);        // left corner
        ctx.lineTo(0, -hh * 0.2);                  // back point
        ctx.lineTo(hw * 0.15, -hh * 0.35);         // right corner
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Cockpit highlight — sharp white line on left edge
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-hw * 0.07, -hh * 0.55);
        ctx.lineTo(-hw * 0.1, -hh * 0.38);
        ctx.stroke();

        // --- Engine glow (dual angular exhaust at rear) ---
        const enginePulse = 3 + Math.random() * 5;
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ff9100';
        ctx.shadowColor = '#ff9100';
        ctx.shadowBlur = 10;

        // Left engine — angular flame shape
        ctx.beginPath();
        ctx.moveTo(-hw * 0.12, hh * 0.4);
        ctx.lineTo(-hw * 0.16, hh * 0.45 + enginePulse);
        ctx.lineTo(-hw * 0.04, hh * 0.45 + enginePulse * 0.3);
        ctx.closePath();
        ctx.fill();

        // Right engine
        ctx.beginPath();
        ctx.moveTo(hw * 0.12, hh * 0.4);
        ctx.lineTo(hw * 0.16, hh * 0.45 + enginePulse);
        ctx.lineTo(hw * 0.04, hh * 0.45 + enginePulse * 0.3);
        ctx.closePath();
        ctx.fill();

        // Engine cores — bright yellow-white rectangles
        ctx.fillStyle = '#ffea00';
        ctx.fillRect(-hw * 0.1, hh * 0.4, 3, enginePulse * 0.5);
        ctx.fillRect(hw * 0.07, hh * 0.4, 3, enginePulse * 0.5);

        ctx.globalAlpha = 1; // reset alpha
        ctx.restore();
    }
};

// === LASERS ===
const lasers = [];

function createPlayerLaser(x, y) {
    return {
        x, y,
        width: 3,
        height: 12,
        speed: 500, // px/sec upward
        color: '#00e5ff',
        isPlayer: true,

        update(dt) {
            this.y -= this.speed * dt;
        },

        draw() {
            ctx.save();
            ctx.fillStyle = this.color;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 10;
            ctx.fillRect(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height);
            // Brighter core
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(this.x - 1, this.y - this.height / 2, 2, this.height);
            ctx.restore();
        },

        isOffScreen() {
            return this.y < -this.height;
        }
    };
}

function createEnemyLaser(x, y) {
    return {
        x, y,
        width: 3,
        height: 10,
        speed: 250, // px/sec downward
        color: '#ff1744',
        isPlayer: false,

        update(dt) {
            this.y += this.speed * dt;
        },

        draw() {
            ctx.save();
            ctx.fillStyle = this.color;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 8;
            ctx.fillRect(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height);
            ctx.restore();
        },

        isOffScreen() {
            return this.y > H + this.height;
        }
    };
}

// === ENEMY TYPES ===
const enemyTypes = [
    {
        name: 'grunt',
        width: 28,
        height: 24,
        color: '#76ff03',
        glowColor: '#76ff03',
        points: 100,
        hp: 1
    },
    {
        name: 'elite',
        width: 32,
        height: 28,
        color: '#ff9100',
        glowColor: '#ff9100',
        points: 250,
        hp: 2
    },
    {
        name: 'boss',
        width: 40,
        height: 36,
        color: '#d500f9',
        glowColor: '#d500f9',
        points: 500,
        hp: 4
    }
];

// === ENEMIES ===
const enemies = [];

function createEnemy(x, y, typeIndex) {
    const type = enemyTypes[typeIndex];
    return {
        x, y,
        width: type.width,
        height: type.height,
        color: type.color,
        glowColor: type.glowColor,
        points: type.points,
        hp: type.hp,
        maxHp: type.hp,
        name: type.name,
        speed: 40 + wave * 5, // base speed increases with wave
        phase: Math.random() * Math.PI * 2, // random starting phase for sine drift
        shootTimer: 2 + Math.random() * 3, // time until next shot

        update(dt) {
            this.y += this.speed * dt;
            this.x += Math.sin(this.y * 0.015 + this.phase) * 60 * dt;

            // Clamp horizontal position
            this.x = Math.max(this.width / 2, Math.min(W - this.width / 2, this.x));

            // Enemy shooting — chance to fire downward lasers
            this.shootTimer -= dt;
            if (this.shootTimer <= 0 && this.y > 0 && this.y < H * 0.7) {
                lasers.push(createEnemyLaser(this.x, this.y + this.height / 2));
                soundManager.playEnemyLaser();
                this.shootTimer = 3 + Math.random() * 4 - wave * 0.15; // faster shooting in later waves
                if (this.shootTimer < 1.0) this.shootTimer = 1.0;
            }
        },

      draw() {
            ctx.save();
            ctx.translate(this.x, this.y);

            // Draw main body — solid fill with outline for visibility
            ctx.fillStyle = this.color;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;

            if (this.name === 'grunt') {
                // Small scout ship — delta wing fighter facing down
                ctx.beginPath();
                ctx.moveTo(0, this.height / 2);       // nose (bottom)
                ctx.lineTo(-this.width / 3, -this.height / 4);
                ctx.lineTo(-this.width / 2.5, -this.height / 2 + 2);
                ctx.lineTo(-this.width / 6, -this.height / 3);
                ctx.lineTo(this.width / 6, -this.height / 3);
                ctx.lineTo(this.width / 2.5, -this.height / 2 + 2);
                ctx.lineTo(this.width / 3, -this.height / 4);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Cockpit window (dark)
                ctx.fillStyle = '#1a1a2e';
                ctx.beginPath();
                ctx.moveTo(0, this.height / 3);
                ctx.lineTo(-5, -this.height / 6);
                ctx.lineTo(5, -this.height / 6);
                ctx.closePath();
                ctx.fill();

                // Engine glow at top (back of ship)
                ctx.fillStyle = '#ff9100';
                ctx.shadowColor = '#ff9100';
                ctx.shadowBlur = 6;
                ctx.fillRect(-8, -this.height / 2 - 2, 5, 4 + Math.random() * 3);
                ctx.fillRect(3, -this.height / 2 - 2, 5, 4 + Math.random() * 3);

            } else if (this.name === 'elite') {
                // Medium interceptor — angular twin-fin design facing down
                ctx.beginPath();
                ctx.moveTo(0, this.height / 2);       // nose
                ctx.lineTo(-6, this.height / 4);
                ctx.lineTo(-8, -this.height / 3);
                ctx.lineTo(-this.width / 2, -this.height / 2 + 4);
                ctx.lineTo(-this.width / 3, -this.height / 3);
                ctx.lineTo(0, -this.height / 4);
                ctx.lineTo(this.width / 3, -this.height / 3);
                ctx.lineTo(this.width / 2, -this.height / 2 + 4);
                ctx.lineTo(8, -this.height / 3);
                ctx.lineTo(6, this.height / 4);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Cockpit
                ctx.fillStyle = '#1a1a2e';
                ctx.beginPath();
                ctx.moveTo(0, this.height / 3);
                ctx.lineTo(-4, -this.height / 8);
                ctx.lineTo(4, -this.height / 8);
                ctx.closePath();
                ctx.fill();

                // Engine glow
                ctx.fillStyle = '#ff6d00';
                ctx.shadowColor = '#ff6d00';
                ctx.shadowBlur = 5;
                ctx.fillRect(-12, -this.height / 2, 4, 3 + Math.random() * 2);
                ctx.fillRect(8, -this.height / 2, 4, 3 + Math.random() * 2);

            } else if (this.name === 'boss') {
                // Heavy dreadnought — wide menacing design facing down
                ctx.beginPath();
                ctx.moveTo(0, this.height / 2);       // nose
                ctx.lineTo(-10, this.height / 3);
                ctx.lineTo(-this.width / 3, this.height / 6);
                ctx.lineTo(-this.width / 2.5, -this.height / 4);
                ctx.lineTo(-this.width / 2, -this.height / 2 + 6);
                ctx.lineTo(-this.width / 3, -this.height / 2 + 2);
                ctx.lineTo(0, -this.height / 3);
                ctx.lineTo(this.width / 3, -this.height / 2 + 2);
                ctx.lineTo(this.width / 2, -this.height / 2 + 6);
                ctx.lineTo(this.width / 2.5, -this.height / 4);
                ctx.lineTo(this.width / 3, this.height / 6);
                ctx.lineTo(10, this.height / 3);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Wing accents (darker)
                ctx.fillStyle = '#9c27b0';
                ctx.beginPath();
                ctx.moveTo(-this.width / 2, -this.height / 2 + 6);
                ctx.lineTo(-this.width / 1.4, this.height / 4);
                ctx.lineTo(-this.width / 3, this.height / 6);
                ctx.closePath();
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(this.width / 2, -this.height / 2 + 6);
                ctx.lineTo(this.width / 1.4, this.height / 4);
                ctx.lineTo(this.width / 3, this.height / 6);
                ctx.closePath();
                ctx.fill();

                // Cockpit cluster (3 windows)
                ctx.fillStyle = '#1a1a2e';
                ctx.beginPath();
                ctx.arc(0, this.height / 4, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(-8, this.height / 6, 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(8, this.height / 6, 3, 0, Math.PI * 2);
                ctx.fill();

                // Engine glow (triple)
                ctx.fillStyle = '#e040fb';
                ctx.shadowColor = '#e040fb';
                ctx.shadowBlur = 8;
                ctx.fillRect(-16, -this.height / 2 - 3, 6, 5 + Math.random() * 4);
                ctx.fillRect(-4, -this.height / 2 - 3, 8, 5 + Math.random() * 4);
                ctx.fillRect(10, -this.height / 2 - 3, 6, 5 + Math.random() * 4);
            }

            // HP indicator for enemies with >1 max hp
            if (this.maxHp > 1) {
                const barWidth = this.width;
                const barHeight = 3;
                const barY = this.height / 2 + 6;
                ctx.fillStyle = '#333';
                ctx.fillRect(-barWidth / 2, barY, barWidth, barHeight);
                ctx.fillStyle = this.hp > this.maxHp * 0.5 ? '#76ff03' : '#ff1744';
                ctx.fillRect(-barWidth / 2, barY, barWidth * (this.hp / this.maxHp), barHeight);
            }

            ctx.restore();
        },

        isOffScreen() {
            return this.y > H + this.height;
        }
    };
}

// === WAVE SPAWNING ===
let waveEnemiesRemaining = 0;
let spawnTimer = 0;
let spawnQueue = [];

function startWave(waveNum) {
    wave = waveNum;
    enemies.length = 0;
    spawnQueue = [];

    // Build formation: rows of enemies
    const rows = Math.min(3 + Math.floor(waveNum / 2), 6);
    const cols = Math.min(5 + Math.floor(waveNum / 3), 9);

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            let typeIndex = 0; // grunt
            if (row === 0 && waveNum >= 2) typeIndex = 2; // boss in top row from wave 2+
            else if (row <= 1 && waveNum >= 1) typeIndex = 1; // elite in second row

            const x = (W / (cols + 1)) * (col + 1);
            const y = -40 - row * 50; // start above screen

            spawnQueue.push({ x, y, typeIndex });
        }
    }

    waveEnemiesRemaining = spawnQueue.length;
    spawnTimer = 0;
}

function updateWaveSpawning(dt) {
    if (spawnQueue.length === 0) return;

    // Spawn rate increases with wave
    const spawnRate = Math.max(0.15, 0.35 - wave * 0.02);
    spawnTimer -= dt;

    if (spawnTimer <= 0) {
        const next = spawnQueue.shift();
        enemies.push(createEnemy(next.x, next.y, next.typeIndex));
        spawnTimer = spawnRate;
    }
}

// === STARFIELD BACKGROUND ===
const stars = [];
for (let i = 0; i < 120; i++) {
    stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 40 + 20,
        brightness: Math.random() * 0.6 + 0.4
    });
}

function updateStars(dt) {
    for (const star of stars) {
        star.y += star.speed * dt;
        if (star.y > H) {
            star.y = 0;
            star.x = Math.random() * W;
        }
    }
}

function drawStars() {
    for (const star of stars) {
        ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;
        ctx.fillRect(star.x, star.y, star.size, star.size);
    }
}

// === PARTICLES (explosions) ===
const particles = [];

function createExplosion(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 150 + 50;
        particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: Math.random() * 4 + 2,
            color,
            life: 0.4 + Math.random() * 0.3, // seconds
            maxLife: 0.4 + Math.random() * 0.3
        });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) {
            particles.splice(i, 1);
        }
    }
}

function drawParticles() {
    for (const p of particles) {
        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
}

// === HUD UPDATE ===
function updateHUD() {
    scoreValue.textContent = score;
    waveValue.textContent = wave;
    livesDisplay.innerHTML = '';
    // Draw 3 damage indicator dots — colored by hitCount
    const dotColors = ['#00e5ff', '#ffea00', '#ff1744'];
    for (let i = 0; i < 3; i++) {
        const icon = document.createElement('canvas');
        icon.width = 20;
        icon.height = 20;
        const ictx = icon.getContext('2d');
        if (i < player.hitCount) {
            // This dot is damaged — dim gray
            ictx.fillStyle = '#555';
            ictx.shadowBlur = 0;
        } else {
            // This dot is still intact — show next color in sequence
            ictx.fillStyle = dotColors[player.hitCount];
            ictx.shadowColor = dotColors[player.hitCount];
            ictx.shadowBlur = 4;
        }
        ictx.beginPath();
        ictx.arc(10, 10, 7, 0, Math.PI * 2);
        ictx.fill();
        livesDisplay.appendChild(icon);
    }
}

// === SCREENS ===
function showStartScreen() {
    startScreen.classList.remove('hidden');
    gameoverScreen.classList.add('hidden');
    hud.classList.add('hidden');
}

function showGameScreen() {
    startScreen.classList.add('hidden');
    gameoverScreen.classList.add('hidden');
    hud.classList.remove('hidden');
}

function showGameOverScreen() {
    startScreen.classList.add('hidden');
    gameoverScreen.classList.remove('hidden');
    hud.classList.add('hidden');
    finalScoreValue.textContent = score;
    highScoreValue.textContent = highScore;
}

// === COLLISION DETECTION (AABB) ===
function aabbCollision(a, b) {
    return (
        a.x - a.width / 2 < b.x + b.width / 2 &&
        a.x + a.width / 2 > b.x - b.width / 2 &&
        a.y - a.height / 2 < b.y + b.height / 2 &&
        a.y + a.height / 2 > b.y - b.height / 2
    );
}

// === GAME LOOP ===
function gameLoop(timestamp) {
    requestAnimationFrame(gameLoop);

    const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // cap delta
    lastTime = timestamp;

    // Clear canvas
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, W, H);

    // Screen flash on hit (white overlay that fades out)
    if (screenFlashTimer > 0) {
        const alpha = Math.min(0.4, screenFlashTimer * 3);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fillRect(0, 0, W, H);
    }

    // Always draw stars
    updateStars(dt);
    drawStars();

    if (gameState === 'START') {
        return;
    }

    if (gameState === 'PLAYING') {
        // Update player
        player.update(dt);

        // Wave spawning
        updateWaveSpawning(dt);

        // Update lasers
        for (let i = lasers.length - 1; i >= 0; i--) {
            lasers[i].update(dt);
            if (lasers[i].isOffScreen()) {
                lasers.splice(i, 1);
            }
        }

        // Update enemies
        for (let i = enemies.length - 1; i >= 0; i--) {
            enemies[i].update(dt);
           if (enemies[i].isOffScreen()) {
                // Enemy reached bottom — take damage
                if (player.invulnTimer <= 0) {
                    player.hitCount++;
                    player.invulnTimer = 2;
                    screenFlashTimer = 0.15;
                }
                createExplosion(enemies[i].x, H - 20, '#ff9100', 8);
                soundManager.playExplosion('medium');
                enemies.splice(i, 1);
                waveEnemiesRemaining--;

                if (player.hitCount >= 3) {
                    createExplosion(player.x, player.y, '#00e5ff', 20);
                    soundManager.playExplosion('large');
                    endGame();
                }
            }
        }

        // Update particles
        updateParticles(dt);

        // === COLLISIONS ===

        // Player lasers vs enemies
        for (let i = lasers.length - 1; i >= 0; i--) {
            const laser = lasers[i];
            if (!laser.isPlayer) continue;

            for (let j = enemies.length - 1; j >= 0; j--) {
                const enemy = enemies[j];
                if (aabbCollision(laser, enemy)) {
                    // Hit!
                    enemy.hp--;
                    lasers.splice(i, 1);

                    if (enemy.hp <= 0) {
                        score += enemy.points;
                        waveEnemiesRemaining--;
                         createExplosion(enemy.x, enemy.y, enemy.color, 15);
                        soundManager.playExplosion('large');
                        enemies.splice(j, 1);

                        // Check if wave is cleared
                        if (waveEnemiesRemaining <= 0 && enemies.length === 0) {
                            startWave(wave + 1);
                        }
                    } else {
                         // Hit but not dead — small spark
                        createExplosion(laser.x, laser.y, '#ffffff', 4);
                        soundManager.playExplosion('small');
                    }
                    break;
                }
            }
        }

        // Enemy lasers vs player
        for (let i = lasers.length - 1; i >= 0; i--) {
            const laser = lasers[i];
            if (laser.isPlayer) continue;

            if (aabbCollision(laser, player)) {
                if (player.invulnTimer > 0) continue;
                player.hitCount++;
                player.invulnTimer = 2;
                screenFlashTimer = 0.15;
                createExplosion(player.x, player.y, '#ffffff', 6);
                soundManager.playExplosion('small');
                lasers.splice(i, 1);

                if (player.hitCount >= 3) {
                    createExplosion(player.x, player.y, '#00e5ff', 20);
                    soundManager.playExplosion('large');
                    endGame();
                }
            }
        }

        // Enemies vs player (direct collision)
        for (let i = enemies.length - 1; i >= 0; i--) {
            if (aabbCollision(enemies[i], player)) {
                if (player.invulnTimer > 0) continue;
                player.hitCount++;
                player.invulnTimer = 2;
                screenFlashTimer = 0.15;
                createExplosion(player.x, player.y, '#ffffff', 6);
                soundManager.playExplosion('small');
                createExplosion(enemies[i].x, enemies[i].y, enemies[i].color, 15);
                soundManager.playExplosion('large');
                waveEnemiesRemaining--;
                enemies.splice(i, 1);

                if (player.hitCount >= 3) {
                    createExplosion(player.x, player.y, '#00e5ff', 20);
                    soundManager.playExplosion('large');
                    endGame();
                }
            }
        }

        // Draw everything
        for (const laser of lasers) {
            laser.draw();
        }
        for (const enemy of enemies) {
            enemy.draw();
        }
        player.draw();
        drawParticles();
        updateHUD();
    }

    if (gameState === 'GAME_OVER') {
        // Draw remaining enemies and particles frozen in time
        for (const laser of lasers) {
            laser.draw();
        }
        for (const enemy of enemies) {
            enemy.draw();
        }
        player.draw();
        drawParticles();
    }

    // Decrement screen flash timer
    if (screenFlashTimer > 0) {
        screenFlashTimer -= dt;
    }
}

function endGame() {
    gameState = 'GAME_OVER';
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('galacticAssault_highScore', highScore);
    }
    showGameOverScreen();
}

// === INPUT HANDLING FOR SCREENS ===
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        if (gameState === 'START') {
            startGame();
        } else if (gameState === 'GAME_OVER') {
            resetGame();
        }
    }
});

// Tap to start / restart on overlay screens (works for both mouse and touch)
startScreen.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (gameState === 'START') {
        startGame();
    }
});

gameoverScreen.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (gameState === 'GAME_OVER') {
        resetGame();
    }
});

function startGame() {
    score = 0;
    wave = 1;
    player.hitCount = 0;
    player.invulnTimer = 2;
    player.x = W / 2;
    lasers.length = 0;
    enemies.length = 0;
    particles.length = 0;
    gameState = 'PLAYING';
    startWave(1);
    showGameScreen();
}

function resetGame() {
    score = 0;
    wave = 1;
    player.hitCount = 0;
    player.invulnTimer = 2;
    player.x = W / 2;
    lasers.length = 0;
    enemies.length = 0;
    particles.length = 0;
    gameState = 'PLAYING';
    startWave(1);
    showGameScreen();
}

// === MOBILE UI DETECTION ===
if (isMobile) {
    document.querySelector('.controls-info').style.display = 'none';
    document.querySelector('.mobile-controls-info').style.display = 'block';
    document.getElementById('start-prompt').style.display = 'none';
    document.getElementById('mobile-start-prompt').style.display = 'block';
    document.getElementById('restart-prompt').style.display = 'none';
    document.getElementById('mobile-restart-prompt').style.display = 'block';
}

// === INIT ===
showStartScreen();
lastTime = performance.now();
requestAnimationFrame(gameLoop);

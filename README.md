# GALACTIC ASSAULT — Arcade Space Shooter

A classic arcade-style space shooter built entirely with vanilla HTML, CSS, and JavaScript. No frameworks, no dependencies — just a single canvas game that runs in any modern browser.

## Features

- **Wave-based enemy spawning** — face increasingly difficult formations of grunts, elites, and bosses
- **Three enemy types** with unique designs, HP, and point values
- **Damage system** — 3 hits and you're done. Ship color changes as damage accumulates (cyan → yellow → red)
- **Invulnerability frames** after taking a hit with screen flash feedback
- **Progressive difficulty** — more enemies, tighter formations, and faster shooting each wave
- **High score tracking** via localStorage
- **Procedural sound effects** using the Web Audio API (no audio files needed)
- **Particle explosions** on every kill

## Controls

### Desktop
| Key | Action |
|-----|--------|
| ← → or A D | Move ship left / right |
| Space | Fire (hold for auto-fire) |
| Space (on start/game over screen) | Start game / Retry |

### Mobile
| Action | Effect |
|--------|--------|
| Touch & drag on canvas | Move ship + auto-fire while holding |
| Tap on start/game over screen | Start game / Retry |

## How to Play

1. Open `index.html` in a browser (or serve it with any static server)
2. Press Space (desktop) or tap (mobile) to start
3. Destroy all enemies in each wave before they reach the bottom
4. Survive as many waves as possible for a high score

## Project Structure

```
index.html    — Game markup, overlays, and HUD
style.css     — Retro styling, responsive layout, animations
game.js       — All game logic (rendering, physics, collisions, audio)
```

## Technical Details

- **Canvas 2D** rendering at 480×640 resolution (scales responsively on mobile)
- **Delta-time** based movement for consistent gameplay at any frame rate
- **Pointer events** for unified mouse/touch input handling
- **Web Audio API** for procedurally generated laser and explosion sounds
- **Responsive CSS** with media queries for screens down to ~320px wide

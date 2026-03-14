# Update Voice Assistant UI Colors to Match K.I.T.E Aerospace Design

The design reference ([screen.png](file:///Users/nanduk/NKITE/KITE/stitch_generated_screen/screen.png)) and code reference ([code.html](file:///Users/nanduk/NKITE/KITE/stitch_generated_screen/code.html)) show a **pure black background**, **monochromatic grayscale/silver/mercury** visual language, and **K.I.T.E** branding. The user also wants to use [logo-Photoroom.png](file:///Users/nanduk/NKITE/KITE/logo-Photoroom.png) as the logo image instead of the star SVG from [screen.png](file:///Users/nanduk/NKITE/KITE/stitch_generated_screen/screen.png).

The current UI uses cyan/blue/violet accents — all need to shift to a silver/white/gray palette while **preserving all physics engine logic untouched**.

## Key Design References from [code.html](file:///Users/nanduk/NKITE/KITE/stitch_generated_screen/code.html)

- Background: `#000000` pure black
- Fluid container: `rgba(10, 10, 10, 0.8)` background, `1px solid rgba(255, 255, 255, 0.2)` border
- Mercury substance gradient: `#ffffff → #a1a1a1 → #404040 → #000000`
- Glow border: `1px solid rgba(255, 255, 255, 0.4)`
- Status dot: white `bg-white` when listening
- Text: `LISTENING`, `150 HZ`, `-8 DB`, `SPEAK NATURALLY`
- Footer: `AEROSPACE GRADE INTERFACE v4.0.2`
- Logo: Use [logo-Photoroom.png](file:///Users/nanduk/NKITE/KITE/logo-Photoroom.png) image file (white on transparent)

## Proposed Changes

### HTML — Rebranding & Logo Image

#### [MODIFY] [index.html](file:///Users/nanduk/NKITE/KITE/voice-fluid-ui/index.html)

- Replace `<title>` → `K.I.T.E - Premium Voice Assistant`
- Replace logo SVG with `<img>` tag referencing `../logo-Photoroom.png`
- Change logo text from "FluidAI" → "K . I . T . E" (spaced lettering per design)
- Update hint text to match design states: `SPEAK NATURALLY` with mic icon
- Add footer text: `AEROSPACE GRADE INTERFACE v4.0.2`
- Update meta description

---

### CSS — Color Tokens & Visual Palette

#### [MODIFY] [style.css](file:///Users/nanduk/NKITE/KITE/voice-fluid-ui/style.css)

All color changes — **no layout or animation logic changes**:

| Token | Current | New |
|---|---|---|
| `--deep-blue` | `#060d2e` | `#000000` |
| `--mid-blue` | `#0d1b6e` | `#1a1a1a` |
| `--cyan` | `#00e5ff` | `rgba(255,255,255,0.7)` |
| `--cyan-dim` | `rgba(0,229,255,0.35)` | `rgba(255,255,255,0.15)` |
| `--cyan-glow` | `rgba(0,229,255,0.18)` | `rgba(255,255,255,0.08)` |
| `--violet` | `#7c3aed` | `#888888` |
| body background | `#05071a` | `#000000` |

- **Background orbs**: Change from blue/cyan/violet gradients → subtle dark gray gradients
- **Petri dish glass**: Shift blue tint → neutral dark gray per [code.html](file:///Users/nanduk/NKITE/KITE/stitch_generated_screen/code.html) (`rgba(10,10,10,0.8)`)
- **Glow border**: Match [code.html](file:///Users/nanduk/NKITE/KITE/stitch_generated_screen/code.html) — `rgba(255,255,255,0.4)` razor-thin glow
- **Status indicators**: listening → white glow; speaking → lighter gray
- **Mic button**: Silver/white border and glow instead of cyan
- **Specular bottom**: Neutral white instead of cyan tint

---

### JavaScript — Fluid Renderer Colors Only

#### [MODIFY] [app.js](file:///Users/nanduk/NKITE/KITE/voice-fluid-ui/app.js)

**Only the `FluidRenderer.draw()` method's color values change.** No physics code is touched.

- **Fluid fill gradient**: Match mercury substance from [code.html](file:///Users/nanduk/NKITE/KITE/stitch_generated_screen/code.html): white → `#a1a1a1` → `#404040` → black
- **Waterline glow strokes**: White/silver glow instead of cyan hue-based glow
- **Caustics**: `rgba(200, 200, 200, …)` instead of `rgba(100, 220, 255, …)`
- **Chromatic aberration edges**: Subtle warm/cool gray instead of red/cyan

> [!IMPORTANT]
> The `colorPhase` / bass-pulse hue-shifting math is kept but now shifts within a narrow gray range. Physics engine ([WaterSurface](file:///Users/nanduk/NKITE/KITE/voice-fluid-ui/app.js#78-179), [AudioEngine](file:///Users/nanduk/NKITE/KITE/voice-fluid-ui/app.js#405-603), `VoiceUI._updatePhysics`) remains completely untouched.

## Verification Plan

### Browser Visual Testing
1. Serve files: `cd /Users/nanduk/NKITE/KITE/voice-fluid-ui && python3 -m http.server 8080`
2. Open `http://localhost:8080` in browser
3. Verify:
   - Background is pure black
   - K.I.T.E logo image displays correctly
   - Fluid shows mercury/silver/white gradient (no blue/cyan/violet)
   - Status text, Hz/dB readouts, "SPEAK NATURALLY" visible
   - Footer reads "AEROSPACE GRADE INTERFACE v4.0.2"
   - Click mic → white glow status dot, "LISTENING" text

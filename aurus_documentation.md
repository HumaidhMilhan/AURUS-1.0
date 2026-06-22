# AURUS - System Overview & Documentation

> [!NOTE]
> This document provides a snapshot of the current AURUS codebase, covering core features, the technology stack, and hardware configurations. This is intended to serve as a reference before starting the new project rework.

## 1. System Features

The current AURUS codebase is designed as a voice-activated robotic pet dashboard and includes the following key features:

- **Headless Wake-word Detection:** Uses the system microphone (via `PyAudio` and `SpeechRecognition`) to monitor for the wake-word **"AURUS"** in the background.
- **Google AI Studio Native TTS:** Connects to the Gemini API (`google-genai`) to parse instructions, determine emotions/actions, and synthesize lifelike vocal responses natively.
- **Headless Audio Playback:** Asynchronously plays back `.wav` responses using `aplay` (Linux) or `winsound` (Windows) depending on the environment.
- **Emotional Mood Engine:** Continuously tracks and adjusts internal state variables (`Happiness`, `Curiosity`, `Fear`) using a background loop, which dynamically dictates autonomous behaviors such as wiggling, spinning, or retreating.
- **Interactive 2D Simulator:** A robust software fallback simulating coordinate physics, Mecanum kinematics, and raycasted sonar. This enables full dashboard functionality and UI testing on non-hardware platforms (Windows/macOS) when `rpi-lgpio` is absent.
- **Web UI Control Panel:** A glassmorphic, dark-mode web interface built on Flask-SocketIO. It displays real-time diagnostics, sonar radar sweeps, animated Canvas-based expressions, mood gauges, and allows manual control via a strafing pad.
- **Autonomous & Voice-Command Modes:** Handles movement through manual UI input, autonomous environment exploration, or voice-directed commands (e.g., "Aurus, wiggle", "Aurus, show me a trick").

---

## 2. Technology Stack

AURUS blends software simulation with edge-hardware execution, utilizing the following stack:

### **Hardware & OS**
- **Compute Unit:** Raspberry Pi 4B
- **OS Environment:** Raspbian OS (Linux)

### **Backend Server & AI**
- **Core Language:** Python 3
- **Web Server:** Flask & Flask-SocketIO (with `eventlet` for async concurrency)
- **AI Integration:** `google-genai` (for decision making, mood engine interactions, and native audio synthesis)
- **Audio Processing:** `SpeechRecognition` and `PyAudio`

### **Frontend & UI**
- **Structure:** HTML5
- **Styling:** Vanilla CSS (employing glassmorphism, dynamic gradients, and modern micro-animations)
- **Logic & Rendering:** Vanilla JavaScript, focusing heavily on HTML5 `<canvas>` for drawing the simulated physical arena and animated eye expressions.

### **Hardware Interfacing**
- **Library:** `rpi-lgpio` (for direct GPIO access)

---

## 3. Hardware PIN Configurations

> [!WARNING]
> HC-SR04 Echo pins output 5V logic. Ensure a voltage divider (e.g., 1kΩ + 2kΩ resistors) is used on all Echo pins to drop the voltage to the Raspberry Pi's safe 3.3V logic level.

### **Mecanum Motor Drivers (L298N BCM Numbering)**

* **L298N #1 (Front Wheels):**
  - **Front-Left (FL):** Speed (ENA) = `GPIO 25`, Forward (IN1) = `GPIO 24`, Backward (IN2) = `GPIO 23`
  - **Front-Right (FR):** Speed (ENB) = `GPIO 12`, Forward (IN3) = `GPIO 5`, Backward (IN4) = `GPIO 6`
* **L298N #2 (Rear Wheels):**
  - **Rear-Left (RL):** Speed (ENA) = `GPIO 18`, Forward (IN1) = `GPIO 17`, Backward (IN2) = `GPIO 27`
  - **Rear-Right (RR):** Speed (ENB) = `GPIO 26`, Forward (IN3) = `GPIO 13`, Backward (IN4) = `GPIO 19`

### **Proximity Sensors (HC-SR04 BCM Numbering)**

The robot utilizes 5 ultrasonic sensors mounted at different angles.

- **Front-Left (FL - +45°):** Trig = `GPIO 4`, Echo = `GPIO 7`
- **Front Center (F - 0°):** Trig = `GPIO 20`, Echo = `GPIO 21`
- **Front-Right (FR - -45°):** Trig = `GPIO 8`, Echo = `GPIO 9`
- **Rear-Left (RL - +135°):** Trig = `GPIO 16`, Echo = `GPIO 22`
- **Rear-Right (RR - -135°):** Trig = `GPIO 10`, Echo = `GPIO 11`

---
*Created as part of the AURUS project codebase review and documentation effort.*

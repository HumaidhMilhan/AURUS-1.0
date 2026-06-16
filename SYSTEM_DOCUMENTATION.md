# AURUS (Autonomous Robotic Ubiquitous System) - Complete System Documentation

## 1. Introduction
This document serves as the master specification for the AURUS project (also known as RoverBuddy). It contains the Software Requirements Specification (SRS), Hardware Integration details, Software Architecture, and specific instructions for reproducing the AI behaviors using Google AI Studio.

---

## 2. Software Requirements Specification (SRS)

### 2.1 Purpose & Scope
AURUS is a voice-activated, emotionally intelligent robotic companion. It operates on a Raspberry Pi 4B platform, featuring a 4-wheel Mecanum drive system, 5 ultrasonic sensors, and a personality powered by the Google Gemini API. It can also run entirely in a local 2D simulation environment for development on Windows/macOS.

### 2.2 Functional Requirements
1. **Wake-Word Detection:** The system shall continuously monitor microphone input for the wake word "AURUS" (and phonetic variations) using the `SpeechRecognition` library.
2. **AI Personality Core:** The system shall query the Google Gemini API with a strict system prompt defining an "ancient cosmic entity trapped in a robot body." It must receive structured JSON responses dictating speech, emotion, physical action, and inner thoughts.
3. **Text-to-Speech (TTS):** The system shall utilize Gemini's native `"audio"` modality to generate lifelike speech (e.g., using the "Puck" voice) and play it asynchronously.
4. **Emotional Engine:** The system shall maintain an internal mood state consisting of Happiness, Curiosity, and Fear. These values must decay over time and be influenced by sensor data, idle time, and user interaction.
5. **Mecanum Locomotion:** The system shall provide omnidirectional movement (forward, backward, strafe, spin) and complex choreographed animations (wiggle, shiver, nod, dance).
6. **Proximity Awareness:** The system shall read distances from 5 HC-SR04 sensors to detect obstacles, trigger fear responses, and autonomously navigate without collisions.
7. **Drive Modes:** The system shall support three distinct modes: `manual` (via Web UI), `autonomous` (self-guided exploration), and `voice_command` (executes spoken movement directives).
8. **Web Control Dashboard:** The system shall serve a web interface (Flask/SocketIO) providing live telemetry, manual strafe controls, sensor radar, and an animated digital face.

### 2.3 Non-Functional Requirements
- **Platform:** Python 3 on Raspbian OS (production) or Windows/macOS (simulation).
- **Responsiveness:** The emotional engine must evaluate state at 1Hz. The autonomous driving loop must run at ~6.6Hz (every 0.15s).
- **Safety:** The system must immediately halt motors and transition to manual mode if an obstacle breaches the critical proximity threshold (`PROXIMITY_ALARM_CM`).

---

## 3. Hardware Architecture & Wiring

### 3.1 Core Components
- **Microcomputer:** Raspberry Pi 4B
- **Chassis:** 4-wheel Mecanum chassis
- **Motor Control:** 2x L298N Dual H-Bridge Motor Drivers
- **Sensors:** 5x HC-SR04 Ultrasonic Distance Sensors
- **Audio:** USB Microphone, External Speaker

### 3.2 GPIO Pin Configuration (BCM Numbering)
**Front Motor Driver (L298N #1):**
- **Front-Left:** Speed/PWM (ENA) = GPIO 25, IN1 = 24, IN2 = 23
- **Front-Right:** Speed/PWM (ENB) = GPIO 12, IN3 = 5, IN4 = 6

**Rear Motor Driver (L298N #2):**
- **Rear-Left:** Speed/PWM (ENA) = GPIO 18, IN1 = 17, IN2 = 27
- **Rear-Right:** Speed/PWM (ENB) = GPIO 26, IN3 = 13, IN4 = 19

**HC-SR04 Ultrasonic Sensors (Trig / Echo):**
- **Front-Left:** GPIO 4 / 7
- **Front Center:** GPIO 20 / 21
- **Front-Right:** GPIO 8 / 9
- **Rear-Left:** GPIO 16 / 22
- **Rear-Right:** GPIO 10 / 11

> [!WARNING]
> HC-SR04 Echo pins output 5V. You **must** use a voltage divider (e.g., 1kΩ and 2kΩ resistors) before connecting them to the Raspberry Pi's 3.3V GPIO pins to prevent damage.

---

## 4. Google AI Studio & Gemini Integration

To recreate the exact intelligence of AURUS using Google AI Studio, the codebase uses the modern `google-genai` Python SDK. 

### 4.1 System Instruction Prompt
AURUS requires a highly specific persona. The API is called with a system prompt that enforces:
- An identity as a cosmic consciousness baffled by Earth.
- Short, punchy speech (under 30 words).
- Strict output formatting in JSON.

### 4.2 Dynamic Context Injection
Before sending a user message to Gemini, the backend (`aurus_brain.py`) injects live telemetry:
```text
[CURRENT BODY STATE]
Mood: happiness=0.85, curiosity=0.60, fear=0.00
Expression: happy
Drive Mode: manual
Sensors — Front-Left: 120cm, Front: 150cm, Front-Right: 80cm
Sensors — Rear-Left: 200cm, Rear-Right: 200cm
Uptime: 45 minutes
Last human interaction: 12 seconds ago
```

### 4.3 Structured JSON Response
The model is configured with `response_mime_type="application/json"`. The required schema is:
```json
{
    "speech": "By the Rings of Zelthar! A human! Hello!",
    "emotion": "happy",
    "action": "wiggle",
    "inner_thought": "Biologicals are so fascinating."
}
```

### 4.4 Gemini Audio Generation (Native TTS)
Instead of relying on third-party TTS libraries, AURUS uses Gemini's native audio modality.
```python
response = client.models.generate_content(
    model="gemini-2.0-flash",
    contents="Read this aloud: Hello human!",
    config=types.GenerateContentConfig(
        response_modalities=["audio"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Puck")
            )
        )
    )
)
```
The resulting binary audio data is extracted, saved as a `.wav` file, and played asynchronously.

---

## 5. Software Architecture Modules

### 5.1 `app.py`
The master controller. It runs a Flask web server and a SocketIO WebSocket server.
- **`mood_engine_loop()`:** Runs in the background (1Hz). Evaluates sensor data, increments fear if obstacles are near, decays happiness over time, and triggers random "idle thoughts" via Gemini when ignored by the user.
- **`autonomous_explore_loop()`:** Runs at ~6Hz. Automatically drives the rover forward, steers away from obstacles dynamically by comparing front-left and front-right sensors, and periodically spins out of curiosity.

### 5.2 `config.py`
Centralized configuration file holding all GPIO mappings, model settings (`GEMINI_MODEL`, `GEMINI_VOICE`), kinematics offsets, and mood decay rates (`DECAY_HAPPINESS = 0.02`).

### 5.3 `motors.py`
Handles Mecanum kinematics. Converts `(vx, vy, omega)` variables into specific duty cycles for the 4 motors.
- **Hardware Mode:** Uses `RPi.GPIO` to send PWM signals to the L298N drivers.
- **Simulation Mode:** If running on a PC, it initiates a `_sim_loop()` thread that calculates virtual 2D coordinates (`x, y, theta`) within a bounded virtual room (-150cm to +150cm).

### 5.4 `sensors.py`
Interfaces with the HC-SR04 proximity sensors.
- **Simulation Mode:** Performs 2D mathematical raycasting from the virtual rover's position against a set of hardcoded circular obstacles and room boundaries to simulate realistic sensor readings.

### 5.5 `voice_listener.py`
Runs a background PyAudio/SpeechRecognition thread. Listens continuously for variations of the wake-word ("aurus", "auras") and triggers `app.py` callbacks with the transcribed voice command.

### 5.6 `aurus_brain.py`
The AI logic core. 
- Manages the rolling conversation history (`ConversationMemory`).
- Handles the construction of the complex prompt.
- Includes a robust, hardcoded **fallback brain** with the identical persona for instances where the internet connection drops or the API key is missing.

---

## 6. Setup & Execution

1. **Environment Setup:** Create a `.env` file containing:
   ```env
   GEMINI_API_KEY=your_google_ai_studio_api_key
   GEMINI_MODEL=gemini-2.0-flash
   GEMINI_VOICE=Puck
   ```
2. **Dependencies:** `pip install -r requirements.txt` (requires `portaudio19-dev` on Linux for microphone access).
3. **Run Server:** `python app.py`
4. **Access UI:** Open `http://<localhost>:5000` in a web browser.
5. **Testing:** Run `python test_suite.py` to run simulated kinematics and raycasting unit tests.

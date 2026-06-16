# RoverBuddy — AI Pet Companion & Assistant

**RoverBuddy** is a voice-activated robotic pet dashboard running on a Raspberry Pi 4B under Raspbian OS (featuring a full virtual coordinate simulation fallback for Windows/macOS local testing).

RoverBuddy listens headlessly for its wake-word (**"AURUS"**), queries the Gemini API for actions/emotions in JSON format, synthesizes lifelike responses using Google AI Studio native Text-to-Speech (TTS), and drives 4 Mecanum wheels to slide, spin, and express mood wiggles.

---

## 1. Project Directory Structure

```
/
├── config.py             # Hardware pins, Gemini settings, and mood decay rates
├── motors.py             # Mecanum kinematics with simulated physics fallback
├── sensors.py            # HC-SR04 sonar drivers with virtual room raycasting
├── voice_listener.py     # Background mic listener looking for the hotword "AURUS"
├── app.py                # Main Flask-SocketIO server and Emotional Mood Engine
├── test_suite.py         # Locomotion & raycast unit tests
├── requirements.txt      # Python dependencies (google-genai, SpeechRecognition, etc.)
├── .env                  # Environmental configurations (Gemini API key, default voice)
├── templates/
│   └── index.html        # Glassmorphic dark-mode control panel
└── static/
    ├── css/
    │   └── style.css     # Styling, custom scrollbars, animations, and gradients
    └── js/
        ├── face.js       # Animated HTML5 Canvas face rendering engine
        └── app.js        # SocketIO events, keyboard binders, and arena draw loops
```

---

## 2. Core Features Implemented

1. **Headless Wake-word Detection:** Uses PyAudio and the `SpeechRecognition` library to monitor the system microphone. Transcription is handled via Google Speech Recognition, checking for the wake-word **AURUS** and capturing subsequent instructions.
2. **Google AI Studio Native TTS:** Connects to the modern `google-genai` client, making a structured JSON query for text, emotion, and motion actions, then synthesizes WAV audio via Gemini's native `"audio"` modality using custom voices (e.g. `Puck`).
3. **Headless Audio Playback:** Synthesized response files are written as `response.wav` and played asynchronously via `aplay` (on Linux) or `winsound` (on Windows).
4. **Emotional Mood Engine:** Tracks `Happiness`, `Curiosity`, and `Fear` values in a background loop. Triggers safety escapes if obstacles are breached, sleeps when idle, and drives wiggles or curious visual spins autonomously.
5. **Interactive 2D Simulator:** If RPi.GPIO is missing, the backend runs a virtual coordinate physical model. The dashboard draws the Rover chassis, Mecanum roller wheels, sonar raycasts, and custom circular obstacles inside a virtual room.
6. **Web UI Control Panel:** A glassmorphic theme displaying diagnostics, a proximity sonar radar sweep, Canvas eye expressions, mood gauges, and a precision strafing pad.

---

## 3. Wiring and GPIO Configuration

### 2x L298N Motor Drivers (Mecanum Chassis)
* **Front Driver (L298N #1 - FL & FR):**
  - **Front-Left Speed (ENA):** GPIO 25 (Physical Pin 22)
  - **Front-Left Inputs (IN1/IN2):** GPIO 24 / GPIO 23 (Pins 18/16)
  - **Front-Right Inputs (IN3/IN4):** GPIO 5 / GPIO 6 (Pins 29/31)
  - **Front-Right Speed (ENB):** GPIO 12 (Physical Pin 32)
* **Rear Driver (L298N #2 - RL & RR):**
  - **Rear-Left Speed (ENA):** GPIO 18 (Physical Pin 12)
  - **Rear-Left Inputs (IN1/IN2):** GPIO 17 / GPIO 27 (Pins 11/13)
  - **Rear-Right Inputs (IN3/IN4):** GPIO 13 / GPIO 19 (Pins 33/35)
  - **Rear-Right Speed (ENB):** GPIO 26 (Physical Pin 37)

### Proximity Sensors (HC-SR04 Sonar)
* **Front Trig/Echo:** GPIO 20 / GPIO 21 (Pins 38/40)
* **Rear Trig/Echo:** GPIO 16 / GPIO 22 (Pins 36/15)
* *Note: Echo pins require a voltage divider (e.g., 1kΩ and 2kΩ resistors) to convert the sensor's 5V output to the Pi's safe 3.3V logic level.*

---

## 4. Verification and Local Execution

### Install Python Requirements
```powershell
pip install -r requirements.txt
```
*(On Raspberry Pi running Raspbian, ensure you have system audio dev packages: `sudo apt-get install portaudio19-dev python3-pyaudio` before running pip).*

### Run the Kinematic and Sensor Tests
```powershell
python test_suite.py
```

### Start the Server
1. Update `.env` with your Gemini key:
   ```env
   GEMINI_API_KEY=AIzaSy...
   ```
2. Launch:
   ```powershell
   python app.py
   ```
3. Open [http://localhost:5000](http://localhost:5000) in Chrome/Edge.
4. Speak *"Aurus, wiggle"* or *"Aurus, show me a trick"* to test the microphone STT and TTS audio loops.

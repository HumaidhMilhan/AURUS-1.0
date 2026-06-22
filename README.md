# RoverBuddy (AURUS V2) — AI Pet Companion & Assistant

**RoverBuddy** is a voice-activated, visually-aware robotic pet dashboard running on a Raspberry Pi 4B under Raspbian OS (featuring a full virtual coordinate simulation fallback for Windows/macOS local testing).

With the **AURUS V2 Upgrade**, RoverBuddy listens headlessly for its wake-word (**"AURUS"**), queries the Gemini API for actions/emotions with Explainable AI metadata, utilizes OpenCV and MediaPipe for facial tracking and object recognition, stores conversational memories in SQLite, synthesizes lifelike responses using Google AI Studio native Text-to-Speech (TTS), and drives 4 Mecanum wheels to slide, spin, follow humans, and express mood wiggles.

---

## 1. Project Directory Structure

```
/
├── config.py             # Hardware pins, Gemini settings, and mood decay rates
├── run.py                # Main entry point to launch the Flask server
├── requirements.txt      # Python dependencies (google-genai, OpenCV, MediaPipe, etc.)
├── .env                  # Environmental configurations (Gemini API key, default voice)
├── src/
│   ├── ai/
│   │   ├── aurus_brain.py    # Memory DB, LLM prompting, and XAI local fallback
│   │   └── intent_router.py  # Regex matching for specific commands (follow me, daily reports)
│   ├── hardware/
│   │   ├── motors.py         # Mecanum kinematics with simulated physics fallback
│   │   └── sensors.py        # HC-SR04 sonar drivers with virtual room raycasting
│   ├── vision/
│   │   ├── vision_system.py  # OpenCV frame capture, MediaPipe Face, MobileNet SSD objects
│   │   └── follow_controller.py # PID logic to translate face bounding boxes to motor speeds
│   └── web/
│       ├── app.py            # Main Flask-SocketIO server and Proactive Mood Engine
│       ├── templates/
│       │   └── index.html    # Glassmorphic dark-mode control panel
│       └── static/
│           ├── css/
│           │   └── style.css # Styling, custom scrollbars, animations, and gradients
│           └── js/
│               ├── face.js   # Animated HTML5 Canvas face rendering engine
│               └── app.js    # SocketIO events, keyboard binders, and arena draw loops
└── tests/
    └── test_suite.py     # Locomotion & raycast unit tests
```

---

## 2. Core Features Implemented

1. **Computer Vision & Presence:** Uses a camera feed with OpenCV and MediaPipe to detect humans ("Present" vs "Absent"). Uses MobileNet SSD to recognize environmental objects.
2. **Conversation Memory (SQLite):** Stores interaction histories locally, allowing the AI to recall context and generate detailed "Daily Companion Reports".
3. **Autonomous Follow Mode:** A PID controller tracks bounding box coordinates from the vision system, combining it with sonar data to follow a user while maintaining a safe distance.
4. **Explainable AI (XAI):** Broadcasts its internal decision-making process (Reason, Confidence, Source Data) over WebSockets to be displayed in a live debug dashboard.
5. **Headless Wake-word Detection:** Uses PyAudio and the `SpeechRecognition` library to monitor the system microphone for the wake-word **AURUS**.
6. **Google AI Studio Native TTS:** Connects to the `google-genai` client, making a structured JSON query for text, emotion, and motion actions, then synthesizes WAV audio via Gemini's native `"audio"` modality using custom voices (e.g. `Puck`).
7. **Proactive Relationship Engine:** Tracks `Happiness`, `Curiosity`, `Trust`, and `Social Energy`. Triggers spontaneous greetings or idle check-ins based on human presence and time spent alone.
8. **Interactive Web UI:** A glassmorphic theme displaying live camera feeds, proximity sonar radar sweeps, Canvas eye expressions, mood gauges, XAI logs, a demonstration mode button, and a precision strafing pad.

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
python tests/test_suite.py
```

### Start the Server
1. Update `.env` with your Gemini key:
   ```env
   GEMINI_API_KEY=AIzaSy...
   ```
2. Launch:
   ```powershell
   python run.py
   ```
3. Open [http://localhost:5000](http://localhost:5000) in Chrome/Edge.
4. Click the **Run Demo** button on the UI dashboard to simulate the full interaction loop, or speak *"Aurus, follow me"* to test the microphone integration!

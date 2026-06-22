#!/usr/bin/env python3
import os
import time
import json
import random
import uuid
import threading
import traceback
import subprocess
import platform
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit  # noqa: F811 - emit used in handlers
from google import genai
from google.genai import types

from src import config
from src.hardware.motors import MecanumDriver
from src.hardware.sensors import ProximitySensor
from src.ai.voice_listener import VoiceListener
from src.ai.aurus_brain import AURUSBrain
from src.vision.vision_system import VisionSystem
from src.vision.follow_controller import FollowController

# Create Flask app and initialize SocketIO
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Initialize hardware drivers
driver = MecanumDriver()
sensor = ProximitySensor(driver)

# Initialize vision system and controllers
vision = VisionSystem()
vision.start()
follow_controller = FollowController()

# Global Rover State
state_lock = threading.Lock()
rover_state = {
    "happiness": 0.5,
    "curiosity": 0.5,
    "trust": 0.5,
    "social_energy": 1.0,
    "relationship_strength": 0.5,
    "expression": "happy",  # happy, sad, curious, sleeping, scared, listening
    "last_interaction": time.time(),
    "last_autonomous_action": time.time(),
    "mic_active": True,
    "drive_mode": config.DEFAULT_DRIVE_MODE,  # "manual", "autonomous", "voice_command"
    "_start_time": time.time()  # Brain uptime tracking
}

# Threading primitives for mode management
auto_run_event = threading.Event()     # Set when autonomous mode is active
voice_burst_cancel = threading.Event() # Set to cancel in-progress voice burst
voice_burst_cancel.set()               # Start in cancelled state (no burst active)

# Configured Gemini GenAI Client
gemini_client = None
gemini_configured = False

# AURUS Brain (personality + memory + Gemini integration)
brain = AURUSBrain()

def init_gemini(api_key=None):
    global gemini_client, gemini_configured
    key = api_key or config.GEMINI_API_KEY
    if key and len(key) > 5:
        try:
            # Initialize the modern google-genai client
            gemini_client = genai.Client(api_key=key)
            gemini_configured = True
            brain.set_client(gemini_client)  # Sync brain with Gemini client
            print(f"Google GenAI Client initialized successfully. Model: {config.GEMINI_MODEL}, Voice: {config.GEMINI_VOICE}")
        except Exception as e:
            print(f"Failed to configure Google GenAI client: {e}")
            gemini_configured = False
    else:
        print("Gemini API key is not configured in .env. Running in local rule-based fallback mode.")
        gemini_configured = False

# Initialize GenAI Client on startup
init_gemini()

# --- Drive Mode Management ---

def set_drive_mode(new_mode):
    """Safely transition to a new drive mode. Always stops motors first."""
    if new_mode not in config.DRIVE_MODES:
        print(f"[ModeManager] Invalid mode rejected: {new_mode}")
        return False

    with state_lock:
        old_mode = rover_state["drive_mode"]
        if old_mode == new_mode:
            return True  # Already in this mode

        # 1. Cancel any in-progress voice burst
        voice_burst_cancel.set()

        # 2. Stop motors (clean zero-velocity transition)
        driver.stop()

        # 3. Pause autonomous thread if leaving autonomous mode
        if old_mode == "autonomous":
            auto_run_event.clear()

        # 4. Set new mode
        rover_state["drive_mode"] = new_mode
        rover_state["last_interaction"] = time.time()

        # 5. Activate threads/controllers based on mode
        if new_mode == "autonomous":
            auto_run_event.set()
        elif new_mode == "voice_command":
            voice_burst_cancel.clear()  # Ready for new bursts
            
        if new_mode == "mode_follow":
            follow_controller.set_active(True)
        else:
            follow_controller.set_active(False)

        print(f"[ModeManager] Drive mode changed: {old_mode} -> {new_mode}")

    # Broadcast to all connected clients outside the lock
    socketio.emit("mode_changed", {"mode": new_mode})
    return True

# Rule-based fallback response engine
# local_rover_brain has been moved to aurus_brain.py as local_fallback_brain()
# Kept as a thin redirect for backward compatibility with tests
def local_rover_brain(user_text):
    from src.ai.aurus_brain import local_fallback_brain
    return local_fallback_brain(user_text)

# Motor action executor for expanded brain action vocabulary
def execute_brain_action(action):
    """Execute a motor action from the brain's response. Supports the full action vocabulary."""
    if action == "wiggle":
        driver.wiggle(1.5)
    elif action == "spin":
        driver.spin(1.2, random.choice([-1, 1]))
    elif action == "forward":
        driver.drive(0.5, 0, 0)
        time.sleep(0.8)
        driver.stop()
    elif action == "backward":
        driver.drive(-0.5, 0, 0)
        time.sleep(0.8)
        driver.stop()
    elif action == "strafe_left":
        driver.drive(0, -0.5, 0)
        time.sleep(0.7)
        driver.stop()
    elif action == "strafe_right":
        driver.drive(0, 0.5, 0)
        time.sleep(0.7)
        driver.stop()
    elif action == "shiver":
        driver.shiver(0.8)
    elif action == "nod":
        # Small forward-backward micro-movements
        for _ in range(3):
            driver.drive(0.3, 0, 0)
            time.sleep(0.15)
            driver.drive(-0.3, 0, 0)
            time.sleep(0.15)
        driver.stop()
    elif action == "dance":
        # Choreographed sequence: wiggle → spin → strafe → wiggle
        driver.wiggle(0.5)
        driver.spin(0.8, 1)
        time.sleep(0.9)
        driver.drive(0, 0.5, 0)
        time.sleep(0.4)
        driver.drive(0, -0.5, 0)
        time.sleep(0.4)
        driver.wiggle(0.5)
        driver.stop()
    else:
        driver.stop()

# Headless audio playback utility
def play_audio_headless(filepath):
    try:
        if config.AUDIO_PLAYER_CMD == "aplay":
            # Play on Linux/Raspberry Pi asynchronously
            subprocess.Popen(["aplay", filepath], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif platform.system() == "Windows":
            # Play on Windows using built-in winsound library
            import winsound
            winsound.PlaySound(filepath, winsound.SND_FILENAME | winsound.SND_ASYNC)
        else:
            print(f"[Audio Player] Mock playing audio file: {filepath}")
    except Exception as e:
        print(f"[Audio Player] Error playing audio: {e}")

# --- Voice Command Movement Executor ---

def execute_voice_movement(action):
    """Execute a timed motor burst for voice command mode. Runs in its own thread."""
    voice_burst_cancel.clear()

    with state_lock:
        if rover_state["drive_mode"] != "voice_command":
            return

    # Pre-flight safety check
    dist_front_min = sensor.read_front_min()
    dist_rear_min = sensor.read_rear_min()

    if action in ("forward",) and dist_front_min < config.PROXIMITY_ALARM_CM:
        socketio.emit("rover_reply", {
            "speech": "Can't go forward, something is in the way!",
            "emotion": "scared", "action": "stop"
        })
        return
    if action in ("backward",) and dist_rear_min < config.PROXIMITY_ALARM_CM:
        socketio.emit("rover_reply", {
            "speech": "Can't go backward, blocked behind me!",
            "emotion": "scared", "action": "stop"
        })
        return

    speed = config.VOICE_CMD_DRIVE_SPEED
    duration = config.VOICE_CMD_DRIVE_DURATION

    # Map action to motor vector
    if action == "forward":
        driver.drive(speed, 0, 0)
    elif action == "backward":
        driver.drive(-speed, 0, 0)
    elif action == "strafe_left":
        driver.drive(0, -speed, 0)
    elif action == "strafe_right":
        driver.drive(0, speed, 0)
    elif action == "spin_left":
        driver.drive(0, 0, -0.6)
        duration = config.VOICE_CMD_SPIN_DURATION
    elif action == "spin_right":
        driver.drive(0, 0, 0.6)
        duration = config.VOICE_CMD_SPIN_DURATION
    elif action == "wiggle":
        driver.wiggle(1.5)
        return  # Wiggle is self-terminating
    elif action == "spin":
        driver.spin(config.VOICE_CMD_SPIN_DURATION, random.choice([-1, 1]))
        return  # Spin is self-terminating
    else:
        return

    # Wait for burst duration, checking for cancellation and safety
    start = time.time()
    while time.time() - start < duration:
        if voice_burst_cancel.is_set():
            break
        # Verify we're still in voice_command mode
        with state_lock:
            if rover_state["drive_mode"] != "voice_command":
                break
        # Mid-burst safety check (uses minimum across front/rear sensor groups)
        if action in ("forward",) and sensor.read_front_min() < config.PROXIMITY_ALARM_CM:
            socketio.emit("rover_reply", {
                "speech": "Obstacle detected! Stopping!",
                "emotion": "scared", "action": "stop"
            })
            break
        if action in ("backward",) and sensor.read_rear_min() < config.PROXIMITY_ALARM_CM:
            socketio.emit("rover_reply", {
                "speech": "Obstacle behind! Stopping!",
                "emotion": "scared", "action": "stop"
            })
            break
        time.sleep(0.05)

    driver.stop()

# --- Autonomous Exploration Loop ---

def autonomous_explore_loop():
    """Background exploration loop. Only drives when autonomous mode is active.
    
    Wrapped in top-level exception handler to prevent silent thread death (P0 #2).
    """
    print("[Autonomous] Exploration thread started (paused, waiting for activation).")
    while True:
        try:
            # Block until autonomous mode is activated
            auto_run_event.wait()
            time.sleep(config.AUTO_EXPLORE_INTERVAL)

            # Double-check we're still in autonomous mode
            with state_lock:
                if rover_state["drive_mode"] != "autonomous":
                    auto_run_event.clear()
                    continue

            sensor_data = sensor.read_all()
            dist_fl = sensor_data["fl"]
            dist_f = sensor_data["f"]
            dist_fr = sensor_data["fr"]
            dist_rl = sensor_data["rl"]
            dist_rr = sensor_data["rr"]
            
            dist_front_min = min(dist_fl, dist_f, dist_fr)
            dist_rear_min = min(dist_rl, dist_rr)

            # SAFETY: Emergency proximity -> revert to manual
            if dist_front_min < config.PROXIMITY_ALARM_CM:
                driver.stop()
                driver.shiver(0.6)
                with state_lock:
                    rover_state["fear"] = min(1.0, rover_state["fear"] + config.INC_FEAR_COLLISION)
                set_drive_mode("manual")
                socketio.emit("rover_reply", {
                    "speech": "Whoa! Too close! Switching to manual for safety!",
                    "emotion": "scared", "action": "stop"
                })
                socketio.emit("audio_trigger", {"sound": "scared_screech"})
                continue

            # Obstacle avoidance: spin away if approaching
            if dist_front_min < config.AUTO_OBSTACLE_REACT_CM:
                driver.stop()
                # Smart turn direction: steer away from the side that's closer
                if dist_fl < dist_fr:
                    direction = -1  # Turn right (away from left obstacle)
                elif dist_fr < dist_fl:
                    direction = 1   # Turn left (away from right obstacle)
                else:
                    direction = random.choice([-1, 1])  # Equal — pick randomly
                driver.spin(config.AUTO_SPIN_DURATION, direction)
                time.sleep(config.AUTO_SPIN_DURATION + 0.1)
                # Check if we're still in autonomous before continuing
                with state_lock:
                    if rover_state["drive_mode"] != "autonomous":
                        continue
                    rover_state["curiosity"] = min(1.0, rover_state["curiosity"] + 0.08)
                continue

            # Rear emergency: drive forward briefly to escape
            if dist_rear_min < config.PROXIMITY_ALARM_CM:
                driver.drive(config.AUTO_DRIVE_SPEED, 0, 0)
                time.sleep(0.4)
                driver.stop()
                with state_lock:
                    rover_state["fear"] = min(1.0, rover_state["fear"] + config.INC_FEAR_COLLISION * 0.5)
                continue

            # Random curious spin (emotion-driven exploration)
            if random.random() < config.AUTO_IDLE_SPIN_CHANCE:
                direction = random.choice([-1, 1])
                driver.spin(0.5, direction)
                time.sleep(0.6)
                with state_lock:
                    rover_state["curiosity"] = min(1.0, rover_state["curiosity"] + 0.05)
                    rover_state["last_autonomous_action"] = time.time()
                continue

            # Default: drive forward for one tick, then stop (P1 #9)
            # This ensures motors don't run indefinitely if the loop stalls.
            with state_lock:
                if rover_state["drive_mode"] == "autonomous":
                    driver.drive(config.AUTO_DRIVE_SPEED, 0, 0)
            
            # Explicitly stop after the nominal tick duration to prevent runaways
            time.sleep(config.AUTO_EXPLORE_INTERVAL * 1.5)
            driver.stop()

        except Exception as e:
            # P0 #2: Never let this thread die silently — log and continue
            print(f"[Autonomous] ERROR in exploration loop: {e}")
            traceback.print_exc()
            driver.stop()  # Safety: always stop motors on error
            time.sleep(1.0)  # Back off briefly to avoid rapid error loops

# Start autonomous exploration thread (begins paused)
threading.Thread(target=autonomous_explore_loop, daemon=True).start()

# --- Autonomous Follow Loop ---

def follow_loop():
    print("[FollowMode] Follow loop started (paused, waiting for activation).")
    while True:
        try:
            time.sleep(0.1)
            
            with state_lock:
                if rover_state["drive_mode"] != "mode_follow":
                    continue

            vision_data = vision.get_latest_data()
            faces = vision_data["faces"]
            sensor_data = sensor.read_all()
            
            motor_action = follow_controller.calculate_motor_command(faces, sensor_data)
            
            if motor_action == "forward":
                driver.drive(0.4, 0, 0)
            elif motor_action == "backward":
                driver.drive(-0.4, 0, 0)
            elif motor_action == "spin_left":
                driver.drive(0, 0, -0.5)
            elif motor_action == "spin_right":
                driver.drive(0, 0, 0.5)
            else:
                driver.stop()
                
        except Exception as e:
            print(f"[FollowMode] ERROR: {e}")
            driver.stop()
            time.sleep(0.5)

threading.Thread(target=follow_loop, daemon=True).start()

# Main interaction processing flow (handles speech and text inputs)
def process_user_interaction(message):
    global gemini_configured, gemini_client
    
    if not message.strip():
        # Empty message or just the wake-word
        message = "hello"

    print(f"Processing command: \"{message}\"")
    
    text_lower = message.lower().strip()

    # --- Mode switch detection (always active, regardless of current mode) ---
    if any(kw in text_lower for kw in ["explore mode", "autonomous mode", "auto mode"]):
        set_drive_mode("autonomous")
        with state_lock:
            rover_state["expression"] = "curious"
            rover_state["last_interaction"] = time.time()
        socketio.emit("rover_reply", {
            "speech": "Entering explore mode! I'll roam around on my own!",
            "emotion": "curious", "action": "stop"
        })
        socketio.emit("audio_trigger", {"sound": "happy_chirp"})
        return
    elif any(kw in text_lower for kw in ["manual mode", "take control", "stop exploring"]):
        set_drive_mode("manual")
        with state_lock:
            rover_state["expression"] = "happy"
            rover_state["last_interaction"] = time.time()
        socketio.emit("rover_reply", {
            "speech": "Manual mode! You're in control now, friend!",
            "emotion": "happy", "action": "stop"
        })
        socketio.emit("audio_trigger", {"sound": "happy_chirp"})
        return
    elif any(kw in text_lower for kw in ["voice mode", "voice command", "listen mode"]):
        set_drive_mode("voice_command")
        with state_lock:
            rover_state["expression"] = "listening"
            rover_state["last_interaction"] = time.time()
        socketio.emit("rover_reply", {
            "speech": "Voice command mode! Tell me where to go!",
            "emotion": "listening", "action": "stop"
        })
        socketio.emit("audio_trigger", {"sound": "listening_beep"})
        return
    elif any(kw in text_lower for kw in ["follow me", "follow mode"]):
        set_drive_mode("mode_follow")
        with state_lock:
            rover_state["expression"] = "curious"
            rover_state["last_interaction"] = time.time()
        socketio.emit("rover_reply", {
            "speech": "Follow mode engaged! Lead the way!",
            "emotion": "curious", "action": "stop"
        })
        socketio.emit("audio_trigger", {"sound": "happy_chirp"})
        return

    # --- Voice movement commands (only active in voice_command mode) ---
    with state_lock:
        current_mode = rover_state["drive_mode"]

    if current_mode == "voice_command":
        voice_action = None
        if any(kw in text_lower for kw in ["go forward", "move forward", "forward"]):
            voice_action = "forward"
        elif any(kw in text_lower for kw in ["go back", "move back", "backward", "reverse"]):
            voice_action = "backward"
        elif any(kw in text_lower for kw in ["turn left", "go left"]):
            voice_action = "spin_left"
        elif any(kw in text_lower for kw in ["turn right", "go right"]):
            voice_action = "spin_right"
        elif any(kw in text_lower for kw in ["strafe left", "slide left"]):
            voice_action = "strafe_left"
        elif any(kw in text_lower for kw in ["strafe right", "slide right"]):
            voice_action = "strafe_right"
        elif any(kw in text_lower for kw in ["spin", "rotate"]):
            voice_action = "spin"
        elif any(kw in text_lower for kw in ["wiggle", "dance", "trick"]):
            voice_action = "wiggle"
        elif any(kw in text_lower for kw in ["stop", "halt", "freeze"]):
            driver.stop()
            voice_burst_cancel.set()
            with state_lock:
                rover_state["last_interaction"] = time.time()
            socketio.emit("rover_reply", {
                "speech": "Stopping! Standing by for commands.",
                "emotion": "happy", "action": "stop"
            })
            return

        if voice_action:
            with state_lock:
                rover_state["last_interaction"] = time.time()
                rover_state["expression"] = "curious"
            socketio.emit("rover_reply", {
                "speech": f"Roger! Executing {voice_action.replace('_', ' ')}!",
                "emotion": "curious", "action": voice_action
            })
            threading.Thread(
                target=execute_voice_movement,
                args=(voice_action,),
                daemon=True
            ).start()
            return

    # --- Standard interaction flow (chat / persona) ---
    with state_lock:
        rover_state["last_interaction"] = time.time()
        rover_state["expression"] = "listening"
        current_state = dict(rover_state)  # Snapshot for brain context
        
    socketio.emit("rover_listening")
    time.sleep(0.5)

    # 1. Get sensor data for brain context
    sensor_data = sensor.read_all()
    vision_data = vision.get_latest_data() if hasattr(vision, 'get_latest_data') else {}
    sensor_data["objects"] = vision_data.get("objects", [])

    # 2. Think via AURUS Brain (handles Gemini + memory + fallback)
    if intent["type"] == "report" and intent.get("action") == "report_daily":
        reply = brain.generate_daily_summary(current_state, sensor_data)
    else:
        reply = brain.think(message, current_state, sensor_data)

    speech = reply.get("speech", "Beep! Processing!")
    emotion = reply.get("emotion", "curious")
    action = reply.get("action", "stop")
    inner_thought = reply.get("inner_thought", "")

    print(f"AURUS Brain: Speech='{speech}', Emotion='{emotion}', Action='{action}', Thought='{inner_thought}'")

    # Broadcast Explainable AI Data
    xai_data = reply.get("xai", {
        "decision": f"Action: {action.upper()}",
        "reason": "Default logic or local fallback",
        "confidence": "100%",
        "source_data": f"Input: {message}"
    })
    socketio.emit("xai_update", xai_data)

    # 3. Get high-quality native audio TTS from Google AI Studio
    # P0 #3: Use unique filename per interaction to prevent race conditions
    audio_file_path = f"response_{uuid.uuid4().hex[:8]}.wav"
    audio_generated = False
    
    if gemini_configured and gemini_client:
        try:
            print("Synthesizing speech via Gemini Audio TTS...")
            tts_prompt = f"Read the following sentence aloud exactly as written: {speech}"
            
            tts_response = gemini_client.models.generate_content(
                model=config.GEMINI_MODEL,
                contents=tts_prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["audio"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                voice_name=config.GEMINI_VOICE
                            )
                        )
                    )
                )
            )
            
            # Extract audio bytes
            audio_bytes = None
            for part in tts_response.candidates[0].content.parts:
                if part.inline_data:
                    audio_bytes = part.inline_data.data
                    break
            
            if audio_bytes:
                with open(audio_file_path, "wb") as f:
                    f.write(audio_bytes)
                audio_generated = True
                print("Speech synthesized successfully.")
            else:
                print("Gemini response did not contain inline audio bytes.")
        except Exception as e:
            print(f"Failed to synthesize Gemini Audio: {e}")

    # 4. Trigger headless playback and cleanup
    if audio_generated:
        play_audio_headless(audio_file_path)
        # Schedule cleanup of temp audio file after playback (5s buffer)
        def _cleanup_audio(path):
            time.sleep(5.0)
            try:
                os.remove(path)
            except OSError:
                pass
        threading.Thread(target=_cleanup_audio, args=(audio_file_path,), daemon=True).start()
    else:
        # Trigger standard browser-side beep fallback if backend TTS failed
        socketio.emit("audio_trigger", {"sound": "happy_chirp"})

    # 5. Update state variables
    with state_lock:
        rover_state["expression"] = emotion
        rover_state["happiness"] = min(1.0, rover_state["happiness"] + config.INC_HAPPINESS_TALK)
        rover_state["trust"] = min(1.0, rover_state.get("trust", 0.5) + config.INC_TRUST_POSITIVE)
        rover_state["relationship_strength"] = min(1.0, rover_state.get("relationship_strength", 0.5) + config.INC_RELATIONSHIP_INTERACTION)
        rover_state["social_energy"] = max(0.0, rover_state.get("social_energy", 1.0) - 0.05)
        rover_state["last_interaction"] = time.time()

    # 6. Broadcast to SocketIO clients
    socketio.emit("rover_reply", {
        "speech": speech,
        "emotion": emotion,
        "action": action
    })

    # 7. Emit inner thought for UI display
    if inner_thought:
        socketio.emit("inner_thought", {"thought": inner_thought})

    # 8. Execute motor kinetics (expanded action vocabulary)
    execute_brain_action(action)

# Thread callback triggered by voice_listener when wake-word is detected
def on_voice_wake_trigger(command):
    print(f"Voice wake-word trigger received. Command: \"{command}\"")
    process_user_interaction(command)

# Start background voice listener thread
voice_listener = VoiceListener(on_command_callback=on_voice_wake_trigger)
voice_listener.start()

# --- Background Loops ---

def mood_engine_loop():
    """1Hz loop that updates emotions, decays variables, and runs autonomous reactions.
    
    P0 #1 fix: Sensor reads and brain API calls are performed OUTSIDE the state_lock
    to prevent deadlocking when Gemini API calls block.
    """
    global rover_state
    
    print("Emotional Mood Engine running...")
    previous_presence_state = "Absent"
    while True:
        try:
            time.sleep(1.0)
            
            # --- Phase 1: Read sensors OUTSIDE the lock (I/O operation) ---
            sensor_data = sensor.read_all()
            vision_data = vision.get_latest_data() if hasattr(vision, 'get_latest_data') else {}
            sensor_data["objects"] = vision_data.get("objects", [])
            
            dist_fl = sensor_data["fl"]
            dist_f  = sensor_data["f"]
            dist_fr = sensor_data["fr"]
            dist_rl = sensor_data["rl"]
            dist_rr = sensor_data["rr"]
            
            # Aggregate minimum distances for front and rear groups
            dist_front_min = min(dist_fl, dist_f, dist_fr)
            dist_rear_min = min(dist_rl, dist_rr)
            
            # --- Phase 2: Update state variables INSIDE the lock (fast, no I/O) ---
            # Track what reactions are needed so we can execute them outside the lock
            obstacle_reaction_needed = None  # (direction, distance) or None
            idle_thought_needed = False
            state_snapshot = None
            
            with state_lock:
                current_drive_mode = rover_state["drive_mode"]
                
                # --- Obstacle Reaction (No Fear State) ---
                if dist_front_min < config.PROXIMITY_ALARM_CM:
                    rover_state["expression"] = "scared"
                    if current_drive_mode == "manual":
                        driver.shiver(0.8)
                        driver.drive(-0.5, 0, 0)
                        time.sleep(0.4)
                        driver.stop()
                    obstacle_reaction_needed = ("front", dist_front_min)
                elif dist_rear_min < config.PROXIMITY_ALARM_CM:
                    rover_state["expression"] = "scared"
                    if current_drive_mode == "manual":
                        driver.shiver(0.8)
                        driver.drive(0.5, 0, 0)
                        time.sleep(0.4)
                        driver.stop()
                    obstacle_reaction_needed = ("rear", dist_rear_min)
                
                # --- Curiosity Stimulus ---
                if config.PROXIMITY_ALARM_CM <= dist_front_min < config.PROXIMITY_ALERT_CM:
                    rover_state["curiosity"] = min(1.0, rover_state["curiosity"] + config.INC_CURIOSITY_SENSOR)
                
                # --- Initiative & Relationship Engine (Phase 5 & 6) ---
                now = time.time()
                idle_time = now - rover_state["last_interaction"]
                current_presence = vision_data.get("presence_state", "Absent")
                current_objects = vision_data.get("objects", [])
                
                # Initiative check (requires social energy)
                initiative_needed = None
                if rover_state.get("social_energy", 1.0) > 0.3 and current_drive_mode == "manual":
                    # Greeting Initiative (User just entered frame)
                    if current_presence == "Present" and previous_presence_state == "Absent":
                        initiative_needed = "greeting"
                        rover_state["last_interaction"] = now # Prevent immediate re-greeting
                    
                    # Check-in Initiative (User Present for a long time but ignoring robot)
                    elif current_presence == "Present" and idle_time > 180.0:
                        initiative_needed = "check-in"
                        rover_state["last_interaction"] = now
                        rover_state["trust"] = max(0.0, rover_state.get("trust", 0.5) - config.DEC_TRUST_IGNORED)
                
                previous_presence_state = current_presence
                
                # Recharge Social Energy while idle
                if idle_time > 60.0:
                    rover_state["social_energy"] = min(1.0, rover_state.get("social_energy", 0.0) + config.DECAY_SOCIAL_ENERGY)
                
                # --- Idle & Sleep Decay ---
                if idle_time > 120.0 and current_drive_mode == "manual" and current_presence == "Absent":
                    rover_state["expression"] = "sleeping"
                    rover_state["happiness"] = max(0.1, rover_state["happiness"] - config.DECAY_HAPPINESS * 0.5)
                    rover_state["curiosity"] = max(0.1, rover_state["curiosity"] - config.DECAY_CURIOSITY * 0.5)
                else:
                    rover_state["happiness"] = max(0.0, rover_state["happiness"] - config.DECAY_HAPPINESS)
                    rover_state["curiosity"] = max(0.0, rover_state["curiosity"] - config.DECAY_CURIOSITY)
                    
                    # Update expressions based on moods
                    if rover_state["expression"] != "listening":
                        if rover_state["happiness"] > 0.7:
                            rover_state["expression"] = "happy"
                        elif rover_state["curiosity"] > 0.6:
                            rover_state["expression"] = "curious"
                        elif rover_state["happiness"] < 0.3:
                            rover_state["expression"] = "sad"
                        else:
                            rover_state["expression"] = "happy"  # Baseline awake expression

                # --- Autonomous Idle Actions (only in manual mode) ---
                # Skip these if the dedicated autonomous loop is active
                if current_drive_mode == "manual":
                    if idle_time > 20.0 and (now - rover_state["last_autonomous_action"]) > 30.0:
                        if rover_state["expression"] == "curious" and random.random() < 0.4:
                            driver.spin(0.6, random.choice([-1, 1]))
                            rover_state["last_autonomous_action"] = now
                        elif rover_state["expression"] == "happy" and random.random() < 0.3:
                            driver.wiggle(0.6)
                            rover_state["last_autonomous_action"] = now

                # Pack current telemetry package
                sim_state = driver.get_simulation_state()
                telemetry = {
                    "happiness": round(rover_state["happiness"], 2),
                    "curiosity": round(rover_state["curiosity"], 2),
                    "trust": round(rover_state.get("trust", 0.5), 2),
                    "social_energy": round(rover_state.get("social_energy", 1.0), 2),
                    "relationship_strength": round(rover_state.get("relationship_strength", 0.5), 2),
                    "expression": rover_state["expression"],
                    "objects": current_objects,
                    "dist_fl": dist_fl,
                    "dist_f": dist_f,
                    "dist_fr": dist_fr,
                    "dist_rl": dist_rl,
                    "dist_rr": dist_rr,
                    "sim_x": round(sim_state["x"], 1),
                    "sim_y": round(sim_state["y"], 1),
                    "sim_theta": round(sim_state["theta"], 2),
                    "sim_vx": sim_state["vx"],
                    "sim_vy": sim_state["vy"],
                    "sim_omega": sim_state["omega"],
                    "is_simulation": driver.is_simulation,
                    "mic_active": voice_listener.running,
                    "speed_multiplier": round(driver.speed_multiplier, 2),
                    "drive_mode": rover_state["drive_mode"]
                }
                
                # Check if standard idle thought is needed
                idle_time_check = time.time() - rover_state.get("last_interaction", time.time())
                if idle_time_check > 45.0 and current_drive_mode == "manual" and not initiative_needed:
                    idle_thought_needed = True
                    
                if idle_thought_needed or initiative_needed:
                    state_snapshot = dict(rover_state)  # Snapshot for brain context
            
            # --- Phase 3: Emit telemetry OUTSIDE the lock ---
            socketio.emit("telemetry", telemetry)

            # --- Phase 4: Brain API calls OUTSIDE the lock (may block on network I/O) ---
            # P0 #1 fix: These calls can hit the Gemini API and block for seconds.
            # Running them outside the lock prevents deadlocking other threads.
            
            # Obstacle personality reactions
            if obstacle_reaction_needed:
                direction, distance = obstacle_reaction_needed
                obs_reaction = brain.react_to_obstacle(direction, distance)
                
                # Broadcast XAI
                xai_data = obs_reaction.get("xai", {
                    "decision": f"Action: {obs_reaction.get('action', 'stop').upper()}",
                    "reason": "Hardware safety override triggered",
                    "confidence": "100%",
                    "source_data": f"Proximity Alarm ({distance}cm at {direction})"
                })
                socketio.emit("xai_update", xai_data)

                socketio.emit("rover_reply", {
                    "speech": obs_reaction["speech"],
                    "emotion": obs_reaction["emotion"],
                    "action": obs_reaction["action"]
                })
                if obs_reaction.get("inner_thought"):
                    socketio.emit("inner_thought", {"thought": obs_reaction["inner_thought"]})

            # AURUS Brain Initiatives & Idle Thoughts
            if (idle_thought_needed or initiative_needed) and state_snapshot:
                if initiative_needed:
                    thought = brain.generate_initiative(initiative_needed, state_snapshot, sensor_data)
                else:
                    thought = brain.generate_idle_thought(state_snapshot, sensor_data)
                    
                if thought:
                    # Broadcast XAI
                    xai_data = thought.get("xai", {
                        "decision": f"Topic: {initiative_needed or 'Idle Observation'}",
                        "reason": "Social interaction decay timer",
                        "confidence": "100%",
                        "source_data": "Internal State + Presence History"
                    })
                    socketio.emit("xai_update", xai_data)

                    socketio.emit("idle_thought", {
                        "speech": thought["speech"],
                        "emotion": thought.get("emotion", "curious"),
                        "inner_thought": thought.get("inner_thought", "")
                    })
                    
                    # Get high-quality native audio TTS from Google AI Studio
                    audio_file_path = f"initiative_{uuid.uuid4().hex[:8]}.wav"
                    audio_generated = False
                    if gemini_configured and gemini_client:
                        try:
                            tts_prompt = f"Read the following sentence aloud exactly as written: {thought['speech']}"
                            tts_response = gemini_client.models.generate_content(
                                model=config.GEMINI_MODEL,
                                contents=tts_prompt,
                                config=types.GenerateContentConfig(
                                    response_modalities=["audio"],
                                    speech_config=types.SpeechConfig(
                                        voice_config=types.VoiceConfig(
                                            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                                voice_name=config.GEMINI_VOICE
                                            )
                                        )
                                    )
                                )
                            )
                            for part in tts_response.candidates[0].content.parts:
                                if part.inline_data:
                                    with open(audio_file_path, "wb") as f:
                                        f.write(part.inline_data.data)
                                    audio_generated = True
                                    break
                        except Exception as e:
                            print(f"Failed to synthesize Gemini Audio for initiative: {e}")
                            
                    if audio_generated:
                        play_audio_headless(audio_file_path)
                        def _cleanup_audio(path):
                            time.sleep(5.0)
                            try:
                                os.remove(path)
                            except OSError:
                                pass
                        threading.Thread(target=_cleanup_audio, args=(audio_file_path,), daemon=True).start()
                    else:
                        socketio.emit("audio_trigger", {"sound": "happy_chirp"})
                    
                    # Execute the idle action if any
                    action = thought.get("action", "stop")
                    if action != "stop":
                        execute_brain_action(action)

        except Exception as e:
            # Protect the mood engine from crashing — log and continue
            print(f"[MoodEngine] ERROR in mood loop: {e}")
            traceback.print_exc()
            time.sleep(1.0)

# Start background state thread
threading.Thread(target=mood_engine_loop, daemon=True).start()

# --- HTTP Routing ---

@app.route("/")
def index():
    return render_template("index.html", wake_words=config.WAKE_WORDS)

@app.route("/config", methods=["POST"])
def update_config():
    global gemini_configured
    data = request.json or {}
    key = data.get("api_key", "").strip()
    if key:
        init_gemini(key)
        return jsonify({"success": True, "message": "Gemini API initialized successfully."})
    return jsonify({"success": False, "message": "Invalid key provided."}), 400

# --- SocketIO Handlers ---

@socketio.on("set_speed_multiplier")
def handle_set_speed_multiplier(data):
    try:
        val = float(data.get("multiplier", 0.6))
        driver.set_speed_multiplier(val)
    except Exception as e:
        print(f"Error setting speed multiplier: {e}")

@socketio.on("manual_drive")
def handle_manual_drive(data):
    """Handles precision strafing vector commands from user dashboard"""
    # Guard: only accept manual drive commands in manual mode
    with state_lock:
        if rover_state["drive_mode"] != "manual":
            emit("mode_conflict", {
                "message": f"Manual controls disabled in {rover_state['drive_mode']} mode. Switch to Manual first."
            })
            return

    vx = float(data.get("vx", 0))
    vy = float(data.get("vy", 0))
    omega = float(data.get("omega", 0))
    
    driver.drive(vx, vy, omega)
    
    with state_lock:
        rover_state["last_interaction"] = time.time()
        # Active movement builds minor curiosity
        if vx != 0 or vy != 0 or omega != 0:
            rover_state["curiosity"] = min(1.0, rover_state["curiosity"] + config.INC_CURIOSITY_MOVE)

@socketio.on("stop")
def handle_stop():
    """Emergency stop: kills all motors and forces Manual mode for safety."""
    driver.stop()
    voice_burst_cancel.set()
    with state_lock:
        if rover_state["drive_mode"] != "manual":
            # Force-revert to manual mode on E-STOP
            pass  # Let set_drive_mode handle the broadcast
    set_drive_mode("manual")

@socketio.on("set_mode")
def handle_set_mode(data):
    """Handles drive mode change requests from the UI."""
    mode = data.get("mode", "manual")
    success = set_drive_mode(mode)
    if not success:
        emit("mode_error", {"message": f"Invalid mode: {mode}"})

@socketio.on("feed_treat")
def handle_feed_treat():
    """Feeds a virtual treat: increases happiness, triggers personality reaction"""
    with state_lock:
        rover_state["happiness"] = min(1.0, rover_state["happiness"] + config.INC_HAPPINESS_TREAT)
        rover_state["trust"] = min(1.0, rover_state.get("trust", 0.5) + config.INC_TRUST_POSITIVE)
        rover_state["relationship_strength"] = min(1.0, rover_state.get("relationship_strength", 0.5) + config.INC_RELATIONSHIP_INTERACTION)
        rover_state["expression"] = "happy"
        rover_state["last_interaction"] = time.time()
        
    # Get personality-flavored treat reaction from brain
    treat_reaction = brain.react_to_treat()
    execute_brain_action(treat_reaction.get("action", "wiggle"))
    
    socketio.emit("rover_reply", {
        "speech": treat_reaction["speech"],
        "emotion": treat_reaction.get("emotion", "happy"),
        "action": treat_reaction.get("action", "wiggle")
    })
    if treat_reaction.get("inner_thought"):
        socketio.emit("inner_thought", {"thought": treat_reaction["inner_thought"]})
    socketio.emit("audio_trigger", {"sound": "happy_chirp"})

@socketio.on("reset_sim")
def handle_reset_sim():
    driver.reset_simulation()

@socketio.on("user_talk")
def handle_user_talk(data):
    """Handles chat and web-mic speech interactions via SocketIO"""
    message = data.get("message", "").strip()
    if message:
        # Pass to the standard AI pipeline
        process_user_interaction(message)

@socketio.on("demo_mock_presence")
def handle_demo_mock_presence(data):
    """Override vision presence state for demo sequence."""
    state = data.get("state")
    if hasattr(vision, 'set_mock_presence'):
        vision.set_mock_presence(state)
        print(f"[Demo] Set mock presence to: {state}")

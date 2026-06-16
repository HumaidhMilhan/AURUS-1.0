import time
import threading
import sys
import ctypes

# Suppress ALSA warning messages from C-library (harmless but annoying on Raspberry Pi)
try:
    ERROR_HANDLER_FUNC = ctypes.CFUNCTYPE(None, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p)
    def py_error_handler(filename, line, function, err, fmt):
        pass
    c_error_handler = ERROR_HANDLER_FUNC(py_error_handler)
    asound = ctypes.cdll.LoadLibrary('libasound.so.2')
    asound.snd_lib_error_set_handler(c_error_handler)
except Exception:
    pass

# Try importing speech_recognition
try:
    import speech_recognition as sr
    HAS_SR = True
except ImportError:
    HAS_SR = False
    sr = None

import config

class VoiceListener:
    def __init__(self, on_command_callback):
        self.on_command_callback = on_command_callback
        self.running = False
        self.thread = None
        self.has_hardware = HAS_SR
        
        if not self.has_hardware:
            print("[VoiceListener] WARNING: speech_recognition library is missing. Voice activation disabled.")

    def start(self):
        if not self.has_hardware:
            return
        
        self.running = True
        self.thread = threading.Thread(target=self._listen_loop, daemon=True)
        self.thread.start()
        print("[VoiceListener] Continuous background listener started.")

    def stop(self):
        self.running = False
        print("[VoiceListener] Background listener stopped.")

    def _listen_loop(self):
        r = sr.Recognizer()
        
        # Configure thresholds
        r.dynamic_energy_threshold = True
        r.pause_threshold = 0.8
        
        mic = None
        try:
            mic = sr.Microphone(device_index=config.MIC_INDEX)
            # Test opening microphone
            with mic as source:
                r.adjust_for_ambient_noise(source, duration=1.0)
            print(f"[VoiceListener] Microphone initialized successfully (Device Index: {config.MIC_INDEX}).")
        except Exception as e:
            print(f"[VoiceListener] ERROR: Failed to access microphone: {e}")
            print("[VoiceListener] Running in mock-voice mode. Voice activation will not capture physical microphone.")
            self.running = False
            return

        while self.running:
            try:
                with mic as source:
                    # Listen with 3s timeout and 10s maximum phrase limit
                    print("[VoiceListener] Listening for wake-word 'AURUS'...")
                    audio = r.listen(source, timeout=3.0, phrase_time_limit=8.0)
                
                print("[VoiceListener] Processing audio...")
                # Recognize speech using free Google Web Speech API
                try:
                    text = r.recognize_google(audio).lower()
                    print(f"[VoiceListener] Transcribed: \"{text}\"")
                    
                    # Detect wake-word
                    wake_detected = False
                    command = ""
                    
                    for wake in config.WAKE_WORDS:
                        if wake in text:
                            wake_detected = True
                            # Extract everything after the wake-word as the command
                            parts = text.split(wake, 1)
                            if len(parts) > 1:
                                command = parts[1].strip()
                            break
                    
                    if wake_detected:
                        print(f"[VoiceListener] WAKE-WORD DETECTED! Command: \"{command}\"")
                        if self.on_command_callback:
                            # Run callback in a separate thread to keep listener responsive
                            threading.Thread(
                                target=self.on_command_callback,
                                args=(command,),
                                daemon=True
                            ).start()
                            
                except sr.UnknownValueError:
                    # Audio was not clear enough to transcribe
                    pass
                except sr.RequestError as e:
                    print(f"[VoiceListener] Google Speech Recognition service error: {e}")
                    time.sleep(2.0)
                    
            except sr.WaitTimeoutError:
                # No audio caught within timeout, loop again
                continue
            except Exception as e:
                print(f"[VoiceListener] Listener loop exception: {e}")
                time.sleep(1.0)

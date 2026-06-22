import os
import sys

# Ensure the root directory is in the PYTHONPATH so 'src' can be imported
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from src.web.app import app, socketio, voice_listener, driver

def main():
    print("Starting AURUS Server from run.py...")
    try:
        socketio.run(app, host="0.0.0.0", port=5000, debug=False, allow_unsafe_werkzeug=True)
    except KeyboardInterrupt:
        print("Interrupted by user. Shutting down...")
    finally:
        voice_listener.stop()
        driver.cleanup()

if __name__ == "__main__":
    main()

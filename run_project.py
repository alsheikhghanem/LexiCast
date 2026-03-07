import subprocess
import sys
import time


def main():
    print("🚀 Starting Backend Server (FastAPI on Port 8000)...")
    backend_process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--reload", "--port", "8000"],
        cwd="backend"
    )

    print("🌍 Starting Frontend Server (HTTP on Port 8080)...")
    frontend_process = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8080", "--directory", "frontend"]
    )

    print("\n✅ All servers are running successfully!")
    print("➡️  Backend API:  http://127.0.0.1:8000")
    print("➡️  Frontend UI:  http://127.0.0.1:8080\n")
    print("Press Ctrl+C to stop both servers.")

    try:
        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print("\n🛑 Shutting down servers...")
        backend_process.terminate()
        frontend_process.terminate()
        print("Goodbye!")


if __name__ == "__main__":
    main()
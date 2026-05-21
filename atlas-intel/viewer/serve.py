#!/usr/bin/env python3

"""
Simple HTTP server for Location Intelligence Data Viewer
Usage: python3 serve.py [--globe current|blue]
"""

import argparse
import http.server
import os
import socketserver
import webbrowser
from pathlib import Path

PORT = 8888
GLOBE_TARGETS = {
    "current": "globe.html",
    "blue": "globe-blue.html",
}


class CORSHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler with CORS enabled"""

    def end_headers(self):
        # Enable CORS
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()


def parse_args():
    parser = argparse.ArgumentParser(description="Serve the Atlas Intel static viewer.")
    parser.add_argument(
        "--globe",
        choices=sorted(GLOBE_TARGETS),
        default="current",
        help="Globe version to open in the browser.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=PORT,
        help=f"Port to serve on. Defaults to {PORT}.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    globe_path = GLOBE_TARGETS[args.globe]

    # Change to parent directory so resources/ is accessible
    parent_dir = Path(__file__).parent.parent
    os.chdir(parent_dir)

    print(f"Serving from: {parent_dir}")

    # Create server
    Handler = CORSHTTPRequestHandler
    with socketserver.TCPServer(("", args.port), Handler) as httpd:
        print("\n" + "="*60)
        print("🌍 Location Intelligence Data Viewer")
        print("="*60)
        print(f"\n✅ Server running at: http://localhost:{args.port}")
        print(f"📁 Serving from: {parent_dir}")
        print(f"\n🌐 Available viewers:")
        print(f"   - Current 3D Globe: http://localhost:{args.port}/globe.html")
        print(f"   - Blue 3D Globe:    http://localhost:{args.port}/globe-blue.html")
        print(f"   - 2D Map:           http://localhost:{args.port}/index.html")
        print(f"\n💡 Opening {args.globe} 3D globe viewer...")
        print("\nPress Ctrl+C to stop\n")

        # Open browser to globe viewer
        webbrowser.open(f"http://localhost:{args.port}/{globe_path}")

        # Start serving
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n👋 Server stopped")


if __name__ == "__main__":
    main()

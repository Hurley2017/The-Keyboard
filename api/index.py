"""The-Keyboard — Flask app.

Deploys to Vercel (@vercel/python) and is served both at the root of its own
deployment (e.g. https://the-keyboard-xxxx.vercel.app/) and under a sub-path
proxy such as https://tusher.in/The-Keyboard/.

index.html uses *relative* asset links (static/style.css, static/app.js) so the
page works under any base path. This file serves those assets from both the
root and the /The-Keyboard/ prefix.
"""

import os

from flask import Flask, render_template, send_from_directory

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATE_DIR = os.path.join(BASE_DIR, "templates")

app = Flask(
    __name__,
    static_folder=STATIC_DIR,  # serves /static/... automatically
    template_folder=TEMPLATE_DIR,
)


@app.route("/")
@app.route("/The-Keyboard")
@app.route("/The-Keyboard/")
def index():
    """Serve the piano page. The extra routes let a sub-path proxy that keeps
    the /The-Keyboard prefix (instead of stripping it) still find the page."""
    return render_template("index.html")


@app.route("/The-Keyboard/static/<path:filename>")
def static_subpath(filename):
    """Serve static assets when the /The-Keyboard prefix is preserved by the
    proxy (browser asks for /The-Keyboard/static/style.css)."""
    return send_from_directory(STATIC_DIR, filename)


if __name__ == "__main__":
    # Local development: python api/index.py  -> http://127.0.0.1:5000
    app.run(debug=True)

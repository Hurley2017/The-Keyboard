"""KeyNote — Flask app for the virtual instruments.

Each instrument lives at its own route (/Piano, and any added later) with its
template under templates/<Name>/index.html. Registering a new name here is
enough to expose it. Templates use relative asset paths (static/...) so the
app keeps working behind a sub-path proxy that preserves a prefix.

Local dev:  python api/index.py  ->  http://127.0.0.1:5000/
            (piano at http://127.0.0.1:5000/Piano)
"""

import os

from flask import Flask, render_template, send_from_directory

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATE_DIR = os.path.join(BASE_DIR, "templates")

app = Flask(
    __name__,
    static_folder=STATIC_DIR,      # serves /static/... automatically
    template_folder=TEMPLATE_DIR,
)

# Instrument names, in display order. Add a new entry (and a matching
# templates/<Name>/index.html) to bring a new instrument online.
INSTRUMENTS = ["Piano"]


def register_instrument(name):
    """Mount /<name> (and /<name>/static/...) for one instrument."""
    # forward slashes — Jinja's template loader does not understand "\\"
    page = f"{name}/index.html"

    app.add_url_rule(
        f"/{name}",
        endpoint=f"/{name}",
        view_func=lambda: render_template(page),
    )
    app.add_url_rule(
        f"/{name}/",
        endpoint=f"/{name}/",
        view_func=lambda: render_template(page),
    )
    app.add_url_rule(
        f"/{name}/static/<path:filename>",
        endpoint=f"/{name}/static",
        view_func=lambda filename: send_from_directory(STATIC_DIR, filename),
    )


for name in INSTRUMENTS:
    register_instrument(name)


@app.route("/")
def landing():
    """Root page lists the available instruments."""
    return render_template("landing.html", instruments=INSTRUMENTS)


if __name__ == "__main__":
    app.run(debug=True, port=int(os.environ.get("PORT", 5000)))
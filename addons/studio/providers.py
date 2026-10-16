"""Deterministic demo provider. No model calls, fabricated research or paid API calls."""


def generate_demo_scripts(inputs):
    app, brief = inputs["metadata"], inputs["brief"]
    name = app["name"]
    features = app.get("features") or [app.get("subtitle") or name]
    audience = brief.get("audience") or app.get("audience") or "your audience"
    goal = brief["goal"]
    tone = brief["tone"]
    context = f"Audience: {audience}\nGoal: {goal}\nTone to aim for: {tone}"
    return [
        {
            "variant": 1,
            "angle": "The small first step",
            "hook": f"What if getting started is the hardest part? Meet {name}.",
            "script": (
                f"{context}\n\n0–3 s · Open with an everyday moment your audience recognizes."
                f"\n3–12 s · Open {name} and show: {features[0]}."
                "\n12–20 s · Show one action from start to finish using real screen footage."
                "\n20–25 s · Close with the first small step someone can take in the app."
                "\n\nShot list: a familiar situation, a screen recording, "
                "a closing piece to camera."
            ),
            "cta": f"Discover {name} and take your first step.",
        },
        {
            "variant": 2,
            "angle": "The walkthrough",
            "hook": f"Here is what you can actually do with {name}.",
            "script": (
                f"{context}\n\n0–3 s · Preview the result you will demonstrate, "
                "without invented stats."
                f"\n3–10 s · Show how to get started with {features[0]}."
                f"\n10–18 s · Move on to {features[-1]} and explain why it helps."
                "\n18–25 s · Return to the result and give viewers a moment to take it in."
                "\n\nShot list: a continuous app recording, a voiceover and captions."
            ),
            "cta": f"Try it for yourself with {name}.",
        },
        {
            "variant": 3,
            "angle": "The creator’s story",
            "hook": f"Why build {name}? It started with a simple need.",
            "script": (
                f"{context}\n\n0–4 s · The creator describes a problem they actually experienced."
                f"\n4–12 s · Connect that need to {features[0]}, using a specific example."
                f"\n12–20 s · Show {name} in use and explain a design choice or a limitation."
                "\n20–30 s · Invite viewers to try it and share their feedback."
                "\n\nShot list: a piece to camera, an app recording and a behind-the-scenes detail."
                " Do not present an actor as a real customer."
            ),
            "cta": f"Try {name} and tell us what you think.",
        },
    ]

"""Deterministic demo provider. No model calls, fabricated research or paid API calls."""


def generate_demo_scripts(inputs):
    app, brief = inputs["metadata"], inputs["brief"]
    name = app["name"]
    features = app.get("features") or [app.get("subtitle") or name]
    audience = brief.get("audience") or app.get("audience") or "votre public"
    goal = brief["goal"]
    tone = brief["tone"]
    context = f"Public : {audience}\nIntention : {goal}\nTon à travailler : {tone}"
    return [
        {
            "variant": 1,
            "angle": "Le petit déclic",
            "hook": f"Et si le plus difficile, c’était juste de commencer ? Voici {name}.",
            "script": (
                f"{context}\n\n0–3 s · Une situation quotidienne "
                "dans laquelle le public se reconnaît."
                f"\n3–12 s · Ouvrir {name} et montrer : {features[0]}."
                "\n12–20 s · Filmer une seule action de bout en bout, avec une capture réelle."
                "\n20–25 s · Terminer sur le premier petit pas proposé par l’application."
                "\n\nÀ tourner : une situation vécue, une capture d’écran, "
                "une conclusion face caméra."
            ),
            "cta": f"Découvrez {name} et faites votre premier essai.",
        },
        {
            "variant": 2,
            "angle": "La démonstration",
            "hook": f"Voilà concrètement ce que vous pouvez faire avec {name}.",
            "script": (
                f"{context}\n\n0–3 s · Afficher le résultat que l’on va montrer, "
                "sans chiffre inventé."
                f"\n3–10 s · Montrer l’entrée dans la fonction « {features[0]} »."
                f"\n10–18 s · Enchaîner avec « {features[-1]} » et expliquer son intérêt."
                "\n18–25 s · Revenir au résultat et laisser une seconde pour le lire."
                "\n\nÀ tourner : une capture continue de l’app, une voix off, des sous-titres."
            ),
            "cta": f"À vous d’essayer {name}.",
        },
        {
            "variant": 3,
            "angle": "Le point de vue du créateur",
            "hook": f"Pourquoi avoir créé {name} ? Tout est parti d’un besoin simple.",
            "script": (
                f"{context}\n\n0–4 s · Le créateur raconte un problème "
                "qu’il a réellement rencontré."
                f"\n4–12 s · Relier ce besoin à « {features[0]} », avec un exemple précis."
                f"\n12–20 s · Montrer {name} en situation, en explicitant une limite ou un choix."
                "\n20–30 s · Inviter le public à essayer et à faire un retour."
                "\n\nÀ tourner : face caméra, capture de l’app, détail de fabrication."
                " Ne pas présenter un acteur comme un client réel."
            ),
            "cta": f"Essayez {name} et dites-nous ce que vous en pensez.",
        },
    ]

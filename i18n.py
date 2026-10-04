"""
Langue des textes générés par le serveur (interprétations, explications, messages d'erreur).
La langue est propre à chaque requête (contextvars) : ?lang=fr ou ?lang=en.
"""
import contextvars

_lang = contextvars.ContextVar("lang", default="fr")


def set_lang(value) -> str:
    lang = "en" if str(value or "").lower().startswith("en") else "fr"
    _lang.set(lang)
    return lang


def lang() -> str:
    return _lang.get()


def T(fr: str, en: str) -> str:
    """Choisit le texte dans la langue de la requête."""
    return en if _lang.get() == "en" else fr


def num(x, nd=2, signed=False) -> str:
    """Nombre pour les phrases : virgule décimale en français, point en anglais."""
    if x is None:
        return T("n.d.", "n/a")
    s = f"{x:+.{nd}f}" if signed else f"{x:.{nd}f}"
    return s.replace(".", ",") if _lang.get() == "fr" else s

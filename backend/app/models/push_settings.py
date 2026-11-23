# Schema for the #push_settings collection: the site's VAPID key pair, which
# signs every phone push (services/push.py). A single row (id 1), generated
# the first time anything needs it, so phone alerts work without anyone
# adding keys to the server's .env. Changing or deleting the row invalidates
# every phone's subscription: each person then has to turn alerts on again.
from beanie import Document


class PushSettings(Document):
    id: int = 1
    private_key_pem: str
    # The public key as browsers want it for applicationServerKey: the
    # uncompressed P-256 point, base64url without padding.
    public_key: str

    class Settings:
        name = "push_settings"

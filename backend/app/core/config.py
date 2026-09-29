# Centralized app configuration, loaded from environment variables / .env.
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    app_name: str = "Handpikd Revmap API"
    api_v1_prefix: str = "/api/v1"
    debug: bool = True

    mongodb_uri: str
    mongodb_db_name: str = "handpikd"

    # When False, the get_current_user dependency bypasses all token checks.
    # Meant for local development/testing only.
    auth_enabled: bool = True
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24

    # Local disk directory product images are written to, see
    # app/services/storage.py. Relative in local dev (resolves under
    # backend/), overridden to the mounted volume path in production — see
    # docker-compose.yml.
    media_root: str = "media"

    # Guards against a split-brain upload: MONGODB_URI in this project's own
    # .env points at the shared production database even during local dev,
    # so an upload run locally writes its image file under the relative
    # media_root above but records a path in the *shared* DB that only this
    # machine can serve — the live site then 404s on it. storage.py refuses
    # uploads whenever media_root is still relative (the local-dev default;
    # production always overrides it to the absolute /media mount) unless
    # this is explicitly set, so opt in only if you've also pointed
    # MONGODB_URI at a non-shared database for this session.
    allow_local_media_uploads: bool = False

    # Local disk directory uploaded vendor purchase-invoice PDFs are stored
    # to, see app/services/purchase_invoice_storage.py. Deliberately separate
    # from media_root: these are never served publicly (no StaticFiles/nginx
    # mount), since vendor documents may carry pricing/GSTIN info. Relative
    # in local dev, overridden to the mounted volume path in production —
    # see docker-compose.yml.
    purchase_invoice_root: str = "purchase_invoices"

    # Reading an uploaded vendor invoice PDF falls back to Claude whenever
    # the deterministic parser can't decode its layout — see
    # app/services/claude_invoice_extraction.py. Leaving the key unset
    # disables that fallback: invoices the parser can't read are then
    # refused, and the admin enters the purchase order by hand.
    anthropic_api_key: str = ""
    invoice_extraction_model: str = "claude-opus-5"

    # Outgoing mail for the admin's Emails module (routes/emails.py), sent
    # through the company's Titan mailbox. smtp_user is both the login and
    # the From address; leaving it or the password unset disables sending
    # (the compose screen says so rather than failing per recipient).
    # Every sent message is also filed into the mailbox's Sent folder over
    # IMAP, since mail submitted over SMTP never shows up there on its own
    # — see services/email_sender.py. imap_sent_folder is only the fallback
    # when the server doesn't flag its Sent folder itself.
    #
    # The hosts are GoDaddy's, not Titan's own (smtp.titan.email): handpikd.co
    # mail is Titan-based email bought through GoDaddy, which runs on
    # GoDaddy's servers (MX *.secureserver.net) — Titan's hosts reject the
    # login outright. SPF only authorises secureserver.net too, so sending
    # through any other host would also fail spam checks.
    smtp_host: str = "smtpout.secureserver.net"
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_name: str = "Handpikd"
    imap_host: str = "imap.secureserver.net"
    imap_port: int = 993
    imap_sent_folder: str = "Sent"
    # Bulk sends go out one personalised message at a time with this pause
    # in between, and are capped per send — Titan limits how much a mailbox
    # may send per hour/day, and a burst is what trips it.
    email_bulk_limit: int = 50
    email_send_interval_seconds: float = 2.0

settings = Settings()

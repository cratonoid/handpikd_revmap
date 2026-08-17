# Holds a catalogue PDF on disk while the admin UI converts it page by page.
#
# Why this exists: a catalogue PDF is uploaded once (upload_catalogue_pdf) but
# its pages are then fetched one request at a time (get_catalogue_pdf_page),
# so the PDF has to outlive the request that delivered it. Real catalogues
# make the reason concrete — a 313MB, 107-page PDF renders to ~400MB of page
# images, which can't be returned in one response or held in memory, and
# re-uploading the PDF for every page would be far worse.
#
# Staged files are scratch data, NOT media: they live in the system temp
# directory rather than under settings.media_root, are never served to
# anyone, and are deleted as soon as the client finishes converting
# (discard_staged_pdf, called from the frontend's handlePdfFileChange). The
# TTL sweep below is the backstop for clients that never get that far — a
# closed tab, a lost connection — so an abandoned upload can't accumulate
# indefinitely. Because staging is container-local, it assumes the follow-up
# page requests reach the same backend; that holds for the single-backend
# deployment in docker-compose.yml, and would need revisiting behind a
# multi-instance load balancer.
import re
import tempfile
import time
import uuid
from pathlib import Path

from app.services.pdf import pdf_page_count, render_pdf_page

_STAGING_SUBFOLDER = "handpikd_catalogue_pdfs"

# Long enough for an admin to work through a large catalogue's pages without
# the source disappearing underneath them, short enough that an abandoned
# upload doesn't sit on disk for a day.
_SESSION_TTL_SECONDS = 60 * 60

# Session ids come back from the client, so they're checked against the exact
# shape create_staging_session issues (uuid4().hex) before being used to build
# a path — a bare join would otherwise let "../.." out of the staging folder.
_SESSION_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


class StagedPdfNotFoundError(RuntimeError):
    """Raised when a session id is unknown, malformed, or has been swept.

    Routes should catch this and turn it into a 404 — its message is written
    for the admin who will read it.
    """


def _staging_root() -> Path:
    return Path(tempfile.gettempdir()) / _STAGING_SUBFOLDER


def _purge_expired() -> None:
    for staged in _staging_root().glob("*.pdf"):
        try:
            if staged.stat().st_mtime < time.time() - _SESSION_TTL_SECONDS:
                staged.unlink(missing_ok=True)
        except OSError:
            # A concurrent request may have just removed it, and one
            # unreadable leftover shouldn't fail the upload being started.
            continue


def create_staging_session() -> tuple[str, Path]:
    """Reserves a session id and the path its PDF should be written to.

    The caller writes the upload itself (streaming it, rather than passing the
    bytes through here) so a several-hundred-megabyte PDF never has to exist
    in memory all at once.
    """
    _purge_expired()

    root = _staging_root()
    root.mkdir(parents=True, exist_ok=True)
    session_id = uuid.uuid4().hex
    return session_id, root / f"{session_id}.pdf"


def _staged_path(session_id: str) -> Path:
    if not _SESSION_ID_PATTERN.fullmatch(session_id):
        raise StagedPdfNotFoundError("unknown PDF upload")

    staged = _staging_root() / f"{session_id}.pdf"
    if not staged.is_file():
        raise StagedPdfNotFoundError("this PDF upload has expired — please upload it again")
    return staged


def count_staged_pages(session_id: str) -> int:
    return pdf_page_count(_staged_path(session_id))


def render_staged_page(session_id: str, page_index: int) -> bytes:
    return render_pdf_page(_staged_path(session_id), page_index)


def discard_staged_pdf(session_id: str) -> None:
    """Deletes a staged PDF, best-effort.

    A session id that was never valid is a no-op, and a file that can't be
    deleted right now (something still holds it open, which on Windows is
    enough to block the unlink) is left to _purge_expired instead of failing
    the caller — nothing about a discard is worth surfacing as an error, and
    the TTL sweep is exactly the backstop for it.
    """
    if not _SESSION_ID_PATTERN.fullmatch(session_id):
        return
    try:
        (_staging_root() / f"{session_id}.pdf").unlink(missing_ok=True)
    except OSError:
        pass

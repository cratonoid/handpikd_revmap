# Decodes a vendor's UPI QR code image into its standard UPI deep-link string
# (e.g. "upi://pay?pa=vendor@upibank&pn=Vendor%20Name&...") so the payment
# details baked into the code can be stored/read as text instead of an image.
from urllib.parse import parse_qs, urlparse

import cv2
import numpy as np


class InvalidQrCodeError(ValueError):
    """Raised when the image has no readable QR code, or the QR code isn't a UPI payment link."""


def decode_upi_qr(image_bytes: bytes) -> str:
    buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise InvalidQrCodeError("Uploaded file is not a readable image")

    raw_value, _points, _straight_qrcode = cv2.QRCodeDetector().detectAndDecode(image)
    if not raw_value:
        raise InvalidQrCodeError("No QR code could be found in the image")

    parsed = urlparse(raw_value)
    if parsed.scheme.lower() != "upi" or parsed.netloc.lower() != "pay":
        raise InvalidQrCodeError("QR code is not a standard UPI payment code")

    payee_address = parse_qs(parsed.query).get("pa")
    if not payee_address or not payee_address[0]:
        raise InvalidQrCodeError("UPI QR code is missing a payee address (pa)")

    return raw_value

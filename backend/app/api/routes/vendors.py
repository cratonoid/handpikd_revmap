# Vendors module: endpoints for managing vendor accounts and their points of
# contact, restricted to admins (bypassed entirely when settings.auth_enabled
# is False, matching require_admin in routes/admin.py).
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.api.routes.admin import require_admin
from app.models import User, VendorDetails, VendorIdCounter, VendorPocDetails, VendorPocIdCounter
from app.schemas.vendors import AddVendorDetailsRequest, AddVendorDetailsResponse, ConvertVendorQrResponse
from app.services.counters import get_next_id
from app.services.qr import InvalidQrCodeError, decode_upi_qr

router = APIRouter(prefix="/admin", tags=["vendors"])


@router.post("/add_vendor_details", response_model=AddVendorDetailsResponse)
async def add_vendor_details(
    payload: AddVendorDetailsRequest,
    _: User | None = Depends(require_admin),
) -> AddVendorDetailsResponse:
    vendor_id = await get_next_id(VendorIdCounter, "next_vendor_id", VendorDetails)
    vendor = VendorDetails(
        id=vendor_id,
        registered_name=payload.registered_name,
        gst=payload.gst,
        address=payload.address,
        description=payload.description,
        is_deleted=payload.is_deleted,
    )
    await vendor.insert()

    for contact_name, contact_phone in zip(payload.contact_name, payload.contact_phone):
        poc_id = await get_next_id(VendorPocIdCounter, "next_vendor_poc_id", VendorPocDetails)
        poc = VendorPocDetails(id=poc_id, vendor_id=vendor_id, contact_name=contact_name, contact_phone=contact_phone)
        await poc.insert()

    return AddVendorDetailsResponse(message="vendor successfully added")


@router.post("/convert_vendor_qr", response_model=ConvertVendorQrResponse)
async def convert_vendor_qr(
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> ConvertVendorQrResponse:
    image_bytes = await file.read()
    try:
        qr_code = decode_upi_qr(image_bytes)
    except InvalidQrCodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    return ConvertVendorQrResponse(qr_code=qr_code)

# Vendors module: endpoints for managing vendor accounts and their points of
# contact, restricted to admins (bypassed entirely when settings.auth_enabled
# is False, matching require_admin in routes/admin.py).
from beanie.operators import In
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.api.routes.admin import party_state_or_400, require_admin
from app.models import User, VendorDetails, VendorIdCounter, VendorPocDetails, VendorPocIdCounter
from app.schemas.vendors import (
    AddVendorDetailsRequest,
    AddVendorDetailsResponse,
    ConvertVendorQrResponse,
    UpdateVendorDetailsRequest,
    UpdateVendorDetailsResponse,
    VendorDetailItem,
    VendorListItem,
)
from app.services.counters import get_next_id
from app.services.qr import InvalidQrCodeError, decode_upi_qr

router = APIRouter(prefix="/admin", tags=["vendors"])


@router.post("/add_vendor_details", response_model=AddVendorDetailsResponse)
async def add_vendor_details(
    payload: AddVendorDetailsRequest,
    _: User | None = Depends(require_admin),
) -> AddVendorDetailsResponse:
    state_code, state_name = party_state_or_400(payload.state_code, payload.gst)

    vendor_id = await get_next_id(VendorIdCounter, "next_vendor_id", VendorDetails)
    vendor = VendorDetails(
        id=vendor_id,
        registered_name=payload.registered_name,
        gst=payload.gst,
        state_code=state_code,
        state_name=state_name,
        address=payload.address,
        description=payload.description,
        vendor_type=payload.vendor_type,
        is_deleted=payload.is_deleted,
    )
    await vendor.insert()

    for contact_name, contact_phone in zip(payload.contact_name, payload.contact_phone):
        poc_id = await get_next_id(VendorPocIdCounter, "next_vendor_poc_id", VendorPocDetails)
        poc = VendorPocDetails(id=poc_id, vendor_id=vendor_id, contact_name=contact_name, contact_phone=contact_phone)
        await poc.insert()

    return AddVendorDetailsResponse(message="vendor successfully added")


@router.get("/get_vendors_list", response_model=list[VendorListItem])
async def get_vendors_list(
    _: User | None = Depends(require_admin),
) -> list[VendorListItem]:
    # Lightweight id+name list for vendor-picker dropdowns (e.g. the product
    # and purchase order popups) — unlike get_vendor_details, this excludes
    # soft-deleted vendors and skips the address/POC lookups those popups
    # don't need. gst rides along (rather than being skipped like
    # address/POC) so the product form's picker can filter down to
    # GST-invoiceable vendors only — see product-form-modal.tsx.
    vendors = await VendorDetails.find(VendorDetails.is_deleted == False).to_list()
    return [
        VendorListItem(
            vendor_id=vendor.id,
            vendor_name=vendor.registered_name,
            gst=vendor.gst,
            state_code=vendor.state_code,
            state_name=vendor.state_name,
        )
        for vendor in vendors
    ]


@router.get("/get_vendor_details", response_model=list[VendorDetailItem])
async def get_vendor_details(
    _: User | None = Depends(require_admin),
) -> list[VendorDetailItem]:
    vendors = await VendorDetails.find_all().to_list()
    if not vendors:
        return []

    vendor_ids = [vendor.id for vendor in vendors]
    pocs = await VendorPocDetails.find(In(VendorPocDetails.vendor_id, vendor_ids)).to_list()
    pocs_by_vendor_id: dict[int, list[VendorPocDetails]] = {}
    for poc in pocs:
        pocs_by_vendor_id.setdefault(poc.vendor_id, []).append(poc)

    response = []
    for vendor in vendors:
        vendor_pocs = pocs_by_vendor_id.get(vendor.id, [])
        response.append(
            VendorDetailItem(
                id=vendor.id,
                registered_name=vendor.registered_name,
                gst=vendor.gst,
                state_code=vendor.state_code,
                state_name=vendor.state_name,
                address=vendor.address,
                description=vendor.description,
                qr_code=vendor.qr_code,
                vendor_type=vendor.vendor_type,
                is_deleted=vendor.is_deleted,
                contact_name=[poc.contact_name for poc in vendor_pocs],
                contact_phone=[poc.contact_phone for poc in vendor_pocs],
            )
        )

    return response


@router.post("/update_vendor_details", response_model=UpdateVendorDetailsResponse)
async def update_vendor_details(
    payload: UpdateVendorDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdateVendorDetailsResponse:
    vendor = await VendorDetails.get(payload.id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")

    vendor.registered_name = payload.registered_name
    vendor.gst = payload.gst
    vendor.state_code, vendor.state_name = party_state_or_400(payload.state_code, payload.gst)
    vendor.address = payload.address
    vendor.qr_code = payload.qr_code
    vendor.description = payload.description
    vendor.vendor_type = payload.vendor_type
    vendor.is_deleted = payload.is_deleted
    await vendor.save()

    await VendorPocDetails.find(VendorPocDetails.vendor_id == vendor.id).delete()
    for contact_name, contact_phone in zip(payload.contact_name, payload.contact_phone):
        poc_id = await get_next_id(VendorPocIdCounter, "next_vendor_poc_id", VendorPocDetails)
        poc = VendorPocDetails(id=poc_id, vendor_id=vendor.id, contact_name=contact_name, contact_phone=contact_phone)
        await poc.insert()

    return UpdateVendorDetailsResponse(message="vendor updated successfully")


@router.post("/convert_vendor_qr", response_model=ConvertVendorQrResponse)
async def convert_vendor_qr(
    file: UploadFile = File(...),
    # Only present in "edit" mode (see components/admin/vendor-form-modal.tsx)
    # — lets the message below distinguish a vendor's first QR from a
    # replacement of one they already had. Omitted entirely for a
    # brand-new vendor, which is always "added".
    vendor_id: int | None = Form(default=None),
    _: User | None = Depends(require_admin),
) -> ConvertVendorQrResponse:
    image_bytes = await file.read()
    try:
        qr_code = decode_upi_qr(image_bytes)
    except InvalidQrCodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    had_existing_qr = False
    if vendor_id is not None:
        vendor = await VendorDetails.get(vendor_id)
        had_existing_qr = bool(vendor and vendor.qr_code)

    message = "QR code updated" if had_existing_qr else "QR code added"
    return ConvertVendorQrResponse(qr_code=qr_code, message=message)

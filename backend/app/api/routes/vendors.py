# Vendors module: endpoints for managing vendor accounts and their points of
# contact, restricted to admins (bypassed entirely when settings.auth_enabled
# is False, matching require_admin in routes/admin.py).
from beanie.operators import In
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.api.routes.admin import require_admin
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


@router.get("/get_vendors_list", response_model=list[VendorListItem])
async def get_vendors_list(
    _: User | None = Depends(require_admin),
) -> list[VendorListItem]:
    # Lightweight id+name list for vendor-picker dropdowns (e.g. the product
    # and purchase order popups) — unlike get_vendor_details, this excludes
    # soft-deleted vendors and skips the address/GST/POC lookups those popups
    # don't need.
    vendors = await VendorDetails.find(VendorDetails.is_deleted == False).to_list()
    return [VendorListItem(vendor_id=vendor.id, vendor_name=vendor.registered_name) for vendor in vendors]


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
                address=vendor.address,
                description=vendor.description,
                qr_code=vendor.qr_code,
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
    vendor.address = payload.address
    vendor.qr_code = payload.qr_code
    vendor.description = payload.description
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
    _: User | None = Depends(require_admin),
) -> ConvertVendorQrResponse:
    image_bytes = await file.read()
    try:
        qr_code = decode_upi_qr(image_bytes)
    except InvalidQrCodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    return ConvertVendorQrResponse(qr_code=qr_code)

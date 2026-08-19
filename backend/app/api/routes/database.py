# Database module: the admin Database page's Vendors/Leads directory —
# a simple contact list distinct from the richer vendors.py module. Every
# route is admin-only (bypassed entirely when settings.auth_enabled is
# False, matching require_admin in routes/admin.py).
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.routes.admin import require_admin
from app.models import DatabaseVendor, DatabaseVendorIdCounter, Lead, LeadIdCounter, User
from app.schemas.database import (
    AddDatabaseVendorRequest,
    AddDatabaseVendorResponse,
    AddLeadRequest,
    AddLeadResponse,
    DatabaseVendorItem,
    DeleteDatabaseVendorRequest,
    DeleteDatabaseVendorResponse,
    DeleteLeadRequest,
    DeleteLeadResponse,
    LeadItem,
    UpdateDatabaseVendorRequest,
    UpdateDatabaseVendorResponse,
    UpdateLeadRequest,
    UpdateLeadResponse,
)
from app.services.counters import get_next_id

router = APIRouter(prefix="/admin/database", tags=["database"])


@router.post("/add_vendor", response_model=AddDatabaseVendorResponse)
async def add_vendor(
    payload: AddDatabaseVendorRequest,
    _: User | None = Depends(require_admin),
) -> AddDatabaseVendorResponse:
    vendor_id = await get_next_id(DatabaseVendorIdCounter, "next_database_vendor_id", DatabaseVendor)
    vendor = DatabaseVendor(
        id=vendor_id,
        name=payload.name,
        phone=payload.phone,
        address=payload.address,
        description=payload.description,
    )
    await vendor.insert()
    return AddDatabaseVendorResponse(message="vendor added successfully")


@router.get("/get_vendors", response_model=list[DatabaseVendorItem])
async def get_vendors(
    _: User | None = Depends(require_admin),
) -> list[DatabaseVendorItem]:
    vendors = await DatabaseVendor.find_all().to_list()
    return [
        DatabaseVendorItem(
            id=vendor.id,
            name=vendor.name,
            phone=vendor.phone,
            address=vendor.address,
            description=vendor.description,
        )
        for vendor in vendors
    ]


@router.post("/update_vendor", response_model=UpdateDatabaseVendorResponse)
async def update_vendor(
    payload: UpdateDatabaseVendorRequest,
    _: User | None = Depends(require_admin),
) -> UpdateDatabaseVendorResponse:
    vendor = await DatabaseVendor.get(payload.id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")

    vendor.name = payload.name
    vendor.phone = payload.phone
    vendor.address = payload.address
    vendor.description = payload.description
    await vendor.save()

    return UpdateDatabaseVendorResponse(message="vendor updated successfully")


@router.post("/delete_vendor", response_model=DeleteDatabaseVendorResponse)
async def delete_vendor(
    payload: DeleteDatabaseVendorRequest,
    _: User | None = Depends(require_admin),
) -> DeleteDatabaseVendorResponse:
    vendor = await DatabaseVendor.get(payload.id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")

    await vendor.delete()
    return DeleteDatabaseVendorResponse(message="vendor deleted successfully")


@router.post("/add_lead", response_model=AddLeadResponse)
async def add_lead(
    payload: AddLeadRequest,
    _: User | None = Depends(require_admin),
) -> AddLeadResponse:
    lead_id = await get_next_id(LeadIdCounter, "next_lead_id", Lead)
    lead = Lead(
        id=lead_id,
        name=payload.name,
        phone=payload.phone,
        institute_name=payload.institute_name,
    )
    await lead.insert()
    return AddLeadResponse(message="lead added successfully")


@router.get("/get_leads", response_model=list[LeadItem])
async def get_leads(
    _: User | None = Depends(require_admin),
) -> list[LeadItem]:
    leads = await Lead.find_all().to_list()
    return [
        LeadItem(id=lead.id, name=lead.name, phone=lead.phone, institute_name=lead.institute_name)
        for lead in leads
    ]


@router.post("/update_lead", response_model=UpdateLeadResponse)
async def update_lead(
    payload: UpdateLeadRequest,
    _: User | None = Depends(require_admin),
) -> UpdateLeadResponse:
    lead = await Lead.get(payload.id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="lead not found")

    lead.name = payload.name
    lead.phone = payload.phone
    lead.institute_name = payload.institute_name
    await lead.save()

    return UpdateLeadResponse(message="lead updated successfully")


@router.post("/delete_lead", response_model=DeleteLeadResponse)
async def delete_lead(
    payload: DeleteLeadRequest,
    _: User | None = Depends(require_admin),
) -> DeleteLeadResponse:
    lead = await Lead.get(payload.id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="lead not found")

    await lead.delete()
    return DeleteLeadResponse(message="lead deleted successfully")

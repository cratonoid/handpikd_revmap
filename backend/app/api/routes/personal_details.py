# Personal details module: read/edit Handpikd's own seller/company profile
# (letterhead, bank details, terms & conditions) that get_invoice_pdf renders
# onto generated invoices. Restricted to admins, same as every other
# routes/*.py module here (bypassed when settings.auth_enabled is False).
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.routes.admin import require_admin
from app.models import User
from app.schemas.personal_details import (
    PersonalDetailsItem,
    UpdatePersonalDetailsRequest,
    UpdatePersonalDetailsResponse,
)
from app.services.personal_details import get_personal_details, update_personal_details

router = APIRouter(prefix="/admin", tags=["personal_details"])


@router.get("/get_personal_details", response_model=list[PersonalDetailsItem])
async def get_personal_details_route(
    _: User | None = Depends(require_admin),
) -> list[PersonalDetailsItem]:
    values = await get_personal_details()
    return [PersonalDetailsItem(attribute=attribute, value=value) for attribute, value in values.items()]


@router.post("/update_personal_details", response_model=UpdatePersonalDetailsResponse)
async def update_personal_details_route(
    payload: UpdatePersonalDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdatePersonalDetailsResponse:
    try:
        await update_personal_details(payload.values)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    return UpdatePersonalDetailsResponse(message="personal details updated successfully")


# get_profile_details / edit_profile_details: same #personal_details table and
# service functions as above, exposed under the names used by the admin
# "Profile" page (app/admin/profile) so it's not coupled to the invoices tab's
# "Company details" modal naming.
@router.get("/get_profile_details", response_model=list[PersonalDetailsItem])
async def get_profile_details_route(
    _: User | None = Depends(require_admin),
) -> list[PersonalDetailsItem]:
    values = await get_personal_details()
    return [PersonalDetailsItem(attribute=attribute, value=value) for attribute, value in values.items()]


@router.post("/edit_profile_details", response_model=UpdatePersonalDetailsResponse)
async def edit_profile_details_route(
    payload: UpdatePersonalDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdatePersonalDetailsResponse:
    try:
        await update_personal_details(payload.values)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    return UpdatePersonalDetailsResponse(message="profile details updated successfully")

# Admin module: endpoints restricted to users with role "admin" (bypassed
# entirely when settings.auth_enabled is False, matching get_current_user).
from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user
from app.core.security import hash_password
from app.models import (
    CustomerDetails,
    CustomerIdCounter,
    CustomerPocDetails,
    CustomerPocIdCounter,
    User,
    UserIdCounter,
    UserRole,
)
from app.schemas.admin import (
    AddCustomerDetailsRequest,
    AddCustomerDetailsResponse,
    CustomerDetailItem,
)
from app.services.counters import get_next_id

router = APIRouter(prefix="/admin", tags=["admin"])


async def require_admin(current_user: User | None = Depends(get_current_user)) -> User | None:
    if current_user is not None and current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin access required")
    return current_user


@router.post("/add_customer_details", response_model=AddCustomerDetailsResponse)
async def add_customer_details(
    payload: AddCustomerDetailsRequest,
    _: User | None = Depends(require_admin),
) -> AddCustomerDetailsResponse:
    existing = await User.find_one(User.mail == payload.mail)
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already exists")

    user_id = await get_next_id(UserIdCounter, "next_user_id", User)
    user = User(id=user_id, mail=payload.mail, password=hash_password(payload.password), role=UserRole.customer)
    await user.insert()

    customer_id = await get_next_id(CustomerIdCounter, "next_customer_id", CustomerDetails)
    customer = CustomerDetails(
        id=customer_id,
        user_id=user_id,
        registered_name=payload.registered_name,
        company_or_department=payload.company_or_department,
        address=payload.address,
        company_gst=payload.company_gst,
        points=payload.points,
        is_deleted=payload.is_deleted,
    )
    await customer.insert()

    for contact_name, contact_phone in zip(payload.contact_name, payload.contact_phone):
        poc_id = await get_next_id(CustomerPocIdCounter, "next_customer_poc_id", CustomerPocDetails)
        poc = CustomerPocDetails(id=poc_id, customer_id=customer_id, contact_name=contact_name, contact_phone=contact_phone)
        await poc.insert()

    return AddCustomerDetailsResponse(message="customer added successfully")


@router.get("/get_customer_details", response_model=list[CustomerDetailItem])
async def get_customer_details(
    _: User | None = Depends(require_admin),
) -> list[CustomerDetailItem]:
    customers = await CustomerDetails.find_all().to_list()
    if not customers:
        return []

    user_ids = [customer.user_id for customer in customers]
    customer_ids = [customer.id for customer in customers]

    users = await User.find(In(User.id, user_ids)).to_list()
    users_by_id = {user.id: user for user in users}

    pocs = await CustomerPocDetails.find(In(CustomerPocDetails.customer_id, customer_ids)).to_list()
    pocs_by_customer_id: dict[int, list[CustomerPocDetails]] = {}
    for poc in pocs:
        pocs_by_customer_id.setdefault(poc.customer_id, []).append(poc)

    response = []
    for customer in customers:
        user = users_by_id.get(customer.user_id)
        if user is None:
            continue
        customer_pocs = pocs_by_customer_id.get(customer.id, [])
        response.append(
            CustomerDetailItem(
                mail=user.mail,
                password=user.password,
                registered_name=customer.registered_name,
                company_or_department=customer.company_or_department,
                address=customer.address,
                company_gst=customer.company_gst,
                points=customer.points,
                is_deleted=customer.is_deleted,
                contact_name=[poc.contact_name for poc in customer_pocs],
                contact_phone=[poc.contact_phone for poc in customer_pocs],
            )
        )

    return response

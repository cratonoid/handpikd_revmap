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
    CustomerListItem,
    UpdateCustomerDetailsRequest,
    UpdateCustomerDetailsResponse,
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

    return AddCustomerDetailsResponse(message="customer details added successfully")


@router.get("/get_customer_list", response_model=list[CustomerListItem])
async def get_customer_list(
    _: User | None = Depends(require_admin),
) -> list[CustomerListItem]:
    # Lightweight id+name list for customer-picker dropdowns (the sales order
    # popup) — unlike get_vendors_list, this returns every customer, active
    # and deleted, since CustomerDetailItem has no numeric id at all and this
    # is the only place the frontend can resolve a sales order's cust_id back
    # to a name (including for orders placed against a since-deleted customer).
    customers = await CustomerDetails.find_all().to_list()
    return [
        CustomerListItem(customer_id=customer.id, customer_name=customer.registered_name, is_deleted=customer.is_deleted)
        for customer in customers
    ]


async def _get_customer_detail_by_mail(mail: str) -> CustomerDetailItem:
    # Joins all three tables for a single customer: User (login/password),
    # CustomerDetails (profile), CustomerPocDetails (contacts) — keyed by
    # email since that's the only stable identifier the frontend has (there's
    # no customer id exposed to it).
    user = await User.find_one(User.mail == mail)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="customer not found")

    customer = await CustomerDetails.find_one(CustomerDetails.user_id == user.id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="customer not found")

    pocs = await CustomerPocDetails.find(CustomerPocDetails.customer_id == customer.id).to_list()

    return CustomerDetailItem(
        mail=user.mail,
        password=user.password,
        registered_name=customer.registered_name,
        company_or_department=customer.company_or_department,
        address=customer.address,
        company_gst=customer.company_gst,
        points=customer.points,
        is_deleted=customer.is_deleted,
        contact_name=[poc.contact_name for poc in pocs],
        contact_phone=[poc.contact_phone for poc in pocs],
    )


@router.get("/get_customer_details", response_model=list[CustomerDetailItem] | CustomerDetailItem)
async def get_customer_details(
    mail: str | None = None,
    _: User | None = Depends(require_admin),
) -> list[CustomerDetailItem] | CustomerDetailItem:
    # ?mail=... looks up a single customer (404 if not found); omitted, this
    # keeps returning every customer, as the /admin/clients table relies on.
    if mail is not None:
        return await _get_customer_detail_by_mail(mail)

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


@router.post("/update_customer_details", response_model=UpdateCustomerDetailsResponse)
async def update_customer_details(
    payload: UpdateCustomerDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdateCustomerDetailsResponse:
    user = await User.find_one(User.mail == payload.mail)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="customer not found")

    customer = await CustomerDetails.find_one(CustomerDetails.user_id == user.id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="customer not found")

    # A rename is only allowed onto an address no one else holds. mail is the
    # customer's login AND the only handle the admin UI has on them (see
    # _get_customer_detail_by_mail above), so letting two users share one
    # would make both unreachable — the same 409 add_customer_details raises.
    # A blank new_mail, or one equal to the current address, means "leave the
    # email alone" and skips the check entirely.
    new_mail = payload.new_mail.strip()
    renaming = bool(new_mail) and new_mail != user.mail
    if renaming:
        clash = await User.find_one(User.mail == new_mail)
        if clash is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already exists")
        user.mail = new_mail

    if payload.password:
        user.password = hash_password(payload.password)

    if renaming or payload.password:
        await user.save()

    customer.registered_name = payload.registered_name
    customer.company_or_department = payload.company_or_department
    customer.address = payload.address
    customer.company_gst = payload.company_gst
    customer.points = payload.points
    customer.is_deleted = payload.is_deleted
    await customer.save()

    await CustomerPocDetails.find(CustomerPocDetails.customer_id == customer.id).delete()
    for contact_name, contact_phone in zip(payload.contact_name, payload.contact_phone):
        poc_id = await get_next_id(CustomerPocIdCounter, "next_customer_poc_id", CustomerPocDetails)
        poc = CustomerPocDetails(id=poc_id, customer_id=customer.id, contact_name=contact_name, contact_phone=contact_phone)
        await poc.insert()

    return UpdateCustomerDetailsResponse(message="customer updated successfully")

# Inquiry form module: admin-managed, unlimited-depth selection hierarchy
# (category -> item -> brand option -> ...) for the /hamper-inquiry-form
# visitor page, plus admin endpoints to view submitted inquiries. `router`
# (hierarchy editing + viewing submissions) is restricted to admins (bypassed
# entirely when settings.auth_enabled is False, matching require_admin in
# routes/admin.py); `public_router` (get_public_nodes, submit) is
# intentionally unauthenticated so a visitor can load and submit the form
# without logging in - same split as catalogues.router/public_router.
from collections import defaultdict
from datetime import datetime, timezone

from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.routes.admin import require_admin
from app.models import (
    InquiryFormNode,
    InquiryFormNodeIdCounter,
    InquiryFormSubmission,
    InquiryFormSubmissionIdCounter,
    SelectedInquiryFormNode,
    User,
)
from app.schemas.inquiry_form import (
    AddInquiryFormNodeRequest,
    AddInquiryFormNodeResponse,
    InquiryFormNodeItem,
    InquiryFormSubmissionItem,
    SelectedNodeItem,
    SubmitInquiryFormRequest,
    SubmitInquiryFormResponse,
    UpdateInquiryFormNodeRequest,
    UpdateInquiryFormNodeResponse,
)
from app.services.counters import get_next_id

router = APIRouter(prefix="/admin/inquiry-form", tags=["inquiry-form"])

# Public/unauthenticated endpoints for the /hamper-inquiry-form storefront
# page - unlike the rest of this file, nothing here sits behind require_admin.
public_router = APIRouter(prefix="/inquiry-form", tags=["inquiry-form-public"])


def _to_item(node: InquiryFormNode) -> InquiryFormNodeItem:
    return InquiryFormNodeItem(
        id=node.id,
        parent_id=node.parent_id,
        label=node.label,
        min_amount=node.min_amount,
        prompt=node.prompt,
        selection_mode=node.selection_mode,
        max_selections=node.max_selections,
        sort_order=node.sort_order,
        is_active=node.is_active,
    )


@router.get("/get_nodes", response_model=list[InquiryFormNodeItem])
async def get_nodes(_: User | None = Depends(require_admin)) -> list[InquiryFormNodeItem]:
    nodes = await InquiryFormNode.find_all().to_list()
    return [_to_item(node) for node in nodes]


@router.post("/add_node", response_model=AddInquiryFormNodeResponse)
async def add_node(
    payload: AddInquiryFormNodeRequest,
    _: User | None = Depends(require_admin),
) -> AddInquiryFormNodeResponse:
    if not payload.label.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="label is required")
    if payload.min_amount is not None and payload.min_amount < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="minimum amount cannot be negative")

    if payload.parent_id is not None:
        parent = await InquiryFormNode.get(payload.parent_id)
        if parent is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="parent option not found")

    node_id = await get_next_id(InquiryFormNodeIdCounter, "next_inquiry_form_node_id", InquiryFormNode)
    node = InquiryFormNode(
        id=node_id,
        parent_id=payload.parent_id,
        label=payload.label,
        min_amount=payload.min_amount,
        prompt=payload.prompt,
        selection_mode=payload.selection_mode,
        max_selections=payload.max_selections,
        sort_order=payload.sort_order,
        is_active=True,
    )
    await node.insert()

    return AddInquiryFormNodeResponse(message="option added successfully")


@router.post("/update_node", response_model=UpdateInquiryFormNodeResponse)
async def update_node(
    payload: UpdateInquiryFormNodeRequest,
    _: User | None = Depends(require_admin),
) -> UpdateInquiryFormNodeResponse:
    node = await InquiryFormNode.get(payload.node_id)
    if node is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="option not found")

    if payload.delete:
        child = await InquiryFormNode.find_one(InquiryFormNode.parent_id == node.id)
        if child is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="option has sub-options")
        await node.delete()
        return UpdateInquiryFormNodeResponse(message="option deleted successfully")

    if not payload.label.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="label is required")
    if payload.min_amount is not None and payload.min_amount < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="minimum amount cannot be negative")

    node.label = payload.label
    node.min_amount = payload.min_amount
    node.prompt = payload.prompt
    node.selection_mode = payload.selection_mode
    node.max_selections = payload.max_selections
    node.sort_order = payload.sort_order
    node.is_active = payload.is_active
    await node.save()

    return UpdateInquiryFormNodeResponse(message="option updated successfully")


@router.get("/get_submissions", response_model=list[InquiryFormSubmissionItem])
async def get_submissions(_: User | None = Depends(require_admin)) -> list[InquiryFormSubmissionItem]:
    submissions = await InquiryFormSubmission.find_all().sort(-InquiryFormSubmission.id).to_list()
    return [
        InquiryFormSubmissionItem(
            id=submission.id,
            firm_name=submission.firm_name,
            occasion=submission.occasion,
            item_quantity=submission.item_quantity,
            budget_per_item=submission.budget_per_item,
            created_at=submission.created_at,
            total_min_amount=submission.total_min_amount,
            selections=[
                SelectedNodeItem(
                    node_id=sel.node_id, parent_id=sel.parent_id, label=sel.label, min_amount=sel.min_amount
                )
                for sel in submission.selections
            ],
        )
        for submission in submissions
    ]


@public_router.get("/get_nodes", response_model=list[InquiryFormNodeItem])
async def get_public_nodes() -> list[InquiryFormNodeItem]:
    # Only active nodes are offered to visitors; admin's get_nodes above
    # returns everything (including inactive) so those can still be found and
    # re-activated.
    nodes = await InquiryFormNode.find(InquiryFormNode.is_active == True).to_list()  # noqa: E712
    return [_to_item(node) for node in nodes]


@public_router.post("/submit", response_model=SubmitInquiryFormResponse)
async def submit_inquiry_form(payload: SubmitInquiryFormRequest) -> SubmitInquiryFormResponse:
    if not payload.firm_name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="firm name is required")
    if not payload.occasion.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="occasion is required")
    if payload.item_quantity <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="item quantity must be positive")
    if payload.budget_per_item <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="budget per item must be positive")

    unique_ids = list(dict.fromkeys(payload.selected_node_ids))
    nodes = await InquiryFormNode.find(In(InquiryFormNode.id, unique_ids)).to_list() if unique_ids else []
    nodes_by_id = {node.id: node for node in nodes}

    missing = [node_id for node_id in unique_ids if node_id not in nodes_by_id]
    if missing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="one or more selected options were not found")

    # Re-check each parent's selection_mode/max_selections against what was
    # actually submitted, rather than trusting the frontend's own enforcement
    # of the same rules.
    children_by_parent: dict[int, list[InquiryFormNode]] = defaultdict(list)
    for node in nodes:
        if node.parent_id is not None:
            children_by_parent[node.parent_id].append(node)

    if children_by_parent:
        parents = await InquiryFormNode.find(In(InquiryFormNode.id, list(children_by_parent.keys()))).to_list()
        parents_by_id = {parent.id: parent for parent in parents}
        for parent_id, siblings in children_by_parent.items():
            parent = parents_by_id.get(parent_id)
            if parent is None:
                continue
            if parent.selection_mode == "single" and len(siblings) > 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f'"{parent.label}" only allows a single selection',
                )
            if parent.max_selections is not None and len(siblings) > parent.max_selections:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f'"{parent.label}" allows at most {parent.max_selections} selections',
                )

    submission_id = await get_next_id(
        InquiryFormSubmissionIdCounter, "next_inquiry_form_submission_id", InquiryFormSubmission
    )
    submission = InquiryFormSubmission(
        id=submission_id,
        firm_name=payload.firm_name,
        occasion=payload.occasion,
        item_quantity=payload.item_quantity,
        budget_per_item=payload.budget_per_item,
        selections=[
            SelectedInquiryFormNode(
                node_id=node.id, parent_id=node.parent_id, label=node.label, min_amount=node.min_amount
            )
            for node in nodes
        ],
        # Recomputed here from the stored nodes rather than taken from the
        # request, so the saved total always matches the live configuration.
        total_min_amount=sum(node.min_amount or 0 for node in nodes),
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    await submission.insert()

    return SubmitInquiryFormResponse(message="inquiry submitted successfully")

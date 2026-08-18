# Covers the rules in services/gst.py that decide a document's GST heads:
# which state a party resolves to, and how that turns into IGST vs CGST+SGST.
# The cases worth pinning down are the ones the GSTIN-only version of this
# code got wrong — a party with a state but no GSTIN, and a stored state that
# disagrees with the GSTIN on file.
import pytest

from app.api.routes.invoices import _TaxContext
from app.services.personal_details import _resolve_state_in
from app.services.gst import (
    TaxKind,
    is_intra_state,
    normalise_state_code,
    place_of_supply_text,
    resolve_party_state,
    resolve_state_code,
    split_tax,
    state_code_from_gstin,
    tax_kind_for,
)

_OURS = "08"  # Rajasthan — the profile's seeded state.


def test_a_state_code_is_normalised_from_the_shapes_a_form_can_produce():
    assert normalise_state_code("8") == "08"
    assert normalise_state_code(" 27 ") == "27"
    assert normalise_state_code("08DINPA7100K1ZA") == "08"


def test_an_unassigned_state_code_is_rejected_rather_than_passed_through():
    # 25 and 28 were merged away/reassigned and are not valid codes; a typo
    # here would otherwise silently decide an invoice's tax heads.
    assert normalise_state_code("25") is None
    assert normalise_state_code("99") is None
    assert normalise_state_code("") is None
    assert normalise_state_code(None) is None


def test_a_gstin_supplies_the_state_when_none_is_stored():
    assert resolve_state_code("", "27AAAPA1234A1Z5") == "27"
    assert state_code_from_gstin("27AAAPA1234A1Z5") == "27"


def test_a_stored_state_beats_the_gstin_on_file():
    # The field is editable precisely so a wrong or missing GSTIN can be
    # corrected without waiting for the vendor to send a new one.
    assert resolve_state_code("29", "27AAAPA1234A1Z5") == "29"


def test_a_party_with_no_gstin_at_all_still_resolves_to_their_state():
    assert resolve_state_code("08", "") == "08"
    assert resolve_state_code("", "") is None


def test_a_same_state_supply_to_an_unregistered_party_is_cgst_sgst():
    # The behaviour this whole field exists for: before it, a blank GSTIN
    # meant "can't confirm intra-state" and went out as IGST.
    assert tax_kind_for(resolve_state_code("08", ""), _OURS) == TaxKind.cgst_sgst


def test_a_different_state_is_igst():
    assert tax_kind_for("27", _OURS) == TaxKind.igst
    assert is_intra_state("27", _OURS) is False


def test_a_party_whose_state_cannot_be_established_falls_back_to_igst():
    assert tax_kind_for(None, _OURS) == TaxKind.igst


def test_intra_state_tax_is_split_half_and_half():
    split = split_tax(18.0, 180.0, TaxKind.cgst_sgst)
    assert (split.cgst_perc, split.sgst_perc) == (9.0, 9.0)
    assert (split.cgst_amount, split.sgst_amount) == (90.0, 90.0)
    assert split.igst_amount == 0.0


def test_inter_state_tax_all_lands_on_igst():
    split = split_tax(18.0, 180.0, TaxKind.igst)
    assert (split.igst_perc, split.igst_amount) == (18.0, 180.0)
    assert (split.cgst_amount, split.sgst_amount) == (0.0, 0.0)


def test_the_heads_always_add_back_to_the_tax_they_were_split_from():
    for kind in (TaxKind.igst, TaxKind.cgst_sgst):
        split = split_tax(18.0, 12345.67, kind)
        assert split.igst_amount + split.cgst_amount + split.sgst_amount == pytest.approx(12345.67)


def test_resolve_party_state_derives_the_name_rather_than_trusting_one():
    assert resolve_party_state("27", "") == ("27", "Maharashtra")
    assert resolve_party_state("", "08DINPA7100K1ZA") == ("08", "Rajasthan")
    assert resolve_party_state("", "") == ("", "")


def test_resolve_party_state_rejects_a_state_the_admin_typed_wrong():
    with pytest.raises(ValueError):
        resolve_party_state("99", "08DINPA7100K1ZA")


def test_place_of_supply_reads_as_name_and_code():
    assert place_of_supply_text("08") == "Rajasthan ( 08 )"
    assert place_of_supply_text("") == "-"


# ---------------------------------------------------------------------------
# The profile's own state — services/personal_details.py's partial-update rule
# ---------------------------------------------------------------------------
def test_saving_a_gstin_alone_fills_the_profiles_state_in():
    assert _resolve_state_in({"gstin": "27AAAPA1234A1Z5"}) == {
        "gstin": "27AAAPA1234A1Z5",
        "state_code": "27",
        "state_name": "Maharashtra",
    }


def test_an_explicitly_chosen_profile_state_survives_a_conflicting_gstin():
    values = _resolve_state_in({"gstin": "27AAAPA1234A1Z5", "state_code": "29"})
    assert (values["state_code"], values["state_name"]) == ("29", "Karnataka")


def test_a_gstin_only_update_leaves_an_unparseable_state_alone():
    # Nothing to derive and no state in the payload: don't blank whatever the
    # admin already set.
    assert _resolve_state_in({"gstin": ""}) == {"gstin": ""}


def test_an_update_touching_neither_field_is_passed_through_untouched():
    values = {"phone": "7411690399"}
    assert _resolve_state_in(values) is values


def test_a_profile_state_that_isnt_a_real_code_is_rejected():
    with pytest.raises(ValueError):
        _resolve_state_in({"state_code": "99"})


# ---------------------------------------------------------------------------
# Freezing the split onto an invoice — routes/invoices.py's _TaxContext
# ---------------------------------------------------------------------------
def test_an_intra_state_invoices_tax_is_frozen_half_to_cgst_and_half_to_sgst():
    context = _TaxContext(kind=TaxKind.cgst_sgst, place_of_supply_code="08", place_of_supply_name="Rajasthan")
    assert context.totals(1800.0) == (0.0, 900.0, 900.0)


def test_an_inter_state_invoices_tax_is_frozen_entirely_to_igst():
    context = _TaxContext(kind=TaxKind.igst, place_of_supply_code="27", place_of_supply_name="Maharashtra")
    assert context.totals(1800.0) == (1800.0, 0.0, 0.0)


def test_the_frozen_heads_always_add_back_to_the_invoices_tax_total():
    # What the accounts tax tab totals per head has to reconcile with what
    # each invoice says it charged.
    for kind in (TaxKind.igst, TaxKind.cgst_sgst):
        igst, cgst, sgst = _TaxContext(kind=kind, place_of_supply_code="", place_of_supply_name="").totals(987.65)
        assert igst + cgst + sgst == pytest.approx(987.65)

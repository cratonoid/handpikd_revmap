# Unit tests for the Sent / Unsent rule in app/services/campaign_leads.py: a
# lead is Sent in a campaign once every "Data present" channel is ticked in
# its Sent status. Pure, so no Mongo connection is needed.
from app.models import CampaignLead, CampaignLeadStatus, OutreachChannel
from app.services.campaign_leads import apply_rule, fully_sent

WA = OutreachChannel.whatsapp
MAIL = OutreachChannel.mail


def _row(*sent: OutreachChannel, status: CampaignLeadStatus = CampaignLeadStatus.unsent) -> CampaignLead:
    return CampaignLead.model_construct(id=1, campaign_id=1, contact_id=1, status=status, sent_channels=list(sent))


def test_every_data_present_channel_ticked_is_fully_sent():
    assert fully_sent([WA, MAIL], [MAIL, WA])
    assert fully_sent([MAIL], [MAIL])


def test_a_data_present_channel_left_unticked_is_not():
    assert not fully_sent([WA, MAIL], [MAIL])


def test_extra_ticks_beyond_data_present_still_count():
    assert fully_sent([MAIL], [WA, MAIL])


def test_no_data_present_is_never_fully_sent():
    assert not fully_sent([], [WA, MAIL])
    assert not fully_sent(None, [MAIL])


def test_apply_rule_turns_sent_and_back():
    row = _row(MAIL)
    apply_rule(row, [MAIL])
    assert row.status == CampaignLeadStatus.sent

    row.sent_channels = []
    apply_rule(row, [MAIL])
    assert row.status == CampaignLeadStatus.unsent


def test_apply_rule_unsends_when_data_present_grows():
    row = _row(MAIL, status=CampaignLeadStatus.sent)
    apply_rule(row, [WA, MAIL])
    assert row.status == CampaignLeadStatus.unsent

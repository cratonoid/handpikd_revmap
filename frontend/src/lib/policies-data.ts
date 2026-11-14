// ---------------------------------------------------------------------------
// Policy pages content
// ---------------------------------------------------------------------------
// Source of truth for the four public policy pages served by
// src/app/policies/[slug]/page.tsx and linked from the footer. The wording
// is transcribed from the client-supplied PDFs (Delivery and Return, Order,
// Privacy, Sample). To change a policy, edit its text here; the page, the
// footer links and the sitemap all read from this list.

import { siteConfig } from "@/lib/brand";

// A section body is a sequence of blocks so one section can mix a lead-in
// paragraph, bullets, numbered steps and a worked example, as the PDFs do.
export type PolicyBlock =
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "steps"; items: string[] }
  | { type: "example"; text: string }
  | { type: "note"; text: string };

export type PolicySection = {
  heading: string;
  blocks: PolicyBlock[];
};

export type Policy = {
  slug: string;
  title: string;
  // Shorter label for the footer link.
  shortTitle: string;
  // Used for the <meta name="description"> tag.
  description: string;
  effectiveDate?: string;
  intro: string;
  sections: PolicySection[];
};

export const policies: Policy[] = [
  {
    slug: "order-policy",
    title: "Order Policy",
    shortTitle: "Order Policy",
    description:
      "Payment terms for confirmed Handpikd orders, plus the milestone and time-period options available for larger or recurring orders.",
    intro:
      "This policy sets out the payment terms for confirmed orders, along with the milestone and time-period options available for larger or recurring orders.",
    sections: [
      {
        heading: "Advance Payment",
        blocks: [
          {
            type: "bullets",
            items: [
              "Once an order is confirmed, an advance payment of 50% of the total order value is required before processing can begin.",
              "Product availability is subject to stock at the time the advance payment is received. Items confirmed at the time of quotation may change if payment is delayed.",
            ],
          },
        ],
      },
      {
        heading: "Milestone Payment and Delivery Option",
        blocks: [
          {
            type: "bullets",
            items: [
              "For large-volume orders of high-value hampers (for example, more than 1,000 hampers priced at ₹5,000 to ₹7,000 each), clients may opt for payment and delivery in milestones.",
              "Under this option, the order is divided into batches. For each batch:",
            ],
          },
          {
            type: "steps",
            items: [
              "The client pays a 50% advance for that batch.",
              "Handpikd delivers the batch.",
              "The client pays the balance amount for the delivered batch.",
            ],
          },
          {
            type: "bullets",
            items: ["This process is repeated for each batch until the full order is completed."],
          },
          {
            type: "example",
            text: "For an order of 2,000 hampers processed in batches of 500, the client pays a 50% advance for the first 500 hampers. Once those are delivered, the client pays the balance for them. The same cycle is then followed for the next 500, until all 2,000 hampers have been delivered.",
          },
        ],
      },
      {
        heading: "Time-Period Based Orders",
        blocks: [
          {
            type: "bullets",
            items: [
              "For recurring requirements, such as employee joining kits, clients may enter into a Memorandum of Understanding (MOU) with Handpikd for a period of 3, 6, 9 or 12 months, with a fixed order quantity.",
              "An advance payment of 50% of the total MOU value is payable when the MOU is signed.",
              "The remaining 50% is payable once half of the MOU period has been completed.",
            ],
          },
          {
            type: "example",
            text: "For a 12-month MOU, 50% is paid when the MOU is signed and the remaining 50% is paid at the end of the sixth month.",
          },
        ],
      },
      {
        heading: "Delivery Charges",
        blocks: [
          {
            type: "paragraph",
            text: "Delivery charges are not included in the order value and will be billed separately, based on the rates of the third-party delivery service used.",
          },
        ],
      },
    ],
  },
  {
    slug: "delivery-and-return-policy",
    title: "Delivery and Return Policy",
    shortTitle: "Delivery & Returns",
    description:
      "How to inspect Handpikd deliveries, report damaged or defective items, and when replacements are provided.",
    intro:
      "This policy sets out the client's responsibilities on receiving goods, the process for reporting damaged or defective items, and the terms under which replacements are provided.",
    sections: [
      {
        heading: "Inspection on Delivery",
        blocks: [
          {
            type: "bullets",
            items: [
              "Deliveries to the client's premises: Goods must be inspected at the time of delivery, in the presence of the delivery personnel.",
              "Individual deliveries (including courier deliveries to individual recipients): Any issue must be reported no later than the same day of delivery.",
              "Any faults or damage reported after these timelines will not be accepted or considered.",
            ],
          },
        ],
      },
      {
        heading: "Reporting an Issue",
        blocks: [
          {
            type: "bullets",
            items: [
              "All issues must be reported by raising a ticket on the Handpikd website.",
              "The ticket should include the order details and clear photographs of the defect or damage, to help us resolve it promptly.",
            ],
          },
        ],
      },
      {
        heading: "Manufacturing Defects and Transit Damage",
        blocks: [
          {
            type: "bullets",
            items: [
              "Items found to have manufacturing defects or damage caused during transit are eligible for replacement.",
              "The Handpikd team will coordinate the replacement of such items with the client.",
              "All delivery charges for replacement items will be borne by Handpikd.",
            ],
          },
        ],
      },
      {
        heading: "Returns",
        blocks: [
          {
            type: "paragraph",
            text: "Goods are not eligible for return or refund, except in cases of manufacturing defects or transit damage as stated above.",
          },
        ],
      },
    ],
  },
  {
    slug: "sample-policy",
    title: "Sample Policy",
    shortTitle: "Sample Policy",
    description:
      "How Handpikd clients can get product samples before placing a full order: custom samples and reference samples.",
    intro:
      "This policy explains how clients can get product samples before placing a full order. Clients can choose one of the following two options.",
    sections: [
      {
        heading: "Option 1: Custom Sample (with Purchase Option)",
        blocks: [
          {
            type: "bullets",
            items: [
              "A custom sample is charged at twice the quoted price per item.",
              "The balance amount will be credited against your full order when you place it with us.",
              "Custom samples are supplied without your brand logo.",
            ],
          },
        ],
      },
      {
        heading: "Option 2: Reference Sample (without Purchase Option)",
        blocks: [
          {
            type: "bullets",
            items: [
              "Clients may request a reference sample that carries a representative logo from another brand to show our product quality and finish.",
              "No material charges apply to reference samples.",
            ],
          },
          {
            type: "note",
            text: "For both options, delivery charges for one-way shipping are borne by the client.",
          },
        ],
      },
    ],
  },
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    shortTitle: "Privacy Policy",
    description:
      "How Handpikd collects, uses and safeguards personal data, in accordance with the Digital Personal Data Protection Act, 2023.",
    effectiveDate: "2 April 2026",
    intro:
      "At Handpikd, we respect your privacy and are committed to protecting the personal data entrusted to us. This policy explains how we collect, use and safeguard that data, in accordance with the Digital Personal Data Protection Act, 2023 and the rules made under it.",
    sections: [
      {
        heading: "1. Information We Collect",
        blocks: [
          {
            type: "paragraph",
            text: "We collect the contact and business details of our clients, such as name, company, email address, phone number, billing address and GST details. When clients place an order, they may also share the details of their gift recipients, including names, delivery addresses, phone numbers and any personalisation details required for the order. We may also collect information submitted through support tickets on our website, along with basic browsing data gathered through cookies.",
          },
        ],
      },
      {
        heading: "2. How We Use Your Information",
        blocks: [
          {
            type: "paragraph",
            text: "The information we collect is used to process orders, personalise products, deliver gifts, resolve service requests and manage payments. We may also use it to communicate with clients about their orders and to meet our legal and tax obligations. We do not sell, rent or share personal data for marketing purposes.",
          },
        ],
      },
      {
        heading: "3. Recipient Information",
        blocks: [
          {
            type: "paragraph",
            text: "Recipient information shared by our clients is used solely to fulfil their orders. Clients are responsible for ensuring that they have the necessary right or consent to share this information with us.",
          },
        ],
      },
      {
        heading: "4. Sharing of Information",
        blocks: [
          {
            type: "paragraph",
            text: "We share personal data only where necessary to deliver our services, with trusted delivery partners, production partners, and payment service providers. We may also disclose information to government or legal authorities where required by law. All parties we work with are expected to keep this information confidential.",
          },
        ],
      },
      {
        heading: "5. Data Security",
        blocks: [
          {
            type: "paragraph",
            text: "We take reasonable measures to protect personal data from unauthorised access, misuse or loss. Access is limited to authorised team members, and data is stored on secure systems. In the unlikely event of a data breach, we will notify affected parties and the relevant authorities as required by law.",
          },
        ],
      },
      {
        heading: "6. Data Retention",
        blocks: [
          {
            type: "paragraph",
            text: "We retain personal data only for as long as it is needed to complete orders, provide support and meet legal requirements. Once it is no longer required, it is securely deleted.",
          },
        ],
      },
      {
        heading: "7. Your Rights",
        blocks: [
          {
            type: "paragraph",
            text: "You may request access to, correction of or deletion of your personal data, or withdraw your consent, at any time by contacting us using the details below.",
          },
        ],
      },
      {
        heading: "8. Changes to This Policy",
        blocks: [
          {
            type: "paragraph",
            text: "We may update this policy from time to time. The latest version will always be available on our website.",
          },
        ],
      },
      {
        heading: "9. Contact Us",
        blocks: [
          {
            type: "paragraph",
            text: "If you have any questions or concerns about this policy or how your data is handled, please contact our Grievance Officer:",
          },
          {
            // The PDF leaves the Grievance Officer's name, email and phone
            // as placeholders. Until they're supplied, point people at the
            // company's general contact details from brand.ts. Add a
            // "Name: ..." line here once the officer is named.
            type: "bullets",
            items: [
              `Email: ${siteConfig.contact.email}`,
              `Phone: ${siteConfig.contact.phone}`,
            ],
          },
        ],
      },
    ],
  },
];

export function getPolicy(slug: string): Policy | undefined {
  return policies.find((p) => p.slug === slug);
}

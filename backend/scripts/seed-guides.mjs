/* Loads (or reloads) the in-app help widget's content into the ol-portal
   DynamoDB table. One GUIDE record per portal page, pk="GUIDE" sk=<pageKey>;
   backend/src/guides.mjs serves them back through GET /guides, filtered to
   whatever the requesting role is allowed to read.

   Safe to re-run any time this file's copy changes: PutItem overwrites by
   key, so nothing is duplicated.

   Usage: AWS_PROFILE=ol-portal node scripts/seed-guides.mjs [--dry-run]
   Always pass AWS_PROFILE=ol-portal explicitly. This table lives in OL's own
   AWS account, a different account than whatever your shell's default
   profile points at. */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = "ol-portal";
const DRY_RUN = process.argv.includes("--dry-run");

// `roles` omitted means every role that can reach the page at all. Order
// matches the sidebar (dashboard, then Sales / Operations / Learning /
// Administration) so the widget's own ordering has no separate source.
const GUIDES = [
  {
    page: "dashboard",
    order: 0,
    title: "Dashboard",
    summary: "Your personal snapshot of pipeline health, invoices, and recent activity.",
    sections: [
      {
        heading: "What you're looking at",
        body: "The four cards across the top total your open deals, the dollar value of everything still in your pipeline, what's closed and won, and how many invoice requests are waiting on review. Below that, a bar chart shows deals by stage, a donut chart splits open pipeline value by lab, and two lists surface your five most recent deals and five most recently uploaded files."
      },
      {
        heading: "Everything here is read only",
        body: "There's nothing to click and edit on this page. Click a recent deal to open it on the Pipeline page, or a recent file to open it on the Files page."
      },
      {
        heading: "For Contributors",
        roles: ["Contributor"],
        body: "Your cards and charts will read empty. Contributors don't have deals or invoices assigned to them directly, so the dashboard has nothing to summarize yet. Try the Bench Directory or Resource Library instead."
      }
    ]
  },
  {
    page: "pipeline",
    order: 1,
    title: "Pipeline",
    summary: "The deal board: create, move, and close deals across every stage.",
    sections: [
      {
        heading: "How the board works",
        body: "Each column is a stage: Lead, Discovery, Proposal Sent, Negotiating, and Closed. Drag a card to a new column to move it forward or back. Use the search box and the Lab and Owner filters above the board to narrow what you see."
      },
      {
        heading: "Adding and editing a deal",
        body: "Click + New Deal to open a blank deal, or click any card to edit it: client, lab, stage, amount, expected close date, source, owner, deal owner, and whether it recurs monthly."
      },
      {
        heading: "Closing a deal isn't a drag",
        body: "You can't just drag a card into Closed. Dropping it there opens a required Assignment Notice first: pick Won or Lost, name which Lab Leader(s) did the work and their fee split (has to add up to 100%), and log subcontractor and hard costs. Once that's saved, each named Lab Leader, and an Admin for Optimistic Labs' own line, signs it by typing their name in the deal dialog."
      },
      {
        heading: "Owner vs. deal owner",
        body: "These are two separate fields that look similar. Owner is who leads the deal internally; deal owner can be a different person credited with sourcing it. Both have to be a Lab Leader or Admin."
      },
      {
        heading: "For Lab Leaders",
        roles: ["Lab Leader"],
        body: "You can add deals to any lab you lead, and edit a deal if you lead its lab or if you're the named owner, even outside your own labs. Deleting a deal and reassigning it to a different lab are Admin only."
      },
      {
        heading: "For Contributors",
        roles: ["Contributor"],
        body: "This board will always be empty for you. Deals aren't shared with Contributors; you'll see your own work on the Contracts and Proposals pages instead."
      }
    ]
  },
  {
    page: "proposals",
    order: 2,
    title: "Proposals",
    summary: "Track every proposal's status and read what each one says.",
    sections: [
      {
        heading: "What this page shows",
        body: "A table of every proposal you can see: title, client, lab, status, which Contributor (if any) it's been shared with, and when it last updated. Click a title to read its six sections."
      },
      {
        heading: "Sharing with a Contributor",
        body: "Click the Contributor column on a row to open the Share dialog and type in a name and email. That's what makes the proposal visible, read only, to that person. Nothing is shared until you do this."
      },
      {
        heading: "The six sections",
        body: "Every proposal is built from the same six parts: client and problem summary, scope, deliverables, timeline, pricing, and terms."
      },
      {
        heading: "Writing and sending",
        body: "There is currently no way to create, edit or send a proposal from inside the Portal. The drafting tool that used to do this was retired when The Optimist became a general assistant, and a replacement has not been built yet. The Optimist can draft the wording for you and you can copy it out, but recording it against a proposal, marking it Final and sending it to a client are not available right now. Say so plainly rather than describing steps that no longer exist."
      },
      {
        heading: "For Contributors",
        roles: ["Contributor"],
        body: "You only ever see a proposal once someone shares it with your email, and only as a read only card: title, client, status, and a preview of the six sections. There's no table and nothing to edit here."
      }
    ]
  },
  {
    page: "optimist",
    order: 3,
    roles: ["Admin", "Lab Leader"],
    title: "The Optimist",
    summary: "The assistant for the whole Portal. Ask it anything about your labs and it answers from OL's own records.",
    sections: [
      {
        heading: "How it works",
        body: "Type a question and it answers, the same way any chat assistant does. What makes it different is that it reads the Portal before answering: the pipeline, proposals, the bench, contracts, invoices, the knowledge base and the Resource Library. So \"where does every open deal stand\" or \"who should write a faith-based grant narrative\" get answers grounded in real records, with real names and numbers, rather than generic advice."
      },
      {
        heading: "Getting started",
        body: "The opening screen has five quick starts: draft a funder update, summarize the pipeline, find someone on the bench, prep a kickoff agenda, turn notes into a proposal. Clicking one asks that question immediately. Otherwise just type. Enter sends, Shift and Enter adds a line."
      },
      {
        heading: "Scope",
        body: "The dashed pill in the composer sets which labs it reads. It starts at All labs, meaning everything you personally have access to, and you can narrow it to a single lab so answers ignore the rest. It can only ever narrow what you can already see, never widen it."
      },
      {
        heading: "What it can and cannot do",
        body: "It reads, it does not write. It cannot create a deal, edit a proposal, send anything, or change a record. When something needs doing it will tell you which page to do it on. It only sees what your own role lets you see, so a question about a lab you are not on comes back empty rather than answered."
      },
      {
        heading: "Attachments, copy, retry and new chat",
        body: "Attach a PDF, text file or image with the paperclip and ask about it. Under each answer, Copy puts it on your clipboard, Retry asks the same question again, and Share opens messages so you can pass it to a colleague. New chat in the composer clears the conversation and starts fresh."
      },
      {
        heading: "Check its work",
        body: "It can be wrong, and it says so at the bottom of every conversation. Check anything before it leaves the Portal."
      }
    ]
  },
  {
    page: "deal-flow",
    order: 4,
    roles: ["Admin"],
    title: "Deal Flow",
    summary: "A cross-lab view of every deal's proposal and contract status, and what's blocking it.",
    sections: [
      {
        heading: "What it's for",
        body: "This is a triage view, not an editor: nothing here can be created or changed. Four tiles at the top total live deals, contracts out for signature, signed contracts, and deals that need a nudge. The table lists every deal alongside its proposal's status and version, its contract's status, and a \"Waiting on\" column."
      },
      {
        heading: "\"Waiting on\" and \"needs a nudge\"",
        body: "Both are calculated live from activity, not stored fields. \"Waiting on\" explains the specific next step, for example a signed contract that still needs an Assignment Notice before the deal can close. A deal gets flagged as needing a nudge using conservative rules, like a proposal the client hasn't opened in several days, so treat it as a prompt to check in, not a hard alert."
      },
      {
        heading: "Jumping to the detail",
        body: "Use \"Go to contracts\" or \"Go to pipeline\" on any row to open the underlying deal, proposal, or contract, where you can actually make changes."
      }
    ]
  },
  {
    page: "contracts",
    order: 5,
    title: "Contracts",
    summary: "Generate, edit, send for signature, and countersign every agreement OL executes.",
    sections: [
      {
        heading: "Two kinds of paper",
        body: "The Client Contracts tab covers agreements with customers. The Contributor Agreements tab covers Master Services Agreements (MSAs) and Task Orders with Contributors. An MSA is the overall relationship with a Contributor; a Task Order is one priced engagement issued under an already Signed MSA, and it automatically inherits the MSA's standard terms rather than repeating them."
      },
      {
        heading: "Getting a contract started",
        body: "Any customer-approved proposal with no contract yet shows up in a banner with a Generate Contract button. From there you can edit sections, pricing, payment schedule, signer details, and dates before sending."
      },
      {
        heading: "Sending and signing",
        body: "Click the action button on a row; it changes to match where the contract is (Send for Signature, Countersign, and so on). Signing happens in order: the client signs first through a link, then the named Optimistic Labs signatory countersigns. Any edit after sending invalidates that document and blocks signing, so a contract locks completely once it's out for signature."
      },
      {
        heading: "\"Deviates from proposal\"",
        body: "This badge means the contract's scope or pricing has drifted from what the customer actually approved. Editing one of those fields requires you to explicitly acknowledge the deviation, which is then logged."
      },
      {
        heading: "For Lab Leaders",
        roles: ["Lab Leader"],
        body: "You can edit a contract if you lead its lab or own it, but only an Admin can edit the standard clauses or name a Contributor on it."
      },
      {
        heading: "For Contributors",
        roles: ["Contributor"],
        body: "You'll see a read only \"Your Agreements\" view of documents you're a signed party to. A draft that names you isn't visible until it's fully Signed."
      }
    ]
  },
  {
    page: "invoices",
    order: 6,
    title: "Invoice Requests",
    summary: "Track invoice requests raised from deals, and cross-reference QuickBooks if it's connected.",
    sections: [
      {
        heading: "Where requests come from",
        body: "Invoice requests aren't created here. They're raised from a deal's Request Invoice button on the Pipeline page; this page is for tracking and status only."
      },
      {
        heading: "The three statuses",
        body: "A request moves from Admin Review to Sent to Client to Paid. Overdue is a separate status for anything that's gone stale."
      },
      {
        heading: "Recurring amounts",
        body: "A recurring deal's invoice amount is calculated as the deal's total divided by twelve, one month's worth, at the moment the request is made."
      },
      {
        heading: "For Admins",
        roles: ["Admin"],
        body: "You're the only one who can advance an invoice's status, and the QuickBooks card (connect, view live invoices, disconnect) only appears for you."
      },
      {
        heading: "For Lab Leaders and Contributors",
        roles: ["Lab Leader", "Contributor"],
        body: "You'll only see invoice requests you personally raised, in your own lab. Contributors don't see invoice requests at all."
      }
    ]
  },
  {
    page: "files",
    order: 7,
    title: "Files",
    summary: "Upload documents; each one gets an automatic AI summary.",
    sections: [
      {
        heading: "Uploading",
        body: "Pick a lab, or leave it as \"Everyone\" to share it org-wide, and click + Upload File. The file goes straight to storage, and while it's processing you'll see its status move from Uploading to Analyzing to Analyzed."
      },
      {
        heading: "The AI summary",
        body: "Every upload is automatically read and summarized; there's no need to trigger it yourself. Click a filename to see the full summary and key points. Very large files, unsupported formats, or anything the analyzer declines to read will land as \"Stored\" with no summary rather than failing outright."
      },
      {
        heading: "Who can see what",
        body: "A file with no lab is visible to everyone. A file tagged to a lab is visible to Admins and to Lab Leaders in that lab. Anyone can see a file they personally uploaded. You can delete a file if you uploaded it, or if you're an Admin."
      },
      {
        heading: "For Contributors",
        roles: ["Contributor"],
        body: "You'll also see files that have been specifically tagged with your email, typically your own signed contract copies."
      }
    ]
  },
  {
    page: "bench",
    order: 8,
    title: "Bench Directory",
    summary: "The org-wide directory of Lab Leaders and Contributors, and what to engage them for.",
    sections: [
      {
        heading: "Finding someone",
        body: "Search by name or specialty, or use the filter chips for a role, a lab, or a specific specialty tag. Every card shows a photo, role and lab(s), a short \"Engage for\" blurb, and specialty tags."
      },
      {
        heading: "Editing a profile",
        body: "Click Edit My Profile to update your own photo, blurb, specialties, and contact details, including whether your email and phone show up on your card. Admins can edit anyone's card using the pencil icon."
      },
      {
        heading: "Contact visibility",
        body: "Your email shows by default; your phone is hidden by default. These are real per-person settings, not just hidden in the display, so nothing you've opted out of showing actually reaches anyone else."
      },
      {
        heading: "Who's listed",
        body: "Every Lab Leader and Contributor appears here automatically; there's no way to opt out of the directory entirely. Admins aren't listed."
      }
    ]
  },
  {
    page: "library",
    order: 9,
    title: "Resource Library",
    summary: "Published files, posts, and videos, the shared content pool Courses are built from.",
    sections: [
      {
        heading: "Browsing",
        body: "Search by title or tag, or filter by type, lab, or tag. Click a card to open it and read, watch, or download it, and to see which course(s) it's part of."
      },
      {
        heading: "For Admins",
        roles: ["Admin"],
        body: "Use + New Resource to upload a file, write a post, or add a video, and the Edit/Delete buttons on any card. You'll also see Draft items and anything marked \"Course only\", which is hidden from this grid for everyone else but still reachable from inside its course."
      },
      {
        heading: "Three settings that look alike but aren't",
        roles: ["Admin"],
        body: "\"Permission\" controls who the item is aimed at: Lab Leaders, Contributors, or both. \"Lab\" optionally restricts it to one lab. \"Visibility\" decides whether it's listed here at all, or only reachable inside a course. They're set independently."
      },
      {
        heading: "For everyone else",
        roles: ["Lab Leader", "Contributor"],
        body: "You're a read only consumer here: you'll see Published items aimed at your role, and at your lab if the item is lab-restricted."
      }
    ]
  },
  {
    page: "courses",
    order: 10,
    title: "Courses",
    summary: "Sequenced learning paths built from Resource Library items, with per-person progress tracking.",
    sections: [
      {
        heading: "Taking a course",
        body: "Click a course card to open the player: a step list on the side (checkmarks show what you've already viewed) and the current step's content in the main pane. Use Previous and Next to move through it."
      },
      {
        heading: "What counts as \"viewed\"",
        body: "A step marks itself viewed automatically once you open a post or file, or watch about 95% of a video. There's nothing to check off by hand."
      },
      {
        heading: "Linear vs. free navigation",
        body: "Some courses unlock steps one at a time as you go (linear); others let you jump anywhere (free). Either way your progress is tracked per step, so if an Admin swaps out what a step points to, that step's progress resets since it's no longer the same content."
      },
      {
        heading: "For Admins",
        roles: ["Admin"],
        body: "Use + New Course to build one from Library items, reorder or replace its steps, and set its audience the same way resources are gated: permission plus an optional lab."
      }
    ]
  },
  {
    page: "templates",
    order: 11,
    roles: ["Admin"],
    title: "Templates",
    summary: "The reusable content Lab Leaders build proposals and contracts from.",
    sections: [
      {
        heading: "The five kinds",
        body: "Contract Terms, MSA Terms, and Task Order Terms are each a numbered list of standard clauses. Proposal Starts are pre-filled section text a Lab Leader can start a new proposal from. Content Blocks are single reusable paragraphs, a scope blurb or a standard timeline, that Lab Leaders can drop into any section while drafting."
      },
      {
        heading: "Placeholders",
        body: "Clause templates use {{placeholder}} tags like {{client}}, {{total}}, and {{paymentSchedule}} that get filled in automatically when a contract is generated. Anything left unresolved stays visible on the live contract and blocks it from being sent for signature until it's filled in."
      },
      {
        heading: "Scoping to a lab",
        body: "Leave Lab blank to make a template OL-wide, the fallback used whenever a specific lab doesn't have its own version. Use the Active checkbox to retire a template without deleting it."
      },
      {
        heading: "Keep at least one Contract Terms template active",
        body: "Without one, new contracts generate with no standard terms and can't be sent for signature. A warning banner appears here if that's ever the case."
      }
    ]
  },
  {
    page: "admin",
    order: 12,
    roles: ["Admin"],
    title: "Admin",
    summary: "Invite and manage accounts, maintain The Optimist's knowledge base, and review the audit log.",
    sections: [
      {
        heading: "Invites & accounts",
        body: "Fill in a name, email, role, and labs, then Send Invite. The person gets a temporary password valid for seven days and is walked through setting a real password and enrolling two-factor authentication the first time they sign in. From the accounts table you can resend or revoke a pending invite, edit someone's email, reset their access, or act as them."
      },
      {
        heading: "\"Reset access\" and \"Act as\"",
        body: "Reset Access deletes and recreates someone's login, because there's no way to detach a lost authenticator device while two-factor is required; their profile and history are untouched. Act As lets you view and use the portal exactly as another, non-Admin, user for troubleshooting. A banner stays on screen the whole time, and everything you do while acting as them is logged under your own name too."
      },
      {
        heading: "The Optimist's knowledge base",
        body: "Entries here (title, lab or org-wide, content) are what The Optimist actually drafts from: pricing frameworks, proposal patterns, tone of voice. Keep client-confidential details out of it. Use Add Entry to write a new one."
      },
      {
        heading: "Audit log",
        body: "A read only, chronological record of sign-ins, invites, email changes, and access resets. It's kept for 90 days; failed sign-in attempts aren't included here."
      }
    ]
  }
];

console.log(`Prepared ${GUIDES.length} guide records:`, GUIDES.map(g => g.page));

if (DRY_RUN) process.exit(0);

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const items = GUIDES.map(({ page, ...g }) => ({ pk: "GUIDE", sk: page, ...g }));

for (let i = 0; i < items.length; i += 25) {
  const batch = items.slice(i, i + 25);
  const res = await doc.send(new BatchWriteCommand({
    RequestItems: { [TABLE]: batch.map(Item => ({ PutRequest: { Item } })) }
  }));
  const unprocessed = res.UnprocessedItems?.[TABLE]?.length || 0;
  if (unprocessed > 0) throw new Error(`${unprocessed} items unprocessed in batch at ${i}`);
  console.log(`Wrote items ${i + 1}-${i + batch.length}`);
}
console.log("Guide seed complete.");
